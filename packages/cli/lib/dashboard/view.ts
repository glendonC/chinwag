import { basename } from 'path';

export const MAX_MEMORIES = 8;

// ── Shared types ───────────────────────────────────

export interface DetectedTool {
  id: string;
  name: string;
}

export interface AgentActivity {
  files: string[];
  summary?: string;
  updated_at?: string;
}

export interface TeamMember {
  agent_id: string;
  handle: string;
  tool: string;
  status: string;
  session_minutes?: number;
  minutes_since_update?: number | null;
  activity?: AgentActivity | null;
}

export interface MemoryEntry {
  id: string;
  text: string;
  tags?: string[];
  source_handle?: string;
}

export interface SessionEntry {
  owner_handle?: string;
  duration_minutes?: number;
  edit_count?: number;
  files_touched?: string[];
  ended_at?: string | null;
}

export interface TeamContext {
  members?: TeamMember[];
  memories?: MemoryEntry[];
  messages?: Array<{ from_handle: string; from_tool?: string; text: string; created_at?: string }>;
  locks?: Array<{ file_path: string; owner_handle: string; tool?: string; minutes_held: number }>;
  tools_configured?: string[];
  usage?: Record<string, unknown>;
  recentSessions?: SessionEntry[];
}

export interface ManagedAgent {
  id: number;
  toolId: string;
  toolName: string;
  cmd: string;
  args: string[];
  taskArg: string;
  task: string;
  cwd: string;
  agentId?: string;
  agent_id?: string;
  handle?: string | null;
  status: string;
  startedAt: number;
  exitCode: number | null;
  outputPreview?: string | null;
  spawnType?: string;
  pid?: number | null;
  activity?: AgentActivity | null;
  session_minutes?: number | null;
  minutes_since_update?: number | null;
  tool?: string;
}

export interface CombinedAgentRow extends ManagedAgent {
  _managed: boolean;
  _connected: boolean;
  _display: string;
  _summary: string | null;
  _duration: string | null;
  _dead: boolean;
  _exited: boolean;
  _failed: boolean;
  _exitCode: number | null;
}

// ── Helper functions ───────────────────────────────

export function createToolNameResolver(
  detectedTools: DetectedTool[] | null | undefined,
): (toolId: string) => string | null {
  const toolNameMap = new Map((detectedTools || []).map((t) => [t.id, t.name]));
  return (toolId: string) => {
    if (!toolId || toolId === 'unknown') return null;
    return toolNameMap.get(toolId) || toolId;
  };
}

export function formatDuration(minutes: number | null | undefined): string | null {
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
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.bmp',
  '.tiff',
  '.mp4',
  '.mov',
  '.avi',
  '.webm',
  '.mp3',
  '.wav',
  '.ogg',
]);

function isMediaFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && MEDIA_EXTS.has(name.slice(dot).toLowerCase());
}

export function formatFiles(files: string[] | null | undefined): string | null {
  if (!files?.length) return null;
  const names = files.map((f) => basename(f));
  const code = names.filter((n) => !isMediaFile(n));
  const mediaCount = names.length - code.length;

  // Show code files first, collapse media to a count
  const display = code.length > 0 ? code : names;
  const shown =
    display.length <= 3
      ? display.join(', ')
      : `${display[0]}, ${display[1]} + ${display.length - 2} more`;

  if (mediaCount > 0 && code.length > 0) {
    return `${shown} + ${mediaCount} image${mediaCount > 1 ? 's' : ''}`;
  }
  // All media, no code files
  if (code.length === 0) {
    return `${mediaCount} image${mediaCount > 1 ? 's' : ''}`;
  }
  return shown;
}

