import { useMemo } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import ProjectCard from '../../components/ProjectCard/ProjectCard.jsx';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import styles from './OverviewView.module.css';

function buildSummary(active, conflicts, memories) {
  if (active === 0 && conflicts === 0 && memories === 0) return 'All quiet';
  const parts = [];
  if (active > 0) parts.push(`${active} agent${active !== 1 ? 's' : ''} active`);
  if (conflicts > 0) parts.push(`${conflicts} conflict${conflicts !== 1 ? 's' : ''}`);
  if (memories > 0) parts.push(`${memories} memor${memories !== 1 ? 'ies' : 'y'}`);
  return parts.join(' \u00b7 ');
}

export default function OverviewView() {
  const dashboardData = usePollingStore((s) => s.dashboardData);
  const teamsError = useTeamStore((s) => s.teamsError);
  const summaries = dashboardData?.teams ?? [];

  const totalActive = useMemo(
    () => summaries.reduce((sum, t) => sum + (t.active_agents || 0), 0),
    [summaries]
  );
  const totalConflicts = useMemo(
    () => summaries.reduce((sum, t) => sum + (t.conflict_count || 0), 0),
    [summaries]
  );
  const totalMemories = useMemo(
    () => summaries.reduce((sum, t) => sum + (t.memory_count || 0), 0),
    [summaries]
  );

  const summaryText = buildSummary(totalActive, totalConflicts, totalMemories);

  return (
    <div className={styles.overview}>
      {summaries.length > 0 ? (
        <>
          <header className={styles.overviewHeader}>
            <h1 className={styles.overviewTitle}>Projects</h1>
            <p className={styles.overviewSummary}>{summaryText}</p>
          </header>

          <div className={styles.overviewGrid} role="list" aria-label="Projects">
            {summaries.map((team) => (
              <div key={team.team_id} role="listitem">
                <ProjectCard team={team} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <header className={styles.overviewHeader}>
            <h1 className={styles.overviewTitle}>Projects</h1>
          </header>

          <EmptyState
            large={true}
            title={teamsError ? 'Could not load projects' : 'No projects yet'}
            hint={teamsError || <>Run <code>npx chinwag init</code> in a project to get started</>}
          />
        </>
      )}
    </div>
  );
}
