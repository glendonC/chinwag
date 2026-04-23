#!/usr/bin/env node

// chinmeister-hook — coding-tool hook handler.
// Called by the host tool's hook system as a shell command.
// Reads hook input from stdin (JSON), calls chinmeister backend.
//
// Hosts supported: claude-code (default), cursor (identical payload), windsurf
// (Cascade Hooks — different payload shape). Host is selected via --tool.
//
// This is NOT the MCP server — stdout is the output channel for hooks.
// stdout text becomes user-visible in the host session.
// Exit code 0 = allow, non-zero = block (for Pre* hooks).

import { basename } from 'path';
import { formatWho } from './dist/utils/formatting.js';
import { formatTeamContextDisplay } from './dist/utils/display.js';
import { bootstrap } from './dist/bootstrap.js';
import { createLogger } from './dist/utils/logger.js';
import { STDIN_TIMEOUT_MS, STDIN_MAX_BYTES } from './dist/constants.js';
import {
  parseHookArgs,
  extractFilePath,
  extractEdits,
  extractBashCommand,
  extractBashResult,
  rawLooksLikeGitCommit,
  getHookBlockExitCode,
} from './dist/hook-payload.js';

const log = createLogger('hook');

const { subcommand, hostId } = parseHookArgs(process.argv);

async function main() {
  // Read raw stdin first — enables fast rejection for report-commit.
  // The Bash/command PostToolUse hook fires on every command invocation
  // (~hundreds/session). For non-commit calls, we exit in <2ms by checking the
  // raw string before any JSON parsing or bootstrap (which costs ~200-300ms).
  const { raw, parsed: input } = await readStdinWithRaw();

  // Fast rejection: report-commit only cares about git commits.
  // Cost for non-commit calls: ~2ms (stdin read + string check).
  if (subcommand === 'report-commit' && !rawLooksLikeGitCommit(raw)) {
    process.exit(0);
  }

  // Bootstrap: graceful degradation — exit(0) on missing config/token/team.
  // hostToolHint drives identity and telemetry tags for multi-host sessions.
  const ctx = await bootstrap({
    hostToolHint: hostId,
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
    case 'report-read':
      await reportRead(team, teamId, input);
      break;
    case 'report-commit':
      await reportCommit(team, teamId, input);
      break;
    case 'session-start':
      await sessionStart(team, teamId, hasExactSession);
      break;
    default:
      log.error(`Unknown hook subcommand: ${subcommand}`);
      process.exit(1);
      return;
  }
}

// --- Hook handlers ---

async function checkConflict(team, teamId, input) {
  const filePath = extractFilePath(input, hostId);
  if (!filePath) process.exit(0);

  try {
    const result = await team.checkConflicts(teamId, [filePath], 'hook');

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
      // Per-host block code lives on the tool registry — Windsurf requires
      // exit 2 to block; other hosts accept any non-zero code.
      process.exit(getHookBlockExitCode(hostId));
    }

    process.exit(0);
  } catch (err) {
    // Backend unreachable: allow the edit
    log.warn(`Conflict check failed: ${err.message}`);
    process.exit(0);
  }
}

async function reportEdit(team, teamId, input) {
  const filePath = extractFilePath(input, hostId);
  if (!filePath) {
    // Silent exit used to hide capture gaps (unknown host payload shape,
    // malformed JSON, stdin cutoff). Log so operators can see *why* the
    // edit didn't land — the hook still exits 0 to avoid blocking.
    const shape = input && typeof input === 'object' ? Object.keys(input).join(',') : typeof input;
    log.warn(`report-edit: no file_path for host=${hostId} (payload keys: ${shape})`);
    process.exit(0);
  }

  // Windsurf packs N edits into one hook call; Claude Code / Cursor always one.
  // Record one edit_count increment per element so the count matches the edits
  // table. Fall back to a single zero-line edit when extraction returns empty
  // (malformed payload / unknown shape) so the hook invocation isn't lost.
  const edits = extractEdits(input, hostId);
  const editList = edits.length > 0 ? edits : [{ linesAdded: 0, linesRemoved: 0 }];

  try {
    const [, ...results] = await Promise.all([
      team.reportFile(teamId, filePath),
      ...editList.map(({ linesAdded, linesRemoved }) =>
        team.recordEdit(teamId, filePath, linesAdded, linesRemoved),
      ),
    ]);
    // recordEdit returns { ok: true, skipped: true } when there's no active
    // session for this agent. Without this warn the edit just disappears —
    // surface it so the operator knows to check session-start.
    const skipped = results.filter((r) => r && r.skipped).length;
    if (skipped > 0) {
      log.warn(
        `report-edit: ${skipped}/${editList.length} edit(s) for ${filePath} dropped — no active session for this agent`,
      );
    }
  } catch (err) {
    log.warn(`report-edit: RPC failed for host=${hostId} file=${filePath}: ${err.message}`);
  }

  process.exit(0);
}

