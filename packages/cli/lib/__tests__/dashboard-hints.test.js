import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Tests for packages/cli/lib/dashboard/useDashboardHints.ts.
 *
 * We mock React's useMemo to just call the factory function directly,
 * and mock the agent-display module for isAgentAddressable.
 */

let mockIsAgentAddressable;

async function loadModule() {
  vi.resetModules();

  // Mock React - useMemo just invokes the factory
  vi.doMock('react', () => ({
    useMemo: (fn) => fn(),
  }));

  // Mock isAgentAddressable - we control its return value per test
  mockIsAgentAddressable = vi.fn(() => false);
  vi.doMock('../dashboard/agent-display.js', () => ({
    isAgentAddressable: mockIsAgentAddressable,
  }));

  const mod = await import('../dashboard/useDashboardHints.js');
  return mod.useDashboardHints;
}

/**
 * Create a minimal CombinedAgentRow-like object for testing.
 */
function makeAgent(overrides = {}) {
  return {
    id: 1,
    toolId: 'claude',
    toolName: 'Claude',
    cmd: 'claude',
    args: [],
    taskArg: '',
    task: '',
    cwd: '/tmp',
    agent_id: 'agent-1',
    handle: 'dev',
    status: 'running',
    startedAt: Date.now(),
    exitCode: null,
    _managed: false,
    _connected: false,
    _display: 'Claude',
    _summary: null,
    _duration: null,
    _dead: false,
    _exited: false,
    _failed: false,
    _exitCode: null,
    ...overrides,
  };
}

function makeComposer(overrides = {}) {
  return {
    composeMode: null,
    isComposing: false,
    composeText: '',
    composeTarget: null,
    composeTargetLabel: null,
    commandSelectedIdx: 0,
    setComposeMode: vi.fn(),
    setComposeText: vi.fn(),
    setCommandSelectedIdx: vi.fn(),
    clearCompose: vi.fn(),
    beginTargetedMessage: vi.fn(),
    beginCommandInput: vi.fn(),
    beginMemorySearch: vi.fn(),
    beginMemoryAdd: vi.fn(),
    sendMessage: vi.fn(),
    ...overrides,
  };
}

