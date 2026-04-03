import { formatDuration } from '../../lib/utils.js';
import ToolIcon from '../ToolIcon/ToolIcon.jsx';
import styles from './SessionRow.module.css';

export default function SessionRow({ session }) {
  const duration = formatDuration(session.duration_minutes);
  const isLive = !session.ended_at;
  const editCount = session.edit_count || 0;
  const fileCount = session.files_touched?.length || 0;
  const ownerLabel = session.owner_handle || session.handle || 'Agent';
  const tool =
    session.framework && session.framework !== 'unknown'
      ? session.framework
      : session.host_tool || null;
  const toolIcon = session.host_tool && session.host_tool !== 'unknown' ? session.host_tool : null;

  const parts = [tool || 'agent', duration];
  if (editCount > 0) parts.push(`${editCount} edits`);
  if (fileCount > 0) parts.push(`${fileCount} files`);

  return (
    <div className={styles.row}>
      <div className={styles.identity}>
        {toolIcon ? <ToolIcon tool={toolIcon} size={16} monochrome={true} /> : null}
        <span className={styles.tool}>{ownerLabel}</span>
      </div>
      {isLive && <span className={styles.live}>live</span>}
      <span className={styles.meta}>{parts.join(' \u00b7 ')}</span>
    </div>
  );
}
