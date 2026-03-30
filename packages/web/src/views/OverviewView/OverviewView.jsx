import { useMemo, useState } from 'react';
import { usePollingStore, forceRefresh } from '../../lib/stores/polling.js';
import { useAuthStore } from '../../lib/stores/auth.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { getColorHex } from '../../lib/utils.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { buildHostJoinShare, buildSurfaceJoinShare } from '../../lib/toolAnalytics.js';
import { projectGradient } from '../../lib/projectGradient.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import StatusState from '../../components/StatusState/StatusState.jsx';
import { arcPath, CX, CY, R, SW, GAP, DEG } from '../../lib/svgArcs.js';
import styles from './OverviewView.module.css';

function summarizeNames(items) {
  const names = items
    .map((item) => item?.team_name || item?.team_id)
    .filter(Boolean);
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function summarizeProjects(projects) {
  if (!projects?.length) return '';
  if (projects.length <= 2) return projects.join(', ');
  return `${projects.slice(0, 2).join(', ')} +${projects.length - 2}`;
}

export default function OverviewView() {
  const dashboardData = usePollingStore((s) => s.dashboardData);
  const dashboardStatus = usePollingStore((s) => s.dashboardStatus);
  const pollError = usePollingStore((s) => s.pollError);
  const pollErrorData = usePollingStore((s) => s.pollErrorData);
  const lastUpdate = usePollingStore((s) => s.lastUpdate);
  const user = useAuthStore((s) => s.user);
  const teams = useTeamStore((s) => s.teams);
  const teamsError = useTeamStore((s) => s.teamsError);
  const selectTeam = useTeamStore((s) => s.selectTeam);
  const summaries = dashboardData?.teams ?? [];
  const failedTeams = dashboardData?.failed_teams ?? pollErrorData?.failed_teams ?? [];
  const [activeViz, setActiveViz] = useState('projects');
  const [search, setSearch] = useState('');
  const userColor = getColorHex(user?.color) || '#121317';
  const knownTeamCount = teams.length;
  const hasKnownProjects = knownTeamCount > 0 || summaries.length > 0;
  const lastSynced = formatRelativeTime(lastUpdate);
  const failedLabel = failedTeams.length > 0 ? summarizeNames(failedTeams) : '';

  const totalActive = useMemo(() => summaries.reduce((s, t) => s + (t.active_agents || 0), 0), [summaries]);
  const totalMemories = useMemo(() => summaries.reduce((s, t) => s + (t.memory_count || 0), 0), [summaries]);
  const hostShare = useMemo(() => buildHostJoinShare(summaries), [summaries]);
  const surfaceShare = useMemo(() => buildSurfaceJoinShare(summaries), [summaries]);

  const toolUsage = useMemo(() => {
    const totals = new Map();
    for (const team of summaries)
      for (const { tool, joins } of team.tools_configured || [])
        if (getToolMeta(tool).icon) totals.set(tool, (totals.get(tool) || 0) + joins);
    const entries = [...totals.entries()].map(([tool, joins]) => ({ tool, joins })).sort((a, b) => b.joins - a.joins);
    const total = entries.reduce((s, e) => s + e.joins, 0);
    return entries.map((e) => ({ ...e, share: total > 0 ? e.joins / total : 0 }));
  }, [summaries]);

  const uniqueTools = toolUsage.length;

  const arcs = useMemo(() => {
    if (!toolUsage.length) return [];
    const totalGap = GAP * toolUsage.length, available = 360 - totalGap;
    let offset = 0;
    return toolUsage.map((entry) => {
      const sweep = Math.max(entry.share * available, 4);
      const midDeg = (offset + sweep / 2 - 90) * DEG;
      const labelR = R + SW / 2 + 22;
      const anchorR = R + SW / 2 + 5;
      const arc = { ...entry, startDeg: offset, sweepDeg: sweep,
        labelX: CX + labelR * Math.cos(midDeg), labelY: CY + labelR * Math.sin(midDeg),
        anchorX: CX + anchorR * Math.cos(midDeg), anchorY: CY + anchorR * Math.sin(midDeg),
        side: Math.cos(midDeg) >= 0 ? 'right' : 'left' };
      offset += sweep + GAP;
      return arc;
    });
  }, [toolUsage]);

  // Agents: per-project, per-tool breakdown
  const agentRows = useMemo(() => {
    const rows = [];
    for (const team of summaries)
      for (const t of (team.tools_configured || []).filter((t) => getToolMeta(t.tool).icon && t.joins > 0))
        rows.push({ tool: t.tool, teamName: team.team_name || team.team_id, teamId: team.team_id, joins: t.joins });
    return rows.sort((a, b) => b.joins - a.joins);
  }, [summaries]);

  // Filtered projects
  const filteredProjects = useMemo(() => {
    if (!search.trim()) return summaries;
    const q = search.trim().toLowerCase();
    return summaries.filter((t) => (t.team_name || t.team_id).toLowerCase().includes(q));
  }, [summaries, search]);
  const isLoading = !dashboardData && (dashboardStatus === 'idle' || dashboardStatus === 'loading');
  const isUnavailable = dashboardStatus === 'error' || (!pollError && hasKnownProjects && summaries.length === 0);
  const unavailableHint = knownTeamCount === 0
    ? 'We could not load your project overview right now.'
    : knownTeamCount === 1
      ? `We found ${teams[0]?.team_name || teams[0]?.team_id || 'a connected project'}, but its overview data is unavailable right now.`
      : `We found ${knownTeamCount} connected projects, but none of their overview data could be loaded.`;
  const unavailableDetail = pollError
    || (failedLabel ? `Unavailable now: ${failedLabel}` : 'Project summaries are temporarily unavailable.');

  if (isLoading) {
    return (
      <div className={styles.overview}>
        <StatusState
          tone="loading"
          eyebrow="Overview"
          title="Loading your projects"
          hint="Pulling the latest team activity, memory counts, and tool presence."
        />
      </div>
    );
  }

  if (isUnavailable) {
    return (
      <div className={styles.overview}>
        <StatusState
          tone="danger"
          eyebrow="Overview unavailable"
          title="Could not load project overview"
          hint={unavailableHint}
          detail={unavailableDetail}
          meta={lastSynced ? `Last synced ${lastSynced}` : knownTeamCount > 0 ? `${knownTeamCount} connected ${knownTeamCount === 1 ? 'project' : 'projects'}` : 'Overview'}
          actionLabel="Retry"
          onAction={forceRefresh}
        />
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div className={styles.overview}>
        <EmptyState large title={teamsError ? 'Could not load projects' : 'No projects yet'}
          hint={teamsError || <>Run <code>npx chinwag init</code> in a repo to add one.</>} />
      </div>
    );
  }

  const stats = [
    { id: 'projects', label: 'Projects', value: knownTeamCount || summaries.length, tone: '' },
    { id: 'agents', label: 'Agents live', value: totalActive, tone: totalActive > 0 ? 'accent' : '' },
    { id: 'tools', label: 'Stack', value: uniqueTools, tone: '' },
    { id: 'memories', label: 'Memories', value: totalMemories, tone: '' },
  ];

  return (
    <div className={styles.overview}>
      <section className={styles.header}>
        <div className={styles.welcomeBlock}>
          <span className={styles.eyebrow}>Overview</span>
          <h1 className={styles.title}>
            Welcome back{user?.handle ? <>{', '}<span style={{ color: userColor }}>{user.handle}</span></> : null}.
          </h1>
        </div>
        {failedTeams.length > 0 && (
          <div className={styles.summaryNotice}>
            <span className={styles.summaryNoticeLabel}>
              {failedTeams.length} {failedTeams.length === 1 ? 'project' : 'projects'} unavailable
            </span>
            <span className={styles.summaryNoticeText}>{failedLabel}</span>
          </div>
        )}
        <div className={styles.statsRow}>
          {stats.map((s) => (
            <button key={s.id} type="button"
              className={`${styles.statButton} ${activeViz === s.id ? styles.statActive : ''}`}
              onClick={() => setActiveViz(s.id)}>
              <span className={styles.statLabel}>{s.label}</span>
              <span className={`${styles.statValue} ${s.tone === 'accent' ? styles.statAccent : ''}`}>{s.value}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.vizArea}>

        {/* ── PROJECTS ── */}
        {activeViz === 'projects' && (
          <div className={styles.vizPanel}>
            {summaries.length > 3 && (
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects" className={styles.searchInput} />
            )}
            <div className={styles.tableWrap}>
              <div className={styles.tableHead}>
                <span className={styles.thLeft}>Name</span>
                <span className={styles.th}>Live</span>
                <span className={styles.th}>Memories</span>
                <span className={styles.th}>Tools</span>
              </div>
              <div className={styles.tableBody}>
                {filteredProjects.map((team) => {
                  const agents = team.active_agents || 0;
                  const toolCount = (team.tools_configured || []).filter((t) => getToolMeta(t.tool).icon).length;
                  return (
                    <button key={team.team_id} type="button" className={styles.tableRow} onClick={() => selectTeam(team.team_id)}>
                      <span className={styles.tdLeft}>
                        <span className={styles.squircle} style={{ background: projectGradient(team.team_id) }} />
                        {team.team_name || team.team_id}
                      </span>
                      <span className={`${styles.td} ${agents > 0 ? styles.tdAccent : ''}`}>{agents}</span>
                      <span className={styles.td}>{team.memory_count || 0}</span>
                      <span className={styles.td}>{toolCount}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── AGENTS LIVE ── */}
        {activeViz === 'agents' && (
          <div className={styles.vizPanel}>
            {agentRows.length > 0 ? (
              <div className={styles.tableWrap}>
                <div className={styles.tableHead}>
                  <span className={styles.thLeft}>Tool</span>
                  <span className={styles.thLeft}>Project</span>
                  <span className={styles.th}>Sessions</span>
                </div>
                <div className={styles.tableBody}>
                  {agentRows.map((agent, i) => {
                    const meta = getToolMeta(agent.tool);
                    return (
                      <div key={`${agent.teamId}-${agent.tool}-${i}`} className={styles.tableRow}>
                        <span className={styles.tdLeft}>
                          <span className={styles.toolDot} style={{ background: meta.color }} />
                          <ToolIcon tool={agent.tool} size={16} />
                          {meta.label}
                        </span>
                        <span className={styles.tdLeftMuted}>{agent.teamName}</span>
                        <span className={styles.td}>{agent.joins}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className={styles.emptyHint}>No agent activity recorded yet.</p>
            )}
          </div>
        )}

        {/* ── TOOLS ── */}
        {activeViz === 'tools' && (
          <div className={styles.vizPanel}>
            {arcs.length > 0 ? (
              <div className={styles.toolsViz}>
                <div className={styles.ringWrap}>
                  <svg viewBox="0 0 260 260" className={styles.ringSvg}>
                    {arcs.map((arc) => {
                      const meta = getToolMeta(arc.tool);
                      return (
                        <g key={arc.tool}>
                          <path d={arcPath(CX, CY, R, arc.startDeg, arc.sweepDeg)} fill="none" stroke={meta.color} strokeWidth={SW} strokeLinecap="round" opacity="0.8" />
                          <line x1={arc.anchorX} y1={arc.anchorY} x2={arc.labelX} y2={arc.labelY} stroke="var(--faint)" strokeWidth="1" strokeDasharray="2 3" />
                          <text x={arc.labelX} y={arc.labelY - 4} textAnchor={arc.side === 'right' ? 'start' : 'end'} fill={meta.color} fontSize="16" fontWeight="400" fontFamily="var(--display)" letterSpacing="-0.04em">{Math.round(arc.share * 100)}%</text>
                          <text x={arc.labelX} y={arc.labelY + 10} textAnchor={arc.side === 'right' ? 'start' : 'end'} fill="var(--muted)" fontSize="9" fontFamily="var(--sans)" fontWeight="500">{meta.label}</text>
                        </g>
                      );
                    })}
                    <text x={CX} y={CY - 2} textAnchor="middle" dominantBaseline="central" fill="var(--ink)" fontSize="28" fontWeight="200" fontFamily="var(--display)" letterSpacing="-0.06em">{uniqueTools}</text>
                    <text x={CX} y={CY + 16} textAnchor="middle" fill="var(--muted)" fontSize="8.5" fontFamily="var(--mono)" letterSpacing="0.1em">STACK</text>
                  </svg>
                </div>

                <div className={styles.toolsLegend}>
                  {toolUsage.map((entry) => {
                    const meta = getToolMeta(entry.tool);
                    const projects = summaries
                      .filter((t) => (t.tools_configured || []).some((tc) => tc.tool === entry.tool))
                      .map((t) => t.team_name || t.team_id);
                    return (
                      <div key={entry.tool} className={styles.legendRow}>
                        <span className={styles.legendDot} style={{ background: meta.color }} />
                        <span className={styles.legendName}>{meta.label}</span>
                        <span className={styles.legendProjects}>{projects.join(', ')}</span>
                        <span className={styles.legendShare}>{Math.round(entry.share * 100)}%</span>
                        <span className={styles.legendSessions}>{entry.joins} session{entry.joins === 1 ? '' : 's'}</span>
                      </div>
                    );
                  })}
                </div>

                {(hostShare.length > 0 || surfaceShare.length > 0) && (
                  <div className={styles.signalGrid}>
                    <section className={styles.signalBlock}>
                      <div className={styles.signalHeader}>
                        <span className={styles.signalTitle}>Hosts</span>
                        <span className={styles.signalMeta}>Overview signal</span>
                      </div>
                      {hostShare.length > 0 ? (
                        <div className={styles.signalList}>
                          {hostShare.map((entry) => {
                            const meta = getToolMeta(entry.host_tool);
                            return (
                              <div key={`host:${entry.host_tool}`} className={styles.signalRow}>
                                <span className={styles.signalIdentity}>
                                  <ToolIcon tool={entry.host_tool} size={16} />
                                  {meta.label}
                                </span>
                                <span className={styles.signalValue}>{Math.round(entry.share * 100)}%</span>
                                <span className={styles.signalProjects}>{summarizeProjects(entry.projects)}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className={styles.emptyHint}>No host telemetry yet.</p>
                      )}
                    </section>

                    <section className={styles.signalBlock}>
                      <div className={styles.signalHeader}>
                        <span className={styles.signalTitle}>Agent surfaces</span>
                        <span className={styles.signalMeta}>Overview signal</span>
                      </div>
                      {surfaceShare.length > 0 ? (
                        <div className={styles.signalList}>
                          {surfaceShare.map((entry) => {
                            const meta = getToolMeta(entry.agent_surface);
                            return (
                              <div key={`surface:${entry.agent_surface}`} className={styles.signalRow}>
                                <span className={styles.signalIdentity}>
                                  <ToolIcon tool={entry.agent_surface} size={16} />
                                  {meta.label}
                                </span>
                                <span className={styles.signalValue}>{Math.round(entry.share * 100)}%</span>
                                <span className={styles.signalProjects}>{summarizeProjects(entry.projects)}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className={styles.emptyHint}>No extension-level surfaces observed yet.</p>
                      )}
                    </section>
                  </div>
                )}
              </div>
            ) : (
              <p className={styles.emptyHint}>No tools connected yet.</p>
            )}
          </div>
        )}

        {/* ── MEMORIES ── */}
        {activeViz === 'memories' && (
          <div className={styles.vizPanel}>
            {totalMemories > 0 ? (
              <div className={styles.tableWrap}>
                <div className={styles.tableHead}>
                  <span className={styles.thLeft}>Project</span>
                  <span className={styles.th}>Count</span>
                  <span className={styles.th}>Share</span>
                </div>
                <div className={styles.tableBody}>
                  {summaries
                    .filter((t) => (t.memory_count || 0) > 0)
                    .sort((a, b) => (b.memory_count || 0) - (a.memory_count || 0))
                    .map((team) => {
                      const count = team.memory_count || 0;
                      const share = totalMemories > 0 ? Math.round((count / totalMemories) * 100) : 0;
                      return (
                        <button key={team.team_id} type="button" className={styles.tableRow} onClick={() => selectTeam(team.team_id)}>
                          <span className={styles.tdLeft}>
                            <span className={styles.squircle} style={{ background: projectGradient(team.team_id) }} />
                            {team.team_name || team.team_id}
                          </span>
                          <span className={styles.td}>{count}</span>
                          <span className={styles.td}>{share}%</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ) : (
              <p className={styles.emptyHint}>No memories saved yet.</p>
            )}
          </div>
        )}

      </section>
    </div>
  );
}
