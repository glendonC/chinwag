import { describe, expect, it } from 'vitest';
import {
  buildCombinedAgentRows,
  buildDashboardView,
  countLiveAgents,
  createToolNameResolver,
  formatDuration,
  formatFiles,
  hasVisibleSessionActivity,
  smartSummary,
  shortAgentId,
  MAX_MEMORIES,
} from '../dashboard/view.js';

// ── createToolNameResolver ─────────────────────────────

describe('createToolNameResolver edge cases', () => {
  it('returns null for null or undefined input', () => {
    const resolver = createToolNameResolver(null);
    expect(resolver(null)).toBeNull();
    expect(resolver(undefined)).toBeNull();
  });

  it('returns null for "unknown" tool id', () => {
    const resolver = createToolNameResolver([{ id: 'x', name: 'X' }]);
    expect(resolver('unknown')).toBeNull();
  });

  it('returns the raw id when not in the map', () => {
    const resolver = createToolNameResolver([{ id: 'claude-code', name: 'Claude Code' }]);
    expect(resolver('aider')).toBe('aider');
  });

  it('handles empty detected tools array', () => {
    const resolver = createToolNameResolver([]);
    expect(resolver('claude-code')).toBe('claude-code');
  });
});

// ── formatDuration ─────────────────────────────────────

describe('formatDuration edge cases', () => {
  it('returns null for null/undefined', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
  });

  it('rounds fractional minutes', () => {
    expect(formatDuration(5.4)).toBe('5 min');
    expect(formatDuration(5.6)).toBe('6 min');
  });

  it('formats exactly 60 minutes as 1h', () => {
    expect(formatDuration(60)).toBe('1h');
  });

  it('formats hours with remainder', () => {
    expect(formatDuration(150)).toBe('2h 30m');
  });

  it('formats 0 minutes', () => {
    expect(formatDuration(0)).toBe('0 min');
  });

  it('formats large values', () => {
    expect(formatDuration(1440)).toBe('24h');
    expect(formatDuration(1441)).toBe('24h 1m');
  });
});

// ── formatFiles ────────────────────────────────────────

describe('formatFiles edge cases', () => {
  it('returns null for null/undefined/empty', () => {
    expect(formatFiles(null)).toBeNull();
    expect(formatFiles(undefined)).toBeNull();
    expect(formatFiles([])).toBeNull();
  });

  it('shows single file name', () => {
    expect(formatFiles(['/path/to/file.js'])).toBe('file.js');
  });

  it('shows two files', () => {
    expect(formatFiles(['a.js', 'b.js'])).toBe('a.js, b.js');
  });

  it('shows three files', () => {
    expect(formatFiles(['a.js', 'b.js', 'c.js'])).toBe('a.js, b.js, c.js');
  });

  it('collapses more than 3 files', () => {
    expect(formatFiles(['a.js', 'b.js', 'c.js', 'd.js'])).toBe('a.js, b.js + 2 more');
  });

  it('separates media files from code files', () => {
    expect(formatFiles(['app.js', 'logo.png'])).toBe('app.js + 1 image');
    expect(formatFiles(['app.js', 'logo.png', 'icon.svg'])).toBe('app.js + 2 images');
  });

  it('shows count when all files are media', () => {
    expect(formatFiles(['logo.png'])).toBe('1 image');
    expect(formatFiles(['logo.png', 'bg.jpg'])).toBe('2 images');
  });

  it('handles mixed media and code with overflow', () => {
    expect(formatFiles(['a.js', 'b.ts', 'c.css', 'd.py', 'logo.png'])).toBe(
      'a.js, b.ts + 2 more + 1 image',
    );
  });

  it('handles various media extensions', () => {
    // All recognized as media
    const mediaFiles = ['a.png', 'b.jpg', 'c.jpeg', 'd.gif', 'e.svg', 'f.webp', 'g.ico', 'h.mp4'];
    expect(formatFiles(mediaFiles)).toBe('8 images');
  });

  it('strips full paths to basenames', () => {
    expect(formatFiles(['/long/path/to/file.js'])).toBe('file.js');
  });
});

// ── smartSummary ───────────────────────────────────────

