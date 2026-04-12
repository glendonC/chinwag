import styles from './OverviewView.module.css';

export function RingChart({
  completed,
  abandoned,
  failed,
  size = 48,
  stroke = 4,
}: {
  completed: number;
  abandoned: number;
  failed: number;
  size?: number;
  stroke?: number;
}) {
  const total = completed + abandoned + failed;
  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.ring}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={(size - stroke) / 2}
          fill="none"
          stroke="var(--ghost)"
          strokeWidth={stroke}
        />
      </svg>
    );
  }

  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const gap = 4; // gap in pixels between segments
  const gapAngle = (gap / circumference) * 360;
  const segments = [
    { ratio: completed / total, color: 'var(--success)' },
    { ratio: abandoned / total, color: 'var(--warn)' },
    { ratio: failed / total, color: 'var(--danger)' },
  ].filter((s) => s.ratio > 0);

  let offset = -90; // start at top

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.ring}>
      {segments.map((seg, i) => {
        const angle = seg.ratio * 360 - (segments.length > 1 ? gapAngle : 0);
        const dashLength = (angle / 360) * circumference;
        const dashGap = circumference - dashLength;
        const rotation = offset;
        offset += seg.ratio * 360;
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeDasharray={`${dashLength} ${dashGap}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${rotation} ${size / 2} ${size / 2})`}
            opacity={0.7}
          />
        );
      })}
    </svg>
  );
}

export function Sparkline({
  data,
  width = 300,
  height = 48,
  color,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return null;

  const max = Math.max(...data, 1);
  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - (v / max) * (height - 4) - 2,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  const lineStyle = color ? { stroke: color } : undefined;
  const areaStyle = color ? { fill: color, fillOpacity: 0.08 } : undefined;
  const dotStyle = color ? { fill: color } : undefined;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={styles.trendSvg}
    >
      <path d={areaPath} className={styles.trendArea} style={areaStyle} />
      <path d={linePath} className={styles.trendLine} style={lineStyle} />
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={2.5}
          className={styles.trendDot}
          style={dotStyle}
        />
      )}
    </svg>
  );
}
