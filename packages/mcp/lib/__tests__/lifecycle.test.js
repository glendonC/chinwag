import { describe, expect, it, vi } from 'vitest';
import {
  cleanupProcessSession,
  registerProcessSession,
  resolveAgentIdentity,
} from '../lifecycle.js';

describe('resolveAgentIdentity', () => {
  it('uses an explicitly configured agent id when present', () => {
    const identity = resolveAgentIdentity('tok_123', 'claude-code', {
      configuredAgentId: 'claude-code:abc123:def45678',
    });

    expect(identity).toMatchObject({
      agentId: 'claude-code:abc123:def45678',
      hasExactSession: true,
    });
  });

  it('falls back to the deterministic base id when no exact session exists', () => {
    const identity = resolveAgentIdentity('tok_123', 'claude-code', {
      resolveSessionAgentIdFn: ({ fallbackAgentId }) => fallbackAgentId,
    });

    expect(identity).toMatchObject({
      fallbackAgentId: expect.stringMatching(/^claude-code:[0-9a-f]{12}$/),
      hasExactSession: false,
    });
    expect(identity.agentId).toBe(identity.fallbackAgentId);
  });

  it('reports an exact session when the registry resolves one', () => {
    const identity = resolveAgentIdentity('tok_123', 'claude-code', {
      resolveSessionAgentIdFn: ({ fallbackAgentId }) => `${fallbackAgentId}:deadbeef`,
    });

    expect(identity.fallbackAgentId).toMatch(/^claude-code:[0-9a-f]{12}$/);
    expect(identity.agentId).toBe(`${identity.fallbackAgentId}:deadbeef`);
    expect(identity.hasExactSession).toBe(true);
  });
});

describe('registerProcessSession', () => {
  it('writes a session record with process metadata', () => {
    const writeSessionRecordFn = vi.fn();
    const { tty, record } = registerProcessSession('cursor:abc123:def456', 'cursor', {
      tty: '/dev/ttys001',
      pid: 4321,
      cwd: '/repo',
      createdAt: 123,
      commandMarker: 'chinwag-mcp',
      homeDir: '/tmp/home',
      writeSessionRecordFn,
    });

    expect(tty).toBe('/dev/ttys001');
    expect(record).toMatchObject({
      tty: '/dev/ttys001',
      tool: 'cursor',
      pid: 4321,
      cwd: '/repo',
      createdAt: 123,
      commandMarker: 'chinwag-mcp',
    });
    expect(writeSessionRecordFn).toHaveBeenCalledWith('cursor:abc123:def456', record, {
      homeDir: '/tmp/home',
    });
  });

  it('looks up the parent tty when one is not provided', () => {
    const getCurrentTtyPathFn = vi.fn().mockReturnValue('/dev/ttys009');
    const writeSessionRecordFn = vi.fn();

    const result = registerProcessSession('cursor:abc123:def456', 'cursor', {
      cwd: '/repo',
      pid: 999,
      createdAt: 1,
      getCurrentTtyPathFn,
      writeSessionRecordFn,
    });

    expect(getCurrentTtyPathFn).toHaveBeenCalled();
    expect(result.tty).toBe('/dev/ttys009');
  });
});

describe('cleanupProcessSession', () => {
  it('deletes the session record, clears heartbeat, ends the session, and leaves the team', async () => {
    const team = {
      endSession: vi.fn().mockResolvedValue({ ok: true }),
      leaveTeam: vi.fn().mockResolvedValue({ ok: true }),
      recordToolCalls: vi.fn().mockResolvedValue({ ok: true }),
    };
    const clearIntervalFn = vi.fn();
    const deleteRecord = vi.fn();
    const heartbeat = Symbol('heartbeat');

    await cleanupProcessSession(
      'cursor:abc123:def456',
      {
        heartbeatInterval: heartbeat,
        sessionId: 'sess_1',
        teamId: 't_team',
        toolCalls: [],
      },
      team,
      {
        clearIntervalFn,
        deleteRecord,
      },
    );

    expect(deleteRecord).toHaveBeenCalledWith('cursor:abc123:def456', {});
    expect(clearIntervalFn).toHaveBeenCalledWith(heartbeat);
    expect(team.endSession).toHaveBeenCalledWith('t_team', 'sess_1');
    expect(team.leaveTeam).toHaveBeenCalledWith('t_team');
  });

  it('still leaves the team when no session is active', async () => {
    const team = {
      endSession: vi.fn(),
      leaveTeam: vi.fn().mockResolvedValue({ ok: true }),
    };

    await cleanupProcessSession(
      'cursor:abc123:def456',
      {
        heartbeatInterval: null,
        sessionId: null,
        teamId: 't_team',
        toolCalls: [],
      },
      team,
      {
        deleteRecord: vi.fn(),
      },
    );

    expect(team.endSession).not.toHaveBeenCalled();
    expect(team.leaveTeam).toHaveBeenCalledWith('t_team');
  });

  it('writes a completion record so the dashboard can pick up sessionId', async () => {
    const team = {
      endSession: vi.fn().mockResolvedValue({ ok: true }),
      leaveTeam: vi.fn().mockResolvedValue({ ok: true }),
      recordToolCalls: vi.fn().mockResolvedValue({ ok: true }),
    };
    const writeCompleted = vi.fn();

    await cleanupProcessSession(
      'agent-abc',
      {
        heartbeatInterval: null,
        sessionId: 'sess_42',
        teamId: 't_team',
        toolCalls: [],
      },
      team,
      {
        deleteRecord: vi.fn(),
        writeCompleted,
        toolId: 'claude-code',
        startedAt: 1000,
      },
    );

    expect(writeCompleted).toHaveBeenCalledTimes(1);
    const [record, opts] = writeCompleted.mock.calls[0];
    expect(record).toMatchObject({
      agentId: 'agent-abc',
      sessionId: 'sess_42',
      teamId: 't_team',
      toolId: 'claude-code',
      startedAt: 1000,
    });
    expect(typeof record.completedAt).toBe('number');
    expect(opts).toEqual({});
  });

  it('does not write completion record when sessionId is missing', async () => {
    const team = {
      endSession: vi.fn(),
      leaveTeam: vi.fn().mockResolvedValue({ ok: true }),
    };
    const writeCompleted = vi.fn();

    await cleanupProcessSession(
      'agent-abc',
      {
        heartbeatInterval: null,
        sessionId: null,
        teamId: 't_team',
        toolCalls: [],
      },
      team,
      {
        deleteRecord: vi.fn(),
        writeCompleted,
        toolId: 'claude-code',
      },
    );

    expect(writeCompleted).not.toHaveBeenCalled();
  });

  it('does not write completion record when toolId is unknown', async () => {
    const team = {
      endSession: vi.fn().mockResolvedValue({ ok: true }),
      leaveTeam: vi.fn().mockResolvedValue({ ok: true }),
      recordToolCalls: vi.fn().mockResolvedValue({ ok: true }),
    };
    const writeCompleted = vi.fn();

    await cleanupProcessSession(
      'agent-abc',
      {
        heartbeatInterval: null,
        sessionId: 'sess_42',
        teamId: 't_team',
        toolCalls: [],
      },
      team,
      {
        deleteRecord: vi.fn(),
        writeCompleted,
      },
    );

    expect(writeCompleted).not.toHaveBeenCalled();
  });
});
