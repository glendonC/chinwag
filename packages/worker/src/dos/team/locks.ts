// Advisory file locking -- claimFiles, releaseFiles, getLockedFiles.
// Each function takes `sql` as the first parameter.
//
// Two lock shapes share the same table:
//   - concrete-path claim: `file_path` is the path, `path_glob` is NULL.
//   - glob-pattern claim:  `file_path` stores the raw glob string (so the
//     primary-key ON CONFLICT path still serialises duplicate glob claims),
//     and `path_glob` mirrors it - we read the glob via `path_glob` rather
//     than re-parsing `file_path`, and the index on `path_glob` lets
//     conflict checks filter globs from concrete paths cheaply.
//
// Conflict detection (edit of concrete file F by agent A):
//   1. Is there an exact-path lock on F held by someone else?  → blocked
//   2. Walk every other agent's glob claims and test F against each.
//      Any match → blocked, with `blocked_by_glob` identifying the pattern.
//
// Glob-vs-glob overlap is NOT detected here - two agents may hold
// overlapping glob claims simultaneously. The actual edit still blocks
// through step 2 when either agent touches a file inside the overlap,
// which is the semantic that matters in practice.

import type { LockClaim, BlockedLock, LockEntry, DOResult, DOError } from '../../types.js';
import { normalizePath } from '../../lib/text-utils.js';
import { rows } from '../../lib/row.js';
import { normalizeRuntimeMetadata } from './runtime.js';
import { HEARTBEAT_ACTIVE_WINDOW_S } from '../../lib/constants.js';
import { buildInClause, sqlChanges } from '../../lib/validation.js';
import { isGlobPattern, matchesGlob } from '../../lib/glob.js';

/**
 * Verify that `resolvedAgentId` is owned by `ownerId` in the members table.
 * Defense-in-depth: callers should already go through #withMember, but this
 * ensures ownership even if the function is called directly.
 */
function verifyOwnership(
  sql: SqlStorage,
  resolvedAgentId: string,
  ownerId: string,
): DOError | null {
  const row = sql
    .exec('SELECT owner_id FROM members WHERE agent_id = ?', resolvedAgentId)
    .toArray()[0] as { owner_id: string } | undefined;
  if (!row || row.owner_id !== ownerId) {
    return { error: 'Agent not owned by caller', code: 'NOT_OWNER' };
  }
  return null;
}

/**
 * Row shape for an active lock as stored. Keeps `locks.ts` decoupled from
 * serialisation quirks - callers can depend on these names regardless of
 * future column renames in schema.ts.
 */
interface ActiveLockRow {
  file_path: string;
  agent_id: string;
  handle: string;
  host_tool: string;
  agent_surface: string | null;
  claimed_at: string;
  path_glob: string | null;
  expires_ts: string | null;
}

/**
 * Reap rows whose `expires_ts` has passed. Called at the top of every
 * claim/release path so stale TTL entries don't linger as phantom blocks.
 * Cheap: the partial index on `expires_ts IS NOT NULL` scopes the DELETE.
 */
function reapExpiredLocks(sql: SqlStorage): void {
  sql.exec("DELETE FROM locks WHERE expires_ts IS NOT NULL AND expires_ts <= datetime('now')");
}

/** Load every glob-shaped lock except the caller's own, for conflict scans. */
function loadActiveGlobLocks(sql: SqlStorage, excludeAgentId: string): ActiveLockRow[] {
  return rows(
    sql
      .exec(
        `SELECT file_path, agent_id, handle, host_tool, agent_surface, claimed_at, path_glob, expires_ts
       FROM locks
       WHERE path_glob IS NOT NULL AND agent_id != ?`,
        excludeAgentId,
      )
      .toArray(),
    (r) => ({
      file_path: r.string('file_path'),
      agent_id: r.string('agent_id'),
      handle: r.string('handle'),
      host_tool: r.string('host_tool'),
      agent_surface: r.nullableString('agent_surface'),
      claimed_at: r.string('claimed_at'),
      path_glob: r.nullableString('path_glob'),
      expires_ts: r.nullableString('expires_ts'),
    }),
  );
}

function rowToBlocked(
  row: ActiveLockRow,
  contestedFile: string,
  blockedByGlob: string | null = null,
): BlockedLock {
  return {
    file: contestedFile,
    held_by: row.handle,
    tool: row.host_tool || 'unknown',
    host_tool: row.host_tool || 'unknown',
    agent_surface: row.agent_surface || null,
    claimed_at: row.claimed_at,
    blocked_by_glob: blockedByGlob,
  };
}

