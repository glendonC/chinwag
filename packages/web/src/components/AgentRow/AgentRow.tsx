import type { Member } from '../../lib/apiSchemas.js';
import { formatDuration } from '../../lib/utils.js';
import ToolIcon from '../ToolIcon/ToolIcon.jsx';
import styles from './AgentRow.module.css';

interface Props {
  agent: Member;
}

export default function AgentRow({ agent }: Props) {
  const isActive = agent.status === 'active';
  const tool = agent.host_tool && agent.host_tool !== 'unknown' ? agent.host_tool : null;
  const files = agent.activity?.files || [];
  const summary = agent.activity?.summary || '';
  const duration = formatDuration(agent.session_minutes);

  // Show first 2 file basenames
  const fileDisplay =
    files.length > 0
      ? files
          .slice(0, 2)
          .map((f) => f.split('/').pop())
          .join(', ') + (files.length > 2 ? ` +${files.length - 2}` : '')
      : null;

  // Filter out useless summaries
  const showSummary = summary && !/^editing\s/i.test(summary);

  return (
    <div className={`${styles.row} ${isActive ? '' : styles.offline}`}>
      <div className={styles.identity}>
        <span className={`${styles.dot} ${isActive ? styles.dotOn : styles.dotOff}`} />
        {tool && <ToolIcon tool={tool} size={16} monochrome={!isActive} />}
      </div>
      <div className={styles.info}>
        <span className={styles.handle}>{agent.handle}</span>
        <div className={styles.metaRow}>
          {tool ? <span className={styles.tool}>{tool}</span> : null}
          {fileDisplay ? <span className={styles.files}>{fileDisplay}</span> : null}
          {showSummary && !fileDisplay ? <span className={styles.summary}>{summary}</span> : null}
        </div>
      </div>
      {duration && <span className={styles.time}>{duration}</span>}
    </div>
  );
}
