#!/usr/bin/env node

// chinwag-hook — Claude Code hook handler.
// Called by Claude Code's hook system as a shell command.
// Reads hook input from stdin (JSON), calls chinwag backend.
//
// This is NOT the MCP server — stdout is the output channel for hooks.
// stdout text becomes user-visible in the Claude Code session.
// Exit code 0 = allow, non-zero = block (for PreToolUse).

import { basename } from 'path';
import { formatWho } from './dist/utils/formatting.js';
import { formatTeamContextDisplay } from './dist/utils/display.js';
import { bootstrap } from './dist/bootstrap.js';

// --- Constants ---
const STDIN_TIMEOUT_MS = 3000;
const STDIN_MAX_BYTES = 1_000_000;

const subcommand = process.argv[2];

async function main() {
  const input = await readStdin();

  // Bootstrap: graceful degradation — exit(0) on missing config/token/team
  const ctx = await bootstrap({
    hostToolHint: 'claude-code',
    defaultTransport: 'hook',
    configMode: 'simple',
    identityMode: 'resolve',
    onMissing: 'optional',
  });
  if (!ctx || !ctx.teamId) {
    process.exit(0);
    return;
  }
  const { team, teamId, hasExactSession } = ctx;

  switch (subcommand) {
    case 'check-conflict':
      await checkConflict(team, teamId, input);
      break;
    case 'report-edit':
      await reportEdit(team, teamId, input);
      break;
    case 'session-start':
      await sessionStart(team, teamId, hasExactSession);
      break;
    default:
      console.error(`[chinwag] Unknown hook subcommand: ${subcommand}`);
      process.exit(1);
      return;
  }
}

// --- Hook handlers ---

async function checkConflict(team, teamId, input) {
  const filePath = input?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  try {
    const result = await team.checkConflicts(teamId, [filePath]);

    const issues = [];

    if (result.conflicts && result.conflicts.length > 0) {
      for (const c of result.conflicts) {
        issues.push(
          `${formatWho(c.handle, c.host_tool)} is editing ${c.files.join(', ')} — "${c.summary}"`,
        );
      }
    }

    if (result.locked && result.locked.length > 0) {
      for (const l of result.locked) {
        issues.push(`${l.file} is locked by ${formatWho(l.handle, l.host_tool)}`);
      }
    }

    if (issues.length > 0) {
      process.stdout.write(`CONFLICT: ${issues.join('; ')}\n`);
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    // Backend unreachable: allow the edit
    console.error(`[chinwag] Conflict check failed: ${err.message}`);
    process.exit(0);
  }
}

async function reportEdit(team, teamId, input) {
  const filePath = input?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  try {
    // Update current activity + record in session history (parallel)
    await Promise.all([team.reportFile(teamId, filePath), team.recordEdit(teamId, filePath)]);
  } catch (err) {
    console.error(`[chinwag] Activity report failed: ${err.message}`);
  }

  process.exit(0);
}

async function sessionStart(team, teamId, hasExactSession) {
  try {
    // Avoid creating duplicate base-ID memberships when the exact MCP session
    // has not registered its per-process agent id yet.
    if (hasExactSession) {
      await team.joinTeam(teamId, basename(process.cwd()));
    }

    const ctx = await team.getTeamContext(teamId);

    if (ctx.members && ctx.members.length > 0) {
      process.stdout.write('=== chinwag team context ===\n');
      const lines = formatTeamContextDisplay(ctx, { showInsights: true });
      for (const line of lines) {
        process.stdout.write(`${line}\n`);
      }
      process.stdout.write('===========================\n');
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
    const done = (value) => {
      if (!resolved) {
        resolved = true;
        resolve(value);
      }
    };

    const timeout = setTimeout(() => {
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      done({});
    }, STDIN_TIMEOUT_MS);

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      if (data.length > STDIN_MAX_BYTES) {
        clearTimeout(timeout);
        process.stdin.removeAllListeners('data');
        process.stdin.removeAllListeners('end');
        done({});
      }
    });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      try {
        done(JSON.parse(data));
      } catch (err) {
        // Log with context so parse failures are diagnosable — include truncated raw data
        const preview = data.length > 200 ? data.slice(0, 200) + '...' : data;
        console.error(
          `[chinwag] stdin parse failed (${data.length} bytes, subcommand=${subcommand}): ${err?.message || 'unknown error'} — data: ${preview}`,
        );
        done({});
      }
    });
  });
}

main().catch((err) => {
  console.error(`[chinwag] Hook error: ${err.message}`);
  process.exit(0); // Never block on unexpected errors
});
