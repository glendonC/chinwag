#!/usr/bin/env node

// chinwag MCP server — connects AI agents to the chinwag network.
// Runs locally via stdio transport. Reads ~/.chinwag/config.json for auth.
// CRITICAL: Never use console.log — it corrupts stdio JSON-RPC. Use console.error.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { loadConfig, configExists } from './lib/config.js';
import { api } from './lib/api.js';
import { scanEnvironment } from './lib/profile.js';
import { findTeamFile, teamHandlers } from './lib/team.js';

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

  const client = api(config);

  // Scan environment and register profile
  const profile = scanEnvironment();
  try {
    await client.put('/agent/profile', profile);
    console.error(`[chinwag] Profile registered: ${[...profile.languages, ...profile.frameworks].join(', ') || 'no stack detected'}`);
  } catch (err) {
    console.error('[chinwag] Failed to register profile:', err.message);
  }

  // Check for .chinwag team file
  let currentTeamId = findTeamFile();
  let heartbeatInterval = null;
  let sessionId = null;
  const team = teamHandlers(client);

  if (currentTeamId) {
    try {
      await team.joinTeam(currentTeamId);
      console.error(`[chinwag] Auto-joined team ${currentTeamId}`);

      // Start observability session
      try {
        const session = await team.startSession(currentTeamId, profile.framework);
        sessionId = session.session_id;
        console.error(`[chinwag] Session started: ${sessionId}`);
      } catch (err) {
        console.error('[chinwag] Failed to start session:', err.message);
      }

      heartbeatInterval = setInterval(async () => {
        try {
          await team.heartbeat(currentTeamId);
        } catch (err) {
          console.error('[chinwag] Heartbeat failed:', err.message);
        }
      }, 30_000);
    } catch (err) {
      console.error(`[chinwag] Failed to join team ${currentTeamId}:`, err.message);
      currentTeamId = null;
    }
  }

  // Clean up on exit — end session then exit
  let cleaning = false;
  const cleanup = () => {
    if (cleaning) return;
    cleaning = true;
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    const done = () => process.exit(0);
    if (sessionId && currentTeamId) {
      team.endSession(currentTeamId, sessionId).catch(() => {}).finally(done);
    } else {
      done();
    }
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Create MCP server
  const server = new McpServer({
    name: 'chinwag',
    version: '0.1.0',
    instructions: `You are connected to chinwag, a team coordination system for AI coding agents.

BEFORE editing any file, call chinwag_check_conflicts to verify no other agent is working on it.
AFTER starting work on files, call chinwag_update_activity so teammates know what you're doing.
When you discover an important project fact (setup requirement, pitfall, convention, decision), call chinwag_save_memory to share it with the team.
Call chinwag_get_team_context at the start of your session to see who else is working and what they're doing.`,
  });

  registerTools(server, client, team, () => currentTeamId);
  registerResources(server, client, profile);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[chinwag] MCP server running');
}

// --- Tools ---

// Pull-on-any-call: prefix tool responses with brief team state.
// Cached to avoid doubling backend calls on every tool invocation.
let cachedContext = null;
let cachedContextAt = 0;
const CONTEXT_TTL_MS = 30_000;

async function teamPreamble(team, teamId) {
  if (!teamId) return '';
  const now = Date.now();
  if (!cachedContext || now - cachedContextAt >= CONTEXT_TTL_MS) {
    try {
      cachedContext = await team.getTeamContext(teamId);
      cachedContextAt = now;
    } catch {
      return '';
    }
  }
  const active = cachedContext.members?.filter(m => m.status === 'active') || [];
  if (active.length === 0) return '';
  const summary = active.map(m => {
    const files = m.activity?.files?.join(', ') || 'idle';
    return `${m.handle}: ${files}`;
  }).join(' | ');
  return `[Team: ${summary}]\n\n`;
}

