import { getToolsWithCapability, type DataCapabilities } from '@chinwag/shared/tool-registry.js';
import { getToolMeta } from '../../../lib/toolMeta.js';
import styles from '../OverviewView.module.css';

export const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'var(--success)',
  neutral: 'var(--soft)',
  frustrated: 'var(--warn)',
  confused: 'var(--warn)',
  negative: 'var(--danger)',
  unclassified: 'var(--ghost)',
};

export function StatWidget({
  value,
  delta,
  deltaInvert,
}: {
  value: string;
  delta?: { current: number; previous: number } | null;
  deltaInvert?: boolean;
}) {
  let deltaEl = null;
  if (delta && delta.previous > 0) {
    const d = delta.current - delta.previous;
    const isGood = deltaInvert ? d < 0 : d > 0;
    const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
    const color = d === 0 ? 'var(--muted)' : isGood ? 'var(--success)' : 'var(--danger)';
    deltaEl = (
      <span className={styles.statInlineDelta} style={{ color }}>
        {arrow}
        {Math.abs(Math.round(d * 10) / 10)}
      </span>
    );
  }
  return (
    <span className={styles.heroStatValue}>
      {value}
      {deltaEl}
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
 * Inline coverage note for deep-capture widgets.
 * Extends the PricingAttribution pattern (muted, one-line).
 * Shown both in empty states (gating disclosure) and in partial-capture
 * states (attribution). Falls through to nothing when coverage is universal.
 */
export function CoverageNote({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className={styles.coverageNote}>{text}</div>;
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
