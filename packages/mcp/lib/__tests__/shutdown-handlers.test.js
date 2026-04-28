import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setupShutdownHandlers,
  FORCE_EXIT_TIMEOUT_MS,
  PARENT_WATCH_INTERVAL_MS,
} from '../lifecycle.js';

// Mock isProcessAlive since it's used by the parent watcher
vi.mock('@chinmeister/shared/session-registry.js', () => ({
  deleteSessionRecord: vi.fn(),
  getCurrentTtyPath: vi.fn().mockReturnValue(null),
  isProcessAlive: vi.fn().mockReturnValue(true),
  resolveSessionAgentId: vi.fn(({ fallbackAgentId }) => fallbackAgentId),
  SESSION_COMMAND_MARKER: 'chinmeister-mcp',
  writeSessionRecord: vi.fn(),
  setTerminalTitle: vi.fn(),
  pingAgentTerminal: vi.fn(),
}));

import { isProcessAlive } from '@chinmeister/shared/session-registry.js';

describe('setupShutdownHandlers', () => {
  let team, state, onDisconnectWs;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => {});
    vi.spyOn(process, 'on').mockImplementation(() => {});
    vi.spyOn(process.stdin, 'on').mockImplementation(() => {});

    team = {
      endSession: vi.fn().mockResolvedValue({ ok: true }),
      leaveTeam: vi.fn().mockResolvedValue({ ok: true }),
    };
    state = { teamId: 't_test', sessionId: 'sess_1', ws: null };
    onDisconnectWs = vi.fn();
    isProcessAlive.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('exports named constants', () => {
    expect(FORCE_EXIT_TIMEOUT_MS).toBe(3_000);
    expect(PARENT_WATCH_INTERVAL_MS).toBe(5_000);
  });

  it('registers signal and stdin handlers', () => {
    setupShutdownHandlers({ agentId: 'a1', state, team, onDisconnectWs });

    const signalCalls = process.on.mock.calls.map(([event]) => event);
    expect(signalCalls).toContain('SIGINT');
    expect(signalCalls).toContain('SIGTERM');
    expect(signalCalls).toContain('disconnect');

    const stdinCalls = process.stdin.on.mock.calls.map(([event]) => event);
    expect(stdinCalls).toContain('end');
    expect(stdinCalls).toContain('close');
  });

  it('returns a parentWatch interval and cleanup function', () => {
    const result = setupShutdownHandlers({ agentId: 'a1', state, team, onDisconnectWs });
    expect(result.parentWatch).toBeDefined();
    expect(typeof result.cleanup).toBe('function');

    // Clean up
    clearInterval(result.parentWatch);
  });

  it('calls onDisconnectWs when cleanup runs', () => {
    const { cleanup, parentWatch } = setupShutdownHandlers({
      agentId: 'a1',
      state,
      team,
      onDisconnectWs,
    });

    cleanup();
    expect(onDisconnectWs).toHaveBeenCalledTimes(1);

    clearInterval(parentWatch);
  });

  it('cleanup is idempotent - second call is a no-op', () => {
    const { cleanup, parentWatch } = setupShutdownHandlers({
      agentId: 'a1',
      state,
      team,
      onDisconnectWs,
    });

    cleanup();
    cleanup(); // second call
    expect(onDisconnectWs).toHaveBeenCalledTimes(1);

    clearInterval(parentWatch);
  });

  it('works without onDisconnectWs', () => {
    const { cleanup, parentWatch } = setupShutdownHandlers({
      agentId: 'a1',
      state,
      team,
    });

    // Should not throw
    expect(() => cleanup()).not.toThrow();

    clearInterval(parentWatch);
  });
});
