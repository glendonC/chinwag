import { basename } from 'path';

export const MAX_AGENTS = 5;
export const MAX_MEMORIES = 8;

// Collect unique tags from a set of memories for dynamic filtering
export function collectTags(memories) {
  const tags = new Set();
  for (const m of memories) {
    if (m.tags?.length) for (const t of m.tags) tags.add(t);
  }
  return [...tags].sort();
}

export function createToolNameResolver(detectedTools) {
  const toolNameMap = new Map((detectedTools || []).map(t => [t.id, t.name]));
  return (toolId) => {
    if (!toolId || toolId === 'unknown') return null;
    return toolNameMap.get(toolId) || toolId;
  };
}

export function formatDuration(minutes) {
  if (minutes == null) return null;
  const m = Math.round(minutes);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  }
  return `${m} min`;
}

export function formatFiles(files) {
  if (!files?.length) return null;
  const names = files.map(f => basename(f));
  if (names.length <= 3) return names.join(', ');
  return `${names[0]}, ${names[1]} + ${names.length - 2} more`;
}

export function smartSummary(activity) {
  if (!activity?.summary) return null;
  const summary = activity.summary;
  if (/^editing\s/i.test(summary)) return null;
  if (
    activity.files?.length === 1 &&
    summary.toLowerCase().includes(basename(activity.files[0]).toLowerCase())
  ) {
    return null;
  }
  return summary;
}

export function shortAgentId(agentId) {
  if (!agentId) return '';
  const parts = agentId.split(':');
  if (parts.length >= 3) return parts[2].slice(0, 4);
  return '';
}

export function hasVisibleSessionActivity(session) {
  if (!session) return false;
  return !session.ended_at || session.edit_count > 0 || session.files_touched?.length > 0;
}

export function buildDashboardView({
  context,
  detectedTools,
  memoryFilter,
  cols,
  projectDir,
} = {}) {
  const getToolName = createToolNameResolver(detectedTools);
  const dividerWidth = Math.min((cols || 80) - 4, 50);

  const members = context?.members || [];
  const activeAgents = members.filter(m => m.status === 'active' && m.tool && m.tool !== 'unknown');
  const agentsWithWork = activeAgents.filter(m => m.activity?.files?.length > 0);
  const uniqueHandles = new Set(activeAgents.map(m => m.handle));
  const isTeam = uniqueHandles.size > 1;

  const fileOwners = new Map();
  for (const member of agentsWithWork) {
    const label = getToolName(member.tool) ? `${member.handle} (${getToolName(member.tool)})` : member.handle;
    for (const file of member.activity.files) {
      if (!fileOwners.has(file)) fileOwners.set(file, []);
      fileOwners.get(file).push(label);
    }
  }
  const conflicts = [...fileOwners.entries()].filter(([, owners]) => owners.length > 1);

  const memories = context?.memories || [];
  const filteredMemories = memoryFilter
    ? memories.filter(memory => memory.tags?.includes(memoryFilter))
    : memories;
  const visibleMemories = filteredMemories.slice(0, MAX_MEMORIES);
  const memoryOverflow = filteredMemories.length - MAX_MEMORIES;

  const messages = context?.messages || [];
  const toolsConfigured = context?.tools_configured || [];
  const usage = context?.usage || {};

  const recentSessions = (context?.recentSessions || []).filter(hasVisibleSessionActivity);
  const showRecent = recentSessions.length > 0 && activeAgents.length === 0;

  const visibleAgents = activeAgents.slice(0, MAX_AGENTS);
  const agentOverflow = activeAgents.length - MAX_AGENTS;

  const toolCounts = new Map();
  for (const agent of activeAgents) {
    toolCounts.set(agent.tool, (toolCounts.get(agent.tool) || 0) + 1);
  }

  return {
    getToolName,
    dividerWidth,
    projectDir,
    members,
    activeAgents,
    conflicts,
    memories,
    filteredMemories,
    visibleMemories,
    memoryOverflow,
    messages,
    toolsConfigured,
    usage,
    recentSessions,
    showRecent,
    visibleAgents,
    agentOverflow,
    toolCounts,
    isTeam,
  };
}

export function generateDashboardMd(context, user, projectDir, getToolName) {
  const lines = [`# chinwag — @${user?.handle || 'unknown'} · ${projectDir}`, ''];
  const members = context?.members || [];
  const active = members.filter(m => m.status === 'active' && m.tool && m.tool !== 'unknown');

  lines.push(`## Agents — ${active.length} running`, '');
  if (active.length === 0) {
    lines.push('_No agents running._', '');
  } else {
    for (const member of active) {
      const tool = getToolName?.(member.tool) || member.tool || 'Unknown';
      const duration = member.session_minutes != null ? ` — ${Math.round(member.session_minutes)}m` : '';
      lines.push(`### ${tool}${duration}`, '');
      if (member.activity?.files?.length > 0) {
        for (const file of member.activity.files) lines.push(`- \`${file}\``);
      } else {
        lines.push('- _No files reported_');
      }
      if (member.activity?.summary) lines.push('', `> ${member.activity.summary}`);
      lines.push('');
    }
  }

  const memories = context?.memories || [];
  lines.push(`## Memory — ${memories.length} saved`, '');
  if (memories.length === 0) {
    lines.push('_No memories yet._', '');
  } else {
    for (const memory of memories) {
      const tagStr = memory.tags?.length ? `**[${memory.tags.join(', ')}]** ` : '';
      lines.push(`- ${tagStr}${memory.text}`);
    }
    lines.push('');
  }

  const sessions = (context?.recentSessions || []).filter(hasVisibleSessionActivity);
  if (sessions.length > 0) {
    lines.push('## Recent Sessions', '');
    for (const session of sessions.slice(0, 10)) {
      const tool = getToolName?.(session.tool) || session.tool || 'Agent';
      const duration = session.duration_minutes != null ? `${Math.round(session.duration_minutes)}m` : '';
      lines.push(
        `- **${tool}** ${session.owner_handle} — ${duration}, ${session.edit_count} edits, ${session.files_touched?.length || 0} files`
      );
    }
    lines.push('');
  }

  lines.push('---', `_Generated ${new Date().toLocaleTimeString()} — press [e] again in chinwag to refresh_`);
  return lines.join('\n');
}
