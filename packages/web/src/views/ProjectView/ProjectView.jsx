import { useMemo, useCallback } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { teamActions } from '../../lib/stores/teams.js';
import ConflictBanner from '../../components/ConflictBanner/ConflictBanner.jsx';
import AgentRow from '../../components/AgentRow/AgentRow.jsx';
import MemoryRow from '../../components/MemoryRow/MemoryRow.jsx';
import SessionRow from '../../components/SessionRow/SessionRow.jsx';
import LockRow from '../../components/LockRow/LockRow.jsx';
import MessageRow from '../../components/MessageRow/MessageRow.jsx';
import MessageComposer from '../../components/MessageComposer/MessageComposer.jsx';
import styles from './ProjectView.module.css';

export default function ProjectView() {
  const contextData = usePollingStore((s) => s.contextData);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);

  const members = contextData?.members || [];
  const memories = contextData?.memories || [];
  // Filter out sessions with zero activity — they're noise
  const sessions = (contextData?.recentSessions || [])
    .filter(s => s.edit_count > 0 || s.files_touched?.length > 0 || !s.ended_at)
    .slice(0, 8);
  const locks = contextData?.locks || [];
  const messages = contextData?.messages || [];
  const toolsConfigured = contextData?.tools_configured || [];
  const usage = contextData?.usage || {};
  const maxToolJoins = useMemo(
    () => toolsConfigured.reduce((max, tool) => Math.max(max, tool.joins || 0), 1),
    [toolsConfigured]
  );

  const activeAgents = useMemo(() => members.filter((m) => m.status === 'active'), [members]);
  const offlineAgents = useMemo(() => members.filter((m) => m.status === 'offline'), [members]);
  const sortedAgents = useMemo(() => [...activeAgents, ...offlineAgents], [activeAgents, offlineAgents]);

  const conflicts = useMemo(() => {
    const owners = new Map();
    for (const m of members) {
      if (m.status !== 'active' || !m.activity?.files) continue;
      const label =
        m.tool && m.tool !== 'unknown' ? `${m.handle} (${m.tool})` : m.handle;
      for (const f of m.activity.files) {
        if (!owners.has(f)) owners.set(f, []);
        owners.get(f).push(label);
      }
    }
    return [...owners.entries()].filter(([, o]) => o.length > 1);
  }, [members]);

  const handleUpdateMemory = useCallback(async (id, text, category) => {
    if (!activeTeamId) return;
    await teamActions.updateMemory(activeTeamId, id, text, category);
  }, [activeTeamId]);

  const handleDeleteMemory = useCallback(async (id) => {
    if (!activeTeamId) return;
    await teamActions.deleteMemory(activeTeamId, id);
  }, [activeTeamId]);

  const handleSendMessage = useCallback(async (text) => {
    if (!activeTeamId) return;
    await teamActions.sendMessage(activeTeamId, text);
  }, [activeTeamId]);

  return (
    <div className={styles.page}>

      {/* ── Hero stats ── big anchor numbers like Site Manager inspiration */}
      <div className={styles.hero}>
        <div className={styles.heroStat}>
          <span className={styles.heroLabel}>Active agents</span>
          <span className={`${styles.heroValue} ${activeAgents.length > 0 ? styles.heroActive : ''}`}>
            {activeAgents.length}
          </span>
        </div>
        <div className={styles.heroStat}>
          <span className={styles.heroLabel}>Conflicts</span>
          <span className={`${styles.heroValue} ${conflicts.length > 0 ? styles.heroDanger : ''}`}>
            {conflicts.length}
          </span>
        </div>
        <div className={styles.heroStat}>
          <span className={styles.heroLabel}>Memories</span>
          <span className={styles.heroValue}>{memories.length}</span>
        </div>
        <div className={styles.heroStat}>
          <span className={styles.heroLabel}>Sessions</span>
          <span className={styles.heroValue}>{sessions.length}</span>
        </div>
      </div>

      {/* Conflict alert */}
      {conflicts.length > 0 && <ConflictBanner conflicts={conflicts} />}

      {/* ── Content sections ── */}

      {/* Agents */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Agents</h2>
          {offlineAgents.length > 0 && (
            <span className={styles.sectionCount}>{offlineAgents.length} offline</span>
          )}
        </div>
        {sortedAgents.length > 0 ? (
          <div className={styles.sectionBody}>
            {sortedAgents.map((agent) => (
              <AgentRow key={agent.agent_id || `${agent.handle}:${agent.tool}:${agent.status}`} agent={agent} />
            ))}
          </div>
        ) : (
          <p className={styles.emptyHint}>No agents connected yet.</p>
        )}
      </section>

      {/* Knowledge */}
      {memories.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Knowledge</h2>
            <span className={styles.sectionCount}>{memories.length}</span>
          </div>
          <div className={styles.sectionBody}>
            {memories.map((memory) => (
              <MemoryRow
                key={memory.id}
                memory={memory}
                onUpdate={handleUpdateMemory}
                onDelete={handleDeleteMemory}
              />
            ))}
          </div>
        </section>
      )}

      {/* Locks */}
      {locks.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Locked files</h2>
            <span className={styles.sectionCount}>{locks.length}</span>
          </div>
          <div className={styles.sectionBody}>
            {locks.map((lock, i) => (
              <LockRow key={lock.file_path || `${lock.held_by || 'lock'}:${i}`} lock={lock} />
            ))}
          </div>
        </section>
      )}

      {/* Sessions */}
      {sessions.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Recent sessions</h2>
          </div>
          <div className={styles.sectionBody}>
            {sessions.map((session, i) => (
              <SessionRow key={session.session_id || `${session.owner_handle}:${session.started_at || i}`} session={session} />
            ))}
          </div>
        </section>
      )}

      {/* Messages */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Messages</h2>
          {messages.length > 0 && <span className={styles.sectionCount}>{messages.length}</span>}
        </div>
        <MessageComposer onSend={handleSendMessage} />
        {messages.length > 0 && (
          <div className={styles.sectionBody}>
            {messages.map((message, i) => (
              <MessageRow key={message.id || `${message.from_handle}:${message.created_at || i}:${message.text}`} message={message} />
            ))}
          </div>
        )}
      </section>

      {/* Usage — telemetry */}
      {(toolsConfigured.length > 0 || Object.keys(usage).length > 0) && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Usage</h2>
          </div>
          <div className={styles.usageGrid}>
            {usage.joins > 0 && <UsageStat label="Total joins" value={usage.joins} />}
            {usage.conflict_checks > 0 && <UsageStat label="Conflict checks" value={usage.conflict_checks} />}
            {usage.conflicts_found > 0 && <UsageStat label="Conflicts found" value={usage.conflicts_found} />}
            {usage.memories_saved > 0 && <UsageStat label="Memories saved" value={usage.memories_saved} />}
            {usage.messages_sent > 0 && <UsageStat label="Messages sent" value={usage.messages_sent} />}
          </div>
          {toolsConfigured.length > 0 && (
            <div className={styles.toolBreakdown}>
              {toolsConfigured.map((t) => {
                return (
                  <div key={t.tool} className={styles.toolRow}>
                    <span className={styles.toolName}>{t.tool}</span>
                    <span className={styles.toolBar}>
                      <span
                        className={styles.toolBarFill}
                        style={{ width: `${Math.min(100, (t.joins / maxToolJoins) * 100)}%` }}
                      />
                    </span>
                    <span className={styles.toolCount}>{t.joins}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function UsageStat({ label, value }) {
  return (
    <div className={styles.usageStat}>
      <span className={styles.usageStatLabel}>{label}</span>
      <span className={styles.usageStatValue}>{value}</span>
    </div>
  );
}
