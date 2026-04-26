// Healthy baseline scenario. Every field in UserAnalytics is derived from
// a small set of inputs (tool profiles + a session ledger) so numbers stay
// internally consistent: tool_distribution.sessions sum equals
// completion_summary.total_sessions, tool_comparison rates match the
// model_outcomes aggregation, and so on. Scenarios layer overrides on top
// of this baseline.

import { classifyWorkType } from '@chinmeister/shared/analytics/work-type.js';
import type { UserAnalytics } from '../apiSchemas.js';
import {
  TOOL_PROFILES,
  MODEL_PROFILES,
  getModelProfile,
  sessionCost,
  type ToolProfile,
} from './profiles.js';
import { allocateIntegerShares, buildDaySpine, hash, weekdayWeight, wobble } from './rng.js';

export const DEFAULT_PERIOD_DAYS = 30;
const TOTAL_SESSIONS = 184;

// ISO timestamp `n` days before now, used for last_used_at / last_accessed_at
// fields where day-grain is enough. Inline arithmetic kept for the minute-grain
// last_accessed_at values that need finer precision.
function nowMinusDays(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// ── Shared fixtures (team members, projects, files, memories) ────────

export const DEMO_MEMBERS = [
  { handle: 'glendon', primary_tool: 'claude-code', share: 0.35 },
  { handle: 'sora', primary_tool: 'cursor', share: 0.22 },
  { handle: 'jae', primary_tool: 'aider', share: 0.15 },
  { handle: 'pax', primary_tool: 'cline', share: 0.14 },
  { handle: 'mika', primary_tool: 'windsurf', share: 0.14 },
] as const;

export const DEMO_TEAMS = [
  { team_id: 'team-frontend', team_name: 'frontend', share: 0.42 },
  { team_id: 'team-platform', team_name: 'platform', share: 0.38 },
  { team_id: 'team-research', team_name: 'research', share: 0.2 },
] as const;

// Curated realistic file list. Touch count is proportional — the top file
// gets the lion's share, distribution follows a gentle power law so the
// file_heatmap, file_churn, and file_rework widgets all render believable
// top-N ordering.
const FILES = [
  { path: 'packages/web/src/widgets/bodies/ToolWidgets.tsx', weight: 1.0, dir: 'packages/web' },
  { path: 'packages/worker/src/dos/team/context.ts', weight: 0.82, dir: 'packages/worker' },
  {
    path: 'packages/web/src/views/OverviewView/OverviewView.tsx',
    weight: 0.78,
    dir: 'packages/web',
  },
  { path: 'packages/shared/tool-registry.ts', weight: 0.66, dir: 'packages/shared' },
  { path: 'packages/worker/src/dos/team/memory.ts', weight: 0.58, dir: 'packages/worker' },
  { path: 'packages/web/src/widgets/bodies/LiveWidgets.tsx', weight: 0.52, dir: 'packages/web' },
  { path: 'packages/cli/lib/extraction/engine.ts', weight: 0.44, dir: 'packages/cli' },
  { path: 'packages/mcp/lib/tools/conflicts.ts', weight: 0.38, dir: 'packages/mcp' },
  { path: 'packages/worker/src/dos/team/sessions.ts', weight: 0.34, dir: 'packages/worker' },
  { path: 'packages/web/src/lib/schemas/analytics.ts', weight: 0.3, dir: 'packages/web' },
  { path: 'packages/web/src/widgets/bodies/UsageWidgets.tsx', weight: 0.27, dir: 'packages/web' },
  { path: 'packages/worker/src/moderation.ts', weight: 0.24, dir: 'packages/worker' },
  {
    path: 'packages/cli/lib/dashboard/hooks/useCollectorSubscription.ts',
    weight: 0.21,
    dir: 'packages/cli',
  },
  { path: 'packages/mcp/lib/tools/memory.ts', weight: 0.19, dir: 'packages/mcp' },
  { path: 'docs/VISION.md', weight: 0.14, dir: 'docs' },
  { path: 'docs/ARCHITECTURE.md', weight: 0.1, dir: 'docs' },
];

const DIRECTORIES = [
  { directory: 'packages/web', share: 0.32, files: 42 },
  { directory: 'packages/worker', share: 0.28, files: 36 },
  { directory: 'packages/mcp', share: 0.14, files: 18 },
  { directory: 'packages/cli', share: 0.13, files: 22 },
  { directory: 'packages/shared', share: 0.09, files: 14 },
  { directory: 'docs', share: 0.04, files: 8 },
];

// Demo volume mix per canonical work type. Keys come from the shared
// WORK_TYPES enum — the shares are the only tunable piece here, since
// the category list itself is defined in @chinmeister/shared/analytics/work-type.
// Keep the shares summed to ~1.0 so allocateIntegerShares divides the
// period totals cleanly.
const WORK_TYPE_MIX: Array<{ work_type: string; share: number }> = [
  { work_type: 'frontend', share: 0.4 },
  { work_type: 'backend', share: 0.25 },
  { work_type: 'other', share: 0.12 },
  { work_type: 'docs', share: 0.1 },
  { work_type: 'test', share: 0.07 },
  { work_type: 'styling', share: 0.04 },
  { work_type: 'config', share: 0.02 },
];

// Per-tool, per-work-type completion rate profile. Drives the demo heatmap so
// the redesigned tool-work-type-fit widget shows differentiated reads instead
// of a uniform-tinted grid. Numbers are illustrative — each tool's strengths
// match the marketing narrative (Claude Code = backend / refactors,
// Cursor = styling / quick UI, Aider = backend / scripts).
const TOOL_WORK_TYPE_FIT: Record<string, Record<string, number>> = {
  'claude-code': {
    frontend: 80,
    backend: 86,
    test: 74,
    styling: 60,
    docs: 90,
    config: 78,
    other: 65,
  },
  cursor: {
    frontend: 78,
    backend: 42,
    test: 50,
    styling: 86,
    docs: 80,
    config: 50,
    other: 55,
  },
  aider: {
    frontend: 50,
    backend: 80,
    test: 60,
    styling: 38,
    docs: 70,
    config: 75,
    other: 40,
  },
};

// ── Derivation helpers ───────────────────────────────────────────────

// Day-of-week volume shape normalized so daily counts sum to the period
// total. Weekdays dominate; weekends trail. Produces one numeric weight
// per day in the spine, in the spine's order (oldest → newest).
function dailyVolumeShape(days: string[], total: number): number[] {
  const raw = days.map((d, i) => {
    const base = weekdayWeight(d);
    // Light ±15% variance per day so the sparkline has texture but the
    // week still reads as recognizably weekday-heavy.
    const jitter = 0.85 + hash(i) * 0.3;
    return base * jitter;
  });
  return allocateIntegerShares(total, raw);
}

// Distribute a per-tool total across days using the same weekday shape
// used for the overall sessions axis. Keeps tool_daily and daily_trends
// visually synchronized.
function distributeAcrossDays(total: number, days: string[], seedOffset: number): number[] {
  const raw = days.map((d, i) => {
    const base = weekdayWeight(d);
    const jitter = 0.7 + hash(i + seedOffset) * 0.6;
    return base * jitter;
  });
  return allocateIntegerShares(total, raw);
}

// ── Baseline builder ─────────────────────────────────────────────────

export function createBaselineAnalytics(): UserAnalytics {
  const periodDays = DEFAULT_PERIOD_DAYS;
  const days = buildDaySpine(periodDays);

  // 1. Integer allocation: sessions → tools
  const toolSessions = allocateIntegerShares(
    TOTAL_SESSIONS,
    TOOL_PROFILES.map((t) => t.sessionShare),
  );

  // 2. Per-tool ledger: outcomes, edits, lines, duration, tokens, cost.
  //    Everything downstream (tool_comparison, outcome_distribution,
  //    completion_summary, token_usage) reads this single structure.
  interface ToolLedger {
    tool: ToolProfile;
    sessions: number;
    completed: number;
    abandoned: number;
    failed: number;
    unknown: number;
    totalEdits: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
    totalSessionHours: number;
    totalCost: number | null; // null when tool.tokenUsage is false
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheCreationTokens: number;
    // Per-model split driven by tool.models. Ordered by share within tool.
    modelBreakdown: Array<{
      model_id: string;
      sessions: number;
      completed: number;
      abandoned: number;
      failed: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      cost: number | null;
    }>;
    commits: number;
  }

  const ledger: ToolLedger[] = TOOL_PROFILES.map((tool, idx) => {
    const sessions = toolSessions[idx];
    const completed = Math.round(sessions * tool.completionRate);
    const abandoned = Math.round(sessions * tool.abandonRate);
    const failed = Math.round(sessions * tool.failRate);
    const unknown = Math.max(0, sessions - completed - abandoned - failed);
    const totalEdits = Math.round(completed * tool.editsPerCompletedSession);
    const totalLinesAdded = Math.round(totalEdits * tool.linesAddedPerEdit);
    const totalLinesRemoved = Math.round(totalEdits * tool.linesRemovedPerEdit);
    const totalSessionHours = Math.round(((completed * tool.avgDurationMin) / 60) * 100) / 100;
    const commits = Math.round(completed * tool.commitsPerCompletedSession);

    // Model split within a tool: dominant model gets the most sessions.
    // Share curve: [0.6, 0.3, 0.1] when there are 3+ models, otherwise
    // [0.7, 0.3] or [1.0]. Deterministic so the same tool always attributes
    // to the same models in the same ratio.
    const modelShares =
      tool.models.length >= 3 ? [0.6, 0.3, 0.1] : tool.models.length === 2 ? [0.7, 0.3] : [1.0];
    const modelSessionCounts = allocateIntegerShares(sessions, modelShares);

    let toolTotalCost: number | null = tool.tokenUsage ? 0 : null;
    let toolInput = 0;
    let toolOutput = 0;
    let toolCacheR = 0;
    let toolCacheC = 0;

    const modelBreakdown = tool.models.slice(0, modelShares.length).map((modelId, mi) => {
      const mSessions = modelSessionCounts[mi];
      const model = getModelProfile(modelId);
      const baseRate = tool.completionRate + (model?.completionDelta ?? 0);
      const mCompleted = Math.round(mSessions * baseRate);
      const mAbandoned = Math.round(mSessions * tool.abandonRate);
      const mFailed = Math.max(0, Math.round(mSessions * tool.failRate));
      const mInput = mSessions * tool.inputTokensPerSession;
      const mOutput = mSessions * tool.outputTokensPerSession;
      const mCacheR = mSessions * tool.cacheReadTokensPerSession;
      const mCacheC = mSessions * tool.cacheCreationTokensPerSession;
      toolInput += mInput;
      toolOutput += mOutput;
      toolCacheR += mCacheR;
      toolCacheC += mCacheC;
      const mCost = tool.tokenUsage && model ? (sessionCost(tool, model) ?? null) : null;
      const totalMCost = mCost != null ? Math.round(mCost * mSessions * 100) / 100 : null;
      if (totalMCost != null && toolTotalCost != null) toolTotalCost += totalMCost;
      return {
        model_id: modelId,
        sessions: mSessions,
        completed: mCompleted,
        abandoned: mAbandoned,
        failed: mFailed,
        inputTokens: mInput,
        outputTokens: mOutput,
        cacheReadTokens: mCacheR,
        cacheCreationTokens: mCacheC,
        cost: totalMCost,
      };
    });

    return {
      tool,
      sessions,
      completed,
      abandoned,
      failed,
      unknown,
      totalEdits,
      totalLinesAdded,
      totalLinesRemoved,
      totalSessionHours,
      totalCost: toolTotalCost != null ? Math.round(toolTotalCost * 100) / 100 : null,
      totalInputTokens: toolInput,
      totalOutputTokens: toolOutput,
      totalCacheReadTokens: toolCacheR,
      totalCacheCreationTokens: toolCacheC,
      modelBreakdown,
      commits,
    };
  });

  // 3. Period-level aggregates derived from the ledger
  const totalSessions = ledger.reduce((s, l) => s + l.sessions, 0);
  const totalCompleted = ledger.reduce((s, l) => s + l.completed, 0);
  const totalAbandoned = ledger.reduce((s, l) => s + l.abandoned, 0);
  const totalFailed = ledger.reduce((s, l) => s + l.failed, 0);
  const totalUnknown = ledger.reduce((s, l) => s + l.unknown, 0);
  const totalEdits = ledger.reduce((s, l) => s + l.totalEdits, 0);
  const totalLinesAdded = ledger.reduce((s, l) => s + l.totalLinesAdded, 0);
  const totalLinesRemoved = ledger.reduce((s, l) => s + l.totalLinesRemoved, 0);
  const totalSessionHours = ledger.reduce((s, l) => s + l.totalSessionHours, 0);
  const totalCommits = ledger.reduce((s, l) => s + l.commits, 0);
  const sessionsWithTokens = ledger
    .filter((l) => l.tool.tokenUsage)
    .reduce((s, l) => s + l.sessions, 0);
  const editsInTokenSessions = ledger
    .filter((l) => l.tool.tokenUsage)
    .reduce((s, l) => s + l.totalEdits, 0);
  const totalCost = ledger.reduce((s, l) => s + (l.totalCost ?? 0), 0);
  const totalInput = ledger.reduce((s, l) => s + l.totalInputTokens, 0);
  const totalOutput = ledger.reduce((s, l) => s + l.totalOutputTokens, 0);
  const totalCacheR = ledger.reduce((s, l) => s + l.totalCacheReadTokens, 0);
  const totalCacheC = ledger.reduce((s, l) => s + l.totalCacheCreationTokens, 0);

  // 4. Daily distribution — sessions shape + per-tool per-day breakdown.
  const dailySessionShape = dailyVolumeShape(days, totalSessions);
  const dailyCompleted = allocateIntegerShares(totalCompleted, dailySessionShape);
  const dailyAbandoned = allocateIntegerShares(totalAbandoned, dailySessionShape);
  const dailyFailed = allocateIntegerShares(totalFailed, dailySessionShape);
  const dailyEdits = allocateIntegerShares(totalEdits, dailySessionShape);
  const dailyLinesAdded = allocateIntegerShares(totalLinesAdded, dailySessionShape);
  const dailyLinesRemoved = allocateIntegerShares(totalLinesRemoved, dailySessionShape);
  const dailyCostShape = ledger.some((l) => l.tool.tokenUsage)
    ? dailySessionShape.map((v, i) => v * (0.85 + hash(i + 400) * 0.3))
    : null;
  const dailyCost = dailyCostShape
    ? days.map((_, i) => {
        if (dailySessionShape[i] === 0) return null;
        const share =
          dailyCostShape[i] /
          Math.max(
            1,
            dailyCostShape.reduce((s, v) => s + v, 0),
          );
        return Math.round(totalCost * share * 1000) / 1000;
      })
    : days.map(() => null);

  const daily_trends = days.map((day, i) => {
    const sessions = dailySessionShape[i];
    const edits = dailyEdits[i];
    const cost = dailyCost[i];
    return {
      day,
      sessions,
      edits,
      lines_added: dailyLinesAdded[i],
      lines_removed: dailyLinesRemoved[i],
      avg_duration_min: sessions > 0 ? 22 + Math.round(hash(i + 500) * 8) : 0,
      completed: dailyCompleted[i],
      abandoned: dailyAbandoned[i],
      failed: dailyFailed[i],
      cost,
      cost_per_edit:
        cost != null && edits > 0 ? Math.round((cost / edits) * 10_000) / 10_000 : null,
    };
  });

  // 5. tool_daily — per-tool × per-day session/edit/line counts.
  const tool_daily = ledger.flatMap((l, ti) => {
    const shape = distributeAcrossDays(l.sessions, days, ti * 31);
    const editShape = allocateIntegerShares(l.totalEdits, shape);
    const linesAddedShape = allocateIntegerShares(l.totalLinesAdded, shape);
    const linesRemovedShape = allocateIntegerShares(l.totalLinesRemoved, shape);
    return days.map((day, di) => ({
      host_tool: l.tool.id,
      day,
      sessions: shape[di],
      edits: editShape[di],
      lines_added: linesAddedShape[di],
      lines_removed: linesRemovedShape[di],
      avg_duration_min: shape[di] > 0 ? l.tool.avgDurationMin : 0,
    }));
  });

  // 6. hourly_distribution — 24 hours × 7 days of week
  const hourly_distribution = Array.from({ length: 7 * 24 }, (_, i) => {
    const h = i % 24;
    const dow = Math.floor(i / 24);
    const weekday = dow >= 1 && dow <= 5 ? 1.0 : 0.35;
    const peak =
      h >= 10 && h <= 14 ? 1.0 : h >= 8 && h <= 18 ? 0.55 : h >= 20 && h <= 23 ? 0.22 : 0.08;
    const factor = peak * weekday;
    return {
      hour: h,
      dow,
      sessions: Math.round(14 * factor),
      edits: Math.round(320 * factor),
    };
  });

  // 7. outcome_distribution — global totals
  const outcome_distribution = [
    { outcome: 'completed', count: totalCompleted },
    { outcome: 'abandoned', count: totalAbandoned },
    { outcome: 'failed', count: totalFailed },
    { outcome: 'unknown', count: totalUnknown },
  ].filter((o) => o.count > 0);

  // 8. tool_distribution — per-tool sessions/edits
  const tool_distribution = ledger.map((l) => ({
    host_tool: l.tool.id,
    sessions: l.sessions,
    edits: l.totalEdits,
  }));

  // 9. tool_outcomes — per-tool × outcome
  const tool_outcomes = ledger.flatMap((l) =>
    [
      { host_tool: l.tool.id, outcome: 'completed', count: l.completed },
      { host_tool: l.tool.id, outcome: 'abandoned', count: l.abandoned },
      { host_tool: l.tool.id, outcome: 'failed', count: l.failed },
    ].filter((o) => o.count > 0),
  );

  // 10. tool_comparison
  const tool_comparison = ledger.map((l) => ({
    host_tool: l.tool.id,
    sessions: l.sessions,
    completed: l.completed,
    abandoned: l.abandoned,
    failed: l.failed,
    completion_rate: l.sessions > 0 ? Math.round((l.completed / l.sessions) * 100) : 0,
    avg_duration_min: l.tool.avgDurationMin,
    total_edits: l.totalEdits,
    total_lines_added: l.totalLinesAdded,
    total_lines_removed: l.totalLinesRemoved,
    total_session_hours: l.totalSessionHours,
  }));

  // 11. model_outcomes — model × tool × outcome rows. Completed-only rows
  //     keep model_outcomes compact while retaining the cross-tool attribution
  //     that makes the models widget substrate-unique.
  const model_outcomes = ledger.flatMap((l) =>
    l.modelBreakdown
      .filter((m) => m.completed > 0)
      .map((m) => ({
        agent_model: m.model_id,
        host_tool: l.tool.id,
        outcome: 'completed',
        count: m.completed,
        avg_duration_min: l.tool.avgDurationMin,
        total_edits: Math.round(m.completed * l.tool.editsPerCompletedSession),
        total_lines_added: Math.round(
          m.completed * l.tool.editsPerCompletedSession * l.tool.linesAddedPerEdit,
        ),
        total_lines_removed: Math.round(
          m.completed * l.tool.editsPerCompletedSession * l.tool.linesRemovedPerEdit,
        ),
      })),
  );

  // 12. work_type_distribution
  const workTypeSessions = allocateIntegerShares(
    totalSessions,
    WORK_TYPE_MIX.map((w) => w.share),
  );
  const workTypeEdits = allocateIntegerShares(
    totalEdits,
    WORK_TYPE_MIX.map((w) => w.share),
  );
  const workTypeLinesAdded = allocateIntegerShares(
    totalLinesAdded,
    WORK_TYPE_MIX.map((w) => w.share),
  );
  const workTypeLinesRemoved = allocateIntegerShares(
    totalLinesRemoved,
    WORK_TYPE_MIX.map((w) => w.share),
  );
  const work_type_distribution = WORK_TYPE_MIX.map((w, i) => ({
    work_type: w.work_type,
    sessions: workTypeSessions[i],
    edits: workTypeEdits[i],
    lines_added: workTypeLinesAdded[i],
    lines_removed: workTypeLinesRemoved[i],
    // Approximate distinct-file count per work type. Features touch more
    // files, test/docs touch fewer — correlated with session scope.
    files: Math.max(
      1,
      Math.round(
        workTypeSessions[i] *
          (w.work_type === 'frontend'
            ? 0.8
            : w.work_type === 'backend'
              ? 0.6
              : w.work_type === 'other'
                ? 0.5
                : 0.3),
      ),
    ),
  }));

  // 13. tool_work_type
  const tool_work_type = ledger.flatMap((l) => {
    const ws = allocateIntegerShares(
      l.sessions,
      WORK_TYPE_MIX.map((w) => w.share),
    );
    const we = allocateIntegerShares(
      l.totalEdits,
      WORK_TYPE_MIX.map((w) => w.share),
    );
    return WORK_TYPE_MIX.map((w, i) => {
      const sessions = ws[i];
      // Tool-fit completion rate: each tool has a per-work-type strength
      // profile so the heatmap shows differentiated reads (Claude Code wins
      // backend, Cursor wins styling, Codex wins config). Falls through to
      // the work-type's base rate for tools without a specific profile.
      const profile = TOOL_WORK_TYPE_FIT[l.tool.id];
      const rate = profile?.[w.work_type] ?? w.share * 100 + 60;
      const completion_rate = Math.min(100, Math.max(0, Math.round(rate * 10) / 10));
      const completed = Math.round(sessions * (completion_rate / 100));
      return {
        host_tool: l.tool.id,
        work_type: w.work_type,
        sessions,
        edits: we[i],
        completed,
        completion_rate,
      };
    }).filter((r) => r.sessions > 0);
  });

  // 14. work_type_outcomes
  const work_type_outcomes = WORK_TYPE_MIX.map((w, i) => {
    const sessions = workTypeSessions[i];
    const baseRate =
      w.work_type === 'frontend'
        ? 0.72
        : w.work_type === 'backend'
          ? 0.78
          : w.work_type === 'other'
            ? 0.66
            : w.work_type === 'docs'
              ? 0.88
              : 0.84;
    const completed = Math.round(sessions * baseRate);
    const abandoned = Math.round(sessions * 0.12);
    const failed = Math.max(0, sessions - completed - abandoned);
    return {
      work_type: w.work_type,
      sessions,
      completed,
      abandoned,
      failed,
      completion_rate: sessions > 0 ? Math.round((completed / sessions) * 100) : 0,
    };
  });

  // 15. duration_distribution — non-negative buckets that sum to total
  const durationShape = [0.14, 0.28, 0.3, 0.2, 0.08];
  const durationCounts = allocateIntegerShares(totalSessions, durationShape);
  const duration_distribution = [
    { bucket: '<5min', count: durationCounts[0] },
    { bucket: '5-15min', count: durationCounts[1] },
    { bucket: '15-30min', count: durationCounts[2] },
    { bucket: '30-60min', count: durationCounts[3] },
    { bucket: '>60min', count: durationCounts[4] },
  ];

  // 16. scope_complexity — file-count buckets, completion rate declines
  //     with scope (matches the narrative in the ANALYTICS_SPEC.md reports)
  const scopeShape = [0.34, 0.3, 0.22, 0.14];
  const scopeSessions = allocateIntegerShares(totalSessions, scopeShape);
  const scope_complexity = [
    {
      bucket: '1 file',
      sessions: scopeSessions[0],
      avg_edits: 6,
      avg_duration_min: 11,
      completion_rate: 84,
    },
    {
      bucket: '2-3 files',
      sessions: scopeSessions[1],
      avg_edits: 14,
      avg_duration_min: 20,
      completion_rate: 76,
    },
    {
      bucket: '4-6 files',
      sessions: scopeSessions[2],
      avg_edits: 32,
      avg_duration_min: 36,
      completion_rate: 62,
    },
    {
      bucket: '7+ files',
      sessions: scopeSessions[3],
      avg_edits: 58,
      avg_duration_min: 56,
      completion_rate: 45,
    },
  ];

  // 17. file_heatmap — touch counts proportional to weight
  const totalFileTouches = totalEdits;
  const fileWeights = FILES.map((f) => f.weight);
  const fileTouches = allocateIntegerShares(totalFileTouches, fileWeights);
  const fileLinesAdded = allocateIntegerShares(totalLinesAdded, fileWeights);
  const fileLinesRemoved = allocateIntegerShares(totalLinesRemoved, fileWeights);
  // Work type derived from each file path via the shared classifier —
  // the same function the worker runs against production edits. Keeps
  // the demo aligned with production without a hand-maintained map.
  const file_heatmap = FILES.map((f, i) => ({
    file: f.path,
    touch_count: fileTouches[i],
    work_type: classifyWorkType(f.path),
    outcome_rate: Math.max(42, Math.min(92, 76 - i * 2 + Math.round(hash(i + 50) * 10))),
    total_lines_added: fileLinesAdded[i],
    total_lines_removed: fileLinesRemoved[i],
  }));

  // 18. directory_heatmap
  const dirShape = DIRECTORIES.map((d) => d.share);
  const dirTouches = allocateIntegerShares(totalEdits, dirShape);
  const directory_heatmap = DIRECTORIES.map((d, i) => ({
    directory: d.directory,
    touch_count: dirTouches[i],
    file_count: d.files,
    total_lines: Math.round(dirTouches[i] * 8.5),
    completion_rate: Math.round((0.68 + hash(i + 12) * 0.18) * 100),
  }));

  // 19. file_churn — highly-edited files with session counts
  const file_churn = FILES.slice(0, 10).map((f, i) => ({
    file: f.path,
    session_count: Math.max(2, Math.round(fileTouches[i] / 6)),
    total_edits: fileTouches[i],
    total_lines: fileLinesAdded[i] + fileLinesRemoved[i],
  }));

  // 20. file_rework — retry ratio for stuck files
  const REWORK_FILES = [4, 0, 2, 7, 9]; // indexes into FILES — mix of hot + mid
  const file_rework = REWORK_FILES.map((fi, i) => {
    const touches = fileTouches[fi];
    const failedEdits = Math.max(1, Math.round(touches * (0.18 - i * 0.02)));
    return {
      file: FILES[fi].path,
      total_edits: touches,
      failed_edits: failedEdits,
      rework_ratio: Math.round((failedEdits / touches) * 100),
    };
  });

  // 21. concurrent_edits — files multiple agents touched in overlapping windows
  const concurrent_edits = [0, 2, 5, 6, 8].map((fi, i) => ({
    file: FILES[fi].path,
    agents: 2 + (i % 2),
    edit_count: Math.max(3, Math.round(fileTouches[fi] * 0.22)),
  }));

  // 22. audit_staleness — directories with no recent activity
  const audit_staleness = [
    {
      directory: 'packages/cli/lib/dashboard/screens',
      last_edit: '',
      days_since: 38,
      prior_edit_count: 14,
    },
    { directory: 'packages/worker/migrations', last_edit: '', days_since: 21, prior_edit_count: 8 },
    { directory: 'docs/decisions', last_edit: '', days_since: 15, prior_edit_count: 6 },
  ];

  // 22.5 conversations — sentiment/topic-driven coordination signals.
  // confused_files surfaces the file as the headline (sentiment is ranking
  // input only); cross_tool_handoff_questions models substrate-unique
  // events where one tool gave up mid-question and another picked up the
  // same file cold; unanswered_questions counts open user questions
  // stranded in abandoned sessions. All three feed the conversations
  // category in the catalog.
  const confused_files = [
    { file: FILES[1].path, confused_sessions: 6, retried_sessions: 3 }, // worker/team/context.ts
    { file: FILES[4].path, confused_sessions: 5, retried_sessions: 2 }, // worker/team/memory.ts
    { file: FILES[6].path, confused_sessions: 4, retried_sessions: 0 }, // cli/extraction/engine.ts
    { file: FILES[8].path, confused_sessions: 3, retried_sessions: 1 }, // worker/team/sessions.ts
    { file: FILES[2].path, confused_sessions: 2, retried_sessions: 0 }, // OverviewView.tsx
  ];

  const unanswered_questions = { count: 7 };

  // Cross-tool handoff fixtures. Each row is a (S1.host_tool → S2.host_tool)
  // event keyed by file overlap, with realistic gap times under the 24h
  // window. Pairs are drawn from DEMO_MEMBERS' primary tools so handles
  // remain consistent with member_analytics. ISO timestamps are descending
  // so the rendered list reads newest-first.
  const cross_tool_handoff_questions = [
    {
      file: FILES[1].path, // worker/team/context.ts
      tool_from: 'claude-code',
      tool_to: 'cursor',
      handle_from: 'glendon',
      handle_to: 'glendon',
      gap_minutes: 23,
      handoff_at: '2026-04-25T18:14:00Z',
    },
    {
      file: FILES[6].path, // cli/extraction/engine.ts
      tool_from: 'cursor',
      tool_to: 'claude-code',
      handle_from: 'sora',
      handle_to: 'glendon',
      gap_minutes: 74,
      handoff_at: '2026-04-24T22:09:00Z',
    },
    {
      file: FILES[4].path, // worker/team/memory.ts
      tool_from: 'aider',
      tool_to: 'cline',
      handle_from: 'jae',
      handle_to: 'pax',
      gap_minutes: 215,
      handoff_at: '2026-04-23T13:42:00Z',
    },
    {
      file: FILES[2].path, // OverviewView.tsx
      tool_from: 'cline',
      tool_to: 'cursor',
      handle_from: 'pax',
      handle_to: 'sora',
      gap_minutes: 480,
      handoff_at: '2026-04-22T09:18:00Z',
    },
    {
      file: FILES[0].path, // ToolWidgets.tsx
      tool_from: 'claude-code',
      tool_to: 'aider',
      handle_from: 'glendon',
      handle_to: 'jae',
      gap_minutes: 1140,
      handoff_at: '2026-04-21T16:50:00Z',
    },
  ];

  // 23. member_analytics — per-handle rollups, share of total sessions
  const memberShares = DEMO_MEMBERS.map((m) => m.share);
  const memberSessions = allocateIntegerShares(totalSessions, memberShares);
  const memberEdits = allocateIntegerShares(totalEdits, memberShares);
  const memberHours = allocateIntegerShares(Math.round(totalSessionHours * 100), memberShares).map(
    (v) => v / 100,
  );
  const member_analytics = DEMO_MEMBERS.map((m, i) => {
    const sessions = memberSessions[i];
    const completed = Math.round(sessions * 0.72);
    return {
      handle: m.handle,
      sessions,
      completed,
      completion_rate: sessions > 0 ? Math.round((completed / sessions) * 100) : 0,
      total_edits: memberEdits[i],
      total_session_hours: memberHours[i],
      primary_tool: m.primary_tool,
    };
  });

  // 24. member_daily_lines — per-member × day sparkline series
  const member_daily_lines = DEMO_MEMBERS.flatMap((m, mi) => {
    const shape = distributeAcrossDays(memberSessions[mi], days, 17 + mi * 7);
    const editShape = allocateIntegerShares(memberEdits[mi], shape);
    const linesAddedShape = allocateIntegerShares(Math.round(memberEdits[mi] * 9), shape);
    const linesRemovedShape = allocateIntegerShares(Math.round(memberEdits[mi] * 2.2), shape);
    return days.map((day, di) => ({
      handle: m.handle,
      day,
      sessions: shape[di],
      edits: editShape[di],
      lines_added: linesAddedShape[di],
      lines_removed: linesRemovedShape[di],
    }));
  });

  // 25. per_project rollups — across the three demo teams
  const teamShares = DEMO_TEAMS.map((t) => t.share);
  const teamSessions = allocateIntegerShares(totalSessions, teamShares);
  const teamEdits = allocateIntegerShares(totalEdits, teamShares);
  const teamHours = allocateIntegerShares(Math.round(totalSessionHours * 100), teamShares).map(
    (v) => v / 100,
  );
  const per_project_velocity = DEMO_TEAMS.map((t, i) => ({
    team_id: t.team_id,
    team_name: t.team_name,
    sessions: teamSessions[i],
    total_edits: teamEdits[i],
    total_session_hours: teamHours[i],
    edits_per_hour: teamHours[i] > 0 ? Math.round((teamEdits[i] / teamHours[i]) * 10) / 10 : 0,
    primary_tool: i === 0 ? 'claude-code' : i === 1 ? 'cursor' : 'claude-code',
  }));
  const per_project_lines = DEMO_TEAMS.flatMap((t, ti) => {
    const shape = distributeAcrossDays(teamSessions[ti], days, 211 + ti * 13);
    const editShape = allocateIntegerShares(teamEdits[ti], shape);
    const linesAddedShape = allocateIntegerShares(Math.round(teamEdits[ti] * 9), shape);
    const linesRemovedShape = allocateIntegerShares(Math.round(teamEdits[ti] * 2.2), shape);
    return days.map((day, di) => ({
      team_id: t.team_id,
      team_name: t.team_name,
      day,
      sessions: shape[di],
      edits: editShape[di],
      lines_added: linesAddedShape[di],
      lines_removed: linesRemovedShape[di],
    }));
  });

  // 26. retry_patterns — file-centric retry rows
  const retry_patterns = [
    {
      file: 'packages/worker/src/dos/team/context.ts',
      attempts: 8,
      agents: 3,
      tools: ['claude-code', 'cursor'],
      final_outcome: 'completed',
      resolved: true,
    },
    {
      file: 'packages/web/src/widgets/bodies/ToolWidgets.tsx',
      attempts: 6,
      agents: 2,
      tools: ['claude-code'],
      final_outcome: 'completed',
      resolved: true,
    },
    {
      file: 'packages/shared/tool-registry.ts',
      attempts: 5,
      agents: 2,
      tools: ['claude-code', 'aider'],
      final_outcome: 'abandoned',
      resolved: false,
    },
    {
      file: 'packages/worker/src/dos/team/memory.ts',
      attempts: 4,
      agents: 2,
      tools: ['claude-code', 'cursor'],
      final_outcome: 'completed',
      resolved: true,
    },
    {
      file: 'packages/mcp/lib/tools/conflicts.ts',
      attempts: 4,
      agents: 1,
      tools: ['claude-code'],
      final_outcome: 'completed',
      resolved: true,
    },
  ];

  // 27. conflict data
  const conflict_stats = { blocked_period: 7, found_period: 18, daily_blocked: [] };
  const sessionsWithConflicts = Math.round(totalSessions * 0.19);
  const sessionsWithoutConflicts = totalSessions - sessionsWithConflicts;
  const completedWithConflicts = Math.round(sessionsWithConflicts * 0.58);
  const completedWithoutConflicts = Math.round(sessionsWithoutConflicts * 0.76);
  const conflict_correlation = [
    {
      bucket: 'with conflicts',
      sessions: sessionsWithConflicts,
      completed: completedWithConflicts,
      completion_rate:
        sessionsWithConflicts > 0
          ? Math.round((completedWithConflicts / sessionsWithConflicts) * 100)
          : 0,
    },
    {
      bucket: 'without',
      sessions: sessionsWithoutConflicts,
      completed: completedWithoutConflicts,
      completion_rate:
        sessionsWithoutConflicts > 0
          ? Math.round((completedWithoutConflicts / sessionsWithoutConflicts) * 100)
          : 0,
    },
  ];

  // 28. edit_velocity — trailing 14 days
  const edit_velocity = daily_trends.slice(-14).map((d) => {
    const hours = (d.sessions * d.avg_duration_min) / 60;
    return {
      day: d.day,
      edits_per_hour: hours > 0 ? Math.round((d.edits / hours) * 10) / 10 : 0,
      lines_per_hour: hours > 0 ? Math.round((d.lines_added / hours) * 10) / 10 : 0,
      total_session_hours: Math.round(hours * 100) / 100,
    };
  });

  // 29. prompt_efficiency — per-day avg turns per edit
  const prompt_efficiency = days.slice(-14).map((day, i) => ({
    day,
    avg_turns_per_edit:
      dailySessionShape[dailySessionShape.length - 14 + i] === 0
        ? null
        : Math.round((1.4 + hash(i + 99) * 0.6) * 10) / 10,
    sessions: dailySessionShape[dailySessionShape.length - 14 + i] ?? 0,
  }));

  // 30. hourly_effectiveness
  const hourly_effectiveness = Array.from({ length: 24 }, (_, h) => {
    const peak =
      h >= 10 && h <= 14 ? 1.0 : h >= 8 && h <= 18 ? 0.55 : h >= 20 && h <= 23 ? 0.22 : 0.08;
    const sessions = Math.round(14 * peak);
    const completion_rate = Math.round((0.56 + peak * 0.24) * 100);
    return {
      hour: h,
      sessions,
      completion_rate,
      avg_edits: Math.round(22 * peak),
    };
  });

  // 31. conversation_edit_correlation — turns buckets
  const ccSessions = allocateIntegerShares(
    Math.round(totalSessions * 0.64),
    [0.28, 0.36, 0.24, 0.12],
  );
  const conversation_edit_correlation = [
    { bucket: '1-3', sessions: ccSessions[0], avg_edits: 4.2, avg_lines: 38, completion_rate: 72 },
    {
      bucket: '4-8',
      sessions: ccSessions[1],
      avg_edits: 12.8,
      avg_lines: 118,
      completion_rate: 78,
    },
    {
      bucket: '9-15',
      sessions: ccSessions[2],
      avg_edits: 24.4,
      avg_lines: 232,
      completion_rate: 68,
    },
    {
      bucket: '16+',
      sessions: ccSessions[3],
      avg_edits: 48.6,
      avg_lines: 486,
      completion_rate: 52,
    },
  ];

  // 32. memory_usage + memory_outcome_correlation + top_memories
  const totalMemories = 28;
  const searches = 142;
  const searches_with_results = 104;
  const memory_usage = {
    total_memories: totalMemories,
    searches,
    searches_with_results,
    search_hit_rate: Math.round((searches_with_results / searches) * 100),
    memories_created_period: 7,
    stale_memories: 3,
    avg_memory_age_days: 42,
    pending_consolidation_proposals: 1,
    formation_observations_by_recommendation: { keep: 11, merge: 2, evolve: 1, discard: 1 },
    secrets_blocked_24h: 0,
  };
  const mocWithMemories = Math.round(totalSessions * 0.54);
  const mocWithoutMemories = totalSessions - mocWithMemories;
  const memory_outcome_correlation = [
    {
      bucket: 'with memory',
      sessions: mocWithMemories,
      completed: Math.round(mocWithMemories * 0.82),
      completion_rate: 82,
    },
    {
      bucket: 'without',
      sessions: mocWithoutMemories,
      completed: Math.round(mocWithoutMemories * 0.64),
      completion_rate: 64,
    },
  ];
  const top_memories = [
    {
      id: 'mem-1',
      text_preview:
        'SQLite on Durable Objects has no native vector ops — use embedding similarity with memories_embeddings blob.',
      access_count: 28,
      last_accessed_at: new Date(Date.now() - 26 * 60_000).toISOString(),
    },
    {
      id: 'mem-2',
      text_preview:
        'Every read endpoint must verify the caller has access — never assume URL is proof of authorization.',
      access_count: 22,
      last_accessed_at: new Date(Date.now() - 2.8 * 3600_000).toISOString(),
    },
    {
      id: 'mem-3',
      text_preview:
        'All AI moderation uses Llama Guard 3 via env.AI binding — strictly better than OpenAI Moderation for our taxonomy.',
      access_count: 18,
      last_accessed_at: new Date(Date.now() - 45 * 60_000).toISOString(),
    },
    {
      id: 'mem-4',
      text_preview:
        'Access tokens use 90-day sliding window TTL — renewed in withAuth middleware on every authenticated hit.',
      access_count: 15,
      last_accessed_at: new Date(Date.now() - 11 * 3600_000).toISOString(),
    },
    {
      id: 'mem-5',
      text_preview:
        'DO RPC not fetch — except TeamDO.fetch for WebSocket upgrade, which sets X-Chinmeister-Verified: 1 header.',
      access_count: 12,
      last_accessed_at: new Date(Date.now() - 28 * 3600_000).toISOString(),
    },
    {
      id: 'mem-6',
      text_preview:
        'Handlers validate, DOs trust — defense in depth: DOs still cap string lengths (tool.slice(0, 100) etc.).',
      access_count: 9,
      last_accessed_at: new Date(Date.now() - 3.2 * 86400_000).toISOString(),
    },
  ];

  // 33. first_edit_stats
  const first_edit_stats = {
    avg_minutes_to_first_edit:
      Math.round(
        (ledger.reduce((s, l) => s + l.tool.avgFirstEditMin * l.sessions, 0) /
          Math.max(1, totalSessions)) *
          10,
      ) / 10,
    median_minutes_to_first_edit: 2.6,
    by_tool: ledger.map((l) => ({
      host_tool: l.tool.id,
      avg_minutes: l.tool.avgFirstEditMin,
      sessions: l.sessions,
    })),
  };

  // 34. stuckness
  const stuckSessions = Math.round(
    ledger.reduce((s, l) => s + l.sessions * l.tool.stucknessRate, 0),
  );
  const stuck_completed = Math.round(stuckSessions * 0.34);
  const normal_sessions = totalSessions - stuckSessions;
  const normal_completed = totalCompleted - stuck_completed;
  const stuckness = {
    total_sessions: totalSessions,
    stuck_sessions: stuckSessions,
    stuckness_rate: Math.round((stuckSessions / totalSessions) * 100),
    stuck_completion_rate:
      stuckSessions > 0 ? Math.round((stuck_completed / stuckSessions) * 100) : 0,
    normal_completion_rate:
      normal_sessions > 0 ? Math.round((normal_completed / normal_sessions) * 100) : 0,
  };

  // 35. file_overlap (team-scoped coordination stat)
  const file_overlap = { total_files: FILES.length + 142, overlapping_files: 14 };

  // 36. outcome_tags — free-form outcome tags agents report
  const outcome_tags = [
    { tag: 'shipped', count: Math.round(totalCompleted * 0.44), outcome: 'completed' },
    { tag: 'partial', count: Math.round(totalCompleted * 0.22), outcome: 'completed' },
    { tag: 'exploratory', count: Math.round(totalCompleted * 0.14), outcome: 'completed' },
    { tag: 'blocked', count: Math.round(totalAbandoned * 0.4), outcome: 'abandoned' },
    { tag: 'stale', count: Math.round(totalAbandoned * 0.3), outcome: 'abandoned' },
  ];

  // 37. tool_handoffs — cross-tool file transitions with recent_files
  const tool_handoffs = [
    {
      from_tool: 'claude-code',
      to_tool: 'cursor',
      file_count: 14,
      handoff_completion_rate: 71,
      avg_gap_minutes: 42,
      recent_files: [
        {
          file_path: 'packages/web/src/widgets/bodies/ToolWidgets.tsx',
          last_transition_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
          a_edits: 8,
          b_edits: 3,
          completed: true,
        },
        {
          file_path: 'packages/web/src/views/OverviewView/OverviewView.tsx',
          last_transition_at: new Date(Date.now() - 8 * 3600_000).toISOString(),
          a_edits: 4,
          b_edits: 6,
          completed: true,
        },
      ],
    },
    {
      from_tool: 'cursor',
      to_tool: 'claude-code',
      file_count: 9,
      handoff_completion_rate: 78,
      avg_gap_minutes: 28,
      recent_files: [
        {
          file_path: 'packages/worker/src/dos/team/sessions.ts',
          last_transition_at: new Date(Date.now() - 4 * 3600_000).toISOString(),
          a_edits: 2,
          b_edits: 7,
          completed: true,
        },
      ],
    },
    {
      from_tool: 'claude-code',
      to_tool: 'aider',
      file_count: 5,
      handoff_completion_rate: 82,
      avg_gap_minutes: 64,
      recent_files: [],
    },
  ];

  // 38. token_usage — derived from ledger
  const avgInputPerSession =
    sessionsWithTokens > 0 ? Math.round(totalInput / sessionsWithTokens) : 0;
  const avgOutputPerSession =
    sessionsWithTokens > 0 ? Math.round(totalOutput / sessionsWithTokens) : 0;
  const cache_hit_rate =
    totalInput + totalCacheR + totalCacheC > 0
      ? Math.round((totalCacheR / (totalInput + totalCacheR + totalCacheC)) * 1000) / 1000
      : null;
  const byModel = new Map<
    string,
    {
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_creation_tokens: number;
      sessions: number;
      cost: number | null;
    }
  >();
  for (const l of ledger) {
    for (const m of l.modelBreakdown) {
      const existing = byModel.get(m.model_id) ?? {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        sessions: 0,
        cost: 0,
      };
      existing.input_tokens += m.inputTokens;
      existing.output_tokens += m.outputTokens;
      existing.cache_read_tokens += m.cacheReadTokens;
      existing.cache_creation_tokens += m.cacheCreationTokens;
      existing.sessions += m.sessions;
      if (m.cost == null) existing.cost = null;
      else if (existing.cost != null) existing.cost += m.cost;
      byModel.set(m.model_id, existing);
    }
  }
  const token_by_model = [...byModel.entries()]
    .filter(([_, v]) => v.sessions > 0 && v.input_tokens > 0)
    .map(([model, v]) => ({
      agent_model: model,
      input_tokens: v.input_tokens,
      output_tokens: v.output_tokens,
      cache_read_tokens: v.cache_read_tokens,
      cache_creation_tokens: v.cache_creation_tokens,
      sessions: v.sessions,
      estimated_cost_usd: v.cost != null ? Math.round(v.cost * 100) / 100 : null,
    }));
  const token_by_tool = ledger
    .filter((l) => l.tool.tokenUsage)
    .map((l) => ({
      host_tool: l.tool.id,
      input_tokens: l.totalInputTokens,
      output_tokens: l.totalOutputTokens,
      cache_read_tokens: l.totalCacheReadTokens,
      cache_creation_tokens: l.totalCacheCreationTokens,
      sessions: l.sessions,
    }));
  const token_usage = {
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    total_cache_read_tokens: totalCacheR,
    total_cache_creation_tokens: totalCacheC,
    avg_input_per_session: avgInputPerSession,
    avg_output_per_session: avgOutputPerSession,
    sessions_with_token_data: sessionsWithTokens,
    sessions_without_token_data: totalSessions - sessionsWithTokens,
    total_edits_in_token_sessions: editsInTokenSessions,
    total_estimated_cost_usd: Math.round(totalCost * 100) / 100,
    pricing_refreshed_at: new Date(Date.now() - 6 * 3600_000).toISOString(),
    pricing_is_stale: false,
    models_without_pricing: [],
    models_without_pricing_total: 0,
    cost_per_edit:
      editsInTokenSessions > 0
        ? Math.round((totalCost / editsInTokenSessions) * 10_000) / 10_000
        : null,
    cache_hit_rate,
    by_model: token_by_model,
    by_tool: token_by_tool,
  };

  // 39. tool_call_stats
  const tool_call_sessions = ledger
    .filter((l) => l.tool.toolCallLogs)
    .reduce((s, l) => s + l.sessions, 0);
  const callsPerSession = 26;
  const total_calls = tool_call_sessions * callsPerSession;
  const total_errors = Math.round(total_calls * 0.029);
  const frequency = [
    {
      tool: 'Read',
      calls: Math.round(total_calls * 0.29),
      errors: Math.round(total_errors * 0.12),
      error_rate: 0.012,
      avg_duration_ms: 120,
      sessions: tool_call_sessions,
    },
    {
      tool: 'Edit',
      calls: Math.round(total_calls * 0.2),
      errors: Math.round(total_errors * 0.18),
      error_rate: 0.026,
      avg_duration_ms: 240,
      sessions: tool_call_sessions,
    },
    {
      tool: 'Bash',
      calls: Math.round(total_calls * 0.15),
      errors: Math.round(total_errors * 0.38),
      error_rate: 0.074,
      avg_duration_ms: 1200,
      sessions: Math.round(tool_call_sessions * 0.74),
    },
    {
      tool: 'Grep',
      calls: Math.round(total_calls * 0.13),
      errors: Math.round(total_errors * 0.05),
      error_rate: 0.011,
      avg_duration_ms: 180,
      sessions: Math.round(tool_call_sessions * 0.86),
    },
    {
      tool: 'Glob',
      calls: Math.round(total_calls * 0.08),
      errors: Math.round(total_errors * 0.03),
      error_rate: 0.011,
      avg_duration_ms: 90,
      sessions: Math.round(tool_call_sessions * 0.72),
    },
    {
      tool: 'Write',
      calls: Math.round(total_calls * 0.08),
      errors: Math.round(total_errors * 0.14),
      error_rate: 0.052,
      avg_duration_ms: 220,
      sessions: Math.round(tool_call_sessions * 0.58),
    },
    {
      tool: 'WebFetch',
      calls: Math.round(total_calls * 0.04),
      errors: Math.round(total_errors * 0.08),
      error_rate: 0.061,
      avg_duration_ms: 2800,
      sessions: Math.round(tool_call_sessions * 0.28),
    },
    {
      tool: 'Task',
      calls: Math.round(total_calls * 0.02),
      errors: Math.round(total_errors * 0.02),
      error_rate: 0.027,
      avg_duration_ms: 18000,
      sessions: Math.round(tool_call_sessions * 0.18),
    },
    {
      tool: 'mcp__chinmeister__chinmeister_search_memory',
      calls: Math.round(total_calls * 0.006),
      errors: 2,
      error_rate: 0.009,
      avg_duration_ms: 340,
      sessions: Math.round(tool_call_sessions * 0.42),
    },
    {
      tool: 'mcp__chinmeister__chinmeister_update_activity',
      calls: Math.round(total_calls * 0.004),
      errors: 1,
      error_rate: 0.006,
      avg_duration_ms: 180,
      sessions: Math.round(tool_call_sessions * 0.38),
    },
  ];
  const error_patterns = [
    {
      tool: 'Bash',
      error_preview: 'No such file or directory',
      count: Math.round(total_errors * 0.24),
      last_at: new Date(Date.now() - 1.2 * 3600_000).toISOString(),
    },
    {
      tool: 'Edit',
      error_preview: 'File has been modified since last read',
      count: Math.round(total_errors * 0.18),
      last_at: new Date(Date.now() - 4 * 3600_000).toISOString(),
    },
    {
      tool: 'Bash',
      error_preview: 'Command timed out after 120s',
      count: Math.round(total_errors * 0.12),
      last_at: new Date(Date.now() - 9 * 3600_000).toISOString(),
    },
    {
      tool: 'Grep',
      error_preview: 'Pattern did not match any files',
      count: Math.round(total_errors * 0.08),
      last_at: new Date(Date.now() - 14 * 3600_000).toISOString(),
    },
    {
      tool: 'Write',
      error_preview: 'File already exists; use Edit to modify',
      count: Math.round(total_errors * 0.06),
      last_at: new Date(Date.now() - 28 * 3600_000).toISOString(),
    },
    {
      tool: 'WebFetch',
      error_preview: 'Request failed with status 429 rate limit',
      count: Math.round(total_errors * 0.04),
      last_at: new Date(Date.now() - 38 * 3600_000).toISOString(),
    },
  ];
  const one_shot_sessions = Math.round(
    ledger
      .filter((l) => l.tool.toolCallLogs)
      .reduce((s, l) => s + l.sessions * l.tool.oneShotRate, 0),
  );
  const avg_one_shot_rate =
    tool_call_sessions > 0 ? Math.round((one_shot_sessions / tool_call_sessions) * 100) : 0;
  const research_to_edit_ratio =
    ledger
      .filter((l) => l.tool.toolCallLogs)
      .reduce((s, l) => s + l.tool.researchToEditRatio * l.sessions, 0) /
    Math.max(1, tool_call_sessions);
  const tool_call_stats = {
    total_calls,
    total_errors,
    error_rate: total_calls > 0 ? Math.round((total_errors / total_calls) * 1000) / 10 : 0,
    avg_duration_ms: 380,
    calls_per_session: callsPerSession,
    research_to_edit_ratio: Math.round(research_to_edit_ratio * 10) / 10,
    one_shot_rate: avg_one_shot_rate,
    one_shot_sessions,
    frequency,
    error_patterns,
    hourly_activity: Array.from({ length: 24 }, (_, h) => {
      const peak =
        h >= 10 && h <= 14 ? 1.0 : h >= 8 && h <= 18 ? 0.55 : h >= 20 && h <= 23 ? 0.22 : 0.08;
      return { hour: h, calls: Math.round(280 * peak), errors: Math.round(8 * peak) };
    }),
    // Per-host-tool one-shot rate. Uses each tool's narrative oneShotRate
    // weighted by sessions so the demo reads as differentiated competing
    // tools (Claude Code wins; Cursor middling; Aider trails). Tools without
    // tool-call capture are excluded — they would render '—' in the widget.
    host_one_shot: ledger
      .filter((l) => l.tool.toolCallLogs && l.sessions > 0)
      .map((l) => ({
        host_tool: l.tool.id,
        one_shot_rate: Math.round(l.tool.oneShotRate * 100),
        sessions: l.sessions,
      }))
      .sort((a, b) => b.sessions - a.sessions),
  };

  // 40. commit_stats
  const sessions_with_commits = Math.round(totalCommits * 0.76);
  const commit_by_tool = ledger
    .filter((l) => l.tool.commitTracking && l.commits > 0)
    .map((l) => ({
      host_tool: l.tool.id,
      commits: l.commits,
      avg_files_changed: l.tool.id === 'aider' ? 2.8 : 3.1,
      avg_lines: Math.round(l.totalLinesAdded / Math.max(1, l.commits)),
    }));
  const commit_stats = {
    total_commits: totalCommits,
    commits_per_session:
      totalSessions > 0 ? Math.round((totalCommits / totalSessions) * 100) / 100 : 0,
    sessions_with_commits,
    avg_time_to_first_commit_min: 18.4,
    by_tool: commit_by_tool,
    daily_commits: daily_trends.map((d) => ({
      day: d.day,
      commits: Math.max(0, Math.round(d.sessions * 0.22)),
    })),
    outcome_correlation: [
      {
        bucket: 'with commits',
        sessions: sessions_with_commits,
        completed: Math.round(sessions_with_commits * 0.88),
        completion_rate: 88,
      },
      {
        bucket: 'without',
        sessions: totalSessions - sessions_with_commits,
        completed: Math.round((totalSessions - sessions_with_commits) * 0.66),
        completion_rate: 66,
      },
    ],
    commit_edit_ratio: [
      {
        bucket: '1-5 edits',
        sessions: Math.round(totalSessions * 0.28),
        completion_rate: 82,
        avg_edits: 3,
        avg_commits: 0.3,
      },
      {
        bucket: '6-20 edits',
        sessions: Math.round(totalSessions * 0.38),
        completion_rate: 76,
        avg_edits: 12,
        avg_commits: 1.2,
      },
      {
        bucket: '21-50 edits',
        sessions: Math.round(totalSessions * 0.22),
        completion_rate: 64,
        avg_edits: 32,
        avg_commits: 2.1,
      },
      {
        bucket: '50+ edits',
        sessions: Math.round(totalSessions * 0.12),
        completion_rate: 48,
        avg_edits: 72,
        avg_commits: 3.4,
      },
    ],
  };

  // 41. period_comparison — current from ledger, previous ~14% lower so the
  //     delta arrows have a clear positive signal out of the box.
  const previousScale = 0.86;
  const prev_cost = Math.round(totalCost * previousScale * 1.08 * 100) / 100; // higher cost per edit before
  const prev_edits = Math.round(editsInTokenSessions * previousScale);
  const currCompletionRate = Math.round((totalCompleted / totalSessions) * 1000) / 10;
  const period_comparison = {
    current: {
      completion_rate: currCompletionRate,
      avg_duration_min: 24,
      stuckness_rate: stuckness.stuckness_rate,
      memory_hit_rate: memory_usage.search_hit_rate,
      edit_velocity: Math.round((totalEdits / Math.max(1, totalSessionHours)) * 10) / 10,
      total_sessions: totalSessions,
      total_estimated_cost_usd: Math.round(totalCost * 100) / 100,
      total_edits_in_token_sessions: editsInTokenSessions,
      cost_per_edit:
        editsInTokenSessions > 0
          ? Math.round((totalCost / editsInTokenSessions) * 10_000) / 10_000
          : null,
    },
    previous: {
      completion_rate: Math.max(0, Math.round((currCompletionRate - 6.2) * 10) / 10),
      avg_duration_min: 27,
      stuckness_rate: stuckness.stuckness_rate + 3,
      memory_hit_rate: Math.max(0, memory_usage.search_hit_rate - 9),
      edit_velocity:
        Math.round(
          ((totalEdits * previousScale) / Math.max(1, totalSessionHours * previousScale)) * 10,
        ) /
          10 -
        0.3,
      total_sessions: Math.round(totalSessions * previousScale),
      total_estimated_cost_usd: prev_cost,
      total_edits_in_token_sessions: prev_edits,
      cost_per_edit: prev_edits > 0 ? Math.round((prev_cost / prev_edits) * 10_000) / 10_000 : null,
    },
  };

  // 42. data_coverage — derive from tool capabilities
  const activeTools = ledger.filter((l) => l.sessions > 0).map((l) => l.tool.id);
  const capsAvailable = new Set<string>();
  for (const l of ledger) {
    if (l.sessions === 0) continue;
    if (l.tool.hooks) capsAvailable.add('hooks');
    if (l.tool.tokenUsage) capsAvailable.add('tokenUsage');
    if (l.tool.conversationLogs) capsAvailable.add('conversationLogs');
    if (l.tool.toolCallLogs) capsAvailable.add('toolCallLogs');
    if (l.tool.commitTracking) capsAvailable.add('commitTracking');
  }
  const allCaps = ['hooks', 'tokenUsage', 'conversationLogs', 'toolCallLogs', 'commitTracking'];
  const capsMissing = allCaps.filter((c) => !capsAvailable.has(c));
  const data_coverage = {
    tools_reporting: activeTools,
    tools_without_data: [],
    coverage_rate: 1,
    capabilities_available: [...capsAvailable],
    capabilities_missing: capsMissing,
  };

  // 43. daily_metrics (flat metric timeline — legacy format)
  const daily_metrics = daily_trends.map((d) => ({
    date: d.day,
    metric: 'sessions',
    count: d.sessions,
  }));

  // Silence unused warning — wobble is exported as part of this module's
  // toolkit for scenarios that want intentional day-to-day variance.
  void wobble;
  void MODEL_PROFILES;

  // files_by_work_type: canonical work-type buckets (frontend/backend/test/…),
  // not the demo's feature/fix/refactor labels. Classifier-normalized names are
  // what the real backend emits, and the hero strip's palette resolves by those
  // keys. Shares here are a plausible-looking breadth mix for a full-stack app.
  const filesTouchedTotal = FILES.length + 31;
  const filesByWorkTypeShares: Array<[string, number]> = [
    ['frontend', 0.3],
    ['backend', 0.26],
    ['test', 0.18],
    ['styling', 0.1],
    ['config', 0.08],
    ['docs', 0.05],
    ['other', 0.03],
  ];
  const filesByWorkTypeCounts = allocateIntegerShares(
    filesTouchedTotal,
    filesByWorkTypeShares.map(([, s]) => s),
  );
  const files_by_work_type = filesByWorkTypeShares.map(([work_type], i) => ({
    work_type,
    file_count: filesByWorkTypeCounts[i] ?? 0,
  }));

  // Plausible new-vs-revisited split for a mid-week snapshot: slight
  // majority of files are returning ground (~60/40), which matches the
  // rhythm of an active codebase where pure-new surface is rarer.
  const newFiles = Math.round(filesTouchedTotal * 0.42);
  const files_new_vs_revisited = {
    new_files: newFiles,
    revisited_files: filesTouchedTotal - newFiles,
  };

  return {
    ok: true,
    period_days: periodDays,
    teams_included: DEMO_TEAMS.length,
    degraded: false,
    file_heatmap,
    files_touched_total: filesTouchedTotal,
    // Mid-period snapshot with a modest breadth increase in the current
    // half — agents exploring slightly wider surface late in the window.
    // Shaped as the worker's real split (distinct-file count per half),
    // not a naive halving of the total.
    files_touched_half_split: {
      current: Math.round(filesTouchedTotal * 0.58),
      previous: Math.round(filesTouchedTotal * 0.5),
    },
    files_by_work_type,
    files_new_vs_revisited,
    daily_trends,
    tool_distribution,
    outcome_distribution,
    daily_metrics,
    hourly_distribution,
    tool_daily,
    model_outcomes,
    tool_outcomes,
    completion_summary: {
      total_sessions: totalSessions,
      completed: totalCompleted,
      abandoned: totalAbandoned,
      failed: totalFailed,
      unknown: totalUnknown,
      // 0-100 scale with 1 decimal — matches worker output format
      // (Math.round(x * 1000) / 10). Consumers render `{rate}%` directly.
      completion_rate: Math.round((totalCompleted / totalSessions) * 1000) / 10,
      prev_completion_rate: period_comparison.previous
        ? period_comparison.previous.completion_rate
        : null,
    },
    tool_comparison,
    work_type_distribution,
    tool_work_type,
    file_churn,
    duration_distribution,
    concurrent_edits,
    member_analytics,
    member_analytics_total: member_analytics.length,
    member_daily_lines,
    per_project_lines,
    per_project_velocity,
    retry_patterns,
    conflict_correlation,
    conflict_stats,
    edit_velocity,
    memory_usage,
    work_type_outcomes,
    conversation_edit_correlation,
    confused_files,
    unanswered_questions,
    cross_tool_handoff_questions,
    // Memory category fixtures sized off memory_usage above (total=28,
    // stale=3, pending_consolidation_proposals=1). Aging buckets sum to
    // total; supersession.pending mirrors memory_usage; cross-tool flow
    // expresses author→consumer pairs across the active tool set.
    cross_tool_memory_flow: [
      { author_tool: 'claude-code', consumer_tool: 'cursor', memories: 9, consumer_sessions: 14 },
      { author_tool: 'claude-code', consumer_tool: 'aider', memories: 6, consumer_sessions: 5 },
      { author_tool: 'cursor', consumer_tool: 'claude-code', memories: 5, consumer_sessions: 11 },
      { author_tool: 'cursor', consumer_tool: 'aider', memories: 3, consumer_sessions: 4 },
      { author_tool: 'aider', consumer_tool: 'claude-code', memories: 2, consumer_sessions: 8 },
      { author_tool: 'aider', consumer_tool: 'cursor', memories: 1, consumer_sessions: 6 },
    ],
    memory_aging: { recent_7d: 7, recent_30d: 11, recent_90d: 7, older: 3 },
    memory_categories: [
      { category: 'auth', count: 6, last_used_at: nowMinusDays(2) },
      { category: 'deploy', count: 5, last_used_at: nowMinusDays(1) },
      { category: 'testing', count: 4, last_used_at: nowMinusDays(4) },
      { category: 'api', count: 4, last_used_at: nowMinusDays(0) },
      { category: 'workflow', count: 3, last_used_at: nowMinusDays(7) },
      { category: 'config', count: 3, last_used_at: nowMinusDays(11) },
      { category: 'patterns', count: 2, last_used_at: nowMinusDays(15) },
      { category: 'infra', count: 1, last_used_at: nowMinusDays(22) },
    ],
    memory_single_author_directories: [
      { directory: 'packages/worker/dos/team', single_author_count: 7, total_count: 8 },
      { directory: 'packages/web/src/widgets', single_author_count: 4, total_count: 9 },
      { directory: 'packages/mcp/lib/tools', single_author_count: 3, total_count: 4 },
      { directory: 'packages/cli/lib/commands', single_author_count: 2, total_count: 5 },
      { directory: 'packages/shared/contracts', single_author_count: 2, total_count: 3 },
    ],
    memory_supersession: { invalidated_period: 2, merged_period: 4, pending_proposals: 1 },
    memory_secrets_shield: { blocked_period: 0, blocked_24h: 0 },
    file_rework,
    directory_heatmap,
    stuckness,
    file_overlap,
    audit_staleness,
    first_edit_stats,
    memory_outcome_correlation,
    top_memories,
    scope_complexity,
    prompt_efficiency,
    hourly_effectiveness,
    outcome_tags,
    tool_handoffs,
    period_comparison,
    token_usage,
    tool_call_stats,
    commit_stats,
    data_coverage,
  };
}
