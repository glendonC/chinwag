import { useMemo } from 'react';
import styles from './ActivityTimeline.module.css';

const BIN_COUNT = 18;
const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toTimestamp(value) {
  if (!value) return null;
  const stamp = new Date(value).getTime();
  return Number.isFinite(stamp) ? stamp : null;
}

function buildBins(sessions, liveCount) {
  const now = Date.now();
  const start = now - DAY_MS;
  const binSize = DAY_MS / BIN_COUNT;
  const bins = Array.from({ length: BIN_COUNT }, () => 0);

  sessions.forEach((session) => {
    const startedAt = toTimestamp(session.started_at);
    if (!startedAt) return;

    const endedAt = toTimestamp(session.ended_at) || now;
    const sessionStart = Math.max(startedAt, start);
    const sessionEnd = Math.max(sessionStart, endedAt);

    const firstBin = clamp(Math.floor((sessionStart - start) / binSize), 0, BIN_COUNT - 1);
    const lastBin = clamp(Math.floor((sessionEnd - start) / binSize), 0, BIN_COUNT - 1);
    const weight = 1 + Math.min(2, (session.edit_count || 0) / 8);

    for (let index = firstBin; index <= lastBin; index += 1) {
      bins[index] += weight;
    }
  });

  bins[BIN_COUNT - 1] += liveCount * 0.9;
  return bins;
}

export default function ActivityTimeline({ sessions = [], liveCount = 0 }) {
  const bins = useMemo(() => buildBins(sessions, liveCount), [sessions, liveCount]);
  const max = Math.max(...bins, 1);
  const hasActivity = bins.some((value) => value > 0);

  if (!hasActivity) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTrack}>
          {Array.from({ length: BIN_COUNT }).map((_, index) => (
            <span key={index} className={styles.emptyTick} />
          ))}
        </div>
        <p className={styles.emptyLabel}>No recent session activity yet.</p>
      </div>
    );
  }

  return (
    <div className={styles.timeline}>
      <div className={styles.chart} aria-hidden="true">
        {bins.map((value, index) => {
          const height = 12 + Math.round((value / max) * 58);
          const isCurrent = index === BIN_COUNT - 1;
          return (
            <span key={index} className={styles.column}>
              <span
                className={`${styles.bar} ${isCurrent ? styles.barCurrent : ''}`}
                style={{ height }}
              />
            </span>
          );
        })}
      </div>

      <div className={styles.footer}>
        <span className={styles.rangeLabel}>24h ago</span>
        <div className={styles.legend}>
          <span className={styles.legendDot} />
          <span className={styles.legendText}>{liveCount} live now</span>
        </div>
        <span className={styles.rangeLabel}>Now</span>
      </div>
    </div>
  );
}