describe('smartSummary edge cases', () => {
  it('returns null for null/undefined activity', () => {
    expect(smartSummary(null)).toBeNull();
    expect(smartSummary(undefined)).toBeNull();
  });

  it('returns null when no summary', () => {
    expect(smartSummary({})).toBeNull();
    expect(smartSummary({ files: ['x.js'] })).toBeNull();
  });

  it('suppresses "editing X" summaries', () => {
    expect(smartSummary({ summary: 'Editing files', files: [] })).toBeNull();
    expect(smartSummary({ summary: 'editing src/app.js', files: [] })).toBeNull();
  });

  it('suppresses summaries that just name the single file', () => {
    expect(smartSummary({ summary: 'Working on app.js', files: ['src/app.js'] })).toBeNull();
  });

  it('keeps meaningful summaries', () => {
    expect(smartSummary({ summary: 'Refactoring auth', files: ['src/auth.js'] })).toBe(
      'Refactoring auth',
    );
  });

  it('keeps summaries when multiple files exist', () => {
    expect(smartSummary({ summary: 'app.js changes', files: ['src/app.js', 'src/b.js'] })).toBe(
      'app.js changes',
    );
  });
});

// ── shortAgentId ───────────────────────────────────────

describe('shortAgentId edge cases', () => {
  it('returns empty for null/undefined', () => {
    expect(shortAgentId(null)).toBe('');
    expect(shortAgentId(undefined)).toBe('');
    expect(shortAgentId('')).toBe('');
  });

  it('returns empty for IDs with fewer than 3 parts', () => {
    expect(shortAgentId('single')).toBe('');
    expect(shortAgentId('two:parts')).toBe('');
  });

  it('extracts first 4 chars of third segment', () => {
    expect(shortAgentId('claude-code:abc:12345678')).toBe('1234');
  });

  it('handles short third segment', () => {
    expect(shortAgentId('a:b:cd')).toBe('cd');
  });

  it('handles more than 3 segments', () => {
    expect(shortAgentId('a:b:cdef:extra')).toBe('cdef');
  });
});

// ── hasVisibleSessionActivity ──────────────────────────

describe('hasVisibleSessionActivity edge cases', () => {
  it('returns false for null/undefined', () => {
    expect(hasVisibleSessionActivity(null)).toBe(false);
    expect(hasVisibleSessionActivity(undefined)).toBe(false);
  });

  it('returns true for active session (no ended_at)', () => {
    expect(hasVisibleSessionActivity({ ended_at: null, edit_count: 0, files_touched: [] })).toBe(
      true,
    );
  });

  it('returns false for ended session with no activity', () => {
    expect(
      hasVisibleSessionActivity({
        ended_at: '2026-01-01T00:00:00Z',
        edit_count: 0,
        files_touched: [],
      }),
    ).toBe(false);
  });

  it('returns true for ended session with edits', () => {
    expect(
      hasVisibleSessionActivity({
        ended_at: '2026-01-01T00:00:00Z',
        edit_count: 1,
        files_touched: [],
      }),
    ).toBe(true);
  });

  it('returns true for ended session with files', () => {
    expect(
      hasVisibleSessionActivity({
        ended_at: '2026-01-01T00:00:00Z',
        edit_count: 0,
        files_touched: ['x.js'],
      }),
    ).toBe(true);
  });
});

// ── countLiveAgents ────────────────────────────────────

