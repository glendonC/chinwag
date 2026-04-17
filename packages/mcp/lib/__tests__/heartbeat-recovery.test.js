import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerTools } from '../tools/index.js';

vi.mock('../context.js', () => ({
  refreshContext: vi.fn().mockResolvedValue(null),
  teamPreamble: vi.fn().mockResolvedValue(''),
  offlinePrefix: vi.fn().mockReturnValue(''),
  getCachedContext: vi.fn().mockReturnValue(null),
  clearContextCache: vi.fn(),
}));

import {
  teamPreamble,
  refreshContext,
  clearContextCache as _clearContextCache,
} from '../context.js';

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
    resource() {},
    _tools: tools,
    async callTool(name, args = {}) {
      const t = tools.get(name);
      if (!t) throw new Error(`Tool not registered: ${name}`);
      return t.handler(args);
    },
  };
}

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
    reportModel: vi.fn().mockResolvedValue({ ok: true }),
    deleteMemoriesBatch: vi.fn().mockResolvedValue({ ok: true, deleted: 0 }),
  };
}

function createFakeIntegrationDoctor() {
  return {
    scanHostIntegrations: vi.fn().mockReturnValue([]),
    configureHostIntegration: vi.fn().mockReturnValue({ ok: true }),
  };
}

describe('heartbeat recovery', () => {
  let server, team, state, profile, integrationDoctor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    server = createFakeServer();
    team = createFakeTeam();
    integrationDoctor = createFakeIntegrationDoctor();
    state = {
      teamId: null,
      heartbeatInterval: null,
      heartbeatRecoveryTimeout: null,
      heartbeatDead: false,
      sessionId: null,
      teamJoinError: null,
      teamJoinComplete: null,
      shuttingDown: false,
      toolCalls: [],
    };
    profile = {
      framework: 'unknown',
      languages: ['javascript'],
      frameworks: [],
      tools: [],
      platforms: [],
    };
    teamPreamble.mockResolvedValue('');
    refreshContext.mockResolvedValue(null);
    registerTools(server, { team, state, profile, integrationDoctor });
  });

  afterEach(() => {
    if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
    if (state.heartbeatRecoveryTimeout) clearTimeout(state.heartbeatRecoveryTimeout);
    vi.useRealTimers();
  });

  // --- 403 -> rejoin -> heartbeat retry ---

  it('awaits rejoin on 403 and retries heartbeat', async () => {
    // Join team first
    await server.callTool('chinwag_join_team', { team_id: 't_hb1' });
    expect(state.teamId).toBe('t_hb1');

    // Set up heartbeat to fail with 403 on first call, then succeed
    const err403 = new Error('Forbidden');
    err403.status = 403;
    team.heartbeat
      .mockRejectedValueOnce(err403) // first heartbeat in interval -> 403
      .mockResolvedValue({ ok: true }); // rejoin's retry heartbeat + subsequent
    team.joinTeam.mockResolvedValue({ ok: true }); // rejoin succeeds

    // Trigger heartbeat interval
    await vi.advanceTimersByTimeAsync(30_000);

    // joinTeam should have been called again (rejoin)
    // First call was the initial join, second is the rejoin
    expect(team.joinTeam).toHaveBeenCalledTimes(2);
    // heartbeat: first call in interval (403), then retry after rejoin
    // Plus the initial heartbeat calls from setup
    expect(team.heartbeat.mock.calls.length).toBeGreaterThanOrEqual(2);

    // State should NOT be dead since rejoin succeeded
    expect(state.heartbeatDead).toBe(false);

    clearInterval(state.heartbeatInterval);
  });

  it('increments failure counter when rejoin fails on 403', async () => {
    await server.callTool('chinwag_join_team', { team_id: 't_hb2' });

    const err403 = new Error('Forbidden');
    err403.status = 403;
    team.heartbeat.mockRejectedValue(err403);
    // All rejoin attempts after the initial join will fail
    team.joinTeam.mockRejectedValue(new Error('Rejoin failed'));

    // Trigger enough heartbeats to exhaust MAX_HEARTBEAT_FAILURES (20)
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    expect(state.heartbeatDead).toBe(true);
    expect(state.heartbeatInterval).toBeNull();

    // Recovery timer should be set
    expect(state.heartbeatRecoveryTimeout).not.toBeNull();
    clearTimeout(state.heartbeatRecoveryTimeout);
  });

  // --- heartbeat death -> recovery timer -> successful recovery ---

  it('starts recovery timer after heartbeat death and recovers on success', async () => {
    await server.callTool('chinwag_join_team', { team_id: 't_hb3' });

    // Make all heartbeats fail to trigger death
    team.heartbeat.mockRejectedValue(new Error('Network error'));

    // Exhaust all 20 heartbeat failures
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    expect(state.heartbeatDead).toBe(true);
    expect(state.heartbeatInterval).toBeNull();
    expect(state.heartbeatRecoveryTimeout).not.toBeNull();

    // Now make heartbeat succeed for recovery
    team.heartbeat.mockResolvedValue({ ok: true });

    // Advance by recovery interval (5 minutes)
    await vi.advanceTimersByTimeAsync(300_000);

    // Recovery should have succeeded
    expect(state.heartbeatDead).toBe(false);
    expect(state.heartbeatInterval).not.toBeNull();
    expect(state.heartbeatRecoveryTimeout).toBeNull();

    clearInterval(state.heartbeatInterval);
  });

  it('retries recovery timer when recovery heartbeat fails', async () => {
    await server.callTool('chinwag_join_team', { team_id: 't_hb4' });

    // Fail all heartbeats to trigger death
    team.heartbeat.mockRejectedValue(new Error('Network error'));

    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    expect(state.heartbeatDead).toBe(true);

    // First recovery attempt fails at 5 min; backoff doubles next delay to 10 min.
    await vi.advanceTimersByTimeAsync(300_000);

    expect(state.heartbeatDead).toBe(true);
    expect(state.heartbeatRecoveryTimeout).not.toBeNull();

    // Now make recovery succeed on the second attempt, which fires at +10 min.
    team.heartbeat.mockResolvedValue({ ok: true });
    await vi.advanceTimersByTimeAsync(600_000);

    expect(state.heartbeatDead).toBe(false);
    expect(state.heartbeatInterval).not.toBeNull();

    clearInterval(state.heartbeatInterval);
  });

  it('applies exponential backoff and caps at 30 minutes', async () => {
    await server.callTool('chinwag_join_team', { team_id: 't_hb_backoff' });

    team.heartbeat.mockRejectedValue(new Error('Network error'));

    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(state.heartbeatDead).toBe(true);

    // 1st attempt at 5 min
    await vi.advanceTimersByTimeAsync(300_000);
    expect(state.heartbeatRecoveryTimeout).not.toBeNull();

    // 2nd attempt at +10 min (not +5)
    await vi.advanceTimersByTimeAsync(300_000);
    // timer still pending, would only fire at +600k
    expect(state.heartbeatRecoveryTimeout).not.toBeNull();
    await vi.advanceTimersByTimeAsync(300_000);
    // now fired; 3rd attempt scheduled at +20 min
    expect(state.heartbeatRecoveryTimeout).not.toBeNull();

    // 3rd attempt at +20 min
    await vi.advanceTimersByTimeAsync(1_200_000);
    // 4th attempt at +30 min (cap)
    await vi.advanceTimersByTimeAsync(1_800_000);
    // 5th also capped at 30 min
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(state.heartbeatRecoveryTimeout).not.toBeNull();

    clearTimeout(state.heartbeatRecoveryTimeout);
  });

  it('resets backoff to base delay after recovery succeeds', async () => {
    await server.callTool('chinwag_join_team', { team_id: 't_hb_reset' });

    team.heartbeat.mockRejectedValue(new Error('Network error'));

    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    // Fail 1st recovery, fail 2nd, succeed 3rd.
    await vi.advanceTimersByTimeAsync(300_000); // 1st fails
    await vi.advanceTimersByTimeAsync(600_000); // 2nd fails
    team.heartbeat.mockResolvedValue({ ok: true });
    await vi.advanceTimersByTimeAsync(1_200_000); // 3rd succeeds at +20 min
    expect(state.heartbeatDead).toBe(false);

    // Force another death cycle: the reset means the first recovery
    // after the new death fires at the base 5 min, not the previous capped delay.
    team.heartbeat.mockRejectedValue(new Error('Network error'));
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(state.heartbeatDead).toBe(true);

    // Advance just under 5 min — no recovery fires yet.
    await vi.advanceTimersByTimeAsync(299_000);
    expect(state.heartbeatRecoveryTimeout).not.toBeNull();

    // Advance to 5 min — first recovery fires (and fails, rescheduling at 10 min).
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.heartbeatRecoveryTimeout).not.toBeNull();

    clearTimeout(state.heartbeatRecoveryTimeout);
  });

  // --- tool response includes degraded warning when heartbeatDead ---

  it('tool response includes degraded warning when heartbeatDead is true', async () => {
    state.teamId = 't_hb5';
    state.heartbeatDead = true;

    refreshContext.mockResolvedValue({ members: [] });
    const result = await server.callTool('chinwag_get_team_context', {});

    // Should NOT be an isError (tools still work)
    expect(result.isError).not.toBe(true);

    // Should include degraded presence warning in the content
    const allText = result.content.map((c) => c.text).join('');
    expect(allText).toMatch(/Presence degraded/);
    expect(allText).toMatch(/heartbeat lost/);
  });

  it('chinwag_update_activity includes degraded warning when heartbeatDead', async () => {
    state.teamId = 't_hb6';
    state.heartbeatDead = true;

    const result = await server.callTool('chinwag_update_activity', {
      files: ['src/app.js'],
      summary: 'Testing',
    });

    expect(result.isError).not.toBe(true);
    const allText = result.content.map((c) => c.text).join('');
    expect(allText).toMatch(/Activity updated/);
    expect(allText).toMatch(/Presence degraded/);
  });

  it('chinwag_send_message includes degraded warning when heartbeatDead', async () => {
    state.teamId = 't_hb7';
    state.heartbeatDead = true;

    const result = await server.callTool('chinwag_send_message', {
      text: 'Hello team',
    });

    expect(result.isError).not.toBe(true);
    const allText = result.content.map((c) => c.text).join('');
    expect(allText).toMatch(/Message sent/);
    expect(allText).toMatch(/Presence degraded/);
  });

  it('tools work normally without warning when heartbeatDead is false', async () => {
    state.teamId = 't_hb8';
    state.heartbeatDead = false;

    refreshContext.mockResolvedValue({ members: [] });
    const result = await server.callTool('chinwag_get_team_context', {});

    const allText = result.content.map((c) => c.text).join('');
    expect(allText).not.toMatch(/Presence degraded/);
  });
});
