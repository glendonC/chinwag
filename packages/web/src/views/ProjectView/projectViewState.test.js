import { describe, expect, it } from 'vitest';
import {
  selectRecentSessions,
  buildProjectConflicts,
  buildFilesInPlay,
  buildFilesTouched,
  buildMemoryBreakdown,
  buildProjectToolSummaries,
  buildProjectHostSummaries,
  buildProjectSurfaceSummaries,
  sumSessionEdits,
  countLiveSessions,
} from './projectViewState.js';

describe('selectRecentSessions', () => {
  it('returns empty array for no input', () => {
    expect(selectRecentSessions()).toEqual([]);
    expect(selectRecentSessions([])).toEqual([]);
  });

  it('keeps sessions with edit_count > 0', () => {
    const sessions = [
      { edit_count: 5, ended_at: '2025-01-01' },
      { edit_count: 0, ended_at: '2025-01-01' },
    ];
    expect(selectRecentSessions(sessions)).toEqual([sessions[0]]);
  });

  it('keeps sessions with files_touched', () => {
    const sessions = [
      { edit_count: 0, files_touched: ['a.js'], ended_at: '2025-01-01' },
      { edit_count: 0, files_touched: [], ended_at: '2025-01-01' },
    ];
    expect(selectRecentSessions(sessions)).toEqual([sessions[0]]);
  });

  it('keeps live sessions (no ended_at)', () => {
    const sessions = [
      { edit_count: 0, ended_at: null },
      { edit_count: 0, ended_at: undefined },
    ];
    expect(selectRecentSessions(sessions)).toEqual(sessions);
  });

  it('filters out sessions with zero edits, no files, and ended', () => {
    const sessions = [
      { edit_count: 0, files_touched: [], ended_at: '2025-01-01' },
      { edit_count: 0, ended_at: '2025-01-01' },
    ];
    expect(selectRecentSessions(sessions)).toEqual([]);
  });

  it('limits to 24 sessions', () => {
    const sessions = Array.from({ length: 30 }, (_, i) => ({
      edit_count: i + 1,
      ended_at: '2025-01-01',
    }));
    expect(selectRecentSessions(sessions)).toHaveLength(24);
  });
});

describe('buildProjectConflicts', () => {
  it('returns empty array for no input', () => {
    expect(buildProjectConflicts()).toEqual([]);
    expect(buildProjectConflicts([], [])).toEqual([]);
  });

  it('uses pre-computed conflicts when provided', () => {
    const contextConflicts = [
      { file: 'a.js', agents: ['alice', 'bob'] },
      { file: 'b.js', agents: ['carol'] },
    ];
    const result = buildProjectConflicts(contextConflicts, []);
    expect(result).toEqual([
      { file: 'a.js', owners: ['alice', 'bob'] },
      { file: 'b.js', owners: ['carol'] },
    ]);
  });

  it('detects overlapping files between active members', () => {
    const members = [
      { handle: 'alice', status: 'active', activity: { files: ['a.js', 'b.js'] } },
      { handle: 'bob', status: 'active', activity: { files: ['b.js', 'c.js'] } },
    ];
    const result = buildProjectConflicts([], members);
    expect(result).toEqual([
      { file: 'b.js', owners: ['alice', 'bob'] },
    ]);
  });

  it('ignores offline members', () => {
    const members = [
      { handle: 'alice', status: 'active', activity: { files: ['a.js'] } },
      { handle: 'bob', status: 'offline', activity: { files: ['a.js'] } },
    ];
    const result = buildProjectConflicts([], members);
    expect(result).toEqual([]);
  });

  it('includes tool in label when known', () => {
    const members = [
      { handle: 'alice', tool: 'claude-code', status: 'active', activity: { files: ['a.js'] } },
      { handle: 'bob', tool: 'cursor', status: 'active', activity: { files: ['a.js'] } },
    ];
    const result = buildProjectConflicts([], members);
    expect(result).toEqual([
      { file: 'a.js', owners: ['alice (claude-code)', 'bob (cursor)'] },
    ]);
  });

  it('omits tool from label when unknown', () => {
    const members = [
      { handle: 'alice', tool: 'unknown', status: 'active', activity: { files: ['a.js'] } },
      { handle: 'bob', status: 'active', activity: { files: ['a.js'] } },
    ];
    const result = buildProjectConflicts([], members);
    expect(result).toEqual([
      { file: 'a.js', owners: ['alice', 'bob'] },
    ]);
  });

  it('skips members without activity.files', () => {
    const members = [
      { handle: 'alice', status: 'active', activity: {} },
      { handle: 'bob', status: 'active' },
    ];
    const result = buildProjectConflicts([], members);
    expect(result).toEqual([]);
  });
});

