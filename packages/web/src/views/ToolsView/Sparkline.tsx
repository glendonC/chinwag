// Tiny inline SVG sparkline. No axes, no tooltips - pure shape signal.

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  ariaLabel?: string;
}

export default function Sparkline({
  data,
  width = 80,
  height = 22,
  color = 'currentColor',
  ariaLabel,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role={ariaLabel ? 'img' : undefined}
        aria-label={ariaLabel}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeOpacity={0.2}
          strokeWidth={1}
        />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const min = 0;
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const lastX = (data.length - 1) * stepX;
  const lastY = height - ((data[data.length - 1] - min) / range) * (height - 2) - 1;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <circle cx={lastX} cy={lastY} r={1.6} fill={color} />
    </svg>
  );
}
