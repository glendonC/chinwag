// State diffing algorithm for the chinwag channel server.
// Compares two snapshots of team context and returns human-readable event strings
// for meaningful changes (new agents, file edits, conflicts, memories, locks, messages).

import { formatAgentLabel, formatWho } from './utils/formatting.js';

const STUCKNESS_THRESHOLD_MINUTES = 15;

function agentKey(m) {
  return m.agent_id || m.handle;
}

export function diffState(prev, curr, stucknessAlerted) {
  const events = [];

  const prevKeys = new Set(prev.members?.map(agentKey) || []);
  const currKeys = new Set(curr.members?.map(agentKey) || []);
  const prevByKey = new Map((prev.members || []).map((m) => [agentKey(m), m]));
  const currByKey = new Map((curr.members || []).map((m) => [agentKey(m), m]));

  // New agents joined
  for (const key of currKeys) {
    if (!prevKeys.has(key)) {
      const m = currByKey.get(key);
      const activity = m.activity?.files?.length
        ? ` — working on ${m.activity.files.join(', ')}`
        : '';
      events.push(`Agent ${formatAgentLabel(m)} joined the team${activity}`);
    }
  }

  // Agents went offline
  for (const key of prevKeys) {
    if (!currKeys.has(key)) {
      const m = prevByKey.get(key);
      events.push(`Agent ${formatAgentLabel(m)} disconnected`);
    }
  }

  // File activity changes
  for (const key of currKeys) {
    if (!prevKeys.has(key)) continue;
    const prevMember = prevByKey.get(key);
    const currMember = currByKey.get(key);
    if (!prevMember || !currMember) continue;

    const prevFiles = new Set(prevMember.activity?.files || []);
    const currFiles = currMember.activity?.files || [];
    const newFiles = currFiles.filter((f) => !prevFiles.has(f));

    if (newFiles.length > 0) {
      events.push(`${formatAgentLabel(currMember)} started editing ${newFiles.join(', ')}`);
    }
  }

  // Conflict detection — only emit NEW conflicts (not in prev state)
  const prevConflictFiles = new Set();
  const prevFileOwners = new Map();
  for (const m of prev.members || []) {
    if (m.status !== 'active' || !m.activity?.files) continue;
    for (const f of m.activity.files) {
      if (!prevFileOwners.has(f)) prevFileOwners.set(f, []);
      prevFileOwners.get(f).push(formatAgentLabel(m));
    }
  }
  for (const [file, owners] of prevFileOwners) {
    if (owners.length > 1) prevConflictFiles.add(file);
  }

  const currFileOwners = new Map();
  for (const m of curr.members || []) {
    if (m.status !== 'active' || !m.activity?.files) continue;
    for (const f of m.activity.files) {
      if (!currFileOwners.has(f)) currFileOwners.set(f, []);
      currFileOwners.get(f).push(formatAgentLabel(m));
    }
  }
  for (const [file, owners] of currFileOwners) {
    if (owners.length > 1 && !prevConflictFiles.has(file)) {
      events.push(`CONFLICT: ${owners.join(' and ')} are both editing ${file}`);
    }
  }

  // Stuckness detection — prefer server-computed minutes_since_update
  for (const key of currKeys) {
    const m = currByKey.get(key);
    if (!m?.activity?.updated_at || m.status !== 'active') continue;

    const alertedAt = stucknessAlerted.get(key);
    if (alertedAt && alertedAt !== m.activity.updated_at) {
      stucknessAlerted.delete(key);
    }

    if (!stucknessAlerted.has(key)) {
      const minutesOnSameActivity =
        m.minutes_since_update != null
          ? m.minutes_since_update
          : (Date.now() - new Date(m.activity.updated_at).getTime()) / 60_000;
      if (minutesOnSameActivity > STUCKNESS_THRESHOLD_MINUTES) {
        events.push(
          `Agent ${formatAgentLabel(m)} has been on the same task for ${Math.round(minutesOnSameActivity)} min — may be stuck`,
        );
        stucknessAlerted.set(key, m.activity.updated_at);
      }
    }
  }

  // Clear alerts for agents that disconnected
  for (const key of stucknessAlerted.keys()) {
    if (!currKeys.has(key)) {
      stucknessAlerted.delete(key);
    }
  }

  // New memories — compare by id (preferred) or text
  const prevMemKeys = new Set((prev.memories || []).map((m) => m.id || m.text));
  for (const mem of curr.memories || []) {
    const key = mem.id || mem.text;
    if (!prevMemKeys.has(key)) {
      const tagStr = mem.tags?.length ? ` [${mem.tags.join(', ')}]` : '';
      events.push(`New team knowledge: ${mem.text}${tagStr}`);
    }
  }

  // Lock changes — new locks and released locks
  const prevLocks = new Map((prev.locks || []).map((l) => [l.file_path, l]));
  const currLocks = new Map((curr.locks || []).map((l) => [l.file_path, l]));
  for (const [file, lock] of currLocks) {
    if (!prevLocks.has(file)) {
      events.push(
        `${formatWho(lock.handle || lock.owner_handle, lock.host_tool || lock.tool)} locked ${file}`,
      );
    }
  }
  for (const [file, lock] of prevLocks) {
    if (!currLocks.has(file)) {
      events.push(
        `${formatWho(lock.handle || lock.owner_handle, lock.host_tool || lock.tool)} released lock on ${file}`,
      );
    }
  }

  // New messages
  const msgKey = (m) => `${m.created_at}\0${m.from_handle || m.handle}`;
  const prevMsgIds = new Set((prev.messages || []).map(msgKey));
  for (const msg of curr.messages || []) {
    if (!prevMsgIds.has(msgKey(msg))) {
      events.push(
        `Message from ${formatWho(msg.from_handle || msg.handle, msg.from_tool || msg.host_tool)}: ${msg.text}`,
      );
    }
  }

  return events;
}
