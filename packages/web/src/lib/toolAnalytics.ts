import { normalizeToolId } from './toolMeta.js';

interface SortableItem {
  label: string;
  value: number;
}

interface WithShareItem {
  share: number;
}

interface BuildJoinShareConfig {
  entryKey: string;
  valueKey: string;
  outputKey: string;
}

interface JoinShareEntry {
  [key: string]: string | number | string[];
  label: string;
  value: number;
  share: number;
  projectCount: number;
  projects: string[];
}

interface TeamInput {
  team_id?: string;
  team_name?: string;
  hosts_configured?: Array<Record<string, unknown>>;
  surfaces_seen?: Array<Record<string, unknown>>;
  active_agents?: number;
  conflict_count?: number;
  [key: string]: unknown;
}

interface MemberInput {
  status?: string;
  host_tool?: string;
  [key: string]: unknown;
}

interface ToolMixEntry {
  tool: string;
  label: string;
  value: number;
  share: number;
}

interface CategoryEntry {
  id: string;
  label: string;
  value: number;
  tools: number;
  share: number;
}

interface CatalogTool {
  id: string;
  category?: string;
  [key: string]: unknown;
}

interface ToolEntry {
  tool?: string;
  value?: number;
  [key: string]: unknown;
}

interface ProjectState {
  id: string;
  label: string;
  value: number;
  hint: string;
}

interface UsageInput {
  joins?: number;
  conflict_checks?: number;
  conflicts_found?: number;
  memories_saved?: number;
  messages_sent?: number;
  [key: string]: unknown;
}

interface UsageEntry {
  id: string;
  label: string;
  value: number;
}

function sortByValueDesc(a: SortableItem, b: SortableItem): number {
  if (b.value !== a.value) return b.value - a.value;
  return String(a.label).localeCompare(String(b.label));
}

function withShare<T extends { value: number }>(items: T[]): (T & WithShareItem)[] {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return items.map((item) => ({
    ...item,
    share: total > 0 ? item.value / total : 0,
  }));
}

function prettyCategory(id: string | null | undefined): string {
  return String(id || 'other')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatShare(share: number | null | undefined): string {
  return `${Math.round((share || 0) * 100)}%`;
}

function buildJoinShare(
  teams: TeamInput[] = [],
  { entryKey, valueKey, outputKey }: BuildJoinShareConfig,
): JoinShareEntry[] {
  const byEntity = new Map<
    string,
    {
      [key: string]: unknown;
      label: string;
      value: number;
      projects: Set<string>;
    }
  >();

  teams.forEach((team) => {
    const projectName = team.team_name || team.team_id || 'Project';
    const entries = (team[entryKey] as Array<Record<string, unknown>> | undefined) || [];
    entries.forEach((entry) => {
      const rawValue = entry[valueKey] as string;
      const normalizedValue = normalizeToolId(rawValue);
      if (!normalizedValue) return;
      if (!byEntity.has(normalizedValue)) {
        byEntity.set(normalizedValue, {
          [outputKey]: normalizedValue,
          label: rawValue || normalizedValue,
          value: 0,
          projects: new Set<string>(),
        });
      }
      const item = byEntity.get(normalizedValue)!;
      item.value += (entry.joins as number) || 0;
      item.projects.add(projectName);
    });
  });

  return withShare(
    [...byEntity.values()]
      .map((item) => ({
        [outputKey]: item[outputKey] as string,
        label: item.label,
        value: item.value,
        projectCount: item.projects.size,
        projects: [...item.projects].sort(),
      }))
      .sort(sortByValueDesc),
  ) as JoinShareEntry[];
}

export function buildToolJoinShare(teams: TeamInput[] = []): JoinShareEntry[] {
  return buildJoinShare(teams, {
    entryKey: 'hosts_configured',
    valueKey: 'host_tool',
    outputKey: 'tool',
  });
}

export function buildHostJoinShare(teams: TeamInput[] = []): JoinShareEntry[] {
  return buildJoinShare(teams, {
    entryKey: 'hosts_configured',
    valueKey: 'host_tool',
    outputKey: 'host_tool',
  });
}

export function buildSurfaceJoinShare(teams: TeamInput[] = []): JoinShareEntry[] {
  return buildJoinShare(teams, {
    entryKey: 'surfaces_seen',
    valueKey: 'agent_surface',
    outputKey: 'agent_surface',
  });
}

export function buildCategoryJoinShare(
  toolEntries: ToolEntry[] = [],
  catalog: CatalogTool[] = [],
  categories: Record<string, string> = {},
): CategoryEntry[] {
  const categoryByTool = new Map(
    (catalog || []).map((tool) => [normalizeToolId(tool.id), tool.category || 'other']),
  );
  const byCategory = new Map<string, { id: string; label: string; value: number; tools: number }>();

  toolEntries.forEach((entry) => {
    const categoryId = categoryByTool.get(normalizeToolId(entry.tool)) || 'other';
    if (!byCategory.has(categoryId)) {
      byCategory.set(categoryId, {
        id: categoryId,
        label: categories[categoryId] || prettyCategory(categoryId),
        value: 0,
        tools: 0,
      });
    }
    const item = byCategory.get(categoryId)!;
    item.value += entry.value || 0;
    item.tools += 1;
  });

  return withShare([...byCategory.values()].sort(sortByValueDesc)) as CategoryEntry[];
}

export function buildProjectStates(teams: TeamInput[] = []): ProjectState[] {
  return [
    {
      id: 'active',
      label: 'Active',
      value: teams.filter((team) => (team.active_agents || 0) > 0).length,
      hint: '1+ live agents',
    },
    {
      id: 'conflicts',
      label: 'Conflicts',
      value: teams.filter((team) => (team.conflict_count || 0) > 0).length,
      hint: 'overlapping files',
    },
    {
      id: 'quiet',
      label: 'Quiet',
      value: teams.filter(
        (team) => (team.active_agents || 0) === 0 && (team.conflict_count || 0) === 0,
      ).length,
      hint: 'no live work',
    },
  ];
}

export function buildLiveToolMix(members: MemberInput[] = []): ToolMixEntry[] {
  const activeMembers = members.filter((member) => member.status === 'active');
  const byTool = new Map<string, { tool: string; label: string; value: number }>();

  activeMembers.forEach((member) => {
    const toolId = normalizeToolId(member.host_tool) || 'unknown';
    if (!byTool.has(toolId)) {
      byTool.set(toolId, {
        tool: toolId,
        label: member.host_tool || 'Unknown',
        value: 0,
      });
    }
    byTool.get(toolId)!.value += 1;
  });

  return withShare([...byTool.values()].sort(sortByValueDesc)) as ToolMixEntry[];
}

export function buildUsageEntries(usage: UsageInput = {}): UsageEntry[] {
  return [
    usage.joins > 0 ? { id: 'joins', label: 'Recorded joins', value: usage.joins } : null,
    usage.conflict_checks > 0
      ? { id: 'conflict_checks', label: 'Conflict checks', value: usage.conflict_checks }
      : null,
    usage.conflicts_found > 0
      ? { id: 'conflicts_found', label: 'Conflicts found', value: usage.conflicts_found }
      : null,
    usage.memories_saved > 0
      ? { id: 'memories_saved', label: 'Memories saved', value: usage.memories_saved }
      : null,
    usage.messages_sent > 0
      ? { id: 'messages_sent', label: 'Messages sent', value: usage.messages_sent }
      : null,
  ]
    .filter((entry): entry is UsageEntry => entry !== null)
    .sort(sortByValueDesc);
}
