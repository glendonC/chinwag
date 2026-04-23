// Period-over-period comparison.
// Lives alone because its projected shape nests a `current` / `previous`
// object pair, and the weighted-average math (weight by total_sessions)
// only makes sense as a single unit.

import type { PeriodComparison } from '@chinmeister/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;

interface PeriodAcc {
  completion_sum: number;
  duration_sum: number;
  stuck_sum: number;
  memory_hit_sum: number;
  velocity_sum: number;
  total_sessions_sum: number;
  count: number;
  // Cost/edits summed null-stickily across teams (daily-trends pattern).
  // cost_sum stays null when no team reported a priced cost — matches the
  // per-team "no token data / stale pricing / all-unpriced → --" rule, so
  // a partial-coverage team can't contaminate the aggregate with zero.
  cost_sum: number | null;
  edits_sum: number;
}

export interface PeriodComparisonAcc {
  current: PeriodAcc;
  previous: PeriodAcc;
}

function emptyPeriodAcc(): PeriodAcc {
  return {
    completion_sum: 0,
    duration_sum: 0,
    stuck_sum: 0,
    memory_hit_sum: 0,
    velocity_sum: 0,
    total_sessions_sum: 0,
    count: 0,
    cost_sum: null,
    edits_sum: 0,
  };
}

export function createAcc(): PeriodComparisonAcc {
  return { current: emptyPeriodAcc(), previous: emptyPeriodAcc() };
}

export function merge(acc: PeriodComparisonAcc, team: TeamResult): void {
  const pc = team.period_comparison;
  if (!pc) return;
  const cur = pc.current;
  if (cur) {
    const ts = cur.total_sessions;
    acc.current.completion_sum += cur.completion_rate * ts;
    acc.current.duration_sum += cur.avg_duration_min * ts;
    acc.current.stuck_sum += cur.stuckness_rate * ts;
    acc.current.memory_hit_sum += cur.memory_hit_rate * ts;
    acc.current.velocity_sum += cur.edit_velocity * ts;
    acc.current.total_sessions_sum += ts;
    acc.current.count++;
    if (cur.total_estimated_cost_usd != null) {
      acc.current.cost_sum = (acc.current.cost_sum ?? 0) + cur.total_estimated_cost_usd;
    }
    acc.current.edits_sum += cur.total_edits_in_token_sessions ?? 0;
  }
  const prev = pc.previous;
  if (prev) {
    const ts = prev.total_sessions;
    acc.previous.completion_sum += prev.completion_rate * ts;
    acc.previous.duration_sum += prev.avg_duration_min * ts;
    acc.previous.stuck_sum += prev.stuckness_rate * ts;
    acc.previous.memory_hit_sum += prev.memory_hit_rate * ts;
    acc.previous.velocity_sum += prev.edit_velocity * ts;
    acc.previous.total_sessions_sum += ts;
    acc.previous.count++;
    if (prev.total_estimated_cost_usd != null) {
      acc.previous.cost_sum = (acc.previous.cost_sum ?? 0) + prev.total_estimated_cost_usd;
    }
    acc.previous.edits_sum += prev.total_edits_in_token_sessions ?? 0;
  }
}

export function project(acc: PeriodComparisonAcc): PeriodComparison {
  const cs = acc.current.total_sessions_sum;
  const ps = acc.previous.total_sessions_sum;
  const curCost =
    acc.current.cost_sum != null ? Math.round(acc.current.cost_sum * 100) / 100 : null;
  const curCostPerEdit =
    curCost != null && acc.current.edits_sum > 0
      ? Math.round((curCost / acc.current.edits_sum) * 10000) / 10000
      : null;
  const prevCost =
    acc.previous.cost_sum != null ? Math.round(acc.previous.cost_sum * 100) / 100 : null;
  const prevCostPerEdit =
    prevCost != null && acc.previous.edits_sum > 0
      ? Math.round((prevCost / acc.previous.edits_sum) * 10000) / 10000
      : null;
  return {
    current: {
      completion_rate: cs > 0 ? round1(acc.current.completion_sum / cs) : 0,
      avg_duration_min: cs > 0 ? round1(acc.current.duration_sum / cs) : 0,
      stuckness_rate: cs > 0 ? round1(acc.current.stuck_sum / cs) : 0,
      memory_hit_rate: cs > 0 ? round1(acc.current.memory_hit_sum / cs) : 0,
      edit_velocity: cs > 0 ? round1(acc.current.velocity_sum / cs) : 0,
      total_sessions: cs,
      // Cost/edits summed null-stickily in `merge`; cost_per_edit re-derived
      // here from the merged totals. A simple average of per-team ratios
      // would mis-weight small teams — same reasoning as daily-trends.
      total_estimated_cost_usd: curCost,
      total_edits_in_token_sessions: acc.current.edits_sum,
      cost_per_edit: curCostPerEdit,
    },
    previous:
      acc.previous.count > 0
        ? {
            completion_rate: ps > 0 ? round1(acc.previous.completion_sum / ps) : 0,
            avg_duration_min: ps > 0 ? round1(acc.previous.duration_sum / ps) : 0,
            stuckness_rate: ps > 0 ? round1(acc.previous.stuck_sum / ps) : 0,
            memory_hit_rate: ps > 0 ? round1(acc.previous.memory_hit_sum / ps) : 0,
            edit_velocity: ps > 0 ? round1(acc.previous.velocity_sum / ps) : 0,
            total_sessions: ps,
            total_estimated_cost_usd: prevCost,
            total_edits_in_token_sessions: acc.previous.edits_sum,
            cost_per_edit: prevCostPerEdit,
          }
        : null,
  };
}