export interface ClaimOptions {
  /** Optional TTL in seconds. Omit for heartbeat-only liveness. */
  ttlSeconds?: number;
}

export function claimFiles(
  sql: SqlStorage,
  resolvedAgentId: string,
  files: string[],
  handle: string,
  runtimeOrTool: string | Record<string, unknown> | null | undefined,
  ownerId: string,
  options: ClaimOptions = {},
): DOResult<LockClaim> {
  const ownerErr = verifyOwnership(sql, resolvedAgentId, ownerId);
  if (ownerErr) return ownerErr;
  reapExpiredLocks(sql);
  const runtime = normalizeRuntimeMetadata(runtimeOrTool, resolvedAgentId);

  // Normalise concrete paths; globs are stored as-provided so the caller's
  // chosen pattern round-trips exactly. normalizePath strips leading `/`,
  // resolves `..`, and collapses `//`, which is the right behaviour for
  // concrete paths but would strip semantically meaningful `/` from a glob
  // like `**/` - keep globs untouched.
  const normalized = files.map((f) => (isGlobPattern(f) ? f : normalizePath(f)));

  // TTL timestamps are written using SQLite's `datetime(...)` modifier
  // syntax so they round-trip through the same string format as every
  // other datetime in this schema. Mixing JS `.toISOString()` (e.g.
  // "2026-04-19T21:38:39.123Z") with SQLite's "YYYY-MM-DD HH:MM:SS" is a
  // silent-bug magnet - string comparison in the reaper would always see
  // the ISO strings as greater, so expired locks would never be swept.
  const ttlSeconds = typeof options.ttlSeconds === 'number' ? options.ttlSeconds : null;

  const claimed: string[] = [];
  const blocked: BlockedLock[] = [];

  // Pre-load other agents' glob claims once per batch; concrete-path claims
  // below test every entry against this set before attempting the insert.
  // Using a single snapshot is correct inside the DO's single-writer model.
  const otherGlobs = loadActiveGlobLocks(sql, resolvedAgentId);

  for (const entry of normalized) {
    const entryIsGlob = isGlobPattern(entry);

    // Concrete-path claims additionally check against other agents' globs
    // - an edit to src/auth/tokens.ts while someone holds src/auth/** is a
    // conflict, even though no exact-path row collides.
    if (!entryIsGlob) {
      const matchingGlob = otherGlobs.find((g) => g.path_glob && matchesGlob(entry, g.path_glob));
      if (matchingGlob) {
        blocked.push(rowToBlocked(matchingGlob, entry, matchingGlob.path_glob));
        continue;
      }
    }

    // Atomic claim: insert if free, refresh (and extend TTL) if we already
    // own it, no-op if another agent holds it. The WHERE clause on the
    // ON CONFLICT branch makes ownership enforcement part of the SQL
    // constraint, so there's no TOCTOU window between checking and writing.
    //
    // expires_ts is computed in SQL via `datetime('now', '+N seconds')` so
    // it ends up in the same string format SQLite uses for every other
    // datetime column, keeping string comparisons honest. The seconds value
    // is coerced to an integer before interpolation - `ttlSeconds` is typed
    // as a number but that's a TS-only guarantee, so the coercion is the
    // actual defence against an exotic caller sneaking in a SQL fragment.
    const expiresExpr =
      ttlSeconds === null ? 'NULL' : `datetime('now', '${Math.trunc(Number(ttlSeconds))} seconds')`;
    sql.exec(
      `INSERT INTO locks (file_path, agent_id, handle, host_tool, agent_surface, claimed_at, path_glob, expires_ts)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ${expiresExpr})
       ON CONFLICT(file_path) DO UPDATE SET
         handle = excluded.handle,
         host_tool = excluded.host_tool,
         agent_surface = excluded.agent_surface,
         claimed_at = datetime('now'),
         expires_ts = excluded.expires_ts
       WHERE locks.agent_id = excluded.agent_id`,
      entry,
      resolvedAgentId,
      handle || 'unknown',
      runtime.hostTool,
      runtime.agentSurface,
      entryIsGlob ? entry : null,
    );

    const changed = sqlChanges(sql);
    if (changed === 0) {
      // Lock held by another agent - fetch their details for the response.
      const row = sql
        .exec(
          'SELECT file_path, agent_id, handle, host_tool, agent_surface, claimed_at, path_glob, expires_ts FROM locks WHERE file_path = ?',
          entry,
        )
        .toArray()[0] as ActiveLockRow | undefined;
      if (row) {
        blocked.push(rowToBlocked(row, entry, row.path_glob));
      }
    } else {
      claimed.push(entry);
    }
  }

  return { ok: true, claimed, blocked };
}

