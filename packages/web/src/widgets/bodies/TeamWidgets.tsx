import type { CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import shared from '../widget-shared.module.css';
import styles from './TeamWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { GhostRows } from './shared.js';

function TeamMembersWidget({ analytics }: WidgetBodyProps) {
  const members = analytics.member_analytics;
  if (members.length <= 1) return <GhostRows count={2} />;
  return (
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
                <span className={shared.dataStatValue}>{m.total_edits.toLocaleString()}</span> edits
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

export const teamWidgets: WidgetRegistry = {
  'team-members': TeamMembersWidget,
  projects: ProjectsWidget,
};
