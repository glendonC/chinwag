import { useMemo, useState, useCallback } from 'react';
import styles from './ActivityTimeline.module.css';
import { BIN_COUNT, buildTimelineBins } from './timelineBins.js';

const RANGES = [
  { id: '24h', label: '24h', days: 1 },
  { id: '7d', label: '7d', days: 7 },
  { id: '30d', label: '30d', days: 30 },
];

export default function ActivityTimeline({ sessions = [], liveCount = 0 }) {
  const [rangeId, setRangeId] = useState('24h');
  const [hoveredBin, setHoveredBin] = useState(null);

  const range = RANGES.find((r) => r.id === rangeId);
  const bins = useMemo(
    () => buildTimelineBins(sessions, liveCount, range.days),
    [sessions, liveCount, range.days],
  );
  const max = Math.max(...bins.map((b) => b.value), 1);
  const hasActivity = bins.some((b) => b.value > 0);

  const selectRange = useCallback((id) => setRangeId(id), []);

  if (!hasActivity) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTrack}>
          {Array.from({ length: BIN_COUNT }).map((_, index) => (
            <span key={index} className={styles.emptyTick} />
          ))}
        </div>
        <div className={styles.footer}>
          <div className={styles.rangeToggle}>
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`${styles.rangeOption} ${rangeId === r.id ? styles.rangeActive : ''}`}
                onClick={() => selectRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <span className={styles.emptyLabel}>No session activity</span>
          <span className={styles.rangeLabel}>Now</span>
        </div>
      </div>
    );
  }

  const hovered = hoveredBin !== null ? bins[hoveredBin] : null;

  return (
    <div className={styles.timeline}>
      <div className={styles.chart} aria-hidden="true">
        {bins.map((bin, index) => {
          const height = 12 + Math.round((bin.value / max) * 58);
          const isCurrent = index === BIN_COUNT - 1;
          const isHovered = hoveredBin === index;
          return (
            <span
              key={index}
              className={styles.column}
              onMouseEnter={() => setHoveredBin(index)}
              onMouseLeave={() => setHoveredBin(null)}
            >
              <span
                className={`${styles.bar} ${isCurrent ? styles.barCurrent : ''} ${isHovered ? styles.barHovered : ''}`}
                style={{ height }}
              />
            </span>
          );
        })}
      </div>

      <div className={styles.footer}>
        <div className={styles.rangeToggle}>
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`${styles.rangeOption} ${rangeId === r.id ? styles.rangeActive : ''}`}
              onClick={() => selectRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <span className={styles.footerCenter}>
          {hovered ? (
            <span className={styles.tooltipText}>
              <span className={styles.tooltipValue}>{hovered.sessions}</span>
              <span className={styles.tooltipMeta}>
                {hovered.sessions === 1 ? 'session' : 'sessions'}
                {hovered.edits > 0 && <> &middot; {hovered.edits} edits</>}
                {hovered.conflicts > 0 && (
                  <span className={styles.tooltipConflict}>
                    {' '}
                    &middot; {hovered.conflicts}{' '}
                    {hovered.conflicts === 1 ? 'conflict' : 'conflicts'}
                  </span>
                )}
                <span className={styles.tooltipTime}> &middot; {hovered.label}</span>
              </span>
            </span>
          ) : (
            <span className={styles.statusText}>
              {liveCount > 0 ? (
                <>
                  <span className={styles.statusCount}>{liveCount}</span> active{' '}
                  {liveCount === 1 ? 'session' : 'sessions'}
                </>
              ) : (
                'No active sessions'
              )}
            </span>
          )}
        </span>

        <span className={styles.rangeLabel}>Now</span>
      </div>
    </div>
  );
}
