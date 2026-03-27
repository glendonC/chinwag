import { useTeamStore } from '../../lib/stores/teams.js';
import ToolIcon from '../ToolIcon/ToolIcon.jsx';
import styles from './ProjectCard.module.css';

export default function ProjectCard({ team, featured = false }) {
  const selectTeam = useTeamStore((s) => s.selectTeam);
  const tools = team.tools_configured || [];
  const stateLabel = `${team.active_agents || 0} active / ${team.conflict_count || 0} conflicts`;

  const classes = [styles.card, featured ? styles.cardFeatured : ''].filter(Boolean).join(' ');

  function handleClick() {
    selectTeam(team.team_id);
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }

  return (
    <article
      className={classes}
      tabIndex={0}
      role="button"
      aria-label={`Open project ${team.team_name}`}
      onClick={handleClick}
      onKeyDown={handleKeydown}
    >
      <div className={styles.cardHeader}>
        <h3 className={styles.cardName}>{team.team_name}</h3>
        <span className={styles.cardMeta}>{stateLabel}</span>
      </div>

      <div className={styles.cardBody}>
        <div className={styles.primaryMetric}>
          <span className={styles.primaryValue}>{team.active_agents}</span>
          <div className={styles.primaryCopy}>
            <span className={styles.primaryLabel}>agents in play</span>
            <span className={styles.primaryHint}>
              {team.live_sessions || 0} live session{team.live_sessions === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className={styles.metaGroup}>
          <div className={styles.cardStats}>
            <div className={styles.cardStat}>
              <span className={styles.cardStatValue}>{team.recent_sessions_24h || 0}</span>
              <span className={styles.cardStatLabel}>sessions / 24h</span>
            </div>
            <div className={styles.cardStat}>
              <span className={styles.cardStatValue}>{team.memory_count || 0}</span>
              <span className={styles.cardStatLabel}>shared memories</span>
            </div>
            <div className={styles.cardStat}>
              <span className={styles.cardStatValue}>{team.conflict_count || 0}</span>
              <span className={styles.cardStatLabel}>active conflicts</span>
            </div>
          </div>

          {tools.length > 0 ? (
            <div className={styles.cardTools} aria-label="Configured tools">
              {tools.slice(0, 5).map((tool) => (
                <span key={tool.tool} className={styles.toolChip} title={tool.tool}>
                  <ToolIcon tool={tool.tool} size={16} />
                </span>
              ))}
              {tools.length > 5 && <span className={styles.toolMore}>+{tools.length - 5}</span>}
            </div>
          ) : (
            <p className={styles.emptyTools}>No tools configured yet.</p>
          )}
        </div>
      </div>
    </article>
  );
}
