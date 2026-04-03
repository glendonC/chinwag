import type {
  Session,
  Member,
  Conflict,
  Lock,
  HostMetric,
  SurfaceMetric,
} from '../../lib/apiSchemas';

export function selectRecentSessions(sessions: Session[] = []): Session[] {
  return sessions
    .filter(
      (session) => session.edit_count > 0 || session.files_touched?.length > 0 || !session.ended_at,
    )
    .slice(0, 24);
}

export interface FileConflict {
  file: string;
  owners: string[];
}

export function buildProjectConflicts(
  contextConflicts: Conflict[] = [],
  members: Member[] = [],
): FileConflict[] {
  if (Array.isArray(contextConflicts) && contextConflicts.length > 0) {
    return contextConflicts.map((conflict) => ({
      file: conflict.file,
      owners: conflict.agents || [],
    }));
  }

  const owners = new Map<string, string[]>();
  members.forEach((member) => {
    if (member.status !== 'active' || !member.activity?.files) return;
    const label =
      member.host_tool && member.host_tool !== 'unknown'
        ? `${member.handle} (${member.host_tool})`
        : member.handle;

    member.activity.files.forEach((file) => {
      if (!owners.has(file)) owners.set(file, []);
      owners.get(file)!.push(label);
    });
  });

  return [...owners.entries()]
    .filter(([, overlap]) => overlap.length > 1)
    .map(([file, overlapOwners]) => ({ file, owners: overlapOwners }));
}

interface ActiveAgent {
  activity?: { files?: string[] } | null;
}

export function buildFilesInPlay(activeAgents: ActiveAgent[] = [], locks: Lock[] = []): string[] {
  const fileSet = new Set<string>();
  activeAgents.forEach((member) => {
    (member.activity?.files || []).forEach((file) => fileSet.add(file));
  });
  locks.forEach((lock) => fileSet.add(lock.file_path));
  return [...fileSet].sort();
}

interface SessionWithFiles {
  files_touched?: string[];
}

export function buildFilesTouched(sessions: SessionWithFiles[] = []): string[] {
  const fileSet = new Set<string>();
  sessions.forEach((session) => {
    (session.files_touched || []).forEach((file) => fileSet.add(file));
  });
  return [...fileSet].sort();
}

interface MemoryWithTags {
  tags?: string[];
}

export function buildMemoryBreakdown(memories: MemoryWithTags[] = []): [string, number][] {
  const counts = new Map<string, number>();
  memories.forEach((memory) => {
    (memory.tags || []).forEach((tag) => {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    });
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

interface UsageSummaryKeys {
  configuredKey: string;
  memberKey: string;
  outputKey: string;
}

export interface UsageSummaryEntry {
  [key: string]: string | number;
  joins: number;
  live: number;
  share: number;
}

function buildProjectUsageSummaries(
  members: Member[] = [],
  configuredEntries: Record<string, unknown>[] = [],
  { configuredKey, memberKey, outputKey }: UsageSummaryKeys,
): UsageSummaryEntry[] {
  const byEntity = new Map<string, Record<string, string | number>>();

  configuredEntries.forEach((entry) => {
    const id = entry[configuredKey] as string;
    if (!id) return;
    byEntity.set(id, {
      [outputKey]: id,
      joins: (entry.joins as number) || 0,
      live: 0,
    });
  });

  members.forEach((member) => {
    const id = ((member as Record<string, unknown>)[memberKey] as string) || 'unknown';
    if (!id) return;
    if (!byEntity.has(id)) {
      byEntity.set(id, { [outputKey]: id, joins: 0, live: 0 });
    }
    if (member.status === 'active') {
      (byEntity.get(id)!.live as number) += 1;
    }
  });

  const totalJoins = [...byEntity.values()].reduce(
    (sum, item) => sum + ((item.joins as number) || 0),
    0,
  );
  const withShare: UsageSummaryEntry[] = [...byEntity.values()].map(
    (item) =>
      ({
        ...item,
        share: totalJoins > 0 ? (item.joins as number) / totalJoins : 0,
      }) as UsageSummaryEntry,
  );
  return withShare.sort((a, b) => {
    const aScore = a.live * 100 + a.joins;
    const bScore = b.live * 100 + b.joins;
    return bScore - aScore;
  });
}

export function buildProjectToolSummaries(
  members: Member[] = [],
  toolsConfigured: HostMetric[] = [],
): UsageSummaryEntry[] {
  return buildProjectUsageSummaries(
    members,
    toolsConfigured as unknown as Record<string, unknown>[],
    {
      configuredKey: 'host_tool',
      memberKey: 'host_tool',
      outputKey: 'tool',
    },
  );
}

export function buildProjectHostSummaries(
  members: Member[] = [],
  hostsConfigured: HostMetric[] = [],
): UsageSummaryEntry[] {
  return buildProjectUsageSummaries(
    members,
    hostsConfigured as unknown as Record<string, unknown>[],
    {
      configuredKey: 'host_tool',
      memberKey: 'host_tool',
      outputKey: 'host_tool',
    },
  );
}

export function buildProjectSurfaceSummaries(
  members: Member[] = [],
  surfacesSeen: SurfaceMetric[] = [],
): UsageSummaryEntry[] {
  return buildProjectUsageSummaries(members, surfacesSeen as unknown as Record<string, unknown>[], {
    configuredKey: 'agent_surface',
    memberKey: 'agent_surface',
    outputKey: 'agent_surface',
  });
}

export function sumSessionEdits(sessions: { edit_count?: number }[] = []): number {
  return sessions.reduce((sum, session) => sum + (session.edit_count || 0), 0);
}

export function countLiveSessions(sessions: { ended_at?: string | null }[] = []): number {
  return sessions.filter((session) => !session.ended_at).length;
}
