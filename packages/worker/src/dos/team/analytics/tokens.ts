// Token analytics: token usage stats by model and tool.

import { createLogger } from '../../../lib/logger.js';
import type { TokenUsageStats } from '@chinmeister/shared/contracts/analytics.js';
import type { WindowTokenAggregate } from '../../../lib/pricing-enrich.js';
import { type AnalyticsScope, buildScopeFilter } from './scope.js';

const log = createLogger('TeamDO.analytics');

export function queryTokenUsage(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): TokenUsageStats {
  // Cost enrichment happens outside this function (dos/team/pricing-enrich.ts)
  // so queryTokenUsage stays pure SQL: raw token sums per model / per tool,
  // no resolver, no cost math, no DO RPC. estimated_cost_usd is left at its
  // default (null) and filled in by enrichAnalyticsWithPricing before the
  // response leaves the DO.
  const empty: TokenUsageStats = {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cache_read_tokens: 0,
    total_cache_creation_tokens: 0,
    avg_input_per_session: 0,
    avg_output_per_session: 0,
    sessions_with_token_data: 0,
    sessions_without_token_data: 0,
    total_edits_in_token_sessions: 0,
    total_estimated_cost_usd: 0,
    pricing_refreshed_at: null,
    pricing_is_stale: false,
    models_without_pricing: [],
    models_without_pricing_total: 0,
    cost_per_edit: null,
    cache_hit_rate: null,
    by_model: [],
    by_tool: [],
  };

  try {
    // Totals — only count sessions that have token data (non-NULL input_tokens
    // is the presence signal; cache fields may still be NULL on sessions
    // uploaded before phase 2 even if input/output were captured).
    const fTotals = buildScopeFilter(scope);
    const totals = sql
      .exec(
        `SELECT
           COALESCE(SUM(input_tokens), 0) AS total_input,
           COALESCE(SUM(output_tokens), 0) AS total_output,
           COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read,
           COALESCE(SUM(cache_creation_tokens), 0) AS total_cache_creation,
           COUNT(CASE WHEN input_tokens IS NOT NULL THEN 1 END) AS with_data,
           COUNT(CASE WHEN input_tokens IS NULL THEN 1 END) AS without_data,
           COALESCE(SUM(CASE WHEN input_tokens IS NOT NULL THEN edit_count ELSE 0 END), 0) AS edits_in_token_sessions
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')${fTotals.sql}`,
        days,
        ...fTotals.params,
      )
      .toArray();

    const t = (totals[0] || {}) as Record<string, unknown>;
    const totalInput = (t.total_input as number) || 0;
    const totalOutput = (t.total_output as number) || 0;
    const totalCacheRead = (t.total_cache_read as number) || 0;
    const totalCacheCreation = (t.total_cache_creation as number) || 0;
    const withData = (t.with_data as number) || 0;
    const withoutData = (t.without_data as number) || 0;
    const editsInTokenSessions = (t.edits_in_token_sessions as number) || 0;

    if (withData === 0) {
      return { ...empty, sessions_without_token_data: withoutData };
    }

    // By model — hybrid rollup with per-message preference.
    //
    // Migration 019 captures per-assistant-message `model` + tokens in the
    // conversation_events table. Summing there gives an accurate multi-model
    // breakdown: a Claude Code session that ran Opus for planning and Haiku
    // for sub-agents shows both models in proportion, instead of everything
    // attributed to the session's single `agent_model` column.
    //
    // Sessions without per-message data (pre-019 rows, or tools whose spec
    // doesn't populate tokenPaths) fall back to the session-level rollup.
    // The NOT EXISTS guard prevents double-counting — any session with ANY
    // per-message token row is excluded from the fallback CTE.
    //
    // Per-message rows land normalized via the extraction engine's
    // `normalizeTokens`, so the two sources can be summed without further
    // OpenAI/Anthropic math at query time.
    const fPerMsg = buildScopeFilter(scope, { handleColumn: 'ce.handle' });
    const fFallback = buildScopeFilter(scope, { handleColumn: 's.handle' });
    const modelRows = sql
      .exec(
        `WITH per_msg AS (
           SELECT ce.model AS agent_model,
                  COALESCE(SUM(ce.input_tokens), 0) AS input_tokens,
                  COALESCE(SUM(ce.output_tokens), 0) AS output_tokens,
                  COALESCE(SUM(ce.cache_read_tokens), 0) AS cache_read_tokens,
                  COALESCE(SUM(ce.cache_creation_tokens), 0) AS cache_creation_tokens,
                  COUNT(DISTINCT ce.session_id) AS sessions
             FROM conversation_events ce
             JOIN sessions s ON s.id = ce.session_id
            WHERE s.started_at > datetime('now', '-' || ? || ' days')
              AND ce.input_tokens IS NOT NULL
              AND ce.model IS NOT NULL AND ce.model != ''${fPerMsg.sql}
            GROUP BY ce.model
         ),
         fallback AS (
           SELECT s.agent_model AS agent_model,
                  COALESCE(SUM(s.input_tokens), 0) AS input_tokens,
                  COALESCE(SUM(s.output_tokens), 0) AS output_tokens,
                  COALESCE(SUM(s.cache_read_tokens), 0) AS cache_read_tokens,
                  COALESCE(SUM(s.cache_creation_tokens), 0) AS cache_creation_tokens,
                  COUNT(*) AS sessions
             FROM sessions s
            WHERE s.started_at > datetime('now', '-' || ? || ' days')
              AND s.input_tokens IS NOT NULL
              AND s.agent_model IS NOT NULL AND s.agent_model != ''
              AND NOT EXISTS (
                SELECT 1 FROM conversation_events ce2
                 WHERE ce2.session_id = s.id
                   AND ce2.input_tokens IS NOT NULL
              )${fFallback.sql}
            GROUP BY s.agent_model
         )
         SELECT agent_model,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cache_read_tokens) AS cache_read_tokens,
                SUM(cache_creation_tokens) AS cache_creation_tokens,
                SUM(sessions) AS sessions
           FROM (SELECT * FROM per_msg UNION ALL SELECT * FROM fallback)
          GROUP BY agent_model
          ORDER BY input_tokens DESC`,
        days,
        ...fPerMsg.params,
        days,
        ...fFallback.params,
      )
      .toArray();

    // By tool
    const fTool = buildScopeFilter(scope);
    const toolRows = sql
      .exec(
        `SELECT host_tool,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
                COUNT(*) AS sessions
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND input_tokens IS NOT NULL
           AND host_tool IS NOT NULL AND host_tool != 'unknown'${fTool.sql}
         GROUP BY host_tool
         ORDER BY input_tokens DESC`,
        days,
        ...fTool.params,
      )
      .toArray();

    const byModel = modelRows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        agent_model: row.agent_model as string,
        input_tokens: (row.input_tokens as number) || 0,
        output_tokens: (row.output_tokens as number) || 0,
        cache_read_tokens: (row.cache_read_tokens as number) || 0,
        cache_creation_tokens: (row.cache_creation_tokens as number) || 0,
        sessions: (row.sessions as number) || 0,
        // Populated by enrichAnalyticsWithPricing, not here.
        estimated_cost_usd: null,
      };
    });

    return {
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      total_cache_read_tokens: totalCacheRead,
      total_cache_creation_tokens: totalCacheCreation,
      avg_input_per_session: withData > 0 ? Math.round(totalInput / withData) : 0,
      avg_output_per_session: withData > 0 ? Math.round(totalOutput / withData) : 0,
      sessions_with_token_data: withData,
      sessions_without_token_data: withoutData,
      total_edits_in_token_sessions: editsInTokenSessions,
      total_estimated_cost_usd: 0,
      pricing_refreshed_at: null,
      pricing_is_stale: false,
      models_without_pricing: [],
      models_without_pricing_total: 0,
      cost_per_edit: null, // Populated by pricing enrichment layer
      cache_hit_rate: (() => {
        const totalAllInput = totalInput + totalCacheRead + totalCacheCreation;
        return totalAllInput > 0
          ? Math.round((totalCacheRead / totalAllInput) * 1000) / 1000
          : null;
      })(),
      by_model: byModel,
      by_tool: toolRows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          host_tool: row.host_tool as string,
          input_tokens: (row.input_tokens as number) || 0,
          output_tokens: (row.output_tokens as number) || 0,
          cache_read_tokens: (row.cache_read_tokens as number) || 0,
          cache_creation_tokens: (row.cache_creation_tokens as number) || 0,
          sessions: (row.sessions as number) || 0,
        };
      }),
    };
  } catch (err) {
    log.warn(`tokenUsage query failed: ${err}`);
    return empty;
  }
}

