// Tool-call stats aggregation across teams.
// Each team DO already computes a complete ToolCallStats (totals, error
// patterns, hourly activity). For the user view we sum the totals, then
// recompute rates against the merged denominators so they don't drift.
// Arrays are concatenated and re-aggregated by key so the user sees one
// frequency row per tool across all teams, not one per team per tool.

import type { ToolCallStats } from '@chinwag/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

interface FrequencyBucket {
  calls: number;
  errors: number;
  sessions: number;
  duration_sum: number;
  duration_samples: number;
}

interface ErrorPatternBucket {
  // Keyed by `${tool}:${error_preview}`; store the tool name alongside.
  tool: string;
  count: number;
  // Max(called_at) across teams — latest occurrence wins. null only when
  // every contributing team's row predates the schema-nullable-default,
  // which is a deployment-phase transient condition.
  last_at: string | null;
}

interface HourlyBucket {
  calls: number;
  errors: number;
}

export interface ToolCallsAcc {
  total_calls: number;
  total_errors: number;
  duration_ms_sum: number;
  duration_ms_samples: number;
  sessions_with_calls: number;
  edit_tool_calls: number;
  research_tool_calls: number;
  one_shot_successes: number;
  one_shot_sessions: number;
  frequency: Map<string, FrequencyBucket>;
  errorPatterns: Map<string, ErrorPatternBucket>;
  hourly: Map<string, HourlyBucket>; // key = `${dow}:${hour}`
}

export function createAcc(): ToolCallsAcc {
  return {
    total_calls: 0,
    total_errors: 0,
    duration_ms_sum: 0,
    duration_ms_samples: 0,
    sessions_with_calls: 0,
    edit_tool_calls: 0,
    research_tool_calls: 0,
    one_shot_successes: 0,
    one_shot_sessions: 0,
    frequency: new Map(),
    errorPatterns: new Map(),
    hourly: new Map(),
  };
}

const RESEARCH_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

export function merge(acc: ToolCallsAcc, team: TeamResult): void {
  const tc = team.tool_call_stats;
  if (!tc) return;

  acc.total_calls += tc.total_calls;
  acc.total_errors += tc.total_errors;
  // Weighted duration so the user-level avg is calls-weighted, not team-weighted.
  acc.duration_ms_sum += tc.avg_duration_ms * tc.total_calls;
  acc.duration_ms_samples += tc.total_calls;

  // Team reports calls_per_session = total_calls / sessions_with_any_call.
  // Recover the session count so we can re-aggregate fairly.
  if (tc.calls_per_session > 0) {
    acc.sessions_with_calls += Math.round(tc.total_calls / tc.calls_per_session);
  }

  // Team reports one_shot_rate as % of one_shot_sessions; recover the
  // numerator the same way.
  acc.one_shot_sessions += tc.one_shot_sessions;
  acc.one_shot_successes += Math.round((tc.one_shot_rate / 100) * tc.one_shot_sessions);

  for (const f of tc.frequency ?? []) {
    const bucket = acc.frequency.get(f.tool) ?? {
      calls: 0,
      errors: 0,
      sessions: 0,
      duration_sum: 0,
      duration_samples: 0,
    };
    bucket.calls += f.calls;
    bucket.errors += f.errors;
    bucket.sessions += f.sessions;
    bucket.duration_sum += f.avg_duration_ms * f.calls;
    bucket.duration_samples += f.calls;
    acc.frequency.set(f.tool, bucket);

    if (RESEARCH_TOOLS.has(f.tool)) acc.research_tool_calls += f.calls;
    if (EDIT_TOOLS.has(f.tool)) acc.edit_tool_calls += f.calls;
  }

  for (const e of tc.error_patterns ?? []) {
    const key = `${e.tool}:${e.error_preview}`;
    const bucket = acc.errorPatterns.get(key) ?? { tool: e.tool, count: 0, last_at: null };
    bucket.count += e.count;
    if (e.last_at && (!bucket.last_at || e.last_at > bucket.last_at)) {
      bucket.last_at = e.last_at;
    }
    acc.errorPatterns.set(key, bucket);
  }

  for (const h of tc.hourly_activity ?? []) {
    const bucket = acc.hourly.get(String(h.hour)) ?? { calls: 0, errors: 0 };
    bucket.calls += h.calls;
    bucket.errors += h.errors;
    acc.hourly.set(String(h.hour), bucket);
  }
}

export function project(acc: ToolCallsAcc): ToolCallStats {
  const avg_duration_ms =
    acc.duration_ms_samples > 0 ? Math.round(acc.duration_ms_sum / acc.duration_ms_samples) : 0;
  const error_rate =
    acc.total_calls > 0 ? Math.round((acc.total_errors / acc.total_calls) * 1000) / 10 : 0;
  const calls_per_session =
    acc.sessions_with_calls > 0
      ? Math.round((acc.total_calls / acc.sessions_with_calls) * 10) / 10
      : 0;
  const research_to_edit_ratio =
    acc.edit_tool_calls > 0
      ? Math.round((acc.research_tool_calls / acc.edit_tool_calls) * 10) / 10
      : 0;
  const one_shot_rate =
    acc.one_shot_sessions > 0
      ? Math.round((acc.one_shot_successes / acc.one_shot_sessions) * 1000) / 10
      : 0;

  const frequency = [...acc.frequency.entries()]
    .map(([tool, b]) => ({
      tool,
      calls: b.calls,
      errors: b.errors,
      sessions: b.sessions,
      error_rate: b.calls > 0 ? Math.round((b.errors / b.calls) * 1000) / 10 : 0,
      avg_duration_ms: b.duration_samples > 0 ? Math.round(b.duration_sum / b.duration_samples) : 0,
    }))
    .sort((a, b) => b.calls - a.calls);

  const error_patterns = [...acc.errorPatterns.entries()]
    .map(([key, b]) => {
      const error_preview = key.slice(b.tool.length + 1);
      return { tool: b.tool, error_preview, count: b.count, last_at: b.last_at };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const hourly_activity = [...acc.hourly.entries()]
    .map(([key, b]) => ({ hour: Number(key), calls: b.calls, errors: b.errors }))
    .sort((a, b) => a.hour - b.hour);

  return {
    total_calls: acc.total_calls,
    total_errors: acc.total_errors,
    error_rate,
    avg_duration_ms,
    calls_per_session,
    research_to_edit_ratio,
    one_shot_rate,
    one_shot_sessions: acc.one_shot_sessions,
    frequency,
    error_patterns,
    hourly_activity,
  };
}
