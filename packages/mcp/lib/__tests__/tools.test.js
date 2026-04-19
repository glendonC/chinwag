import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the context module — all tool modules import from it.
vi.mock('../context.js', () => ({
  refreshContext: vi.fn().mockResolvedValue(null),
  teamPreamble: vi.fn().mockResolvedValue(''),
  offlinePrefix: vi.fn().mockReturnValue(''),
  getCachedContext: vi.fn().mockReturnValue(null),
  clearContextCache: vi.fn(),
}));

// Mock the session-registry import used by activity.js
vi.mock('@chinwag/shared/session-registry.js', () => ({
  setTerminalTitle: vi.fn(),
}));

import { refreshContext, teamPreamble, getCachedContext } from '../context.js';
import { registerConflictsTool } from '../tools/conflicts.js';
import { registerMemoryTools } from '../tools/memory.js';
import { registerLockTools } from '../tools/locks.js';
import { registerContextTool } from '../tools/context.js';
import { registerActivityTool } from '../tools/activity.js';
import { registerMessagingTool } from '../tools/messaging.js';

// --- Helpers ---

function createToolCollector() {
  const tools = new Map();
  const addTool = (name, opts, handler) => tools.set(name, { opts, handler });
  return {
    addTool,
    tools,
    callTool: async (name, args = {}) => {
      const t = tools.get(name);
      if (!t) throw new Error(`Tool not registered: ${name}`);
      return t.handler(args);
    },
  };
}

function createMockTeam() {
  return {
    joinTeam: vi.fn().mockResolvedValue({ ok: true }),
    leaveTeam: vi.fn().mockResolvedValue({ ok: true }),
    heartbeat: vi.fn().mockResolvedValue({ ok: true }),
    startSession: vi.fn().mockResolvedValue({ session_id: 'sess_123' }),
    endSession: vi.fn().mockResolvedValue({ ok: true }),
    updateActivity: vi.fn().mockResolvedValue({ ok: true }),
    checkConflicts: vi.fn().mockResolvedValue({ conflicts: [], locked: [] }),
    getTeamContext: vi.fn().mockResolvedValue({ members: [] }),
    saveMemory: vi.fn().mockResolvedValue({ ok: true }),
    updateMemory: vi.fn().mockResolvedValue({ ok: true }),
    searchMemories: vi.fn().mockResolvedValue({ memories: [] }),
    deleteMemory: vi.fn().mockResolvedValue({ ok: true }),
    claimFiles: vi.fn().mockResolvedValue({ claimed: [], blocked: [] }),
    releaseFiles: vi.fn().mockResolvedValue({ ok: true }),
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    reportModel: vi.fn().mockResolvedValue({ ok: true }),
    deleteMemoriesBatch: vi.fn().mockResolvedValue({ ok: true, deleted: 0 }),
  };
}

// =====================================================================
// conflicts.js
// =====================================================================

