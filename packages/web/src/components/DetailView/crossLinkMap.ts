import type { DetailViewKey } from '../../lib/router.js';

/**
 * Cross-view link source of truth. Each entry maps a (sourceView, sourceTab,
 * sourceQ) origin to a list of destination links rendered as `relatedLinks`
 * chips beneath the source question's viz.
 *
 * Why centralize:
 * - Detail views agree on the same target without redefining destinations.
 * - One place to audit when adding/renaming tabs or questions.
 * - Bidirectional links (Tools workload ↔ Usage by-tool) stay consistent —
 *   if A points to B, B should point to A; missing return links are easy
 *   to spot in this single table.
 *
 * Keys are URL-style: `view:tab:q`. Looking up an unknown key returns an
 * empty array (no chips) — a safe default that lets a question opt out of
 * cross-linking without touching this file.
 */

export interface CrossLink {
  /** Visible chip label. Phrased as a destination, not a verb. */
  label: string;
  view: DetailViewKey;
  tab: string;
  q?: string;
}

const MAP: Record<string, CrossLink[]> = {
  // ── Usage ↔ siblings ─────────────────────────────
  'usage:sessions:by-tool': [
    { label: 'Per-tool workload', view: 'tools', tab: 'tools', q: 'workload' },
  ],
  'usage:cost:by-tool': [
    { label: 'Per-tool token economics', view: 'tools', tab: 'errors', q: 'tokens' },
  ],
  'usage:cost:by-model': [
    { label: 'Token economics by tool', view: 'tools', tab: 'errors', q: 'tokens' },
  ],

  // ── Outcomes ↔ siblings ──────────────────────────
  'outcomes:sessions:completion': [
    { label: 'Memory effect on completion', view: 'memory', tab: 'health', q: 'outcomes' },
  ],
  'outcomes:retries:one-shot': [
    { label: 'Tool-call error topology', view: 'tools', tab: 'errors', q: 'top' },
  ],
  'outcomes:types:finish': [
    { label: 'Work-type mix in Activity', view: 'activity', tab: 'mix', q: 'share' },
  ],

  // ── Activity ↔ siblings ──────────────────────────
  'activity:rhythm:peak-hour': [
    { label: 'Completion at peak hour', view: 'outcomes', tab: 'sessions', q: 'completion' },
  ],
  'activity:mix:share': [
    { label: 'Completion by work type', view: 'outcomes', tab: 'types', q: 'finish' },
  ],
  'activity:effective-hours:peak-completion': [
    { label: 'Session completion detail', view: 'outcomes', tab: 'sessions', q: 'completion' },
  ],

  // ── Codebase ↔ siblings ──────────────────────────
  'codebase:landscape:landscape': [
    { label: 'Overall completion', view: 'outcomes', tab: 'sessions', q: 'completion' },
  ],
  'codebase:risk:failing-files': [
    { label: 'Session-level failures', view: 'outcomes', tab: 'sessions', q: 'completion' },
  ],
  'codebase:risk:collisions': [
    { label: 'Cross-tool file flow', view: 'tools', tab: 'flow', q: 'pairs' },
  ],
  'codebase:commits:commits-headline': [
    { label: 'Lines + cost context', view: 'usage', tab: 'lines' },
  ],

  // ── Tools ↔ siblings ─────────────────────────────
  'tools:tools:workload': [
    { label: 'Per-tool sessions', view: 'usage', tab: 'sessions', q: 'by-tool' },
  ],
  'tools:flow:pairs': [
    { label: 'File-level collisions', view: 'codebase', tab: 'risk', q: 'collisions' },
  ],
  'tools:errors:top': [
    { label: 'One-shot rate context', view: 'outcomes', tab: 'retries', q: 'one-shot' },
  ],
  'tools:errors:tokens': [{ label: 'Cost in Usage', view: 'usage', tab: 'cost' }],

  // ── Memory ↔ siblings ────────────────────────────
  'memory:health:outcomes': [
    { label: 'Session completion detail', view: 'outcomes', tab: 'sessions', q: 'completion' },
  ],
  'memory:cross-tool:flow': [
    { label: 'Tools that share memory', view: 'tools', tab: 'tools', q: 'workload' },
  ],
  'memory:authorship:concentration': [
    { label: 'Directory-level lens', view: 'codebase', tab: 'directories', q: 'top-dirs' },
  ],
};

/**
 * Look up cross-view links for a given origin. Returns an empty array when
 * the origin has no entry, so callers can spread the result into a chip
 * strip without conditional rendering.
 */
export function getCrossLinks(view: string, tab: string, q: string): CrossLink[] {
  return MAP[`${view}:${tab}:${q}`] ?? [];
}
