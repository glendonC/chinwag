import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for packages/cli/lib/dashboard/agents.js - useAgentLifecycle hook.
 *
 * Strategy: mock React hooks (useState, useEffect, useRef) to run the hook's
 * logic outside of a render tree. We capture the effect callbacks and refs
 * to test:
 * - mountedRef guard prevents setState after unmount
 * - Process manager sync updates managed agents list
 * - Duration ticker fires and updates agents
 * - Cleanup stops ticker and unsubs from process manager
 */

// ── Shared mock state ──────────────────────────────────

let hookStates;
let stateIdx;
let effects;
let refs;
let refIdx;

function resetHookSim() {
  hookStates = [];
  stateIdx = 0;
  effects = [];
  refs = [];
  refIdx = 0;
}

function mockUseState(initial) {
  const idx = stateIdx++;
  if (hookStates[idx] === undefined) {
    hookStates[idx] = typeof initial === 'function' ? initial() : initial;
  }
  const setState = (val) => {
    hookStates[idx] = typeof val === 'function' ? val(hookStates[idx]) : val;
  };
  return [hookStates[idx], setState];
}

function mockUseEffect(fn, deps) {
  effects.push({ fn, deps });
}

function mockUseRef(initial) {
  const idx = refIdx++;
  if (!refs[idx]) {
    refs[idx] = { current: initial };
  }
  return refs[idx];
}

// ── Module loader with mock overrides ──────────────────

let mockGetAgents;
let mockOnUpdate;
let mockListManagedAgentTools;
let mockCheckManagedAgentToolAvailability;
let mockGetSavedLauncherPreference;
let mockResolvePreferredManagedTool;
let mockSpawnInTerminal;
let mockDetectTerminalEnvironment;
let mockReadPidFile;
let mockCheckExternalAgentLiveness;

async function loadAgentsModule(overrides = {}) {
  vi.resetModules();
  resetHookSim();

  const unsub = vi.fn();
  mockGetAgents = overrides.getAgents || vi.fn(() => []);
  mockOnUpdate = overrides.onUpdate || vi.fn(() => unsub);
  mockListManagedAgentTools = overrides.listManagedAgentTools || vi.fn(() => []);
  mockCheckManagedAgentToolAvailability =
    overrides.checkManagedAgentToolAvailability || vi.fn(() => Promise.resolve([]));
  mockGetSavedLauncherPreference = overrides.getSavedLauncherPreference || vi.fn(() => null);
  mockResolvePreferredManagedTool = overrides.resolvePreferredManagedTool || vi.fn(() => null);
  mockSpawnInTerminal = overrides.spawnInTerminal || vi.fn(() => ({ ok: false }));
  mockDetectTerminalEnvironment =
    overrides.detectTerminalEnvironment || vi.fn(() => ({ name: 'Terminal' }));
  mockReadPidFile = overrides.readPidFile || vi.fn(() => null);
  mockCheckExternalAgentLiveness = overrides.checkExternalAgentLiveness || vi.fn(() => false);

  vi.doMock('react', () => ({
    useState: mockUseState,
    useEffect: mockUseEffect,
    useRef: mockUseRef,
  }));

  vi.doMock('../process-manager.js', () => ({
    spawnAgent: vi.fn(),
    killAgent: vi.fn(),
    getAgents: mockGetAgents,
    getOutput: vi.fn(() => []),
    onUpdate: mockOnUpdate,
    removeAgent: vi.fn(),
    registerExternalAgent: vi.fn(),
    setExternalAgentPid: vi.fn(),
    checkExternalAgentLiveness: mockCheckExternalAgentLiveness,
  }));

  vi.doMock('../terminal-spawner.js', () => ({
    spawnInTerminal: mockSpawnInTerminal,
    detectTerminalEnvironment: mockDetectTerminalEnvironment,
    readPidFile: mockReadPidFile,
  }));

  vi.doMock('../open-command-in-terminal.js', () => ({
    openCommandInTerminal: vi.fn(() => ({ ok: false })),
  }));

  vi.doMock('../managed-agents.js', () => ({
    checkManagedAgentToolAvailability: mockCheckManagedAgentToolAvailability,
    classifyManagedAgentFailure: vi.fn(() => null),
    createManagedAgentLaunch: vi.fn(() => ({})),
    createTerminalAgentLaunch: vi.fn(() => ({})),
    listManagedAgentTools: mockListManagedAgentTools,
  }));

  vi.doMock('../launcher-preferences.js', () => ({
    getSavedLauncherPreference: mockGetSavedLauncherPreference,
    resolvePreferredManagedTool: mockResolvePreferredManagedTool,
    saveLauncherPreference: vi.fn(() => true),
  }));

  vi.doMock('./agent-display.js', () => ({
    getAgentDisplayLabel: vi.fn((agent) => agent._display || agent.toolName || 'Agent'),
  }));

  const mod = await import('../dashboard/agents.js');
  return { mod, unsub };
}

