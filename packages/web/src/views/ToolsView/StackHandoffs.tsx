// Who passes work to whom — the handoff strip view of the Tools tab.
// Consolidates the old N×N matrix and the separate "stack concurrency"
// section into one visual. Borrows the concurrency strip's vocabulary
// (big stat + vertical bars + axis + peak callout) but carries handoff
// data: one bar per directed tool-pair, colored as a 2-segment stack
// from source color (bottom) to destination color (top), height scaled
// by files passed.
//
// Clicking a bar opens the PairDetail panel via ?pair=<from>:<to>.

import { type CSSProperties, useMemo, useState } from 'react';
import clsx from 'clsx';
import { getToolMeta, normalizeToolId } from '../../lib/toolMeta.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import type { ToolHandoff } from '../../lib/apiSchemas.js';
import { PREVIEW_TOOL_HANDOFFS } from './previewData.js';
import styles from './StackHandoffs.module.css';

interface Props {
  breakdown: ToolHandoff[] | undefined;
  onPairClick?: (fromToolId: string, toToolId: string) => void;
}

const MAX_VISIBLE_PAIRS = 8;

function formatGap(mins: number): string | null {
  if (!Number.isFinite(mins) || mins <= 0) return null;
  if (mins < 60) return `~${Math.round(mins)}m`;
  if (mins < 1440) return `~${Math.round(mins / 60)}h`;
  return `~${Math.round(mins / 1440)}d`;
}

