// Session tracking (observability) -- startSession, endSession, recordEdit, getSessionHistory, getEditHistory.
// Each function takes `sql` as the first parameter.

import type { DOResult, SessionInfo } from '../../types.js';
import { normalizePath } from '../../lib/text-utils.js';
import { row, rows } from '../../lib/row.js';
import { normalizeRuntimeMetadata, normalizeModelName } from './runtime.js';
import { classifyWorkType } from './analytics/outcomes.js';
import { isNoiseCommit } from './commit-noise.js';
import { HEARTBEAT_STALE_WINDOW_S, ACTIVITY_MAX_FILES, METRIC_KEYS } from '../../lib/constants.js';
import { sqlChanges, withTransaction } from '../../lib/validation.js';

/**
 * Cap on how much time between two consecutive activities rolls into
 * active_min. Anything larger is treated as idle and discarded. 60 seconds
 * is a compromise: thoughtful pauses between edits (reading, thinking,
 * reviewing agent output) count, but walking away from the keyboard does
 * not. Feed for the Focus axis in rank.ts - the whole point is to stop
 * session-open time from inflating Focus.
 */
const ACTIVE_GAP_CAP_MINUTES = 1.0;

/**
 * Bump the active session's active_min + last_active_at on every real
 * activity path (edits, tool calls, memory ops). First activity in a session
 * sets last_active_at without accruing - the pre-first-activity interval is
 * startup/planning time, not active work. Subsequent activities accrue the
 * time elapsed since the previous activity, capped at ACTIVE_GAP_CAP_MINUTES.
 */
