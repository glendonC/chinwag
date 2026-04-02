import { basename } from 'path';

export const MAX_MEMORIES = 8;

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

const MEDIA_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff',
  '.mp4', '.mov', '.avi', '.webm', '.mp3', '.wav', '.ogg',
]);

function isMediaFile(name) {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && MEDIA_EXTS.has(name.slice(dot).toLowerCase());
}

export function formatFiles(files) {
  if (!files?.length) return null;
  const names = files.map(f => basename(f));
  const code = names.filter(n => !isMediaFile(n));
  const mediaCount = names.length - code.length;

  // Show code files first, collapse media to a count
  const display = code.length > 0 ? code : names;
  const shown = display.length <= 3 ? display.join(', ') : `${display[0]}, ${display[1]} + ${display.length - 2} more`;

  if (mediaCount > 0 && code.length > 0) {
    return `${shown} + ${mediaCount} image${mediaCount > 1 ? 's' : ''}`;
  }
  // All media, no code files
  if (code.length === 0) {
    return `${mediaCount} image${mediaCount > 1 ? 's' : ''}`;
  }
  return shown;
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

function buildManagedAgentRows(managedAgents, getToolName, now = Date.now()) {
  return (managedAgents || []).map((agent) => {
    const toolId = agent.toolId || agent.tool || 'unknown';
    const isDead = agent.status !== 'running';
    const hasError = agent.status === 'failed' || (agent.exitCode != null && agent.exitCode !== 0);

    return {
      ...agent,
      agent_id: agent.agentId || agent.agent_id || null,
      tool: toolId,
      _managed: true,
      _connected: false,
      _display: agent.toolName || getToolName(toolId) || agent.cmd || toolId,
      _summary: agent.task,
      _duration: agent.startedAt ? formatDuration((now - agent.startedAt) / 60000) : null,
      _dead: isDead,
      _exited: isDead,
      _failed: hasError,
      _exitCode: agent.exitCode,
    };
  });
}

export function buildCombinedAgentRows({
  managedAgents,
  connectedAgents,
  getToolName,
  now = Date.now(),
} = {}) {
  const managedRows = buildManagedAgentRows(managedAgents, getToolName, now);
  const connectedById = new Map((connectedAgents || []).map(agent => [agent.agent_id, agent]));
  const usedConnected = new Set();

  const mergedManaged = managedRows.map((managed) => {
    const connected = managed.agent_id ? connectedById.get(managed.agent_id) : null;
    if (!connected) return managed;

    usedConnected.add(connected.agent_id);
    return {
      ...connected,
      ...managed,
      handle: connected.handle || managed.handle || null,
      tool: managed.tool || connected.tool,
      activity: connected.activity || managed.activity || null,
      session_minutes: connected.session_minutes ?? managed.session_minutes ?? null,
      minutes_since_update: connected.minutes_since_update ?? null,
      _connected: true,
      _summary: smartSummary(connected.activity) || managed._summary,
      _duration: managed.status === 'running'
        ? (connected.session_minutes != null ? formatDuration(connected.session_minutes) : managed._duration)
        : managed._duration,
    };
  });

  const remainingConnected = (connectedAgents || [])
    .filter(agent => !usedConnected.has(agent.agent_id))
    .map((agent) => ({
      ...agent,
      _managed: false,
      _connected: true,
      _display: getToolName(agent.tool) || 'Unknown',
      _summary: smartSummary(agent.activity),
      _duration: formatDuration(agent.session_minutes),
    }));

  return [...mergedManaged, ...remainingConnected];
}

export function countLiveAgents(agentRows) {
  return (agentRows || []).filter((agent) => {
    if (agent._managed) return agent.status === 'running';
    return agent.status === 'active';
  }).length;
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
  memorySearch,
  cols,
  projectDir,
} = {}) {
  const getToolName = createToolNameResolver(detectedTools);
  const dividerWidth = Math.min((cols || 80) - 4, 50);

  const members = context?.members || [];
  // Show all active agents except dashboard observers (tool='dashboard' or 'unknown')
  const activeAgents = members.filter(m => m.status === 'active' && m.tool && m.tool !== 'unknown' && m.tool !== 'dashboard');
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
  const q = (memorySearch || '').toLowerCase();
  const filteredMemories = q
    ? memories.filter(m =>
        m.text.toLowerCase().includes(q) ||
        m.tags?.some(t => t.toLowerCase().includes(q))
      )
    : memoryFilter
      ? memories.filter(memory => memory.tags?.includes(memoryFilter))
      : memories;
  const visibleMemories = filteredMemories.slice(0, MAX_MEMORIES);
  const memoryOverflow = filteredMemories.length - MAX_MEMORIES;

  const messages = context?.messages || [];
  const toolsConfigured = context?.tools_configured || [];
  const usage = context?.usage || {};

  const recentSessions = (context?.recentSessions || []).filter(hasVisibleSessionActivity);
  const showRecent = recentSessions.length > 0 && activeAgents.length === 0;

  const visibleAgents = activeAgents;
  const agentOverflow = 0;

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
