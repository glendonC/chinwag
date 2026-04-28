// Extended analytics: prompt efficiency, hourly effectiveness, outcome tags, tool handoffs.

import { createLogger } from '../../../lib/logger.js';
import { row, rows } from '../../../lib/row.js';
import type {
  PromptEfficiencyTrend,
  HourlyEffectiveness,
  OutcomeTagCount,
  ToolHandoff,
} from '@chinmeister/shared/contracts/analytics.js';
import { type AnalyticsScope, buildScopeFilter, withScope } from './scope.js';

const log = createLogger('TeamDO.analytics');

export function queryPromptEfficiency(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
  tzOffsetMinutes: number = 0,
): PromptEfficiencyTrend[] {
  // Local-TZ spine consistent with the rest of the trend family.
  //
  // avg_turns_per_edit is nullable: NULLIF on zero edits + no outer COALESCE
  // means days with no conversation+edit activity serialize as null rather
  // than a literal 0. The downstream widget treats null as "skip this point"
  // so the sparkline tracks real behavior, not dead-day floors.
  try {
    // Scope applied to ce.handle (the conversation event's author). Filtering
    // ce in the JOIN narrows the universe; s.handle would be redundant since
    // it's joined off ce.session_id, but for correctness we filter both - a
    // shared session_id with mixed authors is rare but possible.
    const fCe = buildScopeFilter(scope, { handleColumn: 'ce.handle' });
    const fS = buildScopeFilter(scope, { handleColumn: 's.handle' });
    return rows(
      sql
        .exec(
          `WITH RECURSIVE spine(day) AS (
           SELECT date('now', ? || ' minutes', '-' || ? || ' days')
           UNION ALL
           SELECT date(day, '+1 day') FROM spine WHERE day < date('now', ? || ' minutes')
         )
         SELECT spine.day AS day,
                ROUND(
                  CAST(SUM(CASE WHEN ce.role = 'user' THEN 1 ELSE 0 END) AS REAL)
                  / NULLIF(SUM(s.edit_count), 0),
                1) AS avg_turns_per_edit,
                COUNT(DISTINCT s.id) AS sessions
         FROM spine
         LEFT JOIN conversation_events ce ON date(datetime(ce.created_at, ? || ' minutes')) = spine.day
           AND ce.created_at >= date('now', '-' || ? || ' days', '-1 day')${fCe.sql}
         LEFT JOIN sessions s ON s.id = ce.session_id
           AND s.edit_count > 0${fS.sql}
         GROUP BY spine.day
         ORDER BY spine.day ASC`,
          tzOffsetMinutes,
          days,
          tzOffsetMinutes,
          tzOffsetMinutes,
          days,
          ...fCe.params,
          ...fS.params,
        )
        .toArray(),
      (r) => ({
        day: r.string('day'),
        avg_turns_per_edit: r.nullableNumber('avg_turns_per_edit'),
        sessions: r.number('sessions'),
      }),
    );
  } catch (err) {
    log.warn(`promptEfficiency query failed: ${err}`);
    return [];
  }
}

export function queryHourlyEffectiveness(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
  tzOffsetMinutes: number = 0,
): HourlyEffectiveness[] {
  // Hour-of-day is local to the caller. With tzOffsetMinutes=0 the buckets
  // are UTC hours; with a signed offset they reflect the user's local hours.
  try {
    const { sql: q, params } = withScope(
      `SELECT
           CAST(strftime('%H', datetime(started_at, ? || ' minutes')) AS INTEGER) AS hour,
           COUNT(*) AS sessions,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate,
           ROUND(AVG(edit_count), 1) AS avg_edits
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')`,
      [tzOffsetMinutes, days],
      scope,
    );
    return rows(
      sql
        .exec(
          `${q}
         GROUP BY hour
         ORDER BY hour`,
          ...params,
        )
        .toArray(),
      (r) => ({
        hour: r.number('hour'),
        sessions: r.number('sessions'),
        completion_rate: r.number('completion_rate'),
        avg_edits: r.number('avg_edits'),
      }),
    );
  } catch (err) {
    log.warn(`hourlyEffectiveness query failed: ${err}`);
    return [];
  }
}

export function queryOutcomeTags(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): OutcomeTagCount[] {
  try {
    const { sql: q, params } = withScope(
      `SELECT
           value AS tag,
           COALESCE(outcome, 'unknown') AS outcome,
           COUNT(*) AS count
         FROM sessions, json_each(sessions.outcome_tags)
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND outcome_tags != '[]'`,
      [days],
      scope,
    );
    return rows(
      sql
        .exec(
          `${q}
         GROUP BY tag, outcome
         ORDER BY count DESC
         LIMIT 30`,
          ...params,
        )
        .toArray(),
      (r) => ({
        tag: r.string('tag'),
        outcome: r.string('outcome'),
        count: r.number('count'),
      }),
    );
  } catch (err) {
    log.warn(`outcomeTags query failed: ${err}`);
    return [];
  }
}

