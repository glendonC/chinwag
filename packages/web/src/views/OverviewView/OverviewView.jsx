import { useMemo, useState } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useAuthStore } from '../../lib/stores/auth.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import ProjectCard from '../../components/ProjectCard/ProjectCard.jsx';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import styles from './OverviewView.module.css';

export default function OverviewView() {
  const dashboardData = usePollingStore((s) => s.dashboardData);
  const user = useAuthStore((s) => s.user);
  const teamsError = useTeamStore((s) => s.teamsError);
  const summaries = dashboardData?.teams ?? [];
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState('all');
  const [sortMode, setSortMode] = useState('activity');
  const [copiedInit, setCopiedInit] = useState(false);

  const totalActive = useMemo(
    () => summaries.reduce((sum, t) => sum + (t.active_agents || 0), 0),
    [summaries]
  );
  const totalConflicts = useMemo(
    () => summaries.reduce((sum, t) => sum + (t.conflict_count || 0), 0),
    [summaries]
  );
  const totalSessions = useMemo(
    () => summaries.reduce((sum, t) => sum + (t.recent_sessions_24h || 0), 0),
    [summaries]
  );
  const hasMultipleProjects = summaries.length > 1;
  const filteredProjects = useMemo(() => {
    let items = [...summaries];
    const query = searchQuery.trim().toLowerCase();

    if (query) {
      items = items.filter((team) => {
        const name = String(team.team_name || team.team_id || '').toLowerCase();
        const tools = (team.tools_configured || []).map((tool) => tool.tool).join(' ').toLowerCase();
        return name.includes(query) || tools.includes(query);
      });
    }

    if (filterMode === 'active') {
      items = items.filter((team) => (team.active_agents || 0) > 0);
    } else if (filterMode === 'conflicts') {
      items = items.filter((team) => (team.conflict_count || 0) > 0);
    } else if (filterMode === 'quiet') {
      items = items.filter((team) => (team.active_agents || 0) === 0 && (team.conflict_count || 0) === 0);
    }

    items.sort((a, b) => {
      if (sortMode === 'name') {
        return String(a.team_name || a.team_id).localeCompare(String(b.team_name || b.team_id));
      }

      if (sortMode === 'sessions') {
        return (b.recent_sessions_24h || 0) - (a.recent_sessions_24h || 0);
      }

      if (sortMode === 'conflicts') {
        return (b.conflict_count || 0) - (a.conflict_count || 0);
      }

      const aScore = ((a.active_agents || 0) * 3) + ((a.conflict_count || 0) * 4) + (a.recent_sessions_24h || 0);
      const bScore = ((b.active_agents || 0) * 3) + ((b.conflict_count || 0) * 4) + (b.recent_sessions_24h || 0);
      return bScore - aScore;
    });

    return items;
  }, [summaries, searchQuery, filterMode, sortMode]);

  async function handleCopyInit() {
    try {
      await navigator.clipboard.writeText('npx chinwag init');
      setCopiedInit(true);
      window.setTimeout(() => setCopiedInit(false), 1800);
    } catch {
      // Ignore clipboard failures.
    }
  }

  return (
    <div className={styles.overview}>
      {summaries.length > 0 ? (
        <>
          <section className={styles.headerSection}>
            <div className={styles.welcomeBlock}>
              <span className={styles.sectionEyebrow}>Overview</span>
              <h1 className={styles.welcomeTitle}>Welcome back{user?.handle ? `, ${user.handle}` : ''}.</h1>
            </div>

            <div className={styles.metricsRow} aria-label="Overview status">
              <OverviewMetric label="Projects" value={summaries.length} />
              <OverviewMetric label="Active agents" value={totalActive} tone={totalActive > 0 ? 'accent' : 'default'} hint="Active now" />
              <OverviewMetric label="Conflicts" value={totalConflicts} tone={totalConflicts > 0 ? 'danger' : 'default'} hint="Need review" />
              <OverviewMetric label="Sessions / 24h" value={totalSessions} tone={totalSessions > 0 ? 'success' : 'default'} hint="Recent activity" />
            </div>
          </section>

          <section className={styles.projectsSection}>
            <div className={styles.gridHeader}>
              <div className={styles.gridHeaderCopy}>
                <span className={styles.gridEyebrow}>Projects</span>
                <div className={styles.gridTitleRow}>
                  <h2 className={styles.gridTitle}>Projects</h2>
                  <span className={styles.gridMeta}>{summaries.length} connected</span>
                </div>
              </div>
              <button className={styles.addProjectButton} onClick={handleCopyInit}>
                {copiedInit ? 'Copied npx chinwag init' : 'Add project'}
              </button>
            </div>

            {hasMultipleProjects && (
              <div className={styles.controlsRow}>
                <label className={styles.searchField}>
                  <span className={styles.searchLabel}>Search</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Project or tool"
                    aria-label="Search projects"
                  />
                </label>

                <label className={styles.selectField}>
                  <span className={styles.selectLabel}>Filter</span>
                  <select value={filterMode} onChange={(event) => setFilterMode(event.target.value)} aria-label="Filter projects">
                    <option value="all">All projects</option>
                    <option value="active">Active</option>
                    <option value="conflicts">With conflicts</option>
                    <option value="quiet">Quiet</option>
                  </select>
                </label>

                <label className={styles.selectField}>
                  <span className={styles.selectLabel}>Sort</span>
                  <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} aria-label="Sort projects">
                    <option value="activity">Most active</option>
                    <option value="sessions">Most sessions</option>
                    <option value="conflicts">Most conflicts</option>
                    <option value="name">Name</option>
                  </select>
                </label>
              </div>
            )}

            {filteredProjects.length === 0 ? (
              <EmptyState
                title="No matching projects"
                hint="Try a different search, filter, or sort."
              />
            ) : !hasMultipleProjects && !searchQuery && filterMode === 'all' ? (
              <div className={styles.featuredProjectWrap}>
                <ProjectCard team={filteredProjects[0]} featured={true} />
              </div>
            ) : (
              <div className={styles.overviewGrid} role="list" aria-label="Projects">
                {filteredProjects.map((team) => (
                  <div key={team.team_id} role="listitem">
                    <ProjectCard team={team} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <EmptyState
          large={true}
          title={teamsError ? 'Could not load projects' : 'No projects yet'}
          hint={teamsError || <>Run <code>npx chinwag init</code> in a project to get started</>}
        />
      )}
    </div>
  );
}

function OverviewMetric({ label, value, tone = 'default', hint = '' }) {
  return (
    <div className={styles.metricItem}>
      <span className={styles.metricLabel}>{label}</span>
      <span
        className={`${styles.metricValue} ${
          tone === 'accent' ? styles.metricAccent : tone === 'danger' ? styles.metricDanger : tone === 'success' ? styles.metricSuccess : ''
        }`}
      >
        {value}
      </span>
      {hint ? <span className={styles.metricHint}>{hint}</span> : null}
    </div>
  );
}
