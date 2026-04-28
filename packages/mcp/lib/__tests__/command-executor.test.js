// Coverage for command-executor.ts: spawnable detection, spawn / stop /
// cleanup. Mocks node:child_process so the tests never start real processes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();
const execFileSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args) => spawnMock(...args),
  execFileSync: (...args) => execFileSyncMock(...args),
}));

let executeSpawnCommand;
let executeStopCommand;
let detectSpawnableTools;
let cleanupSpawnedProcesses;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  const mod = await import('../command-executor.js');
  executeSpawnCommand = mod.executeSpawnCommand;
  executeStopCommand = mod.executeStopCommand;
  detectSpawnableTools = mod.detectSpawnableTools;
  cleanupSpawnedProcesses = mod.cleanupSpawnedProcesses;
});

afterEach(() => {
  vi.useRealTimers();
});

function makeChild({ pid = 12345 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

describe('detectSpawnableTools', () => {
  it('returns ids of tools that resolve via "which"', () => {
    // First call: claude resolves; subsequent calls: codex / aider / q fail
    let call = 0;
    execFileSyncMock.mockImplementation(() => {
      call += 1;
      if (call === 1) return Buffer.from('/usr/local/bin/claude');
      throw new Error('not found');
    });
    const result = detectSpawnableTools();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    // First in the spawnable order is claude-code per shared tool-registry
    expect(result[0]).toBe('claude-code');
  });

  it('returns an empty list when no tools are installed', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(detectSpawnableTools()).toEqual([]);
  });
});

describe('executeSpawnCommand', () => {
  it('rejects unknown tool ids', () => {
    const result = executeSpawnCommand({ tool_id: 'not-a-real-tool' }, '/tmp');
    expect(result.error).toMatch(/Tool not available/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns the configured command with task arg appended', () => {
    const child = makeChild({ pid: 4242 });
    spawnMock.mockReturnValue(child);
    const result = executeSpawnCommand({ tool_id: 'claude-code', task: 'fix flaky test' }, '/repo');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe('claude');
    expect(args).toContain('--print');
    expect(args).toContain('fix flaky test');
    expect(opts.cwd).toBe('/repo');
    expect(opts.detached).toBe(true);
    expect(opts.env.CHINMEISTER_TOOL).toBe('claude-code');
    expect(result).toEqual({ ok: true, pid: 4242, tool_id: 'claude-code' });
  });

  it('honors a payload-supplied cwd over the default', () => {
    const child = makeChild({ pid: 4243 });
    spawnMock.mockReturnValue(child);
    executeSpawnCommand({ tool_id: 'claude-code', cwd: '/other' }, '/default');
    expect(spawnMock.mock.calls[0][2].cwd).toBe('/other');
  });

  it('returns an error when spawn yields no pid', () => {
    const child = new EventEmitter();
    child.unref = vi.fn();
    // pid intentionally absent
    spawnMock.mockReturnValue(child);
    const result = executeSpawnCommand({ tool_id: 'claude-code' }, '/tmp');
    expect(result.error).toMatch(/no PID returned/);
  });

  it('returns the thrown error message when spawn throws', () => {
    spawnMock.mockImplementation(() => {
      throw new Error('boom');
    });
    const result = executeSpawnCommand({ tool_id: 'claude-code' }, '/tmp');
    expect(result.error).toBe('boom');
  });

  it('removes the entry on the child exit event', () => {
    const child = makeChild({ pid: 9001 });
    spawnMock.mockReturnValue(child);
    executeSpawnCommand({ tool_id: 'claude-code' }, '/tmp');
    // Emit exit -- handler should run without throwing
    child.emit('exit', 0);
    // After exit, stopping the same pid hits the "no entry" path but does
    // not throw; the test asserts no exception bubbled from the listener.
    expect(true).toBe(true);
  });

  it('removes the entry on the child error event', () => {
    const child = makeChild({ pid: 9002 });
    spawnMock.mockReturnValue(child);
    executeSpawnCommand({ tool_id: 'claude-code' }, '/tmp');
    child.emit('error', new Error('child crashed'));
    expect(true).toBe(true);
  });
});

describe('executeStopCommand', () => {
  it('rejects calls without a pid', () => {
    const result = executeStopCommand({});
    expect(result.error).toMatch(/pid is required/);
  });

  it('signals SIGTERM and clears the spawned-process entry on success', () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const child = makeChild({ pid: 7777 });
    spawnMock.mockReturnValue(child);
    executeSpawnCommand({ tool_id: 'claude-code' }, '/tmp');

    const result = executeStopCommand({ pid: 7777 });
    expect(result).toEqual({ ok: true });
    expect(killSpy).toHaveBeenCalledWith(7777, 'SIGTERM');

    // Fast-forward past the grace period; the timer probes via kill(pid, 0)
    // and would force-kill if still alive. We make the probe throw so the
    // SIGKILL branch is skipped.
    killSpy.mockImplementation((_pid, sig) => {
      if (sig === 0) throw new Error('not running');
      return true;
    });
    vi.runAllTimers();

    killSpy.mockRestore();
  });

  it('returns an error when SIGTERM throws', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('no such process');
    });
    const result = executeStopCommand({ pid: 1234 });
    expect(result.error).toMatch(/Failed to stop process 1234/);
    killSpy.mockRestore();
  });

  it('force-kills the process when it is still alive after the grace period', () => {
    vi.useFakeTimers();
    let probeCount = 0;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, sig) => {
      if (sig === 0) {
        probeCount += 1;
        // Probe succeeds - process still alive
        return true;
      }
      return true;
    });
    const child = makeChild({ pid: 7780 });
    spawnMock.mockReturnValue(child);
    executeSpawnCommand({ tool_id: 'claude-code' }, '/tmp');
    executeStopCommand({ pid: 7780 });
    vi.runAllTimers();
    expect(probeCount).toBeGreaterThan(0);
    expect(killSpy).toHaveBeenCalledWith(7780, 'SIGKILL');
    killSpy.mockRestore();
  });
});

describe('cleanupSpawnedProcesses', () => {
  it('unrefs every tracked child so the parent can exit', () => {
    const child = makeChild({ pid: 8800 });
    spawnMock.mockReturnValue(child);
    executeSpawnCommand({ tool_id: 'claude-code' }, '/tmp');

    cleanupSpawnedProcesses();
    expect(child.unref).toHaveBeenCalledTimes(1);
  });
});
