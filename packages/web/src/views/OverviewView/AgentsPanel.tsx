import { getToolMeta } from '../../lib/toolMeta.js';
import { formatDuration } from '../../lib/utils.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import type { LiveAgent } from './useOverviewData.js';
import styles from './OverviewView.module.css';

interface AgentsPanelProps {
  liveAgents: LiveAgent[];
  selectTeam: (id: string) => void;
}

/** Resolve the best tool id: explicit host_tool, or extract prefix from agent_id. */
function resolveToolId(agent: LiveAgent): string {
  if (agent.host_tool && agent.host_tool !== 'unknown') return agent.host_tool;
  const idx = agent.agent_id.indexOf(':');
  if (idx > 0) {
    const prefix = agent.agent_id.slice(0, idx);
    if (prefix !== 'unknown') return prefix;
  }
  return 'unknown';
}

function formatActivity(agent: LiveAgent): string | null {
  const files = agent.files || [];
  if (files.length > 0) {
    const display = files
      .slice(0, 2)
      .map((f) => f.split('/').pop())
      .join(', ');
    return files.length > 2 ? `${display} +${files.length - 2}` : display;
  }
  if (agent.summary && !/^editing\s/i.test(agent.summary)) {
    return agent.summary;
  }
  return null;
}

export default function AgentsPanel({ liveAgents, selectTeam }: AgentsPanelProps) {
  // Filter out agents we can't identify — they're phantom members (CLI/web joins), not real agents
  const identifiedAgents = liveAgents.filter((a) => resolveToolId(a) !== 'unknown');

  return (
    <div className={styles.vizPanel} role="tabpanel" id="panel-agents">
      {identifiedAgents.length > 0 ? (
        <div
          className={styles.tableWrap}
          style={
            {
              '--table-grid': 'minmax(120px, 1.2fr) minmax(80px, 0.8fr) minmax(100px, 1.4fr) 72px',
            } as React.CSSProperties
          }
        >
          <div className={styles.tableHead}>
            <span className={styles.thLeft}>Agent</span>
            <span className={styles.thLeft}>Owner</span>
            <span className={styles.thLeft}>Activity</span>
            <span className={styles.th}>Session</span>
          </div>
          <div className={styles.tableBody}>
            {identifiedAgents.map((agent, i) => {
              const toolId = resolveToolId(agent);
              const meta = getToolMeta(toolId);
              const activity = formatActivity(agent);

              return (
                <button
                  key={`${agent.teamId}-${agent.agent_id}`}
                  type="button"
                  className={styles.tableRow}
                  style={{ '--row-index': i } as React.CSSProperties}
                  onClick={() => selectTeam(agent.teamId)}
                >
                  <span className={styles.tdLeft}>
                    <ToolIcon tool={toolId} size={16} />
                    {meta.label}
                  </span>
                  <span className={styles.tdLeftMuted}>{agent.handle}</span>
                  <span className={styles.tdLeftMuted}>
                    {activity || <span className={styles.tdSoft}>idle</span>}
                  </span>
                  <span className={styles.td}>{formatDuration(agent.session_minutes)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className={styles.emptyHint}>No agents running.</p>
      )}
    </div>
  );
}
