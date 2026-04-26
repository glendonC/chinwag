import clsx from 'clsx';
import {
  getToolsWithCapability,
  type DataCapabilities,
} from '@chinmeister/shared/tool-registry.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatCost, formatCostDelta } from '../utils.js';
import styles from '../widget-shared.module.css';

/** How to format the inline delta magnitude shown next to a stat value.
 *  'count' is the default (1-decimal rounded form used by session/edit
 *  counts). 'usd' is 2-decimal `$X.XX` for aggregate-cost deltas.
 *  'usd-fine' is for per-edit USD deltas that need sub-cent precision via
 *  formatCostDelta. Additional variants can land here as cost-adjacent
 *  stats join the strip. */
export type StatDeltaFormat = 'count' | 'usd' | 'usd-fine';

export const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'var(--success)',
  neutral: 'var(--soft)',
  frustrated: 'var(--warn)',
  confused: 'var(--warn)',
  negative: 'var(--danger)',
  unclassified: 'var(--ghost)',
};

// User-facing relabel for the raw sentiment classifier output. The classifier
// labels describe user-message sentiment (positive / frustrated / …) which
// reads as surveillance when surfaced directly. The widget frame is
// prompt-clarity, so the labels here describe the PROMPT rather than the user:
// "confused" phrasing, a "re-asked" prompt, etc. Unmapped classes fall through
// to their raw key so the widget never renders blank.
export const PROMPT_CLARITY_LABELS: Record<string, string> = {
  positive: 'clear',
  neutral: 'neutral',
  confused: 'confused',
  frustrated: 're-asked',
  negative: 'pushback',
  unclassified: 'unclassified',
};

export function StatWidget({
  value,
  delta,
  deltaInvert,
  deltaFormat = 'count',
  active,
  onSelect,
  selectAriaLabel,
  onOpenDetail,
  detailAriaLabel,
}: {
  value: string;
  delta?: { current: number | null; previous: number | null } | null;
  deltaInvert?: boolean;
  /** How to render the inline delta magnitude. Defaults to 'count' —
   *  1-decimal rounding suitable for integer-ish stats. Use 'usd-fine'
   *  for per-edit dollar deltas that need sub-cent precision. */
  deltaFormat?: StatDeltaFormat;
  /** Tab-selector state. When a boolean (true or false), the stat renders
   * as a selectable tab — active stays in full ink, inactive dims to
   * `--soft`. Undefined means the stat is not part of a selector group and
   * falls back to the plain (drill-or-static) render path. */
  active?: boolean;
  /** Fired when the stat value is clicked as a tab-select action. Required
   * whenever `active` is defined — the cell is only tab-clickable when the
   * caller wires a handler. */
  onSelect?: () => void;
  selectAriaLabel?: string;
  /** When provided (and `active` is undefined), the stat value is wrapped
   * in a drill-in button with a trailing ↗ affordance. Tab-selector stats
   * drop this in favor of `onSelect` — the adjacent trend widget IS the
   * drill, so a secondary arrow would be redundant. */
  onOpenDetail?: () => void;
  detailAriaLabel?: string;
}) {
  let deltaEl = null;
  // Only render a delta when both sides are measured and previous > 0.
  // Null on either side means "no comparison available" (e.g., stale
  // pricing, all-unpriced models, or first-ever period); zero previous
  // is divide-by-infinity territory where the arrow is misleading.
  if (delta && delta.current != null && delta.previous != null && delta.previous > 0) {
    const d = delta.current - delta.previous;
    const isGood = deltaInvert ? d < 0 : d > 0;
    const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
    const color = d === 0 ? 'var(--muted)' : isGood ? 'var(--success)' : 'var(--danger)';
    const magnitude =
      deltaFormat === 'usd-fine'
        ? formatCostDelta(d)
        : deltaFormat === 'usd'
          ? formatCost(Math.abs(d), 2)
          : String(Math.abs(Math.round(d * 10) / 10));
    deltaEl = (
      <span className={styles.statInlineDelta} style={{ color }}>
        {arrow}
        {magnitude}
      </span>
    );
  }

  // Tab-selector render path: the stat is one of N mutually-exclusive
  // selectors driving an adjacent trend/chart. Active = full ink, inactive
  // dims to --soft. onSelect is the single click action; drill-in is not
  // rendered here because the adjacent chart is the detail.
  if (active !== undefined) {
    const valueClass = active
      ? styles.heroStatValue
      : `${styles.heroStatValue} ${styles.heroStatInactive}`;
    return (
      <button
        type="button"
        className={styles.statSelectButton}
        onClick={onSelect}
        aria-label={selectAriaLabel}
        aria-pressed={active}
      >
        <span className={valueClass}>
          {value}
          {deltaEl}
        </span>
      </button>
    );
  }

  const inner = (
    <span className={styles.heroStatValue}>
      {value}
      {deltaEl}
    </span>
  );
  if (!onOpenDetail) return inner;
  return (
    <button
      type="button"
      className={styles.statButton}
      onClick={onOpenDetail}
      aria-label={detailAriaLabel}
    >
      {inner}
      <span className={styles.statDetailArrow} aria-hidden="true">
        ↗
      </span>
    </button>
  );
}

