import { useState, useMemo } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import StatCard from '../../components/StatCard/StatCard.jsx';
import ConflictBanner from '../../components/ConflictBanner/ConflictBanner.jsx';
import Tabs from '../../components/Tabs/Tabs.jsx';
import AgentRow from '../../components/AgentRow/AgentRow.jsx';
import MemoryRow from '../../components/MemoryRow/MemoryRow.jsx';
import SessionRow from '../../components/SessionRow/SessionRow.jsx';
import LockRow from '../../components/LockRow/LockRow.jsx';
import MessageRow from '../../components/MessageRow/MessageRow.jsx';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import styles from './ProjectView.module.css';

export default function ProjectView() {
  const contextData = usePollingStore((s) => s.contextData);
  const [activeTab, setActiveTab] = useState('agents');

  const members = contextData?.members || [];
  const memories = contextData?.memories || [];
  const sessions = (contextData?.recentSessions || []).slice(0, 12);
  const locks = contextData?.locks || [];
  const messages = contextData?.messages || [];

  const activeAgents = useMemo(() => members.filter((m) => m.status === 'active'), [members]);
  const offlineAgents = useMemo(() => members.filter((m) => m.status === 'offline'), [members]);
  const sortedAgents = useMemo(() => [...activeAgents, ...offlineAgents], [activeAgents, offlineAgents]);

  // Compute file conflicts: files touched by 2+ active agents
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

  // Stats
  const activeCount = activeAgents.length;
  const sessionsCount = sessions.length;
  const memoriesCount = memories.length;
  const conflictsCount = conflicts.length;

  // Build visible tabs
  const visibleTabs = useMemo(() => {
    const tabs = [
      { id: 'agents', label: 'Agents', badge: activeCount || undefined },
      { id: 'knowledge', label: 'Knowledge', badge: memoriesCount || undefined },
      { id: 'sessions', label: 'Sessions' },
    ];
    if (locks.length > 0) {
      tabs.push({ id: 'locks', label: 'Locks', badge: locks.length });
    }
    if (messages.length > 0) {
      tabs.push({ id: 'messages', label: 'Messages', badge: messages.length });
    }
    return tabs;
  }, [activeCount, memoriesCount, locks.length, messages.length]);

  return (
    <div className={styles.projectDetail}>
      {/* Stats row */}
      <div className={styles.statsRow}>
        <StatCard
          value={activeCount}
          label="Active agents"
          variant={activeCount > 0 ? 'active' : 'default'}
        />
        <StatCard value={sessionsCount} label="Sessions" />
        <StatCard value={memoriesCount} label="Memories" />
        <StatCard
          value={conflictsCount}
          label="Conflicts"
          variant={conflictsCount > 0 ? 'danger' : 'default'}
        />
      </div>

      {/* Conflicts banner */}
      {conflicts.length > 0 && <ConflictBanner conflicts={conflicts} />}

      {/* Tabbed content */}
      <Tabs tabs={visibleTabs} active={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'agents' && (
          sortedAgents.length > 0 ? (
            sortedAgents.map((agent, i) => <AgentRow key={`${agent.handle}:${i}`} agent={agent} />)
          ) : (
            <EmptyState
              title="No agents connected"
              hint="Open an AI tool in a chinwag project to see activity here."
            />
          )
        )}
        {activeTab === 'knowledge' && (
          memories.length > 0 ? (
            memories.map((memory, i) => <MemoryRow key={i} memory={memory} />)
          ) : (
            <EmptyState
              title="No shared knowledge"
              hint="Agents save project facts here as they work."
            />
          )
        )}
        {activeTab === 'sessions' && (
          sessions.length > 0 ? (
            sessions.map((session, i) => <SessionRow key={i} session={session} />)
          ) : (
            <EmptyState
              title="No recent sessions"
              hint="Session history appears after agents connect."
            />
          )
        )}
        {activeTab === 'locks' && (
          locks.map((lock, i) => <LockRow key={i} lock={lock} />)
        )}
        {activeTab === 'messages' && (
          messages.map((message, i) => <MessageRow key={i} message={message} />)
        )}
      </Tabs>
    </div>
  );
}