async function reportRead(team, teamId, input) {
  const filePath = extractFilePath(input, hostId);
  if (!filePath) process.exit(0);

  try {
    await team.reportFile(teamId, filePath);
  } catch (err) {
    log.warn(`report-read: RPC failed for host=${hostId} file=${filePath}: ${err.message}`);
  }

  process.exit(0);
}

async function reportCommit(team, teamId, input) {
  const command = extractBashCommand(input, hostId);
  const resultStr = extractBashResult(input, hostId);

  // Verify the command was actually a git commit (not just mentioned in output).
  // Also skip dry-runs — they don't update HEAD, so the Windsurf fallback of
  // `git log -1 HEAD` would incorrectly report the previous commit as new.
  if (!command.includes('git commit') || command.includes('--dry-run')) {
    process.exit(0);
  }

  // Try to parse SHA from command output first (Claude Code / Cursor path).
  // Windsurf's hook payload has no stdout, so we fall through to `git log -1`.
  let shortSha = null;
  if (resultStr) {
    const shaMatch =
      resultStr.match(/\[[\w/.-]+\s+([0-9a-f]{7,40})\]/) ||
      resultStr.match(/\b([0-9a-f]{40})\b/) ||
      resultStr.match(/\b([0-9a-f]{7,12})\b/);
    if (shaMatch) shortSha = shaMatch[1];
  }

  // Extract richer commit metadata via git commands (best-effort).
  let sha = shortSha;
  let branch = null;
  let message = null;
  let filesChanged = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  let committedAt = null;

  try {
    const { execSync } = await import('child_process');
    const opts = { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] };

    // Get full SHA + branch + message + timestamp.
    // If we didn't parse a SHA from stdout (Windsurf), use HEAD — the hook
    // fires immediately after `git commit` completes, so HEAD is the commit
    // that just happened.
    const ref = shortSha || 'HEAD';
    const info = execSync(`git log -1 --format="%H%n%D%n%s%n%aI" ${ref}`, opts).trim().split('\n');

    if (info[0] && /^[0-9a-f]{40}$/.test(info[0])) sha = info[0];
    if (!sha) {
      // Nothing to report — commit might have failed or was dry-run.
      process.exit(0);
    }
    // Parse branch from ref names (e.g. "HEAD -> main, origin/main")
    const refs = info[1] || '';
    const branchMatch = refs.match(/HEAD -> ([^,]+)/);
    if (branchMatch) branch = branchMatch[1].trim();
    if (info[2]) message = info[2].slice(0, 200);
    if (info[3]) committedAt = info[3];

    // Get diff stats
    const stats = execSync(`git diff-tree --no-commit-id --numstat ${sha}`, opts).trim();
    if (stats) {
      for (const line of stats.split('\n')) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
          const added = parseInt(parts[0], 10);
          const removed = parseInt(parts[1], 10);
          if (!isNaN(added)) linesAdded += added;
          if (!isNaN(removed)) linesRemoved += removed;
          filesChanged++;
        }
      }
    }
  } catch (err) {
    // Best-effort: if git commands fail, still report what we have (if anything).
    log.warn(`Git metadata extraction failed: ${err.message}`);
  }

  if (!sha) {
    process.exit(0);
  }

  try {
    await team.recordCommits(teamId, null, [
      {
        sha,
        branch,
        message,
        files_changed: filesChanged,
        lines_added: linesAdded,
        lines_removed: linesRemoved,
        committed_at: committedAt,
      },
    ]);
  } catch (err) {
    log.warn(`Commit report failed: ${err.message}`);
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
      process.stdout.write('=== chinmeister team context ===\n');
      const lines = formatTeamContextDisplay(ctx, { showInsights: true });
      for (const line of lines) {
        process.stdout.write(`${line}\n`);
      }
      process.stdout.write('===========================\n');
    }
  } catch (err) {
    log.warn(`Context fetch failed: ${err.message}`);
  }

  process.exit(0);
}

// --- Helpers ---

/**
 * Read stdin and return both raw string and parsed JSON.
 * Raw string enables fast-path rejection (e.g. checking for "git commit")
 * before expensive JSON parsing or bootstrap.
 */
function readStdinWithRaw() {
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = (raw, parsed) => {
      if (!resolved) {
        resolved = true;
        resolve({ raw, parsed });
      }
    };

    const timeout = setTimeout(() => {
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      done(data, {});
    }, STDIN_TIMEOUT_MS);

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      if (data.length > STDIN_MAX_BYTES) {
        clearTimeout(timeout);
        process.stdin.removeAllListeners('data');
        process.stdin.removeAllListeners('end');
        done(data, {});
      }
    });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      try {
        done(data, JSON.parse(data));
      } catch (err) {
        const preview = data.length > 200 ? data.slice(0, 200) + '...' : data;
        log.warn(
          `stdin parse failed (${data.length} bytes, subcommand=${subcommand}): ${err?.message || 'unknown error'} — data: ${preview}`,
        );
        done(data, {});
      }
    });
  });
}

main().catch((err) => {
  log.error(`Hook error: ${err.message}`);
  process.exit(0); // Never block on unexpected errors
});
