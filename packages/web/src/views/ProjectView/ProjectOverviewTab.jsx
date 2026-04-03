import { useMemo } from 'react';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import { getToolMeta } from '../../lib/toolMeta.js';
import SummaryStat from './SummaryStat.jsx';
import styles from './ProjectView.module.css';

export default function ProjectOverviewTab({
  members,
  activeAgents,
  conflicts,
  locks,
  sessionEditCount,
  liveSessionCount,
  filesTouchedCount,
  toolSummaries,
}) {
  const stuckAgents = useMemo(
    () => activeAgents.filter((a) => (a.minutes_since_update || 0) >= 15),
    [activeAgents],
  );

  const staleLocks = useMemo(() => locks.filter((l) => (l.minutes_held || 0) >= 30), [locks]);

  const teamRoster = useMemo(() => {
    const byHandle = new Map();
    for (const m of members) {
      const prev = byHandle.get(m.handle);
      const online = m.status === 'active';
      if (!prev) {
        byHandle.set(m.handle, {
          handle: m.handle,
          online,
          tools: m.host_tool && m.host_tool !== 'unknown' ? [m.host_tool] : [],
        });
      } else {
        if (online) prev.online = true;
        if (m.host_tool && m.host_tool !== 'unknown' && !prev.tools.includes(m.host_tool)) {
          prev.tools.push(m.host_tool);
        }
      }
    }
    return [...byHandle.values()].sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
  }, [members]);

  const issueCount = conflicts.length + stuckAgents.length + staleLocks.length;
  const activeTools = toolSummaries.filter((t) => t.live > 0);

  return (
    <div className={styles.panelGrid}>
      <div>
        <section className={styles.block}>
          <div className={styles.blockHeader}>
            <h2 className={styles.blockTitle}>Health</h2>
            {issueCount === 0 && <span className={styles.blockMeta}>All clear</span>}
          </div>

          {issueCount === 0 ? (
            <p className={styles.emptyHint}>No conflicts, stuck agents, or stale locks.</p>
          ) : (
            <div className={styles.issueList}>
              {conflicts.length > 0 && (
                <p className={styles.issueRow}>
                  <span className={styles.issueCount}>{conflicts.length}</span>
                  <span className={styles.issueLabel}>
                    file {conflicts.length === 1 ? 'conflict' : 'conflicts'}
                  </span>
                </p>
              )}
              {stuckAgents.length > 0 && (
                <p className={styles.issueRow}>
                  <span className={styles.issueCount}>{stuckAgents.length}</span>
                  <span className={styles.issueLabel}>
                    stuck {stuckAgents.length === 1 ? 'agent' : 'agents'}
                  </span>
                </p>
              )}
              {staleLocks.length > 0 && (
                <p className={styles.issueRow}>
                  <span className={styles.issueCount}>{staleLocks.length}</span>
                  <span className={styles.issueLabel}>
                    stale {staleLocks.length === 1 ? 'lock' : 'locks'}
                  </span>
                </p>
              )}
            </div>
          )}
        </section>

        <section className={styles.block} style={{ marginTop: 32 }}>
          <div className={styles.blockHeader}>
            <h2 className={styles.blockTitle}>Team</h2>
            <span className={styles.blockMeta}>
              {teamRoster.filter((p) => p.online).length} online
            </span>
          </div>

          {teamRoster.length > 0 ? (
            <div className={styles.rosterList}>
              {teamRoster.map((person) => (
                <div key={person.handle} className={styles.rosterRow}>
                  <span className={styles.rosterDot} data-online={person.online || undefined} />
                  <span className={styles.rosterHandle}>{person.handle}</span>
                  {person.tools.length > 0 && (
                    <span className={styles.rosterTools}>
                      {person.tools.map((tool) => (
                        <ToolIcon key={tool} tool={tool} size={14} monochrome />
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyHint}>No members yet.</p>
          )}
        </section>
      </div>

      <div className={styles.asideStack}>
        <section className={styles.block}>
          <div className={styles.blockHeader}>
            <h2 className={styles.blockTitle}>24h</h2>
          </div>
          <div className={styles.summaryGrid}>
            <SummaryStat label="edits reported" value={sessionEditCount} />
            <SummaryStat label="files touched" value={filesTouchedCount} />
            <SummaryStat label="live sessions" value={liveSessionCount} />
            <SummaryStat label="agents now" value={activeAgents.length} />
          </div>
        </section>

        {activeTools.length > 0 && (
          <section className={styles.block}>
            <div className={styles.blockHeader}>
              <h2 className={styles.blockTitle}>Active tools</h2>
            </div>
            <div className={styles.distributionList}>
              {activeTools.map((tool) => (
                <div key={tool.tool} className={styles.distributionRow}>
                  <div className={styles.distributionCopy}>
                    <span className={styles.distributionLabel}>
                      <ToolIcon tool={tool.tool} size={16} />
                      <span>{getToolMeta(tool.tool).label}</span>
                    </span>
                    <span className={styles.distributionMeta}>{tool.live} live</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
