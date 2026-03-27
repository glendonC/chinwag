import ToolIcon from '../ToolIcon/ToolIcon.jsx';
import styles from './MessageRow.module.css';

export default function MessageRow({ message }) {
  const tool = message.from_tool && message.from_tool !== 'unknown' ? message.from_tool : null;
  const from = tool ? `${message.from_handle}` : message.from_handle;

  return (
    <div className={styles.messageRow}>
      <div className={styles.messageFrom}>
        {tool ? <ToolIcon tool={tool} size={16} monochrome={true} /> : null}
        <span>{from}</span>
      </div>
      <span className={styles.messageText}>{message.text}</span>
    </div>
  );
}
