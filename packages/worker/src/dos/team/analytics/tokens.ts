// Token analytics: token usage stats by model and tool.

import { createLogger } from '../../../lib/logger.js';
import type { TokenUsageStats } from '@chinwag/shared/contracts/analytics.js';

const log = createLogger('TeamDO.analytics');

export function queryTokenUsage(sql: SqlStorage, days: number): TokenUsageStats {
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
         WHERE started_at > datetime('now', '-' || ? || ' days')`,
        days,
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

    // By model
    const modelRows = sql
      .exec(
        `SELECT agent_model,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
                COUNT(*) AS sessions
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND input_tokens IS NOT NULL
           AND agent_model IS NOT NULL AND agent_model != ''
         GROUP BY agent_model
         ORDER BY input_tokens DESC`,
        days,
      )
      .toArray();

    // By tool
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
           AND host_tool IS NOT NULL AND host_tool != 'unknown'
         GROUP BY host_tool
         ORDER BY input_tokens DESC`,
        days,
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
