import { formatDuration } from '../../lib/utils.js';
import ToolIcon from '../ToolIcon/ToolIcon.jsx';
import styles from './LockRow.module.css';

export default function LockRow({ lock }) {
  const owner = lock.owner_handle;
  const duration =
    lock.minutes_held != null ? formatDuration(lock.minutes_held) : '';

  return (
    <div className={styles.lockRow}>
      <span className={styles.lockFile}>{lock.file_path}</span>
      <span className={styles.lockOwner}>
        {lock.tool && lock.tool !== 'unknown' ? <ToolIcon tool={lock.tool} size={15} monochrome={true} /> : null}
        <span>{owner}</span>
      </span>
      {duration && <span className={styles.lockTime}>{duration}</span>}
    </div>
  );
}