export default function StackHandoffs({ breakdown, onPairClick }: Props) {
  // Matches every other section on the Tools tab: live data when we have
  // it, preview otherwise. The Preview badge signals "example data."
  const liveHasData = (breakdown ?? []).length > 0;
  const isPreview = !liveHasData;

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const { pairs, maxFileCount, totalFiles, peak } = useMemo(() => {
    const source = liveHasData ? (breakdown ?? []) : PREVIEW_TOOL_HANDOFFS;
    const sorted = [...source].sort((a, b) => b.file_count - a.file_count);
    const visible = sorted.slice(0, MAX_VISIBLE_PAIRS).map((h) => ({
      key: `${normalizeToolId(h.from_tool)}:${normalizeToolId(h.to_tool)}`,
      fromTool: normalizeToolId(h.from_tool),
      toTool: normalizeToolId(h.to_tool),
      fileCount: h.file_count,
      avgGapMinutes: h.avg_gap_minutes,
    }));
    const max = visible.reduce((m, p) => (p.fileCount > m ? p.fileCount : m), 0);
    const total = sorted.reduce((sum, h) => sum + h.file_count, 0);
    const topPair = visible[0] ?? null;
    return {
      pairs: visible,
      maxFileCount: max,
      totalFiles: total,
      peak: topPair,
    };
  }, [breakdown, liveHasData]);

  if (pairs.length === 0) {
    return (
      <section className={styles.section}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>Handoffs · last 30 days</span>
          <h2 className={styles.title}>Who passes work to whom</h2>
        </header>
        <div className={styles.empty}>
          No cross-tool handoffs in the last 30 days. Once different tools start picking up each
          other&apos;s files within a day, this strip will fill in.
        </div>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div className={styles.eyebrowRow}>
          <span className={styles.eyebrow}>Handoffs · last 30 days</span>
          {isPreview && <span className={styles.previewBadge}>Preview</span>}
        </div>
        <h2 className={styles.title}>Who passes work to whom</h2>
        <p className={styles.subtitle}>
          {isPreview
            ? 'Example data — files one tool started and another picked up within 24 hours. Each bar is one directed tool pair; taller bars carry more files.'
            : 'Files one tool started and another picked up within 24 hours. Each bar is one directed tool pair; taller bars carry more files.'}
        </p>
      </header>

      <div className={styles.stat}>
        <span className={styles.statValue}>{totalFiles}</span>
        <span className={styles.statLabel}>
          file{totalFiles === 1 ? '' : 's'} flowed between your tools in the last 30 days
        </span>
      </div>

      <div
        className={styles.strip}
        style={{ '--n': pairs.length } as CSSProperties}
        role="img"
        aria-label={`Handoff volume across ${pairs.length} tool pair${pairs.length === 1 ? '' : 's'}`}
        onMouseLeave={() => setHoveredKey(null)}
      >
        {pairs.map((p) => {
          const heightPct = maxFileCount > 0 ? (p.fileCount / maxFileCount) * 100 : 0;
          const fromMeta = getToolMeta(p.fromTool);
          const toMeta = getToolMeta(p.toTool);
          const gapLabel = formatGap(p.avgGapMinutes);
          const active = hoveredKey === p.key;
          const dim = hoveredKey && !active;
          return (
            <button
              key={p.key}
              type="button"
              className={clsx(styles.column, dim && styles.columnDim)}
              onMouseEnter={() => setHoveredKey(p.key)}
              onFocus={() => setHoveredKey(p.key)}
              onClick={() => onPairClick?.(p.fromTool, p.toTool)}
              aria-label={`${fromMeta.label} handed off to ${toMeta.label}: ${p.fileCount} file${p.fileCount === 1 ? '' : 's'}${gapLabel ? `, typical gap ${gapLabel}` : ''}`}
              title={`${fromMeta.label} → ${toMeta.label} · ${p.fileCount} file${p.fileCount === 1 ? '' : 's'}${gapLabel ? ` · typical gap ${gapLabel}` : ''}`}
            >
              <div className={styles.stack} style={{ height: `${heightPct}%` }}>
                <span
                  className={styles.segment}
                  style={{ background: toMeta.color }}
                  aria-hidden="true"
                />
                <span
                  className={styles.segment}
                  style={{ background: fromMeta.color }}
                  aria-hidden="true"
                />
              </div>
            </button>
          );
        })}
      </div>

      <div className={styles.axis} style={{ '--n': pairs.length } as CSSProperties}>
        {pairs.map((p) => (
          <div key={p.key} className={styles.axisCell}>
            <ToolIcon tool={p.fromTool} size={12} />
            <span className={styles.axisArrow} aria-hidden="true">
              →
            </span>
            <ToolIcon tool={p.toTool} size={12} />
          </div>
        ))}
      </div>

      {peak && (
        <div className={styles.peak}>
          <span className={styles.peakLabel}>Most frequent</span>
          <span className={styles.peakValue}>
            {getToolMeta(peak.fromTool).label} → {getToolMeta(peak.toTool).label}
            {' · '}
            {peak.fileCount} file{peak.fileCount === 1 ? '' : 's'}
            {formatGap(peak.avgGapMinutes) ? ` · typical gap ${formatGap(peak.avgGapMinutes)}` : ''}
          </span>
        </div>
      )}

      {/* Narrow-viewport fallback: the strip collapses to a row list. */}
      <ul className={styles.compactList}>
        {pairs.map((p) => {
          const fromMeta = getToolMeta(p.fromTool);
          const toMeta = getToolMeta(p.toTool);
          const gapLabel = formatGap(p.avgGapMinutes);
          return (
            <li key={p.key} className={styles.compactItem}>
              <button
                type="button"
                className={styles.compactButton}
                onClick={() => onPairClick?.(p.fromTool, p.toTool)}
              >
                <span className={styles.compactPair}>
                  <ToolIcon tool={p.fromTool} size={14} />
                  <span>{fromMeta.label}</span>
                  <span className={styles.compactArrow} aria-hidden="true">
                    →
                  </span>
                  <ToolIcon tool={p.toTool} size={14} />
                  <span>{toMeta.label}</span>
                </span>
                <span className={styles.compactMeta}>
                  <span className={styles.compactCount}>{p.fileCount}</span>
                  <span className={styles.compactUnit}>files</span>
                  {gapLabel && <span className={styles.compactGap}>{gapLabel}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