/**
 * Inline arrow+magnitude delta used alongside stat-row numbers where the
 * bigger `StatWidget` surface doesn't fit. One decimal of precision, token
 * colors. `invert=true` for metrics where lower is better (e.g., stuckness,
 * error rate) — the color choice follows, not the arrow direction.
 *
 * Shared primitive so the stuckness stat-row and the outcome-bar legend
 * stop re-implementing the same arrow+color logic `StatWidget` already has.
 */
export function InlineDelta({ value, invert = false }: { value: number; invert?: boolean }) {
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→';
  const isGood = invert ? value < 0 : value > 0;
  const color = value === 0 ? 'var(--muted)' : isGood ? 'var(--success)' : 'var(--danger)';
  return (
    <span className={styles.statInlineDelta} style={{ color }}>
      {arrow}
      {Math.abs(Math.round(value * 10) / 10)}
    </span>
  );
}

export function GhostStatRow({ labels }: { labels: string[] }) {
  return (
    <div className={styles.ghostStatRow}>
      {labels.map((l) => (
        <div key={l} className={styles.statBlock}>
          <span className={styles.ghostStatValue}>—</span>
          <span className={styles.statBlockLabel}>{l}</span>
        </div>
      ))}
    </div>
  );
}

export function GhostBars({ count }: { count: number }) {
  return (
    <div className={styles.metricBars}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.ghostRow}>
          <span className={styles.ghostLabel}>—</span>
          <div className={styles.ghostBarTrack} />
          <span className={styles.ghostValue}>—</span>
        </div>
      ))}
    </div>
  );
}

export function GhostRows({ count }: { count: number }) {
  return (
    <div className={styles.dataList}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.ghostRow}>
          <span className={styles.ghostLabel} style={{ width: 'auto' }}>
            —
          </span>
          <span className={styles.ghostValue}>—</span>
        </div>
      ))}
    </div>
  );
}

export function GhostSparkline() {
  return (
    <svg
      width="100%"
      height={80}
      viewBox="0 0 300 80"
      preserveAspectRatio="none"
      className={styles.trendSvg}
    >
      <line x1="0" y1="40" x2="300" y2="40" stroke="var(--ghost)" strokeWidth="1.5" opacity="0.3" />
    </svg>
  );
}

/**
 * Canonical inline sparkline. Replaces the three independent SVG sparkline
 * implementations (charts.tsx Sparkline, OutcomeWidgets.MiniSparkline) that
 * differed only in opacities and the trailing dot. ReworkSpark stays local
 * because it renders a single-ratio ramp, not a series.
 *
 *   values  — series to plot (>= 2 points; renders null otherwise).
 *   color   — fill + stroke. Defaults to var(--ink).
 *   muted   — dim opacities for slices that fall below sample-size threshold.
 *   endDot  — render the trailing data point as a small filled circle.
 *   width   — viewBox width (cosmetic only with preserveAspectRatio="none").
 *   height  — viewBox height; controls intrinsic aspect.
 *   className — sizing class on the SVG (default: 100% width, block).
 */