describe('countLiveAgents', () => {
  it('returns 0 for null/undefined', () => {
    expect(countLiveAgents(null)).toBe(0);
    expect(countLiveAgents(undefined)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(countLiveAgents([])).toBe(0);
  });

  it('counts running managed agents', () => {
    const agents = [
      { _managed: true, status: 'running' },
      { _managed: true, status: 'exited' },
      { _managed: true, status: 'failed' },
    ];
    expect(countLiveAgents(agents)).toBe(1);
  });

  it('counts active connected agents', () => {
    const agents = [
      { _managed: false, status: 'active' },
      { _managed: false, status: 'idle' },
    ];
    expect(countLiveAgents(agents)).toBe(1);
  });

  it('counts mixed managed and connected agents', () => {
    const agents = [
      { _managed: true, status: 'running' },
      { _managed: false, status: 'active' },
      { _managed: true, status: 'exited' },
    ];
    expect(countLiveAgents(agents)).toBe(2);
  });
});

// ── buildCombinedAgentRows ─────────────────────────────

describe('buildCombinedAgentRows', () => {
  const getToolName = createToolNameResolver([
    { id: 'claude-code', name: 'Claude Code' },
    { id: 'cursor', name: 'Cursor' },
  ]);

  it('handles empty inputs', () => {
    const rows = buildCombinedAgentRows({ getToolName });
    expect(rows).toEqual([]);
  });

  it('handles null inputs', () => {
    const rows = buildCombinedAgentRows({
      managedAgents: null,
      connectedAgents: null,
      getToolName,
    });
    expect(rows).toEqual([]);
  });

  it('returns managed-only agents when no connected agents exist', () => {
    const rows = buildCombinedAgentRows({
      managedAgents: [
        {
          id: 1,
          toolId: 'claude-code',
          toolName: 'Claude Code',
          cmd: 'claude',
          agentId: 'claude-code:abc:1234',
          status: 'running',
          startedAt: Date.now() - 60000,
          exitCode: null,
        },
      ],
      connectedAgents: [],
      getToolName,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]._managed).toBe(true);
    expect(rows[0]._connected).toBe(false);
    expect(rows[0]._display).toBe('Claude Code');
  });

  it('returns connected-only agents when no managed agents exist', () => {
    const rows = buildCombinedAgentRows({
      managedAgents: [],
      connectedAgents: [
        {
          agent_id: 'cursor:bbb:5555',
          handle: 'bob',
          host_tool: 'cursor',
          status: 'active',
          session_minutes: 15,
          activity: { files: ['src/app.js'], summary: 'Working on UI' },
        },
      ],
      getToolName,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]._managed).toBe(false);
    expect(rows[0]._connected).toBe(true);
    expect(rows[0]._display).toBe('Cursor');
    expect(rows[0]._duration).toBe('15 min');
  });

  it('merges managed and connected agents by agent_id', () => {
    const rows = buildCombinedAgentRows({
      managedAgents: [
        {
          id: 1,
          toolId: 'claude-code',
          toolName: 'Claude Code',
          cmd: 'claude',
          agentId: 'claude-code:abc:1234',
          status: 'running',
          startedAt: Date.now() - 300000,
          exitCode: null,
          task: 'My task',
        },
      ],
      connectedAgents: [
        {
          agent_id: 'claude-code:abc:1234',
          handle: 'alice',
          host_tool: 'claude-code',
          status: 'active',
          session_minutes: 5,
          activity: { summary: 'Refactoring auth', files: ['auth.js'] },
        },
      ],
      getToolName,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]._managed).toBe(true);
    expect(rows[0]._connected).toBe(true);
    expect(rows[0].handle).toBe('alice');
    expect(rows[0]._summary).toBe('Refactoring auth');
    expect(rows[0]._duration).toBe('5 min');
  });

  it('uses managed duration for exited agents even when connected data exists', () => {
    const now = Date.now();
    const rows = buildCombinedAgentRows({
      managedAgents: [
        {
          id: 1,
          toolId: 'claude-code',
          toolName: 'Claude Code',
          cmd: 'claude',
          agentId: 'claude-code:abc:1234',
          status: 'exited',
          startedAt: now - 180000,
          exitCode: 0,
          task: 'My task',
        },
      ],
      connectedAgents: [
        {
          agent_id: 'claude-code:abc:1234',
          handle: 'alice',
          host_tool: 'claude-code',
          status: 'active',
          session_minutes: 99,
          activity: { summary: 'Done', files: [] },
        },
      ],
      getToolName,
      now,
    });

    expect(rows).toHaveLength(1);
    // Exited agent should use managed duration, not connected session_minutes
    expect(rows[0]._duration).toBe('3 min');
    expect(rows[0]._dead).toBe(true);
  });

  it('marks failed agents correctly', () => {
    const rows = buildCombinedAgentRows({
      managedAgents: [
        {
          id: 1,
          toolId: 'claude-code',
          toolName: 'Claude Code',
          cmd: 'claude',
          status: 'failed',
          startedAt: Date.now(),
          exitCode: 1,
        },
      ],
      getToolName,
    });

    expect(rows[0]._dead).toBe(true);
    expect(rows[0]._failed).toBe(true);
    expect(rows[0]._exitCode).toBe(1);
  });

  it('marks non-zero exit code as failed even with exited status', () => {
    const rows = buildCombinedAgentRows({
      managedAgents: [
        {
          id: 1,
          toolId: 'claude-code',
          toolName: 'Claude Code',
          cmd: 'claude',
          status: 'exited',
          startedAt: Date.now(),
          exitCode: 137,
        },
      ],
      getToolName,
    });

    expect(rows[0]._dead).toBe(true);
    expect(rows[0]._failed).toBe(true);
    expect(rows[0]._exitCode).toBe(137);
  });

  it('uses toolId as display name when toolName is missing and tool not in resolver', () => {
    const rows = buildCombinedAgentRows({
      managedAgents: [
        {
          id: 1,
          toolId: 'custom',
          cmd: 'my-agent',
          status: 'running',
          startedAt: Date.now(),
          exitCode: null,
        },
      ],
      getToolName,
    });

    // Falls through to getToolName(toolId) which returns the raw id for unknown tools
    expect(rows[0]._display).toBe('custom');
  });

  it('falls back to "Unknown" for connected agents with unrecognized tool', () => {
    const rows = buildCombinedAgentRows({
      connectedAgents: [
        {
          agent_id: 'mystery:bbb:5555',
          handle: 'anon',
          host_tool: null,
          status: 'active',
          session_minutes: 1,
        },
      ],
      getToolName,
    });

    expect(rows[0]._display).toBe('Unknown');
  });
});

// ── buildDashboardView ─────────────────────────────────

describe('buildDashboardView', () => {
  it('handles empty context', () => {
    const view = buildDashboardView({});
    expect(view.activeAgents).toEqual([]);
    expect(view.conflicts).toEqual([]);
    expect(view.memories).toEqual([]);
    expect(view.messages).toEqual([]);
    expect(view.showRecent).toBe(false);
  });

  it('handles null context', () => {
    const view = buildDashboardView({ context: null });
    expect(view.activeAgents).toEqual([]);
    expect(view.conflicts).toEqual([]);
  });

  it('filters out dashboard and unknown tool agents', () => {
    const view = buildDashboardView({
      context: {
        members: [
          {
            agent_id: 'a',
            handle: 'u1',
            host_tool: 'claude-code',
            tool: 'claude-code',
            status: 'active',
            activity: {},
          },
          {
            agent_id: 'b',
            handle: 'u2',
            host_tool: 'dashboard',
            tool: 'dashboard',
            status: 'active',
            activity: {},
          },
          {
            agent_id: 'c',
            handle: 'u3',
            host_tool: 'unknown',
            tool: 'unknown',
            status: 'active',
            activity: {},
          },
          {
            agent_id: 'd',
            handle: 'u4',
            host_tool: null,
            tool: null,
            status: 'active',
            activity: {},
          },
        ],
      },
    });
    expect(view.activeAgents).toHaveLength(1);
    expect(view.activeAgents[0].tool).toBe('claude-code');
  });

  it('filters out non-active agents', () => {
    const view = buildDashboardView({
      context: {
        members: [
          {
            agent_id: 'a',
            handle: 'u1',
            host_tool: 'claude-code',
            tool: 'claude-code',
            status: 'active',
          },
          { agent_id: 'b', handle: 'u2', host_tool: 'cursor', tool: 'cursor', status: 'idle' },
        ],
      },
    });
    expect(view.activeAgents).toHaveLength(1);
  });

  it('detects file conflicts between different users', () => {
    const view = buildDashboardView({
      detectedTools: [
        { id: 'claude-code', name: 'Claude Code' },
        { id: 'cursor', name: 'Cursor' },
      ],
      context: {
        members: [
          {
            agent_id: 'a',
            handle: 'alice',
            host_tool: 'claude-code',
            tool: 'claude-code',
            status: 'active',
            activity: { files: ['shared.js', 'unique-a.js'] },
          },
          {
            agent_id: 'b',
            handle: 'bob',
            host_tool: 'cursor',
            tool: 'cursor',
            status: 'active',
            activity: { files: ['shared.js', 'unique-b.js'] },
          },
        ],
      },
    });
    expect(view.conflicts).toHaveLength(1);
    expect(view.conflicts[0][0]).toBe('shared.js');
    expect(view.conflicts[0][1]).toContain('alice (Claude Code)');
    expect(view.conflicts[0][1]).toContain('bob (Cursor)');
  });

  it('does not create conflicts for files owned by a single agent', () => {
    const view = buildDashboardView({
      context: {
        members: [
          {
            agent_id: 'a',
            handle: 'alice',
            host_tool: 'claude-code',
            tool: 'claude-code',
            status: 'active',
            activity: { files: ['a.js'] },
          },
          {
            agent_id: 'b',
            handle: 'bob',
            host_tool: 'cursor',
            tool: 'cursor',
            status: 'active',
            activity: { files: ['b.js'] },
          },
        ],
      },
    });
    expect(view.conflicts).toHaveLength(0);
  });

  it('filters memories by tag', () => {
    const view = buildDashboardView({
      memoryFilter: 'bug',
      context: {
        memories: [
          { id: '1', tags: ['bug'], text: 'Fix login' },
          { id: '2', tags: ['feature'], text: 'Add search' },
          { id: '3', tags: ['bug', 'urgent'], text: 'Fix crash' },
        ],
      },
    });
    expect(view.filteredMemories).toHaveLength(2);
    expect(view.filteredMemories.map((m) => m.id)).toEqual(['1', '3']);
  });

  it('searches memories by text content', () => {
    const view = buildDashboardView({
      memorySearch: 'auth',
      context: {
        memories: [
          { id: '1', tags: [], text: 'Refactor auth flow' },
          { id: '2', tags: ['auth-related'], text: 'Other item' },
          { id: '3', tags: [], text: 'Fix UI' },
        ],
      },
    });
    expect(view.filteredMemories).toHaveLength(2);
  });

  it('search takes precedence over filter', () => {
    const view = buildDashboardView({
      memoryFilter: 'bug',
      memorySearch: 'login',
      context: {
        memories: [
          { id: '1', tags: ['bug'], text: 'Fix login' },
          { id: '2', tags: ['feature'], text: 'login page' },
          { id: '3', tags: ['bug'], text: 'Fix crash' },
        ],
      },
    });
    // Search matches 'login' in text, ignoring the filter
    expect(view.filteredMemories).toHaveLength(2);
  });

  it('caps visible memories at MAX_MEMORIES', () => {
    const manyMemories = Array.from({ length: 15 }, (_, i) => ({
      id: `m${i}`,
      tags: [],
      text: `Memory ${i}`,
    }));
    const view = buildDashboardView({
      context: { memories: manyMemories },
    });
    expect(view.visibleMemories).toHaveLength(MAX_MEMORIES);
    expect(view.memoryOverflow).toBe(15 - MAX_MEMORIES);
  });

  it('reports zero overflow when memories fit', () => {
    const view = buildDashboardView({
      context: { memories: [{ id: '1', tags: [], text: 'Only one' }] },
    });
    expect(view.visibleMemories).toHaveLength(1);
    expect(view.memoryOverflow).toBe(1 - MAX_MEMORIES); // Negative means no overflow
  });

  it('shows recent sessions only when no active agents exist', () => {
    const view = buildDashboardView({
      context: {
        members: [],
        sessions: [{ ended_at: null, edit_count: 3, files_touched: ['a.js'] }],
      },
    });
    expect(view.showRecent).toBe(true);
  });

  it('hides recent sessions when active agents exist', () => {
    const view = buildDashboardView({
      context: {
        members: [
          {
            agent_id: 'a',
            handle: 'u',
            host_tool: 'claude-code',
            tool: 'claude-code',
            status: 'active',
          },
        ],
        sessions: [{ ended_at: null, edit_count: 3, files_touched: ['a.js'] }],
      },
    });
    expect(view.showRecent).toBe(false);
  });

  it('filters out invisible recent sessions', () => {
    const view = buildDashboardView({
      context: {
        members: [],
        sessions: [{ ended_at: '2026-01-01', edit_count: 0, files_touched: [] }],
      },
    });
    expect(view.showRecent).toBe(false);
  });

  it('calculates divider width based on cols', () => {
    const view = buildDashboardView({ cols: 100 });
    expect(view.dividerWidth).toBe(50); // capped at 50

    const narrowView = buildDashboardView({ cols: 40 });
    expect(narrowView.dividerWidth).toBe(36); // 40 - 4 = 36

    const defaultView = buildDashboardView({});
    expect(defaultView.dividerWidth).toBe(50); // defaults to 80, 80-4=76 capped at 50
  });

  it('computes isTeam when multiple unique handles are present', () => {
    const view = buildDashboardView({
      context: {
        members: [
          {
            agent_id: 'a',
            handle: 'alice',
            host_tool: 'claude-code',
            tool: 'claude-code',
            status: 'active',
          },
          { agent_id: 'b', handle: 'alice', host_tool: 'cursor', tool: 'cursor', status: 'active' },
        ],
      },
    });
    expect(view.isTeam).toBe(false);

    const teamView = buildDashboardView({
      context: {
        members: [
          {
            agent_id: 'a',
            handle: 'alice',
            host_tool: 'claude-code',
            tool: 'claude-code',
            status: 'active',
          },
          { agent_id: 'b', handle: 'bob', host_tool: 'cursor', tool: 'cursor', status: 'active' },
        ],
      },
    });
    expect(teamView.isTeam).toBe(true);
  });

  it('calculates tool counts', () => {
    const view = buildDashboardView({
      context: {
        members: [
          {
            agent_id: 'a1',
            handle: 'u',
            host_tool: 'claude-code',
            tool: 'claude-code',
            status: 'active',
          },
          {
            agent_id: 'a2',
            handle: 'u',
            host_tool: 'claude-code',
            tool: 'claude-code',
            status: 'active',
          },
          { agent_id: 'a3', handle: 'u', host_tool: 'cursor', tool: 'cursor', status: 'active' },
        ],
      },
    });
    expect(view.toolCounts.get('claude-code')).toBe(2);
    expect(view.toolCounts.get('cursor')).toBe(1);
  });
});