describe('conflicts tool (unit)', () => {
  let collector, team, state;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createToolCollector();
    team = createMockTeam();
    state = { teamId: 't_abc' };
    teamPreamble.mockResolvedValue('');
    getCachedContext.mockReturnValue(null);
    registerConflictsTool(collector.addTool, { team, state });
  });

  it('registers the chinwag_check_conflicts tool', () => {
    expect(collector.tools.has('chinwag_check_conflicts')).toBe(true);
  });

  it('returns conflicts when API reports them', async () => {
    team.checkConflicts.mockResolvedValue({
      conflicts: [
        {
          owner_handle: 'alice',
          tool: 'cursor',
          files: ['src/api.js'],
          summary: 'Adding endpoints',
        },
      ],
      locked: [],
    });
    const result = await collector.callTool('chinwag_check_conflicts', { files: ['src/api.js'] });
    expect(result.content[0].text).toMatch(/alice \(cursor\) is working on src\/api\.js/);
    expect(result.isError).toBeUndefined();
  });

  it('returns "no conflicts" when clean', async () => {
    team.checkConflicts.mockResolvedValue({ conflicts: [], locked: [] });
    const result = await collector.callTool('chinwag_check_conflicts', { files: ['clean.js'] });
    expect(result.content[0].text).toMatch(/No conflicts/);
  });

  it('handles offline gracefully using cached context', async () => {
    team.checkConflicts.mockRejectedValue(new Error('Network error'));
    getCachedContext.mockReturnValue({
      members: [
        {
          handle: 'bob',
          tool: 'vscode',
          status: 'active',
          activity: { files: ['shared.js'] },
        },
      ],
    });

    const result = await collector.callTool('chinwag_check_conflicts', { files: ['shared.js'] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/offline/);
    expect(result.content[0].text).toMatch(/bob \(vscode\) was working on shared\.js/);
  });

  it('returns generic offline message when no cached context available', async () => {
    team.checkConflicts.mockRejectedValue(new Error('Connection refused'));
    getCachedContext.mockReturnValue(null);

    const result = await collector.callTool('chinwag_check_conflicts', { files: ['a.js'] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/offline.*Could not reach chinwag/);
  });

  it('returns auth error on 401 instead of offline fallback', async () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    team.checkConflicts.mockRejectedValue(err);

    const result = await collector.callTool('chinwag_check_conflicts', { files: ['a.js'] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Authentication expired/);
  });

  it('normalizes file paths for offline comparison (strips ./ prefix)', async () => {
    team.checkConflicts.mockRejectedValue(new Error('offline'));
    getCachedContext.mockReturnValue({
      members: [
        {
          handle: 'eve',
          tool: 'aider',
          status: 'active',
          activity: { files: ['src/utils.js'] },
        },
      ],
    });

    // Request with ./ prefix should still match cached path without it
    const result = await collector.callTool('chinwag_check_conflicts', {
      files: ['./src/utils.js'],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/eve/);
  });

  it('normalizes paths with ../ segments for offline comparison', async () => {
    team.checkConflicts.mockRejectedValue(new Error('offline'));
    getCachedContext.mockReturnValue({
      members: [
        {
          handle: 'frank',
          tool: 'cursor',
          status: 'active',
          activity: { files: ['src/utils.js'] },
        },
      ],
    });

    // path.posix.normalize resolves ../ segments, so src/lib/../utils.js → src/utils.js → overlap
    const result = await collector.callTool('chinwag_check_conflicts', {
      files: ['src/lib/../utils.js'],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/frank/);
  });

  it('normalizes paths with duplicate slashes for offline comparison', async () => {
    team.checkConflicts.mockRejectedValue(new Error('offline'));
    getCachedContext.mockReturnValue({
      members: [
        {
          handle: 'grace',
          tool: 'windsurf',
          status: 'active',
          activity: { files: ['src/api.js'] },
        },
      ],
    });

    const result = await collector.callTool('chinwag_check_conflicts', { files: ['src//api.js'] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/grace/);
  });

  it('returns "not in a team" when teamId is null', async () => {
    state.teamId = null;
    const result = await collector.callTool('chinwag_check_conflicts', { files: ['a.js'] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in a team/i);
  });

  it('shows both conflicts and locked files together', async () => {
    team.checkConflicts.mockResolvedValue({
      conflicts: [
        {
          owner_handle: 'alice',
          tool: 'cursor',
          files: ['auth.js'],
          summary: 'Fixing login',
        },
      ],
      locked: [
        {
          file: 'db.js',
          held_by: 'bob',
          tool: 'unknown',
        },
      ],
    });
    const result = await collector.callTool('chinwag_check_conflicts', {
      files: ['auth.js', 'db.js'],
    });
    const text = result.content[0].text;
    expect(text).toMatch(/alice \(cursor\) is working on auth\.js/);
    expect(text).toMatch(/db\.js is locked by bob/);
  });

  it('prepends team preamble to response', async () => {
    teamPreamble.mockResolvedValue('[Team: alice: auth.js]\n\n');
    team.checkConflicts.mockResolvedValue({ conflicts: [], locked: [] });
    const result = await collector.callTool('chinwag_check_conflicts', { files: ['x.js'] });
    expect(result.content[0].text).toMatch(/^\[Team:/);
  });
});

// =====================================================================
// memory.js
// =====================================================================

describe('memory tools (unit)', () => {
  let collector, team, state;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createToolCollector();
    team = createMockTeam();
    state = { teamId: 't_mem' };
    teamPreamble.mockResolvedValue('');
    registerMemoryTools(collector.addTool, { team, state });
  });

  it('registers all 4 memory tools', () => {
    expect(collector.tools.has('chinwag_save_memory')).toBe(true);
    expect(collector.tools.has('chinwag_update_memory')).toBe(true);
    expect(collector.tools.has('chinwag_search_memory')).toBe(true);
    expect(collector.tools.has('chinwag_delete_memory')).toBe(true);
  });

  // --- save_memory ---

  describe('chinwag_save_memory', () => {
    it('calls API with correct arguments', async () => {
      await collector.callTool('chinwag_save_memory', {
        text: 'Use Redis for cache',
        tags: ['infra'],
      });
      expect(team.saveMemory).toHaveBeenCalledWith('t_mem', 'Use Redis for cache', ['infra']);
    });

    it('returns confirmation with tags', async () => {
      const result = await collector.callTool('chinwag_save_memory', {
        text: 'Port 6379',
        tags: ['config', 'redis'],
      });
      expect(result.content[0].text).toMatch(/Memory saved \[config, redis\]: Port 6379/);
    });

    it('saves memory without tags', async () => {
      const result = await collector.callTool('chinwag_save_memory', { text: 'Important fact' });
      expect(team.saveMemory).toHaveBeenCalledWith('t_mem', 'Important fact', undefined);
      expect(result.content[0].text).toMatch(/Memory saved: Important fact/);
      expect(result.content[0].text).not.toMatch(/\[/);
    });

    it('ignores error property in resolved value (handler does not check it)', async () => {
      team.saveMemory.mockResolvedValue({ error: 'Rate limit exceeded' });
      const result = await collector.callTool('chinwag_save_memory', { text: 'x' });
      // Handler does not inspect the resolved value — returns success
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toMatch(/Memory saved/);
    });

    it('returns error on API failure', async () => {
      team.saveMemory.mockRejectedValue(new Error('Rate limit exceeded'));
      const result = await collector.callTool('chinwag_save_memory', { text: 'x' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Rate limit exceeded');
    });

    it('returns auth error on 401', async () => {
      const err = new Error('Unauthorized');
      err.status = 401;
      team.saveMemory.mockRejectedValue(err);
      const result = await collector.callTool('chinwag_save_memory', { text: 'x' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Authentication expired/);
    });

    it('requires team membership', async () => {
      state.teamId = null;
      const result = await collector.callTool('chinwag_save_memory', { text: 'x' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/not in a team/i);
    });
  });

  // --- search_memory ---

  describe('chinwag_search_memory', () => {
    it('returns formatted results', async () => {
      team.searchMemories.mockResolvedValue({
        memories: [{ id: 'mem1', text: 'Use port 6379', tags: ['config'], handle: 'alice' }],
      });
      const result = await collector.callTool('chinwag_search_memory', { query: 'port' });
      expect(result.content[0].text).toMatch(/Use port 6379 \[config\].*mem1.*alice/);
    });

    it('returns "no memories" when none found', async () => {
      team.searchMemories.mockResolvedValue({ memories: [] });
      const result = await collector.callTool('chinwag_search_memory', { query: 'nonexistent' });
      expect(result.content[0].text).toMatch(/No memories found/);
    });

    it('passes query, tags, and limit to API', async () => {
      team.searchMemories.mockResolvedValue({ memories: [] });
      await collector.callTool('chinwag_search_memory', {
        query: 'redis',
        tags: ['config'],
        limit: 5,
      });
      expect(team.searchMemories).toHaveBeenCalledWith('t_mem', 'redis', ['config'], undefined, 5, {
        sessionId: undefined,
        agentId: undefined,
        handle: undefined,
        after: undefined,
        before: undefined,
      });
    });

    it('returns "no memories" when API returns error object (no .memories property)', async () => {
      team.searchMemories.mockResolvedValue({ error: 'Unauthorized' });
      const result = await collector.callTool('chinwag_search_memory', { query: 'x' });
      // Handler checks !result.memories — error object has no .memories, so "No memories found"
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toMatch(/No memories found/);
    });

    it('handles API error gracefully', async () => {
      team.searchMemories.mockRejectedValue(new Error('Server down'));
      const result = await collector.callTool('chinwag_search_memory', { query: 'x' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Server down');
    });

    it('works with empty parameters', async () => {
      team.searchMemories.mockResolvedValue({ memories: [] });
      await collector.callTool('chinwag_search_memory', {});
      // Search applies the resolved budget cap even when the agent omits `limit`,
      // so context stays bounded by team/user/runtime config. Default is 20.
      expect(team.searchMemories).toHaveBeenCalledWith(
        't_mem',
        undefined,
        undefined,
        undefined,
        20,
        {
          sessionId: undefined,
          agentId: undefined,
          handle: undefined,
          after: undefined,
          before: undefined,
        },
      );
    });
  });

  // --- update_memory ---

  describe('chinwag_update_memory', () => {
    it('updates text and tags', async () => {
      const result = await collector.callTool('chinwag_update_memory', {
        id: 'mem_123',
        text: 'Updated text',
        tags: ['decision'],
      });
      expect(team.updateMemory).toHaveBeenCalledWith('t_mem', 'mem_123', 'Updated text', [
        'decision',
      ]);
      expect(result.content[0].text).toMatch(/Memory mem_123 updated/);
      expect(result.content[0].text).toMatch(/text updated/);
      expect(result.content[0].text).toMatch(/tags/);
    });

    it('updates only tags', async () => {
      const result = await collector.callTool('chinwag_update_memory', {
        id: 'mem_456',
        tags: ['gotcha', 'redis'],
      });
      expect(result.content[0].text).toMatch(/tags/);
      expect(result.content[0].text).not.toMatch(/text updated/);
    });

    it('requires at least one of text or tags', async () => {
      const result = await collector.callTool('chinwag_update_memory', { id: 'mem_789' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Provide at least one of text or tags/);
    });

    it('returns error when API returns error object', async () => {
      team.updateMemory.mockResolvedValue({ error: 'Not found' });
      const result = await collector.callTool('chinwag_update_memory', {
        id: 'mem_nope',
        text: 'new',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Failed to update.*Not found/);
    });

    it('handles thrown exceptions', async () => {
      team.updateMemory.mockRejectedValue(new Error('Timeout'));
      const result = await collector.callTool('chinwag_update_memory', {
        id: 'mem_err',
        text: 'new',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Timeout');
    });
  });

  // --- delete_memory ---

  describe('chinwag_delete_memory', () => {
    it('calls API with correct ID', async () => {
      await collector.callTool('chinwag_delete_memory', { id: 'mem_del' });
      expect(team.deleteMemory).toHaveBeenCalledWith('t_mem', 'mem_del');
    });

    it('returns confirmation on success', async () => {
      team.deleteMemory.mockResolvedValue({ ok: true });
      const result = await collector.callTool('chinwag_delete_memory', { id: 'mem_abc' });
      expect(result.content[0].text).toMatch(/mem_abc deleted/);
    });

    it('returns error when API returns error object', async () => {
      team.deleteMemory.mockResolvedValue({ error: 'Not found' });
      const result = await collector.callTool('chinwag_delete_memory', { id: 'mem_nope' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Failed to delete.*Not found/);
    });

    it('handles thrown exceptions', async () => {
      team.deleteMemory.mockRejectedValue(new Error('Server error'));
      const result = await collector.callTool('chinwag_delete_memory', { id: 'mem_err' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Server error');
    });
  });
});

// =====================================================================
// locks.js
// =====================================================================

describe('lock tools (unit)', () => {
  let collector, team, state;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createToolCollector();
    team = createMockTeam();
    state = { teamId: 't_lock' };
    teamPreamble.mockResolvedValue('');
    registerLockTools(collector.addTool, { team, state });
  });

  it('registers both claim and release tools', () => {
    expect(collector.tools.has('chinwag_claim_files')).toBe(true);
    expect(collector.tools.has('chinwag_release_files')).toBe(true);
  });

  // --- claim_files ---

  describe('chinwag_claim_files', () => {
    it('calls API with teamId and files', async () => {
      team.claimFiles.mockResolvedValue({ claimed: ['auth.js'], blocked: [] });
      await collector.callTool('chinwag_claim_files', { files: ['auth.js'] });
      expect(team.claimFiles).toHaveBeenCalledWith('t_lock', ['auth.js']);
    });

    it('returns claimed files', async () => {
      team.claimFiles.mockResolvedValue({ claimed: ['auth.js', 'db.js'], blocked: [] });
      const result = await collector.callTool('chinwag_claim_files', {
        files: ['auth.js', 'db.js'],
      });
      expect(result.content[0].text).toMatch(/Claimed: auth\.js, db\.js/);
    });

    it('returns blocked files with holder info', async () => {
      team.claimFiles.mockResolvedValue({
        claimed: [],
        blocked: [{ file: 'locked.js', held_by: 'bob', tool: 'cursor' }],
      });
      const result = await collector.callTool('chinwag_claim_files', { files: ['locked.js'] });
      expect(result.content[0].text).toMatch(/Blocked: locked\.js.*held by bob \(cursor\)/);
    });

    it('omits tool label when tool is "unknown"', async () => {
      team.claimFiles.mockResolvedValue({
        claimed: [],
        blocked: [{ file: 'x.js', held_by: 'bob', tool: 'unknown' }],
      });
      const result = await collector.callTool('chinwag_claim_files', { files: ['x.js'] });
      const text = result.content[0].text;
      expect(text).toMatch(/held by bob/);
      expect(text).not.toMatch(/unknown/);
    });

    it('returns empty output when API returns error object (handler does not check it)', async () => {
      team.claimFiles.mockResolvedValue({ error: 'Too many locks' });
      const result = await collector.callTool('chinwag_claim_files', { files: ['a.js'] });
      // Handler checks result.claimed and result.blocked — both undefined on error object
      expect(result.isError).toBeUndefined();
    });

    it('handles API error', async () => {
      team.claimFiles.mockRejectedValue(new Error('Server error'));
      const result = await collector.callTool('chinwag_claim_files', { files: ['a.js'] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Server error');
    });

    it('requires team membership', async () => {
      state.teamId = null;
      const result = await collector.callTool('chinwag_claim_files', { files: ['a.js'] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/not in a team/i);
    });
  });

  // --- release_files ---

  describe('chinwag_release_files', () => {
    it('calls API with teamId and specific files', async () => {
      await collector.callTool('chinwag_release_files', { files: ['auth.js'] });
      expect(team.releaseFiles).toHaveBeenCalledWith('t_lock', ['auth.js']);
    });

    it('returns confirmation for specific files', async () => {
      const result = await collector.callTool('chinwag_release_files', {
        files: ['auth.js', 'db.js'],
      });
      expect(result.content[0].text).toMatch(/Released: auth\.js, db\.js/);
    });

    it('releases all locks when files is omitted', async () => {
      const result = await collector.callTool('chinwag_release_files', {});
      expect(team.releaseFiles).toHaveBeenCalledWith('t_lock', undefined);
      expect(result.content[0].text).toMatch(/All locks released/);
    });

    it('ignores error property in resolved value (handler does not check it)', async () => {
      team.releaseFiles.mockResolvedValue({ error: 'Not lock owner' });
      const result = await collector.callTool('chinwag_release_files', { files: ['a.js'] });
      // Handler does not inspect the resolved value — returns success
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toMatch(/Released: a\.js/);
    });

    it('handles API error', async () => {
      team.releaseFiles.mockRejectedValue(new Error('Timeout'));
      const result = await collector.callTool('chinwag_release_files', { files: ['a.js'] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Timeout');
    });

    it('requires team membership', async () => {
      state.teamId = null;
      const result = await collector.callTool('chinwag_release_files', { files: ['a.js'] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/not in a team/i);
    });
  });
});

// =====================================================================
// context.js
// =====================================================================

describe('context tool (unit)', () => {
  let collector, team, state;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createToolCollector();
    team = createMockTeam();
    state = { teamId: 't_ctx', modelReported: null, modelReportInflight: null };
    refreshContext.mockResolvedValue(null);
    registerContextTool(collector.addTool, { team, state });
  });

  it('registers the chinwag_get_team_context tool', () => {
    expect(collector.tools.has('chinwag_get_team_context')).toBe(true);
  });

  it('returns team context from API', async () => {
    refreshContext.mockResolvedValue({
      members: [
        {
          handle: 'alice',
          status: 'active',
          tool: 'cursor',
          activity: { files: ['auth.js'], summary: 'Fixing login' },
        },
      ],
    });
    const result = await collector.callTool('chinwag_get_team_context', {});
    const text = result.content[0].text;
    expect(text).toMatch(/alice \(active, cursor\): working on auth\.js/);
    expect(text).toMatch(/"Fixing login"/);
  });

  it('reports model on first call only', async () => {
    refreshContext.mockResolvedValue({ members: [] });

    // First call with model — should report
    await collector.callTool('chinwag_get_team_context', { model: 'claude-opus-4-6' });
    expect(team.reportModel).toHaveBeenCalledWith('t_ctx', 'claude-opus-4-6');
    // reportModelAsync is fire-and-forget; flush microtasks so the withTimeout
    // wrapper settles before checking state.
    await new Promise((r) => setTimeout(r, 10));
    expect(state.modelReported).toBe('claude-opus-4-6');

    team.reportModel.mockClear();

    // Second call with same model — should NOT report again
    await collector.callTool('chinwag_get_team_context', { model: 'claude-opus-4-6' });
    expect(team.reportModel).not.toHaveBeenCalled();
  });

  it('keeps modelReported null if reportModel fails', async () => {
    refreshContext.mockResolvedValue({ members: [] });
    team.reportModel.mockRejectedValue(new Error('network error'));

    await collector.callTool('chinwag_get_team_context', { model: 'gpt-4o' });

    // reportModel is fire-and-forget, but on rejection state is not set
    // Wait for the promise to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(state.modelReported).toBeNull();
  });

  it('handles offline/cached context (null)', async () => {
    refreshContext.mockResolvedValue(null);
    const result = await collector.callTool('chinwag_get_team_context', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No team context available/);
  });

  it('shows "no other agents" when members list is empty', async () => {
    refreshContext.mockResolvedValue({ members: [] });
    const result = await collector.callTool('chinwag_get_team_context', {});
    expect(result.content[0].text).toMatch(/No other agents connected/);
  });

  it('shows idle for agents without activity', async () => {
    refreshContext.mockResolvedValue({
      members: [{ handle: 'bob', status: 'active', tool: 'unknown' }],
    });
    const result = await collector.callTool('chinwag_get_team_context', {});
    expect(result.content[0].text).toMatch(/bob \(active\): idle/);
  });

  it('omits tool tag when tool is "unknown"', async () => {
    refreshContext.mockResolvedValue({
      members: [{ handle: 'bob', status: 'idle', tool: 'unknown' }],
    });
    const result = await collector.callTool('chinwag_get_team_context', {});
    expect(result.content[0].text).not.toMatch(/unknown/);
  });

  it('includes locks, messages, and memories sections', async () => {
    refreshContext.mockResolvedValue({
      members: [],
      locks: [{ file_path: 'auth.js', owner_handle: 'alice', tool: 'cursor', minutes_held: 5.8 }],
      messages: [{ from_handle: 'bob', from_tool: 'aider', text: 'Rebased' }],
      memories: [{ tags: ['setup'], text: 'Redis on port 6379' }],
    });
    const result = await collector.callTool('chinwag_get_team_context', {});
    const text = result.content[0].text;
    expect(text).toMatch(/Locked files:/);
    expect(text).toMatch(/auth\.js.*alice \(cursor\).*6m/);
    expect(text).toMatch(/Messages:/);
    expect(text).toMatch(/bob \(aider\): Rebased/);
    expect(text).toMatch(/Project knowledge:/);
    expect(text).toMatch(/Redis on port 6379 \[setup\]/);
  });

  it('requires team membership', async () => {
    state.teamId = null;
    const result = await collector.callTool('chinwag_get_team_context', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in a team/i);
  });
});

// =====================================================================
// activity.js
// =====================================================================

describe('activity tool (unit)', () => {
  let collector, team, state;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createToolCollector();
    team = createMockTeam();
    state = { teamId: 't_act' };
    teamPreamble.mockResolvedValue('');
    registerActivityTool(collector.addTool, { team, state });
  });

  it('registers the chinwag_update_activity tool', () => {
    expect(collector.tools.has('chinwag_update_activity')).toBe(true);
  });

  it('calls API with correct arguments', async () => {
    await collector.callTool('chinwag_update_activity', {
      files: ['src/auth.js', 'src/db.js'],
      summary: 'Refactoring auth',
    });
    expect(team.updateActivity).toHaveBeenCalledWith(
      't_act',
      ['src/auth.js', 'src/db.js'],
      'Refactoring auth',
    );
  });

  it('returns confirmation message', async () => {
    const result = await collector.callTool('chinwag_update_activity', {
      files: ['x.js'],
      summary: 'Testing',
    });
    expect(result.content[0].text).toMatch(/Activity updated: Testing/);
  });

  it('includes team preamble in response', async () => {
    teamPreamble.mockResolvedValue('[Team: alice: auth.js]\n\n');
    const result = await collector.callTool('chinwag_update_activity', {
      files: ['x.js'],
      summary: 'test',
    });
    expect(result.content[0].text).toMatch(/^\[Team:/);
  });

  it('ignores error property in resolved value (handler does not check it)', async () => {
    team.updateActivity.mockResolvedValue({ error: 'Invalid files' });
    const result = await collector.callTool('chinwag_update_activity', {
      files: ['x.js'],
      summary: 'test',
    });
    // Handler does not inspect the resolved value — returns success
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/Activity updated: test/);
  });

  it('handles API error', async () => {
    team.updateActivity.mockRejectedValue(new Error('Rate limited'));
    const result = await collector.callTool('chinwag_update_activity', {
      files: ['x.js'],
      summary: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Rate limited');
  });

  it('returns auth error on 401', async () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    team.updateActivity.mockRejectedValue(err);
    const result = await collector.callTool('chinwag_update_activity', {
      files: ['x.js'],
      summary: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Authentication expired/);
  });

  it('requires team membership', async () => {
    state.teamId = null;
    const result = await collector.callTool('chinwag_update_activity', {
      files: ['x.js'],
      summary: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in a team/i);
  });
});

// =====================================================================
// messaging.js
// =====================================================================

describe('messaging tool (unit)', () => {
  let collector, team, state;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createToolCollector();
    team = createMockTeam();
    state = { teamId: 't_msg' };
    registerMessagingTool(collector.addTool, { team, state });
  });

  it('registers the chinwag_send_message tool', () => {
    expect(collector.tools.has('chinwag_send_message')).toBe(true);
  });

  it('sends broadcast message correctly', async () => {
    const result = await collector.callTool('chinwag_send_message', { text: 'Heads up, rebasing' });
    expect(team.sendMessage).toHaveBeenCalledWith('t_msg', 'Heads up, rebasing', undefined);
    expect(result.content[0].text).toMatch(/Message sent to team: Heads up, rebasing/);
  });

  it('sends targeted message correctly', async () => {
    const result = await collector.callTool('chinwag_send_message', {
      text: 'Check your tests',
      target: 'cursor:abc123',
    });
    expect(team.sendMessage).toHaveBeenCalledWith('t_msg', 'Check your tests', 'cursor:abc123');
    expect(result.content[0].text).toMatch(/Message sent to cursor:abc123/);
  });

  it('ignores error property in resolved value (handler does not check it)', async () => {
    team.sendMessage.mockResolvedValue({ error: 'Message rejected' });
    const result = await collector.callTool('chinwag_send_message', { text: 'x' });
    // Handler does not inspect the resolved value — returns success
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/Message sent to team: x/);
  });

  it('handles API error', async () => {
    team.sendMessage.mockRejectedValue(new Error('Message too long'));
    const result = await collector.callTool('chinwag_send_message', { text: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Message too long');
  });

  it('returns auth error on 401', async () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    team.sendMessage.mockRejectedValue(err);
    const result = await collector.callTool('chinwag_send_message', { text: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Authentication expired/);
  });

  it('requires team membership', async () => {
    state.teamId = null;
    const result = await collector.callTool('chinwag_send_message', { text: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in a team/i);
  });
});
