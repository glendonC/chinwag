// Per-tool drill-in: shows that tool's full story in the user's workflow.
// Reads pre-filtered slices from useScoredStackData via the getDrillIn helper.

import { type CSSProperties, useMemo } from 'react';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatDuration } from '../../lib/utils.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import Sparkline from './Sparkline.js';
import type { ToolDrillIn } from './useScoredStackData.js';
import styles from './StackToolDetail.module.css';

interface Props {
  drill: ToolDrillIn;
  rangeDays: number;
  onBack: () => void;
}

const WORK_TYPE_COLORS: Record<string, string> = {
  feature: '#a896d4',
  bugfix: '#d49aae',
  refactor: '#8ec0a4',
  test: '#f4c19a',
  docs: '#9ac3e5',
  config: '#c8a3d4',
  other: '#aab1bd',
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function StackToolDetail({ drill, rangeDays, onBack }: Props) {
  const meta = getToolMeta(drill.toolId);
  const c = drill.comparison;

  const sparkData = useMemo(() => {
    // Build a uniform-length sparkline from drill.daily for the period
    const days: string[] = [];
    const now = new Date();
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(now.getUTCDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const bucket = new Map<string, number>();
    for (const d of drill.daily) {
      bucket.set(d.day, (bucket.get(d.day) ?? 0) + d.sessions);
    }
    return days.map((d) => bucket.get(d) ?? 0);
  }, [drill.daily, rangeDays]);

  const totalWorkSessions = drill.workTypes.reduce((s, w) => s + w.sessions, 0);
  const sortedWork = [...drill.workTypes].sort((a, b) => b.sessions - a.sessions);

  return (
    <div className={styles.detail}>
      <button className={styles.back} onClick={onBack} type="button">
        {'\u2190'} Your tools
      </button>

      <header className={styles.header}>
        <ToolIcon tool={drill.toolId} size={36} />
        <div>
          <h1 className={styles.title}>{meta.label}</h1>
          <span className={styles.subtitle}>
            {c?.sessions ?? 0} sessions · last {rangeDays} days
          </span>
        </div>
        <span
          className={
            drill.reporting === 'reporting'
              ? styles.statusReporting
              : drill.reporting === 'silent'
                ? styles.statusSilent
                : styles.statusUnknown
          }
        >
          {drill.reporting === 'reporting'
            ? 'Reporting'
            : drill.reporting === 'silent'
              ? 'Silent'
              : 'No coverage data'}
        </span>
      </header>

      {/* ── Headline stats ── */}
      <div className={styles.statGrid}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Completion</span>
          <span className={styles.statValue}>{c?.completion_rate ?? 0}%</span>
          <span className={styles.statHint}>
            {c?.completed ?? 0} done · {c?.abandoned ?? 0} left · {c?.failed ?? 0} failed
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Avg duration</span>
          <span className={styles.statValue}>{formatDuration(c?.avg_duration_min ?? 0)}</span>
          <span className={styles.statHint}>per session</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>First edit</span>
          <span className={styles.statValue}>
            {drill.avgFirstEditMin != null ? formatDuration(drill.avgFirstEditMin) : '—'}
          </span>
          <span className={styles.statHint}>warm-up time</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Tokens</span>
          <span className={styles.statValue}>
            {formatTokens((drill.tokens?.input_tokens ?? 0) + (drill.tokens?.output_tokens ?? 0))}
          </span>
          <span className={styles.statHint}>
            in {formatTokens(drill.tokens?.input_tokens ?? 0)} · out{' '}
            {formatTokens(drill.tokens?.output_tokens ?? 0)}
          </span>
        </div>
      </div>

      {/* ── Trend ── */}
      <section className={styles.section}>
        <span className={styles.sectionLabel}>Sessions trend</span>
        <div className={styles.sparkRow}>
          <Sparkline
            data={sparkData}
            width={520}
            height={64}
            color={meta.color}
            ariaLabel={`${meta.label} session trend over ${rangeDays} days`}
          />
        </div>
      </section>

      {/* ── Work types ── */}
      {sortedWork.length > 0 && (
        <section className={styles.section}>
          <span className={styles.sectionLabel}>What this tool does</span>
          <div className={styles.workBar}>
            {sortedWork.map((w) => {
              const pct = totalWorkSessions > 0 ? (w.sessions / totalWorkSessions) * 100 : 0;
              if (pct < 1) return null;
              return (
                <div
                  key={w.work_type}
                  className={styles.workSegment}
                  style={{
                    width: `${pct}%`,
                    background: WORK_TYPE_COLORS[w.work_type] || WORK_TYPE_COLORS.other,
                  }}
                  title={`${w.work_type}: ${Math.round(pct)}%`}
                />
              );
            })}
          </div>
          <div className={styles.workLegend}>
            {sortedWork.map((w) => {
              const pct =
                totalWorkSessions > 0 ? Math.round((w.sessions / totalWorkSessions) * 100) : 0;
              if (pct < 1) return null;
              return (
                <div key={w.work_type} className={styles.workLegendItem}>
                  <span
                    className={styles.workDot}
                    style={{ background: WORK_TYPE_COLORS[w.work_type] || WORK_TYPE_COLORS.other }}
                  />
                  <span className={styles.workLegendLabel}>{w.work_type}</span>
                  <span className={styles.workLegendValue}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Errors ── */}
      {drill.errors.length > 0 && (
        <section className={styles.section}>
          <span className={styles.sectionLabel}>Top error patterns</span>
          <ul className={styles.errorList}>
            {drill.errors.slice(0, 5).map((e, i) => (
              <li
                key={`${e.tool}-${i}`}
                className={styles.errorRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.errorPreview}>{e.error_preview}</span>
                <span className={styles.errorCount}>{e.count}×</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Handoffs ── */}
      {(drill.handoffsOut.length > 0 || drill.handoffsIn.length > 0) && (
        <section className={styles.section}>
          <span className={styles.sectionLabel}>Cross-tool handoffs</span>
          <div className={styles.handoffGrid}>
            {drill.handoffsOut.length > 0 && (
              <div>
                <span className={styles.handoffSubLabel}>{meta.label} hands off to</span>
                <ul className={styles.handoffList}>
                  {drill.handoffsOut.map((h) => {
                    const target = getToolMeta(h.to_tool);
                    return (
                      <li key={h.to_tool} className={styles.handoffRow}>
                        <span className={styles.handoffName}>{target.label}</span>
                        <span className={styles.handoffMeta}>
                          {h.file_count} files · {h.handoff_completion_rate}% done
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {drill.handoffsIn.length > 0 && (
              <div>
                <span className={styles.handoffSubLabel}>Hands off to {meta.label}</span>
                <ul className={styles.handoffList}>
                  {drill.handoffsIn.map((h) => {
                    const source = getToolMeta(h.from_tool);
                    return (
                      <li key={h.from_tool} className={styles.handoffRow}>
                        <span className={styles.handoffName}>{source.label}</span>
                        <span className={styles.handoffMeta}>
                          {h.file_count} files · {h.handoff_completion_rate}% done
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Members ── */}
      {drill.members.length > 0 && (
        <section className={styles.section}>
          <span className={styles.sectionLabel}>Who uses it</span>
          <ul className={styles.memberList}>
            {drill.members.map((m) => (
              <li key={m.handle} className={styles.memberRow}>
                <span className={styles.memberName}>{m.handle}</span>
                <span className={styles.memberMeta}>
                  {m.sessions} sessions · {m.completion_rate}% done
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
