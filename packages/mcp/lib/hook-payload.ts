// Hook payload parsing and normalization across host tools.
//
// Claude Code and Cursor use identical payload shapes (matcher + tool_input).
// Windsurf (Cascade Hooks) uses its own shape (tool_info + edits array) and does
// not include stdout in post_run_command. We extract a common logical shape so
// the handlers in hook.js stay host-agnostic.
//
// Docs:
//  - Claude Code: https://docs.anthropic.com/en/docs/claude-code/hooks
//  - Windsurf:    https://docs.windsurf.com/windsurf/cascade/hooks

import { getMcpToolById } from '@chinmeister/shared/tool-registry.js';

export interface HookArgs {
  subcommand: string | null;
  hostId: string;
}

/** Default exit code a pre-hook returns to block the operation. */
const DEFAULT_HOOK_BLOCK_EXIT_CODE = 1;

/**
 * Parse hook CLI args. Expected shape after cli.tsx strips the 'hook' prefix:
 *   [node, script, <subcommand>, '--tool', <hostId>?]
 *
 * Host defaults to 'claude-code' (matches DEFAULT_HOOK_HOST in the config writer,
 * which omits --tool for back-compat on the default host).
 *
 * A `--tool` with a missing or flag-like value (e.g. `--tool --other`) is
 * treated as absent so malformed hook configs degrade to the default host
 * rather than picking up a stray flag as the host id.
 */
export function parseHookArgs(argv: readonly string[]): HookArgs {
  const args = argv.slice(2);
  let hostId = 'claude-code';
  let subcommand: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--tool' || token === '--host') {
      const next = args[i + 1];
      if (typeof next === 'string' && !next.startsWith('--')) {
        hostId = next;
      }
      i++;
    } else if (subcommand === null && typeof token === 'string' && !token.startsWith('--')) {
      subcommand = token;
    }
  }

  return { subcommand, hostId };
}

/**
 * Return the exit code a pre-hook must use to block the current operation for
 * the given host. Uses the `hookBlockExitCode` field on the tool registry
 * entry if present; otherwise returns 1 (which every supported host treats as
 * "block").
 */
export function getHookBlockExitCode(hostId: string): number {
  return getMcpToolById(hostId)?.hookBlockExitCode ?? DEFAULT_HOOK_BLOCK_EXIT_CODE;
}

interface UnknownObject {
  [key: string]: unknown;
}

function asObject(value: unknown): UnknownObject {
  return value && typeof value === 'object' ? (value as UnknownObject) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function countLines(text: string | null | undefined): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return text.split('\n').length;
}

/**
 * Extract the primary file path being edited/read.
 * Returns null if the payload doesn't have one (not all events carry a file).
 */
export function extractFilePath(input: unknown, hostId: string): string | null {
  const obj = asObject(input);
  if (hostId === 'windsurf') {
    return asString(asObject(obj.tool_info).file_path);
  }
  // claude-code, cursor, and any unknown host default to Claude Code shape.
  return asString(asObject(obj.tool_input).file_path);
}

export interface EditDiff {
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Extract per-edit diff line counts from an edit/write payload.
 *
 * Returns one entry per logical edit so the caller can record one edit_count
 * increment per element. Windsurf's Cascade hook packs N edits into a single
 * `tool_info.edits[]` array — summing to a single pair silently under-reports
 * Windsurf edit counts by a factor of N while leaving lines_added/removed
 * correct, breaking any cross-tool comparison and the
 * `sessions.edit_count == COUNT(*) FROM edits` invariant.
 *
 * Claude Code: `tool_input.old_string`/`new_string` (Edit) or `tool_input.content` (Write)
 *              — always returns a single-entry array.
 * Windsurf:    `tool_info.edits[]` — one entry per array element, empty array
 *              if the payload carries no edits.
 */
export function extractEdits(input: unknown, hostId: string): EditDiff[] {
  const obj = asObject(input);

  if (hostId === 'windsurf') {
    const info = asObject(obj.tool_info);
    const edits = Array.isArray(info.edits) ? info.edits : [];
    return edits.map((raw) => {
      const edit = asObject(raw);
      return {
        linesAdded: countLines(asString(edit.new_string)),
        linesRemoved: countLines(asString(edit.old_string)),
      };
    });
  }

  // Claude Code / Cursor shape — one edit per hook invocation.
  const ti = asObject(obj.tool_input);
  const oldStr = asString(ti.old_string);
  const newStr = asString(ti.new_string);
  const content = asString(ti.content);

  if (oldStr !== null && newStr !== null) {
    return [{ linesAdded: countLines(newStr), linesRemoved: countLines(oldStr) }];
  }
  if (content !== null) {
    return [{ linesAdded: countLines(content), linesRemoved: 0 }];
  }
  return [{ linesAdded: 0, linesRemoved: 0 }];
}

/**
 * Back-compat shim: older hook consumers expect a summed pair. Internally
 * delegates to `extractEdits` and sums; kept so a half-reverted state (the
 * .ts source updated but the built dist/ still referencing the old name)
 * continues to compile while both versions settle.
 */
export function extractEditLineCounts(
  input: unknown,
  hostId: string,
): { linesAdded: number; linesRemoved: number } {
  const edits = extractEdits(input, hostId);
  return edits.reduce(
    (acc, e) => ({
      linesAdded: acc.linesAdded + e.linesAdded,
      linesRemoved: acc.linesRemoved + e.linesRemoved,
    }),
    { linesAdded: 0, linesRemoved: 0 },
  );
}

/**
 * Extract the bash command string, if the payload represents a command invocation.
 * Returns empty string (not null) for consistency with the existing handler's
 * includes() check.
 */
export function extractBashCommand(input: unknown, hostId: string): string {
  const obj = asObject(input);
  if (hostId === 'windsurf') {
    return asString(asObject(obj.tool_info).command_line) || '';
  }
  return asString(asObject(obj.tool_input).command) || '';
}

/**
 * Extract the bash command's stdout, if present in the payload.
 *
 * Windsurf's post_run_command does not include stdout, so this returns empty
 * for that host. The commit handler falls back to `git log -1 HEAD` when this
 * is empty — which is correct for Windsurf since the hook fires immediately
 * after the command completes.
 */
export function extractBashResult(input: unknown, hostId: string): string {
  if (hostId === 'windsurf') return '';

  const obj = asObject(input);
  const tr = obj.tool_result;
  if (typeof tr === 'string') return tr;
  const stdout = asObject(tr).stdout;
  if (typeof stdout === 'string') return stdout;
  return '';
}

/**
 * Whether the raw stdin string looks like it could contain a git commit.
 * Used for fast-path rejection before JSON parsing on PostToolUse/Bash floods.
 *
 * Claude Code / Cursor: command is inside tool_input.command.
 * Windsurf: command is inside tool_info.command_line.
 *
 * Both cases include the literal string "git commit" somewhere in the raw JSON,
 * so the existing `raw.includes('git commit')` fast-path works for all hosts.
 * This helper is exported for completeness and testability.
 */
export function rawLooksLikeGitCommit(raw: string): boolean {
  return typeof raw === 'string' && raw.includes('git commit');
}
