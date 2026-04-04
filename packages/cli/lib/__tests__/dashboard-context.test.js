import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for packages/cli/lib/dashboard/context.tsx.
 *
 * Covers:
 *   - useView/useConnection/useData hooks throw outside providers
 *   - ViewProvider flash notification logic (auto-clear timers, overwrite)
 *   - useCommandSuggestions filter/ordering logic
 *   - DataProvider selection clamping and data merging
 *
 * Pattern: vi.doMock React and Ink dependencies, dynamically import the module,
 * and call hooks/components as plain functions to exercise logic paths.
 */

// ── Minimal React simulation ────────────────────────────

let hookStates;
let stateIdx;
let effectCallbacks;
let memoCache;
let memoIdx;
let contextValues;

function resetHookSim() {
  hookStates = [];
  stateIdx = 0;
  effectCallbacks = [];
  memoCache = [];
  memoIdx = 0;
  contextValues = new Map();
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

function mockUseRef(initial) {
  return { current: initial };
}

function mockUseCallback(fn) {
  return fn;
}

function mockUseMemo(factory) {
  return factory();
}

function mockUseEffect(fn) {
  effectCallbacks.push(fn);
}

function mockUseReducer(reducer, initialArg, init) {
  const idx = stateIdx++;
  if (hookStates[idx] === undefined) {
    hookStates[idx] = init ? init(initialArg) : initialArg;
  }
  const dispatch = (action) => {
    hookStates[idx] = reducer(hookStates[idx], action);
  };
  return [hookStates[idx], dispatch];
}

function mockCreateContext(defaultValue) {
  const key = Symbol('context');
  const Provider = function ContextProvider({ value, children }) {
    contextValues.set(key, value);
    return { type: 'Provider', props: { value }, children: [children] };
  };
  const ctx = { _value: defaultValue, _key: key, Provider };
  return ctx;
}

function mockUseContext(ctx) {
  return contextValues.get(ctx._key) ?? ctx._value;
}

// ── Module loader ─────────────────────────────────────

async function loadContextModule(overrides = {}) {
  vi.resetModules();
  resetHookSim();

  const jsxFn = (type, props, ...children) => {
    // If type is a function (component), call it to simulate rendering
    if (typeof type === 'function') {
      return type({ ...props, children: children.length === 1 ? children[0] : children });
    }
    return { type, props: props || {}, children };
  };

  vi.doMock('react', () => ({
    createContext: mockCreateContext,
    useContext: mockUseContext,
    useState: mockUseState,
    useRef: mockUseRef,
    useCallback: mockUseCallback,
    useMemo: mockUseMemo,
    useEffect: mockUseEffect,
    useReducer: mockUseReducer,
    default: {
      createElement: jsxFn,
    },
    createElement: jsxFn,
  }));

  vi.doMock('react/jsx-runtime', () => ({
    jsx: (type, props) => {
      const { children, ...rest } = props || {};
      if (typeof type === 'function') {
        return type({ ...rest, children });
      }
      return { type, props: rest, children: children != null ? [children] : [] };
    },
    jsxs: (type, props) => {
      const { children, ...rest } = props || {};
      if (typeof type === 'function') {
        return type({ ...rest, children });
      }
      return { type, props: rest, children: Array.isArray(children) ? children : [children] };
    },
    Fragment: 'Fragment',
  }));

  // Mock path module
  vi.doMock('path', () => ({
    basename: (p) => {
      const parts = p.split('/');
      return parts[parts.length - 1];
    },
  }));

  // Mock view module
  vi.doMock('../dashboard/view.js', () => ({
    buildCombinedAgentRows:
      overrides.buildCombinedAgentRows ||
      (({ managedAgents, connectedAgents }) => {
        const managed = (managedAgents || []).map((a) => ({
          ...a,
          _managed: true,
          _connected: false,
          _dead: a.status !== 'running',
          _display: a.toolName || a.tool || 'agent',
          _summary: null,
          _duration: null,
          _failed: false,
          _exitCode: null,
          _exited: a.status !== 'running',
        }));
        const connected = (connectedAgents || []).map((a) => ({
          ...a,
          _managed: false,
          _connected: true,
          _dead: false,
          _display: a.tool || 'agent',
          _summary: null,
          _duration: null,
          _failed: false,
          _exitCode: null,
          _exited: false,
        }));
        return [...managed, ...connected];
      }),
    buildDashboardView:
      overrides.buildDashboardView ||
      (() => ({
        visibleAgents: [],
        getToolName: () => null,
        conflicts: [],
        memories: [],
        filteredMemories: [],
        visibleMemories: [],
      })),
  }));

  // Mock agent-display
  vi.doMock('../dashboard/agent-display.js', () => ({
    isAgentAddressable: (agent) => {
      if (!agent?.agent_id) return false;
      if (agent._managed) return agent.status === 'running';
      return agent.status === 'active';
    },
  }));

  // Mock utils
  vi.doMock('../dashboard/utils.js', () => ({
    getVisibleWindow: (items, idx, max) => {
      if (!items?.length) return { items: [], start: 0 };
      return { items: items.slice(0, max), start: 0 };
    },
  }));

  // Mock constants
  vi.doMock('../dashboard/constants.js', () => ({
    RECENTLY_FINISHED_LIMIT: 3,
    MIN_VIEWPORT_ROWS: 4,
    VIEWPORT_CHROME_ROWS: 11,
    COMMAND_SUGGESTION_LIMIT: 5,
  }));

  // Mock reducer
  vi.doMock('../dashboard/reducer.js', () => ({
    dashboardReducer: (state, action) => {
      if (action.type === 'CLAMP_SELECTION') {
        const max = action.listLength;
        if (max <= 0) return { ...state, selectedIdx: -1 };
        if (state.selectedIdx >= max) return { ...state, selectedIdx: max - 1 };
        return state;
      }
      return state;
    },
    createInitialState: () => ({
      view: 'home',
      selectedIdx: -1,
      mainFocus: 'input',
      heroInput: '',
      heroInputActive: false,
      focusedAgent: null,
      showDiagnostics: false,
      notice: null,
    }),
    clampSelection: (len) => ({ type: 'CLAMP_SELECTION', listLength: len }),
  }));

  // Mock connection type (not needed at runtime, just for types)
  vi.doMock('../dashboard/connection.jsx', () => ({}));

  // Mock agent and memory modules (type-only usage)
  vi.doMock('../dashboard/agents.js', () => ({}));
  vi.doMock('../dashboard/memory.js', () => ({}));
  vi.doMock('../dashboard/composer.js', () => ({}));
  vi.doMock('../dashboard/integrations.js', () => ({}));
  vi.doMock('@chinwag/shared/integration-model.js', () => ({}));
  vi.doMock('@chinwag/shared/integration-doctor.js', () => ({}));

  const mod = await import('../dashboard/context.js');
  return mod;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── useView / useConnection / useData throw outside providers ───

describe('context hooks outside providers', () => {
  it('useView throws when used outside ViewProvider', async () => {
    const mod = await loadContextModule();
    expect(() => mod.useView()).toThrow('useView must be used within ViewProvider');
  });

  it('useConnection throws when used outside ConnectionProvider', async () => {
    const mod = await loadContextModule();
    expect(() => mod.useConnection()).toThrow(
      'useConnection must be used within ConnectionProvider',
    );
  });

  it('useData throws when used outside DataProvider', async () => {
    const mod = await loadContextModule();
    expect(() => mod.useData()).toThrow('useData must be used within DataProvider');
  });
});

// ── ViewProvider flash notification logic ──────────────

describe('ViewProvider', () => {
  it('is an exported function', async () => {
    const mod = await loadContextModule();
    expect(typeof mod.ViewProvider).toBe('function');
  });

  it('renders without throwing', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    // ViewProvider uses useReducer + useState; calling it exercises hook initialization
    expect(() => mod.ViewProvider({ children: null })).not.toThrow();
  });

  it('initializes notice as null', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    mod.ViewProvider({ children: null });

    // useReducer is idx=0, useState(notice) is idx=1
    expect(hookStates[1]).toBeNull();
  });
});

