export function selectRecentSessions(recentSessions = []) {
  return recentSessions
    .filter((session) => session.edit_count > 0 || session.files_touched?.length > 0 || !session.ended_at)
    .slice(0, 24);
}

export function buildProjectConflicts(contextConflicts = [], members = []) {
  if (Array.isArray(contextConflicts) && contextConflicts.length > 0) {
    return contextConflicts.map((conflict) => ({
      file: conflict.file,
      owners: conflict.agents || [],
    }));
  }

  const owners = new Map();
  members.forEach((member) => {
    if (member.status !== 'active' || !member.activity?.files) return;
    const label =
      member.tool && member.tool !== 'unknown'
        ? `${member.handle} (${member.tool})`
        : member.handle;

    member.activity.files.forEach((file) => {
      if (!owners.has(file)) owners.set(file, []);
      owners.get(file).push(label);
    });
  });

  return [...owners.entries()]
    .filter(([, overlap]) => overlap.length > 1)
    .map(([file, overlapOwners]) => ({ file, owners: overlapOwners }));
}

export function buildFilesInPlay(activeAgents = [], locks = []) {
  const fileSet = new Set();
  activeAgents.forEach((member) => {
    (member.activity?.files || []).forEach((file) => fileSet.add(file));
  });
  locks.forEach((lock) => fileSet.add(lock.file_path));
  return [...fileSet].sort();
}

export function buildFilesTouched(sessions = []) {
  const fileSet = new Set();
  sessions.forEach((session) => {
    (session.files_touched || []).forEach((file) => fileSet.add(file));
  });
  return [...fileSet].sort();
}

export function buildMemoryBreakdown(memories = []) {
  const counts = new Map();
  memories.forEach((memory) => {
    (memory.tags || []).forEach((tag) => {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    });
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function buildProjectUsageSummaries(members = [], configuredEntries = [], {
  configuredKey,
  memberKey,
  outputKey,
} = {}) {
  const byEntity = new Map();

  configuredEntries.forEach((entry) => {
    const id = entry[configuredKey];
    if (!id) return;
    byEntity.set(id, {
      [outputKey]: id,
      joins: entry.joins || 0,
      live: 0,
    });
  });

  members.forEach((member) => {
    const id = member[memberKey] || 'unknown';
    if (!id) return;
    if (!byEntity.has(id)) {
      byEntity.set(id, { [outputKey]: id, joins: 0, live: 0 });
    }
    if (member.status === 'active') {
      byEntity.get(id).live += 1;
    }
  });

  const totalJoins = [...byEntity.values()].reduce((sum, item) => sum + (item.joins || 0), 0);
  return [...byEntity.values()]
    .map((item) => ({
      ...item,
      share: totalJoins > 0 ? item.joins / totalJoins : 0,
    }))
    .sort((a, b) => {
      const aScore = (a.live * 100) + a.joins;
      const bScore = (b.live * 100) + b.joins;
      return bScore - aScore;
    });
}

export function buildProjectToolSummaries(members = [], toolsConfigured = []) {
  return buildProjectUsageSummaries(members, toolsConfigured, {
    configuredKey: 'tool',
    memberKey: 'tool',
    outputKey: 'tool',
  });
}

export function buildProjectHostSummaries(members = [], hostsConfigured = []) {
  return buildProjectUsageSummaries(members, hostsConfigured, {
    configuredKey: 'host_tool',
    memberKey: 'host_tool',
    outputKey: 'host_tool',
  });
}

export function buildProjectSurfaceSummaries(members = [], surfacesSeen = []) {
  return buildProjectUsageSummaries(members, surfacesSeen, {
    configuredKey: 'agent_surface',
    memberKey: 'agent_surface',
    outputKey: 'agent_surface',
  });
}

export function sumSessionEdits(sessions = []) {
  return sessions.reduce((sum, session) => sum + (session.edit_count || 0), 0);
}

export function countLiveSessions(sessions = []) {
  return sessions.filter((session) => !session.ended_at).length;
}
