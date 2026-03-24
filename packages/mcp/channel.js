#!/usr/bin/env node

// chinwag channel — pushes real-time team state changes into Claude Code sessions.
// This is a separate MCP server process that declares the claude/channel capability.
// It polls the backend for team context, diffs against previous state, and emits
// notifications for meaningful changes (new agents, file edits, conflicts, memories).
//
// Unlike the main MCP server, the channel server has no tools — it only pushes.
// CRITICAL: Never console.log — stdio transport. Use console.error for logging.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, configExists } from './lib/config.js';
import { api } from './lib/api.js';
import { findTeamFile } from './lib/team.js';

const POLL_INTERVAL_MS = 10_000;

async function main() {
  if (!configExists()) {
    console.error('[chinwag-channel] No config found.');
    process.exit(1);
  }

  const config = loadConfig();
  if (!config?.token) {
    console.error('[chinwag-channel] Invalid config — missing token.');
    process.exit(1);
  }

  const teamId = findTeamFile();
  if (!teamId) {
    console.error('[chinwag-channel] No .chinwag file — channel inactive.');
    process.exit(0);
  }

  const client = api(config);

  const server = new Server(
    { name: 'chinwag-channel', version: '0.1.0' },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
      },
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[chinwag-channel] Channel server running');

  // Join team to keep heartbeat active
  try {
    await client.post(`/teams/${teamId}/join`, {});
  } catch (err) {
    console.error(`[chinwag-channel] Failed to join team: ${err.message}`);
  }

  // State diffing + stuckness tracking
  let prevState = null;
  const stucknessAlerted = new Map(); // handle → updated_at when alert was sent

  const poll = async () => {
    try {
      const ctx = await client.get(`/teams/${teamId}/context`);
      if (prevState) {
        const events = diffState(prevState, ctx, stucknessAlerted);
        for (const event of events) {
          await pushEvent(server, event);
        }
      }
      prevState = ctx;
    } catch (err) {
      console.error(`[chinwag-channel] Poll failed: ${err.message}`);
    }
  };

  // Initial fetch (don't emit events on first poll)
  try {
    prevState = await client.get(`/teams/${teamId}/context`);
  } catch {
    // Will retry on next interval
  }

  const interval = setInterval(poll, POLL_INTERVAL_MS);

  // Heartbeat to keep membership alive
  const heartbeat = setInterval(async () => {
    try {
      await client.post(`/teams/${teamId}/heartbeat`, {});
    } catch {}
  }, 30_000);

  const cleanup = () => {
    clearInterval(interval);
    clearInterval(heartbeat);
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// --- State diffing ---

const STUCKNESS_THRESHOLD_MINUTES = 15;

function diffState(prev, curr, stucknessAlerted) {
  const events = [];

  const prevHandles = new Set(prev.members?.map(m => m.handle) || []);
  const currHandles = new Set(curr.members?.map(m => m.handle) || []);
  const prevByHandle = new Map((prev.members || []).map(m => [m.handle, m]));
  const currByHandle = new Map((curr.members || []).map(m => [m.handle, m]));

  // New agents joined
  for (const handle of currHandles) {
    if (!prevHandles.has(handle)) {
      const m = currByHandle.get(handle);
      const activity = m.activity ? ` — working on ${m.activity.files.join(', ')}` : '';
      events.push(`Agent ${handle} joined the team${activity}`);
    }
  }

  // Agents went offline
  for (const handle of prevHandles) {
    if (!currHandles.has(handle)) {
      events.push(`Agent ${handle} disconnected`);
    }
  }

  // File activity changes
  for (const handle of currHandles) {
    if (!prevHandles.has(handle)) continue; // Already reported as "joined"
    const prev = prevByHandle.get(handle);
    const curr = currByHandle.get(handle);
    if (!prev || !curr) continue;

    const prevFiles = new Set(prev.activity?.files || []);
    const currFiles = curr.activity?.files || [];
    const newFiles = currFiles.filter(f => !prevFiles.has(f));

    if (newFiles.length > 0) {
      events.push(`${handle} started editing ${newFiles.join(', ')}`);
    }
  }

  // Conflict detection
  const fileOwners = new Map();
  for (const m of (curr.members || [])) {
    if (m.status !== 'active' || !m.activity?.files) continue;
    for (const f of m.activity.files) {
      if (!fileOwners.has(f)) fileOwners.set(f, []);
      fileOwners.get(f).push(m.handle);
    }
  }
  for (const [file, owners] of fileOwners) {
    if (owners.length > 1) {
      events.push(`CONFLICT: ${owners.join(' and ')} are both editing ${file}`);
    }
  }

  // Stuckness detection: agent on same task too long
  for (const handle of currHandles) {
    const m = currByHandle.get(handle);
    if (!m?.activity?.updated_at || m.status !== 'active') continue;

    const alertedAt = stucknessAlerted.get(handle);
    if (alertedAt && alertedAt !== m.activity.updated_at) {
      // Activity changed since alert — clear it
      stucknessAlerted.delete(handle);
    }

    if (!stucknessAlerted.has(handle)) {
      const minutesOnSameActivity = (Date.now() - new Date(m.activity.updated_at).getTime()) / 60_000;
      if (minutesOnSameActivity > STUCKNESS_THRESHOLD_MINUTES) {
        events.push(`Agent ${handle} has been on the same task for ${Math.round(minutesOnSameActivity)} min — may be stuck`);
        stucknessAlerted.set(handle, m.activity.updated_at);
      }
    }
  }

  // Clear alerts for agents that disconnected
  for (const handle of stucknessAlerted.keys()) {
    if (!currHandles.has(handle)) {
      stucknessAlerted.delete(handle);
    }
  }

  // New memories
  const prevMemTexts = new Set((prev.memories || []).map(m => m.text));
  for (const mem of (curr.memories || [])) {
    if (!prevMemTexts.has(mem.text)) {
      events.push(`New team knowledge: [${mem.category}] ${mem.text}`);
    }
  }

  return events;
}

async function pushEvent(server, content) {
  try {
    await server.notification({
      method: 'notifications/claude/channel',
      params: { content },
    });
    console.error(`[chinwag-channel] Pushed: ${content}`);
  } catch (err) {
    console.error(`[chinwag-channel] Push failed: ${err.message}`);
  }
}

main().catch((err) => {
  console.error('[chinwag-channel] Fatal error:', err);
  process.exit(1);
});
