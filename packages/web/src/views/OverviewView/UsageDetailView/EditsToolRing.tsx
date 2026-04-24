import { useMemo, type CSSProperties } from 'react';
import clsx from 'clsx';
import ToolIcon from '../../../components/ToolIcon/ToolIcon.js';
import { arcPath } from '../../../lib/svgArcs.js';
import { getToolMeta } from '../../../lib/toolMeta.js';
import { navigate } from '../../../lib/router.js';
import type { UserAnalytics } from '../../../lib/apiSchemas.js';
import { fmtCount } from './shared.js';
import {
  RING_CX,
  RING_CY,
  RING_R,
  RING_SW,
  RING_GAP_DEG,
  RING_TOP_N,
  OTHER_KEY,
} from './ring-constants.js';
import styles from './UsageDetailView.module.css';

interface EditsToolRow {
  key: string;
  host_tool: string | null;
  label: string;
  edits: number;
  rate: number | null;
}

/**
 * Edits-tab variant of aggregateSessionsRows. The Other row's rate is a
 * true aggregate — total tail edits divided by total tail hours — which
 * is the correct aggregation (not an average of averages). Rows without
 * session hours carry `rate: null` rather than pretending to be zero.
 */
function aggregateEditsRows(entries: UserAnalytics['tool_comparison']): EditsToolRow[] {
  const sorted = [...entries]
    .filter((e) => e.total_edits > 0)
    .sort((a, b) => b.total_edits - a.total_edits);
  const top = sorted.slice(0, RING_TOP_N);
  const tail = sorted.slice(RING_TOP_N);
  const rows: EditsToolRow[] = top.map((t) => ({
    key: t.host_tool,
    host_tool: t.host_tool,
    label: getToolMeta(t.host_tool).label,
    edits: t.total_edits,
    rate: t.total_session_hours > 0 ? t.total_edits / t.total_session_hours : null,
  }));
  const tailEdits = tail.reduce((s, e) => s + e.total_edits, 0);
  if (tailEdits > 0) {
    const tailHours = tail.reduce((s, e) => s + e.total_session_hours, 0);
    rows.push({
      key: OTHER_KEY,
      host_tool: null,
      label: `Other · ${tail.length} tools`,
      edits: tailEdits,
      rate: tailHours > 0 ? tailEdits / tailHours : null,
    });
  }
  return rows;
}

// Edits-flavored share ring — same visual DNA as ToolRing, but sized by
// edits (not sessions). Center reads "EDITS", table columns are
// Tool / Edits / Rate so the pair reads as the edit story.
export default function EditsToolRing({
  entries,
  total,
}: {
  entries: UserAnalytics['tool_comparison'];
  total: number;
}) {
  const rows = useMemo(() => aggregateEditsRows(entries), [entries]);

  const arcs = useMemo(() => {
    const out: Array<{
      key: string;
      color: string;
      startDeg: number;
      sweepDeg: number;
    }> = [];
    const safeTotal = Math.max(1, total);
    const gaps = rows.length * RING_GAP_DEG;
    const available = Math.max(0, 360 - gaps);
    let cursor = 0;
    for (const r of rows) {
      const color = r.host_tool ? getToolMeta(r.host_tool).color : 'var(--soft)';
      const sweep = (r.edits / safeTotal) * available;
      if (sweep > 0.2) {
        out.push({ key: r.key, color, startDeg: cursor, sweepDeg: sweep });
      }
      cursor += sweep + RING_GAP_DEG;
    }
    return out;
  }, [rows, total]);

  // Single-tool empty state: a full ring is decorative, not informative.
  // After aggregation there's at most one "Other" row appended to the top
  // list, so a single underlying tool still yields rows.length === 1.
  if (rows.length <= 1) {
    const only = rows[0];
    if (!only || !only.host_tool) return null;
    const meta = getToolMeta(only.host_tool);
    const hours = entries.find((e) => e.host_tool === only.host_tool)?.total_session_hours ?? 0;
    return (
      <div className={styles.ringBlock}>
        <div className={styles.singleTool}>
          <div className={styles.singleToolHead} style={{ color: meta.color }}>
            <ToolIcon tool={only.host_tool} size={18} />
            <span>{meta.label}</span>
          </div>
          <div className={styles.singleToolValue}>
            {fmtCount(only.edits)}
            <span className={styles.singleToolUnit}>edits</span>
          </div>
          {only.rate != null && only.rate > 0 && (
            <div className={styles.singleToolMeta}>
              {only.rate.toFixed(1)}/hr · {hours.toFixed(1)}h
            </div>
          )}
          <button type="button" className={styles.toolsCta} onClick={() => navigate('tools')}>
            <span>Open Tools tab</span>
            <span className={styles.toolsCtaArrow} aria-hidden="true">
              ↗
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.ringBlock}>
      <div className={styles.ringMedia}>
        <svg viewBox="0 0 160 160" className={styles.ringSvg} role="img" aria-label="Tool mix">
          <circle
            cx={RING_CX}
            cy={RING_CY}
            r={RING_R}
            fill="none"
            stroke="var(--hover-bg)"
            strokeWidth={RING_SW}
          />
          {arcs.map((arc) => (
            <path
              key={arc.key}
              d={arcPath(RING_CX, RING_CY, RING_R, arc.startDeg, arc.sweepDeg)}
              fill="none"
              stroke={arc.color}
              strokeWidth={RING_SW}
              strokeLinecap="round"
              opacity={0.9}
            />
          ))}
          <text
            x={RING_CX}
            y={RING_CY - 4}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--ink)"
            fontSize="26"
            fontWeight="200"
            fontFamily="var(--display)"
            letterSpacing="-0.04em"
          >
            {fmtCount(total)}
          </text>
          <text
            x={RING_CX}
            y={RING_CY + 16}
            textAnchor="middle"
            fill="var(--soft)"
            fontSize="8"
            fontFamily="var(--mono)"
            letterSpacing="0.14em"
          >
            EDITS
          </text>
        </svg>
      </div>
      <div className={styles.ringPanel}>
        <table className={styles.toolTable}>
          <thead>
            <tr>
              <th scope="col" className={styles.toolTh}>
                Tool
              </th>
              <th scope="col" className={clsx(styles.toolTh, styles.toolThNum)}>
                Edits
              </th>
              <th scope="col" className={clsx(styles.toolTh, styles.toolThNum)}>
                Rate
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.key}
                className={styles.toolRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <td className={styles.toolCellName}>
                  {row.host_tool ? (
                    <ToolIcon tool={row.host_tool} size={14} />
                  ) : (
                    <span className={styles.toolCellOtherDot} aria-hidden="true" />
                  )}
                  <span>{row.label}</span>
                </td>
                <td className={styles.toolCellNum}>{fmtCount(row.edits)}</td>
                <td className={styles.toolCellNum}>
                  {row.rate != null && row.rate > 0 ? `${row.rate.toFixed(1)}/hr` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className={styles.toolsCta} onClick={() => navigate('tools')}>
          <span>Open Tools tab</span>
          <span className={styles.toolsCtaArrow} aria-hidden="true">
            ↗
          </span>
        </button>
      </div>
    </div>
  );
}
