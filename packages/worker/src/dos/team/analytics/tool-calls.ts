// Tool call analytics: frequency, errors, one-shot rate, research-to-edit ratio.

import { createLogger } from '../../../lib/logger.js';
import { RESEARCH_TOOLS, EDIT_TOOLS, sqlInList } from '@chinmeister/shared/tool-call-categories.js';
import type {
  ToolCallStats,
  ToolCallFrequency,
  ToolCallErrorPattern,
  ToolCallTimeline,
  HostToolOneShot,
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
    host_one_shot: [],
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
    // in packages/shared/tool-call-categories.ts - do not hardcode here.
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

    // Error patterns - most common tool+error_preview combos, with the
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
    //
    // Computed twice in one pass: aggregate over all sessions (the existing
    // ToolCallStats.one_shot_rate) AND sliced by host_tool (the new per-tool
    // one_shot_rate that lands on each ToolCallFrequency row). The slice
    // attributes each session to its dominant host_tool - sessions are
    // single-tool by construction in chinmeister's session model, so the
    // attribution is the host_tool of the tool_calls rows. We pull host_tool
    // alongside tool and bucket by it.
    let oneShotSessions = 0;
    let sessionsWithEdits = 0;
    const perToolOneShot = new Map<string, { oneShot: number; withEdits: number }>();
    try {
      const { sql: oneShotQ, params: oneShotP } = withScope(
        `SELECT session_id, tool, host_tool FROM tool_calls
           WHERE called_at > datetime('now', '-' || ? || ' days')`,
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

      const bySession = new Map<string, { tools: string[]; hostTool: string }>();
      for (const raw of sessionCalls) {
        const r = row(raw);
        const sid = r.string('session_id');
        const entry = bySession.get(sid) ?? { tools: [], hostTool: r.string('host_tool') };
        entry.tools.push(r.string('tool'));
        // Lock the session's host_tool to the first non-unknown row we see -
        // a session's tool_calls all come from the same host process.
        if (entry.hostTool === 'unknown') entry.hostTool = r.string('host_tool');
        bySession.set(sid, entry);
      }

      for (const { tools, hostTool } of bySession.values()) {
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
        const isOneShot = retries === 0;
        if (isOneShot) oneShotSessions++;

        // Per-tool slice. Skip 'unknown' - those rows pre-date the host_tool
        // column being populated and would render as a phantom tool in the UI.
        if (hostTool && hostTool !== 'unknown') {
          const bucket = perToolOneShot.get(hostTool) ?? { oneShot: 0, withEdits: 0 };
          bucket.withEdits++;
          if (isOneShot) bucket.oneShot++;
          perToolOneShot.set(hostTool, bucket);
        }
      }
    } catch {
      // Non-critical: one-shot computation is best-effort
    }

    // Materialize per-host-tool one-shot rows. Different axis from
    // `frequency` (which keys on tool-call name like Edit/Bash); these key
    // on host_tool (claude-code/cursor/...). Sort by sessions DESC so the
    // widget's natural order matches the tool comparison list.
    const host_one_shot: HostToolOneShot[] = Array.from(perToolOneShot.entries())
      .map(([host_tool, b]) => ({
        host_tool,
        one_shot_rate: b.withEdits > 0 ? Math.round((b.oneShot / b.withEdits) * 100) : 0,
        sessions: b.withEdits,
      }))
      .sort((a, b) => b.sessions - a.sessions);

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
      host_one_shot,
    };
  } catch (err) {
    log.warn(`toolCallStats query failed: ${err}`);
    return empty;
  }
}
