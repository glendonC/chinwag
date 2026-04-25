import type { CSSProperties, ReactNode } from 'react';
import styles from './FlowRow.module.css';

export interface FlowRowEndpoint {
  id: string;
  label: ReactNode;
  /** Brand color for the leading dot. CSS color string (token or HSL). */
  color: string;
}

export interface FlowRowBar {
  /** Short label rendered to the left of the bar. */
  label: ReactNode;
  /** Bar value. Width is `value / max`. */
  value: number;
  /** Shared scale max. Two bars in the same row should usually share a
   *  single max so the eye can compare strengths directly. */
  max: number;
  /** Bar fill color. Defaults to `var(--ink)` if unset. */
  color?: string;
  /** Right-side value caption. Defaults to the rounded value. Pass a
   *  formatted string (e.g. `"1.2k"`, `"58%"`) when the raw number reads
   *  awkwardly at the row's altitude. */
  display?: ReactNode;
}

interface Props {
  from: FlowRowEndpoint;
  to: FlowRowEndpoint;
  /** Twin micro-bars beneath the head. The first bar drives the connector
   *  arrow's opacity (so a weaker primary signal reads as a fainter arrow);
   *  pass empty for a connector-only row. */
  bars: ReadonlyArray<FlowRowBar>;
  /** Optional trailing meta on the head row — typically a count or rate. */
  meta?: ReactNode;
  /** Animation index — controls cascade reveal when many rows render at
   *  once. Caller passes the index from a `.map((row, i) => ...)`. */
  index?: number;
}

function clampShare(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

/**
 * Single flow row: paired tool-icon endpoints with twin micro-bars
 * beneath. Used by Memory's `cross-tool-flow` widget body and the
 * upcoming Tools handoff strip — same shape, different bar semantics.
 *
 * Connector arrow opacity scales with the primary bar's value (first bar
 * in `bars`). Empty `bars` renders a connector-only row at a fixed mid
 * opacity. Documented for handoff strip reuse later: the bar pair there
 * is typically `count` and `completion rate`.
 */
export default function FlowRow({ from, to, bars, meta, index = 0 }: Props) {
  const primary = bars[0];
  const connectorOpacity =
    primary && primary.max > 0 ? 0.25 + clampShare(primary.value, primary.max) * 0.65 : 0.45;
  const rowStyle = {
    '--row-index': index,
    '--connector-opacity': connectorOpacity.toFixed(3),
  } as CSSProperties;

  return (
    <div className={styles.row} style={rowStyle}>
      <div className={styles.head}>
        <span className={styles.endpoint}>
          <span className={styles.dot} style={{ background: from.color }} aria-hidden="true" />
          <span className={styles.label}>{from.label}</span>
        </span>
        <span className={styles.connector} aria-hidden="true">
          ──→
        </span>
        <span className={styles.endpoint}>
          <span className={styles.label}>{to.label}</span>
          <span className={styles.dot} style={{ background: to.color }} aria-hidden="true" />
        </span>
        {meta != null ? <span className={styles.meta}>{meta}</span> : null}
      </div>
      {bars.length > 0 ? (
        <div className={styles.bars}>
          {bars.map((b, i) => {
            const pct = clampShare(b.value, b.max) * 100;
            const display = b.display ?? Math.round(b.value * 10) / 10;
            return (
              <div key={i} className={styles.bar}>
                <span className={styles.barLabel}>{b.label}</span>
                <div className={styles.barTrack}>
                  <div
                    className={styles.barFill}
                    style={{
                      width: `${pct}%`,
                      background: b.color ?? 'var(--ink)',
                      opacity: b.color ? 0.9 : 0.55,
                    }}
                  />
                </div>
                <span className={styles.barValue}>{display}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
