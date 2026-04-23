// Token usage aggregation.
// Kept separate because its projected payload is the input to
// enrichTokenUsageWithPricing, which runs once per request against the
// DatabaseDO pricing cache. The handler calls `project` then enrichment
// then passes the final object into the response.

import type { TokenUsageStats } from '@chinmeister/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

interface TokenTotalBucket {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  with_data: number;
  without_data: number;
  edits_in_token_sessions: number;
}

interface TokenByKeyBucket {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  sessions: number;
}

export interface TokensAcc {
  total: TokenTotalBucket;
  byModel: Map<string, TokenByKeyBucket>;
  byTool: Map<string, TokenByKeyBucket>;
}

export function createAcc(): TokensAcc {
  return {
    total: {
      input: 0,
      output: 0,
      cache_read: 0,
      cache_creation: 0,
      with_data: 0,
      without_data: 0,
      edits_in_token_sessions: 0,
    },
    byModel: new Map(),
    byTool: new Map(),
  };
}

export function merge(acc: TokensAcc, team: TeamResult): void {
  const tu = team.token_usage;
  if (!tu) return;
  acc.total.input += tu.total_input_tokens;
  acc.total.output += tu.total_output_tokens;
  acc.total.cache_read += tu.total_cache_read_tokens;
  acc.total.cache_creation += tu.total_cache_creation_tokens;
  acc.total.with_data += tu.sessions_with_token_data;
  acc.total.without_data += tu.sessions_without_token_data;
  acc.total.edits_in_token_sessions += tu.total_edits_in_token_sessions;
  for (const m of tu.by_model ?? []) {
    const existing = acc.byModel.get(m.agent_model) ?? {
      input: 0,
      output: 0,
      cache_read: 0,
      cache_creation: 0,
      sessions: 0,
    };
    existing.input += m.input_tokens;
    existing.output += m.output_tokens;
    existing.cache_read += m.cache_read_tokens;
    existing.cache_creation += m.cache_creation_tokens;
    existing.sessions += m.sessions;
    acc.byModel.set(m.agent_model, existing);
  }
  for (const t of tu.by_tool ?? []) {
    const existing = acc.byTool.get(t.host_tool) ?? {
      input: 0,
      output: 0,
      cache_read: 0,
      cache_creation: 0,
      sessions: 0,
    };
    existing.input += t.input_tokens;
    existing.output += t.output_tokens;
    existing.cache_read += t.cache_read_tokens;
    existing.cache_creation += t.cache_creation_tokens;
    existing.sessions += t.sessions;
    acc.byTool.set(t.host_tool, existing);
  }
}

/**
 * Produce the TokenUsageStats shape ready for pricing enrichment. Costs are
 * placeholders (0/null); enrichTokenUsageWithPricing mutates them in place.
 */
export function project(acc: TokensAcc): TokenUsageStats {
  return {
    total_input_tokens: acc.total.input,
    total_output_tokens: acc.total.output,
    total_cache_read_tokens: acc.total.cache_read,
    total_cache_creation_tokens: acc.total.cache_creation,
    avg_input_per_session:
      acc.total.with_data > 0 ? Math.round(acc.total.input / acc.total.with_data) : 0,
    avg_output_per_session:
      acc.total.with_data > 0 ? Math.round(acc.total.output / acc.total.with_data) : 0,
    sessions_with_token_data: acc.total.with_data,
    sessions_without_token_data: acc.total.without_data,
    total_edits_in_token_sessions: acc.total.edits_in_token_sessions,
    total_estimated_cost_usd: 0,
    pricing_refreshed_at: null,
    pricing_is_stale: false,
    models_without_pricing: [],
    models_without_pricing_total: 0,
    cost_per_edit: null,
    cache_hit_rate: null,
    by_model: [...acc.byModel.entries()]
      .sort(([, a], [, b]) => b.input - a.input)
      .map(([agent_model, v]) => ({
        agent_model,
        input_tokens: v.input,
        output_tokens: v.output,
        cache_read_tokens: v.cache_read,
        cache_creation_tokens: v.cache_creation,
        sessions: v.sessions,
        estimated_cost_usd: null,
      })),
    by_tool: [...acc.byTool.entries()]
      .sort(([, a], [, b]) => b.input - a.input)
      .map(([host_tool, v]) => ({
        host_tool,
        input_tokens: v.input,
        output_tokens: v.output,
        cache_read_tokens: v.cache_read,
        cache_creation_tokens: v.cache_creation,
        sessions: v.sessions,
      })),
  };
}
