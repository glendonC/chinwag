import { getToolMeta } from '../../lib/toolMeta.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import styles from './OverviewView.module.css';

interface AgentRow {
  tool: string;
  teamName: string;
  teamId: string;
  joins: number;
}

interface AgentsPanelProps {
  agentRows: AgentRow[];
}

export default function AgentsPanel({ agentRows }: AgentsPanelProps) {
  return (
    <div className={styles.vizPanel} role="tabpanel" id="panel-agents">
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
                <div
                  key={`${agent.teamId}-${agent.tool}-${i}`}
                  className={styles.tableRow}
                  style={{ '--row-index': i } as React.CSSProperties}
                >
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
  );
}
