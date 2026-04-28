import { useMemo, type CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import sharedStyles from '../widget-shared.module.css';
import styles from './CodebaseWidgets.module.css';
import { arcPath, computeArcSlices } from '../../lib/svgArcs.js';
import { setQueryParams, useRoute } from '../../lib/router.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { FilePath, GhostBars, GhostRows, GhostStatRow, isSoloTeam } from './shared.js';

function openCodebase(tab: string, q: string) {
  return () => setQueryParams({ codebase: tab, q });
}

function useIsDrillable(): boolean {
  const route = useRoute();
  return route.view === 'overview';
}

function outcomeRateColor(rate: number): string {
  if (rate < 40) return 'var(--danger)';
  if (rate < 70) return 'var(--warn)';
  return 'var(--muted)';
}

function reworkSeverityColor(ratio: number): string {
  return ratio >= 50 ? 'var(--danger)' : 'var(--warn)';
}

function stalenessSeverityColor(days: number): string {
  if (days >= 60) return 'var(--muted)';
  if (days >= 30) return 'var(--warn)';
  return 'var(--soft)';
}

function commitIntensityColor(commits: number, max: number): string {
  if (commits === 0) return 'var(--ghost)';
  const ratio = commits / Math.max(1, max);
  if (ratio < 0.25) return 'var(--faint)';
  if (ratio < 0.5) return 'var(--soft)';
  if (ratio < 0.75) return 'var(--muted)';
  return 'var(--ink)';
}

const DIR_RING_PALETTE = [
  'var(--ink)',
  'var(--muted)',
  'var(--soft)',
  'var(--success)',
  'var(--info)',
];

// ── commit-stats ─────────────────────────────────────
// Hero count alone (no inline delta). To the right, a skyline of vertical
// bars, one per day, height = commits that day, color tier = intensity.
// One secondary line: median time to first commit + sessions that committed.
function CommitStatsWidget({ analytics }: WidgetBodyProps) {
  const cs = analytics.commit_stats;

  if (cs.total_commits === 0) {
    return <GhostStatRow labels={['commits', 'cadence', 'sessions']} />;
  }

  const maxDay = Math.max(...cs.daily_commits.map((d) => d.commits), 1);

  return (
    <div className={styles.commitFrame}>
      <div className={styles.commitHero}>
        <span className={styles.commitHeroValue}>{cs.total_commits.toLocaleString()}</span>
      </div>
      <div className={styles.commitTrend}>
        <div
          className={styles.commitSkyline}
          role="img"
          aria-label={`Commits over ${cs.daily_commits.length} days`}
        >
          {cs.daily_commits.map((d, i) => (
            <span
              key={d.day}
              className={styles.commitSkylineBar}
              style={
                {
                  height: `${(d.commits / maxDay) * 100}%`,
                  background: commitIntensityColor(d.commits, maxDay),
                  '--cell-index': i,
                } as CSSProperties
              }
              title={`${d.day}: ${d.commits} commits`}
            />
          ))}
        </div>
        <div className={styles.commitSecondary}>
          {cs.avg_time_to_first_commit_min != null && (
            <>
              <span className={styles.commitSecondaryValue}>
                {cs.avg_time_to_first_commit_min.toFixed(1)}m
              </span>{' '}
              to first commit
              <span className={styles.commitSecondarySep}>·</span>
            </>
          )}
          <span className={styles.commitSecondaryValue}>
            {cs.sessions_with_commits.toLocaleString()}
          </span>{' '}
          sessions committed
        </div>
      </div>
    </div>
  );
}

// ── directories ──────────────────────────────────────
// Ring + clickable-row table, mirroring the OutcomeWidgets primitive so
// the codebase tab reads as the same product. Donut on the left, table
// on the right with directory · touches · completion · View.
const DIR_RING_VIEW = 160;
const DIR_RING_CX = 80;
const DIR_RING_CY = 80;
const DIR_RING_R = 58;
const DIR_RING_GAP_DEG = 12;
const DIRECTORIES_VISIBLE = 8;
const DIR_RING_SLICES = 5;

interface DirArc {
  startDeg: number;
  sweepDeg: number;
  color: string;
}

function DirectoriesWidget({ analytics }: WidgetBodyProps) {
  const dirs = analytics.directory_heatmap;
  const drillable = useIsDrillable();

  const arcs = useMemo<DirArc[]>(() => {
    const top = dirs.slice(0, DIR_RING_SLICES);
    const totalTouches = dirs.reduce((s, d) => s + d.touch_count, 0);
    if (totalTouches === 0) return [];
    return computeArcSlices(
      top.map((d) => d.touch_count),
      DIR_RING_GAP_DEG,
    ).map((slice, i) => ({
      ...slice,
      color: DIR_RING_PALETTE[i] ?? 'var(--soft)',
    }));
  }, [dirs]);

  if (dirs.length === 0) return <GhostBars count={3} />;

  const visible = dirs.slice(0, DIRECTORIES_VISIBLE);
  const hidden = dirs.length - visible.length;

  return (
    <div className={styles.dirFrame}>
      <div className={styles.dirRingBlock}>
        <svg
          viewBox={`0 0 ${DIR_RING_VIEW} ${DIR_RING_VIEW}`}
          className={styles.dirRingSvg}
          role="img"
          aria-label={`Top ${arcs.length} directories by touches`}
        >
          <circle
            cx={DIR_RING_CX}
            cy={DIR_RING_CY}
            r={DIR_RING_R}
            className={styles.dirRingTrack}
          />
          {arcs
            .filter((a) => a.sweepDeg > 0.2)
            .map((a, i) => (
              <path
                key={i}
                d={arcPath(DIR_RING_CX, DIR_RING_CY, DIR_RING_R, a.startDeg, a.sweepDeg)}
                className={styles.dirRingArc}
                style={{ stroke: a.color }}
              />
            ))}
        </svg>
      </div>
      <div className={styles.dirTable} role="table">
        <div className={styles.dirHeadRow} role="row">
          <span role="columnheader">directory</span>
          <span role="columnheader" className={styles.dirHeadNum}>
            touches
          </span>
          <span role="columnheader">completion</span>
          <span aria-hidden="true" />
        </div>
        {visible.map((d, i) => {
          const completionColor = outcomeRateColor(d.completion_rate);
          const completionPct = Math.round(d.completion_rate);
          const content = (
            <>
              <FilePath path={d.directory} parentSegments={1} />
              <span className={styles.dirTouches}>{d.touch_count.toLocaleString()}</span>
              <span className={styles.dirCompletion}>
                <span className={styles.dirCompletionTrack}>
                  <span
                    className={styles.dirCompletionFill}
                    style={{
                      width: `${Math.max(2, completionPct)}%`,
                      background: completionColor,
                      opacity: 'var(--opacity-bar-fill)',
                    }}
                  />
                </span>
                <span className={styles.dirCompletionValue} style={{ color: completionColor }}>
                  {completionPct}%
                </span>
              </span>
              {drillable && <span className={styles.viewButton}>View</span>}
            </>
          );
          if (drillable) {
            return (
              <button
                key={d.directory}
                type="button"
                role="row"
                className={styles.dirDataRow}
                style={{ '--row-index': i } as CSSProperties}
                onClick={openCodebase('directories', 'top-dirs')}
                aria-label={`Open directories detail · ${d.directory} ${d.touch_count} touches`}
              >
                {content}
              </button>
            );
          }
          return (
            <div
              key={d.directory}
              role="row"
              className={styles.dirDataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              {content}
            </div>
          );
        })}
        {hidden > 0 && <div className={sharedStyles.moreHidden}>+{hidden} more directories</div>}
      </div>
    </div>
  );
}

// ── files ────────────────────────────────────────────
// "Hotspot beam": each file is rendered as a horizontal track whose fill
// width = touches share within the visible top-N, colored by outcome
// severity. Filename + churn (+/-) anchor the right rail. Header carries
// the View affordance; rows are buttons that drill into the landscape tab.
const FILES_VISIBLE = 8;

function FilesWidget({ analytics }: WidgetBodyProps) {
  const files = analytics.file_heatmap;
  const drillable = useIsDrillable();
  if (files.length === 0) return <GhostRows count={3} />;

  const visible = files.slice(0, FILES_VISIBLE);
  const hidden = files.length - visible.length;
  const maxTouches = Math.max(...visible.map((f) => f.touch_count), 1);

  return (
    <div className={styles.beamTable} role="table">
      <div className={styles.beamHeadRow} role="row">
        <span role="columnheader">file</span>
        <span role="columnheader">touches · outcome</span>
        <span role="columnheader" className={styles.beamHeadNum}>
          churn
        </span>
        <span aria-hidden="true" />
      </div>
      {visible.map((f, i) => {
        const linesAdded = f.total_lines_added ?? 0;
        const linesRemoved = f.total_lines_removed ?? 0;
        const hasLines = linesAdded > 0 || linesRemoved > 0;
        const hasOutcome = f.outcome_rate != null && f.outcome_rate > 0;
        const beamColor = hasOutcome ? outcomeRateColor(f.outcome_rate as number) : 'var(--soft)';
        const beamWidth = (f.touch_count / maxTouches) * 100;
        const content = (
          <>
            <FilePath path={f.file} />

            <span className={styles.beamCell}>
              <span className={styles.beamTrack}>
                <span
                  className={styles.beamFill}
                  style={{
                    width: `${Math.max(3, beamWidth)}%`,
                    background: beamColor,
                  }}
                />
              </span>
              <span className={styles.beamMeta}>
                <span className={styles.beamTouches}>{f.touch_count.toLocaleString()}</span>
                {hasOutcome && (
                  <span className={styles.beamOutcome} style={{ color: beamColor }}>
                    {f.outcome_rate}%
                  </span>
                )}
              </span>
            </span>
            <span className={styles.beamChurn}>
              {hasLines ? (
                <>
                  <span className={styles.beamChurnAdd}>+{linesAdded}</span>
                  <span className={styles.beamChurnSep}>/</span>
                  <span className={styles.beamChurnRem}>-{linesRemoved}</span>
                </>
              ) : (
                <span className={styles.beamChurnNone}>—</span>
              )}
            </span>
            {drillable && <span className={styles.viewButton}>View</span>}
          </>
        );
        if (drillable) {
          return (
            <button
              key={f.file}
              type="button"
              role="row"
              className={styles.beamRow}
              style={{ '--row-index': i } as CSSProperties}
              onClick={openCodebase('landscape', 'landscape')}
              aria-label={`Open file landscape detail · ${f.file} ${f.touch_count} touches`}
            >
              {content}
            </button>
          );
        }
        return (
          <div
            key={f.file}
            role="row"
            className={styles.beamRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            {content}
          </div>
        );
      })}
      {hidden > 0 && <div className={sharedStyles.moreHidden}>+{hidden} more files</div>}
    </div>
  );
}

// ── file-rework ──────────────────────────────────────
// Column-headed table whose RATE column carries a sparkline-style mini
// SVG: a smooth area+stroke curve that ramps from the baseline up to a
// height encoded from rework_ratio. Visually matches the trend-line
// vocabulary used in OutcomeWidgets without fabricating time-series
// data — the schema only carries a single ratio per file. Severity tier
// flips at 50%.
const FILE_REWORK_VISIBLE = 8;
const REWORK_SPARK_W = 100;
const REWORK_SPARK_H = 22;

function ReworkSpark({ ratio, max, color }: { ratio: number; max: number; color: string }) {
  // Smooth ramp from bottom-left up to the rate's level on the right.
  // Vertical position is normalized against the visible set's max ratio
  // so files stratify even when absolute rates are tightly clustered;
  // the % column carries the absolute number.
  const norm = max > 0 ? Math.min(1, ratio / max) : 0;
  const target = REWORK_SPARK_H - norm * (REWORK_SPARK_H - 3) - 2;
  const baseline = REWORK_SPARK_H - 1;
  const samples = 6;
  const points = Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    const ease = t * t * (3 - 2 * t);
    const x = t * REWORK_SPARK_W;
    const y = baseline - (baseline - target) * ease;
    return { x, y };
  });
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L${REWORK_SPARK_W},${REWORK_SPARK_H} L0,${REWORK_SPARK_H} Z`;
  return (
    <svg
      viewBox={`0 0 ${REWORK_SPARK_W} ${REWORK_SPARK_H}`}
      preserveAspectRatio="none"
      className={styles.lollipopSpark}
      aria-hidden="true"
    >
      <path d={area} fill={color} opacity={0.15} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function FileReworkWidget({ analytics }: WidgetBodyProps) {
  const fr = analytics.file_rework;
  const drillable = useIsDrillable();
  if (fr.length === 0) return <SectionEmpty>No rework signal</SectionEmpty>;
  const visible = fr.slice(0, FILE_REWORK_VISIBLE);
  const hidden = fr.length - visible.length;
  const sorted = [...visible].sort((a, b) => b.rework_ratio - a.rework_ratio);
  const maxRatio = Math.max(...sorted.map((f) => f.rework_ratio), 1);

  return (
    <div className={styles.lollipopTable} role="table">
      <div className={styles.lollipopHeadRow} role="row">
        <span role="columnheader">file</span>
        <span role="columnheader">fail rate</span>
        <span role="columnheader" className={styles.lollipopHeadNum}>
          failed
        </span>
        <span role="columnheader" className={styles.lollipopHeadNum}>
          total
        </span>
        <span aria-hidden="true" />
      </div>
      {sorted.map((f, i) => {
        const color = reworkSeverityColor(f.rework_ratio);
        const content = (
          <>
            <FilePath path={f.file} />

            <span className={styles.lollipopCell}>
              <ReworkSpark ratio={f.rework_ratio} max={maxRatio} color={color} />
              <span className={styles.lollipopValue} style={{ color }}>
                {f.rework_ratio}%
              </span>
            </span>
            <span className={styles.lollipopNum}>{f.failed_edits.toLocaleString()}</span>
            <span className={styles.lollipopNum}>{f.total_edits.toLocaleString()}</span>
            {drillable && <span className={styles.viewButton}>View</span>}
          </>
        );
        if (drillable) {
          return (
            <button
              key={f.file}
              type="button"
              role="row"
              className={styles.lollipopRow}
              style={{ '--row-index': i } as CSSProperties}
              onClick={openCodebase('risk', 'failing-files')}
              aria-label={`Open rework detail · ${f.file} ${f.rework_ratio}% rework`}
            >
              {content}
            </button>
          );
        }
        return (
          <div
            key={f.file}
            role="row"
            className={styles.lollipopRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            {content}
          </div>
        );
      })}
      {hidden > 0 && <div className={sharedStyles.moreHidden}>+{hidden} more files</div>}
    </div>
  );
}

// ── audit-staleness ──────────────────────────────────
// "Thermocline": each cold directory is a horizontal lane. A circle on
// the left rail carries prior_edit_count as visual mass (how loaded the
// directory was before going cold). The bar fills rightward proportional
// to days_since on a shared 14d-to-Nd scale, color tiered by severity.
// Heavy circle + long bar = was important, now abandoned.
const STALE_MASS_MIN = 6;
const STALE_MASS_MAX = 18;

function AuditStalenessWidget({ analytics }: WidgetBodyProps) {
  const data = analytics.audit_staleness;
  const drillable = useIsDrillable();
  if (data.length === 0) {
    return (
      <SectionEmpty>
        Cold directories appear after 14 days of activity history without a touch.
      </SectionEmpty>
    );
  }

  const sorted = [...data].sort((a, b) => b.days_since - a.days_since);
  const maxDays = Math.max(...sorted.map((d) => d.days_since), 14);
  const minDays = 14;
  const span = Math.max(1, maxDays - minDays);
  const maxMass = Math.max(...sorted.map((d) => d.prior_edit_count), 1);

  return (
    <div className={styles.thermoFrame}>
      {sorted.map((d, i) => {
        const color = stalenessSeverityColor(d.days_since);
        const fillPct = ((d.days_since - minDays) / span) * 100;
        const massSize =
          STALE_MASS_MIN + (d.prior_edit_count / maxMass) * (STALE_MASS_MAX - STALE_MASS_MIN);
        const lane = (
          <>
            <span
              className={styles.thermoMass}
              style={{
                width: `${massSize}px`,
                height: `${massSize}px`,
                background: color,
              }}
              title={`${d.prior_edit_count} prior edits`}
              aria-hidden="true"
            />
            <span className={styles.thermoTrack}>
              <span
                className={styles.thermoFill}
                style={{
                  width: `${Math.max(4, fillPct)}%`,
                  background: color,
                }}
              />
            </span>
            <span className={styles.thermoMeta}>
              <span className={styles.thermoDir} title={d.directory}>
                {d.directory}
              </span>
              <span className={styles.thermoDays} style={{ color }}>
                {d.days_since}d
              </span>
            </span>
            {drillable && <span className={styles.viewButton}>View</span>}
          </>
        );
        if (drillable) {
          return (
            <button
              key={d.directory}
              type="button"
              className={styles.thermoLane}
              style={{ '--row-index': i } as CSSProperties}
              onClick={openCodebase('directories', 'cold-dirs')}
              aria-label={`Open cold directories · ${d.directory} ${d.days_since} days`}
            >
              {lane}
            </button>
          );
        }
        return (
          <div
            key={d.directory}
            className={styles.thermoLane}
            style={{ '--row-index': i } as CSSProperties}
          >
            {lane}
          </div>
        );
      })}
    </div>
  );
}

// ── concurrent-edits ─────────────────────────────────
// Multi-attribute table with a per-row "contention stack" micro-primitive
// instead of dots-in-a-row. Each agent above the floor of two stacks as a
// short bar; tier color flips as collision count climbs (2 = soft, 3 =
// warn, 4+ = danger). Header carries the View affordance.
const CONCURRENT_EDITS_VISIBLE = 8;
const CONTENTION_STACK_CAP = 6;

function contentionColor(agents: number): string {
  if (agents >= 4) return 'var(--danger)';
  if (agents === 3) return 'var(--warn)';
  return 'var(--soft)';
}

function ConcurrentEditsWidget({ analytics }: WidgetBodyProps) {
  const ce = analytics.concurrent_edits;
  const drillable = useIsDrillable();
  if (ce.length === 0) {
    if (isSoloTeam(analytics)) {
      return (
        <SectionEmpty>
          Needs 2+ agents — collisions only form between parallel sessions.
        </SectionEmpty>
      );
    }
    return <SectionEmpty>No concurrent edits this period</SectionEmpty>;
  }
  const visible = ce.slice(0, CONCURRENT_EDITS_VISIBLE);
  const hidden = ce.length - visible.length;
  const maxEdits = Math.max(...visible.map((f) => f.edit_count), 1);

  return (
    <div className={styles.collisionTable} role="table">
      <div className={styles.collisionHeadRow} role="row">
        <span role="columnheader">file</span>
        <span role="columnheader">agents</span>
        <span role="columnheader" className={styles.collisionHeadNum}>
          edits
        </span>
        <span aria-hidden="true" />
      </div>
      {visible.map((f, i) => {
        const stackCount = Math.min(f.agents, CONTENTION_STACK_CAP);
        const overflow = Math.max(0, f.agents - CONTENTION_STACK_CAP);
        const color = contentionColor(f.agents);
        const editPct = (f.edit_count / maxEdits) * 100;
        const content = (
          <>
            <FilePath path={f.file} />

            <span className={styles.collisionStackCell} aria-label={`${f.agents} agents`}>
              <span className={styles.collisionStack}>
                {Array.from({ length: stackCount }, (_, j) => (
                  <span
                    key={j}
                    className={styles.collisionStackBar}
                    style={{ background: color }}
                    aria-hidden="true"
                  />
                ))}
              </span>
              <span className={styles.collisionAgentCount} style={{ color }}>
                {f.agents}
                {overflow > 0 && '+'}
              </span>
            </span>
            <span className={styles.collisionEdits}>
              <span className={styles.collisionEditsTrack}>
                <span
                  className={styles.collisionEditsFill}
                  style={{
                    width: `${Math.max(4, editPct)}%`,
                    background: 'var(--muted)',
                  }}
                />
              </span>
              <span className={styles.collisionEditsValue}>{f.edit_count.toLocaleString()}</span>
            </span>
            {drillable && <span className={styles.viewButton}>View</span>}
          </>
        );
        if (drillable) {
          return (
            <button
              key={f.file}
              type="button"
              role="row"
              className={styles.collisionRow}
              style={{ '--row-index': i } as CSSProperties}
              onClick={openCodebase('risk', 'collisions')}
              aria-label={`Open collisions detail · ${f.file} ${f.agents} agents`}
            >
              {content}
            </button>
          );
        }
        return (
          <div
            key={f.file}
            role="row"
            className={styles.collisionRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            {content}
          </div>
        );
      })}
      {hidden > 0 && <div className={sharedStyles.moreHidden}>+{hidden} more files</div>}
    </div>
  );
}

export const codebaseWidgets: WidgetRegistry = {
  'commit-stats': CommitStatsWidget,
  directories: DirectoriesWidget,
  files: FilesWidget,
  'file-rework': FileReworkWidget,
  'audit-staleness': AuditStalenessWidget,
  'concurrent-edits': ConcurrentEditsWidget,
};
