import { normalizeToolId } from './toolMeta.js';

function sortByValueDesc(a, b) {
  if (b.value !== a.value) return b.value - a.value;
  return String(a.label).localeCompare(String(b.label));
}

function withShare(items) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return items.map((item) => ({
    ...item,
    share: total > 0 ? item.value / total : 0,
  }));
}

function prettyCategory(id) {
  return String(id || 'other')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatShare(share) {
  return `${Math.round((share || 0) * 100)}%`;
}

function buildJoinShare(teams = [], { entryKey, valueKey, outputKey }) {
  const byEntity = new Map();

  teams.forEach((team) => {
    const projectName = team.team_name || team.team_id || 'Project';
    (team[entryKey] || []).forEach((entry) => {
      const rawValue = entry[valueKey];
      const normalizedValue = normalizeToolId(rawValue);
      if (!normalizedValue) return;
      if (!byEntity.has(normalizedValue)) {
        byEntity.set(normalizedValue, {
          [outputKey]: normalizedValue,
          label: rawValue || normalizedValue,
          value: 0,
          projects: new Set(),
        });
      }
      const item = byEntity.get(normalizedValue);
      item.value += entry.joins || 0;
      item.projects.add(projectName);
    });
  });

  return withShare(
    [...byEntity.values()]
      .map((item) => ({
        [outputKey]: item[outputKey],
        label: item.label,
        value: item.value,
        projectCount: item.projects.size,
        projects: [...item.projects].sort(),
      }))
      .sort(sortByValueDesc)
  );
}

export function buildToolJoinShare(teams = []) {
  return buildJoinShare(teams, {
    entryKey: 'tools_configured',
    valueKey: 'tool',
    outputKey: 'tool',
  });
}

export function buildHostJoinShare(teams = []) {
  return buildJoinShare(teams, {
    entryKey: 'hosts_configured',
    valueKey: 'host_tool',
    outputKey: 'host_tool',
  });
}

export function buildSurfaceJoinShare(teams = []) {
  return buildJoinShare(teams, {
    entryKey: 'surfaces_seen',
    valueKey: 'agent_surface',
    outputKey: 'agent_surface',
  });
}

export function buildCategoryJoinShare(toolEntries = [], catalog = [], categories = {}) {
  const categoryByTool = new Map(
    (catalog || []).map((tool) => [normalizeToolId(tool.id), tool.category || 'other'])
  );
  const byCategory = new Map();

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
    const item = byCategory.get(categoryId);
    item.value += entry.value || 0;
    item.tools += 1;
  });

  return withShare([...byCategory.values()].sort(sortByValueDesc));
}

export function buildProjectStates(teams = []) {
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
      value: teams.filter((team) => (team.active_agents || 0) === 0 && (team.conflict_count || 0) === 0).length,
      hint: 'no live work',
    },
  ];
}

export function buildLiveToolMix(members = []) {
  const activeMembers = members.filter((member) => member.status === 'active');
  const byTool = new Map();

  activeMembers.forEach((member) => {
    const toolId = normalizeToolId(member.tool) || 'unknown';
    if (!byTool.has(toolId)) {
      byTool.set(toolId, {
        tool: toolId,
        label: member.tool || 'Unknown',
        value: 0,
      });
    }
    byTool.get(toolId).value += 1;
  });

  return withShare([...byTool.values()].sort(sortByValueDesc));
}

export function buildUsageEntries(usage = {}) {
  return [
    usage.joins > 0 ? { id: 'joins', label: 'Recorded joins', value: usage.joins } : null,
    usage.conflict_checks > 0 ? { id: 'conflict_checks', label: 'Conflict checks', value: usage.conflict_checks } : null,
    usage.conflicts_found > 0 ? { id: 'conflicts_found', label: 'Conflicts found', value: usage.conflicts_found } : null,
    usage.memories_saved > 0 ? { id: 'memories_saved', label: 'Memories saved', value: usage.memories_saved } : null,
    usage.messages_sent > 0 ? { id: 'messages_sent', label: 'Messages sent', value: usage.messages_sent } : null,
  ]
    .filter(Boolean)
    .sort(sortByValueDesc);
}