/**
 * Read-only conflict check for a batch of paths. Designed for the future
 * pre-commit hook (Port #5) and other would-be-editor queries: answers
 * "would editing these files right now conflict with any lock not owned by
 * `resolvedAgentId`?" without writing anything.
 *
 * Globs in the input are ignored - this is a concrete-path check. Callers
 * asking about scopes should use `claimFiles` directly (it both checks and
 * claims atomically).
 */
export function checkFileConflicts(
  sql: SqlStorage,
  resolvedAgentId: string,
  files: string[],
): BlockedLock[] {
  reapExpiredLocks(sql);
  const normalized = files.filter((f) => !isGlobPattern(f)).map(normalizePath);
  if (normalized.length === 0) return [];

  const blocked: BlockedLock[] = [];

  // Exact-path conflicts
  const placeholders = normalized.map(() => '?').join(',');
  const exact = rows(
    sql
      .exec(
        `SELECT file_path, agent_id, handle, host_tool, agent_surface, claimed_at, path_glob, expires_ts
       FROM locks
       WHERE file_path IN (${placeholders}) AND agent_id != ? AND path_glob IS NULL`,
        ...normalized,
        resolvedAgentId,
      )
      .toArray(),
    (r) => ({
      file_path: r.string('file_path'),
      agent_id: r.string('agent_id'),
      handle: r.string('handle'),
      host_tool: r.string('host_tool'),
      agent_surface: r.nullableString('agent_surface'),
      claimed_at: r.string('claimed_at'),
      path_glob: r.nullableString('path_glob'),
      expires_ts: r.nullableString('expires_ts'),
    }),
  );
  for (const lockRow of exact) {
    blocked.push(rowToBlocked(lockRow, lockRow.file_path, null));
  }

  // Glob-umbrella conflicts
  const otherGlobs = loadActiveGlobLocks(sql, resolvedAgentId);
  for (const file of normalized) {
    for (const g of otherGlobs) {
      if (g.path_glob && matchesGlob(file, g.path_glob)) {
        blocked.push(rowToBlocked(g, file, g.path_glob));
      }
    }
  }

  return blocked;
}

export function releaseFiles(
  sql: SqlStorage,
  resolvedAgentId: string,
  files: string[] | null | undefined,
  ownerId?: string | null,
): DOResult<{ ok: true }> {
  // Ownership check is optional: webSocketClose releases locks without an ownerId
  // (the agent is already authenticated via WS tags). RPC callers pass ownerId.
  if (ownerId) {
    const ownerErr = verifyOwnership(sql, resolvedAgentId, ownerId);
    if (ownerErr) return ownerErr;
  }
  reapExpiredLocks(sql);
  if (!files || files.length === 0) {
    // Release all locks for this agent
    sql.exec('DELETE FROM locks WHERE agent_id = ?', resolvedAgentId);
  } else {
    // Release by exact key - globs are stored under their own pattern string
    // as the `file_path` key, so the same DELETE handles both shapes.
    const normalized = files.map((f) => (isGlobPattern(f) ? f : normalizePath(f)));
    for (const file of normalized) {
      sql.exec('DELETE FROM locks WHERE file_path = ? AND agent_id = ?', file, resolvedAgentId);
    }
  }
  return { ok: true };
}

export function getLockedFiles(
  sql: SqlStorage,
  connectedAgentIds: Set<string> = new Set(),
): { ok: true; locks: LockEntry[] } {
  reapExpiredLocks(sql);
  const ws = buildInClause([...connectedAgentIds]);

  const locks = rows(
    sql
      .exec(
        `SELECT l.file_path, l.agent_id, l.handle, l.host_tool, l.agent_surface, l.claimed_at,
            l.path_glob, l.expires_ts,
            ROUND((julianday('now') - julianday(l.claimed_at)) * 1440) as minutes_held
     FROM locks l
     JOIN members m ON m.agent_id = l.agent_id
     WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')
        OR m.agent_id IN (${ws.sql})
     ORDER BY l.claimed_at DESC`,
        HEARTBEAT_ACTIVE_WINDOW_S,
        ...ws.params,
      )
      .toArray(),
    (r) => ({
      file_path: r.string('file_path'),
      agent_id: r.string('agent_id'),
      handle: r.string('handle'),
      host_tool: r.string('host_tool'),
      agent_surface: r.nullableString('agent_surface'),
      claimed_at: r.string('claimed_at'),
      minutes_held: r.number('minutes_held'),
      path_glob: r.nullableString('path_glob'),
      expires_ts: r.nullableString('expires_ts'),
    }),
  );

  return { ok: true, locks };
}
