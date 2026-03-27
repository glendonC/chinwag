import { formatDuration } from '../../lib/utils.js';
import ToolIcon from '../ToolIcon/ToolIcon.jsx';
import styles from './SessionRow.module.css';

export default function SessionRow({ session }) {
  const duration = formatDuration(session.duration_minutes);
  const isLive = !session.ended_at;
  const editCount = session.edit_count || 0;
  const fileCount = session.files_touched?.length || 0;

  // Tool from agent_id is the identity
  const tool = session.framework && session.framework !== 'unknown'
    ? session.framework
    : (session.tool || null);
  const toolIcon = session.tool && session.tool !== 'unknown' ? session.tool : null;

  const parts = [duration];
  if (editCount > 0) parts.push(`${editCount} edits`);
  if (fileCount > 0) parts.push(`${fileCount} files`);

  return (
    <div className={styles.row}>
      <div className={styles.identity}>
        {toolIcon ? <ToolIcon tool={toolIcon} size={16} monochrome={true} /> : null}
        <span className={styles.tool}>{tool || 'Agent'}</span>
      </div>
      {isLive && <span className={styles.live}>live</span>}
      <span className={styles.meta}>{parts.join(' \u00b7 ')}</span>
    </div>
  );
}
