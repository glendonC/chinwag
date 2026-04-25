// Tool call analytics: frequency, errors, one-shot rate, research-to-edit ratio.

import { createLogger } from '../../../lib/logger.js';
import { RESEARCH_TOOLS, EDIT_TOOLS, sqlInList } from '@chinmeister/shared/tool-call-categories.js';
import type {
  ToolCallStats,
  ToolCallFrequency,
  ToolCallErrorPattern,
  ToolCallTimeline,
} from '@chinmeister/shared/contracts/analytics.js';
import { row, rows } from '../../../lib/row.js';
import { type AnalyticsScope, withScope } from './scope.js';

const log = createLogger('TeamDO.analytics');

export function queryToolCallStats(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
  tzOffsetMinutes: number = 0,
): ToolCallStats {
  const empty: ToolCallStats = {
    total_calls: 0,
    total_errors: 0,
    error_rate: 0,
    avg_duration_ms: 0,
    calls_per_session: 0,
    research_to_edit_ratio: 0,
    one_shot_rate: 0,
    one_shot_sessions: 0,
    frequency: [],
    error_patterns: [],
    hourly_activity: [],
  };

  try {
    // Totals
    const { sql: totalsQ, params: totalsP } = withScope(
      `SELECT COUNT(*) AS total_calls,
                COALESCE(SUM(is_error), 0) AS total_errors,
                ROUND(AVG(duration_ms), 0) AS avg_duration_ms,
                COUNT(DISTINCT session_id) AS distinct_sessions
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')`,
      [days],
      scope,
    );
    const totalsRow = row(sql.exec(totalsQ, ...totalsP).toArray()[0]);

    if (totalsRow.number('total_calls') === 0) return empty;

    const totalCalls = totalsRow.number('total_calls');
    const totalErrors = totalsRow.number('total_errors');
    const distinctSessions = totalsRow.number('distinct_sessions') || 1;

    // Research-to-edit ratio. Tool lists come from the shared classifier
    // in packages/shared/tool-call-categories.ts — do not hardcode here.
    const researchList = sqlInList(RESEARCH_TOOLS);
    const editList = sqlInList(EDIT_TOOLS);
    const { sql: ratioQ, params: ratioP } = withScope(
      `SELECT
           SUM(CASE WHEN tool IN (${researchList}) THEN 1 ELSE 0 END) AS research,
           SUM(CASE WHEN tool IN (${editList}) THEN 1 ELSE 0 END) AS edits
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')`,
      [days],
      scope,
    );
    const ratioRow = row(sql.exec(ratioQ, ...ratioP).toArray()[0]);

    const researchCount = ratioRow.number('research');
    const editCount = ratioRow.number('edits');

    // Per-tool frequency
    const { sql: freqQ, params: freqP } = withScope(
      `SELECT tool,
                COUNT(*) AS calls,
                COALESCE(SUM(is_error), 0) AS errors,
                ROUND(AVG(duration_ms), 0) AS avg_duration_ms,
                COUNT(DISTINCT session_id) AS sessions
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')`,
      [days],
      scope,
    );
    const freqRows = sql
      .exec(
        `${freqQ}
         GROUP BY tool
         ORDER BY calls DESC
         LIMIT 25`,
        ...freqP,
      )
      .toArray();

    const frequency: ToolCallFrequency[] = rows<ToolCallFrequency>(freqRows, (r) => {
      const calls = r.number('calls');
      const errors = r.number('errors');
      return {
        tool: r.string('tool'),
        calls,
        errors,
        error_rate: calls > 0 ? Math.round((errors / calls) * 10000) / 100 : 0,
        avg_duration_ms: r.number('avg_duration_ms'),
        sessions: r.number('sessions'),
      };
    });

    // Error patterns — most common tool+error_preview combos, with the
    // MAX(called_at) so the frontend can render a two-pane view: "most
    // frequent" and "most recent." A top-N-by-count ordering alone buries
    // rare-but-recent errors under high-count historical ones.
    const { sql: errQ, params: errP } = withScope(
      `SELECT tool, error_preview, COUNT(*) AS count, MAX(called_at) AS last_at
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')
           AND is_error = 1
           AND error_preview IS NOT NULL`,
      [days],
      scope,
    );
    const errorRows = sql
      .exec(
        `${errQ}
         GROUP BY tool, error_preview
         ORDER BY count DESC
         LIMIT 30`,
        ...errP,
      )
      .toArray();

    const error_patterns: ToolCallErrorPattern[] = rows<ToolCallErrorPattern>(errorRows, (r) => ({
      tool: r.string('tool'),
      error_preview: r.string('error_preview'),
      count: r.number('count'),
      last_at: r.nullableString('last_at'),
    }));

    // Hourly activity, bucketed in the caller's local TZ.
    const { sql: hourlyQ, params: hourlyP } = withScope(
      `SELECT CAST(strftime('%H', datetime(called_at, ? || ' minutes')) AS INTEGER) AS hour,
                COUNT(*) AS calls,
                COALESCE(SUM(is_error), 0) AS errors
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')`,
      [tzOffsetMinutes, days],
      scope,
    );
    const hourlyRows = sql
      .exec(
        `${hourlyQ}
         GROUP BY hour
         ORDER BY hour`,
        ...hourlyP,
      )
      .toArray();

    const hourly_activity: ToolCallTimeline[] = rows<ToolCallTimeline>(hourlyRows, (r) => ({
      hour: r.number('hour'),
      calls: r.number('calls'),
      errors: r.number('errors'),
    }));

    // One-shot success rate: sessions where edits worked without retry cycles.
    // A retry = Edit→Bash→Edit pattern (edit, test, re-edit).
    let oneShotSessions = 0;
    let sessionsWithEdits = 0;
    try {
      const { sql: oneShotQ, params: oneShotP } = withScope(
        `SELECT session_id, tool FROM tool_calls
           WHERE created_at > datetime('now', '-' || ? || ' days')`,
        [days],
        scope,
      );
      const sessionCalls = sql
        .exec(
          `${oneShotQ}
           ORDER BY session_id, called_at ASC`,
          ...oneShotP,
        )
        .toArray();

      const bySession = new Map<string, string[]>();
      for (const raw of sessionCalls) {
        const r = row(raw);
        const sid = r.string('session_id');
        if (!bySession.has(sid)) bySession.set(sid, []);
        bySession.get(sid)!.push(r.string('tool'));
      }

      for (const tools of bySession.values()) {
        const hasEdit = tools.some((t) => EDIT_TOOLS.includes(t));
        if (!hasEdit) continue;
        sessionsWithEdits++;
        let sawEditBeforeBash = false;
        let sawBashAfterEdit = false;
        let retries = 0;
        for (const t of tools) {
          if (EDIT_TOOLS.includes(t)) {
            if (sawBashAfterEdit) retries++;
            sawEditBeforeBash = true;
            sawBashAfterEdit = false;
          }
          if (t === 'Bash' && sawEditBeforeBash) {
            sawBashAfterEdit = true;
          }
        }
        if (retries === 0) oneShotSessions++;
      }
    } catch {
      // Non-critical: one-shot computation is best-effort
    }

    return {
      total_calls: totalCalls,
      total_errors: totalErrors,
      error_rate: totalCalls > 0 ? Math.round((totalErrors / totalCalls) * 10000) / 100 : 0,
      avg_duration_ms: totalsRow.number('avg_duration_ms'),
      calls_per_session: Math.round((totalCalls / distinctSessions) * 10) / 10,
      research_to_edit_ratio: editCount > 0 ? Math.round((researchCount / editCount) * 10) / 10 : 0,
      one_shot_rate:
        sessionsWithEdits > 0 ? Math.round((oneShotSessions / sessionsWithEdits) * 100) : 0,
      one_shot_sessions: sessionsWithEdits,
      frequency,
      error_patterns,
      hourly_activity,
    };
  } catch (err) {
    log.warn(`toolCallStats query failed: ${err}`);
    return empty;
  }
}