export function smartSummary(activity: AgentActivity | null | undefined): string | null {
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

function buildManagedAgentRows(
  managedAgents: ManagedAgent[] | null | undefined,
  getToolName: (id: string) => string | null,
  now: number = Date.now(),
): CombinedAgentRow[] {
  return (managedAgents || []).map((agent): CombinedAgentRow => {
    const toolId = agent.toolId || agent.tool || 'unknown';
    const isDead = agent.status !== 'running';
    const hasError = agent.status === 'failed' || (agent.exitCode != null && agent.exitCode !== 0);

    return {
      ...agent,
      agent_id: agent.agentId || agent.agent_id || '',
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

interface BuildCombinedOptions {
  managedAgents?: ManagedAgent[];
  connectedAgents?: TeamMember[];
  getToolName: (id: string) => string | null;
  now?: number;
}

export function buildCombinedAgentRows({
  managedAgents,
  connectedAgents,
  getToolName,
  now = Date.now(),
}: BuildCombinedOptions): CombinedAgentRow[] {
  const managedRows = buildManagedAgentRows(managedAgents, getToolName, now);
  const connectedById = new Map((connectedAgents || []).map((agent) => [agent.agent_id, agent]));
  const usedConnected = new Set<string>();

  const mergedManaged = managedRows.map((managed) => {
    const connected = managed.agent_id ? connectedById.get(managed.agent_id) : null;
    if (!connected) return managed;

    usedConnected.add(connected.agent_id);
    return {
      ...connected,
      ...managed,
      handle: connected.handle || managed.handle || null,
      tool: managed.tool || connected.host_tool,
      activity: connected.activity || managed.activity || null,
      session_minutes: connected.session_minutes ?? managed.session_minutes ?? null,
      minutes_since_update: connected.minutes_since_update ?? null,
      _connected: true,
      _summary: smartSummary(connected.activity) || managed._summary,
      _duration:
        managed.status === 'running'
          ? connected.session_minutes != null
            ? formatDuration(connected.session_minutes)
            : managed._duration
          : managed._duration,
    } as CombinedAgentRow;
  });

  const remainingConnected: CombinedAgentRow[] = (connectedAgents || [])
    .filter((agent) => !usedConnected.has(agent.agent_id))
    .map((agent) => ({
      ...agent,
      id: 0,
      toolId: agent.host_tool,
      toolName: getToolName(agent.host_tool) || 'Unknown',
      cmd: '',
      args: [],
      taskArg: '',
      task: '',
      cwd: '',
      startedAt: 0,
      exitCode: null,
      _managed: false,
      _connected: true,
      _display: getToolName(agent.host_tool) || 'Unknown',
      _summary: smartSummary(agent.activity),
      _duration: formatDuration(agent.session_minutes),
      _dead: false,
      _exited: false,
      _failed: false,
      _exitCode: null,
    }));

  return [...mergedManaged, ...remainingConnected];
}

export function countLiveAgents(agentRows: CombinedAgentRow[] | null | undefined): number {
  return (agentRows || []).filter((agent) => {
    if (agent._managed) return agent.status === 'running';
    return agent.status === 'active';
  }).length;
}

export function shortAgentId(agentId: string | null | undefined): string {
  if (!agentId) return '';
  const parts = agentId.split(':');
  if (parts.length >= 3) return parts[2].slice(0, 4);
  return '';
}

export function hasVisibleSessionActivity(session: SessionEntry | null | undefined): boolean {
  if (!session) return false;
  return (
    !session.ended_at || (session.edit_count ?? 0) > 0 || (session.files_touched?.length ?? 0) > 0
  );
}

interface BuildDashboardViewOptions {
  context?: TeamContext;
  detectedTools?: DetectedTool[];
  memoryFilter?: string | null;
  memorySearch?: string;
  cols?: number;
  projectDir?: string;
}

export function buildDashboardView({
  context,
  detectedTools,
  memoryFilter,
  memorySearch,
  cols,
  projectDir,
}: BuildDashboardViewOptions = {}) {
  const getToolName = createToolNameResolver(detectedTools);
  const dividerWidth = Math.min((cols || 80) - 4, 50);

  const members = context?.members || [];
  // Show all active agents except dashboard observers (tool='dashboard' or 'unknown')
  const activeAgents = members.filter(
    (m) =>
      m.status === 'active' &&
      m.host_tool &&
      m.host_tool !== 'unknown' &&
      m.host_tool !== 'dashboard',
  );
  const agentsWithWork = activeAgents.filter((m) => m.activity?.files?.length);
  const uniqueHandles = new Set(activeAgents.map((m) => m.handle));
  const isTeam = uniqueHandles.size > 1;

  const fileOwners = new Map<string, string[]>();
  for (const member of agentsWithWork) {
    const label = getToolName(member.host_tool)
      ? `${member.handle} (${getToolName(member.host_tool)})`
      : member.handle;
    for (const file of member.activity!.files) {
      if (!fileOwners.has(file)) fileOwners.set(file, []);
      fileOwners.get(file)!.push(label);
    }
  }
  const conflicts = [...fileOwners.entries()].filter(([, owners]) => owners.length > 1);

  const memories = context?.memories || [];
  const q = (memorySearch || '').toLowerCase();
  const filteredMemories = q
    ? memories.filter(
        (m) => m.text.toLowerCase().includes(q) || m.tags?.some((t) => t.toLowerCase().includes(q)),
      )
    : memoryFilter
      ? memories.filter((memory) => memory.tags?.includes(memoryFilter))
      : memories;
  const visibleMemories = filteredMemories.slice(0, MAX_MEMORIES);
  const memoryOverflow = filteredMemories.length - MAX_MEMORIES;

  const messages = context?.messages || [];
  const toolsConfigured = context?.tools_configured || [];
  const usage = context?.usage || {};

  const recentSessions = (context?.sessions || []).filter(hasVisibleSessionActivity);
  const showRecent = recentSessions.length > 0 && activeAgents.length === 0;

  const visibleAgents = activeAgents;
  const agentOverflow = 0;

  const toolCounts = new Map<string, number>();
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
