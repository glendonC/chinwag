import ConflictBanner from '../../components/ConflictBanner/ConflictBanner.jsx';
import AgentRow from '../../components/AgentRow/AgentRow.jsx';
import LockRow from '../../components/LockRow/LockRow.jsx';
import SessionRow from '../../components/SessionRow/SessionRow.jsx';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import { formatShare } from '../../lib/toolAnalytics.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import styles from './ProjectView.module.css';

export default function ProjectLiveTab({
  sortedAgents,
  offlineAgents,
  conflicts,
  filesInPlay,
  locks,
  liveToolMix,
  sessions = [],
}) {
  const hasAgents = sortedAgents.length > 0;
  const hasFiles = filesInPlay.length > 0;
  const hasLocks = locks.length > 0;
  const hasToolMix = liveToolMix.length > 0;
  const hasAside = hasFiles || hasLocks || conflicts.length > 0 || hasToolMix;

  if (!hasAgents && !hasAside) {
    return <EmptyState title="No agents connected" hint="Open a connected tool in this repo." />;
  }

  return (
    <div className={hasAside ? styles.panelGrid : undefined}>
      <section className={styles.block}>
        <div className={styles.blockHeader}>
          <h2 className={styles.blockTitle}>Agents</h2>
          {offlineAgents.length > 0 ? (
            <span className={styles.blockMeta}>{offlineAgents.length} offline</span>
          ) : null}
        </div>

        {hasAgents ? (
          <div className={styles.sectionBody}>
            {sortedAgents.map((agent) => (
              <AgentRow
                key={agent.agent_id || `${agent.handle}:${agent.host_tool}`}
                agent={agent}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No agents connected" hint="Open a connected tool in this repo." />
        )}
      </section>

      {hasAside && (
        <div className={styles.asideStack}>
          {(hasFiles || hasLocks || conflicts.length > 0) && (
            <section className={styles.block}>
              <div className={styles.blockHeader}>
                <h2 className={styles.blockTitle}>Work in play</h2>
                <span className={styles.blockMeta}>{filesInPlay.length} files</span>
              </div>

              {conflicts.length > 0 && <ConflictBanner conflicts={conflicts} />}

              {hasFiles && (
                <div className={styles.pathList}>
                  {filesInPlay.map((file) => (
                    <span key={file} className={styles.pathRow}>
                      {file}
                    </span>
                  ))}
                </div>
              )}

              {hasLocks && (
                <div className={hasFiles ? styles.lockList : undefined}>
                  {locks.map((lock, index) => (
                    <LockRow
                      key={lock.file_path || `${lock.handle || 'lock'}:${index}`}
                      lock={lock}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {hasToolMix && (
            <section className={styles.block}>
              <div className={styles.blockHeader}>
                <h2 className={styles.blockTitle}>Live tools</h2>
                <span className={styles.blockMeta}>Active agents</span>
              </div>
              <div className={styles.distributionList}>
                {liveToolMix.map((tool) => (
                  <div key={tool.tool} className={styles.distributionRow}>
                    <div className={styles.distributionCopy}>
                      <span className={styles.distributionLabel}>
                        <ToolIcon tool={tool.tool} size={16} />
                        <span>{getToolMeta(tool.tool).label}</span>
                      </span>
                      <span className={styles.distributionMeta}>{tool.value} live</span>
                    </div>
                    <span className={styles.distributionValue}>{formatShare(tool.share)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {sessions.length > 0 && (
        <section className={styles.block} style={{ marginTop: 32 }}>
          <div className={styles.blockHeader}>
            <h2 className={styles.blockTitle}>Recent sessions</h2>
            <span className={styles.blockMeta}>{sessions.length}</span>
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
      )}
    </div>
  );
}
