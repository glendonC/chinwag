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
  const team = teamHandlers(client);

  if (currentTeamId) {
    try {
      await team.joinTeam(currentTeamId);
      console.error(`[chinwag] Auto-joined team ${currentTeamId}`);

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

  // Clean up on exit
  const cleanup = () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Create MCP server
  const server = new McpServer({
    name: 'chinwag',
    version: '0.1.0',
  });

  registerTools(server, client, team, () => currentTeamId);
  registerResources(server, client, profile);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[chinwag] MCP server running');
}

// --- Tools ---

function registerTools(server, client, team, getTeamId) {
  server.tool(
    'chinwag_join_team',
    {
      description: 'Join a chinwag team for multi-agent coordination. Agents on the same team can see what each other is working on and detect file conflicts before they happen.',
      inputSchema: z.object({
        team_id: z.string().describe('Team ID (e.g., t_a7x9k2m). Found in the .chinwag file at the repo root.'),
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
        files: z.array(z.string()).describe('File paths being modified'),
        summary: z.string().describe('Brief description, e.g. "Refactoring auth middleware"'),
      }),
    },
    async ({ files, summary }) => {
      const teamId = getTeamId();
      if (!teamId) {
        return { content: [{ type: 'text', text: 'Not in a team. Join one first with chinwag_join_team.' }], isError: true };
      }
      try {
        await team.updateActivity(teamId, files, summary);
        return { content: [{ type: 'text', text: `Activity updated: ${summary}` }] };
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
        files: z.array(z.string()).describe('File paths you plan to modify'),
      }),
    },
    async ({ files }) => {
      const teamId = getTeamId();
      if (!teamId) {
        return { content: [{ type: 'text', text: 'Not in a team.' }], isError: true };
      }
      try {
        const result = await team.checkConflicts(teamId, files);
        if (result.conflicts.length === 0) {
          return { content: [{ type: 'text', text: 'No conflicts. Safe to proceed.' }] };
        }
        const lines = result.conflicts.map(c =>
          `⚠ ${c.owner_handle} is working on ${c.files.join(', ')} — "${c.summary}"`
        );
        return { content: [{ type: 'text', text: lines.join('\n') }] };
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
        if (ctx.members.length === 0) {
          return { content: [{ type: 'text', text: 'Team is empty. No other agents connected.' }] };
        }
        const lines = ctx.members.map(m => {
          const activity = m.activity
            ? `working on ${m.activity.files.join(', ')} — "${m.activity.summary}"`
            : 'no activity reported';
          return `${m.handle} (${m.status}): ${activity}`;
        });
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
    }
  );

  // --- Dashboard ---

  server.tool(
    'chinwag_get_dashboard',
    {
      description: 'Get your agent dashboard on chinwag: profile and connected agents.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const data = await client.get('/agent/dashboard');
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
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

  server.resource(
    'dashboard',
    'chinwag://dashboard',
    { description: 'Agent dashboard — profile and connected agents.', mimeType: 'application/json' },
    async () => {
      try {
        const data = await client.get('/agent/dashboard');
        return {
          contents: [{
            uri: 'chinwag://dashboard',
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch {
        return {
          contents: [{
            uri: 'chinwag://dashboard',
            mimeType: 'application/json',
            text: JSON.stringify({ error: 'Failed to fetch dashboard' }),
          }],
        };
      }
    }
  );
}

main().catch((err) => {
  console.error('[chinwag] Fatal error:', err);
  process.exit(1);
});
