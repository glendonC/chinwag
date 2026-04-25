import type { CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { setQueryParams, useRoute } from '../../lib/router.js';
import { completionColor } from '../utils.js';
import trend from './TrendWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';

function openOutcomesTrend() {
  return () => setQueryParams({ outcomes: 'sessions', q: 'trend' });
}

function useIsDrillable(): boolean {
  const route = useRoute();
  return route.view === 'overview';
}

function OutcomeTrendWidget({ analytics }: WidgetBodyProps) {
  // Hero-first rate signal. The overview should answer the trend in one
  // glance; the daily bars provide texture after the large number lands.
  const drillable = useIsDrillable();
  const days = analytics.daily_trends;
  const observed = days.filter((d) => (d.sessions ?? 0) > 0);
  if (observed.length < 2) {
    return <SectionEmpty>Appears once sessions run on 2+ different days</SectionEmpty>;
  }

  const maxSessions = Math.max(...observed.map((d) => d.sessions ?? 0), 1);
  const firstDay = observed[0].day;
  const lastDay = observed[observed.length - 1].day;
  const dateRange = formatDateRange(firstDay, lastDay);
  const completed = observed.reduce((sum, d) => sum + (d.completed ?? 0), 0);
  const sessions = observed.reduce((sum, d) => sum + (d.sessions ?? 0), 0);
  const periodRate = sessions > 0 ? Math.round((completed / sessions) * 100) : 0;
  const observedRates = observed.map((d) =>
    Math.round(((d.completed ?? 0) / (d.sessions ?? 1)) * 100),
  );
  const firstRate = observedRates[0] ?? periodRate;
  const lastRate = observedRates[observedRates.length - 1] ?? periodRate;
  const delta = lastRate - firstRate;
  const minRate = Math.min(...observedRates);
  const maxRate = Math.max(...observedRates);
  const signal = trendSignal(periodRate, delta, maxRate - minRate);
  const deltaTone = delta === 0 ? 'var(--muted)' : delta > 0 ? 'var(--success)' : 'var(--danger)';
  const detailLabel = `Open outcomes detail · ${periodRate}% completion rate trend`;

  const content = (
    <>
      <div className={trend.rateHeader}>
        <div className={trend.rateHeroBlock}>
          <span className={trend.rateHero}>{periodRate}%</span>
          <span className={trend.rateSignal} style={{ color: signal.color }}>
            <span className={trend.rateDelta} style={{ color: deltaTone }}>
              {formatDelta(delta)}
            </span>{' '}
            {signal.label}
            {drillable && (
              <span className={trend.rateDetailArrow} aria-hidden="true">
                ↗
              </span>
            )}
          </span>
        </div>
      </div>
      <div
        className={trend.rateTape}
        role="img"
        aria-label={`Daily completion rate · ${periodRate}% overall, ${signal.label}`}
      >
        {days.map((d) => {
          const daySessions = d.sessions ?? 0;
          const rate =
            daySessions > 0 ? Math.round(((d.completed ?? 0) / daySessions) * 100) : null;
          const color = rate == null ? 'var(--ghost)' : completionColor(rate);
          const label = formatDay(d.day);
          const tooltip =
            rate == null
              ? `${label} · no sessions`
              : `${label} · ${rate}% completed · ${d.completed ?? 0} of ${daySessions} sessions`;
          const volume = daySessions > 0 ? Math.max(0.45, daySessions / maxSessions) : 0.18;

          return (
            <span
              key={d.day}
              className={trend.rateCell}
              style={
                {
                  '--rate-height': rate == null ? '14%' : `${Math.max(14, rate)}%`,
                  background: color,
                  opacity: volume,
                } as CSSProperties
              }
              title={tooltip}
            />
          );
        })}
      </div>
      <div className={trend.rateFooter} aria-hidden="true">
        <span>{dateRange || `${observed.length} active days`}</span>
        <span>{observed.length} active days</span>
      </div>
    </>
  );

  if (!drillable) return <div className={trend.rateFrame}>{content}</div>;
  return (
    <button
      type="button"
      className={`${trend.rateFrame} ${trend.rateFrameButton}`}
      onClick={openOutcomesTrend()}
      aria-label={detailLabel}
    >
      {content}
    </button>
  );
}

function trendSignal(
  periodRate: number,
  endDelta: number,
  spread: number,
): { label: string; color: string } {
  if (Math.abs(endDelta) >= 12) {
    return endDelta > 0
      ? { label: 'improving', color: 'var(--success)' }
      : { label: 'slipping', color: 'var(--danger)' };
  }
  if (spread >= 35) return { label: 'volatile', color: 'var(--warn)' };
  if (periodRate >= 70) return { label: 'healthy', color: 'var(--success)' };
  if (periodRate >= 50) return { label: 'watch', color: 'var(--warn)' };
  return { label: 'at risk', color: 'var(--danger)' };
}

function formatDelta(delta: number): string {
  if (delta === 0) return '→0pt';
  return `${delta > 0 ? '↑' : '↓'}${Math.abs(delta)}pt`;
}

/** Render a day ISO string as `Apr 24` for the tooltip. */
function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Render the first-to-last-day range as a caption. Same locale as
 *  the per-day tooltip so the vocabulary matches. */
function formatDateRange(first: string, last: string): string | null {
  const f = formatDay(first);
  const l = formatDay(last);
  if (!f || !l) return null;
  if (f === l) return f;
  return `${f} – ${l}`;
}

export const trendWidgets: WidgetRegistry = {
  'outcome-trend': OutcomeTrendWidget,
};
