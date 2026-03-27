import { useMemo, useCallback, useState } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { teamActions } from '../../lib/stores/teams.js';
import ConflictBanner from '../../components/ConflictBanner/ConflictBanner.jsx';
import AgentRow from '../../components/AgentRow/AgentRow.jsx';
import ActivityTimeline from '../../components/ActivityTimeline/ActivityTimeline.jsx';
import MemoryRow from '../../components/MemoryRow/MemoryRow.jsx';
import SessionRow from '../../components/SessionRow/SessionRow.jsx';
import LockRow from '../../components/LockRow/LockRow.jsx';
import MessageRow from '../../components/MessageRow/MessageRow.jsx';
import MessageComposer from '../../components/MessageComposer/MessageComposer.jsx';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import StatCard from '../../components/StatCard/StatCard.jsx';
import Tabs from '../../components/Tabs/Tabs.jsx';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import { getToolMeta } from '../../lib/toolMeta.js';
import styles from './ProjectView.module.css';

export default function ProjectView() {
  const contextData = usePollingStore((s) => s.contextData);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const teams = useTeamStore((s) => s.teams);
  const [activeTab, setActiveTab] = useState('now');

  const members = contextData?.members || [];
  const memories = contextData?.memories || [];
  const allSessions = (contextData?.recentSessions || [])
    .filter(s => s.edit_count > 0 || s.files_touched?.length > 0 || !s.ended_at)
    .slice(0, 24);
  const sessions = allSessions.slice(0, 8);
  const locks = contextData?.locks || [];
  const messages = contextData?.messages || [];
  const toolsConfigured = contextData?.tools_configured || [];
  const usage = contextData?.usage || {};
  const activeTeam = teams.find((team) => team.team_id === activeTeamId) || null;

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

  const filesInPlay = useMemo(() => {
    const deduped = new Set();
    activeAgents.forEach((member) => {
      (member.activity?.files || []).forEach((file) => deduped.add(file));
    });
    locks.forEach((lock) => deduped.add(lock.file_path));
    return [...deduped].slice(0, 10);
  }, [activeAgents, locks]);

  const memoryBreakdown = useMemo(() => {
    const counts = new Map();
    memories.forEach((memory) => {
      (memory.tags || []).forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [memories]);

  const sessionEditCount = useMemo(
    () => allSessions.reduce((sum, session) => sum + (session.edit_count || 0), 0),
    [allSessions]
  );

  const filesTouchedCount = useMemo(() => {
    const touched = new Set();
    allSessions.forEach((session) => {
      (session.files_touched || []).forEach((file) => touched.add(file));
    });
    return touched.size;
  }, [allSessions]);

  const toolSummaries = useMemo(() => {
    const byTool = new Map();
    toolsConfigured.forEach((tool) => {
      byTool.set(tool.tool, {
        tool: tool.tool,
        joins: tool.joins || 0,
        live: 0,
      });
    });

    members.forEach((member) => {
      const toolId = member.tool && member.tool !== 'unknown' ? member.tool : null;
      if (!toolId) return;
      if (!byTool.has(toolId)) {
        byTool.set(toolId, { tool: toolId, joins: 0, live: 0 });
      }
      const entry = byTool.get(toolId);
      if (member.status === 'active') {
        entry.live += 1;
      }
    });

    return [...byTool.values()].sort((a, b) => {
      const aScore = (a.live * 100) + a.joins;
      const bScore = (b.live * 100) + b.joins;
      return bScore - aScore;
    });
  }, [members, toolsConfigured]);

  const maxToolJoins = useMemo(
    () => toolSummaries.reduce((max, tool) => Math.max(max, tool.joins || 0), 1),
    [toolSummaries]
  );
  const usageEntries = useMemo(() => ([
    usage.joins > 0 ? { label: 'joins', value: usage.joins } : null,
    usage.conflict_checks > 0 ? { label: 'conflict checks', value: usage.conflict_checks } : null,
    usage.conflicts_found > 0 ? { label: 'conflicts found', value: usage.conflicts_found } : null,
    usage.memories_saved > 0 ? { label: 'memories saved', value: usage.memories_saved } : null,
    usage.messages_sent > 0 ? { label: 'messages sent', value: usage.messages_sent } : null,
  ].filter(Boolean)), [usage]);
  const tabs = [
    { id: 'now', label: 'Activity', badge: activeAgents.length || null },
    { id: 'knowledge', label: 'Memory', badge: memories.length || null },
    { id: 'history', label: 'Sessions', badge: allSessions.length || null },
    { id: 'stack', label: 'Tools', badge: toolSummaries.length || null },
  ];

  const handleUpdateMemory = useCallback(async (id, text, tags) => {
    if (!activeTeamId) return;
    await teamActions.updateMemory(activeTeamId, id, text, tags);
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
      <ViewHeader
        eyebrow="Project"
        title={activeTeam?.team_name || 'Project'}
      />

      <div className={styles.hero}>
        <StatCard
          label="Active agents"
          value={activeAgents.length}
          tone={activeAgents.length > 0 ? 'accent' : 'default'}
        />
        <StatCard
          label="Conflicts"
          value={conflicts.length}
          tone={conflicts.length > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Memory"
          value={memories.length}
          tone={memories.length > 0 ? 'success' : 'default'}
        />
        <StatCard
          label="Sessions 24h"
          value={allSessions.length}
        />
      </div>

      <section className={styles.timelineSection}>
        <div className={styles.timelineCopy}>
          <h2 className={styles.sectionTitle}>Activity</h2>
        </div>
        <ActivityTimeline sessions={allSessions} liveCount={activeAgents.length} />
      </section>

      <Tabs tabs={tabs} active={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'now' && (
          <div className={styles.tabGrid}>
            <section className={styles.block}>
              <div className={styles.blockHeader}>
                <h3 className={styles.blockTitle}>Agents</h3>
                {offlineAgents.length > 0 ? (
                  <span className={styles.blockMeta}>{offlineAgents.length} offline</span>
                ) : null}
              </div>

              {sortedAgents.length > 0 ? (
                <div className={styles.sectionBody}>
                  {sortedAgents.map((agent) => (
                    <AgentRow key={agent.agent_id || `${agent.handle}:${agent.tool}:${agent.status}`} agent={agent} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No agents connected" hint="Open a connected tool in this repo." />
              )}
            </section>

            <section className={styles.block}>
              <div className={styles.blockHeader}>
                <h3 className={styles.blockTitle}>Files</h3>
              </div>

              {conflicts.length > 0 ? <ConflictBanner conflicts={conflicts} /> : null}

              {filesInPlay.length > 0 ? (
                <div className={styles.fileCloud}>
                  {filesInPlay.map((file) => (
                    <span key={file} className={styles.fileChip}>
                      {file.split('/').slice(-2).join('/')}
                    </span>
                  ))}
                </div>
              ) : (
                <p className={styles.emptyHint}>No files in play.</p>
              )}

              {locks.length > 0 ? (
                <div className={styles.sectionBody}>
                  {locks.map((lock, index) => (
                    <LockRow key={lock.file_path || `${lock.held_by || 'lock'}:${index}`} lock={lock} />
                  ))}
                </div>
              ) : (
                <p className={styles.emptyHint}>No file locks.</p>
              )}
            </section>
          </div>
        )}

        {activeTab === 'knowledge' && (
          <div className={styles.tabGrid}>
            <section className={styles.block}>
              <div className={styles.blockHeader}>
                <h3 className={styles.blockTitle}>Memory</h3>
                <span className={styles.blockMeta}>{memories.length}</span>
              </div>

              {memoryBreakdown.length > 0 ? (
                <div className={styles.memorySummary}>
                  {memoryBreakdown.map(([tag, count]) => (
                    <div key={tag} className={styles.memoryCategory}>
                      <span className={styles.memoryCategoryCount}>{count}</span>
                      <span className={styles.memoryCategoryLabel}>{tag}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {memories.length > 0 ? (
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
              ) : (
                <EmptyState title="No memory saved" hint="Saved memories appear here." />
              )}
            </section>

            <section className={styles.block}>
              <div className={styles.blockHeader}>
                <h3 className={styles.blockTitle}>Messages</h3>
                {messages.length > 0 ? <span className={styles.blockMeta}>{messages.length}</span> : null}
              </div>

              <MessageComposer onSend={handleSendMessage} />

              {messages.length > 0 ? (
                <div className={styles.sectionBody}>
                  {messages.map((message, index) => (
                    <MessageRow key={message.id || `${message.from_handle}:${message.created_at || index}:${message.text}`} message={message} />
                  ))}
                </div>
              ) : (
                <p className={styles.emptyHint}>No messages yet.</p>
              )}
            </section>
          </div>
        )}

        {activeTab === 'history' && (
          <div className={styles.tabGrid}>
            <section className={styles.block}>
              <div className={styles.blockHeader}>
                <h3 className={styles.blockTitle}>Sessions</h3>
              </div>

              {sessions.length > 0 ? (
                <div className={styles.sectionBody}>
                  {sessions.map((session, index) => (
                    <SessionRow key={session.session_id || `${session.owner_handle}:${session.started_at || index}`} session={session} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No recent sessions" hint="Reported sessions appear here." />
              )}
            </section>

            <section className={styles.block}>
              <div className={styles.blockHeader}>
                <h3 className={styles.blockTitle}>Summary</h3>
              </div>

              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryValue}>{sessionEditCount}</span>
                  <span className={styles.summaryLabel}>edits reported</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryValue}>{filesTouchedCount}</span>
                  <span className={styles.summaryLabel}>files touched</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryValue}>{allSessions.filter((session) => !session.ended_at).length}</span>
                  <span className={styles.summaryLabel}>sessions still live</span>
                </div>
              </div>

              {filesInPlay.length > 0 ? (
                <div className={styles.fileList}>
                  {filesInPlay.map((file) => (
                    <span key={`history:${file}`} className={styles.fileRow}>
                      {file}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        )}

        {activeTab === 'stack' && (
          <div className={styles.tabGrid}>
            <section className={styles.block}>
              <div className={styles.blockHeader}>
                <h3 className={styles.blockTitle}>Configured tools</h3>
              </div>

              {toolSummaries.length > 0 ? (
                <div className={styles.toolStack}>
                  {toolSummaries.map((tool) => (
                    <div key={tool.tool} className={styles.toolRow}>
                      <div className={styles.toolIdentity}>
                        <ToolIcon tool={tool.tool} size={18} />
                        <div className={styles.toolCopy}>
                          <span className={styles.toolLabel}>{getToolMeta(tool.tool).label}</span>
                          <span className={styles.toolMeta}>
                            {tool.live} live / {tool.joins} joins
                          </span>
                        </div>
                      </div>
                      <span className={styles.toolBar}>
                        <span
                          className={styles.toolBarFill}
                            style={{ width: `${Math.min(100, Math.max(10, Math.round((((tool.joins || 0) + (tool.live || 0)) / Math.max(1, maxToolJoins)) * 100)))}%` }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No tools configured" hint="Run npx chinwag init in this repo." />
              )}
            </section>

            <section className={styles.block}>
              <div className={styles.blockHeader}>
                <h3 className={styles.blockTitle}>Usage</h3>
              </div>

              {usageEntries.length > 0 ? (
                <div className={styles.summaryGrid}>
                  {usageEntries.map((entry) => (
                    <SummaryStat key={entry.label} label={entry.label} value={entry.value} />
                  ))}
                </div>
              ) : (
                <p className={styles.emptyHint}>No usage reported.</p>
              )}
            </section>
          </div>
        )}
      </Tabs>
    </div>
  );
}

function SummaryStat({ label, value }) {
  return (
    <div className={styles.summaryItem}>
      <span className={styles.summaryValue}>{value}</span>
      <span className={styles.summaryLabel}>{label}</span>
    </div>
  );
}
