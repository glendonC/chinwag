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
import { findTeamFile, teamHandlers } from './lib/team.js';
import { detectRuntimeIdentity } from './lib/identity.js';
import { resolveAgentIdentity } from './lib/lifecycle.js';
import { diffState } from './lib/diff-state.js';
import { isProcessAlive, pingAgentTerminal } from '@chinwag/shared/session-registry.js';

// --- Constants ---
const POLL_INTERVAL_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const PARENT_WATCH_INTERVAL_MS = 5_000;
/** @type {number} Max consecutive poll failures before backoff caps */
const MAX_POLL_BACKOFF_MULTIPLIER = 6;
/** @type {number} Max consecutive heartbeat failures before backoff caps */
const MAX_HEARTBEAT_BACKOFF_MULTIPLIER = 6;

/**
 * HTTP status code indicating the agent is not a team member.
 * Used instead of string-matching error messages.
 * @type {number}
 */
const NOT_A_MEMBER_STATUS = 403;

let PKG = { version: '0.0.0' };
try {
  PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
} catch (err) {
  console.error('[chinwag-channel]', err?.message || 'failed to read package.json');
}

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

  const runtime = detectRuntimeIdentity('unknown', { defaultTransport: 'channel' });
  const toolName = runtime.hostTool;
  if (!runtime.capabilities.includes('channel')) {
    console.error(`[chinwag-channel] Parent host is ${toolName}; channel disabled.`);
    process.exit(0);
  }
  const { agentId } = resolveAgentIdentity(config.token, toolName);
  const client = api(config, { agentId, runtimeIdentity: runtime });
  const team = teamHandlers(client);
  console.error(
    `[chinwag-channel] Runtime: ${toolName} via ${runtime.transport}, Agent ID: ${agentId}`,
  );

  const server = new Server(
    { name: 'chinwag-channel', version: PKG.version },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
      },
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[chinwag-channel] Channel server running');

  // MCP server handles joining. Channel only reads context + heartbeats.

  // State diffing + stuckness tracking
  let prevState = null;
  const stucknessAlerted = new Map(); // handle -> updated_at when alert was sent

  // Poll backoff state — backs off on consecutive failures, resets on success
  let pollFailures = 0;

  const poll = async () => {
    try {
      const ctx = await team.getTeamContext(teamId);
      if (pollFailures > 0) {
        console.error(`[chinwag-channel] Poll recovered after ${pollFailures} failure(s)`);
        pollFailures = 0;
      }
      if (prevState) {
        const events = diffState(prevState, ctx, stucknessAlerted);
        for (const event of events) {
          await pushEvent(server, agentId, event);
        }
      }
      prevState = ctx;
    } catch (err) {
      pollFailures++;
      const backoffMultiplier = Math.min(pollFailures, MAX_POLL_BACKOFF_MULTIPLIER);
      const nextRetryMs = POLL_INTERVAL_MS * backoffMultiplier;
      console.error(
        `[chinwag-channel] Poll failed (attempt ${pollFailures}, next retry in ${nextRetryMs / 1000}s): ${err.message}`,
      );
    }
  };

  // Initial fetch (don't emit events on first poll)
  try {
    prevState = await team.getTeamContext(teamId);
  } catch (err) {
    console.error('[chinwag-channel]', err?.message || 'initial fetch failed, will retry');
  }

  // Adaptive polling: interval self-adjusts based on consecutive failure count
  let pollTimer = null;
  function schedulePoll() {
    const backoffMultiplier = Math.min(pollFailures + 1, MAX_POLL_BACKOFF_MULTIPLIER);
    const delay = POLL_INTERVAL_MS * backoffMultiplier;
    pollTimer = setTimeout(async () => {
      await poll();
      schedulePoll();
    }, delay);
    pollTimer.unref?.();
  }
  schedulePoll();

  // Heartbeat with backoff — rejoin if evicted (detected by status code, not string matching)
  let heartbeatFailures = 0;
  let heartbeatTimer = null;

  function scheduleHeartbeat() {
    const backoffMultiplier = Math.min(heartbeatFailures + 1, MAX_HEARTBEAT_BACKOFF_MULTIPLIER);
    const delay = HEARTBEAT_INTERVAL_MS * backoffMultiplier;
    heartbeatTimer = setTimeout(async () => {
      try {
        await team.heartbeat(teamId);
        if (heartbeatFailures > 0) {
          console.error(
            `[chinwag-channel] Heartbeat recovered after ${heartbeatFailures} failure(s)`,
          );
          heartbeatFailures = 0;
        }
      } catch (err) {
        heartbeatFailures++;
        if (err.status === NOT_A_MEMBER_STATUS) {
          try {
            await team.joinTeam(teamId);
            heartbeatFailures = 0;
            console.error('[chinwag-channel] Rejoined team after eviction');
          } catch (rejoinErr) {
            console.error(
              `[chinwag-channel] Rejoin failed (attempt ${heartbeatFailures}): ${rejoinErr?.message || 'unknown'}`,
            );
          }
        } else {
          const nextRetryMs =
            HEARTBEAT_INTERVAL_MS *
            Math.min(heartbeatFailures + 1, MAX_HEARTBEAT_BACKOFF_MULTIPLIER);
          console.error(
            `[chinwag-channel] Heartbeat failed (attempt ${heartbeatFailures}, next in ${nextRetryMs / 1000}s): ${err?.message || 'unknown'}`,
          );
        }
      }
      scheduleHeartbeat();
    }, delay);
    heartbeatTimer.unref?.();
  }
  scheduleHeartbeat();

  const parentPid = process.ppid;
  const parentWatch = setInterval(() => {
    if (parentPid > 1 && !isProcessAlive(parentPid)) {
      cleanup();
    }
  }, PARENT_WATCH_INTERVAL_MS);
  parentWatch.unref?.();

  const cleanup = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
    clearInterval(parentWatch);
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('disconnect', cleanup);
  process.stdin.on('close', cleanup);
}

function shouldRequestAttention(content) {
  return (
    content.startsWith('CONFLICT:') ||
    content.startsWith('Message from ') ||
    content.includes('may be stuck')
  );
}

async function pushEvent(server, agentId, content) {
  try {
    await server.notification({
      method: 'notifications/claude/channel',
      params: { content },
    });
    if (shouldRequestAttention(content)) {
      pingAgentTerminal(agentId);
    }
    console.error(`[chinwag-channel] Pushed: ${content}`);
  } catch (err) {
    console.error(`[chinwag-channel] Push failed: ${err.message}`);
  }
}

main().catch((err) => {
  console.error('[chinwag-channel] Fatal error:', err);
  process.exit(1);
});
