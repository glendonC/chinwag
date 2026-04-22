import type { CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import shared from '../widget-shared.module.css';
import styles from './TeamWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { capabilityCoverageNote, CoverageNote, GhostStatRow, isSoloTeam } from './shared.js';

// Audit 2026-04-21: Empty-state previously gated on `length <= 1`, which silenced
// a real solo user (their own row rendered as ghost em-dashes). The honest move
// is to show the single member when they exist and footer-explain that teammates
// appear when others join. `length === 0` remains the "no activity yet" state.
// Truncation: the worker caps the list at 50 per team, ships the uncapped count
// as member_analytics_total, and we surface "+N more" when the team exceeds the
// rendered window so the list never silently drops people.
function TeamMembersWidget({ analytics }: WidgetBodyProps) {
  const members = analytics.member_analytics;
  if (members.length === 0) {
    return <SectionEmpty>No activity yet — start a session to see yourself here.</SectionEmpty>;
  }
  const isSolo = members.length === 1;
  const total = analytics.member_analytics_total;
  const hidden = Math.max(0, total - members.length);
  return (
    <>
      <div className={shared.dataList}>
        {members.map((m, i) => {
          const meta = m.primary_tool ? getToolMeta(m.primary_tool) : null;
          return (
            <div
              key={m.handle}
              className={shared.dataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={shared.dataName}>
                {m.handle}
                {meta && (
                  <span className={shared.dataStat} style={{ marginLeft: 8 }}>
                    {meta.label}
                  </span>
                )}
              </span>
              <div className={shared.dataMeta}>
                <span className={shared.dataStat}>
                  <span className={shared.dataStatValue}>{m.sessions}</span> sessions
                </span>
                <span className={shared.dataStat}>
                  <span className={shared.dataStatValue}>{m.total_edits.toLocaleString()}</span>{' '}
                  edits
                </span>
                {m.completion_rate > 0 && (
                  <span className={shared.dataStat}>
                    <span className={shared.dataStatValue}>{m.completion_rate}%</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {hidden > 0 && (
        <CoverageNote text={`+${hidden} more teammate${hidden === 1 ? '' : 's'} with activity.`} />
      )}
      {isSolo && <CoverageNote text="Teammates appear here when others join the project." />}
    </>
  );
}

function ProjectsWidget({ summaries, liveAgents, selectTeam }: WidgetBodyProps) {
  if (summaries.length === 0) return <SectionEmpty>No projects</SectionEmpty>;

  return (
    <div className={styles.projectList}>
      {summaries.map((s, i) => {
        const teamId = (s.team_id as string) || '';
        const teamName = (s.team_name as string) || teamId;
        const sessions24 = (s.recent_sessions_24h as number) || 0;
        const conflictCount = (s.conflict_count as number) || 0;
        const memoryCount = (s.memory_count as number) || 0;
        const liveCount = liveAgents.filter((a) => a.teamId === teamId).length;
        return (
          <button
            key={teamId}
            type="button"
            className={styles.projectRow}
            style={{ '--row-index': i } as CSSProperties}
            onClick={() => selectTeam(teamId)}
          >
            <span className={styles.projectName}>{teamName}</span>
            <div className={styles.projectMeta}>
              {liveCount > 0 && (
                <span className={styles.projectLive}>
                  <span className={styles.liveDot} style={{ background: 'var(--accent)' }} />
                  {liveCount} live
                </span>
              )}
              {sessions24 > 0 && (
                <span className={styles.projectStat}>{sessions24} sessions (24h)</span>
              )}
              {conflictCount > 0 && (
                <span className={styles.projectStat} style={{ color: 'var(--warn)' }}>
                  {conflictCount} {conflictCount === 1 ? 'conflict' : 'conflicts'}
                </span>
              )}
              {memoryCount > 0 && (
                <span className={styles.projectStat}>
                  {memoryCount.toLocaleString()} {memoryCount === 1 ? 'memory' : 'memories'}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Audit 2026-04-21: Wire unused `completed` into the label so each bucket shows
// its sample size ("27 of 60 · with conflicts") rather than just the percent —
// prevents misreading a small-sample 100% as validated. The correlation caveat
// is surfaced inline because this widget is the first place users encounter the
// conflicts-hurt-completion framing, and the honest story is "correlated, not
// cause" — per REPORTS.md rule 3. Empty-state gates on whether the user has any
// team at all; a solo user sees the explicit "requires 2+ agents" copy instead
// of ghosts, since collisions require parallel sessions by definition.
function ConflictImpactWidget({ analytics }: WidgetBodyProps) {
  const cc = analytics.conflict_correlation;
  if (cc.length === 0) {
    return (
      <>
        <GhostStatRow labels={['with conflicts', 'without']} />
        <CoverageNote
          text={
            isSoloTeam(analytics)
              ? 'Requires 2+ agents — collisions only surface between parallel sessions.'
              : 'No sessions in this window.'
          }
        />
      </>
    );
  }
  return (
    <>
      <div className={shared.statRow}>
        {cc.map((c) => (
          <div key={c.bucket} className={shared.statBlock}>
            <span className={shared.statBlockValue}>{c.completion_rate}%</span>
            <span className={shared.statBlockLabel}>
              {c.completed} of {c.sessions} · {c.bucket}
            </span>
          </div>
        ))}
      </div>
      <CoverageNote text="Correlated with outcomes — complex sessions also collide more." />
    </>
  );
}

// Audit 2026-04-21: When empty AND solo, the capability note ("Hook-driven data
// from …") is the wrong answer — the user's question is "why zero," and the
// honest answer is "you're alone," not "your tool lacks hooks." Prefer the solo
// note in that case. Populated state keeps the capability attribution as-is
// because partial hook coverage does affect the number's interpretation.
function ConflictsBlockedWidget({ analytics }: WidgetBodyProps) {
  const cs = analytics.conflict_stats;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const empty = cs.blocked_period === 0 && cs.found_period === 0;
  const note =
    empty && isSoloTeam(analytics)
      ? 'Requires 2+ agents — collisions only detectable between parallel sessions.'
      : capabilityCoverageNote(tools, 'hooks');
  if (empty) {
    return (
      <>
        <GhostStatRow labels={['blocked', 'detected']} />
        <CoverageNote text={note} />
      </>
    );
  }
  return (
    <>
      <div className={shared.statRow}>
        <div className={shared.statBlock}>
          <span className={shared.statBlockValue}>{cs.blocked_period}</span>
          <span className={shared.statBlockLabel}>blocked</span>
        </div>
        <div className={shared.statBlock}>
          <span className={shared.statBlockValue}>{cs.found_period}</span>
          <span className={shared.statBlockLabel}>detected</span>
        </div>
      </div>
      <CoverageNote text={note} />
    </>
  );
}

// Audit 2026-04-21: Post-regroup render. New shape is file-keyed (one row per
// file, attempts summed across agents) so a single noisy agent can no longer
// dominate the top-10. The agents + tools columns surface the substrate-unique
// angle — "this file hurts multiple people using multiple tools" is a claim
// only chinwag can make. Path truncation adapts to disambiguation: if two
// visible rows share a basename (e.g., two `Button.tsx`), show up to four
// trailing segments so they aren't visually identical; otherwise keep last
// two for compactness. A muted "+N more" line surfaces when the SQL returns
// more than ten patterns, so users know the list is truncated.
function RetryPatternsWidget({ analytics }: WidgetBodyProps) {
  const rp = analytics.retry_patterns;
  if (rp.length === 0) return <SectionEmpty>No retry patterns</SectionEmpty>;

  const visible = rp.slice(0, 10);
  const basenameCount = new Map<string, number>();
  for (const r of visible) {
    const base = r.file.split('/').pop() || r.file;
    basenameCount.set(base, (basenameCount.get(base) ?? 0) + 1);
  }
  const displayPath = (file: string) => {
    const parts = file.split('/');
    const base = parts[parts.length - 1] ?? file;
    const collides = (basenameCount.get(base) ?? 0) > 1;
    const segments = collides ? Math.min(parts.length, 4) : Math.min(parts.length, 2);
    return parts.slice(-segments).join('/');
  };
  const hidden = Math.max(0, rp.length - visible.length);

  return (
    <>
      <div className={shared.dataList}>
        {visible.map((r, i) => (
          <div
            key={r.file}
            className={shared.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={shared.dataName} title={r.file}>
              {displayPath(r.file)}
            </span>
            <div className={shared.dataMeta}>
              <span className={shared.dataStat}>
                <span className={shared.dataStatValue}>{r.attempts}</span> attempts
              </span>
              {r.agents > 1 && (
                <span className={shared.dataStat}>
                  <span className={shared.dataStatValue}>{r.agents}</span> agents
                </span>
              )}
              {r.tools.length > 1 && (
                <span className={shared.dataStat}>
                  <span className={shared.dataStatValue}>{r.tools.length}</span> tools
                </span>
              )}
              <span
                className={shared.dataStat}
                style={{ color: r.resolved ? 'var(--success)' : 'var(--danger)' }}
              >
                {r.resolved ? 'resolved' : r.final_outcome}
              </span>
            </div>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <CoverageNote
          text={`+${hidden} more file${hidden === 1 ? '' : 's'} with retry patterns.`}
        />
      )}
    </>
  );
}

// Audit 2026-04-21: `overlap_rate` percentage was a B1 ambiguity — "60%" reads
// as good (paired collaboration) or bad (unintentional collision) depending on
// the reader's priors. Removed from the contract entirely; the renderer now
// shows absolute counts which are concrete and drill-adjacent to
// `concurrent-edits`. Solo users get an explicit "requires 2+ agents" note
// instead of ghost bars that imply the system measured and found none — in
// solo mode, overlap is structurally impossible, not an observed zero.
function FileOverlapWidget({ analytics }: WidgetBodyProps) {
  const fo = analytics.file_overlap;
  if (fo.total_files === 0) {
    return (
      <>
        <GhostStatRow labels={['shared', 'total']} />
        <CoverageNote
          text={
            isSoloTeam(analytics)
              ? 'Requires 2+ agents — overlap only forms when multiple agents touch the same file.'
              : 'No file activity in this window.'
          }
        />
      </>
    );
  }
  return (
    <div className={shared.statRow}>
      <div className={shared.statBlock}>
        <span className={shared.statBlockValue}>{fo.overlapping_files}</span>
        <span className={shared.statBlockLabel}>shared files</span>
      </div>
      <div className={shared.statBlock}>
        <span className={shared.statBlockValue}>{fo.total_files}</span>
        <span className={shared.statBlockLabel}>total files</span>
      </div>
    </div>
  );
}

export const teamWidgets: WidgetRegistry = {
  'team-members': TeamMembersWidget,
  'conflict-impact': ConflictImpactWidget,
  'conflicts-blocked': ConflictsBlockedWidget,
  'retry-patterns': RetryPatternsWidget,
  'file-overlap': FileOverlapWidget,
  projects: ProjectsWidget,
};