export function Sparkline({
  values,
  color = 'var(--ink)',
  muted = false,
  endDot = false,
  width = 100,
  height = 22,
  className,
}: {
  values: number[];
  color?: string;
  muted?: boolean;
  endDot?: boolean;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => ({
    x: (i / (values.length - 1)) * width,
    y: height - (v / max) * (height - 2) - 1,
  }));
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const fillOpacity = muted ? 0.1 : 0.15;
  const strokeOpacity = muted ? 0.4 : 0.85;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className ?? styles.trendSvg}
      aria-hidden="true"
    >
      <path d={area} fill={color} opacity={fillOpacity} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={strokeOpacity}
        vectorEffect="non-scaling-stroke"
      />
      {endDot && points.length > 0 && (
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={2.5}
          fill={color}
          opacity={0.9}
        />
      )}
    </svg>
  );
}

/**
 * Inline coverage note for deep-capture widgets.
 * Extends the PricingAttribution pattern (muted, one-line).
 * Shown both in empty states (gating disclosure) and in partial-capture
 * states (attribution). Falls through to nothing when coverage is universal.
 */
export function CoverageNote({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className={styles.coverageNote}>{text}</div>;
}

/**
 * True when the user is effectively solo for coordination purposes — zero or
 * one active member in the window. Consolidates the three inline
 * `analytics.member_analytics.length <= 1` checks that team-latent widgets
 * (conflict-impact, conflicts-blocked, file-overlap) use to swap
 * "system measured zero" framing for "requires 2+ agents — structurally
 * zero, not observed zero." One place to evolve the definition (e.g.,
 * agent count instead of human count) without touching every caller.
 *
 * Scope note: TeamMembersWidget does NOT use this because its solo-vs-empty
 * branching (`length === 0` → empty, `length === 1` → render + footer) is a
 * distinct semantic from the coordination-gate one, not the same predicate.
 */
export function isSoloTeam(analytics: { member_analytics: { length: number } }): boolean {
  return analytics.member_analytics.length <= 1;
}

/**
 * Muted trailing line for top-N list widgets that cap their render but want
 * to stay honest about the hidden tail. Surfaces "+N more hidden" rather than
 * silently dropping rows — D3b resilience at team scale.
 */
export function MoreHidden({ count }: { count: number }) {
  if (count <= 0) return null;
  return <div className={styles.moreHidden}>+{count} more hidden</div>;
}

/**
 * Canonical file-path renderer. Filename is ink and never truncates; the
 * directory prefix is soft and ellipses if the cell is too narrow. Head-
 * truncation in `parent-first` order is handled in CSS via `direction:
 * rtl` so the immediate parent (closest to the filename) survives as long
 * as possible. The formatter caps how many trailing parent segments to
 * surface; deeper context above that cap is hinted to the user via the
 * `title` attribute on hover and assistive tech.
 *
 *   `order='parent-first'` (default) renders `dir/ name` — the codebase-
 *   table convention where the file's location reads before its name.
 *   On overflow, the front of the prefix gets ellipsed (`…s/dos/team/`).
 *   `order='name-first'` renders `name dir/` — the scannable variant used
 *   by conversation and live widgets where the basename is identity. On
 *   overflow, the tail of the prefix gets ellipsed.
 */
export function FilePath({
  path,
  order = 'parent-first',
  parentSegments = 2,
  className,
}: {
  path: string;
  order?: 'parent-first' | 'name-first';
  parentSegments?: number;
  className?: string;
}) {
  const { parent, name } = formatFilePath(path, parentSegments);
  const parentClass =
    order === 'parent-first'
      ? clsx(styles.filePathParent, styles.filePathParentLead)
      : styles.filePathParent;
  const parentEl = parent ? <span className={parentClass}>{parent}</span> : null;
  const nameEl = <span className={styles.filePathName}>{name}</span>;
  return (
    <span className={clsx(styles.filePath, className)} title={path}>
      {order === 'parent-first' ? (
        <>
          {parentEl}
          {nameEl}
        </>
      ) : (
        <>
          {nameEl}
          {parentEl}
        </>
      )}
    </span>
  );
}

function formatFilePath(path: string, parentSegments: number): { parent: string; name: string } {
  if (!path) return { parent: '', name: '' };
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 1) return { parent: '', name: path };
  const name = segments[segments.length - 1] ?? '';
  const parentParts = segments.slice(0, -1);
  const visible = parentParts.slice(-Math.max(0, parentSegments));
  const parent = visible.length > 0 ? `${visible.join('/')}/` : '';
  return { parent, name };
}

