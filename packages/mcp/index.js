#!/usr/bin/env node

// chinwag MCP server — connects AI agents to the chinwag network.
// Runs locally via stdio transport. Reads ~/.chinwag/config.json for auth.
// CRITICAL: Never use console.log — it corrupts stdio JSON-RPC. Use console.error.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { loadConfig, configExists } from './lib/config.js';
import { api, getApiUrl } from './lib/api.js';
import { scanEnvironment } from './lib/profile.js';
import { findTeamFile, teamHandlers } from './lib/team.js';
import { detectRuntimeIdentity, generateSessionAgentId, getConfiguredAgentId } from './lib/identity.js';
import { cleanupProcessSession, registerProcessSession } from './lib/lifecycle.js';
import { registerTools, registerResources } from './lib/tools/index.js';
import { isProcessAlive, setTerminalTitle } from '../shared/session-registry.js';
import { scanHostIntegrations, configureHostIntegration } from '../shared/integration-doctor.js';

let PKG = { version: '0.0.0' };
try {
  PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
} catch { /* fallback if bundled or path changes */ }

async function main() {
  if (!configExists()) {
    console.error('[chinwag] No config found. Run `npx chinwag` first to create an account.');
    process.exit(1);
  }

  const config = loadConfig();
  if (!config?.token) {
    console.error('[chinwag] Invalid config — missing token. Run `npx chinwag` to re-initialize.');
    process.exit(1);
  }

  const runtime = detectRuntimeIdentity('unknown', { defaultTransport: 'mcp' });
  const toolName = runtime.hostTool;
  const agentId = getConfiguredAgentId(runtime) || generateSessionAgentId(config.token, runtime);
  const client = api(config, { agentId, runtimeIdentity: runtime });
  const runtimeLabel = runtime.agentSurface
    ? `${runtime.hostTool}/${runtime.agentSurface}`
    : runtime.hostTool;
  console.error(`[chinwag] Runtime: ${runtimeLabel} via ${runtime.transport}, Agent ID: ${agentId}`);

  // Detect parent TTY and write session file for terminal identification
  let parentTty = null;
  try {
    ({ tty: parentTty } = registerProcessSession(agentId, toolName));
    if (parentTty) {
      console.error(`[chinwag] Terminal: ${parentTty}`);
      setTerminalTitle(parentTty, `chinwag · ${basename(process.cwd())}`);
    }
  } catch {}

  // Scan environment and register profile
  const profile = scanEnvironment();
  try {
    await client.put('/agent/profile', profile);
    console.error(`[chinwag] Profile registered: ${[...profile.languages, ...profile.frameworks].join(', ') || 'no stack detected'}`);
  } catch (err) {
    console.error('[chinwag] Failed to register profile:', err.message);
  }

  // Mutable state shared with tool handlers (fixes scoping — tools need to
  // read/write these values, and they run in a different module's closures).
  const state = {
    teamId: findTeamFile(),
    ws: null,           // WebSocket to TeamDO (presence + activity channel)
    sessionId: null,
    tty: parentTty,
    modelReported: false,
    lastActivity: Date.now(),
  };

  const team = teamHandlers(client);
  const projectName = basename(process.cwd());

  if (state.teamId) {
    try {
      await team.joinTeam(state.teamId, projectName);
      console.error(`[chinwag] Auto-joined team ${state.teamId}`);

      try {
        const session = await team.startSession(state.teamId, profile.framework);
        state.sessionId = session.session_id;
        console.error(`[chinwag] Session started: ${state.sessionId}`);
      } catch (err) {
        console.error('[chinwag] Failed to start session:', err.message);
      }

      // WebSocket presence — connection IS the heartbeat.
      // Pings every 60s keep the DB timestamp fresh for SQL queries.
      // Reconnects with exponential backoff on disconnect.
      const WS_PING_MS = 60_000;
      let reconnectDelay = 1000;
      let pingTimer = null;
      let lastWsSend = 0;
      let connecting = false;

      function connectTeamWs() {
        if (connecting || state._shuttingDown) return;
        connecting = true;

        // Fetch short-lived ticket, then open WS
        client.post('/auth/ws-ticket').then(({ ticket }) => {
          if (state._shuttingDown) { connecting = false; return; }

          const wsBase = getApiUrl().replace(/^http/, 'ws');
          const wsUrl = `${wsBase}/teams/${state.teamId}/ws?agentId=${encodeURIComponent(agentId)}&ticket=${encodeURIComponent(ticket)}&role=agent`;

          const ws = new WebSocket(wsUrl);

          ws.onopen = () => {
            connecting = false;
            state.ws = ws;
            reconnectDelay = 1000;
            console.error('[chinwag] WebSocket connected (presence active)');

            // Ping to keep DB heartbeat fresh — only when no activity was sent recently
            pingTimer = setInterval(() => {
              if (Date.now() - lastWsSend > WS_PING_MS - 5000) {
                try {
                  ws.send(JSON.stringify({ type: 'ping', lastToolUseAt: state.lastActivity }));
                  lastWsSend = Date.now();
                } catch { /* close will fire */ }
              }
            }, WS_PING_MS);
            if (pingTimer.unref) pingTimer.unref();
          };

          ws.onmessage = () => {}; // agent doesn't need broadcasts

          ws.onclose = () => {
            connecting = false;
            state.ws = null;
            if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
            if (!state._shuttingDown) {
              console.error(`[chinwag] WebSocket disconnected, reconnecting in ${reconnectDelay / 1000}s`);
              const timer = setTimeout(connectTeamWs, reconnectDelay);
              if (timer.unref) timer.unref();
              reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
            }
          };

          ws.onerror = () => {}; // onclose fires after
        }).catch(() => {
          connecting = false;
          if (!state._shuttingDown) {
            const timer = setTimeout(connectTeamWs, reconnectDelay);
            if (timer.unref) timer.unref();
            reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
          }
        });
      }

      connectTeamWs();
    } catch (err) {
      console.error(`[chinwag] Failed to join team ${state.teamId}:`, err.message);
      state.teamId = null;
    }
  }

  // Clean up on exit — end session then exit.
  // Second signal or 3s timeout = force exit (don't hang on network issues).
  let cleaning = false;
  const parentPid = process.ppid;
  let parentWatch = null;
  const cleanup = () => {
    if (cleaning) { process.exit(0); return; }
    cleaning = true;
    if (parentWatch) {
      clearInterval(parentWatch);
      parentWatch = null;
    }
    const forceExit = setTimeout(() => process.exit(0), 3000);
    forceExit.unref();
    const done = () => { clearTimeout(forceExit); process.exit(0); };
    cleanupProcessSession(agentId, state, team).finally(done);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.stdin.on('end', cleanup);
  process.stdin.on('close', cleanup);
  process.on('disconnect', cleanup);

  parentWatch = setInterval(() => {
    if (parentPid > 1 && !isProcessAlive(parentPid)) {
      cleanup();
    }
  }, 5000);
  parentWatch.unref?.();

  // Create MCP server
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
  console.error('[chinwag] Fatal error:', err);
  process.exit(1);
});
