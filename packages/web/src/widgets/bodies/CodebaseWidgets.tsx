import type { CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import FileFrictionRow from '../../components/viz/file/FileFrictionRow.js';
import styles from '../widget-shared.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import {
  capabilityCoverageNote,
  CoverageNote,
  GhostBars,
  GhostRows,
  GhostStatRow,
  MoreHidden,
  isSoloTeam,
} from './shared.js';

// Color the per-file/directory completion rate so a top-of-list entry with a
// weak outcome reads as a problem, not a celebration. Touch_count alone is
// contaminated by retry thrashing — the rate reframes what the rank means.
//   <40% → danger (thrash signal)
//   40–69% → warn
//   70%+  → muted (healthy; de-emphasize the green so every row isn't loud)
function outcomeRateColor(rate: number): string {
  if (rate < 40) return 'var(--danger)';
  if (rate < 70) return 'var(--warn)';
  return 'var(--muted)';
}

const DIRECTORIES_VISIBLE = 10;

function DirectoriesWidget({ analytics }: WidgetBodyProps) {
  const dirs = analytics.directory_heatmap;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'hooks');
  if (dirs.length === 0) {
    return (
      <>
        <GhostBars count={3} />
        <CoverageNote text={note} />
      </>
    );
  }
  const visible = dirs.slice(0, DIRECTORIES_VISIBLE);
  const hidden = dirs.length - visible.length;
  const maxT = Math.max(...visible.map((d) => d.touch_count), 1);
  return (
    <>
      <div className={styles.metricBars}>
        {visible.map((d, i) => (
          <div
            key={d.directory}
            className={styles.metricRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.metricLabel} title={d.directory}>
              {d.directory}
            </span>
            <div className={styles.metricBarTrack}>
              <div
                className={styles.metricBarFill}
                style={{ width: `${(d.touch_count / maxT) * 100}%` }}
              />
            </div>
            <span className={styles.metricValue}>
              <span style={{ color: outcomeRateColor(d.completion_rate) }}>
                {d.completion_rate}%
              </span>{' '}
              · {d.touch_count}
              {d.file_count > 0 ? ` · ${d.file_count}f` : ''}
            </span>
          </div>
        ))}
      </div>
      {hidden > 0 && <div className={styles.moreHidden}>+{hidden} more directories</div>}
      <CoverageNote text={note} />
    </>
  );
}