// Display prefix shown in coverage notes for each capability. These phrase
// the attribution like "Conversation data from ..." so partial and gated
// empty states share a vocabulary.
const CAPABILITY_LABEL: Partial<Record<keyof DataCapabilities, string>> = {
  conversationLogs: 'Conversation data',
  tokenUsage: 'Token and cost data',
  toolCallLogs: 'Tool call data',
  commitTracking: 'Commit data',
  hooks: 'Hook-driven data',
};

/**
 * Compute the coverage note string for a capability-gated widget. Returns
 * null when no disclosure is needed (either no active tools at all — so the
 * surrounding empty state covers it — or every active tool supports the
 * capability, so the gating is invisible to this user).
 *
 * Callers must render the returned note in both populated AND empty states.
 * That is the A3 honesty fix: gating must be visible when the widget is
 * rendering em-dashes, not only when it has data.
 */
/**
 * Shape of the token_usage slice the cost-reliability helpers consume. Scoped
 * to the fields that determine whether we can show a dollar number at all —
 * not a full TokenUsageStats. Kept structural so test fixtures don't have to
 * fill unrelated fields.
 */
interface CostReliabilityInput {
  sessions_with_token_data: number;
  pricing_is_stale: boolean;
  models_without_pricing: string[];
  models_without_pricing_total: number;
  by_model: Array<{ agent_model: string }>;
}

/**
 * True when the widget can honestly render a dollar value. Three reasons to
 * say no: no sessions reported token data, the pricing snapshot is stale
 * (pricing-enrich.ts zeroes costs rather than serve wrong numbers), or every
 * observed model is unpriced on a fresh snapshot (the totalCost sum is zero
 * not because there was no spend but because chinmeister can't price the models
 * that did spend). Any of the three → render em-dash.
 */
export function hasCostData(tu: CostReliabilityInput): boolean {
  if (tu.sessions_with_token_data === 0) return false;
  if (tu.pricing_is_stale) return false;
  if (tu.by_model.length > 0 && tu.models_without_pricing_total >= tu.by_model.length) {
    return false;
  }
  return true;
}

/**
 * Explain the em-dash. Called when `hasCostData` returns false; picks the most
 * specific reason so the CoverageNote under the stat tells the user *why* the
 * widget isn't showing a number. Falls through to the standard capability
 * attribution for the zero-sessions case (first-day solo etc.) — returning
 * null there is fine, the widget just shows a bare em-dash.
 */
export function costEmptyReason(tu: CostReliabilityInput, toolsReporting: string[]): string | null {
  if (tu.pricing_is_stale) {
    return 'Pricing refresh pending — cost estimates paused';
  }
  if (tu.by_model.length > 0 && tu.models_without_pricing_total >= tu.by_model.length) {
    const first = tu.models_without_pricing[0];
    const extra = tu.models_without_pricing_total - 1;
    if (first && extra > 0) return `Awaiting pricing for ${first} (and ${extra} more)`;
    if (first) return `Awaiting pricing for ${first}`;
    return 'Awaiting pricing for observed models';
  }
  return capabilityCoverageNote(toolsReporting, 'tokenUsage');
}

export function capabilityCoverageNote(
  toolsReporting: string[],
  capability: keyof DataCapabilities,
): string | null {
  const label = CAPABILITY_LABEL[capability];
  if (!label) return null;

  const capable = getToolsWithCapability(capability);
  const reporting = toolsReporting.filter((t) => capable.includes(t));

  // No active tools at all — the outer empty state handles messaging.
  if (toolsReporting.length === 0) return null;

  // Full coverage — no disclosure needed.
  if (reporting.length === toolsReporting.length) return null;

  // Partial capture — attribute to the tools that are reporting.
  if (reporting.length > 0) {
    const names = reporting.map((t) => getToolMeta(t).label).join(', ');
    return `${label} from ${names}`;
  }

  // No reporting tool supports this capability — name which ones would.
  if (capable.length > 0) {
    const first = capable.slice(0, 4).map((t) => getToolMeta(t).label);
    const tail = capable.length > 4 ? `, and ${capable.length - 4} more` : '';
    return `${label} from ${first.join(', ')}${tail}`;
  }

  return null;
}
