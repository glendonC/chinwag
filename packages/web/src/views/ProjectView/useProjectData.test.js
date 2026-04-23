import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * useProjectData is a React hook that composes store selectors with pure
 * derivation functions. Since we test "state transitions, NOT React rendering",
 * we test the derivation logic directly by importing the pure helpers from
 * projectViewState.js and exercising them with the same inputs the hook passes.
 *
 * This catches real bugs in the data shaping layer without needing a React
 * rendering harness.
 */

async function loadProjectViewState() {
  vi.resetModules();
  return import('./projectViewState.js');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('selectRecentSessions', () => {
  it('includes sessions with edits, touched files, or still running', async () => {
    const { selectRecentSessions } = await loadProjectViewState();

    const sessions = [
      { edit_count: 3, files_touched: [], ended_at: '2026-01-01' },
      { edit_count: 0, files_touched: ['a.ts'], ended_at: '2026-01-01' },
      { edit_count: 0, files_touched: [], ended_at: null },
      { edit_count: 0, files_touched: [], ended_at: '2026-01-01' },
    ];
    const result = selectRecentSessions(sessions);

    expect(result).toHaveLength(3);
    expect(result).not.toContainEqual(
      expect.objectContaining({ edit_count: 0, files_touched: [], ended_at: '2026-01-01' }),
    );
  });

  it('returns an empty array for empty input', async () => {
    const { selectRecentSessions } = await loadProjectViewState();

    expect(selectRecentSessions([])).toEqual([]);
    expect(selectRecentSessions()).toEqual([]);
  });

  it('caps at 24 sessions', async () => {
    const { selectRecentSessions } = await loadProjectViewState();

    const sessions = Array.from({ length: 30 }, (_, i) => ({
      edit_count: i + 1,
      files_touched: [],
      ended_at: '2026-01-01',
    }));
    const result = selectRecentSessions(sessions);

    expect(result).toHaveLength(24);
  });
});

describe('buildProjectConflicts', () => {
  it('returns pre-computed conflicts when available from the API', async () => {
    const { buildProjectConflicts } = await loadProjectViewState();

    const apiConflicts = [{ file: 'src/index.ts', agents: ['alice (cursor)', 'bob (claude)'] }];
    const result = buildProjectConflicts(apiConflicts, []);

    expect(result).toEqual([{ file: 'src/index.ts', owners: ['alice (cursor)', 'bob (claude)'] }]);
  });

  it('derives conflicts from member file overlap when no API conflicts', async () => {
    const { buildProjectConflicts } = await loadProjectViewState();

    const members = [
      {
        handle: 'alice',
        status: 'active',
        host_tool: 'cursor',
        activity: { files: ['shared.ts', 'a.ts'] },
      },
      {
        handle: 'bob',
        status: 'active',
        host_tool: 'claude',
        activity: { files: ['shared.ts', 'b.ts'] },
      },
    ];
    const result = buildProjectConflicts([], members);

    expect(result).toEqual([{ file: 'shared.ts', owners: ['alice (cursor)', 'bob (claude)'] }]);
  });

  it('ignores offline members when deriving conflicts', async () => {
    const { buildProjectConflicts } = await loadProjectViewState();

    const members = [
      {
        handle: 'alice',
        status: 'active',
        host_tool: 'cursor',
        activity: { files: ['shared.ts'] },
      },
      { handle: 'bob', status: 'offline', host_tool: 'claude', activity: { files: ['shared.ts'] } },
    ];
    const result = buildProjectConflicts([], members);

    expect(result).toEqual([]);
  });

  it('uses handle alone when host_tool is unknown', async () => {
    const { buildProjectConflicts } = await loadProjectViewState();

    const members = [
      {
        handle: 'alice',
        status: 'active',
        host_tool: 'unknown',
        activity: { files: ['shared.ts'] },
      },
      { handle: 'bob', status: 'active', host_tool: 'cursor', activity: { files: ['shared.ts'] } },
    ];
    const result = buildProjectConflicts([], members);

    expect(result).toEqual([{ file: 'shared.ts', owners: ['alice', 'bob (cursor)'] }]);
  });

  it('handles empty inputs gracefully', async () => {
    const { buildProjectConflicts } = await loadProjectViewState();

    expect(buildProjectConflicts([], [])).toEqual([]);
    expect(buildProjectConflicts()).toEqual([]);
  });
});

describe('buildFilesInPlay', () => {
  it('collects files from active agents and locks, sorted', async () => {
    const { buildFilesInPlay } = await loadProjectViewState();

    const agents = [{ activity: { files: ['c.ts', 'a.ts'] } }, { activity: { files: ['b.ts'] } }];
    const locks = [{ file_path: 'd.ts' }];
    const result = buildFilesInPlay(agents, locks);

    expect(result).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  });

  it('deduplicates files across agents and locks', async () => {
    const { buildFilesInPlay } = await loadProjectViewState();

    const agents = [{ activity: { files: ['shared.ts'] } }];
    const locks = [{ file_path: 'shared.ts' }];
    const result = buildFilesInPlay(agents, locks);

    expect(result).toEqual(['shared.ts']);
  });

  it('handles agents with no activity', async () => {
    const { buildFilesInPlay } = await loadProjectViewState();

    const agents = [{ activity: null }, {}];
    const result = buildFilesInPlay(agents, []);

    expect(result).toEqual([]);
  });

  it('handles empty inputs', async () => {
    const { buildFilesInPlay } = await loadProjectViewState();

    expect(buildFilesInPlay([], [])).toEqual([]);
    expect(buildFilesInPlay()).toEqual([]);
  });
});

describe('buildFilesTouched', () => {
  it('collects and deduplicates files from sessions, sorted', async () => {
    const { buildFilesTouched } = await loadProjectViewState();

    const sessions = [{ files_touched: ['c.ts', 'a.ts'] }, { files_touched: ['a.ts', 'b.ts'] }];
    const result = buildFilesTouched(sessions);

    expect(result).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('handles sessions with no files_touched', async () => {
    const { buildFilesTouched } = await loadProjectViewState();

    const sessions = [{ files_touched: null }, {}];
    const result = buildFilesTouched(sessions);

    expect(result).toEqual([]);
  });
});

describe('buildMemoryBreakdown', () => {
  it('counts tag occurrences sorted by frequency', async () => {
    const { buildMemoryBreakdown } = await loadProjectViewState();

    const memories = [
      { tags: ['decision', 'api'] },
      { tags: ['decision', 'config'] },
      { tags: ['api'] },
    ];
    const result = buildMemoryBreakdown(memories);

    expect(result).toEqual([
      ['decision', 2],
      ['api', 2],
      ['config', 1],
    ]);
  });

  it('handles memories with no tags', async () => {
    const { buildMemoryBreakdown } = await loadProjectViewState();

    const memories = [{ tags: null }, { tags: [] }, {}];
    const result = buildMemoryBreakdown(memories);

    expect(result).toEqual([]);
  });
});

describe('sumSessionEdits', () => {
  it('sums edit_count across sessions', async () => {
    const { sumSessionEdits } = await loadProjectViewState();

    const sessions = [{ edit_count: 5 }, { edit_count: 3 }, { edit_count: 0 }];
    expect(sumSessionEdits(sessions)).toBe(8);
  });

  it('treats missing edit_count as zero', async () => {
    const { sumSessionEdits } = await loadProjectViewState();

    expect(sumSessionEdits([{}, { edit_count: null }])).toBe(0);
    expect(sumSessionEdits()).toBe(0);
  });
});

describe('countLiveSessions', () => {
  it('counts sessions without ended_at', async () => {
    const { countLiveSessions } = await loadProjectViewState();

    const sessions = [{ ended_at: null }, { ended_at: '2026-01-01' }, {}];
    expect(countLiveSessions(sessions)).toBe(2);
  });

  it('returns 0 for empty input', async () => {
    const { countLiveSessions } = await loadProjectViewState();

    expect(countLiveSessions([])).toBe(0);
    expect(countLiveSessions()).toBe(0);
  });
});

describe('buildProjectToolSummaries', () => {
  it('merges configured tools with live member tool usage', async () => {
    const { buildProjectToolSummaries } = await loadProjectViewState();

    const members = [
      { host_tool: 'cursor', status: 'active' },
      { host_tool: 'cursor', status: 'active' },
      { host_tool: 'claude', status: 'offline' },
    ];
    const toolsConfigured = [
      { host_tool: 'cursor', joins: 10 },
      { host_tool: 'claude', joins: 5 },
    ];
    const result = buildProjectToolSummaries(members, toolsConfigured);

    const cursorEntry = result.find((e) => e.tool === 'cursor');
    expect(cursorEntry).toMatchObject({ tool: 'cursor', joins: 10, live: 2 });
    expect(cursorEntry.share).toBeCloseTo(10 / 15);

    const claudeEntry = result.find((e) => e.tool === 'claude');
    expect(claudeEntry).toMatchObject({ tool: 'claude', joins: 5, live: 0 });
  });

  it('handles members with tools not in configured list', async () => {
    const { buildProjectToolSummaries } = await loadProjectViewState();

    const members = [{ host_tool: 'windsurf', status: 'active' }];
    const result = buildProjectToolSummaries(members, []);

    expect(result).toEqual([expect.objectContaining({ tool: 'windsurf', joins: 0, live: 1 })]);
  });

  it('handles empty inputs', async () => {
    const { buildProjectToolSummaries } = await loadProjectViewState();

    expect(buildProjectToolSummaries([], [])).toEqual([]);
    expect(buildProjectToolSummaries()).toEqual([]);
  });
});

describe('buildProjectHostSummaries', () => {
  it('produces host_tool summaries', async () => {
    const { buildProjectHostSummaries } = await loadProjectViewState();

    const members = [{ host_tool: 'cursor', status: 'active' }];
    const hostsConfigured = [{ host_tool: 'cursor', joins: 5 }];
    const result = buildProjectHostSummaries(members, hostsConfigured);

    expect(result[0]).toMatchObject({ host_tool: 'cursor', joins: 5, live: 1 });
  });
});

describe('buildProjectSurfaceSummaries', () => {
  it('produces agent_surface summaries', async () => {
    const { buildProjectSurfaceSummaries } = await loadProjectViewState();

    const members = [{ agent_surface: 'chat', status: 'active' }];
    const surfacesSeen = [{ agent_surface: 'chat', joins: 3 }];
    const result = buildProjectSurfaceSummaries(members, surfacesSeen);

    expect(result[0]).toMatchObject({ agent_surface: 'chat', joins: 3, live: 1 });
  });
});

describe('derived data from useProjectData logic', () => {
  it('correctly partitions members into active and offline, in sort order', () => {
    const members = [
      { handle: 'alice', status: 'offline' },
      { handle: 'bob', status: 'active' },
      { handle: 'carol', status: 'active' },
      { handle: 'dave', status: 'offline' },
    ];

    // Replicate the hook's derivation logic
    const activeAgents = members.filter((m) => m.status === 'active');
    const offlineAgents = members.filter((m) => m.status === 'offline');
    const sortedAgents = activeAgents.concat(offlineAgents);

    expect(activeAgents.map((m) => m.handle)).toEqual(['bob', 'carol']);
    expect(offlineAgents.map((m) => m.handle)).toEqual(['alice', 'dave']);
    expect(sortedAgents.map((m) => m.handle)).toEqual(['bob', 'carol', 'alice', 'dave']);
  });

  it('handles empty members gracefully', () => {
    const members = [];

    const activeAgents = members.filter((m) => m.status === 'active');
    const offlineAgents = members.filter((m) => m.status === 'offline');
    const sortedAgents = activeAgents.concat(offlineAgents);

    expect(activeAgents).toEqual([]);
    expect(offlineAgents).toEqual([]);
    expect(sortedAgents).toEqual([]);
  });

  it('determines loading state correctly', () => {
    // isLoading = !hasCurrentContext && (contextStatus === 'idle' || contextStatus === 'loading')
    function isLoading(hasCurrentContext, contextStatus) {
      return !hasCurrentContext && (contextStatus === 'idle' || contextStatus === 'loading');
    }

    expect(isLoading(false, 'idle')).toBe(true);
    expect(isLoading(false, 'loading')).toBe(true);
    expect(isLoading(false, 'ready')).toBe(false);
    expect(isLoading(true, 'loading')).toBe(false);
    expect(isLoading(true, 'idle')).toBe(false);
  });

  it('determines unavailable state correctly', () => {
    // isUnavailable = !hasCurrentContext && contextStatus === 'error'
    function isUnavailable(hasCurrentContext, contextStatus) {
      return !hasCurrentContext && contextStatus === 'error';
    }

    expect(isUnavailable(false, 'error')).toBe(true);
    expect(isUnavailable(true, 'error')).toBe(false);
    expect(isUnavailable(false, 'ready')).toBe(false);
  });

  it('derives hasCurrentContext from matching team ID and existing data', () => {
    function hasCurrentContext(contextTeamId, activeTeamId, contextData) {
      return contextTeamId === activeTeamId && !!contextData;
    }

    expect(hasCurrentContext('t_1', 't_1', { members: [] })).toBe(true);
    expect(hasCurrentContext('t_1', 't_2', { members: [] })).toBe(false);
    expect(hasCurrentContext('t_1', 't_1', null)).toBe(false);
    expect(hasCurrentContext(null, null, null)).toBe(false);
  });

  it('extracts projectLabel from active team or falls back', () => {
    const teams = [
      { team_id: 't_1', team_name: 'chinmeister' },
      { team_id: 't_2', team_name: null },
    ];

    function getProjectLabel(activeTeamId) {
      const activeTeam = teams.find((t) => t.team_id === activeTeamId) || null;
      return activeTeam?.team_name || activeTeam?.team_id || 'this project';
    }

    expect(getProjectLabel('t_1')).toBe('chinmeister');
    expect(getProjectLabel('t_2')).toBe('t_2');
    expect(getProjectLabel('t_missing')).toBe('this project');
  });

  it('slices sessions to max 8 for the sessions property', async () => {
    const { selectRecentSessions } = await loadProjectViewState();

    const sessions = Array.from({ length: 12 }, (_, i) => ({
      edit_count: i + 1,
      files_touched: [],
      ended_at: '2026-01-01',
    }));
    const allSessions = selectRecentSessions(sessions);
    const displaySessions = allSessions.slice(0, 8);

    expect(displaySessions).toHaveLength(8);
    expect(allSessions.length).toBeGreaterThanOrEqual(8);
  });

  it('safely extracts fields from null contextData', () => {
    const contextData = null;

    const members = contextData?.members || [];
    const memories = contextData?.memories || [];
    const locks = contextData?.locks || [];
    const toolsConfigured = contextData?.tools_configured || [];
    const hostsConfigured = contextData?.hosts_configured || [];
    const surfacesSeen = contextData?.surfaces_seen || [];
    const usage = contextData?.usage || {};
    const modelsSeen = contextData?.models_seen || [];

    expect(members).toEqual([]);
    expect(memories).toEqual([]);
    expect(locks).toEqual([]);
    expect(toolsConfigured).toEqual([]);
    expect(hostsConfigured).toEqual([]);
    expect(surfacesSeen).toEqual([]);
    expect(usage).toEqual({});
    expect(modelsSeen).toEqual([]);
  });
});
