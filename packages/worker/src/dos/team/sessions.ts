// Session tracking (observability) -- startSession, endSession, recordEdit, getSessionHistory, getEditHistory.
// Each function takes `sql` as the first parameter.

import type { DOResult, SessionInfo } from '../../types.js';
import { normalizePath } from '../../lib/text-utils.js';
import { createLogger } from '../../lib/logger.js';
import { safeParse } from '../../lib/safe-parse.js';
import { normalizeRuntimeMetadata, normalizeModelName } from './runtime.js';
import { classifyWorkType } from './analytics.js';
import { HEARTBEAT_STALE_WINDOW_S, ACTIVITY_MAX_FILES, METRIC_KEYS } from '../../lib/constants.js';
import { sqlChanges, withTransaction } from '../../lib/validation.js';

const log = createLogger('TeamDO.sessions');

export function startSession(
  sql: SqlStorage,
  resolvedAgentId: string,
  handle: string,
  framework: string | null | undefined,
  runtimeOrTool: string | Record<string, unknown> | null | undefined,
  transact: <T>(fn: () => T) => T,
): DOResult<{ ok: true; session_id: string }> {
  const runtime = normalizeRuntimeMetadata(runtimeOrTool, resolvedAgentId);
  const id = crypto.randomUUID();

  // Transaction ensures old sessions are closed and the new one is created
  // atomically. Without this, closing orphans but failing the INSERT leaves
  // the agent with no session record.
  return withTransaction(transact, () => {
    sql.exec(
      `UPDATE sessions SET ended_at = datetime('now') WHERE agent_id = ? AND ended_at IS NULL`,
      resolvedAgentId,
    );
    sql.exec(
      `UPDATE sessions SET ended_at = datetime('now')
       WHERE handle = ? AND ended_at IS NULL
       AND agent_id NOT IN (
         SELECT agent_id FROM members
         WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')
       )`,
      handle,
      HEARTBEAT_STALE_WINDOW_S,
    );

    sql.exec(
      `INSERT INTO sessions (id, agent_id, handle, framework, host_tool, agent_surface, transport, agent_model, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      id,
      resolvedAgentId,
      handle,
      framework || 'unknown',
      runtime.hostTool,
      runtime.agentSurface,
      runtime.transport,
      runtime.model,
    );
    return { ok: true as const, session_id: id };
  });
}

export function enrichSessionModel(
  sql: SqlStorage,
  resolvedAgentId: string,
  model: string,
  recordMetric: (metric: string) => void,
  transact: <T>(fn: () => T) => T,
): { ok: true } {
  const normalized = normalizeModelName(model) || model;
  withTransaction(transact, () => {
    sql.exec(
      `UPDATE sessions SET agent_model = ? WHERE agent_id = ? AND ended_at IS NULL AND agent_model IS NULL`,
      normalized,
      resolvedAgentId,
    );
    sql.exec(
      `UPDATE members SET agent_model = ? WHERE agent_id = ? AND agent_model IS NULL`,
      normalized,
      resolvedAgentId,
    );
  });
  recordMetric(`${METRIC_KEYS.MODEL_PREFIX}${normalized}`);
  return { ok: true };
}

export function endSession(
  sql: SqlStorage,
  resolvedAgentId: string,
  sessionId: string,
): DOResult<{ ok: true; outcome?: string | null; summary?: Record<string, unknown> | null }> {
  // Read session state for outcome inference before closing
  const rows = sql
    .exec(
      `SELECT edit_count, conflicts_hit, memories_searched, started_at, outcome FROM sessions WHERE id = ? AND agent_id = ? AND ended_at IS NULL`,
      sessionId,
      resolvedAgentId,
    )
    .toArray();

  if (rows.length === 0)
    return { error: 'Session not found or not owned by this agent', code: 'NOT_FOUND' };

  const session = rows[0] as Record<string, unknown>;
  let outcome = session.outcome as string | null;

  // Infer outcome only if not explicitly set via reportOutcome
  if (!outcome) {
    const editCount = (session.edit_count as number) || 0;
    const conflictsHit = (session.conflicts_hit as number) || 0;
    const memoriesSearched = (session.memories_searched as number) || 0;
    const startedAt = session.started_at as string;
    // SQLite datetime: "2026-01-15 10:30:45" (space, no T) — normalize for JS Date
    const durationMin =
      (new Date().getTime() - new Date(String(startedAt).replace(' ', 'T') + 'Z').getTime()) /
      60000;

    if (editCount > 0) {
      outcome = 'completed';
    } else if (memoriesSearched > 0 && durationMin > 2) {
      // Research/exploration session: agent searched memories but made no edits
      outcome = 'completed';
    } else if (conflictsHit > 0 || durationMin > 5) {
      outcome = 'abandoned';
    }
    // else: leave null (short no-op sessions)
  }

  // Use existing outcome if already set (via reportOutcome), else use inference
  const existingOutcome = session.outcome as string | null;
  const finalOutcome = existingOutcome || outcome;

  sql.exec(
    `UPDATE sessions SET ended_at = datetime('now'), outcome = COALESCE(outcome, ?) WHERE id = ? AND agent_id = ? AND ended_at IS NULL`,
    outcome,
    sessionId,
    resolvedAgentId,
  );
  if (sqlChanges(sql) === 0)
    return { error: 'Session not found or not owned by this agent', code: 'NOT_FOUND' };

  // Read closed session for global metrics write-through
  const closedRows = sql
    .exec(
      `SELECT host_tool, agent_model, edit_count, lines_added, lines_removed,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        got_stuck, memories_saved, memories_searched,
        first_edit_at, started_at, ended_at,
        ROUND((julianday(ended_at) - julianday(started_at)) * 24 * 60, 2) AS duration_min
      FROM sessions WHERE id = ?`,
      sessionId,
    )
    .toArray();
  const summary = closedRows.length > 0 ? (closedRows[0] as Record<string, unknown>) : null;

  return { ok: true, outcome: finalOutcome, summary };
}

const VALID_OUTCOMES = new Set(['completed', 'abandoned', 'failed']);

export function reportOutcome(
  sql: SqlStorage,
  resolvedAgentId: string,
  outcome: string,
  summary: string | null,
  outcomeTags?: string[] | null,
): DOResult<{ ok: true }> {
  if (!VALID_OUTCOMES.has(outcome))
    return {
      error: `Invalid outcome: ${outcome}. Must be completed, abandoned, or failed`,
      code: 'INVALID',
    };

  const tags = Array.isArray(outcomeTags) ? JSON.stringify(outcomeTags.slice(0, 10)) : '[]';

  sql.exec(
    `UPDATE sessions SET outcome = ?, outcome_summary = ?, outcome_tags = ? WHERE agent_id = ? AND ended_at IS NULL`,
    outcome,
    summary,
    tags,
    resolvedAgentId,
  );
  if (sqlChanges(sql) === 0)
    return { error: 'No active session found for this agent', code: 'NOT_FOUND' };
  return { ok: true };
}

export function recordEdit(
  sql: SqlStorage,
  resolvedAgentId: string,
  filePath: string,
  linesAdded = 0,
  linesRemoved = 0,
): { ok: true; skipped?: boolean } {
  const normalized = normalizePath(filePath);

  // Find the active session for this agent (includes handle/host_tool for edit log)
  const sessions = sql
    .exec(
      'SELECT id, files_touched, handle, host_tool FROM sessions WHERE agent_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
      resolvedAgentId,
    )
    .toArray();

  if (sessions.length === 0) return { ok: true, skipped: true }; // No active session

  const session = sessions[0] as Record<string, unknown>;
  const sessionId = session.id as string;
  let files = safeParse(
    (session.files_touched as string) || '[]',
    `recordEdit session=${sessionId} files_touched`,
    [] as string[],
    log,
  );
  if (!files.includes(normalized)) {
    files.push(normalized);
    if (files.length > ACTIVITY_MAX_FILES) files = files.slice(-ACTIVITY_MAX_FILES);
  }

  // Accumulate into session counters + set first_edit_at on the first edit
  sql.exec(
    `UPDATE sessions SET edit_count = edit_count + 1, lines_added = lines_added + ?, lines_removed = lines_removed + ?, files_touched = ?, first_edit_at = COALESCE(first_edit_at, datetime('now')) WHERE id = ?`,
    linesAdded,
    linesRemoved,
    JSON.stringify(files),
    sessionId,
  );

  // Append to per-edit audit log with pre-computed work type
  const workType = classifyWorkType(normalized);
  sql.exec(
    `INSERT INTO edits (id, session_id, agent_id, handle, host_tool, file_path, lines_added, lines_removed, work_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    sessionId,
    resolvedAgentId,
    (session.handle as string) || 'unknown',
    (session.host_tool as string) || 'unknown',
    normalized,
    linesAdded,
    linesRemoved,
    workType,
  );

  return { ok: true };
}

export function getSessionHistory(
  sql: SqlStorage,
  days: number,
): { ok: true; sessions: SessionInfo[] } {
  const sessions = sql
    .exec(
      `SELECT handle AS owner_handle, framework, host_tool, agent_surface, transport, agent_model, started_at, ended_at,
           edit_count, files_touched, conflicts_hit, memories_saved,
           outcome, outcome_summary, lines_added, lines_removed,
           ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60) as duration_minutes
     FROM sessions
     WHERE started_at > datetime('now', '-' || ? || ' days')
     ORDER BY started_at DESC
     LIMIT 50`,
      days,
    )
    .toArray();

  return {
    ok: true,
    sessions: sessions.map((s) => {
      const row = s as Record<string, unknown>;
      return {
        ...row,
        files_touched: safeParse(
          (row.files_touched as string) || '[]',
          `getSessionHistory handle=${row.owner_handle} files_touched`,
          [] as string[],
          log,
        ),
      } as unknown as SessionInfo;
    }),
  };
}

export interface SessionRecord {
  id: string;
  agent_id: string;
  handle: string;
  host_tool: string;
  agent_surface: string | null;
  agent_model: string | null;
  started_at: string;
  ended_at: string | null;
  edit_count: number;
  files_touched: string[];
  conflicts_hit: number;
  memories_saved: number;
  outcome: string | null;
  outcome_summary: string | null;
  outcome_tags: string[];
  lines_added: number;
  lines_removed: number;
  duration_minutes: number;
  first_edit_at: string | null;
  got_stuck: number;
  memories_searched: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  commit_count: number;
  first_commit_at: string | null;
}

export function recordTokenUsage(
  sql: SqlStorage,
  resolvedAgentId: string,
  sessionId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): { ok: true } | { error: string; code: string } {
  sql.exec(
    `UPDATE sessions SET
       input_tokens = COALESCE(input_tokens, 0) + ?,
       output_tokens = COALESCE(output_tokens, 0) + ?,
       cache_read_tokens = COALESCE(cache_read_tokens, 0) + ?,
       cache_creation_tokens = COALESCE(cache_creation_tokens, 0) + ?
     WHERE id = ? AND agent_id = ?`,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    sessionId,
    resolvedAgentId,
  );
  return { ok: true };
}

const MAX_TOOL_CALLS_BATCH = 500;

export interface ToolCallInput {
  tool: string;
  at: number;
  is_error?: boolean;
  error_preview?: string;
  input_preview?: string;
  duration_ms?: number;
}

export function recordToolCalls(
  sql: SqlStorage,
  resolvedAgentId: string,
  sessionId: string,
  handle: string,
  hostTool: string,
  calls: ToolCallInput[],
): { ok: true; recorded: number } {
  const capped = calls.slice(0, MAX_TOOL_CALLS_BATCH);
  let recorded = 0;
  for (const call of capped) {
    if (typeof call.tool !== 'string' || !call.tool) continue;
    const calledAt = new Date(call.at).toISOString().replace('T', ' ').replace('Z', '');
    sql.exec(
      `INSERT INTO tool_calls (session_id, agent_id, handle, host_tool, tool, called_at, is_error, error_preview, input_preview, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sessionId,
      resolvedAgentId,
      handle,
      hostTool,
      call.tool.slice(0, 100),
      calledAt,
      call.is_error ? 1 : 0,
      call.error_preview ? String(call.error_preview).slice(0, 200) : null,
      call.input_preview ? String(call.input_preview).slice(0, 200) : null,
      typeof call.duration_ms === 'number' ? Math.max(0, Math.round(call.duration_ms)) : null,
    );
    recorded++;
  }
  return { ok: true, recorded };
}

export interface SessionsInRangeResult {
  sessions: SessionRecord[];
  truncated: boolean;
  total_sessions: number;
}

const SESSION_RANGE_LIMIT = 2000;

export function getSessionsInRange(
  sql: SqlStorage,
  fromDate: string,
  toDate: string,
): SessionsInRangeResult {
  const countRow = sql
    .exec(
      `SELECT COUNT(*) AS cnt FROM sessions
       WHERE started_at >= ? AND started_at < datetime(?, '+1 day')`,
      fromDate,
      toDate,
    )
    .toArray();
  const totalSessions = ((countRow[0] as Record<string, unknown>)?.cnt as number) ?? 0;

  const rows = sql
    .exec(
      `SELECT id, agent_id, handle, host_tool, agent_surface, agent_model,
              started_at, ended_at, edit_count, files_touched, conflicts_hit,
              memories_saved, outcome, outcome_summary, outcome_tags,
              lines_added, lines_removed, first_edit_at, got_stuck, memories_searched,
              input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
              commit_count, first_commit_at,
              ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60) as duration_minutes
       FROM sessions
       WHERE started_at >= ? AND started_at < datetime(?, '+1 day')
       ORDER BY started_at ASC
       LIMIT ?`,
      fromDate,
      toDate,
      SESSION_RANGE_LIMIT,
    )
    .toArray();

  const sessions = rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      agent_id: r.agent_id as string,
      handle: r.handle as string,
      host_tool: r.host_tool as string,
      agent_surface: (r.agent_surface as string) || null,
      agent_model: (r.agent_model as string) || null,
      started_at: r.started_at as string,
      ended_at: (r.ended_at as string) || null,
      edit_count: (r.edit_count as number) || 0,
      files_touched: safeParse(
        (r.files_touched as string) || '[]',
        `getSessionsInRange id=${r.id} files_touched`,
        [] as string[],
        log,
      ),
      conflicts_hit: (r.conflicts_hit as number) || 0,
      memories_saved: (r.memories_saved as number) || 0,
      outcome: (r.outcome as string) || null,
      outcome_summary: (r.outcome_summary as string) || null,
      outcome_tags: safeParse(
        (r.outcome_tags as string) || '[]',
        `getSessionsInRange id=${r.id} outcome_tags`,
        [] as string[],
        log,
      ),
      lines_added: (r.lines_added as number) || 0,
      lines_removed: (r.lines_removed as number) || 0,
      duration_minutes: (r.duration_minutes as number) || 0,
      first_edit_at: (r.first_edit_at as string) || null,
      got_stuck: (r.got_stuck as number) || 0,
      memories_searched: (r.memories_searched as number) || 0,
      input_tokens: (r.input_tokens as number) ?? null,
      output_tokens: (r.output_tokens as number) ?? null,
      cache_read_tokens: (r.cache_read_tokens as number) ?? null,
      cache_creation_tokens: (r.cache_creation_tokens as number) ?? null,
      commit_count: (r.commit_count as number) || 0,
      first_commit_at: (r.first_commit_at as string) || null,
    };
  });

  return {
    sessions,
    truncated: totalSessions > SESSION_RANGE_LIMIT,
    total_sessions: totalSessions,
  };
}

export interface EditEntry {
  id: string;
  session_id: string;
  handle: string;
  host_tool: string;
  file_path: string;
  lines_added: number;
  lines_removed: number;
  created_at: string;
}

export function getEditHistory(
  sql: SqlStorage,
  days: number,
  filePath: string | null = null,
  handle: string | null = null,
  limit = 200,
): { ok: true; edits: EditEntry[] } {
  const conditions = ["created_at > datetime('now', '-' || ? || ' days')"];
  const params: (string | number)[] = [days];

  if (filePath) {
    conditions.push('file_path = ?');
    params.push(normalizePath(filePath));
  }
  if (handle) {
    conditions.push('handle = ?');
    params.push(handle);
  }

  params.push(Math.min(limit, 500));

  const edits = sql
    .exec(
      `SELECT id, session_id, handle, host_tool, file_path, lines_added, lines_removed, created_at
       FROM edits
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ?`,
      ...params,
    )
    .toArray() as unknown as EditEntry[];

  return { ok: true, edits };
}

// -- Commit recording --

const MAX_COMMITS_BATCH = 50;
const MAX_SHA_LENGTH = 40;
const MAX_BRANCH_LENGTH = 200;
const MAX_MESSAGE_PREVIEW_LENGTH = 200;

export interface CommitInput {
  sha: string;
  branch?: string | null;
  message?: string | null;
  files_changed?: number;
  lines_added?: number;
  lines_removed?: number;
  committed_at?: string | null;
}

export function recordCommits(
  sql: SqlStorage,
  resolvedAgentId: string,
  sessionId: string | null,
  handle: string,
  hostTool: string,
  commits: CommitInput[],
): { ok: true; recorded: number } {
  // Resolve session: use provided sessionId or find the active session (like recordEdit)
  let resolvedSessionId = sessionId;
  let resolvedHandle = handle;
  let resolvedHostTool = hostTool;

  if (!resolvedSessionId) {
    const sessions = sql
      .exec(
        'SELECT id, handle, host_tool FROM sessions WHERE agent_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
        resolvedAgentId,
      )
      .toArray();
    if (sessions.length === 0) return { ok: true, recorded: 0 };
    const session = sessions[0] as Record<string, unknown>;
    resolvedSessionId = session.id as string;
    resolvedHandle = (session.handle as string) || handle;
    resolvedHostTool = (session.host_tool as string) || hostTool;
  }

  const capped = commits.slice(0, MAX_COMMITS_BATCH);
  let recorded = 0;
  for (const commit of capped) {
    if (typeof commit.sha !== 'string' || !commit.sha) continue;
    const sha = commit.sha.slice(0, MAX_SHA_LENGTH).toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(sha)) continue;

    // INSERT OR IGNORE: idempotent on (session_id, sha) unique constraint
    sql.exec(
      `INSERT OR IGNORE INTO commits (id, session_id, agent_id, handle, host_tool, sha, branch, message_preview, files_changed, lines_added, lines_removed, committed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
      crypto.randomUUID(),
      resolvedSessionId,
      resolvedAgentId,
      resolvedHandle,
      resolvedHostTool,
      sha,
      commit.branch ? String(commit.branch).slice(0, MAX_BRANCH_LENGTH) : null,
      commit.message ? String(commit.message).slice(0, MAX_MESSAGE_PREVIEW_LENGTH) : null,
      Math.max(0, Number(commit.files_changed) || 0),
      Math.max(0, Number(commit.lines_added) || 0),
      Math.max(0, Number(commit.lines_removed) || 0),
      commit.committed_at || null,
    );

    if (sqlChanges(sql) > 0) recorded++;
  }

  // Update session counters
  if (recorded > 0) {
    sql.exec(
      `UPDATE sessions SET commit_count = commit_count + ?, first_commit_at = COALESCE(first_commit_at, datetime('now')) WHERE id = ? AND agent_id = ?`,
      recorded,
      resolvedSessionId,
      resolvedAgentId,
    );
  }

  return { ok: true, recorded };
}