describe('buildFilesInPlay', () => {
  it('returns empty sorted array for no input', () => {
    expect(buildFilesInPlay()).toEqual([]);
  });

  it('collects files from active agents', () => {
    const agents = [
      { activity: { files: ['b.js', 'a.js'] } },
      { activity: { files: ['c.js'] } },
    ];
    expect(buildFilesInPlay(agents, [])).toEqual(['a.js', 'b.js', 'c.js']);
  });

  it('includes lock file paths', () => {
    const locks = [{ file_path: 'lock.js' }];
    expect(buildFilesInPlay([], locks)).toEqual(['lock.js']);
  });

  it('deduplicates files from agents and locks', () => {
    const agents = [{ activity: { files: ['a.js'] } }];
    const locks = [{ file_path: 'a.js' }];
    expect(buildFilesInPlay(agents, locks)).toEqual(['a.js']);
  });

  it('handles agents without activity.files', () => {
    const agents = [{ activity: {} }, {}];
    expect(buildFilesInPlay(agents, [])).toEqual([]);
  });

  it('returns sorted results', () => {
    const agents = [{ activity: { files: ['z.js', 'a.js', 'm.js'] } }];
    expect(buildFilesInPlay(agents, [])).toEqual(['a.js', 'm.js', 'z.js']);
  });
});

describe('buildFilesTouched', () => {
  it('returns empty array for no input', () => {
    expect(buildFilesTouched()).toEqual([]);
  });

  it('collects unique files from sessions', () => {
    const sessions = [
      { files_touched: ['a.js', 'b.js'] },
      { files_touched: ['b.js', 'c.js'] },
    ];
    expect(buildFilesTouched(sessions)).toEqual(['a.js', 'b.js', 'c.js']);
  });

  it('handles sessions without files_touched', () => {
    const sessions = [{ edit_count: 5 }, { files_touched: ['a.js'] }];
    expect(buildFilesTouched(sessions)).toEqual(['a.js']);
  });

  it('returns sorted results', () => {
    const sessions = [{ files_touched: ['z.js', 'a.js'] }];
    expect(buildFilesTouched(sessions)).toEqual(['a.js', 'z.js']);
  });
});

describe('buildMemoryBreakdown', () => {
  it('returns empty array for no input', () => {
    expect(buildMemoryBreakdown()).toEqual([]);
  });

  it('counts tag occurrences', () => {
    const memories = [
      { tags: ['api', 'bug'] },
      { tags: ['api', 'feature'] },
      { tags: ['bug'] },
    ];
    const result = buildMemoryBreakdown(memories);
    expect(result).toEqual([
      ['api', 2],
      ['bug', 2],
      ['feature', 1],
    ]);
  });

  it('sorts by count descending', () => {
    const memories = [
      { tags: ['rare'] },
      { tags: ['common', 'common2'] },
      { tags: ['common', 'common2'] },
      { tags: ['common'] },
    ];
    const result = buildMemoryBreakdown(memories);
    expect(result[0]).toEqual(['common', 3]);
    expect(result[1]).toEqual(['common2', 2]);
    expect(result[2]).toEqual(['rare', 1]);
  });

  it('handles memories without tags', () => {
    const memories = [{ text: 'no tags' }, { tags: ['a'] }];
    expect(buildMemoryBreakdown(memories)).toEqual([['a', 1]]);
  });
});