export function queryToolHandoffs(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): ToolHandoff[] {
  try {
    // Scope handling: a "handoff" is one user's edits picked up across tools
    // (the primary chinmeister case is a single user running Claude Code +
    // Cursor + Windsurf - same handle, different host_tools, same agent_id
    // axis). Filter both sides on the scoped handle so per-user views show
    // only that user's cross-tool transitions and team-wide views show all
    // handoffs unfiltered.
    const fA = buildScopeFilter(scope, { handleColumn: 'a.handle' });
    const fB = buildScopeFilter(scope, { handleColumn: 'b.handle' });
    // Pair aggregates: files, completion, typical gap between A's edit and B's pickup.
    const pairRows = sql
      .exec(
        `SELECT
           a.host_tool AS from_tool,
           b.host_tool AS to_tool,
           COUNT(DISTINCT a.file_path) AS file_count,
           ROUND(CAST(SUM(CASE WHEN s.outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(DISTINCT s.id), 0) * 100, 1) AS handoff_completion_rate,
           ROUND(AVG((julianday(b.created_at) - julianday(a.created_at)) * 24 * 60), 0) AS avg_gap_minutes
         FROM edits a
         JOIN edits b ON a.file_path = b.file_path
           AND b.created_at > a.created_at
           AND b.created_at < datetime(a.created_at, '+1 day')
           AND a.host_tool != b.host_tool
         JOIN sessions s ON s.id = b.session_id
         WHERE a.created_at > datetime('now', '-' || ? || ' days')${fA.sql}${fB.sql}
         GROUP BY from_tool, to_tool
         HAVING file_count >= 2
         ORDER BY file_count DESC
         LIMIT 10`,
        days,
        ...fA.params,
        ...fB.params,
      )
      .toArray();

    if (pairRows.length === 0) return [];

    const pairs = rows(
      pairRows,
      (r) =>
        ({
          from_tool: r.string('from_tool'),
          to_tool: r.string('to_tool'),
          file_count: r.number('file_count'),
          handoff_completion_rate: r.number('handoff_completion_rate'),
          avg_gap_minutes: r.number('avg_gap_minutes'),
          recent_files: [] as ToolHandoff['recent_files'],
        }) satisfies ToolHandoff,
    );

    // Per-pair recent file samples, capped at 20 per pair. Filtered to the
    // top-10 pairs so payload stays bounded.
    const pairKeys = new Set(pairs.map((p) => `${p.from_tool}:${p.to_tool}`));
    const fileRows = sql
      .exec(
        `WITH transitions AS (
           SELECT
             a.host_tool AS from_tool,
             b.host_tool AS to_tool,
             a.file_path,
             MAX(b.created_at) AS last_transition_at,
             COUNT(DISTINCT a.id) AS a_edits,
             COUNT(DISTINCT b.id) AS b_edits,
             MAX(CASE WHEN s.outcome = 'completed' THEN 1 ELSE 0 END) AS completed
           FROM edits a
           JOIN edits b ON a.file_path = b.file_path
             AND b.created_at > a.created_at
             AND b.created_at < datetime(a.created_at, '+1 day')
             AND a.host_tool != b.host_tool
           JOIN sessions s ON s.id = b.session_id
           WHERE a.created_at > datetime('now', '-' || ? || ' days')${fA.sql}${fB.sql}
           GROUP BY a.host_tool, b.host_tool, a.file_path
         ),
         ranked AS (
           SELECT
             *,
             ROW_NUMBER() OVER (
               PARTITION BY from_tool, to_tool ORDER BY last_transition_at DESC
             ) AS rn
           FROM transitions
         )
         SELECT from_tool, to_tool, file_path, last_transition_at, a_edits, b_edits, completed
         FROM ranked
         WHERE rn <= 20`,
        days,
        ...fA.params,
        ...fB.params,
      )
      .toArray();

    const byPair = new Map<string, ToolHandoff['recent_files']>();
    for (const raw of fileRows) {
      const r = row(raw);
      const key = `${r.string('from_tool')}:${r.string('to_tool')}`;
      if (!pairKeys.has(key)) continue;
      const list = byPair.get(key) ?? [];
      list.push({
        file_path: r.string('file_path'),
        last_transition_at: r.string('last_transition_at'),
        a_edits: r.number('a_edits'),
        b_edits: r.number('b_edits'),
        completed: r.bool('completed'),
      });
      byPair.set(key, list);
    }

    for (const p of pairs) {
      p.recent_files = byPair.get(`${p.from_tool}:${p.to_tool}`) ?? [];
    }

    return pairs;
  } catch (err) {
    log.warn(`toolHandoffs query failed: ${err}`);
    return [];
  }
}
