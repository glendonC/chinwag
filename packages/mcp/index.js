#!/usr/bin/env node

// chinwag MCP server — connects AI agents to the chinwag network.
// Runs locally via stdio transport. Reads ~/.chinwag/config.json for auth.
// CRITICAL: Never use console.log — it corrupts stdio JSON-RPC. Use console.error.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { getApiUrl } from './dist/api.js';
import { scanEnvironment } from './dist/profile.js';
import { registerProcessSession, setupShutdownHandlers } from './dist/lifecycle.js';
import { registerProfile } from './dist/auth.js';
import { createWebSocketManager } from './dist/websocket.js';
import { registerTools, registerResources } from './dist/tools/index.js';
import { createAgentState } from './dist/state.js';
import { setTerminalTitle } from '@chinwag/shared/session-registry.js';
import {
  scanHostIntegrations,
  configureHostIntegration,
} from '@chinwag/shared/integration-doctor.js';
import { bootstrap } from './dist/bootstrap.js';

let PKG = { version: '0.0.0' };
try {
  PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
} catch (err) {
  console.error('[chinwag]', err?.message || 'failed to read package.json');
}

async function main() {
  // 1. Bootstrap: validate config, resolve identity, create API client + team handlers
  const ctx = await bootstrap({
    hostToolHint: 'unknown',
    defaultTransport: 'mcp',
    configMode: 'full',
    identityMode: 'session',
    onMissing: 'require-all',
  });
  const { runtime, agentId, client, team, teamId } = ctx;
  const toolName = runtime.hostTool;
  const runtimeLabel = runtime.agentSurface
    ? `${runtime.hostTool}/${runtime.agentSurface}`
    : runtime.hostTool;
  console.error(
    `[chinwag] Runtime: ${runtimeLabel} via ${runtime.transport}, Agent ID: ${agentId}`,
  );

  // 2. Register session for terminal identification
  let parentTty = null;
  try {
    ({ tty: parentTty } = registerProcessSession(agentId, toolName));
    if (parentTty) {
      console.error(`[chinwag] Terminal: ${parentTty}`);
      setTerminalTitle(parentTty, `chinwag · ${basename(process.cwd())}`);
    }
  } catch (err) {
    console.error('[chinwag]', err?.message || 'session registration failed');
  }

  // 3. Register environment profile
  const profile = scanEnvironment();
  await registerProfile(client, profile);

  // 4. Initialize shared state (Proxy-guarded to prevent typo bugs)
  const state = createAgentState({
    teamId,
    ws: null,
    sessionId: null,
    tty: parentTty,
    modelReported: null,
    modelReportInflight: null,
    lastActivity: Date.now(),
    heartbeatInterval: null,
    heartbeatRecoveryTimeout: null,
    shuttingDown: false,
    teamJoinError: null,
    heartbeatDead: false,
  });

  const projectName = basename(process.cwd());

  // 5. Join team and start WebSocket presence
  let wsManager = null;
  if (state.teamId) {
    try {
      await team.joinTeam(state.teamId, projectName);
      console.error(`[chinwag] Auto-joined team ${state.teamId}`);

      try {
        const session = await team.startSession(state.teamId, profile.framework);
        const sessionId = session?.session_id;
        if (!sessionId) {
          console.error(
            '[chinwag] Session start returned invalid response — continuing without session',
          );
        } else {
          state.sessionId = sessionId;
          console.error(`[chinwag] Session started: ${state.sessionId}`);
        }
      } catch (err) {
        console.error('[chinwag] Failed to start session:', err.message);
      }

      wsManager = createWebSocketManager({
        client,
        getApiUrl,
        teamId: state.teamId,
        agentId,
        state,
      });
      wsManager.connect();
    } catch (err) {
      const failedTeamId = state.teamId;
      const reason = err?.message || 'unknown error';
      console.error(
        `[chinwag] WARNING: Failed to join team "${failedTeamId}": ${reason}. ` +
          'Team features will be unavailable. Check your network connection and team ID.',
      );
      state.teamJoinError = `Join failed for team "${failedTeamId}": ${reason}`;
      state.teamId = null;
    }
  }

  // 6. Setup graceful shutdown
  setupShutdownHandlers({
    agentId,
    state,
    team,
    onDisconnectWs: wsManager ? () => wsManager.disconnect() : undefined,
  });

  // 7. Create and start MCP server
  const server = new McpServer({
    name: 'chinwag',
    version: PKG.version,
    instructions: `You are connected to chinwag — a shared brain for your team's AI coding agents. Other agents (potentially from different tools like Cursor, Claude Code, Windsurf) may be working on this project right now.

CRITICAL WORKFLOW — follow these steps every session:
1. FIRST call chinwag_get_team_context to see who's working, what files are active, any locked files, recent messages, and shared project knowledge. Include your model identifier if you know it (e.g. "claude-opus-4-6", "gpt-4o").
2. BEFORE editing any file, call chinwag_check_conflicts with the files you plan to modify. If a file is locked or another agent is editing it, coordinate first — use chinwag_send_message to notify them.
3. AFTER you start editing, call chinwag_claim_files to lock the files you're working on, then call chinwag_update_activity with your file list and a brief summary.
4. When you discover something important about the project (setup requirements, gotchas, conventions, decisions), call chinwag_save_memory so every future agent session starts with that knowledge.
5. When done with files, call chinwag_release_files so other agents can work on them.

This coordination prevents merge conflicts across tools and builds shared project intelligence.`,
  });

  const integrationDoctor = { scanHostIntegrations, configureHostIntegration };
  registerTools(server, { team, state, profile, integrationDoctor });
  registerResources(server, profile);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[chinwag] MCP server running');
}

main().catch((err) => {
  console.error('[chinwag] Fatal error:', err?.stack || err);
  process.exit(1);
});
