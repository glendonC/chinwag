// Head-to-head tool comparison.
// A button sits above the stack table. Click it → modal picker appears
// with two dropdowns. Pick two tools → side-by-side card shows how they
// stack up on completion, first-edit warmup, tokens per completed session,
// and work-type mix.
//
// All numbers come from the existing getDrillIn helper - no new data
// required. This exists as a dedicated interactive rather than a section
// because comparison is a tactical operation, not an always-on view.

import { useMemo, useState, useEffect } from 'react';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatDuration } from '../../lib/utils.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import type { ScoredToolRow, ToolDrillIn } from './useScoredStackData.js';
import styles from './CompareTools.module.css';

interface Props {
  rows: ScoredToolRow[];
  getDrillIn: (toolId: string) => ToolDrillIn | null;
}

interface ComparedTool {
  row: ScoredToolRow;
  drill: ToolDrillIn | null;
  workMix: { work_type: string; pct: number }[];
}

function buildCompared(row: ScoredToolRow, drill: ToolDrillIn | null): ComparedTool {
  const total = drill?.workTypes.reduce((s, w) => s + w.sessions, 0) ?? 0;
  const workMix =
    total > 0
      ? [...(drill?.workTypes ?? [])]
          .map((w) => ({ work_type: w.work_type, pct: (w.sessions / total) * 100 }))
          .sort((a, b) => b.pct - a.pct)
          .slice(0, 4)
      : [];
  return { row, drill, workMix };
}