export function bumpActiveTime(sql: SqlStorage, resolvedAgentId: string): void {
  sql.exec(
    `UPDATE sessions SET
       active_min = CASE
         WHEN last_active_at IS NULL THEN active_min
         ELSE active_min + MIN(
           (julianday('now') - julianday(last_active_at)) * 1440,
           ?
         )
       END,
       last_active_at = datetime('now')
     WHERE agent_id = ? AND ended_at IS NULL`,
    ACTIVE_GAP_CAP_MINUTES,
    resolvedAgentId,
  );
}

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
  // Read session state for outcome inference before closing. duration_min is
  // computed in SQL so all time arithmetic stays in one domain.
  const activeRows = sql
    .exec(
      `SELECT edit_count, conflicts_hit, memories_searched, outcome,
              (julianday('now') - julianday(started_at)) * 24 * 60 AS duration_min
         FROM sessions
        WHERE id = ? AND agent_id = ? AND ended_at IS NULL`,
      sessionId,
      resolvedAgentId,
    )
    .toArray();

  if (activeRows.length === 0)
    return { error: 'Session not found or not owned by this agent', code: 'NOT_FOUND' };

  const session = row(activeRows[0]);
  let outcome = session.nullableString('outcome');

  // Infer outcome only if not explicitly set via reportOutcome
  if (!outcome) {
    const editCount = session.number('edit_count');
    const conflictsHit = session.number('conflicts_hit');
    const memoriesSearched = session.number('memories_searched');
    // Duration computed server-side via julianday() so all time logic stays in
    // SQLite's domain - mixing JS Date parsing with SQLite's "YYYY-MM-DD HH:MM:SS"
    // format was brittle across timezones.
    const durationMin = session.number('duration_min');

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
  const existingOutcome = session.nullableString('outcome');
  const finalOutcome = existingOutcome || outcome;

  sql.exec(
    `UPDATE sessions SET ended_at = datetime('now'), outcome = COALESCE(outcome, ?) WHERE id = ? AND agent_id = ? AND ended_at IS NULL`,
    outcome,
    sessionId,
    resolvedAgentId,
  );
  if (sqlChanges(sql) === 0)
    return { error: 'Session not found or not owned by this agent', code: 'NOT_FOUND' };

  // Read closed session for global metrics write-through. active_min ships
  // alongside duration_min so Focus reflects actual work, not session-open
  // time. tool-call rollup is joined so Reliability can compose stuck_rate
  // with the share of tool calls that errored.
  const closedRows = sql
    .exec(
      `SELECT s.host_tool, s.agent_model, s.edit_count, s.lines_added, s.lines_removed,
        s.input_tokens, s.output_tokens, s.cache_read_tokens, s.cache_creation_tokens,
        s.got_stuck, s.memories_saved, s.memories_searched,
        s.first_edit_at, s.started_at, s.ended_at,
        COALESCE(s.active_min, 0) AS active_min,
        ROUND((julianday(s.ended_at) - julianday(s.started_at)) * 24 * 60, 2) AS duration_min,
        COALESCE((SELECT COUNT(*) FROM tool_calls WHERE session_id = s.id), 0) AS tool_call_count,
        COALESCE((SELECT SUM(is_error) FROM tool_calls WHERE session_id = s.id), 0) AS errored_tool_call_count
      FROM sessions s WHERE s.id = ?`,
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

  bumpActiveTime(sql, resolvedAgentId);

  const session = row(sessions[0]);
  const sessionId = session.string('id');
  let files = session.json<string[]>('files_touched', {
    default: [],
    context: `recordEdit session=${sessionId} files_touched`,
  });
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
    session.string('handle', { default: 'unknown' }),
    session.string('host_tool', { default: 'unknown' }),
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
  const sessionRows = sql
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

  const sessions = rows<SessionInfo>(sessionRows, (r) => ({
    owner_handle: r.string('owner_handle'),
    framework: r.string('framework'),
    host_tool: r.string('host_tool'),
    agent_surface: r.nullableString('agent_surface'),
    transport: r.nullableString('transport'),
    agent_model: r.nullableString('agent_model'),
    started_at: r.string('started_at'),
    ended_at: r.nullableString('ended_at'),
    edit_count: r.number('edit_count'),
    files_touched: r.json<string[]>('files_touched', {
      default: [],
      context: `getSessionHistory handle=${r.string('owner_handle')} files_touched`,
    }),
    conflicts_hit: r.number('conflicts_hit'),
    memories_saved: r.number('memories_saved'),
    outcome: r.nullableString('outcome'),
    outcome_summary: r.nullableString('outcome_summary'),
    lines_added: r.number('lines_added'),
    lines_removed: r.number('lines_removed'),
    duration_minutes: r.number('duration_minutes'),
  }));

  return { ok: true, sessions };
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
  if (capped.length > 0) bumpActiveTime(sql, resolvedAgentId);
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

export interface SessionsInRangeFilters {
  /** Narrow to a single host tool (canonical id, not display label). */
  hostTool?: string;
  /** Narrow to a single teammate handle. */
  handle?: string;
}

const SESSION_RANGE_LIMIT = 2000;

export function getSessionsInRange(
  sql: SqlStorage,
  fromDate: string,
  toDate: string,
  filters: SessionsInRangeFilters = {},
): SessionsInRangeResult {
  // Filters are pushed into the WHERE so the DO doesn't materialize 2000
  // rows just for the route to throw most away. Both COUNT and SELECT share
  // the same predicate so truncated/total_sessions reconcile with the list.
  const predicates: string[] = [`started_at >= ?`, `started_at < datetime(?, '+1 day')`];
  const bindings: Array<string | number> = [fromDate, toDate];
  if (filters.hostTool) {
    predicates.push(`host_tool = ?`);
    bindings.push(filters.hostTool);
  }
  if (filters.handle) {
    predicates.push(`handle = ?`);
    bindings.push(filters.handle);
  }
  const whereClause = predicates.join(' AND ');

  const countRows = sql
    .exec(`SELECT COUNT(*) AS cnt FROM sessions WHERE ${whereClause}`, ...bindings)
    .toArray();
  const totalSessions = row(countRows[0]).number('cnt');

  const sessionRows = sql
    .exec(
      `SELECT id, agent_id, handle, host_tool, agent_surface, agent_model,
              started_at, ended_at, edit_count, files_touched, conflicts_hit,
              memories_saved, outcome, outcome_summary, outcome_tags,
              lines_added, lines_removed, first_edit_at, got_stuck, memories_searched,
              input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
              commit_count, first_commit_at,
              ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60) as duration_minutes
       FROM sessions
       WHERE ${whereClause}
       ORDER BY started_at ASC
       LIMIT ?`,
      ...bindings,
      SESSION_RANGE_LIMIT,
    )
    .toArray();

  const sessions = rows<SessionRecord>(sessionRows, (r) => {
    const id = r.string('id');
    return {
      id,
      agent_id: r.string('agent_id'),
      handle: r.string('handle'),
      host_tool: r.string('host_tool'),
      agent_surface: r.nullableString('agent_surface'),
      agent_model: r.nullableString('agent_model'),
      started_at: r.string('started_at'),
      ended_at: r.nullableString('ended_at'),
      edit_count: r.number('edit_count'),
      files_touched: r.json<string[]>('files_touched', {
        default: [],
        context: `getSessionsInRange id=${id} files_touched`,
      }),
      conflicts_hit: r.number('conflicts_hit'),
      memories_saved: r.number('memories_saved'),
      outcome: r.nullableString('outcome'),
      outcome_summary: r.nullableString('outcome_summary'),
      outcome_tags: r.json<string[]>('outcome_tags', {
        default: [],
        context: `getSessionsInRange id=${id} outcome_tags`,
      }),
      lines_added: r.number('lines_added'),
      lines_removed: r.number('lines_removed'),
      duration_minutes: r.number('duration_minutes'),
      first_edit_at: r.nullableString('first_edit_at'),
      got_stuck: r.number('got_stuck'),
      memories_searched: r.number('memories_searched'),
      input_tokens: r.nullableNumber('input_tokens'),
      output_tokens: r.nullableNumber('output_tokens'),
      cache_read_tokens: r.nullableNumber('cache_read_tokens'),
      cache_creation_tokens: r.nullableNumber('cache_creation_tokens'),
      commit_count: r.number('commit_count'),
      first_commit_at: r.nullableString('first_commit_at'),
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
    const session = row(sessions[0]);
    resolvedSessionId = session.string('id');
    resolvedHandle = session.string('handle', { default: handle });
    resolvedHostTool = session.string('host_tool', { default: hostTool });
  }

  const capped = commits.slice(0, MAX_COMMITS_BATCH);
  let recorded = 0;
  let recordedSubstantive = 0;
  for (const commit of capped) {
    if (typeof commit.sha !== 'string' || !commit.sha) continue;
    const sha = commit.sha.slice(0, MAX_SHA_LENGTH).toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(sha)) continue;

    const filesChanged = Math.max(0, Number(commit.files_changed) || 0);
    const linesAdded = Math.max(0, Number(commit.lines_added) || 0);
    const linesRemoved = Math.max(0, Number(commit.lines_removed) || 0);
    const messagePreview = commit.message
      ? String(commit.message).slice(0, MAX_MESSAGE_PREVIEW_LENGTH)
      : null;
    const isNoise = isNoiseCommit({
      message: messagePreview,
      files_changed: filesChanged,
      lines_added: linesAdded,
      lines_removed: linesRemoved,
    })
      ? 1
      : 0;

    // INSERT OR IGNORE: idempotent on (session_id, sha) unique constraint
    sql.exec(
      `INSERT OR IGNORE INTO commits (id, session_id, agent_id, handle, host_tool, sha, branch, message_preview, files_changed, lines_added, lines_removed, committed_at, is_noise)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`,
      crypto.randomUUID(),
      resolvedSessionId,
      resolvedAgentId,
      resolvedHandle,
      resolvedHostTool,
      sha,
      commit.branch ? String(commit.branch).slice(0, MAX_BRANCH_LENGTH) : null,
      messagePreview,
      filesChanged,
      linesAdded,
      linesRemoved,
      commit.committed_at || null,
      isNoise,
    );

    if (sqlChanges(sql) > 0) {
      recorded++;
      if (!isNoise) recordedSubstantive++;
    }
  }

  // Session counters track substantive commits only. Noise commits stay
  // in the audit trail but don't inflate per-session aggregates or push
  // first_commit_at earlier than the first real change.
  if (recordedSubstantive > 0) {
    sql.exec(
      `UPDATE sessions SET commit_count = commit_count + ?, first_commit_at = COALESCE(first_commit_at, datetime('now')) WHERE id = ? AND agent_id = ?`,
      recordedSubstantive,
      resolvedSessionId,
      resolvedAgentId,
    );
  }

  return { ok: true, recorded };
}
