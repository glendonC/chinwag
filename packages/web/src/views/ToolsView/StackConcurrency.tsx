// When your stack overlaps — the coordination view of the Tools tab.
// A single 24-hour strip where each column is one hour of the day and the
// vertical stack is the set of tools that were active in that hour. Tall
// stacks = multi-tool overlap windows. Only a cross-vendor observer can
// render this, which is exactly what makes it the page's strongest
// coordination signal.

import { useMemo } from 'react';
import { getToolMeta } from '../../lib/toolMeta.js';
import { PREVIEW_STACK_CONCURRENCY, type ToolHourlyEntry } from './previewData.js';
import styles from './StackConcurrency.module.css';

interface Props {
  concurrency?: ToolHourlyEntry[];
}

interface HourBucket {
  hour: number;
  tools: string[];
}

interface PeakRange {
  start: number;
  end: number;
  tools: string[];
}

function formatHour(h: number): string {
  const normalized = ((h % 24) + 24) % 24;
  if (normalized === 0) return '12 AM';
  if (normalized < 12) return `${normalized} AM`;
  if (normalized === 12) return '12 PM';
  return `${normalized - 12} PM`;
}

// Longest contiguous run of hours at the day's max stack height (only if
// that max is ≥ 2, otherwise there's no real "overlap" to point at).
function findPeak(buckets: HourBucket[]): PeakRange | null {
  const max = buckets.reduce((m, b) => Math.max(m, b.tools.length), 0);
  if (max < 2) return null;

  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].tools.length === max) {
      if (curLen === 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curLen = 0;
    }
  }
  if (bestStart < 0) return null;

  const end = bestStart + bestLen - 1;
  const toolSet = new Set<string>();
  for (let i = bestStart; i <= end; i++) {
    for (const t of buckets[i].tools) toolSet.add(t);
  }
  return { start: bestStart, end, tools: [...toolSet] };
}

export default function StackConcurrency({ concurrency }: Props) {
  const liveHasData = concurrency && concurrency.length > 0;
  const source: ToolHourlyEntry[] = liveHasData ? concurrency : PREVIEW_STACK_CONCURRENCY;
  const isPreview = !liveHasData;

  const { buckets, maxStack, overlapPercent, peak, uniqueTools } = useMemo(() => {
    const hourBuckets: HourBucket[] = [];
    for (let h = 0; h < 24; h++) {
      const tools = source.filter((t) => (t.hours[h] ?? 0) > 0).map((t) => t.toolId);
      hourBuckets.push({ hour: h, tools });
    }
    const activeHours = hourBuckets.filter((b) => b.tools.length > 0).length;
    const overlapHours = hourBuckets.filter((b) => b.tools.length >= 2).length;
    const pct = activeHours > 0 ? Math.round((overlapHours / activeHours) * 100) : 0;
    const stackMax = hourBuckets.reduce((m, b) => Math.max(m, b.tools.length), 0);
    return {
      buckets: hourBuckets,
      maxStack: stackMax,
      overlapPercent: pct,
      peak: findPeak(hourBuckets),
      uniqueTools: source.length,
    };
  }, [source]);

  if (uniqueTools === 0) return null;

  const isSolo = uniqueTools < 2;
  const soloToolLabel = isSolo ? getToolMeta(source[0].toolId).label : null;

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div className={styles.eyebrowRow}>
          <span className={styles.eyebrow}>Stack concurrency</span>
          {isPreview && <span className={styles.previewBadge}>Preview</span>}
        </div>
        <h2 className={styles.title}>When your stack overlaps</h2>
        <p className={styles.subtitle}>
          {isSolo
            ? `Overlap lights up once a second tool starts reporting sessions. Right now you're running ${soloToolLabel ?? 'one tool'} alone.`
            : 'Each bar is one hour of the day. Tool brand colors stack when more than one tool was running in that hour.'}
        </p>
      </header>

      {!isSolo && (
        <>
          <div className={styles.stat}>
            <span className={styles.statValue}>{overlapPercent}%</span>
            <span className={styles.statLabel}>
              of your active hours had 2+ tools running at once
            </span>
          </div>

          <div className={styles.strip} role="img" aria-label="24-hour stack concurrency chart">
            {buckets.map((b) => {
              const stackHeightPct = maxStack > 0 ? (b.tools.length / maxStack) * 100 : 0;
              return (
                <div key={b.hour} className={styles.column}>
                  <div className={styles.stack} style={{ height: `${stackHeightPct}%` }}>
                    {b.tools.map((toolId, i) => {
                      const meta = getToolMeta(toolId);
                      return (
                        <span
                          key={`${toolId}-${i}`}
                          className={styles.segment}
                          style={{ background: meta.color }}
                          title={`${formatHour(b.hour)}–${formatHour(b.hour + 1)} · ${meta.label}`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.axis}>
            <span className={styles.axisLabel}>12 AM</span>
            <span className={styles.axisLabel}>6 AM</span>
            <span className={styles.axisLabel}>12 PM</span>
            <span className={styles.axisLabel}>6 PM</span>
            <span className={styles.axisLabel}>12 AM</span>
          </div>

          {peak && (
            <div className={styles.peak}>
              <span className={styles.peakLabel}>Peak overlap</span>
              <span className={styles.peakValue}>
                {formatHour(peak.start)}–{formatHour(peak.end + 1)}
                {' · '}
                {peak.tools.map((t) => getToolMeta(t).label).join(' + ')}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
