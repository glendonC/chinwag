import { useState, useCallback } from 'react';
import type { Member, Lock, Session } from '../../lib/apiSchemas.js';
import ConflictBanner from '../../components/ConflictBanner/ConflictBanner.jsx';
import AgentRow from '../../components/AgentRow/AgentRow.jsx';
import LockRow from '../../components/LockRow/LockRow.jsx';
import SessionRow from '../../components/SessionRow/SessionRow.jsx';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import SpawnForm from '../../components/SpawnAgentModal/SpawnAgentModal.jsx';
import { formatShare } from '../../lib/toolAnalytics.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { teamActions } from '../../lib/stores/teams.js';
import type { ToolMixEntry } from '../../lib/toolAnalytics.js';
import styles from './ProjectView.module.css';

interface FileConflict {
  file: string;
  owners?: string[];
  agents?: string[];
}

type SessionWithId = Session & { id?: string };

interface ProjectLiveTabProps {
  teamId: string;
  teamName?: string;
  sortedAgents: Member[];
  offlineAgents: Member[];
  conflicts: FileConflict[];
  filesInPlay: string[];
  locks: Lock[];
  liveToolMix: ToolMixEntry[];
  sessions?: SessionWithId[];
  availableSpawnTools?: string[];
}

export default function ProjectLiveTab({
  teamId,
  teamName,
  sortedAgents,
  offlineAgents,
  conflicts,
  filesInPlay,
  locks,
  liveToolMix,
  sessions = [],
  availableSpawnTools = [],
}: ProjectLiveTabProps) {
  const [showSpawn, setShowSpawn] = useState(false);

  const handleCommand = useCallback(
    async (type: 'stop' | 'message', payload: Record<string, unknown>) => {
      await teamActions.submitCommand(teamId, type, payload);
    },
    [teamId],
  );
  const hasAgents = sortedAgents.length > 0;
  const hasFiles = filesInPlay.length > 0;
  const hasLocks = locks.length > 0;
  const hasToolMix = liveToolMix.length > 0;
  const hasAside = hasFiles || hasLocks || conflicts.length > 0 || hasToolMix;

  return (
    <div className={hasAside ? styles.panelGrid : undefined}>
      <section className={styles.block}>
        <div className={styles.blockHeader}>
          <h2 className={styles.blockTitle}>Agents</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {offlineAgents.length > 0 && !showSpawn ? (
              <span className={styles.blockMeta}>{offlineAgents.length} offline</span>
            ) : null}
            <button
              type="button"
              className={styles.spawnBtn}
              onClick={() => setShowSpawn((v) => !v)}
            >
              {showSpawn ? (
                <>
                  Cancel
                  <span className={styles.spawnBtnArrow}>
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path
                        d="M3 3l6 6M9 3l-6 6"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </>
              ) : (
                <>
                  New agent
                  <span className={styles.spawnBtnArrow}>
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path
                        d="M6 2.5v7M3 6.5l3 3 3-3"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {showSpawn ? (
          <SpawnForm
            teamId={teamId}
            availableTools={availableSpawnTools}
            onClose={() => setShowSpawn(false)}
          />
        ) : hasAgents ? (
          <div className={styles.sectionBody}>
            {sortedAgents.map((agent) => (
              <AgentRow
                key={agent.agent_id || `${agent.handle}:${agent.host_tool}`}
                agent={agent}
                teamId={teamId}
                onCommand={handleCommand}
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