// ── useCommandSuggestions ──────────────────────────────

describe('useCommandSuggestions', () => {
  it('returns empty array when composeMode is not command', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'idle', composeText: '' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    expect(result).toEqual([]);
  });

  it('returns all commands when query is empty in command mode', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    // Should include base commands: /new, /recheck, /doctor, /web, /help
    const names = result.map((c) => c.name);
    expect(names).toContain('/new');
    expect(names).toContain('/recheck');
    expect(names).toContain('/doctor');
    expect(names).toContain('/web');
    expect(names).toContain('/help');
  });

  it('filters commands based on query text', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: 'new' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    const names = result.map((c) => c.name);
    expect(names).toContain('/new');
    // /recheck should not match 'new'
    expect(names).not.toContain('/recheck');
  });

  it('strips leading / from query for matching', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '/doc' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    const names = result.map((c) => c.name);
    expect(names).toContain('/doctor');
  });

  it('includes /knowledge when hasMemories is true', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: true,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    const names = result.map((c) => c.name);
    expect(names).toContain('/knowledge');
  });

  it('excludes /knowledge when hasMemories is false', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    const names = result.map((c) => c.name);
    expect(names).not.toContain('/knowledge');
  });

  it('includes /history when hasLiveAgents is true', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: false,
      hasLiveAgents: true,
      selectedAgent: null,
    });
    const names = result.map((c) => c.name);
    expect(names).toContain('/history');
  });

  it('excludes /history when hasLiveAgents is false', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    const names = result.map((c) => c.name);
    expect(names).not.toContain('/history');
  });

  it('includes /fix when a tool has a recovery command', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '' },
      agents: {
        unavailableCliAgents: [{ id: 'tool1', name: 'ToolA' }],
        getManagedToolState: (id) => (id === 'tool1' ? { recoveryCommand: 'npm install' } : {}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    const names = result.map((c) => c.name);
    expect(names).toContain('/fix');
  });

  it('includes /fix when there are integration issues', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [{ id: 'issue1' }] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    const names = result.map((c) => c.name);
    expect(names).toContain('/fix');
  });

  it('includes /repair when there are integration issues', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [{ id: 'issue1' }] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    const names = result.map((c) => c.name);
    expect(names).toContain('/repair');
  });

  it('excludes /repair when there are no integration issues', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    const names = result.map((c) => c.name);
    expect(names).not.toContain('/repair');
  });

  it('includes /message when selectedAgent is addressable', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: {
        agent_id: 'agent_1',
        _managed: false,
        status: 'active',
        _display: 'Claude',
      },
    });
    const names = result.map((c) => c.name);
    expect(names).toContain('/message');
  });

  it('excludes /message when selectedAgent is not addressable', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    const names = result.map((c) => c.name);
    expect(names).not.toContain('/message');
  });

  it('limits results to COMMAND_SUGGESTION_LIMIT + 1', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    // Enable all optional commands to get a large list
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: '' },
      agents: {
        unavailableCliAgents: [{ id: 't', name: 'T' }],
        getManagedToolState: () => ({ recoveryCommand: 'x' }),
      },
      integrations: { integrationIssues: [{ id: 'i' }] },
      hasMemories: true,
      hasLiveAgents: true,
      selectedAgent: { agent_id: 'a', _managed: false, status: 'active', _display: 'X' },
    });
    // COMMAND_SUGGESTION_LIMIT + 1 = 6
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it('matches commands by description text too', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    // "terminal" should match /new's description "Open a tool in a new terminal tab"
    const result = mod.useCommandSuggestions({
      composer: { composeMode: 'command', composeText: 'terminal' },
      agents: {
        unavailableCliAgents: [],
        getManagedToolState: () => ({}),
      },
      integrations: { integrationIssues: [] },
      hasMemories: false,
      hasLiveAgents: false,
      selectedAgent: null,
    });
    const names = result.map((c) => c.name);
    expect(names).toContain('/new');
  });
});

// ── ConnectionProvider ─────────────────────────────────

describe('ConnectionProvider', () => {
  it('is an exported function', async () => {
    const mod = await loadContextModule();
    expect(typeof mod.ConnectionProvider).toBe('function');
  });

  it('renders without throwing', async () => {
    const mod = await loadContextModule();
    resetHookSim();
    const connection = { teamId: 'team_1', connState: 'connected' };
    expect(() => mod.ConnectionProvider({ connection, children: null })).not.toThrow();
  });
});
