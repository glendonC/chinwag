#!/usr/bin/env node

// chinwag-hook — Claude Code hook handler.
// Called by Claude Code's hook system as a shell command.
// Reads hook input from stdin (JSON), calls chinwag backend.
//
// This is NOT the MCP server — stdout is the output channel for hooks.
// stdout text becomes user-visible in the Claude Code session.
// Exit code 0 = allow, non-zero = block (for PreToolUse).

import { basename } from 'path';
import { loadConfig, configExists } from './lib/config.js';
import { api } from './lib/api.js';
import { findTeamFile } from './lib/team.js';
import { resolveAgentIdentity } from './lib/lifecycle.js';

const subcommand = process.argv[2];

async function main() {
  const input = await readStdin();

  // Graceful degradation: no config or no team = allow everything
  if (!configExists()) process.exit(0);
  const config = loadConfig();
  if (!config?.token) process.exit(0);

  const teamId = findTeamFile();
  if (!teamId) process.exit(0);

  // Hooks are always Claude Code
  const { agentId, hasExactSession } = resolveAgentIdentity(config.token, 'claude-code');
  const client = api(config, { agentId });

  switch (subcommand) {
    case 'check-conflict':
      await checkConflict(client, teamId, input);
      break;
    case 'report-edit':
      await reportEdit(client, teamId, input);
      break;
    case 'session-start':
      await sessionStart(client, teamId, hasExactSession);
      break;
    default:
      console.error(`[chinwag] Unknown hook subcommand: ${subcommand}`);
      process.exit(1);
  }
}

// --- Hook handlers ---

async function checkConflict(client, teamId, input) {
  const filePath = input?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  try {
    const result = await client.post(`/teams/${teamId}/conflicts`, {
      files: [filePath],
    });

    const issues = [];

    if (result.conflicts && result.conflicts.length > 0) {
      for (const c of result.conflicts) {
        const who = c.tool && c.tool !== 'unknown' ? `${c.owner_handle} (${c.tool})` : c.owner_handle;
        issues.push(`${who} is editing ${c.files.join(', ')} — "${c.summary}"`);
      }
    }

    if (result.locked && result.locked.length > 0) {
      for (const l of result.locked) {
        const who = l.tool && l.tool !== 'unknown' ? `${l.held_by} (${l.tool})` : l.held_by;
        issues.push(`${l.file} is locked by ${who}`);
      }
    }

    if (issues.length > 0) {
      console.log(`CONFLICT: ${issues.join('; ')}`);
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    // Backend unreachable: allow the edit
    console.error(`[chinwag] Conflict check failed: ${err.message}`);
    process.exit(0);
  }
}

async function reportEdit(client, teamId, input) {
  const filePath = input?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  try {
    // Update current activity + record in session history (parallel)
    await Promise.all([
      client.post(`/teams/${teamId}/file`, { file: filePath }),
      client.post(`/teams/${teamId}/sessionedit`, { file: filePath }),
    ]);
  } catch (err) {
    console.error(`[chinwag] Activity report failed: ${err.message}`);
  }

  process.exit(0);
}

async function sessionStart(client, teamId, hasExactSession) {
  try {
    // Avoid creating duplicate base-ID memberships when the exact MCP session
    // has not registered its per-process agent id yet.
    if (hasExactSession) {
      await client.post(`/teams/${teamId}/join`, { name: basename(process.cwd()) });
    }

    const ctx = await client.get(`/teams/${teamId}/context`);

    if (ctx.members && ctx.members.length > 0) {
      console.log('=== chinwag team context ===');
      for (const m of ctx.members) {
        const toolInfo = m.tool && m.tool !== 'unknown' ? `, ${m.tool}` : '';
        const activity = m.activity
          ? `working on ${m.activity.files.join(', ')}${m.activity.summary ? ` — "${m.activity.summary}"` : ''}`
          : 'idle';
        console.log(`  ${m.handle} (${m.status}${toolInfo}): ${activity}`);
      }

      if (ctx.locks && ctx.locks.length > 0) {
        console.log('');
        console.log('Locked files:');
        for (const l of ctx.locks) {
          const who = l.tool && l.tool !== 'unknown' ? `${l.owner_handle} (${l.tool})` : l.owner_handle;
          console.log(`  ${l.file_path} — ${who} (${Math.round(l.minutes_held)}m)`);
        }
      }

      if (ctx.memories && ctx.memories.length > 0) {
        console.log('');
        console.log('Project knowledge:');
        for (const mem of ctx.memories) {
          console.log(`  [${mem.category}] ${mem.text}`);
        }
      }

      // Surface actionable insights
      const insights = [];
      for (const m of ctx.members) {
        if (m.activity?.updated_at) {
          const mins = m.minutes_since_update != null
            ? m.minutes_since_update
            : (Date.now() - new Date(m.activity.updated_at).getTime()) / 60_000;
          if (mins > 15) {
            insights.push(`${m.handle} has been on ${m.activity.files[0]} for ${Math.round(mins)} min — may need help`);
          }
        }
      }
      if (insights.length > 0) {
        console.log('');
        console.log('Insights:');
        for (const insight of insights) {
          console.log(`  ${insight}`);
        }
      }

      console.log('===========================');
    }
  } catch (err) {
    console.error(`[chinwag] Context fetch failed: ${err.message}`);
  }

  process.exit(0);
}

// --- Helpers ---

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = (value) => { if (!resolved) { resolved = true; resolve(value); } };

    const timeout = setTimeout(() => {
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      done({});
    }, 3000);

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        clearTimeout(timeout);
        process.stdin.removeAllListeners('data');
        process.stdin.removeAllListeners('end');
        done({});
      }
    });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      try { done(JSON.parse(data)); } catch { done({}); }
    });
  });
}

main().catch((err) => {
  console.error(`[chinwag] Hook error: ${err.message}`);
  process.exit(0); // Never block on unexpected errors
});
