import type { CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { Sparkline } from '../charts.js';
import shared from '../widget-shared.module.css';
import styles from './TeamWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import {
  capabilityCoverageNote,
  CoverageNote,
  GhostStatRow,
  InlineDelta,
  isSoloTeam,
} from './shared.js';

const SPARKLINE_DAILY_MIN_POINTS = 2;

// Cap on icons rendered before collapsing the rest into a `+N` overflow tag.
// 3 chosen to keep the column scannable at the default tile width while still
// accommodating the realistic 1-3 tools-per-project case without overflow.
const PROJECT_TOOLS_VISIBLE = 3;

interface HostMetric {
  host_tool: string;
  joins: number;
}

function ProjectsWidget({ summaries, liveAgents, selectTeam }: WidgetBodyProps) {
  if (summaries.length === 0) return <SectionEmpty>No projects</SectionEmpty>;

  return (
    <div className={styles.projectsTable}>
      <div className={styles.projectsTableHeader}>
        <span>Project</span>
        <span>Tools</span>
        <span>Activity</span>
        <span className={styles.projectsHeaderNum}>Memories</span>
        <span className={styles.projectsHeaderNum}>Conflicts</span>
        <span aria-hidden="true" />
      </div>
      <div className={styles.projectsTableBody}>
        {summaries.map((s, i) => {
          const teamId = (s.team_id as string) || '';
          const teamName = (s.team_name as string) || teamId;
          const memoryCount = (s.memory_count as number) || 0;
          const memoryPrev = s.memory_count_previous as number | undefined;
          const conflicts7d = s.conflicts_7d as number | undefined;
          const conflicts7dPrev = s.conflicts_7d_previous as number | undefined;
          const daily = s.daily_sessions_7d as number[] | undefined;
          const hostsConfigured = (s.hosts_configured as HostMetric[] | undefined) ?? [];

          // Live tool set for this team — derived from liveAgents on the
          // client rather than added to the backend payload. liveAgents is
          // already on the wire for the live-agents widget; deriving here
          // keeps both widgets' live state in lockstep.
          const liveTools = new Set(
            liveAgents.filter((a) => a.teamId === teamId).map((a) => a.host_tool),
          );

          // Sort: live tools first, then idle by join count desc. Live state
          // is signaled by full opacity vs. dimmed idle — no overlay glyphs.
          const sortedTools = [...hostsConfigured].sort((a, b) => {
            const aLive = liveTools.has(a.host_tool);
            const bLive = liveTools.has(b.host_tool);
            if (aLive !== bLive) return aLive ? -1 : 1;
            return b.joins - a.joins;
          });
          const visibleTools = sortedTools.slice(0, PROJECT_TOOLS_VISIBLE);
          const overflow = sortedTools.length - visibleTools.length;

          // Deltas suppress when the previous value is unknown (older
          // payloads or the field hasn't shipped yet). Showing a +N against
          // an assumed-zero previous would lie about growth.
          const memoryDelta = memoryPrev != null ? memoryCount - memoryPrev : null;
          const conflictsDelta =
            conflicts7d != null && conflicts7dPrev != null ? conflicts7d - conflicts7dPrev : null;

          return (
            <button
              key={teamId}
              type="button"
              className={styles.projectsTableRow}
              style={{ '--row-index': i } as CSSProperties}
              onClick={() => selectTeam(teamId)}
              aria-label={`Open ${teamName}`}
            >
              <span className={styles.projectsName}>{teamName}</span>

              <span className={styles.projectsCell}>
                {visibleTools.length === 0 ? (
                  <span className={styles.projectsEmpty}>—</span>
                ) : (
                  <span className={styles.projectsTools}>
                    {visibleTools.map((t) => {
                      const isLive = liveTools.has(t.host_tool);
                      const meta = getToolMeta(t.host_tool);
                      return (
                        <span
                          key={t.host_tool}
                          className={isLive ? styles.toolLive : styles.toolIdle}
                          title={isLive ? `${meta.label} (active)` : meta.label}
                        >
                          <ToolIcon tool={t.host_tool} size={16} />
                        </span>
                      );
                    })}
                    {overflow > 0 && <span className={styles.toolOverflow}>+{overflow}</span>}
                  </span>
                )}
              </span>

              <span
                className={styles.projectsActivityCell}
                title="Daily sessions over the last 7 days"
              >
                {daily && daily.length >= 2 ? (
                  <Sparkline data={daily} height={20} />
                ) : (
                  <span className={styles.projectsEmpty}>—</span>
                )}
              </span>

              <span className={styles.projectsNumCell}>
                <span className={styles.projectsNumValue}>{memoryCount.toLocaleString()}</span>
                {memoryDelta != null && memoryDelta !== 0 && <InlineDelta value={memoryDelta} />}
              </span>

              <span className={styles.projectsNumCell}>
                {conflicts7d != null ? (
                  <>
                    <span className={styles.projectsNumValue}>{conflicts7d.toLocaleString()}</span>
                    {conflictsDelta != null && conflictsDelta !== 0 && (
                      <InlineDelta value={conflictsDelta} invert />
                    )}
                  </>
                ) : (
                  <span className={styles.projectsEmpty}>—</span>
                )}
              </span>

              <span className={styles.projectsViewButton}>View</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// When empty AND solo, the capability note ("Hook-driven data from …") is
// the wrong answer — the user's question is "why zero," and the honest
// answer is "you're alone," not "your tool lacks hooks." Prefer the solo
// note in that case. Populated state keeps the capability attribution as-is
// because partial hook coverage does affect the number's interpretation.
//
// Typographic hierarchy: `blocked` is the visual hero (heroStatValue,
// light display 56pt-ish) because prevention is the substrate-unique
// value, not detection. `detected` demotes to a muted ratio caption
// ("X of Y collisions blocked before they landed") so the user reads
// the prevention rate, not parallel parity.
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
  // Daily sparkline of blocks over the period. Latent infrastructure for
  // when conflict_events ships and per-file ranking becomes possible
  // (claim-prevented-overwrites widget). Today the sparkline shows the
  // prevention trend, which is the daily-aggregate version of the question.
  const dailyBlocks = (cs.daily_blocked ?? []).map((d) => d.blocked);
  const showSparkline = dailyBlocks.length >= SPARKLINE_DAILY_MIN_POINTS;
  const activeDays = dailyBlocks.filter((d) => d > 0).length;
  return (
    <>
      <div className={styles.heroBlock}>
        <span className={shared.heroStatValue}>{cs.blocked_period}</span>
        <span className={styles.heroSupportFact}>
          {cs.blocked_period} of {cs.found_period} collisions blocked before they landed
        </span>
      </div>
      {showSparkline ? (
        <>
          <Sparkline data={dailyBlocks} height={24} />
          <div className={styles.sparklineCaption}>
            blocked across {activeDays} active {activeDays === 1 ? 'day' : 'days'}
          </div>
        </>
      ) : (
        <div className={styles.sparklineCaption}>single-day window — trend needs 2+ days</div>
      )}
      <CoverageNote text={note} />
    </>
  );
}

// file-overlap revived 2026-04-25 (post 18-month re-audit). Cut originally
// for an A3 lie in the populated branch (didn't consult isSoloTeam). The
// fix gates the populated render on team_size > 1 and shows an honest
// empty for solo. At team scale this is the substrate-unique scalar
// "what share of files this period saw multiple agents touch them" that
// no IDE produces. Detail questions: overlap rate by directory, period
// trend, average agents-per-file in overlap subset, claim coverage of
// overlap files (when auto-claim ships), tool-pair contribution.
//
// Hero is the rate (overlapping/total as %). The §10 #4-adjacent guardrail:
// NO tone color on the hero — high overlap isn't inherently bad (paired
// work) and low overlap isn't inherently good (silos), so it stays
// var(--ink) via the shared heroStatValue class. Raw counts demote to a
// muted supporting fact beneath ("47 of 380 files").
function FileOverlapWidget({ analytics }: WidgetBodyProps) {
  const fo = analytics.file_overlap;
  const solo = isSoloTeam(analytics);
  // Solo case: no overlap is structurally meaningful regardless of edits.
  // Honest empty state, do not render the populated branch even with edits.
  if (solo) {
    return (
      <>
        <GhostStatRow labels={['shared', 'total']} />
        <CoverageNote text="Requires 2+ agents — overlap only forms when multiple agents touch the same file." />
      </>
    );
  }
  if (fo.total_files === 0) {
    return (
      <>
        <GhostStatRow labels={['shared', 'total']} />
        <CoverageNote text="No file activity in this window." />
      </>
    );
  }
  const overlapRate = Math.round((fo.overlapping_files / fo.total_files) * 100);
  return (
    <div className={styles.heroBlock}>
      <span className={shared.heroStatValue}>{overlapRate}%</span>
      <span className={styles.heroSupportFact}>
        {fo.overlapping_files.toLocaleString()} of {fo.total_files.toLocaleString()} files
      </span>
    </div>
  );
}

export const teamWidgets: WidgetRegistry = {
  'conflicts-blocked': ConflictsBlockedWidget,
  'file-overlap': FileOverlapWidget,
  projects: ProjectsWidget,
};
