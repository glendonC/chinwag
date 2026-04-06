#!/usr/bin/env node

// chinwag MCP server — connects AI agents to the chinwag network.
// Runs locally via stdio transport. Reads ~/.chinwag/config.json for auth.
// CRITICAL: Never use console.log — it corrupts stdio JSON-RPC. Use the structured logger.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { createLogger } from './dist/utils/logger.js';
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
import { detectRuntimeIdentity, generateSessionAgentId } from './dist/identity.js';
import {
  detectSpawnableTools,
  executeSpawnCommand,
  executeStopCommand,
} from './dist/command-executor.js';

const log = createLogger('mcp');

let PKG = { version: '0.0.0' };
try {
  PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
} catch (err) {
  log.warn(err?.message || 'failed to read package.json');
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
  const { runtime, client, team, teamId } = ctx;
  let currentAgentId = ctx.agentId;
  const agentId = ctx.agentId; // initial ID for session registration
  const toolName = runtime.hostTool;
  const runtimeLabel = runtime.agentSurface
    ? `${runtime.hostTool}/${runtime.agentSurface}`
    : runtime.hostTool;
  log.info(`Runtime: ${runtimeLabel} via ${runtime.transport}, Agent ID: ${agentId}`);

  // 2. Register session for terminal identification
  let parentTty = null;
  try {
    ({ tty: parentTty } = registerProcessSession(agentId, toolName));
    if (parentTty) {
      log.info(`Terminal: ${parentTty}`);
      setTerminalTitle(parentTty, `chinwag · ${basename(process.cwd())}`);
    }
  } catch (err) {
    log.warn(err?.message || 'session registration failed');
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

  // 5. Detect spawnable tools + initialize WebSocket manager reference
  const spawnTools = detectSpawnableTools();
  if (spawnTools.length > 0) {
    log.info(`Spawnable tools: ${spawnTools.join(', ')}`);
  }
  let wsManager = null;

  // 6. Setup graceful shutdown (before MCP server so it covers all exit paths)
  setupShutdownHandlers({
    agentId,
    state,
    team,
    onDisconnectWs: () => wsManager?.disconnect(),
  });

  // ── Team join helper — called once after identity is fully resolved ──
  let teamJoined = false;
  async function joinTeamOnce() {
    if (teamJoined || !state.teamId) return;
    teamJoined = true;
    try {
      await team.joinTeam(state.teamId, projectName);
      log.info(`Joined team ${state.teamId}`);

      try {
        const session = await team.startSession(state.teamId, profile.framework);
        const sessionId = session?.session_id;
        if (!sessionId) {
          log.warn('Session start returned invalid response — continuing without session');
        } else {
          state.sessionId = sessionId;
          log.info(`Session started: ${state.sessionId}`);
        }
      } catch (err) {
        log.warn(`Failed to start session: ${err.message}`);
      }

      // Command handler: receives spawn/stop commands from web dashboard via TeamDO
      const pendingClaims = new Map();
      function handleWsMessage(data, ws) {
        if (data.type === 'command' && spawnTools.length > 0) {
          const commandId = data.id;
          const commandType = data.command_type;
          const payload = data.payload || {};

          // Claim the command (first-claim-wins across all connected MCP servers)
          const claimTimer = setTimeout(() => {
            pendingClaims.delete(commandId);
          }, 5000);
          pendingClaims.set(commandId, { timer: claimTimer });
          ws.send(JSON.stringify({ type: 'claim_command', id: commandId }));

          // Execute after a brief delay to allow claim_result to arrive
          // (optimistic execution — if claim fails, the result is harmless)
          setTimeout(() => {
            let result;
            try {
              if (commandType === 'spawn') {
                result = executeSpawnCommand(payload, process.cwd());
              } else if (commandType === 'stop') {
                result = executeStopCommand(payload);
              } else {
                result = { error: `Unknown command type: ${commandType}` };
              }
            } catch (err) {
              result = { error: String(err?.message || err) };
            }

            const status = result.error ? 'failed' : 'completed';
            log.info(`Command ${commandId} ${status}`);
            try {
              ws.send(JSON.stringify({ type: 'command_result', id: commandId, status, result }));
            } catch {
              /* ws may have closed */
            }
          }, 100);
        } else if (data.type === 'claim_result') {
          const pending = pendingClaims.get(data.id);
          if (pending) {
            clearTimeout(pending.timer);
            pendingClaims.delete(data.id);
          }
        }
      }

      wsManager = createWebSocketManager({
        client,
        getApiUrl,
        teamId: state.teamId,
        agentId: currentAgentId,
        state,
        spawnTools,
        onMessage: handleWsMessage,
      });
      wsManager.connect();
    } catch (err) {
      const failedTeamId = state.teamId;
      const reason = err?.message || 'unknown error';
      log.warn(
        `Failed to join team "${failedTeamId}": ${reason}. ` +
          'Team features will be unavailable. Check your network connection and team ID.',
      );
      state.teamJoinError = `Join failed for team "${failedTeamId}": ${reason}`;
      state.teamId = null;
    }
  }

  // 7. Create MCP server (tools are registered before join — they work with deferred team state)
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

  // 8. Hook into MCP initialization to resolve identity, then join team.
  //    The MCP handshake includes clientInfo.name — the most reliable signal for
  //    which tool is hosting us. We defer the team join until this fires so the
  //    first (and only) join carries the correct host_tool identity.
  //    Fallback: if the handshake doesn't fire within 5s, join with whatever
  //    identity we have (process-tree detection or the default).
  const IDENTITY_TIMEOUT_MS = 5000;
  let identityTimer = null;

  if (state.teamId) {
    identityTimer = setTimeout(() => {
      if (!teamJoined) {
        log.info('MCP handshake timeout — joining with pre-handshake identity');
        joinTeamOnce();
      }
    }, IDENTITY_TIMEOUT_MS);
  }

  const lowLevelServer = server.server;
  lowLevelServer.oninitialized = () => {
    const clientVersion = lowLevelServer.getClientVersion();
    if (identityTimer) clearTimeout(identityTimer);

    if (clientVersion?.name) {
      log.info(`MCP client: ${clientVersion.name} v${clientVersion.version || '?'}`);

      // Resolve identity from clientInfo if not explicitly set
      if (runtime.detectionSource !== 'explicit') {
        const corrected = detectRuntimeIdentity(runtime.hostTool, {
          clientInfoName: clientVersion.name,
        });

        if (corrected.hostTool !== runtime.hostTool) {
          log.info(
            `Identity resolved: ${runtime.hostTool} → ${corrected.hostTool} (via MCP clientInfo "${clientVersion.name}")`,
          );
          currentAgentId = generateSessionAgentId(ctx.config.token, corrected);
          ctx.client.updateIdentity(currentAgentId, corrected);
        }
      }
    }

    // Join team with final resolved identity (first and only join)
    joinTeamOnce();
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('MCP server running');
}

main().catch((err) => {
  log.error(`Fatal error: ${err?.stack || err}`);
  process.exit(1);
});
