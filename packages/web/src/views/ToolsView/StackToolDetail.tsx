// Per-tool drill-in: shows that tool's full story in the user's workflow.
// Reads pre-filtered slices from useScoredStackData via the getDrillIn helper.

import { type CSSProperties, useMemo } from 'react';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatDuration } from '../../lib/utils.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import BackLink from '../../components/BackLink/BackLink.js';
import SectionTitle from '../../components/SectionTitle/SectionTitle.js';
import Sparkline from './Sparkline.js';
import {
  InternalUsageSection,
  SessionShapeSection,
  ModelPairingsSection,
  ScopeComplexitySection,
} from './DrillSections.js';
import type { ToolDrillIn } from './useScoredStackData.js';
import { workTypeColor } from '../OverviewView/overview-utils.js';
import styles from './StackToolDetail.module.css';

interface Props {
  drill: ToolDrillIn;
  rangeDays: number;
  onBack: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function StackToolDetail({ drill, rangeDays, onBack }: Props) {
  const meta = getToolMeta(drill.toolId);
  const c = drill.comparison;

  // Internal tool usage, session shape, and model pairings all depend on
  // the JSONL post-session parser, which currently only covers Claude Code.
  // For any other tool we hide these sections entirely rather than show an
  // empty shell — better to say nothing than to imply coverage we don't have.
  const hasDeepIntegration = meta.id === 'claude';

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

  const subtitleParts = [`${c?.sessions ?? 0} sessions`, `last ${rangeDays} days`];
  if (drill.reporting === 'silent') subtitleParts.push('no recent data');
  else if (drill.reporting === 'unknown') subtitleParts.push('no coverage signal');

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <BackLink label="Tools" onClick={onBack} />
        <div className={styles.titleRow}>
          <ToolIcon tool={drill.toolId} size={36} />
          <div className={styles.titleCopy}>
            <h1 className={styles.title}>{meta.label}</h1>
            <span className={styles.subtitle}>{subtitleParts.join(' · ')}</span>
          </div>
        </div>
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
        <SectionTitle>Sessions trend</SectionTitle>
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
          <SectionTitle>What this tool does</SectionTitle>
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
                    background: workTypeColor(w.work_type),
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
                    style={{ background: workTypeColor(w.work_type) }}
                  />
                  <span className={styles.workLegendLabel}>{w.work_type}</span>
                  <span className={styles.workLegendValue}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Behavior sections (Claude Code only; other tools don't expose this data) ── */}
      {hasDeepIntegration && (
        <>
          <InternalUsageSection toolId={drill.toolId} />
          <SessionShapeSection toolId={drill.toolId} />
          <ModelPairingsSection toolId={drill.toolId} />
        </>
      )}

      {/* ── Scope complexity (works for all tools via files_touched) ── */}
      <ScopeComplexitySection toolId={drill.toolId} />

      {/* ── Errors ── */}
      {drill.errors.length > 0 && (
        <section className={styles.section}>
          <SectionTitle>Top error patterns</SectionTitle>
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

      {/* ── Cross-tool file overlap ── */}
      {(drill.handoffsOut.length > 0 || drill.handoffsIn.length > 0) && (
        <section className={styles.section}>
          <SectionTitle>Files also touched by another tool</SectionTitle>
          <div className={styles.handoffGrid}>
            {drill.handoffsOut.length > 0 && (
              <div>
                <span className={styles.handoffSubLabel}>
                  After {meta.label}, these tools edited the same files
                </span>
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
                <span className={styles.handoffSubLabel}>
                  Before {meta.label}, these tools edited the same files
                </span>
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
          <SectionTitle>Who uses it</SectionTitle>
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
