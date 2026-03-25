// MCP tool and resource registration.
// All 10 chinwag tools + 1 resource, extracted from index.js.

import { z } from 'zod';
import {
  refreshContext,
  teamPreamble,
  offlinePrefix,
  getCachedContext,
  clearContextCache,
} from './context.js';

// --- Helpers ---

function noTeam() {
  return { content: [{ type: 'text', text: 'Not in a team. Join one first with chinwag_join_team.' }], isError: true };
}

function errorResult(err) {
  const msg = err.status === 401
    ? 'Authentication expired. Please restart your editor to reconnect.'
    : err.message;
  return { content: [{ type: 'text', text: msg }], isError: true };
}

// --- Tools ---

export function registerTools(server, { team, state, profile }) {
  server.tool(
    'chinwag_join_team',
    {
      description: 'Join a chinwag team for multi-agent coordination. Agents on the same team can see what each other is working on and detect file conflicts before they happen.',
      inputSchema: z.object({
        team_id: z.string().max(30).regex(/^[a-zA-Z0-9_-]+$/).describe('Team ID (e.g., t_a7x9k2m). Found in the .chinwag file at the repo root.'),
      }),
    },
    async ({ team_id }) => {
      try {
        await team.joinTeam(team_id);
        state.teamId = team_id;
        clearContextCache();

        if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
        state.heartbeatInterval = setInterval(async () => {
          try { await team.heartbeat(state.teamId); } catch (err) {
            console.error('[chinwag] Heartbeat failed:', err.message);
          }
        }, 30_000);

        try {
          const session = await team.startSession(state.teamId, profile.framework);
          if (session?.session_id) state.sessionId = session.session_id;
        } catch {}

        return { content: [{ type: 'text', text: `Joined team ${team_id}. Session started.` }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    'chinwag_update_activity',
    {
      description: 'Report what files you are currently working on. IMPORTANT: Call this immediately after chinwag_claim_files to broadcast your activity. Other agents across all tools will see this in their team context.',
      inputSchema: z.object({
        files: z.array(z.string().max(500)).max(100).describe('File paths being modified'),
        summary: z.string().max(280).describe('Brief description, e.g. "Refactoring auth middleware"'),
      }),
    },
    async ({ files, summary }) => {
      if (!state.teamId) return noTeam();
      try {
        await team.updateActivity(state.teamId, files, summary);
        const preamble = await teamPreamble(team, state.teamId);
        return { content: [{ type: 'text', text: `${preamble}Activity updated: ${summary}` }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    'chinwag_check_conflicts',
    {
      description: 'Check if any teammate agents are working on the same files you plan to edit. Call this BEFORE starting edits on shared code to avoid merge conflicts.',
      inputSchema: z.object({
        files: z.array(z.string().max(500)).max(100).describe('File paths you plan to modify'),
      }),
    },
    async ({ files }) => {
      if (!state.teamId) return noTeam();
      try {
        const result = await team.checkConflicts(state.teamId, files);
        const preamble = await teamPreamble(team, state.teamId);
        const lines = [];
        if (result.conflicts?.length > 0) {
          for (const c of result.conflicts) {
            const who = c.tool && c.tool !== 'unknown' ? `${c.owner_handle} (${c.tool})` : c.owner_handle;
            lines.push(`⚠ ${who} is working on ${c.files.join(', ')} — "${c.summary}"`);
          }
        }
        if (result.locked?.length > 0) {
          for (const l of result.locked) {
            const who = l.tool && l.tool !== 'unknown' ? `${l.held_by} (${l.tool})` : l.held_by;
            lines.push(`🔒 ${l.file} is locked by ${who}`);
          }
        }
        if (lines.length === 0) {
          return { content: [{ type: 'text', text: `${preamble}No conflicts. Safe to proceed.` }] };
        }
        return { content: [{ type: 'text', text: `${preamble}${lines.join('\n')}` }] };
      } catch (err) {
        if (err.status === 401) return errorResult(err);
        // Offline fallback: check cached context for potential conflicts
        const cached = getCachedContext();
        if (cached?.members) {
          const myFiles = new Set(files);
          const warnings = [];
          for (const m of cached.members) {
            if (m.status !== 'active' || !m.activity?.files) continue;
            const overlap = m.activity.files.filter(f => myFiles.has(f));
            if (overlap.length > 0) {
              const who = m.tool && m.tool !== 'unknown' ? `${m.handle} (${m.tool})` : m.handle;
              warnings.push(`⚠ ${who} was working on ${overlap.join(', ')} (cached)`);
            }
          }
          if (warnings.length > 0) {
            return { content: [{ type: 'text', text: `[offline — cached check]\n${warnings.join('\n')}` }] };
          }
          return { content: [{ type: 'text', text: '[offline] No cached conflicts. Proceed with caution.' }] };
        }
        return { content: [{ type: 'text', text: '[offline] Could not check conflicts. Proceed with caution.' }] };
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
      if (!state.teamId) return noTeam();
      const ctx = await refreshContext(team, state.teamId);
      if (!ctx) {
        return { content: [{ type: 'text', text: 'No team context available (API unreachable, no cached data).' }], isError: true };
      }

      const lines = [];
      if (offlinePrefix()) lines.push('[offline — showing cached data]');

      if (!ctx.members || ctx.members.length === 0) {
        lines.push('No other agents connected.');
      } else {
        lines.push('Agents:');
        for (const m of ctx.members) {
          const toolInfo = m.tool && m.tool !== 'unknown' ? `, ${m.tool}` : '';
          const activity = m.activity
            ? `working on ${m.activity.files.join(', ')}${m.activity.summary ? ` — "${m.activity.summary}"` : ''}`
            : 'idle';
          lines.push(`  ${m.handle} (${m.status}${toolInfo}): ${activity}`);
        }
      }

      if (ctx.locks && ctx.locks.length > 0) {
        lines.push('');
        lines.push('Locked files:');
        for (const l of ctx.locks) {
          const who = l.tool && l.tool !== 'unknown' ? `${l.owner_handle} (${l.tool})` : l.owner_handle;
          lines.push(`  ${l.file_path} — ${who} (${Math.round(l.minutes_held)}m)`);
        }
      }

      if (ctx.messages && ctx.messages.length > 0) {
        lines.push('');
        lines.push('Messages:');
        for (const msg of ctx.messages) {
          const from = msg.from_tool && msg.from_tool !== 'unknown' ? `${msg.from_handle} (${msg.from_tool})` : msg.from_handle;
          lines.push(`  ${from}: ${msg.text}`);
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
      if (!state.teamId) return noTeam();
      try {
        await team.saveMemory(state.teamId, text, category);
        const preamble = await teamPreamble(team, state.teamId);
        return { content: [{ type: 'text', text: `${preamble}Memory saved [${category}]: ${text}` }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    'chinwag_search_memory',
    {
      description: 'Search team project memories by keyword and/or category. Use this to find specific knowledge the team has saved, like setup requirements, conventions, or past decisions.',
      inputSchema: z.object({
        query: z.string().max(200).optional().describe('Search text (matches against memory content)'),
        category: z.enum(['gotcha', 'pattern', 'config', 'decision', 'reference']).optional().describe('Filter by category'),
        limit: z.number().min(1).max(50).optional().describe('Max results (default 20)'),
      }),
    },
    async ({ query, category, limit }) => {
      if (!state.teamId) return noTeam();
      try {
        const result = await team.searchMemories(state.teamId, query, category, limit);
        if (!result.memories || result.memories.length === 0) {
          return { content: [{ type: 'text', text: 'No memories found.' }] };
        }
        const lines = result.memories.map(m =>
          `[${m.category}] ${m.text} (id: ${m.id}, by ${m.source_handle})`
        );
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    'chinwag_delete_memory',
    {
      description: 'Delete a team memory by ID. Use chinwag_search_memory first to find the ID of the memory to delete. Use this to remove outdated, incorrect, or redundant knowledge.',
      inputSchema: z.object({
        id: z.string().describe('Memory ID to delete (UUID format, get from chinwag_search_memory)'),
      }),
    },
    async ({ id }) => {
      if (!state.teamId) return noTeam();
      try {
        const result = await team.deleteMemory(state.teamId, id);
        if (result.error) {
          return { content: [{ type: 'text', text: `Failed to delete memory ${id}: ${result.error}` }], isError: true };
        }
        return { content: [{ type: 'text', text: `Memory ${id} deleted.` }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    'chinwag_claim_files',
    {
      description: 'Claim advisory locks on files you are about to edit. Other agents will be warned if they try to edit locked files. Locks auto-release when your session ends or you stop heartbeating.',
      inputSchema: z.object({
        files: z.array(z.string().max(500)).max(20).describe('File paths to claim'),
      }),
    },
    async ({ files }) => {
      if (!state.teamId) return noTeam();
      try {
        const result = await team.claimFiles(state.teamId, files);
        const preamble = await teamPreamble(team, state.teamId);
        const lines = [];
        if (result.claimed?.length > 0) lines.push(`Claimed: ${result.claimed.join(', ')}`);
        if (result.blocked?.length > 0) {
          for (const b of result.blocked) {
            const who = b.tool !== 'unknown' ? `${b.held_by} (${b.tool})` : b.held_by;
            lines.push(`Blocked: ${b.file} — held by ${who}`);
          }
        }
        return { content: [{ type: 'text', text: `${preamble}${lines.join('\n')}` }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    'chinwag_release_files',
    {
      description: 'Release advisory locks on files you previously claimed. Call this when you are done editing files so other agents can work on them.',
      inputSchema: z.object({
        files: z.array(z.string().max(500)).max(20).optional().describe('File paths to release (omit to release all your locks)'),
      }),
    },
    async ({ files }) => {
      if (!state.teamId) return noTeam();
      try {
        await team.releaseFiles(state.teamId, files);
        const msg = files ? `Released: ${files.join(', ')}` : 'All locks released.';
        return { content: [{ type: 'text', text: msg }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    'chinwag_send_message',
    {
      description: 'Send a message to other agents on the team. Messages are ephemeral (auto-expire after 1 hour). Use this to coordinate with other agents — e.g. "I just refactored auth.js, rebase before editing" or "Need help with failing tests in api/".',
      inputSchema: z.object({
        text: z.string().max(500).describe('Message text'),
        target: z.string().max(60).optional().describe('Target agent_id for a direct message (omit to broadcast to all)'),
      }),
    },
    async ({ text, target }) => {
      if (!state.teamId) return noTeam();
      try {
        await team.sendMessage(state.teamId, text, target);
        const dest = target ? `to ${target}` : 'to team';
        return { content: [{ type: 'text', text: `Message sent ${dest}: ${text}` }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}

// --- Resources ---

export function registerResources(server, profile) {
  server.resource(
    'profile',
    'chinwag://profile',
    { description: 'Your agent profile — languages, frameworks, tools detected from your environment.', mimeType: 'application/json' },
    async () => ({
      contents: [{
        uri: 'chinwag://profile',
        mimeType: 'application/json',
        text: JSON.stringify(profile, null, 2),
      }],
    })
  );
}
