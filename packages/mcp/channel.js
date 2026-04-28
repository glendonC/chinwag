#!/usr/bin/env node

// chinmeister channel - pushes real-time team state changes into Claude Code sessions.
// This is a separate MCP server process that declares the claude/channel capability.
//
// Architecture: WebSocket-first with HTTP reconciliation fallback.
// - Connects to TeamDO as a watcher via WebSocket
// - Receives delta events in real-time, maintains local TeamContext via applyDelta
// - Diffs state snapshots to detect joins, conflicts, stuckness, locks, messages
// - Falls back to 10s HTTP polling when WebSocket is disconnected
// - Reconciles via full HTTP fetch every 60s to catch any drift
//
// Unlike the main MCP server, the channel server has no tools - it only pushes.
// CRITICAL: Never console.log - stdio transport. Use console.error for logging.

import { readFileSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getApiUrl } from './dist/api.js';
import { diffState } from './dist/diff-state.js';
import { isProcessAlive, pingAgentTerminal } from '@chinmeister/shared/session-registry.js';
import { createChannelWebSocket } from './dist/channel-ws.js';
import { createReconciler } from './dist/channel-reconcile.js';
import { bootstrap } from './dist/bootstrap.js';

const PARENT_WATCH_INTERVAL_MS = 5_000;

let PKG = { version: '0.0.0' };
try {
  PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
} catch (err) {
  console.error('[chinmeister-channel]', err?.message || 'failed to read package.json');
}

async function main() {
  // Bootstrap: exit(1) for missing config/token, exit(0) for missing team
  const ctx = await bootstrap({
    hostToolHint: 'unknown',
    defaultTransport: 'channel',
    configMode: 'simple',
    identityMode: 'resolve',
    onMissing: 'require-config',
    logPrefix: 'chinmeister-channel',
  });
  const { runtime, agentId, client, team, teamId } = ctx;
  const toolName = runtime.hostTool;

  // Channel capability check (not part of bootstrap - channel-specific logic)
  if (!runtime.capabilities.includes('channel')) {
    console.error(`[chinmeister-channel] Parent host is ${toolName}; channel disabled.`);
    process.exit(0);
    return;
  }
  console.error(
    `[chinmeister-channel] Runtime: ${toolName} via ${runtime.transport}, Agent ID: ${agentId}`,
  );

  const server = new Server(
    { name: 'chinmeister-channel', version: PKG.version },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
      },
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[chinmeister-channel] Channel server running');

  // MCP server (index.js) handles joining and agent presence.
  // Channel only observes via watcher WebSocket + reconciliation.

  // State diffing infrastructure
  const stucknessAlerted = new Map();

  const logger = {
    info: (msg) => console.error(`[chinmeister-channel] ${msg}`),
    warn: (msg) => console.error(`[chinmeister-channel] ${msg}`),
    error: (msg) => console.error(`[chinmeister-channel] ${msg}`),
  };

  // WebSocket: real-time delta events from TeamDO
  const channelWs = createChannelWebSocket({
    client,
    getApiUrl,
    teamId,
    agentId,
    onContextUpdate: (prev, curr) => {
      if (prev === null) {
        // Initial context on connect - no diff needed
        return;
      }
      const events = diffState(prev, curr, stucknessAlerted);
      for (const event of events) {
        pushEvent(server, agentId, event);
      }
    },
    logger,
  });

  // Reconciler: periodic HTTP fetch as safety net (60s) or fallback (10s)
  const reconciler = createReconciler({
    team,
    teamId,
    getLocalContext: () => channelWs.getContext(),
    replaceContext: (ctx) => {
      channelWs.setContext(ctx);
    },
    onEvents: (events) => {
      for (const event of events) {
        pushEvent(server, agentId, event);
      }
    },
    stucknessAlerted,
    isWsConnected: () => channelWs.isConnected(),
    logger,
  });

  channelWs.connect();
  reconciler.start();

  // Watch parent process - exit if parent dies
  const parentPid = process.ppid;
  const parentWatch = setInterval(() => {
    if (parentPid > 1 && !isProcessAlive(parentPid)) {
      cleanup();
    }
  }, PARENT_WATCH_INTERVAL_MS);
  parentWatch.unref?.();

  const cleanup = () => {
    channelWs.disconnect();
    reconciler.stop();
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
    console.error(`[chinmeister-channel] Pushed: ${content}`);
  } catch (err) {
    console.error(`[chinmeister-channel] Push failed: ${err.message}`);
  }
}

main().catch((err) => {
  console.error('[chinmeister-channel] Fatal error:', err);
  process.exit(1);
});
