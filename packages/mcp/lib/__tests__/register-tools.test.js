import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerTools } from '../tools/index.js';

// We need to mock the context module since tools/index imports from it.
vi.mock('../context.js', () => ({
  refreshContext: vi.fn().mockResolvedValue(null),
  teamPreamble: vi.fn().mockResolvedValue(''),
  offlinePrefix: vi.fn().mockReturnValue(''),
  getCachedContext: vi.fn().mockReturnValue(null),
  clearContextCache: vi.fn(),
}));

import { refreshContext, teamPreamble, getCachedContext, clearContextCache } from '../context.js';

// --- Fake MCP server that captures tool registrations ---

function createFakeServer() {
  const tools = new Map();

  return {
    tool(name, opts, handler) {
      tools.set(name, { opts, handler });
    },
    registerTool(name, opts, handler) {
      tools.set(name, { opts, handler });
    },
    resource() {}, // no-op for this test file
    _tools: tools,
    async callTool(name, args = {}) {
      const t = tools.get(name);
      if (!t) throw new Error(`Tool not registered: ${name}`);
      return t.handler(args);
    },
  };
}

// --- Fake team handlers ---

function createFakeTeam() {
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
    deleteMemoriesBatch: vi.fn().mockResolvedValue({ ok: true, deleted: 0 }),
  };
}

function createFakeIntegrationDoctor() {
  return {
    scanHostIntegrations: vi.fn().mockReturnValue([
      {
        id: 'cursor',
        name: 'Cursor',
        tier: 'connected',
        capabilities: ['mcp'],
        detected: true,
        status: 'needs_setup',
        configPath: '.cursor/mcp.json',
        issues: ['Missing or outdated config at .cursor/mcp.json'],
      },
      {
        id: 'claude-code',
        name: 'Claude Code',
        tier: 'managed',
        capabilities: ['mcp', 'hooks', 'channel', 'managed-process'],
        detected: true,
        status: 'ready',
        configPath: '.mcp.json',
        issues: [],
      },
    ]),
    configureHostIntegration: vi.fn().mockReturnValue({
      ok: true,
      name: 'Cursor',
      detail: '.cursor/mcp.json',
    }),
  };
}