function FilesWidget({ analytics }: WidgetBodyProps) {
  const files = analytics.file_heatmap;
  if (files.length === 0) return <GhostRows count={3} />;
  return (
    <div className={styles.dataList}>
      {files.slice(0, 10).map((f, i) => {
        const linesAdded = f.total_lines_added ?? 0;
        const linesRemoved = f.total_lines_removed ?? 0;
        const hasLines = linesAdded > 0 || linesRemoved > 0;
        const hasOutcome = f.outcome_rate != null && f.outcome_rate > 0;
        return (
          <div
            key={f.file}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.dataName} title={f.file}>
              {f.file.split('/').slice(-2).join('/')}
            </span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{f.touch_count}</span> touches
              </span>
              {hasOutcome && (
                <span className={styles.dataStat}>
                  <span
                    className={styles.dataStatValue}
                    style={{ color: outcomeRateColor(f.outcome_rate as number) }}
                  >
                    {f.outcome_rate}%
                  </span>{' '}
                  completed
                </span>
              )}
              {hasLines && (
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>
                    +{linesAdded}/-{linesRemoved}
                  </span>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Rework ratio severity. Bicolor split — file-friction rows already carry a
// dimmed track behind a tinted fill, so the canonical ramp is warn → danger
// at the 50% inflection (majority of edits sat inside failing sessions).
// Below 50% reads as "real signal but not alarm"; the FileFrictionRow's
// dimmed meta carries the precise ratio.
//   ≥50% → danger (majority of edits failed; high-signal refactor target)
//   <50% → warn
function reworkSeverityColor(ratio: number): string {
  return ratio >= 50 ? 'var(--danger)' : 'var(--warn)';
}

// Note on the metric: `rework_ratio` (kept as the schema field name for back-
// compat) measures share of this file's edits that occurred inside sessions
// that later ended abandoned or failed. It is NOT edit-level retry — a clean
// edit on a file inside a session that gave up on a different file still
// counts here. The user-facing framing now says "in failing sessions" so the
// label matches the math; description elaborates.
const FILE_REWORK_VISIBLE = 10;
function FileReworkWidget({ analytics }: WidgetBodyProps) {
  const fr = analytics.file_rework;
  if (fr.length === 0) return <GhostRows count={3} />;
  const visible = fr.slice(0, FILE_REWORK_VISIBLE);
  const hidden = fr.length - visible.length;
  return (
    <>
      <div className={styles.dataList}>
        {visible.map((f, i) => (
          <FileFrictionRow
            key={f.file}
            index={i}
            label={f.file.split('/').slice(-2).join('/')}
            title={f.file}
            barFill={f.rework_ratio / 100}
            barColor={reworkSeverityColor(f.rework_ratio)}
            meta={
              <>
                {f.rework_ratio}% in failing sessions · {f.failed_edits}/{f.total_edits} edits
              </>
            }
          />
        ))}
      </div>
      <MoreHidden count={hidden} />
    </>
  );
}

// Cold-directory severity by days_since. Old/cold isn't a hard failure
// (--danger would over-alarm); it's a candidate for pruning or
// re-ownership. Three-tier ramp keeps the color carrying signal:
//   14–29d → soft (recently quiet)
//   30–59d → warn (drifting)
//   60d+   → ghost (effectively abandoned in this window)
function stalenessSeverityColor(days: number): string {
  if (days >= 60) return 'var(--ghost)';
  if (days >= 30) return 'var(--warn)';
  return 'var(--soft)';
}

const AUDIT_STALENESS_VISIBLE = 10;
function AuditStalenessWidget({ analytics }: WidgetBodyProps) {
  const as_ = analytics.audit_staleness;
  if (as_.length === 0) return <SectionEmpty>No stale directories</SectionEmpty>;
  const visible = as_.slice(0, AUDIT_STALENESS_VISIBLE);
  const hidden = as_.length - visible.length;
  return (
    <>
      <div className={styles.dataList}>
        {visible.map((d, i) => (
          <FileFrictionRow
            key={d.directory}
            index={i}
            label={d.directory}
            title={d.directory}
            barFill={Math.min(d.days_since / 90, 1)}
            barColor={stalenessSeverityColor(d.days_since)}
            meta={
              <>
                {d.days_since}d since · {d.prior_edit_count} prior edits
              </>
            }
          />
        ))}
      </div>
      <MoreHidden count={hidden} />
    </>
  );
}

const CONCURRENT_EDITS_VISIBLE = 10;
function ConcurrentEditsWidget({ analytics }: WidgetBodyProps) {
  const ce = analytics.concurrent_edits;
  if (ce.length === 0) {
    // Solo-team framing is structurally honest: a single-developer team
    // can't generate multi-agent edit collisions, so "no data" isn't a gap,
    // it's the truth. Match the detail-view's collisions empty copy.
    if (isSoloTeam(analytics)) {
      return (
        <SectionEmpty>No multi-agent edits — the team is touching disjoint files.</SectionEmpty>
      );
    }
    return <SectionEmpty>No concurrent edits detected</SectionEmpty>;
  }
  const visible = ce.slice(0, CONCURRENT_EDITS_VISIBLE);
  const hidden = ce.length - visible.length;
  // Relative scale across the visible set — collisions are coordination
  // friction, so the bar reads as "how loud is this row vs the loudest
  // row," not "fraction of some absolute team size."
  const maxAgents = Math.max(...visible.map((f) => f.agents), 1);
  return (
    <>
      <div className={styles.dataList}>
        {visible.map((f, i) => (
          <FileFrictionRow
            key={f.file}
            index={i}
            label={f.file.split('/').slice(-2).join('/')}
            title={f.file}
            barFill={f.agents / maxAgents}
            barColor="var(--warn)"
            meta={
              <>
                {f.agents} agents · {f.edit_count} edits
              </>
            }
          />
        ))}
      </div>
      <MoreHidden count={hidden} />
    </>
  );
}

// Commits are hook-sourced (Claude Code, Cursor, Windsurf). MCP-only tools
// don't populate the commits table — a solo Cline/Codex user has zero commits
// because the data path isn't there, not because they didn't commit. Coverage
// note discloses that in both populated and empty states; the shared helper
// returns null when coverage is universal so the note disappears when not
// needed. See shared.tsx:capabilityCoverageNote + A3 honesty comment.
function CommitStatsWidget({ analytics }: WidgetBodyProps) {
  const cs = analytics.commit_stats;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'commitTracking');
  if (cs.total_commits === 0) {
    return (
      <>
        <GhostStatRow labels={['commits', 'per session', 'sessions with commits']} />
        <CoverageNote text={note} />
      </>
    );
  }
  return (
    <>
      <div className={styles.statRow}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{cs.total_commits}</span>
          <span className={styles.statBlockLabel}>commits</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{cs.commits_per_session}</span>
          <span className={styles.statBlockLabel}>per session</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{cs.sessions_with_commits}</span>
          <span className={styles.statBlockLabel}>sessions with commits</span>
        </div>
      </div>
      <CoverageNote text={note} />
    </>
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