describe('buildProjectToolSummaries', () => {
  it('returns empty array for no input', () => {
    expect(buildProjectToolSummaries()).toEqual([]);
  });

  it('merges configured tools with live member counts', () => {
    const members = [
      { tool: 'claude-code', status: 'active' },
      { tool: 'claude-code', status: 'active' },
      { tool: 'cursor', status: 'offline' },
    ];
    const toolsConfigured = [
      { tool: 'claude-code', joins: 10 },
      { tool: 'cursor', joins: 5 },
    ];
    const result = buildProjectToolSummaries(members, toolsConfigured);
    expect(result).toHaveLength(2);

    const claudeCode = result.find((t) => t.tool === 'claude-code');
    expect(claudeCode.live).toBe(2);
    expect(claudeCode.joins).toBe(10);
    expect(claudeCode.share).toBeCloseTo(10 / 15);

    const cursor = result.find((t) => t.tool === 'cursor');
    expect(cursor.live).toBe(0);
    expect(cursor.joins).toBe(5);
  });

  it('includes tools from members not in configured list', () => {
    const members = [{ tool: 'windsurf', status: 'active' }];
    const result = buildProjectToolSummaries(members, []);
    expect(result).toHaveLength(1);
    expect(result[0].tool).toBe('windsurf');
    expect(result[0].live).toBe(1);
    expect(result[0].joins).toBe(0);
  });

  it('sorts by live*100 + joins descending', () => {
    const members = [
      { tool: 'cursor', status: 'active' },
    ];
    const toolsConfigured = [
      { tool: 'claude-code', joins: 50 },
      { tool: 'cursor', joins: 1 },
    ];
    const result = buildProjectToolSummaries(members, toolsConfigured);
    // cursor: score = 100*1 + 1 = 101
    // claude-code: score = 100*0 + 50 = 50
    expect(result[0].tool).toBe('cursor');
    expect(result[1].tool).toBe('claude-code');
  });

  it('calculates share based on total joins', () => {
    const toolsConfigured = [
      { tool: 'a', joins: 3 },
      { tool: 'b', joins: 7 },
    ];
    const result = buildProjectToolSummaries([], toolsConfigured);
    expect(result.find((t) => t.tool === 'a').share).toBeCloseTo(0.3);
    expect(result.find((t) => t.tool === 'b').share).toBeCloseTo(0.7);
  });

  it('sets share to 0 when no joins exist', () => {
    const members = [{ tool: 'x', status: 'active' }];
    const result = buildProjectToolSummaries(members, []);
    expect(result[0].share).toBe(0);
  });
});

describe('buildProjectHostSummaries', () => {
  it('merges configured hosts with live member counts', () => {
    const members = [
      { host_tool: 'vscode', status: 'active' },
      { host_tool: 'vscode', status: 'active' },
    ];
    const hostsConfigured = [
      { host_tool: 'vscode', joins: 8 },
      { host_tool: 'jetbrains', joins: 2 },
    ];
    const result = buildProjectHostSummaries(members, hostsConfigured);
    expect(result).toHaveLength(2);

    const vscode = result.find((h) => h.host_tool === 'vscode');
    expect(vscode.live).toBe(2);
    expect(vscode.joins).toBe(8);
  });
});

describe('buildProjectSurfaceSummaries', () => {
  it('merges seen surfaces with live member counts', () => {
    const members = [
      { agent_surface: 'chat', status: 'active' },
    ];
    const surfacesSeen = [
      { agent_surface: 'chat', joins: 4 },
      { agent_surface: 'inline', joins: 6 },
    ];
    const result = buildProjectSurfaceSummaries(members, surfacesSeen);
    expect(result).toHaveLength(2);

    const chat = result.find((s) => s.agent_surface === 'chat');
    expect(chat.live).toBe(1);
    expect(chat.joins).toBe(4);
  });
});

describe('sumSessionEdits', () => {
  it('returns 0 for no input', () => {
    expect(sumSessionEdits()).toBe(0);
    expect(sumSessionEdits([])).toBe(0);
  });

  it('sums edit_count across sessions', () => {
    const sessions = [
      { edit_count: 5 },
      { edit_count: 3 },
      { edit_count: 0 },
    ];
    expect(sumSessionEdits(sessions)).toBe(8);
  });

  it('handles sessions without edit_count', () => {
    const sessions = [{ edit_count: 5 }, {}];
    expect(sumSessionEdits(sessions)).toBe(5);
  });
});

describe('countLiveSessions', () => {
  it('returns 0 for no input', () => {
    expect(countLiveSessions()).toBe(0);
    expect(countLiveSessions([])).toBe(0);
  });

  it('counts sessions without ended_at', () => {
    const sessions = [
      { ended_at: null },
      { ended_at: '2025-01-01' },
      { ended_at: undefined },
      {},
    ];
    expect(countLiveSessions(sessions)).toBe(3);
  });
});