describe('registerTools', () => {
  let server, team, state, profile, integrationDoctor;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createFakeServer();
    team = createFakeTeam();
    integrationDoctor = createFakeIntegrationDoctor();
    state = {
      teamId: 't_test123',
      heartbeatInterval: null,
      heartbeatRecoveryTimeout: null,
      sessionId: null,
      toolCalls: [],
    };
    profile = {
      framework: 'unknown',
      languages: ['javascript'],
      frameworks: ['react'],
      tools: ['vitest'],
      platforms: [],
    };
    teamPreamble.mockResolvedValue('');
    refreshContext.mockResolvedValue(null);
    getCachedContext.mockReturnValue(null);
    registerTools(server, { team, state, profile, integrationDoctor });
  });

  it('registers the full MCP tool surface', () => {
    // When the tool surface grows, add the new name to `expected` below so
    // this test keeps acting as a canary against accidental deregistration.
    // The count is derived so we fail loudly when someone adds a tool without
    // updating the expectation - don't hard-code the number.
    const expected = [
      'chinmeister_scan_integrations',
      'chinmeister_configure_integration',
      'chinmeister_join_team',
      'chinmeister_update_activity',
      'chinmeister_check_conflicts',
      'chinmeister_get_team_context',
      'chinmeister_save_memory',
      'chinmeister_update_memory',
      'chinmeister_search_memory',
      'chinmeister_delete_memory',
      'chinmeister_delete_memories_batch',
      'chinmeister_claim_files',
      'chinmeister_release_files',
      'chinmeister_send_message',
      'chinmeister_report_outcome',
      'chinmeister_report_commits',
      'chinmeister_record_tokens',
      'chinmeister_record_edit',
      'chinmeister_record_tool_call',
      'chinmeister_configure_budget',
      'chinmeister_apply_consolidation',
      'chinmeister_review_consolidation_proposals',
      'chinmeister_review_formation_observations',
      'chinmeister_run_formation_sweep',
      'chinmeister_unmerge_memory',
    ];
    expect(server._tools.size).toBe(expected.length);
    for (const name of expected) {
      expect(server._tools.has(name)).toBe(true);
    }
  });

  describe('integration doctor tools', () => {
    it('scans local integration health without requiring team membership', async () => {
      state.teamId = null;
      const result = await server.callTool('chinmeister_scan_integrations', {});
      expect(integrationDoctor.scanHostIntegrations).toHaveBeenCalledWith(process.cwd());
      expect(result.isError).not.toBe(true);
      expect(result.content[0].text).toMatch(/Cursor \[connected\] - needs_setup/);
    });

    it('configures a local integration and reports refreshed status', async () => {
      const result = await server.callTool('chinmeister_configure_integration', {
        host_id: 'cursor',
      });
      expect(integrationDoctor.configureHostIntegration).toHaveBeenCalledWith(
        process.cwd(),
        'cursor',
        { surfaceId: undefined },
      );
      expect(integrationDoctor.scanHostIntegrations).toHaveBeenCalledWith(process.cwd());
      expect(result.content[0].text).toMatch(/Configured Cursor: \.cursor\/mcp\.json/);
      expect(result.content[0].text).toMatch(/Status: needs_setup/);
    });

    it('returns an error when integration configuration fails', async () => {
      integrationDoctor.configureHostIntegration.mockReturnValueOnce({
        error: 'Unknown host integration: nope',
      });
      const result = await server.callTool('chinmeister_configure_integration', {
        host_id: 'nope',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Unknown host integration/);
    });
  });

  // --- Tools that require teamId ---

  describe('tools require team membership', () => {
    const toolsRequiringTeam = [
      'chinmeister_update_activity',
      'chinmeister_check_conflicts',
      'chinmeister_get_team_context',
      'chinmeister_save_memory',
      'chinmeister_update_memory',
      'chinmeister_search_memory',
      'chinmeister_delete_memory',
      'chinmeister_claim_files',
      'chinmeister_release_files',
      'chinmeister_send_message',
      'chinmeister_report_outcome',
    ];

    for (const toolName of toolsRequiringTeam) {
      it(`${toolName} returns error when not in a team`, async () => {
        state.teamId = null;
        const result = await server.callTool(toolName, {});
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/not in a team/i);
      });
    }
  });

  // --- chinmeister_join_team ---

  describe('chinmeister_join_team', () => {
    it('joins team, sets state, starts heartbeat and session', async () => {
      state.teamId = null;
      const result = await server.callTool('chinmeister_join_team', { team_id: 't_newteam' });

      expect(result.content[0].text).toMatch(/Joined team t_newteam/);
      expect(state.teamId).toBe('t_newteam');
      expect(state.sessionId).toBe('sess_123');
      expect(state.heartbeatInterval).not.toBeNull();
      expect(team.joinTeam).toHaveBeenCalledWith('t_newteam', expect.any(String));
      expect(team.startSession).toHaveBeenCalled();
      expect(clearContextCache).toHaveBeenCalled();

      // Clean up interval
      clearInterval(state.heartbeatInterval);
    });

    it('clears previous heartbeat interval before setting new one', async () => {
      const oldInterval = setInterval(() => {}, 100_000);
      state.heartbeatInterval = oldInterval;

      await server.callTool('chinmeister_join_team', { team_id: 't_new' });

      expect(state.heartbeatInterval).not.toBe(oldInterval);
      clearInterval(state.heartbeatInterval);
      clearInterval(oldInterval);
    });

    it('leaves the previous team when switching teams', async () => {
      state.teamId = 't_old';
      state.sessionId = 'sess_old';

      await server.callTool('chinmeister_join_team', { team_id: 't_new' });

      expect(team.endSession).toHaveBeenCalledWith('t_old', 'sess_old');
      expect(team.leaveTeam).toHaveBeenCalledWith('t_old');
    });

    it('returns auth error message on 401', async () => {
      const err = new Error('Unauthorized');
      err.status = 401;
      team.joinTeam.mockRejectedValue(err);

      const result = await server.callTool('chinmeister_join_team', { team_id: 't_bad' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Authentication expired/);
    });

    it('returns generic error message on non-401 errors', async () => {
      team.joinTeam.mockRejectedValue(new Error('Team not found'));

      const result = await server.callTool('chinmeister_join_team', { team_id: 't_nope' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Team not found');
    });

    it('still succeeds when startSession fails', async () => {
      team.startSession.mockRejectedValue(new Error('session error'));
      const result = await server.callTool('chinmeister_join_team', { team_id: 't_ok' });
      expect(result.content[0].text).toMatch(/session start failed/i);
      expect(state.sessionId).toBeNull();
      clearInterval(state.heartbeatInterval);
    });
  });

  // --- chinmeister_update_activity ---

  describe('chinmeister_update_activity', () => {
    it('updates activity and returns confirmation', async () => {
      const result = await server.callTool('chinmeister_update_activity', {
        files: ['src/auth.js'],
        summary: 'Refactoring auth',
      });
      expect(team.updateActivity).toHaveBeenCalledWith(
        't_test123',
        ['src/auth.js'],
        'Refactoring auth',
      );
      expect(result.content[0].text).toMatch(/Activity updated: Refactoring auth/);
    });

    it('includes team preamble in response', async () => {
      teamPreamble.mockResolvedValue('[Team: alice: auth.js]\n\n');
      const result = await server.callTool('chinmeister_update_activity', {
        files: ['x.js'],
        summary: 'test',
      });
      expect(result.content[0].text).toMatch(/^\[Team:/);
    });
  });

  // --- chinmeister_check_conflicts ---

  describe('chinmeister_check_conflicts', () => {
    it('returns "no conflicts" when none found', async () => {
      team.checkConflicts.mockResolvedValue({ conflicts: [], locked: [] });
      const result = await server.callTool('chinmeister_check_conflicts', { files: ['a.js'] });
      expect(result.content[0].text).toMatch(/No conflicts/);
    });

    it('returns conflict details when conflicts exist', async () => {
      team.checkConflicts.mockResolvedValue({
        conflicts: [
          {
            owner_handle: 'bob',
            tool: 'cursor',
            files: ['auth.js'],
            summary: 'Fixing login bug',
          },
        ],
        locked: [],
      });
      const result = await server.callTool('chinmeister_check_conflicts', { files: ['auth.js'] });
      expect(result.content[0].text).toMatch(/bob \(cursor\) is working on auth\.js/);
    });

    it('returns locked file details', async () => {
      team.checkConflicts.mockResolvedValue({
        conflicts: [],
        locked: [{ file: 'db.js', held_by: 'alice', tool: 'unknown' }],
      });
      const result = await server.callTool('chinmeister_check_conflicts', { files: ['db.js'] });
      expect(result.content[0].text).toMatch(/db\.js is locked by alice/);
    });

    it('omits tool label when tool is "unknown" in conflicts', async () => {
      team.checkConflicts.mockResolvedValue({
        conflicts: [
          {
            owner_handle: 'bob',
            tool: 'unknown',
            files: ['x.js'],
            summary: 'stuff',
          },
        ],
        locked: [],
      });
      const result = await server.callTool('chinmeister_check_conflicts', { files: ['x.js'] });
      const text = result.content[0].text;
      expect(text).toMatch(/bob is working on x\.js/);
      expect(text).not.toMatch(/unknown/);
    });

    it('uses cached context for offline fallback on non-401 errors', async () => {
      team.checkConflicts.mockRejectedValue(new Error('Network error'));
      getCachedContext.mockReturnValue({
        members: [
          {
            handle: 'bob',
            tool: 'cursor',
            status: 'active',
            activity: { files: ['shared.js'] },
          },
        ],
      });

      const result = await server.callTool('chinmeister_check_conflicts', { files: ['shared.js'] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/offline/);
      expect(result.content[0].text).toMatch(/bob \(cursor\) was working on shared\.js/);
    });

    it('returns generic offline message when no cached context', async () => {
      team.checkConflicts.mockRejectedValue(new Error('Network error'));
      getCachedContext.mockReturnValue(null);

      const result = await server.callTool('chinmeister_check_conflicts', { files: ['a.js'] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/offline.*Could not reach chinmeister/);
    });

    it('returns auth error on 401 instead of offline fallback', async () => {
      const err = new Error('Unauthorized');
      err.status = 401;
      team.checkConflicts.mockRejectedValue(err);

      const result = await server.callTool('chinmeister_check_conflicts', { files: ['a.js'] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Authentication expired/);
    });

    it('offline fallback with no overlapping files returns safe message', async () => {
      team.checkConflicts.mockRejectedValue(new Error('offline'));
      getCachedContext.mockReturnValue({
        members: [
          {
            handle: 'bob',
            status: 'active',
            activity: { files: ['other.js'] },
          },
        ],
      });

      const result = await server.callTool('chinmeister_check_conflicts', {
        files: ['different.js'],
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toMatch(/No overlapping files were found in cache/);
    });
  });

  // --- chinmeister_get_team_context ---

  describe('chinmeister_get_team_context', () => {
    it('returns "no agents" when members list is empty', async () => {
      refreshContext.mockResolvedValue({ members: [] });
      const result = await server.callTool('chinmeister_get_team_context');
      expect(result.content[0].text).toMatch(/No other agents connected/);
    });

    it('returns "no context" error when API unreachable and no cache', async () => {
      refreshContext.mockResolvedValue(null);
      const result = await server.callTool('chinmeister_get_team_context');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/No team context available/);
    });

    it('formats members with activity', async () => {
      refreshContext.mockResolvedValue({
        members: [
          {
            handle: 'alice',
            status: 'active',
            tool: 'cursor',
            activity: {
              files: ['auth.js', 'db.js'],
              summary: 'Fixing auth',
            },
          },
        ],
      });
      const result = await server.callTool('chinmeister_get_team_context');
      const text = result.content[0].text;
      expect(text).toMatch(/alice \(active, cursor\): working on auth\.js, db\.js/);
      expect(text).toMatch(/"Fixing auth"/);
    });

    it('shows idle for agents without activity', async () => {
      refreshContext.mockResolvedValue({
        members: [{ handle: 'bob', status: 'active', tool: 'unknown' }],
      });
      const result = await server.callTool('chinmeister_get_team_context');
      expect(result.content[0].text).toMatch(/bob \(active\): idle/);
    });

    it('includes locks section when present', async () => {
      refreshContext.mockResolvedValue({
        members: [],
        locks: [{ file_path: 'auth.js', owner_handle: 'alice', tool: 'cursor', minutes_held: 5.2 }],
      });
      const result = await server.callTool('chinmeister_get_team_context');
      const text = result.content[0].text;
      expect(text).toMatch(/Locked files:/);
      expect(text).toMatch(/auth\.js.*alice \(cursor\).*5m/);
    });

    it('includes messages section when present', async () => {
      refreshContext.mockResolvedValue({
        members: [],
        messages: [{ from_handle: 'bob', from_tool: 'aider', text: 'Rebased, please pull' }],
      });
      const result = await server.callTool('chinmeister_get_team_context');
      const text = result.content[0].text;
      expect(text).toMatch(/Messages:/);
      expect(text).toMatch(/bob \(aider\): Rebased, please pull/);
    });

    it('includes memories section when present', async () => {
      refreshContext.mockResolvedValue({
        members: [],
        memories: [{ tags: ['gotcha'], text: 'Redis required on port 6379' }],
      });
      const result = await server.callTool('chinmeister_get_team_context');
      const text = result.content[0].text;
      expect(text).toMatch(/Project knowledge:/);
      expect(text).toMatch(/Redis required on port 6379 \[gotcha\]/);
    });

    it('omits tool info when tool is "unknown"', async () => {
      refreshContext.mockResolvedValue({
        members: [{ handle: 'bob', status: 'idle', tool: 'unknown' }],
      });
      const result = await server.callTool('chinmeister_get_team_context');
      expect(result.content[0].text).toMatch(/bob \(idle\)/);
      expect(result.content[0].text).not.toMatch(/unknown/);
    });
  });

  // --- chinmeister_save_memory ---

  describe('chinmeister_save_memory', () => {
    it('saves memory and returns confirmation', async () => {
      const result = await server.callTool('chinmeister_save_memory', {
        text: 'Tests need Redis',
        tags: ['config', 'redis'],
      });
      expect(team.saveMemory).toHaveBeenCalledWith('t_test123', 'Tests need Redis', [
        'config',
        'redis',
      ]);
      expect(result.content[0].text).toMatch(/Memory saved \[config, redis\]: Tests need Redis/);
    });

    it('saves memory without tags', async () => {
      const result = await server.callTool('chinmeister_save_memory', {
        text: 'Important fact',
      });
      expect(team.saveMemory).toHaveBeenCalledWith('t_test123', 'Important fact', undefined);
      expect(result.content[0].text).toMatch(/Memory saved: Important fact/);
    });

    it('returns error on failure', async () => {
      team.saveMemory.mockRejectedValue(new Error('Rate limit exceeded'));
      const result = await server.callTool('chinmeister_save_memory', {
        text: 'test',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Rate limit exceeded');
    });
  });

  // --- chinmeister_search_memory ---

  describe('chinmeister_update_memory', () => {
    it('updates memory text and tags', async () => {
      const result = await server.callTool('chinmeister_update_memory', {
        id: 'mem_123',
        text: 'Updated memory',
        tags: ['decision', 'api'],
      });
      expect(team.updateMemory).toHaveBeenCalledWith('t_test123', 'mem_123', 'Updated memory', [
        'decision',
        'api',
      ]);
      expect(result.content[0].text).toMatch(/Memory mem_123 updated/);
    });
  });

  describe('chinmeister_search_memory', () => {
    it('returns formatted results when memories found', async () => {
      team.searchMemories.mockResolvedValue({
        memories: [
          { id: 'mem1', text: 'Use port 6379', tags: ['config'], handle: 'alice' },
          { id: 'mem2', text: 'No console.log in MCP', tags: ['gotcha'], handle: 'bob' },
        ],
      });
      const result = await server.callTool('chinmeister_search_memory', { query: 'port' });
      const text = result.content[0].text;
      expect(text).toMatch(/Use port 6379 \[config\].*mem1.*alice/);
      expect(text).toMatch(/No console\.log in MCP \[gotcha\].*mem2.*bob/);
    });

    it('returns "no memories" when none found', async () => {
      team.searchMemories.mockResolvedValue({ memories: [] });
      const result = await server.callTool('chinmeister_search_memory', { query: 'nonexistent' });
      expect(result.content[0].text).toMatch(/No memories found/);
    });

    it('passes query, tags, and limit to handler', async () => {
      team.searchMemories.mockResolvedValue({ memories: [] });
      await server.callTool('chinmeister_search_memory', {
        query: 'redis',
        tags: ['config'],
        limit: 5,
      });
      expect(team.searchMemories).toHaveBeenCalledWith(
        't_test123',
        'redis',
        ['config'],
        undefined,
        5,
        expect.any(Object),
      );
    });

    it('works with no parameters (empty search)', async () => {
      team.searchMemories.mockResolvedValue({ memories: [] });
      await server.callTool('chinmeister_search_memory', {});
      // Search applies the resolved budget cap even when the agent omits `limit`,
      // so context stays bounded by team/user/runtime config. Default is 20.
      expect(team.searchMemories).toHaveBeenCalledWith(
        't_test123',
        undefined,
        undefined,
        undefined,
        20,
        expect.any(Object),
      );
    });
  });

  // --- chinmeister_delete_memory ---

  describe('chinmeister_delete_memory', () => {
    it('deletes memory and confirms', async () => {
      team.deleteMemory.mockResolvedValue({ ok: true });
      const result = await server.callTool('chinmeister_delete_memory', { id: 'mem_abc' });
      expect(result.content[0].text).toMatch(/mem_abc deleted/);
    });

    it('returns error when deleteMemory returns an error', async () => {
      team.deleteMemory.mockResolvedValue({ error: 'Not found' });
      const result = await server.callTool('chinmeister_delete_memory', { id: 'mem_nope' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Failed to delete.*Not found/);
    });

    it('returns error on thrown exception', async () => {
      team.deleteMemory.mockRejectedValue(new Error('Server error'));
      const result = await server.callTool('chinmeister_delete_memory', { id: 'mem_err' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Server error');
    });
  });

  // --- chinmeister_claim_files ---

  describe('chinmeister_claim_files', () => {
    it('returns claimed files', async () => {
      team.claimFiles.mockResolvedValue({ claimed: ['auth.js', 'db.js'], blocked: [] });
      const result = await server.callTool('chinmeister_claim_files', {
        files: ['auth.js', 'db.js'],
      });
      expect(result.content[0].text).toMatch(/Claimed: auth\.js, db\.js/);
    });

    it('returns blocked files with holder info', async () => {
      team.claimFiles.mockResolvedValue({
        claimed: [],
        blocked: [{ file: 'locked.js', held_by: 'bob', tool: 'cursor' }],
      });
      const result = await server.callTool('chinmeister_claim_files', { files: ['locked.js'] });
      expect(result.content[0].text).toMatch(/Blocked: locked\.js.*held by bob \(cursor\)/);
    });

    it('omits tool label when tool is "unknown" in blocked files', async () => {
      team.claimFiles.mockResolvedValue({
        claimed: [],
        blocked: [{ file: 'locked.js', held_by: 'bob', tool: 'unknown' }],
      });
      const result = await server.callTool('chinmeister_claim_files', { files: ['locked.js'] });
      const text = result.content[0].text;
      expect(text).toMatch(/held by bob/);
      expect(text).not.toMatch(/unknown/);
    });

    it('returns both claimed and blocked together', async () => {
      team.claimFiles.mockResolvedValue({
        claimed: ['free.js'],
        blocked: [{ file: 'taken.js', held_by: 'alice', tool: 'aider' }],
      });
      const result = await server.callTool('chinmeister_claim_files', {
        files: ['free.js', 'taken.js'],
      });
      const text = result.content[0].text;
      expect(text).toMatch(/Claimed: free\.js/);
      expect(text).toMatch(/Blocked: taken\.js/);
    });
  });

  // --- chinmeister_release_files ---

  describe('chinmeister_release_files', () => {
    it('releases specific files', async () => {
      const result = await server.callTool('chinmeister_release_files', { files: ['auth.js'] });
      expect(team.releaseFiles).toHaveBeenCalledWith('t_test123', ['auth.js']);
      expect(result.content[0].text).toMatch(/Released: auth\.js/);
    });

    it('releases all locks when files is omitted', async () => {
      const result = await server.callTool('chinmeister_release_files', {});
      expect(team.releaseFiles).toHaveBeenCalledWith('t_test123', undefined);
      expect(result.content[0].text).toMatch(/All locks released/);
    });
  });

  // --- chinmeister_send_message ---

  describe('chinmeister_send_message', () => {
    it('sends broadcast message', async () => {
      const result = await server.callTool('chinmeister_send_message', { text: 'Rebasing now' });
      expect(team.sendMessage).toHaveBeenCalledWith('t_test123', 'Rebasing now', undefined);
      expect(result.content[0].text).toMatch(/Message sent to team: Rebasing now/);
    });

    it('sends targeted message', async () => {
      const result = await server.callTool('chinmeister_send_message', {
        text: 'Check your tests',
        target: 'cursor:abc123',
      });
      expect(team.sendMessage).toHaveBeenCalledWith(
        't_test123',
        'Check your tests',
        'cursor:abc123',
      );
      expect(result.content[0].text).toMatch(/Message sent to cursor:abc123/);
    });

    it('returns error on failure', async () => {
      team.sendMessage.mockRejectedValue(new Error('Message too long'));
      const result = await server.callTool('chinmeister_send_message', { text: 'x' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Message too long');
    });
  });
});
