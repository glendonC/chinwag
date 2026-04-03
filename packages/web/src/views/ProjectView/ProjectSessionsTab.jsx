import SessionRow from '../../components/SessionRow/SessionRow.jsx';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import SummaryStat from './SummaryStat.jsx';
import styles from './ProjectView.module.css';

export default function ProjectSessionsTab({
  sessions,
  sessionEditCount,
  filesTouched,
  filesTouchedCount,
  liveSessionCount,
}) {
  const hasFiles = filesTouched.length > 0;

  if (sessions.length === 0) {
    return <EmptyState title="No recent sessions" hint="Reported sessions appear here." />;
  }

  return (
    <div className={styles.panelGrid}>
      <section className={styles.block}>
        <div className={styles.blockHeader}>
          <h2 className={styles.blockTitle}>Recent sessions</h2>
        </div>
        <div className={styles.sectionBody}>
          {sessions.map((session, index) => (
            <SessionRow
              key={
                session.id ||
                `${session.owner_handle || session.handle}:${session.started_at || index}`
              }
              session={session}
            />
          ))}
        </div>
      </section>

      <div className={styles.asideStack}>
        <section className={styles.block}>
          <div className={styles.blockHeader}>
            <h2 className={styles.blockTitle}>24h totals</h2>
          </div>
          <div className={styles.summaryGrid}>
            <SummaryStat label="edits reported" value={sessionEditCount} />
            <SummaryStat label="files touched" value={filesTouchedCount} />
            <SummaryStat label="sessions still live" value={liveSessionCount} />
          </div>
        </section>

        {hasFiles && (
          <section className={styles.block}>
            <div className={styles.blockHeader}>
              <h2 className={styles.blockTitle}>Files touched</h2>
              <span className={styles.blockMeta}>{filesTouched.length}</span>
            </div>
            <div className={styles.pathList}>
              {filesTouched.map((file) => (
                <span key={`history:${file}`} className={styles.pathRow}>
                  {file}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
