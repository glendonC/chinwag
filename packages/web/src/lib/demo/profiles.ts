// Tool and model profiles — the single source of truth every aggregate in
// the demo derives from. Adding a new tool or retuning a completion rate
// ripples through tool_distribution, tool_comparison, model_outcomes,
// token_usage.by_tool, completion_summary, etc. automatically. Do not
// repeat these numbers elsewhere.

export interface ToolProfile {
  id: string;
  sessionShare: number;
  models: string[]; // model ids attributed to this tool, ordered by dominance
  completionRate: number;
  abandonRate: number;
  failRate: number;
  avgDurationMin: number;
  editsPerCompletedSession: number;
  linesAddedPerEdit: number;
  linesRemovedPerEdit: number;
  commitsPerCompletedSession: number;
  oneShotRate: number;
  researchToEditRatio: number;
  avgFirstEditMin: number;
  stucknessRate: number;
  // Capabilities — drive data_coverage and coverage notes.
  hooks: boolean;
  tokenUsage: boolean;
  conversationLogs: boolean;
  toolCallLogs: boolean;
  commitTracking: boolean;
  // Per-session token averages (only meaningful when tokenUsage is true).
  inputTokensPerSession: number;
  outputTokensPerSession: number;
  cacheReadTokensPerSession: number;
  cacheCreationTokensPerSession: number;
}

export interface ModelProfile {
  id: string;
  // Pricing in USD per 1M tokens. null = no pricing available (the demo's
  // models-without-pricing scenario flips specific models to null).
  inputCostPer1M: number | null;
  outputCostPer1M: number | null;
  cacheReadCostPer1M: number | null;
  cacheCreationCostPer1M: number | null;
  // Additive completion bonus/malus on top of the tool's base rate. Small
  // — the dominant signal is still the tool.
  completionDelta: number;
}

// Ordered so higher-share tools come first; derivations iterate in this
// order, which keeps widget render order intuitive (Claude Code first).
// Session shares intentionally do not sum to 1.0 — they're normalized in
// allocateIntegerShares so rounding lands deterministically.
export const TOOL_PROFILES: ToolProfile[] = [
  {
    id: 'claude-code',
    sessionShare: 0.52,
    models: ['claude-sonnet-4-5-20250514', 'claude-opus-4-7', 'claude-haiku-4-5-20251001'],
    completionRate: 0.74,
    abandonRate: 0.14,
    failRate: 0.05,
    avgDurationMin: 27,
    editsPerCompletedSession: 22,
    linesAddedPerEdit: 9.5,
    linesRemovedPerEdit: 2.4,
    commitsPerCompletedSession: 0.38,
    oneShotRate: 0.68,
    researchToEditRatio: 1.8,
    avgFirstEditMin: 2.9,
    stucknessRate: 0.12,
    hooks: true,
    tokenUsage: true,
    conversationLogs: true,
    toolCallLogs: true,
    commitTracking: true,
    inputTokensPerSession: 32_000,
    outputTokensPerSession: 2_400,
    cacheReadTokensPerSession: 148_000,
    cacheCreationTokensPerSession: 7_200,
  },
  {
    id: 'cursor',
    sessionShare: 0.23,
    models: ['claude-sonnet-4-5-20250514', 'gpt-5'],
    completionRate: 0.71,
    abandonRate: 0.18,
    failRate: 0.05,
    avgDurationMin: 19,
    editsPerCompletedSession: 14,
    linesAddedPerEdit: 8.2,
    linesRemovedPerEdit: 2.1,
    commitsPerCompletedSession: 0.28,
    oneShotRate: 0.62,
    researchToEditRatio: 1.5,
    avgFirstEditMin: 4.1,
    stucknessRate: 0.15,
    hooks: true,
    tokenUsage: false,
    conversationLogs: false,
    toolCallLogs: true,
    commitTracking: true,
    inputTokensPerSession: 0,
    outputTokensPerSession: 0,
    cacheReadTokensPerSession: 0,
    cacheCreationTokensPerSession: 0,
  },
  {
    id: 'codex',
    sessionShare: 0.1,
    models: ['gpt-5', 'gpt-5-codex'],
    completionRate: 0.72,
    abandonRate: 0.16,
    failRate: 0.06,
    avgDurationMin: 21,
    editsPerCompletedSession: 17,
    linesAddedPerEdit: 7.8,
    linesRemovedPerEdit: 2.0,
    commitsPerCompletedSession: 0,
    oneShotRate: 0.59,
    researchToEditRatio: 1.4,
    avgFirstEditMin: 5.1,
    stucknessRate: 0.14,
    hooks: false,
    tokenUsage: true,
    conversationLogs: true,
    toolCallLogs: true,
    commitTracking: false,
    inputTokensPerSession: 28_000,
    outputTokensPerSession: 2_800,
    cacheReadTokensPerSession: 62_000,
    cacheCreationTokensPerSession: 0,
  },
  {
    id: 'aider',
    sessionShare: 0.06,
    models: ['claude-sonnet-4-5-20250514', 'gpt-5'],
    completionRate: 0.75,
    abandonRate: 0.15,
    failRate: 0.04,
    avgDurationMin: 17,
    editsPerCompletedSession: 12,
    linesAddedPerEdit: 7.2,
    linesRemovedPerEdit: 1.9,
    commitsPerCompletedSession: 0.64,
    oneShotRate: 0.71,
    researchToEditRatio: 1.2,
    avgFirstEditMin: 3.6,
    stucknessRate: 0.09,
    hooks: false,
    tokenUsage: true,
    conversationLogs: true,
    toolCallLogs: false,
    commitTracking: false,
    inputTokensPerSession: 18_000,
    outputTokensPerSession: 2_100,
    cacheReadTokensPerSession: 0,
    cacheCreationTokensPerSession: 0,
  },
  {
    id: 'cline',
    sessionShare: 0.04,
    models: ['claude-sonnet-4-5-20250514', 'claude-opus-4-7'],
    completionRate: 0.66,
    abandonRate: 0.2,
    failRate: 0.08,
    avgDurationMin: 31,
    editsPerCompletedSession: 18,
    linesAddedPerEdit: 8.8,
    linesRemovedPerEdit: 2.5,
    commitsPerCompletedSession: 0,
    oneShotRate: 0.55,
    researchToEditRatio: 1.6,
    avgFirstEditMin: 6.2,
    stucknessRate: 0.18,
    hooks: false,
    tokenUsage: true,
    conversationLogs: true,
    toolCallLogs: true,
    commitTracking: false,
    inputTokensPerSession: 24_000,
    outputTokensPerSession: 1_800,
    cacheReadTokensPerSession: 58_000,
    cacheCreationTokensPerSession: 3_200,
  },
  {
    id: 'windsurf',
    sessionShare: 0.05,
    models: ['gpt-5', 'claude-sonnet-4-5-20250514'],
    completionRate: 0.73,
    abandonRate: 0.17,
    failRate: 0.04,
    avgDurationMin: 15,
    editsPerCompletedSession: 11,
    linesAddedPerEdit: 7.0,
    linesRemovedPerEdit: 1.8,
    commitsPerCompletedSession: 0.22,
    oneShotRate: 0.63,
    researchToEditRatio: 1.3,
    avgFirstEditMin: 3.8,
    stucknessRate: 0.11,
    hooks: true,
    tokenUsage: false,
    conversationLogs: false,
    toolCallLogs: true,
    commitTracking: true,
    inputTokensPerSession: 0,
    outputTokensPerSession: 0,
    cacheReadTokensPerSession: 0,
    cacheCreationTokensPerSession: 0,
  },
];

