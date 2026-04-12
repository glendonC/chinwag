// Joins per-tool slices of userAnalytics into a single sortable row per tool
// in the user's stack. Used by the scored Tools tab and the per-tool drill-in.

import { useMemo } from 'react';
import { useUserAnalytics } from '../../hooks/useUserAnalytics.js';
import { normalizeToolId } from '../../lib/toolMeta.js';
import type {
  UserAnalytics,
  ToolComparison,
  ToolHandoff,
  ToolWorkTypeBreakdown,
  ToolCallErrorPattern,
  TokenToolBreakdown,
  ToolDailyTrend,
  MemberAnalytics,
} from '../../lib/apiSchemas.js';

export interface ScoredToolRow {
  toolId: string;
  sessions: number;
  completed: number;
  abandoned: number;
  failed: number;
  completionRate: number;
  avgFirstEditMin: number | null;
  inputTokens: number;
  outputTokens: number;
  reporting: 'reporting' | 'silent' | 'unknown';
  sparkline: number[];
}

export interface ToolDrillIn {
  toolId: string;
  comparison: ToolComparison | null;
  daily: ToolDailyTrend[];
  workTypes: ToolWorkTypeBreakdown[];
  errors: ToolCallErrorPattern[];
  handoffsOut: ToolHandoff[];
  handoffsIn: ToolHandoff[];
  tokens: TokenToolBreakdown | null;
  members: MemberAnalytics[];
  avgFirstEditMin: number | null;
  reporting: 'reporting' | 'silent' | 'unknown';
}

export interface UseScoredStackData {
  analytics: UserAnalytics;
  isLoading: boolean;
  error: string | null;
  rows: ScoredToolRow[];
  getDrillIn: (toolId: string) => ToolDrillIn | null;
}

function matches(a: string, b: string): boolean {
  return normalizeToolId(a) === normalizeToolId(b);
}

export function useScoredStackData(rangeDays = 30): UseScoredStackData {
  const { analytics, isLoading, error } = useUserAnalytics(rangeDays, true);

  const rows = useMemo<ScoredToolRow[]>(() => {
    const comparison = analytics.tool_comparison ?? [];
    const firstEditByTool = analytics.first_edit_stats?.by_tool ?? [];
    const tokensByTool = analytics.token_usage?.by_tool ?? [];
    const daily = analytics.tool_daily ?? [];
    const reporting = new Set(
      (analytics.data_coverage?.tools_reporting ?? []).map((t) => normalizeToolId(t)),
    );
    const silent = new Set(
      (analytics.data_coverage?.tools_without_data ?? []).map((t) => normalizeToolId(t)),
    );

    // Build sparkline buckets keyed by normalized tool id.
    // Use the last N days of tool_daily.sessions; missing days = 0.
    const sparkBuckets = new Map<string, Map<string, number>>();
    for (const d of daily) {
      const key = normalizeToolId(d.host_tool);
      const bucket = sparkBuckets.get(key) ?? new Map<string, number>();
      bucket.set(d.day, (bucket.get(d.day) ?? 0) + d.sessions);
      sparkBuckets.set(key, bucket);
    }

    // Generate the day labels for the requested range so each tool has a uniform-length series.
    const days: string[] = [];
    const now = new Date();
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(now.getUTCDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }

    return comparison
      .filter((c) => c.host_tool && c.host_tool !== 'unknown')
      .map((c) => {
        const key = normalizeToolId(c.host_tool);
        const fe = firstEditByTool.find((f) => matches(f.host_tool, c.host_tool));
        const tk = tokensByTool.find((t) => matches(t.host_tool, c.host_tool));
        const bucket = sparkBuckets.get(key);
        const sparkline = bucket ? days.map((d) => bucket.get(d) ?? 0) : days.map(() => 0);

        let report: ScoredToolRow['reporting'] = 'unknown';
        if (reporting.has(key)) report = 'reporting';
        else if (silent.has(key)) report = 'silent';

        return {
          toolId: c.host_tool,
          sessions: c.sessions,
          completed: c.completed,
          abandoned: c.abandoned,
          failed: c.failed,
          completionRate: c.completion_rate,
          avgFirstEditMin: fe ? fe.avg_minutes : null,
          inputTokens: tk?.input_tokens ?? 0,
          outputTokens: tk?.output_tokens ?? 0,
          reporting: report,
          sparkline,
        };
      })
      .sort((a, b) => b.sessions - a.sessions);
  }, [analytics, rangeDays]);

  const getDrillIn = useMemo(() => {
    return (toolId: string): ToolDrillIn | null => {
      const target = normalizeToolId(toolId);
      const comparison =
        analytics.tool_comparison?.find((c) => matches(c.host_tool, toolId)) ?? null;
      if (!comparison) return null;

      const daily = (analytics.tool_daily ?? []).filter((d) => matches(d.host_tool, toolId));
      const workTypes = (analytics.tool_work_type ?? []).filter((w) =>
        matches(w.host_tool, toolId),
      );
      const errors = (analytics.tool_call_stats?.error_patterns ?? []).filter((e) =>
        matches(e.tool, toolId),
      );
      const handoffsOut = (analytics.tool_handoffs ?? []).filter((h) =>
        matches(h.from_tool, toolId),
      );
      const handoffsIn = (analytics.tool_handoffs ?? []).filter((h) => matches(h.to_tool, toolId));
      const tokens =
        analytics.token_usage?.by_tool?.find((t) => matches(t.host_tool, toolId)) ?? null;
      const members = (analytics.member_analytics ?? []).filter(
        (m) => m.primary_tool && matches(m.primary_tool, toolId),
      );
      const fe = analytics.first_edit_stats?.by_tool?.find((f) => matches(f.host_tool, toolId));
      const reporting = new Set(
        (analytics.data_coverage?.tools_reporting ?? []).map((t) => normalizeToolId(t)),
      );
      const silent = new Set(
        (analytics.data_coverage?.tools_without_data ?? []).map((t) => normalizeToolId(t)),
      );
      let report: ToolDrillIn['reporting'] = 'unknown';
      if (reporting.has(target)) report = 'reporting';
      else if (silent.has(target)) report = 'silent';

      return {
        toolId,
        comparison,
        daily,
        workTypes,
        errors,
        handoffsOut,
        handoffsIn,
        tokens,
        members,
        avgFirstEditMin: fe ? fe.avg_minutes : null,
        reporting: report,
      };
    };
  }, [analytics]);

  return { analytics, isLoading, error, rows, getDrillIn };
}
