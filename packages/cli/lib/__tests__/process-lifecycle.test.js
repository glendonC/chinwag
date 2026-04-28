import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for process/registry.ts - the pure registry functions.
 *
 * We import from process-manager.js (the barrel) like the existing
 * process-manager.test.js does, but focus on uncovered paths:
 * - removeAgent with actually-dead processes
 * - cleanupCompletedEntries
 * - getOutput with content
 * - waitForExit for already-exited processes
 * - onUpdate callback error handling
 */

// Mock node-pty before importing
const mockPtyProcess = {
  onData: vi.fn(),
  onExit: vi.fn(),
  kill: vi.fn(),
  resize: vi.fn(),
  write: vi.fn(),
  pid: 12345,
};

vi.mock('module', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createRequire: () => (mod) => {
      if (mod === 'node-pty') {
        return {
          spawn: vi.fn(() => ({ ...mockPtyProcess })),
        };
      }
      return actual.createRequire(import.meta.url)(mod);
    },
  };
});

let pm;

beforeEach(async () => {
  vi.resetModules();
  pm = await import('../process-manager.js');
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('process registry - removeAgent', () => {
  it('returns false for non-existent process', () => {
    expect(pm.removeAgent(999999)).toBe(false);
  });

  it('returns false for running process', () => {
    const result = pm.spawnAgent({
      toolId: 'test',
      cmd: 'test',
      task: 'test task',
      cwd: '/repo',
    });
    expect(pm.removeAgent(result.id)).toBe(false);
  });

  it('successfully removes a registered external agent after marking exited', () => {
    // Register an external agent with a nonexistent PID
    const result = pm.registerExternalAgent({
      toolId: 'test',
      cmd: 'test',
      task: 'test task',
      cwd: '/repo',
      pid: 999999999,
    });

    // Check liveness to mark it as exited
    pm.checkExternalAgentLiveness();

    // Now it should be removable
    const agents = pm.getAgents();
    const agent = agents.find((a) => a.id === result.id);
    expect(agent.status).toBe('exited');

    const removed = pm.removeAgent(result.id);
    expect(removed).toBe(true);

    // Should no longer appear in getAgents()
    const afterRemove = pm.getAgents();
    expect(afterRemove.find((a) => a.id === result.id)).toBeUndefined();
  });
});

describe('process registry - getOutput', () => {
  it('returns empty array for non-existent process', () => {
    expect(pm.getOutput(999999)).toEqual([]);
  });

  it('returns output for spawned process', () => {
    const result = pm.spawnAgent({
      toolId: 'test',
      cmd: 'test',
      task: 'test task',
      cwd: '/repo',
    });
    // Output may be empty initially
    const output = pm.getOutput(result.id, 10);
    expect(Array.isArray(output)).toBe(true);
  });
});

describe('process registry - waitForExit', () => {
  it('resolves null for non-existent process', async () => {
    const result = await pm.waitForExit(999999);
    expect(result).toBeNull();
  });

  it('resolves for external agent after liveness check marks it dead', async () => {
    const result = pm.registerExternalAgent({
      toolId: 'test',
      cmd: 'test',
      task: 'test task',
      cwd: '/repo',
      pid: 999999999,
    });

    // The agent is "running" - waitForExit subscribes to updates
    const exitPromise = pm.waitForExit(result.id);

    // Mark it dead via liveness check
    pm.checkExternalAgentLiveness();

    const exitCode = await exitPromise;
    expect(exitCode).toBeNull();
  });
});

describe('process registry - onUpdate', () => {
  it('receives agent list on spawn', () => {
    const cb = vi.fn();
    const unsub = pm.onUpdate(cb);

    pm.spawnAgent({
      toolId: 'test',
      cmd: 'test',
      task: 'test',
      cwd: '/repo',
    });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Array);
    unsub();
  });

  it('does not fire after unsubscribe', () => {
    const cb = vi.fn();
    const unsub = pm.onUpdate(cb);
    unsub();

    pm.registerExternalAgent({
      toolId: 'test',
      cmd: 'test',
      task: 'test',
      cwd: '/repo',
    });

    expect(cb).not.toHaveBeenCalled();
  });

  it('swallows errors from callbacks', () => {
    const badCb = vi.fn(() => {
      throw new Error('boom');
    });
    const goodCb = vi.fn();

    const unsub1 = pm.onUpdate(badCb);
    const unsub2 = pm.onUpdate(goodCb);

    expect(() => {
      pm.registerExternalAgent({
        toolId: 'test',
        cmd: 'test',
        task: 'test',
        cwd: '/repo',
      });
    }).not.toThrow();

    expect(badCb).toHaveBeenCalled();
    expect(goodCb).toHaveBeenCalled();

    unsub1();
    unsub2();
  });
});

describe('process lifecycle - registerExternalAgent', () => {
  it('registers with all fields', () => {
    const result = pm.registerExternalAgent({
      toolId: 'claude-code',
      toolName: 'Claude Code',
      cmd: 'claude',
      args: ['--print'],
      taskArg: '--message',
      task: 'fix the bug',
      cwd: '/repo',
      agentId: 'claude-code:abc:def',
      pid: 54321,
    });

    expect(result.toolId).toBe('claude-code');
    expect(result.toolName).toBe('Claude Code');
    expect(result.task).toBe('fix the bug');
    expect(result.status).toBe('running');

    const agents = pm.getAgents();
    const agent = agents.find((a) => a.id === result.id);
    expect(agent.spawnType).toBe('external');
    expect(agent.agentId).toBe('claude-code:abc:def');
  });

  it('defaults toolName to toolId when not provided', () => {
    const result = pm.registerExternalAgent({
      toolId: 'aider',
      cmd: 'aider',
      task: 'refactor',
      cwd: '/repo',
    });
    expect(result.toolName).toBe('aider');
  });

  it('handles null agentId and pid', () => {
    const result = pm.registerExternalAgent({
      toolId: 'test',
      cmd: 'test',
      task: 'task',
      cwd: '/repo',
      agentId: null,
      pid: null,
    });
    expect(result.agentId).toBeNull();
  });
});

describe('process lifecycle - setExternalAgentPid', () => {
  it('updates PID for external agent', () => {
    const result = pm.registerExternalAgent({
      toolId: 'test',
      cmd: 'test',
      task: 'task',
      cwd: '/repo',
    });
    // Should not throw
    pm.setExternalAgentPid(result.id, 99999);
  });

  it('is a no-op for non-existent agent', () => {
    expect(() => pm.setExternalAgentPid(999999, 12345)).not.toThrow();
  });
});

describe('process lifecycle - resizePty', () => {
  it('does not throw for non-existent process', () => {
    expect(() => pm.resizePty(999999, 80, 24)).not.toThrow();
  });

  it('resizes a spawned pty process', () => {
    const result = pm.spawnAgent({
      toolId: 'test',
      cmd: 'test',
      task: 'task',
      cwd: '/repo',
    });
    // Should not throw
    expect(() => pm.resizePty(result.id, 120, 40)).not.toThrow();
  });
});

describe('process lifecycle - attachTerminal', () => {
  it('returns null for non-existent process', () => {
    expect(pm.attachTerminal(999999)).toBeNull();
  });
});

describe('process lifecycle - checkExternalAgentLiveness', () => {
  it('returns false when no external agents exist', () => {
    expect(pm.checkExternalAgentLiveness()).toBe(false);
  });

  it('skips external agents without a PID', () => {
    pm.registerExternalAgent({
      toolId: 'test',
      cmd: 'test',
      task: 'task',
      cwd: '/repo',
      pid: null,
    });
    expect(pm.checkExternalAgentLiveness()).toBe(false);
  });

  it('marks dead external agents as exited', () => {
    const result = pm.registerExternalAgent({
      toolId: 'test',
      cmd: 'test',
      task: 'task',
      cwd: '/repo',
      pid: 999999999,
    });

    const changed = pm.checkExternalAgentLiveness();
    expect(changed).toBe(true);

    const agents = pm.getAgents();
    const agent = agents.find((a) => a.id === result.id);
    expect(agent.status).toBe('exited');
  });

  it('leaves alive agents as running', () => {
    const result = pm.registerExternalAgent({
      toolId: 'test',
      cmd: 'test',
      task: 'task',
      cwd: '/repo',
      pid: process.pid,
    });

    const changed = pm.checkExternalAgentLiveness();
    expect(changed).toBe(false);

    const agents = pm.getAgents();
    const agent = agents.find((a) => a.id === result.id);
    expect(agent.status).toBe('running');
  });
});