export const MODEL_PROFILES: ModelProfile[] = [
  {
    id: 'claude-sonnet-4-5-20250514',
    inputCostPer1M: 3,
    outputCostPer1M: 15,
    cacheReadCostPer1M: 0.3,
    cacheCreationCostPer1M: 3.75,
    completionDelta: 0.02,
  },
  {
    id: 'claude-opus-4-7',
    inputCostPer1M: 15,
    outputCostPer1M: 75,
    cacheReadCostPer1M: 1.5,
    cacheCreationCostPer1M: 18.75,
    completionDelta: 0.06,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    inputCostPer1M: 1,
    outputCostPer1M: 5,
    cacheReadCostPer1M: 0.1,
    cacheCreationCostPer1M: 1.25,
    completionDelta: -0.04,
  },
  {
    id: 'gpt-5',
    inputCostPer1M: 1.25,
    outputCostPer1M: 10,
    cacheReadCostPer1M: 0.125,
    cacheCreationCostPer1M: 0,
    completionDelta: 0,
  },
  {
    id: 'gpt-5-codex',
    inputCostPer1M: 1.25,
    outputCostPer1M: 10,
    cacheReadCostPer1M: 0.125,
    cacheCreationCostPer1M: 0,
    completionDelta: -0.01,
  },
];

export function getToolProfile(id: string): ToolProfile | undefined {
  return TOOL_PROFILES.find((t) => t.id === id);
}

export function getModelProfile(id: string): ModelProfile | undefined {
  return MODEL_PROFILES.find((m) => m.id === id);
}

// USD cost for one session's token usage under a specific model. Returns
// null when pricing is missing for any component — the demo never fabricates
// partial costs for partially-priced models. Denominator is 1e6 because
// cost fields are per 1M tokens.
export function sessionCost(tool: ToolProfile, model: ModelProfile): number | null {
  if (!tool.tokenUsage) return null;
  if (
    model.inputCostPer1M == null ||
    model.outputCostPer1M == null ||
    model.cacheReadCostPer1M == null ||
    model.cacheCreationCostPer1M == null
  ) {
    return null;
  }
  const input = (tool.inputTokensPerSession * model.inputCostPer1M) / 1_000_000;
  const output = (tool.outputTokensPerSession * model.outputCostPer1M) / 1_000_000;
  const cacheRead = (tool.cacheReadTokensPerSession * model.cacheReadCostPer1M) / 1_000_000;
  const cacheCreate =
    (tool.cacheCreationTokensPerSession * model.cacheCreationCostPer1M) / 1_000_000;
  return input + output + cacheRead + cacheCreate;
}
