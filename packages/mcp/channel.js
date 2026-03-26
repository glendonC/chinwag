#!/usr/bin/env node

// chinwag channel — pushes real-time team state changes into Claude Code sessions.
// This is a separate MCP server process that declares the claude/channel capability.
// It polls the backend for team context, diffs against previous state, and emits
// notifications for meaningful changes (new agents, file edits, conflicts, memories).
//
// Unlike the main MCP server, the channel server has no tools — it only pushes.
// CRITICAL: Never console.log — stdio transport. Use console.error for logging.

import { readFileSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, configExists } from './lib/config.js';
import { api } from './lib/api.js';
import { findTeamFile } from './lib/team.js';
import { detectToolName } from './lib/identity.js';
import { resolveAgentIdentity } from './lib/lifecycle.js';
import { diffState } from './lib/diff-state.js';

let PKG = { version: '0.0.0' };
try {
  PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
} catch { /* fallback if bundled or path changes */ }

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

  const toolName = detectToolName('claude-code');
  const { agentId } = resolveAgentIdentity(config.token, toolName);
  const client = api(config, { agentId });
  console.error(`[chinwag-channel] Tool: ${toolName}, Agent ID: ${agentId}`);

  const server = new Server(
    { name: 'chinwag-channel', version: PKG.version },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
      },
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[chinwag-channel] Channel server running');

  // MCP server handles joining. Channel only reads context + heartbeats.

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