describe('useDashboardHints', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Default view (not focus, not composing) ───────────

  describe('default view (no focus, no composing)', () => {
    it('returns quit hint in navItems', async () => {
      const useDashboardHints = await loadModule();
      const { navItems } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      expect(navItems).toEqual([{ key: 'q', label: 'quit', color: 'gray' }]);
    });

    it('returns empty contextHints when no agent is selected', async () => {
      const useDashboardHints = await loadModule();
      const { contextHints } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      expect(contextHints).toEqual([]);
    });
  });

  // ── Composing mode ────────────────────────────────────

  describe('composing mode', () => {
    it('shows send and cancel when composing a message', async () => {
      const useDashboardHints = await loadModule();
      const { navItems } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer({ isComposing: true, composeMode: 'message' }),
        mainSelectedAgent: null,
      });
      expect(navItems).toHaveLength(2);
      expect(navItems[0]).toEqual({ key: 'enter', label: 'send', color: 'green' });
      expect(navItems[1]).toEqual({ key: 'esc', label: 'cancel', color: 'cyan' });
    });

    it('shows save when composing memory-add', async () => {
      const useDashboardHints = await loadModule();
      const { navItems } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer({ isComposing: true, composeMode: 'memory-add' }),
        mainSelectedAgent: null,
      });
      expect(navItems[0].label).toBe('save');
    });

    it('shows search when composing memory-search', async () => {
      const useDashboardHints = await loadModule();
      const { navItems } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer({ isComposing: true, composeMode: 'memory-search' }),
        mainSelectedAgent: null,
      });
      expect(navItems[0].label).toBe('search');
    });

    it('shows send for any other compose mode', async () => {
      const useDashboardHints = await loadModule();
      const { navItems } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer({ isComposing: true, composeMode: 'command' }),
        mainSelectedAgent: null,
      });
      expect(navItems[0].label).toBe('send');
    });
  });

  // ── Agent focus view ──────────────────────────────────

  describe('agent focus view', () => {
    it('shows back hint', async () => {
      const useDashboardHints = await loadModule();
      const agent = makeAgent();
      const { navItems } = useDashboardHints({
        isAgentFocusView: true,
        focusedAgent: agent,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      expect(navItems[0]).toEqual({ key: 'esc', label: 'back', color: 'cyan' });
    });

    it('shows stop for managed running agent', async () => {
      const useDashboardHints = await loadModule();
      const agent = makeAgent({ _managed: true, _dead: false, status: 'running' });
      const { navItems } = useDashboardHints({
        isAgentFocusView: true,
        focusedAgent: agent,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      const stopHint = navItems.find((h) => h.key === 'x');
      expect(stopHint).toEqual({ key: 'x', label: 'stop', color: 'red' });
    });

    it('shows restart and remove for managed dead agent', async () => {
      const useDashboardHints = await loadModule();
      const agent = makeAgent({ _managed: true, _dead: true });
      const { navItems } = useDashboardHints({
        isAgentFocusView: true,
        focusedAgent: agent,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      const restartHint = navItems.find((h) => h.key === 'r');
      const removeHint = navItems.find((h) => h.key === 'x');
      expect(restartHint).toEqual({ key: 'r', label: 'restart', color: 'green' });
      expect(removeHint).toEqual({ key: 'x', label: 'remove', color: 'red' });
    });

    it('shows message hint when agent is addressable', async () => {
      const useDashboardHints = await loadModule();
      mockIsAgentAddressable.mockReturnValue(true);
      const agent = makeAgent();
      const { navItems } = useDashboardHints({
        isAgentFocusView: true,
        focusedAgent: agent,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      const msgHint = navItems.find((h) => h.key === 'm');
      expect(msgHint).toEqual({ key: 'm', label: 'message', color: 'cyan' });
    });

    it('does not show message hint when agent is not addressable', async () => {
      const useDashboardHints = await loadModule();
      mockIsAgentAddressable.mockReturnValue(false);
      const agent = makeAgent();
      const { navItems } = useDashboardHints({
        isAgentFocusView: true,
        focusedAgent: agent,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      const msgHint = navItems.find((h) => h.key === 'm');
      expect(msgHint).toBeUndefined();
    });

    it('shows diagnostics hint for managed agent', async () => {
      const useDashboardHints = await loadModule();
      const agent = makeAgent({ _managed: true });
      const { navItems } = useDashboardHints({
        isAgentFocusView: true,
        focusedAgent: agent,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      const diagHint = navItems.find((h) => h.key === 'l');
      expect(diagHint).toEqual({ key: 'l', label: 'diagnostics', color: 'yellow' });
    });

    it('shows hide diagnostics when diagnostics are visible', async () => {
      const useDashboardHints = await loadModule();
      const agent = makeAgent({ _managed: true });
      const { navItems } = useDashboardHints({
        isAgentFocusView: true,
        focusedAgent: agent,
        showDiagnostics: true,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      const diagHint = navItems.find((h) => h.key === 'l');
      expect(diagHint.label).toBe('hide diagnostics');
    });

    it('does not show diagnostics hint for non-managed agent', async () => {
      const useDashboardHints = await loadModule();
      const agent = makeAgent({ _managed: false });
      const { navItems } = useDashboardHints({
        isAgentFocusView: true,
        focusedAgent: agent,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      const diagHint = navItems.find((h) => h.key === 'l');
      expect(diagHint).toBeUndefined();
    });

    it('does not show stop for managed dead agent', async () => {
      const useDashboardHints = await loadModule();
      const agent = makeAgent({ _managed: true, _dead: true });
      const { navItems } = useDashboardHints({
        isAgentFocusView: true,
        focusedAgent: agent,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      // x key should show 'remove', not 'stop'
      const xHint = navItems.find((h) => h.key === 'x');
      expect(xHint.label).toBe('remove');
    });

    it('shows only back for null focused agent', async () => {
      const useDashboardHints = await loadModule();
      const { navItems } = useDashboardHints({
        isAgentFocusView: true,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      expect(navItems).toEqual([{ key: 'esc', label: 'back', color: 'cyan' }]);
    });
  });

  // ── Context hints ─────────────────────────────────────

  describe('contextHints', () => {
    it('shows inspect when an agent is selected in main view', async () => {
      const useDashboardHints = await loadModule();
      const agent = makeAgent();
      const { contextHints } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: agent,
      });
      expect(contextHints).toContainEqual({ commandKey: 'enter', label: 'inspect', color: 'cyan' });
    });

    it('shows message hint when selected agent is addressable', async () => {
      const useDashboardHints = await loadModule();
      mockIsAgentAddressable.mockReturnValue(true);
      const agent = makeAgent();
      const { contextHints } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: agent,
      });
      expect(contextHints).toContainEqual({ commandKey: 'm', label: 'message', color: 'cyan' });
    });

    it('does not show message hint when selected agent is not addressable', async () => {
      const useDashboardHints = await loadModule();
      mockIsAgentAddressable.mockReturnValue(false);
      const agent = makeAgent();
      const { contextHints } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: agent,
      });
      const msgHint = contextHints.find((h) => h.commandKey === 'm');
      expect(msgHint).toBeUndefined();
    });

    it('shows stop for managed running selected agent', async () => {
      const useDashboardHints = await loadModule();
      const agent = makeAgent({ _managed: true, _dead: false, status: 'running' });
      const { contextHints } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: agent,
      });
      expect(contextHints).toContainEqual({ commandKey: 'x', label: 'stop', color: 'red' });
    });

    it('does not show stop for managed dead agent', async () => {
      const useDashboardHints = await loadModule();
      const agent = makeAgent({ _managed: true, _dead: true });
      const { contextHints } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: agent,
      });
      const stopHint = contextHints.find((h) => h.commandKey === 'x');
      expect(stopHint).toBeUndefined();
    });

    it('does not show stop for non-managed agent', async () => {
      const useDashboardHints = await loadModule();
      const agent = makeAgent({ _managed: false });
      const { contextHints } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: agent,
      });
      const stopHint = contextHints.find((h) => h.commandKey === 'x');
      expect(stopHint).toBeUndefined();
    });

    it('returns empty when no agent is selected', async () => {
      const useDashboardHints = await loadModule();
      const { contextHints } = useDashboardHints({
        isAgentFocusView: false,
        focusedAgent: null,
        showDiagnostics: false,
        composer: makeComposer(),
        mainSelectedAgent: null,
      });
      expect(contextHints).toEqual([]);
    });
  });

  // ── Focus view takes priority over composing ──────────

  describe('priority: focus view over composing', () => {
    it('shows focus view hints even when composing', async () => {
      const useDashboardHints = await loadModule();
      const agent = makeAgent({ _managed: true });
      const { navItems } = useDashboardHints({
        isAgentFocusView: true,
        focusedAgent: agent,
        showDiagnostics: false,
        composer: makeComposer({ isComposing: true, composeMode: 'message' }),
        mainSelectedAgent: null,
      });
      // Should show focus view hints (esc/back), not composing hints (enter/send)
      expect(navItems[0]).toEqual({ key: 'esc', label: 'back', color: 'cyan' });
    });
  });
});