/** Per-day per-model token sum, the minimum shape needed to price daily cost.
 * Feeds `enrichDailyTrendsWithPricing` which resolves each model via the
 * LiteLLM pricing cache and sums cost per day. Days with no token-bearing
 * sessions simply don't appear — the enrichment layer leaves those days'
 * cost fields null, matching the period-total "no token data → --" rule. */
export interface DailyTokenUsageRow {
  day: string;
  agent_model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

/**
 * Minimal by_model + total_edits aggregate for a specific period offset
 * range, e.g. current = [days, 0], previous = [days*2, days]. Feeds
 * `enrichPeriodComparisonCost` so the delta on `cost-per-edit` prices both
 * windows against today's pricing snapshot — the delta reflects behavior
 * change, not price drift.
 *
 * Mirrors `queryTokenUsage`'s hybrid rollup (per-message from
 * conversation_events, session-level fallback with NOT EXISTS guard) but
 * scoped to one window at a time. Returns zero-edit/empty-model aggregates
 * when the window has no token-bearing sessions, which `computeWindowCost`
 * then maps to the four null-cause outputs documented on the schema.
 */
export function queryTokenAggregateForWindow(
  sql: SqlStorage,
  scope: AnalyticsScope,
  offsetStart: number,
  offsetEnd: number,
): WindowTokenAggregate {
  const empty: WindowTokenAggregate = {
    by_model: [],
    total_edits_in_token_sessions: 0,
  };

  try {
    const fEdits = buildScopeFilter(scope);
    const editsRows = sql
      .exec(
        `SELECT COALESCE(SUM(CASE WHEN input_tokens IS NOT NULL THEN edit_count ELSE 0 END), 0) AS edits
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND started_at <= datetime('now', '-' || ? || ' days')${fEdits.sql}`,
        offsetStart,
        offsetEnd,
        ...fEdits.params,
      )
      .toArray();
    const editsRow = (editsRows[0] || {}) as Record<string, unknown>;
    const totalEdits = (editsRow.edits as number) || 0;

    const fPerMsg = buildScopeFilter(scope, { handleColumn: 'ce.handle' });
    const fFallback = buildScopeFilter(scope, { handleColumn: 's.handle' });
    const modelRows = sql
      .exec(
        `WITH per_msg AS (
           SELECT ce.model AS agent_model,
                  COALESCE(SUM(ce.input_tokens), 0) AS input_tokens,
                  COALESCE(SUM(ce.output_tokens), 0) AS output_tokens,
                  COALESCE(SUM(ce.cache_read_tokens), 0) AS cache_read_tokens,
                  COALESCE(SUM(ce.cache_creation_tokens), 0) AS cache_creation_tokens
             FROM conversation_events ce
             JOIN sessions s ON s.id = ce.session_id
            WHERE s.started_at > datetime('now', '-' || ? || ' days')
              AND s.started_at <= datetime('now', '-' || ? || ' days')
              AND ce.input_tokens IS NOT NULL
              AND ce.model IS NOT NULL AND ce.model != ''${fPerMsg.sql}
            GROUP BY ce.model
         ),
         fallback AS (
           SELECT s.agent_model AS agent_model,
                  COALESCE(SUM(s.input_tokens), 0) AS input_tokens,
                  COALESCE(SUM(s.output_tokens), 0) AS output_tokens,
                  COALESCE(SUM(s.cache_read_tokens), 0) AS cache_read_tokens,
                  COALESCE(SUM(s.cache_creation_tokens), 0) AS cache_creation_tokens
             FROM sessions s
            WHERE s.started_at > datetime('now', '-' || ? || ' days')
              AND s.started_at <= datetime('now', '-' || ? || ' days')
              AND s.input_tokens IS NOT NULL
              AND s.agent_model IS NOT NULL AND s.agent_model != ''
              AND NOT EXISTS (
                SELECT 1 FROM conversation_events ce2
                 WHERE ce2.session_id = s.id
                   AND ce2.input_tokens IS NOT NULL
              )${fFallback.sql}
            GROUP BY s.agent_model
         )
         SELECT agent_model,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cache_read_tokens) AS cache_read_tokens,
                SUM(cache_creation_tokens) AS cache_creation_tokens
           FROM (SELECT * FROM per_msg UNION ALL SELECT * FROM fallback)
          GROUP BY agent_model`,
        offsetStart,
        offsetEnd,
        ...fPerMsg.params,
        offsetStart,
        offsetEnd,
        ...fFallback.params,
      )
      .toArray();

    return {
      by_model: modelRows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          agent_model: row.agent_model as string,
          input_tokens: (row.input_tokens as number) || 0,
          output_tokens: (row.output_tokens as number) || 0,
          cache_read_tokens: (row.cache_read_tokens as number) || 0,
          cache_creation_tokens: (row.cache_creation_tokens as number) || 0,
        };
      }),
      total_edits_in_token_sessions: totalEdits,
    };
  } catch (err) {
    log.warn(`tokenAggregateForWindow query failed: ${err}`);
    return empty;
  }
}

export function queryDailyTokenUsage(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
  tzOffsetMinutes: number = 0,
): DailyTokenUsageRow[] {
  try {
    const f = buildScopeFilter(scope);
    const rows = sql
      .exec(
        `SELECT date(datetime(started_at, ? || ' minutes')) AS day,
                agent_model,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days', '-1 day')
           AND input_tokens IS NOT NULL
           AND agent_model IS NOT NULL AND agent_model != ''${f.sql}
         GROUP BY day, agent_model
         ORDER BY day ASC`,
        tzOffsetMinutes,
        days,
        ...f.params,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        day: row.day as string,
        agent_model: row.agent_model as string,
        input_tokens: (row.input_tokens as number) || 0,
        output_tokens: (row.output_tokens as number) || 0,
        cache_read_tokens: (row.cache_read_tokens as number) || 0,
        cache_creation_tokens: (row.cache_creation_tokens as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`dailyTokenUsage query failed: ${err}`);
    return [];
  }
}
