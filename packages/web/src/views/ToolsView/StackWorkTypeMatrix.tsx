// Stack × Work Type matrix — the hero view on the Tools tab.
// Rows: tools in the user's stack. Columns: work types.
// Cell: % of that tool's sessions doing that type of work, with
// background intensity scaled by session count.
//
// Only chinwag can render this because it requires seeing every tool
// and every session on the same work classification.
//
// TODO(tech-context): once sessions.framework + file-extension language
// classification are exposed via /me/analytics, swap the columns from
// work_type to tech context (e.g. TS / Python / Go) so the matrix
// answers "which tool for which tech" instead of "which tool for which
// type of work". Data path: sessions.framework → aggregate per tool.

import { useMemo } from 'react';
import { getToolMeta } from '../../lib/toolMeta.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import type { ToolWorkTypeBreakdown } from '../../lib/apiSchemas.js';
import { WORK_TYPE_COLORS, WORK_TYPES, type WorkType } from '../../widgets/utils.js';
import { PREVIEW_TOOL_WORK_TYPE } from './previewData.js';
import styles from './StackWorkTypeMatrix.module.css';

interface Props {
  breakdown: ToolWorkTypeBreakdown[] | undefined;
  onToolClick?: (toolId: string) => void;
}

interface Row {
  toolId: string;
  totalSessions: number;
  byType: Record<WorkType, number>;
}

function classify(workType: string): WorkType {
  const key = workType.toLowerCase();
  if ((WORK_TYPES as readonly string[]).includes(key)) return key as WorkType;
  return 'other';
}

function emptyByType(): Record<WorkType, number> {
  return WORK_TYPES.reduce(
    (acc, t) => {
      acc[t] = 0;
      return acc;
    },
    {} as Record<WorkType, number>,
  );
}

export default function StackWorkTypeMatrix({ breakdown, onToolClick }: Props) {
  const liveHasData = (breakdown ?? []).some((b) => b.sessions > 0);
  const isPreview = !liveHasData;

  const rows = useMemo<Row[]>(() => {
    const source = liveHasData ? (breakdown ?? []) : PREVIEW_TOOL_WORK_TYPE;
    const byTool = new Map<string, Row>();
    for (const entry of source) {
      if (!entry.host_tool || entry.host_tool === 'unknown') continue;
      const row =
        byTool.get(entry.host_tool) ??
        ({
          toolId: entry.host_tool,
          totalSessions: 0,
          byType: emptyByType(),
        } satisfies Row);
      const t = classify(entry.work_type);
      row.byType[t] += entry.sessions;
      row.totalSessions += entry.sessions;
      byTool.set(entry.host_tool, row);
    }
    return [...byTool.values()]
      .filter((r) => r.totalSessions > 0)
      .sort((a, b) => b.totalSessions - a.totalSessions);
  }, [breakdown, liveHasData]);

  if (rows.length === 0) {
    return (
      <section className={styles.section}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>Stack × work type</span>
          <h2 className={styles.title}>Which tool for which job</h2>
        </header>
        <div className={styles.empty}>
          No work-type data yet. Once your tools report sessions, this matrix will show how each one
          spreads across frontend, backend, styling, test, docs, and config work.
        </div>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div className={styles.eyebrowRow}>
          <span className={styles.eyebrow}>Stack × work type</span>
          {isPreview && <span className={styles.previewBadge}>Preview</span>}
        </div>
        <h2 className={styles.title}>Which tool for which job</h2>
        <p className={styles.subtitle}>
          {isPreview
            ? 'Example data — this matrix shows what the view looks like with sessions from multiple tools. Your own numbers will replace this once work-type data flows through.'
            : "How each tool in your stack spreads across kinds of work. Darker = bigger share of that tool's sessions."}
        </p>
      </header>

      <div className={styles.matrix} role="table" aria-label="Tool by work type matrix">
        <div className={styles.row} role="row">
          <div className={styles.rowLabelHead} role="columnheader">
            Tool
          </div>
          {WORK_TYPES.map((t) => (
            <div key={t} className={styles.colHead} role="columnheader">
              {t}
            </div>
          ))}
          <div className={styles.totalHead} role="columnheader">
            Sessions
          </div>
        </div>

        {rows.map((r) => {
          const meta = getToolMeta(r.toolId);
          return (
            <button
              key={r.toolId}
              type="button"
              className={styles.row}
              role="row"
              onClick={() => onToolClick?.(r.toolId)}
              aria-label={`${meta.label} work type breakdown`}
            >
              <div className={styles.rowLabel} role="cell">
                <ToolIcon tool={r.toolId} size={18} />
                <span className={styles.rowName}>{meta.label}</span>
              </div>
              {WORK_TYPES.map((t) => {
                const value = r.byType[t];
                const pct = r.totalSessions > 0 ? value / r.totalSessions : 0;
                const alpha = pct === 0 ? 0 : 0.12 + pct * 0.65;
                return (
                  <div
                    key={t}
                    className={styles.cell}
                    role="cell"
                    style={{
                      backgroundColor:
                        pct === 0
                          ? 'transparent'
                          : `color-mix(in srgb, ${WORK_TYPE_COLORS[t]} ${Math.round(alpha * 100)}%, transparent)`,
                    }}
                    title={`${meta.label} · ${t}: ${value} sessions (${Math.round(pct * 100)}%)`}
                  >
                    {pct === 0 ? (
                      <span className={styles.zero}>—</span>
                    ) : (
                      <span className={styles.pct}>{Math.round(pct * 100)}%</span>
                    )}
                  </div>
                );
              })}
              <div className={styles.total} role="cell">
                {r.totalSessions}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