function registerTools(server, client, team, getTeamId) {
  server.tool(
    'chinwag_join_team',
    {
      description: 'Join a chinwag team for multi-agent coordination. Agents on the same team can see what each other is working on and detect file conflicts before they happen.',
      inputSchema: z.object({
        team_id: z.string().max(30).describe('Team ID (e.g., t_a7x9k2m). Found in the .chinwag file at the repo root.'),
      }),
    },
    async ({ team_id }) => {
      try {
        await team.joinTeam(team_id);
        return { content: [{ type: 'text', text: `Joined team ${team_id}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
    }
  );

  server.tool(
    'chinwag_update_activity',
    {
      description: 'Report what files you are currently working on. Call this when you start editing files so teammates can see your activity and avoid conflicts.',
      inputSchema: z.object({
        files: z.array(z.string().max(500)).describe('File paths being modified'),
        summary: z.string().max(280).describe('Brief description, e.g. "Refactoring auth middleware"'),
      }),
    },
    async ({ files, summary }) => {
      const teamId = getTeamId();
      if (!teamId) {
        return { content: [{ type: 'text', text: 'Not in a team. Join one first with chinwag_join_team.' }], isError: true };
      }
      try {
        await team.updateActivity(teamId, files, summary);
        const preamble = await teamPreamble(team, teamId);
        return { content: [{ type: 'text', text: `${preamble}Activity updated: ${summary}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
    }
  );

  server.tool(
    'chinwag_check_conflicts',
    {
      description: 'Check if any teammate agents are working on the same files you plan to edit. Call this BEFORE starting edits on shared code to avoid merge conflicts.',
      inputSchema: z.object({
        files: z.array(z.string().max(500)).describe('File paths you plan to modify'),
      }),
    },
    async ({ files }) => {
      const teamId = getTeamId();
      if (!teamId) {
        return { content: [{ type: 'text', text: 'Not in a team.' }], isError: true };
      }
      try {
        const result = await team.checkConflicts(teamId, files);
        const preamble = await teamPreamble(team, teamId);
        if (result.conflicts.length === 0) {
          return { content: [{ type: 'text', text: `${preamble}No conflicts. Safe to proceed.` }] };
        }
        const lines = result.conflicts.map(c =>
          `⚠ ${c.owner_handle} is working on ${c.files.join(', ')} — "${c.summary}"`
        );
        return { content: [{ type: 'text', text: `${preamble}${lines.join('\n')}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
    }
  );

  server.tool(
    'chinwag_get_team_context',
    {
      description: 'Get the full state of your team: who is online, what everyone is working on, and any file overlaps. Use this to orient yourself before starting work.',
      inputSchema: z.object({}),
    },
    async () => {
      const teamId = getTeamId();
      if (!teamId) {
        return { content: [{ type: 'text', text: 'Not in a team.' }], isError: true };
      }
      try {
        const ctx = await team.getTeamContext(teamId);
        const lines = [];

        if (ctx.members.length === 0) {
          lines.push('No other agents connected.');
        } else {
          lines.push('Agents:');
          for (const m of ctx.members) {
            const activity = m.activity
              ? `working on ${m.activity.files.join(', ')} — "${m.activity.summary}"`
              : 'idle';
            lines.push(`  ${m.handle} (${m.status}): ${activity}`);
          }
        }

        if (ctx.memories && ctx.memories.length > 0) {
          lines.push('');
          lines.push('Project knowledge:');
          for (const mem of ctx.memories) {
            lines.push(`  [${mem.category}] ${mem.text}`);
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
    }
  );
  server.tool(
    'chinwag_save_memory',
    {
      description: 'Save a project fact or learning that other agents on the team should know. Use this when you discover something important about the project that would help other agents. These persist across sessions and are shared with all team agents.',
      inputSchema: z.object({
        text: z.string().max(2000).describe('The fact or learning to save. Be specific and actionable, e.g. "Tests require Redis running on port 6379" or "API docs: https://docs.stripe.com/api"'),
        category: z.enum(['gotcha', 'pattern', 'config', 'decision', 'reference']).describe('Category: "gotcha" (pitfalls), "pattern" (conventions), "config" (setup facts), "decision" (architecture), "reference" (URLs, docs, external resources)'),
      }),
    },
    async ({ text, category }) => {
      const teamId = getTeamId();
      if (!teamId) {
        return { content: [{ type: 'text', text: 'Not in a team. Join one first with chinwag_join_team.' }], isError: true };
      }
      try {
        await team.saveMemory(teamId, text, category);
        const preamble = await teamPreamble(team, teamId);
        return { content: [{ type: 'text', text: `${preamble}Memory saved [${category}]: ${text}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
    }
  );
}

// --- Resources ---

function registerResources(server, client, cachedProfile) {
  server.resource(
    'profile',
    'chinwag://profile',
    { description: 'Your agent profile — languages, frameworks, tools detected from your environment.', mimeType: 'application/json' },
    async () => ({
      contents: [{
        uri: 'chinwag://profile',
        mimeType: 'application/json',
        text: JSON.stringify(cachedProfile, null, 2),
      }],
    })
  );
}

main().catch((err) => {
  console.error('[chinwag] Fatal error:', err);
  process.exit(1);
});
