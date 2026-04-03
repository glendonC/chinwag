import { projectGradient } from '../../lib/projectGradient.js';
import styles from './OverviewView.module.css';

interface TeamSummary {
  team_id: string;
  team_name?: string;
  memory_count?: number;
  [key: string]: unknown;
}

interface MemoriesPanelProps {
  summaries: TeamSummary[];
  totalMemories: number;
  selectTeam: (teamId: string) => void;
}

export default function MemoriesPanel({
  summaries,
  totalMemories,
  selectTeam,
}: MemoriesPanelProps) {
  if (totalMemories === 0) {
    return (
      <div className={styles.vizPanel} role="tabpanel" id="panel-memories">
        <p className={styles.emptyHint}>No memories saved yet.</p>
      </div>
    );
  }

  return (
    <div className={styles.vizPanel} role="tabpanel" id="panel-memories">
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
            .map((team, i) => {
              const count = team.memory_count || 0;
              const share = totalMemories > 0 ? Math.round((count / totalMemories) * 100) : 0;
              return (
                <button
                  key={team.team_id}
                  type="button"
                  className={styles.tableRow}
                  style={{ '--row-index': i } as React.CSSProperties}
                  onClick={() => selectTeam(team.team_id)}
                >
                  <span className={styles.tdLeft}>
                    <span
                      className={styles.squircle}
                      style={{ background: projectGradient(team.team_id) }}
                    />
                    {team.team_name || team.team_id}
                  </span>
                  <span className={styles.td}>{count}</span>
                  <span className={styles.td}>{share}%</span>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
