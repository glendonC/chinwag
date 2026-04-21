// Tool call analytics: frequency, errors, one-shot rate, research-to-edit ratio.

import { createLogger } from '../../../lib/logger.js';
import { RESEARCH_TOOLS, EDIT_TOOLS, sqlInList } from '@chinwag/shared/tool-call-categories.js';
import type {
  ToolCallStats,
  ToolCallFrequency,
  ToolCallErrorPattern,
  ToolCallTimeline,
} from '@chinwag/shared/contracts/analytics.js';

const log = createLogger('TeamDO.analytics');

export function queryToolCallStats(
  sql: SqlStorage,
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
    const totalsRow = sql
      .exec(
        `SELECT COUNT(*) AS total_calls,
                COALESCE(SUM(is_error), 0) AS total_errors,
                ROUND(AVG(duration_ms), 0) AS avg_duration_ms,
                COUNT(DISTINCT session_id) AS distinct_sessions
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')`,
        days,
      )
      .toArray()[0] as Record<string, unknown> | undefined;

    if (!totalsRow || (totalsRow.total_calls as number) === 0) return empty;

    const totalCalls = (totalsRow.total_calls as number) || 0;
    const totalErrors = (totalsRow.total_errors as number) || 0;
    const distinctSessions = (totalsRow.distinct_sessions as number) || 1;

    // Research-to-edit ratio. Tool lists come from the shared classifier
    // in packages/shared/tool-call-categories.ts — do not hardcode here.
    const researchList = sqlInList(RESEARCH_TOOLS);
    const editList = sqlInList(EDIT_TOOLS);
    const ratioRow = sql
      .exec(
        `SELECT
           SUM(CASE WHEN tool IN (${researchList}) THEN 1 ELSE 0 END) AS research,
           SUM(CASE WHEN tool IN (${editList}) THEN 1 ELSE 0 END) AS edits
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')`,
        days,
      )
      .toArray()[0] as Record<string, unknown> | undefined;

    const researchCount = (ratioRow?.research as number) || 0;
    const editCount = (ratioRow?.edits as number) || 0;

    // Per-tool frequency
    const freqRows = sql
      .exec(
        `SELECT tool,
                COUNT(*) AS calls,
                COALESCE(SUM(is_error), 0) AS errors,
                ROUND(AVG(duration_ms), 0) AS avg_duration_ms,
                COUNT(DISTINCT session_id) AS sessions
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')
         GROUP BY tool
         ORDER BY calls DESC
         LIMIT 25`,
        days,
      )
      .toArray();

    const frequency: ToolCallFrequency[] = freqRows.map((r) => {
      const row = r as Record<string, unknown>;
      const calls = (row.calls as number) || 0;
      const errors = (row.errors as number) || 0;
      return {
        tool: row.tool as string,
        calls,
        errors,
        error_rate: calls > 0 ? Math.round((errors / calls) * 10000) / 100 : 0,
        avg_duration_ms: (row.avg_duration_ms as number) || 0,
        sessions: (row.sessions as number) || 0,
      };
    });

    // Error patterns — most common tool+error_preview combos
    const errorRows = sql
      .exec(
        `SELECT tool, error_preview, COUNT(*) AS count
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')
           AND is_error = 1
           AND error_preview IS NOT NULL
         GROUP BY tool, error_preview
         ORDER BY count DESC
         LIMIT 15`,
        days,
      )
      .toArray();

    const error_patterns: ToolCallErrorPattern[] = errorRows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        tool: row.tool as string,
        error_preview: row.error_preview as string,
        count: (row.count as number) || 0,
      };
    });

    // Hourly activity, bucketed in the caller's local TZ.
    const hourlyRows = sql
      .exec(
        `SELECT CAST(strftime('%H', datetime(called_at, ? || ' minutes')) AS INTEGER) AS hour,
                COUNT(*) AS calls,
                COALESCE(SUM(is_error), 0) AS errors
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')
         GROUP BY hour
         ORDER BY hour`,
        tzOffsetMinutes,
        days,
      )
      .toArray();

    const hourly_activity: ToolCallTimeline[] = hourlyRows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        hour: (row.hour as number) || 0,
        calls: (row.calls as number) || 0,
        errors: (row.errors as number) || 0,
      };
    });

    // One-shot success rate: sessions where edits worked without retry cycles.
    // A retry = Edit→Bash→Edit pattern (edit, test, re-edit).
    let oneShotSessions = 0;
    let sessionsWithEdits = 0;
    try {
      const sessionCalls = sql
        .exec(
          `SELECT session_id, tool FROM tool_calls
           WHERE created_at > datetime('now', '-' || ? || ' days')
           ORDER BY session_id, called_at ASC`,
          days,
        )
        .toArray();

      const bySession = new Map<string, string[]>();
      for (const row of sessionCalls) {
        const r = row as Record<string, unknown>;
        const sid = r.session_id as string;
        if (!bySession.has(sid)) bySession.set(sid, []);
        bySession.get(sid)!.push(r.tool as string);
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
      avg_duration_ms: (totalsRow.avg_duration_ms as number) || 0,
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
