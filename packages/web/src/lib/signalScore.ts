// Internal ranking function for "Recommended" sort in the directory.
// Not surfaced as a visible score — users see concrete facts, not a number.
//
// Weighs things any builder controls (docs, maintenance, MCP support)
// heavily, so a well-maintained solo project scores well without
// needing funding or a massive user base.

interface SignalBreakdown {
  total: number;
  craft: number;
  activity: number;
  ecosystem: number;
  reach: number;
  /** True when enrichment data exists — used as sort tiebreaker so unenriched tools aren't unfairly penalized. */
  dataComplete: boolean;
}

interface ScoringInput {
  github_stars?: number | null;
  open_source?: boolean | number | null;
  mcp_support?: boolean | number | string | null;
  has_cli?: boolean | number | null;
  pricing_tier?: string | null;
  pricing_detail?: string | null;
  platform?: string[] | null;
  integration_type?: string | null;
  ai_summary?: string | null;
  strengths?: string[] | null;
  demo_url?: string | null;
  last_updated?: string | null;
  confidence?: string | null;
  // Credibility pass fields (populated when available)
  founded_year?: number | null;
  team_size?: string | null;
  funding_status?: string | null;
  update_frequency?: string | null;
  user_count_estimate?: string | null;
  notable_users?: string | null;
  documentation_quality?: string | null;
}

/** Extract scoring input from an evaluation's flat + metadata shape. */
export function extractScoringInput(ev: Record<string, unknown>): ScoringInput {
  const md = (ev.metadata ?? {}) as Record<string, unknown>;
  return {
    github_stars: typeof md.github_stars === 'number' ? md.github_stars : null,
    open_source: (ev.open_source ?? md.open_source ?? null) as boolean | number | null,
    mcp_support: (ev.mcp_support ?? null) as boolean | number | string | null,
    has_cli: (ev.has_cli ?? null) as boolean | number | null,
    pricing_tier: (md.pricing_tier as string) || null,
    pricing_detail: (md.pricing_detail as string) || null,
    platform: Array.isArray(md.platform) ? (md.platform as string[]) : null,
    integration_type: (md.integration_type as string) || null,
    ai_summary: (md.ai_summary as string) || null,
    strengths: Array.isArray(md.strengths) ? (md.strengths as string[]) : null,
    demo_url: (md.demo_url as string) || null,
    last_updated: (md.last_updated as string) || null,
    confidence: (ev.confidence as string) || null,
    founded_year: typeof md.founded_year === 'number' ? md.founded_year : null,
    team_size: (md.team_size as string) || null,
    funding_status: (md.funding_status as string) || null,
    update_frequency: (md.update_frequency as string) || null,
    user_count_estimate: (md.user_count_estimate as string) || null,
    notable_users: (md.notable_users as string) || null,
    documentation_quality: (md.documentation_quality as string) || null,
  };
}

function isTruthy(val: unknown): boolean {
  return val === true || val === 1 || val === 'true';
}

/**
 * Compute the signal score from available data.
 *
 * Craft + Activity + Ecosystem = up to 75 — fully in the builder's control.
 * Reach = up to 25 — audience/adoption, clearly labeled, never a penalty.
 *
 * A bootstrapped solo dev with good docs, active maintenance, and MCP
 * support can realistically hit 60-75. A VC-backed tool with stale docs
 * and no MCP might only hit 30-40.
 */
export function computeSignalScore(input: ScoringInput): SignalBreakdown {
  // ── Craft (0–25): product polish any builder controls ──
  let craft = 0;
  // Documentation quality (biggest single signal in craft)
  const docs = input.documentation_quality;
  if (docs === 'comprehensive') craft += 8;
  else if (docs === 'good') craft += 6;
  else if (docs === 'minimal') craft += 2;
  // Has a demo video — shows you care about showing the product
  if (input.demo_url) craft += 5;
  // Pricing clarity — transparent about what it costs
  if (input.pricing_detail) craft += 4;
  else if (input.pricing_tier) craft += 2;
  // Rich evaluation data — strengths articulated, summary written
  if (input.ai_summary) craft += 3;
  if (input.strengths && input.strengths.length >= 2) craft += 3;
  else if (input.strengths && input.strengths.length >= 1) craft += 1;
  // Has a clear integration type
  if (input.integration_type) craft += 2;
  craft = Math.min(Math.round(craft), 25);

  // ── Activity (0–25): maintenance signals ──
  let activity = 0;
  // Update frequency — the single strongest maintenance signal
  const freq = input.update_frequency;
  if (freq === 'daily') activity += 12;
  else if (freq === 'weekly') activity += 10;
  else if (freq === 'monthly') activity += 6;
  else if (freq === 'stale') activity += 1;
  else if (input.last_updated) activity += 4; // have date but no frequency tag
  // Open source — transparent, community can contribute and verify
  if (isTruthy(input.open_source)) activity += 7;
  // Data confidence — indicates eval found solid info
  if (input.confidence === 'high') activity += 4;
  else if (input.confidence === 'medium') activity += 2;
  activity = Math.min(Math.round(activity), 25);

  // ── Ecosystem (0–25): integration depth ──
  let ecosystem = 0;
  // MCP support — the biggest differentiator for our directory
  if (isTruthy(input.mcp_support)) ecosystem += 10;
  // CLI availability — composable, automatable
  if (isTruthy(input.has_cli)) ecosystem += 5;
  // Platform breadth — accessible to more developers
  const platforms = input.platform?.length ?? 0;
  ecosystem += Math.min(platforms * 2, 8);
  // Evaluation confidence boost
  if (input.confidence === 'high') ecosystem += 2;
  ecosystem = Math.min(Math.round(ecosystem), 25);

  // ── Reach (0–25): adoption signals — bonus, never a penalty ──
  let reach = 0;
  const stars = input.github_stars ?? 0;
  if (stars > 0) {
    // Diminishing returns: 100→10, 1k→15, 10k→20
    // Even 200 stars gets you a decent reach score
    reach += Math.min(Math.log10(stars) * 5, 20);
  }
  if (input.user_count_estimate) reach += 3;
  if (input.notable_users) reach += 2;
  reach = Math.min(Math.round(reach), 25);

  // Flag whether enrichment data exists — tools without it shouldn't be buried below
  // genuinely low-scoring tools just because enrichment fields are null.
  const dataComplete = !!(
    input.ai_summary ||
    input.update_frequency ||
    input.documentation_quality
  );

  return {
    total: craft + activity + ecosystem + reach,
    craft,
    activity,
    ecosystem,
    reach,
    dataComplete,
  };
}

/** Format stars count: 1200 → "1.2k", 45000 → "45k" */
export function formatStars(stars: number): string {
  if (stars >= 1000) {
    const k = stars / 1000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  return String(stars);
}