export default function CompareTools({ rows, getDrillIn }: Props) {
  const [open, setOpen] = useState(false);
  // Explicit selections override the defaults. Null = "fall back to the
  // top-by-sessions row at the matching slot". Keeping them nullable
  // lets us derive the effective id during render without a seeding
  // effect (which would cascade re-renders).
  const [explicitLeftId, setLeftId] = useState<string | null>(null);
  const [explicitRightId, setRightId] = useState<string | null>(null);

  const effectiveLeftId = explicitLeftId ?? rows[0]?.toolId ?? null;
  const effectiveRightId = explicitRightId ?? rows[1]?.toolId ?? null;

  // Dismiss on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const left = useMemo(() => {
    if (!effectiveLeftId) return null;
    const row = rows.find((r) => r.toolId === effectiveLeftId);
    return row ? buildCompared(row, getDrillIn(effectiveLeftId)) : null;
  }, [effectiveLeftId, rows, getDrillIn]);

  const right = useMemo(() => {
    if (!effectiveRightId) return null;
    const row = rows.find((r) => r.toolId === effectiveRightId);
    return row ? buildCompared(row, getDrillIn(effectiveRightId)) : null;
  }, [effectiveRightId, rows, getDrillIn]);

  if (rows.length < 2) return null;

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3 5h8M3 5l3-3M3 5l3 3M13 11H5M13 11l-3 3M13 11l-3-3"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Compare tools
      </button>

      {open && (
        <div
          className={styles.backdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Compare two tools"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className={styles.modal}>
            <header className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Compare tools</h2>
              <button
                type="button"
                className={styles.close}
                onClick={() => setOpen(false)}
                aria-label="Close comparison"
              >
                ×
              </button>
            </header>

            <div className={styles.pickers}>
              <label className={styles.picker}>
                <span className={styles.pickerLabel}>Left</span>
                <select
                  value={effectiveLeftId ?? ''}
                  onChange={(e) => setLeftId(e.target.value || null)}
                  className={styles.select}
                >
                  {rows.map((r) => {
                    const m = getToolMeta(r.toolId);
                    return (
                      <option key={r.toolId} value={r.toolId}>
                        {m.label}
                      </option>
                    );
                  })}
                </select>
              </label>
              <span className={styles.vs}>vs</span>
              <label className={styles.picker}>
                <span className={styles.pickerLabel}>Right</span>
                <select
                  value={effectiveRightId ?? ''}
                  onChange={(e) => setRightId(e.target.value || null)}
                  className={styles.select}
                >
                  {rows.map((r) => {
                    const m = getToolMeta(r.toolId);
                    return (
                      <option key={r.toolId} value={r.toolId}>
                        {m.label}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>

            {left && right ? (
              <ComparisonBody left={left} right={right} />
            ) : (
              <div className={styles.empty}>Pick two tools to compare.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ComparisonBody({ left, right }: { left: ComparedTool; right: ComparedTool }) {
  const leftMeta = getToolMeta(left.row.toolId);
  const rightMeta = getToolMeta(right.row.toolId);

  const metrics: {
    label: string;
    leftValue: string;
    rightValue: string;
    leftBetter: boolean | null;
  }[] = [
    {
      label: 'Sessions',
      leftValue: String(left.row.sessions),
      rightValue: String(right.row.sessions),
      leftBetter: null,
    },
    {
      label: 'Completion',
      leftValue: `${left.row.completionRate}%`,
      rightValue: `${right.row.completionRate}%`,
      leftBetter:
        left.row.completionRate === right.row.completionRate
          ? null
          : left.row.completionRate > right.row.completionRate,
    },
    {
      label: 'First edit',
      leftValue: left.row.avgFirstEditMin != null ? formatDuration(left.row.avgFirstEditMin) : '-',
      rightValue:
        right.row.avgFirstEditMin != null ? formatDuration(right.row.avgFirstEditMin) : '-',
      leftBetter:
        left.row.avgFirstEditMin == null || right.row.avgFirstEditMin == null
          ? null
          : left.row.avgFirstEditMin < right.row.avgFirstEditMin,
    },
    {
      label: 'Avg duration',
      leftValue: formatDuration(left.drill?.comparison?.avg_duration_min ?? 0),
      rightValue: formatDuration(right.drill?.comparison?.avg_duration_min ?? 0),
      leftBetter: null,
    },
  ];

  return (
    <div className={styles.body}>
      <div className={styles.identityRow}>
        <div className={styles.identity}>
          <ToolIcon tool={left.row.toolId} size={28} />
          <span className={styles.identityLabel}>{leftMeta.label}</span>
        </div>
        <div className={styles.identity}>
          <ToolIcon tool={right.row.toolId} size={28} />
          <span className={styles.identityLabel}>{rightMeta.label}</span>
        </div>
      </div>

      <div className={styles.metricsGrid}>
        {metrics.map((m) => (
          <div key={m.label} className={styles.metricRow}>
            <div
              className={`${styles.metricValue} ${
                m.leftBetter === true ? styles.metricWinner : ''
              }`}
            >
              {m.leftValue}
            </div>
            <div className={styles.metricLabel}>{m.label}</div>
            <div
              className={`${styles.metricValue} ${
                m.leftBetter === false ? styles.metricWinner : ''
              }`}
            >
              {m.rightValue}
            </div>
          </div>
        ))}
      </div>

      {(left.workMix.length > 0 || right.workMix.length > 0) && (
        <div className={styles.workSection}>
          <span className={styles.workHead}>Top work types</span>
          <div className={styles.workGrid}>
            <ul className={styles.workList}>
              {left.workMix.map((w) => (
                <li key={`l-${w.work_type}`} className={styles.workItem}>
                  <span className={styles.workName}>{w.work_type}</span>
                  <span className={styles.workPct}>{Math.round(w.pct)}%</span>
                </li>
              ))}
              {left.workMix.length === 0 && <li className={styles.workEmpty}>No data</li>}
            </ul>
            <ul className={styles.workList}>
              {right.workMix.map((w) => (
                <li key={`r-${w.work_type}`} className={styles.workItem}>
                  <span className={styles.workName}>{w.work_type}</span>
                  <span className={styles.workPct}>{Math.round(w.pct)}%</span>
                </li>
              ))}
              {right.workMix.length === 0 && <li className={styles.workEmpty}>No data</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
