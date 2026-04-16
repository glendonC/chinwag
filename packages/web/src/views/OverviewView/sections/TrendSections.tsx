import clsx from 'clsx';
import { Sparkline } from '../overview-charts.js';
import { formatDelta } from '../overview-utils.js';
import { formatDuration } from '../../../lib/utils.js';
import type {
  DailyTrend,
  EditVelocityTrend,
  PeriodComparison,
  PromptEfficiencyTrend,
  HourlyEffectiveness,
} from '../../../lib/apiSchemas.js';
import styles from '../OverviewView.module.css';

export function TrendsSection({ trends }: { trends: DailyTrend[] }) {
  if (trends.length < 2) return null;

  const sessionData = trends.map((d) => d.sessions);

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Session volume</span>
      <Sparkline data={sessionData} height={64} />
    </div>
  );
}

export function EditVelocitySection({ velocity }: { velocity: EditVelocityTrend[] }) {
  if (velocity.length < 2) return null;

  const editsData = velocity.map((d) => d.edits_per_hour);
  const linesData = velocity.map((d) => d.lines_per_hour);
  const totalHours = velocity.reduce((s, d) => s + d.total_session_hours, 0);
  const avgEditsPerHour =
    velocity.length > 0
      ? Math.round((velocity.reduce((s, d) => s + d.edits_per_hour, 0) / velocity.length) * 10) / 10
      : 0;
  const avgLinesPerHour =
    linesData.length > 0
      ? (linesData.reduce((a, b) => a + b, 0) / linesData.length).toFixed(1)
      : '0';

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Edit velocity</span>
      <div className={styles.statRow} style={{ marginBottom: 16 }}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{avgEditsPerHour}</span>
          <span className={styles.statBlockLabel}>avg edits/hr</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{avgLinesPerHour}</span>
          <span className={styles.statBlockLabel}>avg lines/hr</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{Math.round(totalHours)}</span>
          <span className={styles.statBlockLabel}>total session hours</span>
        </div>
      </div>
      <Sparkline data={editsData} height={48} />
    </div>
  );
}

export function PeriodDeltasSection({ comparison }: { comparison: PeriodComparison }) {
  const { current, previous } = comparison;
  if (current.total_sessions === 0) return null;
  if (!previous) return null;

  const metrics: Array<{
    label: string;
    current: number;
    previous: number;
    unit: string;
    invertDelta?: boolean;
  }> = [
    {
      label: 'Avg duration',
      current: current.avg_duration_min,
      previous: previous.avg_duration_min,
      unit: 'min',
      invertDelta: true,
    },
    {
      label: 'Edit velocity',
      current: current.edit_velocity,
      previous: previous.edit_velocity,
      unit: '/hr',
    },
    {
      label: 'Stuckness',
      current: current.stuckness_rate,
      previous: previous.stuckness_rate,
      unit: '%',
      invertDelta: true,
    },
    {
      label: 'Memory hit rate',
      current: current.memory_hit_rate,
      previous: previous.memory_hit_rate,
      unit: '%',
    },
  ];

  const hasChange = metrics.some((m) => m.previous > 0);
  if (!hasChange) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Period over period</span>
      <div className={styles.statRow}>
        {metrics.map((m) => {
          const d = formatDelta(m.current, m.previous);
          // For metrics where lower is better (duration, stuckness), invert the color
          const effectiveDir =
            d && m.invertDelta
              ? d.direction === 'up'
                ? 'down'
                : d.direction === 'down'
                  ? 'up'
                  : 'neutral'
              : d?.direction;
          return (
            <div key={m.label} className={styles.statBlock}>
              <span className={styles.statBlockValue}>
                {m.current}
                {m.unit}
              </span>
              {d && (
                <span
                  className={clsx(
                    styles.headlineDelta,
                    effectiveDir === 'up' && styles.deltaUp,
                    effectiveDir === 'down' && styles.deltaDown,
                    effectiveDir === 'neutral' && styles.deltaNeutral,
                  )}
                >
                  {d.value}
                  {m.unit}
                </span>
              )}
              <span className={styles.statBlockLabel}>{m.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PromptEfficiencySection({ data }: { data: PromptEfficiencyTrend[] }) {
  if (data.length < 2) return null;

  const avg =
    data.length > 0
      ? Math.round((data.reduce((s, d) => s + d.avg_turns_per_edit, 0) / data.length) * 10) / 10
      : 0;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Prompt efficiency</span>
      <div className={styles.statRow} style={{ marginBottom: 16 }}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{avg}</span>
          <span className={styles.statBlockLabel}>avg turns per edit</span>
        </div>
      </div>
      <Sparkline data={data.map((d) => d.avg_turns_per_edit)} height={48} />
    </div>
  );
}

export function HourlyEffectivenessSection({ data }: { data: HourlyEffectiveness[] }) {
  if (data.length === 0) return null;

  const best = [...data].sort((a, b) => b.completion_rate - a.completion_rate)[0];
  const worst = [...data]
    .filter((d) => d.sessions >= 3)
    .sort((a, b) => a.completion_rate - b.completion_rate)[0];

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>When you work best</span>
      <div className={styles.statRow} style={{ marginBottom: 16 }}>
        {best && (
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>
              {best.hour === 0
                ? '12a'
                : best.hour < 12
                  ? `${best.hour}a`
                  : best.hour === 12
                    ? '12p'
                    : `${best.hour - 12}p`}
            </span>
            <span className={styles.statBlockLabel}>best hour ({best.completion_rate}%)</span>
          </div>
        )}
        {worst && worst.hour !== best?.hour && (
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>
              {worst.hour === 0
                ? '12a'
                : worst.hour < 12
                  ? `${worst.hour}a`
                  : worst.hour === 12
                    ? '12p'
                    : `${worst.hour - 12}p`}
            </span>
            <span className={styles.statBlockLabel}>worst hour ({worst.completion_rate}%)</span>
          </div>
        )}
      </div>
      <div className={styles.metricBars}>
        {data
          .filter((d) => d.sessions > 0)
          .map((d) => {
            const label =
              d.hour === 0
                ? '12a'
                : d.hour < 12
                  ? `${d.hour}a`
                  : d.hour === 12
                    ? '12p'
                    : `${d.hour - 12}p`;
            return (
              <div key={d.hour} className={styles.metricRow}>
                <span className={styles.metricLabel}>{label}</span>
                <div className={styles.metricBarTrack}>
                  <div
                    className={clsx(
                      styles.metricBarFill,
                      d.completion_rate < 50 && styles.metricBarWarn,
                    )}
                    style={{ width: `${d.completion_rate}%` }}
                  />
                </div>
                <span className={styles.metricValue}>{d.completion_rate}%</span>
                <span className={styles.metricValue}>{d.avg_edits.toFixed(0)} avg edits</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