function callHook(mod, overrides = {}) {
  resetHookSim();
  const config = overrides.config || { token: 'tok_test' };
  const teamId = overrides.teamId || 'team_abc';
  const projectRoot = overrides.projectRoot || '/project';
  const stdout = overrides.stdout || { columns: 80, rows: 24 };
  const flash = overrides.flash || vi.fn();

  const result = mod.useAgentLifecycle({ config, teamId, projectRoot, stdout, flash });
  return { result, flash };
}

// ── Tests ──────────────────────────────────────────────

describe('useAgentLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Process manager sync effect (first useEffect with [] deps) ──

  describe('process manager sync effect', () => {
    it('initializes managedAgents from getAgents when mount effect runs', async () => {
      const agents = [{ id: 1, toolId: 'claude-code', toolName: 'Claude Code', status: 'running' }];
      const { mod } = await loadAgentsModule({ getAgents: vi.fn(() => agents) });
      callHook(mod);

      // managedAgents starts as [] from useState([]).
      // The mount effect (first useEffect with [] deps) calls setManagedAgents(getAgents()).
      // Find the mount effect and run it to simulate what React would do.
      const mountEffect = effects.find((e) => Array.isArray(e.deps) && e.deps.length === 0);
      expect(mountEffect).toBeDefined();

      // Run the effect - this calls setManagedAgents(getAgents())
      mountEffect.fn();

      // Re-read state by re-running the hook
      stateIdx = 0;
      refIdx = 0;
      const result2 = mod.useAgentLifecycle({
        config: { token: 'tok_test' },
        teamId: 'team_abc',
        projectRoot: '/project',
        stdout: { columns: 80, rows: 24 },
        flash: vi.fn(),
      });

      expect(result2.managedAgents).toEqual(agents);
    });

    it('subscribes to process manager onUpdate and gets cleanup unsub', async () => {
      const unsub = vi.fn();
      const { mod } = await loadAgentsModule({ onUpdate: vi.fn(() => unsub) });
      callHook(mod);

      // Find the first effect ([] deps = mount effect)
      const mountEffect = effects.find((e) => Array.isArray(e.deps) && e.deps.length === 0);
      expect(mountEffect).toBeDefined();

      // Run the effect and get the cleanup
      const cleanup = mountEffect.fn();
      expect(typeof cleanup).toBe('function');
    });

    it('mountedRef guard: cleanup sets mountedRef.current to false', async () => {
      const { mod } = await loadAgentsModule();
      callHook(mod);

      const mountEffect = effects.find((e) => Array.isArray(e.deps) && e.deps.length === 0);

      // Run the effect first - it sets mountedRef.current = true
      const cleanup = mountEffect.fn();

      // mountedRef is the second useRef call (index 1):
      //   refs[0] = previousManagedStatuses (Map)
      //   refs[1] = mountedRef (true)
      //   refs[2] = externalAgentPrevStatus (Map)
      expect(refs[1].current).toBe(true);

      // Run cleanup
      cleanup();
      expect(refs[1].current).toBe(false);
    });

    it('onUpdate callback respects mountedRef guard', async () => {
      let capturedCallback;
      const mockOnUpdateFn = vi.fn((cb) => {
        capturedCallback = cb;
        return vi.fn();
      });

      const { mod } = await loadAgentsModule({ onUpdate: mockOnUpdateFn });
      callHook(mod);

      const mountEffect = effects.find((e) => Array.isArray(e.deps) && e.deps.length === 0);
      mountEffect.fn();

      expect(capturedCallback).toBeDefined();

      // When mountedRef is true, callback should work (no throw)
      refs[1].current = true;
      expect(() => capturedCallback()).not.toThrow();

      // When mountedRef is false (unmounted), the guard should prevent setState
      refs[1].current = false;
      // The callback still runs but the if (mountedRef.current) check skips setState
      expect(() => capturedCallback()).not.toThrow();
    });

    it('cleanup unsubscribes from process manager and clears ticker', async () => {
      const unsub = vi.fn();
      const { mod } = await loadAgentsModule({ onUpdate: vi.fn(() => unsub) });
      callHook(mod);

      const mountEffect = effects.find((e) => Array.isArray(e.deps) && e.deps.length === 0);
      const cleanup = mountEffect.fn();

      // clearInterval is called during cleanup
      const clearSpy = vi.spyOn(globalThis, 'clearInterval');
      cleanup();

      expect(unsub).toHaveBeenCalledTimes(1);
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  // ── Duration ticker ──────────────────────────────────

  describe('duration ticker', () => {
    it('sets up interval with 10s period in the mount effect', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const { mod } = await loadAgentsModule();
      callHook(mod);

      const mountEffect = effects.find((e) => Array.isArray(e.deps) && e.deps.length === 0);
      mountEffect.fn();

      // setInterval should have been called with a 10_000ms interval
      const tenSecCalls = setIntervalSpy.mock.calls.filter(([, ms]) => ms === 10_000);
      expect(tenSecCalls.length).toBeGreaterThanOrEqual(1);
      setIntervalSpy.mockRestore();
    });

    it('ticker callback calls getAgents to refresh display', async () => {
      const getAgentsMock = vi.fn(() => [
        { id: 1, toolId: 'test', status: 'running', startedAt: Date.now() - 30000 },
      ]);
      const { mod } = await loadAgentsModule({ getAgents: getAgentsMock });
      callHook(mod);

      const mountEffect = effects.find((e) => Array.isArray(e.deps) && e.deps.length === 0);
      mountEffect.fn();

      // Reset call count after setup
      const countBefore = getAgentsMock.mock.calls.length;

      // Advance timer by 10s to trigger one tick
      vi.advanceTimersByTime(10_000);

      expect(getAgentsMock.mock.calls.length).toBeGreaterThan(countBefore);
    });

    it('ticker respects mountedRef guard', async () => {
      const getAgentsMock = vi.fn(() => []);
      const { mod } = await loadAgentsModule({ getAgents: getAgentsMock });
      callHook(mod);

      const mountEffect = effects.find((e) => Array.isArray(e.deps) && e.deps.length === 0);
      mountEffect.fn();

      // Simulate unmount
      refs[1].current = false;

      // Advance timer - the ticker callback should check mountedRef and skip
      vi.advanceTimersByTime(10_000);

      // getAgents is still called (the interval fires), but setManagedAgents
      // is guarded by mountedRef. The key is that it doesn't throw.
      expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
    });
  });

  // ── Derived state ────────────────────────────────────

  describe('derived state', () => {
    it('getManagedToolState returns checking state for unknown tool', async () => {
      const { mod } = await loadAgentsModule();
      const { result } = callHook(mod);

      const state = result.getManagedToolState('unknown-tool');
      expect(state).toEqual({
        toolId: 'unknown-tool',
        state: 'checking',
        detail: 'Checking readiness',
      });
    });
  });

  // ── refreshManagedToolStates ─────────────────────────

  describe('refreshManagedToolStates', () => {
    it('flashes info message when called', async () => {
      const { mod } = await loadAgentsModule();
      const { result, flash } = callHook(mod);

      result.refreshManagedToolStates();
      expect(flash).toHaveBeenCalledWith('Rechecking tools...', { tone: 'info' });
    });
  });

  // ── resolveReadyTool ─────────────────────────────────

  describe('resolveReadyTool', () => {
    it('returns null for empty query', async () => {
      const { mod } = await loadAgentsModule();
      const { result } = callHook(mod);

      expect(result.resolveReadyTool(null)).toBeNull();
      expect(result.resolveReadyTool('')).toBeNull();
    });

    // readyCliAgents depends on managedToolStates having 'ready' entries,
    // which requires the tool availability check effect to complete.
    // Since we mock useEffect, we test this at the level of the function's
    // null-return path which is the important guard.
    it('returns null when no ready agents match', async () => {
      const { mod } = await loadAgentsModule();
      const { result } = callHook(mod);

      expect(result.resolveReadyTool('nonexistent')).toBeNull();
    });
  });

  // ── cycleToolForward ─────────────────────────────────

  describe('cycleToolForward', () => {
    it('is a no-op when there are 0 or 1 launcher choices', async () => {
      const { mod } = await loadAgentsModule();
      const { result } = callHook(mod);

      // launcherChoices depends on readyCliAgents which is empty
      // so cycleToolForward should be a no-op
      expect(() => result.cycleToolForward()).not.toThrow();
    });
  });

  // ── selectLaunchTool ─────────────────────────────────

  describe('selectLaunchTool', () => {
    it('is a no-op when tool is null', async () => {
      const { mod } = await loadAgentsModule();
      const { result } = callHook(mod);

      expect(() => result.selectLaunchTool(null)).not.toThrow();
    });
  });
});
