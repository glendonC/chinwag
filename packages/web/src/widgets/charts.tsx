import styles from '../views/OverviewView/OverviewView.module.css';

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
