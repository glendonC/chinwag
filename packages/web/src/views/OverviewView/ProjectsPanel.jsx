import { getToolMeta } from '../../lib/toolMeta.js';
import { projectGradient } from '../../lib/projectGradient.js';
import styles from './OverviewView.module.css';

export default function ProjectsPanel({
  summaries,
  filteredProjects,
  search,
  setSearch,
  selectTeam,
}) {
  return (
    <div className={styles.vizPanel} role="tabpanel" id="panel-projects">
      {summaries.length > 3 && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects"
          className={styles.searchInput}
        />
      )}
      <div className={styles.tableWrap}>
        <div className={styles.tableHead}>
          <span className={styles.thLeft}>Name</span>
          <span className={styles.th}>Live</span>
          <span className={styles.th}>Memories</span>
          <span className={styles.th}>Tools</span>
        </div>
        <div className={styles.tableBody}>
          {filteredProjects.map((team, i) => {
            const agents = team.active_agents || 0;
            const toolCount = (team.hosts_configured || []).filter(
              (t) => getToolMeta(t.host_tool).icon,
            ).length;
            return (
              <button
                key={team.team_id}
                type="button"
                className={styles.tableRow}
                style={{ '--row-index': i }}
                onClick={() => selectTeam(team.team_id)}
              >
                <span className={styles.tdLeft}>
                  <span
                    className={styles.squircle}
                    style={{ background: projectGradient(team.team_id) }}
                  />
                  {team.team_name || team.team_id}
                </span>
                <span className={`${styles.td} ${agents > 0 ? styles.tdAccent : ''}`}>
                  {agents}
                </span>
                <span className={styles.td}>{team.memory_count || 0}</span>
                <span className={styles.td}>{toolCount}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
