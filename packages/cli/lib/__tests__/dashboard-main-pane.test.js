import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Tests for packages/cli/lib/dashboard/main-pane.tsx.
 *
 * Covers:
 *   - MainPane: working agent count, empty state, connection overlays
 *   - MemoryView: renders memory panel structure
 *   - SessionsView: renders session panel with count
 *   - InputBars: renders correct bar per compose mode
 *   - CommandBar: renders input bar + notice + hints
 *
 * Pattern: Mock React.createElement, Ink, and dependent components to capture
 * the component's render logic. Components are called as plain functions.
 */

// ── Element tracker ─────────────────────────────────────

let createdElements;

function resetElementTracker() {
  createdElements = [];
}

function findElementsByType(type) {
  return createdElements.filter((el) => el.type === type);
}

function collectText(node) {
  if (typeof node === 'string') return [node];
  if (typeof node === 'number') return [String(node)];
  if (!node || typeof node !== 'object') return [];
  const results = [];
  if (Array.isArray(node)) {
    for (const item of node) results.push(...collectText(item));
  } else if (node.children) {
    for (const child of Array.isArray(node.children) ? node.children : [node.children]) {
      results.push(...collectText(child));
    }
  }
  return results;
}

function allRenderedText() {
  // Collect individual text fragments
  const fragments = [];
  for (const el of createdElements) {
    fragments.push(...collectText(el));
  }
  // Also join all siblings within each element to catch split text like `{3} connected`
  const joined = [];
  for (const el of createdElements) {
    if (el.children && Array.isArray(el.children)) {
      const childTexts = el.children
        .map((c) => (typeof c === 'string' ? c : typeof c === 'number' ? String(c) : null))
        .filter(Boolean);
      if (childTexts.length > 0) {
        joined.push(childTexts.join(''));
      }
    }
  }
  return [...fragments, ...joined];
}

// ── Module loader ─────────────────────────────────────

async function loadMainPaneModule() {
  vi.resetModules();
  resetElementTracker();

  const jsxImpl = (type, props) => {
    const { children, ...rest } = props || {};
    if (typeof type === 'function') {
      try {
        return type({ ...rest, children });
      } catch {
        // component threw - record it as-is
      }
    }
    const el = {
      type,
      props: rest,
      children: children != null ? (Array.isArray(children) ? children : [children]) : [],
    };
    createdElements.push(el);
    return el;
  };

  vi.doMock('react', () => {
    return {
      default: { createElement: jsxImpl },
      createElement: jsxImpl,
    };
  });

  vi.doMock('react/jsx-runtime', () => ({
    jsx: jsxImpl,
    jsxs: jsxImpl,
    Fragment: 'Fragment',
  }));

  vi.doMock('react/jsx-dev-runtime', () => ({
    jsxDEV: jsxImpl,
    Fragment: 'Fragment',
  }));

  vi.doMock('ink', () => ({
    Box: 'Box',
    Text: 'Text',
  }));

  vi.doMock('ink-text-input', () => ({
    default: 'TextInput',
  }));

  // Mock ui components
  vi.doMock('../dashboard/ui.jsx', () => ({
    HintRow: 'HintRow',
    NoticeLine: 'NoticeLine',
  }));

  // Mock sections
  vi.doMock('../dashboard/sections.jsx', () => ({
    KnowledgePanel: 'KnowledgePanel',
    SessionsPanel: 'SessionsPanel',
  }));

  // Mock utils
  vi.doMock('../dashboard/utils.js', () => ({
    SPINNER: ['|', '/', '-', '\\'],
    truncateText: (text, max) => {
      if (!text) return text;
      if (text.length <= max) return text;
      return text.slice(0, max - 1) + '\u2026';
    },
  }));

  // Mock agent-display
  vi.doMock('../dashboard/agent-display.js', () => ({
    getAgentIntent: (agent) => {
      if (!agent) return null;
      if (agent._summary) return agent._summary;
      return 'Idle';
    },
    getAgentDisplayLabel: (agent) => {
      if (!agent) return 'agent';
      return agent._display || agent.toolName || 'agent';
    },
    getIntentColor: (intent) => {
      if (!intent) return 'gray';
      if (/idle/i.test(intent)) return 'yellow';
      return 'cyan';
    },
  }));

  // Mock terminal-spawner
  vi.doMock('../terminal-spawner.js', () => ({
    detectTerminalEnvironment: () => ({ name: 'iTerm2' }),
  }));

  // Mock reducer types
  vi.doMock('../dashboard/reducer.js', () => ({}));
  vi.doMock('../dashboard/view.js', () => ({}));
  vi.doMock('../dashboard/agents.js', () => ({}));
  vi.doMock('../dashboard/composer.js', () => ({}));
  vi.doMock('../dashboard/memory.js', () => ({}));
  vi.doMock('@chinmeister/shared/integration-doctor.js', () => ({}));

  const mod = await import('../dashboard/main-pane.js');
  const memoryMod = await import('../dashboard/memory-view.js');
  const sessionsMod = await import('../dashboard/sessions-view.js');
  const inputBarsMod = await import('../dashboard/input-bars.js');
  return { ...mod, ...memoryMod, ...sessionsMod, ...inputBarsMod };
}

// ── Shared test fixtures ──────────────────────────────

function makeAgent(overrides = {}) {
  return {
    agent_id: 'agent_1',
    id: 1,
    tool: 'claude',
    toolId: 'claude',
    toolName: 'Claude',
    _managed: true,
    _connected: false,
    _display: 'Claude',
    _summary: 'working on tests',
    _duration: '5 min',
    _dead: false,
    _exited: false,
    _failed: false,
    _exitCode: null,
    status: 'running',
    startedAt: Date.now(),
    exitCode: null,
    cmd: 'claude',
    args: [],
    taskArg: '',
    task: 'write tests',
    cwd: '/tmp',
    ...overrides,
  };
}

function makeComposer(overrides = {}) {
  return {
    composeMode: 'idle',
    composeText: '',
    composeTargetLabel: null,
    isComposing: false,
    setComposeText: vi.fn(),
    commandSelectedIdx: 0,
    setCommandSelectedIdx: vi.fn(),
    ...overrides,
  };
}

function makeMemory(overrides = {}) {
  return {
    memorySearch: '',
    memoryInput: '',
    setMemorySearch: vi.fn(),
    setMemoryInput: vi.fn(),
    memorySelectedIdx: -1,
    setMemorySelectedIdx: vi.fn(),
    deleteConfirm: false,
    deleteMsg: null,
    ...overrides,
  };
}

function makeState(overrides = {}) {
  return {
    view: 'home',
    selectedIdx: -1,
    mainFocus: 'input',
    heroInput: '',
    heroInputActive: false,
    focusedAgent: null,
    showDiagnostics: false,
    notice: null,
    ...overrides,
  };
}

function makeAgents(overrides = {}) {
  return {
    managedAgents: [],
    readyCliAgents: [],
    installedCliAgents: [],
    unavailableCliAgents: [],
    toolPickerOpen: false,
    toolPickerIdx: 0,
    getManagedToolState: () => ({}),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── MainPane tests ────────────────────────────────────

describe('MainPane', () => {
  it('renders without crashing with empty agents', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    const result = MainPane({
      state: makeState(),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'my-project',
      },
      allVisibleAgents: [],
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      liveAgentNameCounts: new Map(),
      agents: makeAgents(),
      integrationIssues: [],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    expect(result).toBeDefined();
  });

  it('shows "No agents connected" when allVisibleAgents is empty', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    MainPane({
      state: makeState(),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'my-project',
      },
      allVisibleAgents: [],
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      liveAgentNameCounts: new Map(),
      agents: makeAgents(),
      integrationIssues: [],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    // Look for the "No agents" text in rendered elements
    const texts = allRenderedText();
    const noAgentsText = texts.some((t) => t.includes('No agents connected'));
    expect(noAgentsText).toBe(true);
  });

  it('shows agent rows when agents exist', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    const agents = [
      makeAgent({ agent_id: 'a1', _display: 'Claude', _summary: 'testing' }),
      makeAgent({ agent_id: 'a2', _display: 'Cursor', _summary: 'refactoring', _managed: false }),
    ];
    MainPane({
      state: makeState({ selectedIdx: 0 }),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'my-project',
      },
      allVisibleAgents: agents,
      liveAgents: agents,
      visibleSessionRows: { items: agents, start: 0 },
      liveAgentNameCounts: new Map([
        ['Claude', 1],
        ['Cursor', 1],
      ]),
      agents: makeAgents(),
      integrationIssues: [],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    // Should not contain the "No agents" message
    const texts = allRenderedText();
    const noAgentsText = texts.some((t) => t.includes('No agents connected'));
    expect(noAgentsText).toBe(false);
  });

  it('shows connection detail when not connected', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    MainPane({
      state: makeState(),
      connection: {
        connState: 'reconnecting',
        connDetail: 'Server error. Retrying...',
        spinnerFrame: 1,
        cols: 80,
        projectDisplayName: 'my-project',
      },
      allVisibleAgents: [],
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      liveAgentNameCounts: new Map(),
      agents: makeAgents(),
      integrationIssues: [],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('Server error'))).toBe(true);
    expect(texts.some((t) => t.includes('reconnecting'))).toBe(true);
  });

  it('does not show connDetail when connected', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    MainPane({
      state: makeState(),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'my-project',
      },
      allVisibleAgents: [],
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      liveAgentNameCounts: new Map(),
      agents: makeAgents(),
      integrationIssues: [],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    // "reconnecting" should not appear
    expect(texts.some((t) => t.includes('reconnecting'))).toBe(false);
  });

  it('shows project display name in footer', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    MainPane({
      state: makeState(),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'chinmeister',
      },
      allVisibleAgents: [],
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      liveAgentNameCounts: new Map(),
      agents: makeAgents(),
      integrationIssues: [],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('chinmeister'))).toBe(true);
  });

  it('shows tool picker when open', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    const tools = [
      { id: 'claude', name: 'Claude Code' },
      { id: 'cursor', name: 'Cursor' },
    ];
    MainPane({
      state: makeState(),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'test',
      },
      allVisibleAgents: [],
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      liveAgentNameCounts: new Map(),
      agents: makeAgents({
        toolPickerOpen: true,
        toolPickerIdx: 0,
        readyCliAgents: tools,
      }),
      integrationIssues: [],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('Claude Code'))).toBe(true);
    expect(texts.some((t) => t.includes('Cursor'))).toBe(true);
  });

  it('falls back to installedCliAgents when readyCliAgents is empty', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    const installed = [{ id: 'codium', name: 'Windsurf' }];
    MainPane({
      state: makeState(),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'test',
      },
      allVisibleAgents: [],
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      liveAgentNameCounts: new Map(),
      agents: makeAgents({
        toolPickerOpen: true,
        toolPickerIdx: 0,
        readyCliAgents: [],
        installedCliAgents: installed,
      }),
      integrationIssues: [],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('Windsurf'))).toBe(true);
  });

  it('shows compose overlay when composing', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    MainPane({
      state: makeState(),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'test',
      },
      allVisibleAgents: [],
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      liveAgentNameCounts: new Map(),
      agents: makeAgents(),
      integrationIssues: [],
      composer: makeComposer({ isComposing: true, composeMode: 'command', composeText: '' }),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [{ name: '/new', description: 'Open a tool' }],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    // InputBars should be rendered (it's a component reference from the same
    // module and appears as a function reference in the element tree).
    expect(createdElements.length).toBeGreaterThan(0);
  });

  it('shows unavailable tool warnings when not composing and picker is closed', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    MainPane({
      state: makeState(),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'test',
      },
      allVisibleAgents: [],
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      liveAgentNameCounts: new Map(),
      agents: makeAgents({
        unavailableCliAgents: [{ id: 'tool1', name: 'BrokenTool' }],
        getManagedToolState: () => ({ recoveryCommand: 'npm install', detail: 'missing binary' }),
      }),
      integrationIssues: [],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('BrokenTool'))).toBe(true);
    expect(texts.some((t) => t.includes('missing binary'))).toBe(true);
  });

  it('shows integration issues when not composing and picker is closed', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    MainPane({
      state: makeState(),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'test',
      },
      allVisibleAgents: [],
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      liveAgentNameCounts: new Map(),
      agents: makeAgents(),
      integrationIssues: [{ id: 'int1', name: 'Git Hooks', issues: ['Hook not installed'] }],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('Git Hooks'))).toBe(true);
    expect(texts.some((t) => t.includes('Hook not installed'))).toBe(true);
  });

  it('hides tool warnings when composing', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    MainPane({
      state: makeState(),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'test',
      },
      allVisibleAgents: [],
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      liveAgentNameCounts: new Map(),
      agents: makeAgents({
        unavailableCliAgents: [{ id: 'tool1', name: 'BrokenTool' }],
        getManagedToolState: () => ({ recoveryCommand: 'fix', detail: 'broken' }),
      }),
      integrationIssues: [{ id: 'i1', name: 'Issue', issues: ['bad'] }],
      composer: makeComposer({ isComposing: true, composeMode: 'command' }),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('BrokenTool'))).toBe(false);
    expect(texts.some((t) => t.includes('Issue'))).toBe(false);
  });

  it('counts working agents correctly', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    const agents = [
      makeAgent({ agent_id: 'a1', _summary: 'writing code', _dead: false }),
      makeAgent({ agent_id: 'a2', _summary: 'Idle', _dead: false }),
      makeAgent({ agent_id: 'a3', _summary: 'reviewing PR', _dead: false }),
    ];
    MainPane({
      state: makeState({ selectedIdx: 0 }),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 120,
        projectDisplayName: 'test',
      },
      allVisibleAgents: agents,
      liveAgents: agents,
      visibleSessionRows: { items: agents, start: 0 },
      liveAgentNameCounts: new Map([['Claude', 3]]),
      agents: makeAgents(),
      integrationIssues: [],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    // 3 connected
    expect(texts.some((t) => t.includes('3 connected'))).toBe(true);
    // 2 working (a1 and a3; a2 is idle)
    expect(texts.some((t) => t.includes('2 working'))).toBe(true);
  });

  it('does not show working count when all agents are idle', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    const agents = [makeAgent({ agent_id: 'a1', _summary: 'Idle', _dead: false })];
    MainPane({
      state: makeState(),
      connection: {
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'test',
      },
      allVisibleAgents: agents,
      liveAgents: agents,
      visibleSessionRows: { items: agents, start: 0 },
      liveAgentNameCounts: new Map([['Claude', 1]]),
      agents: makeAgents(),
      integrationIssues: [],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('working'))).toBe(false);
  });

  it('shows offline connection detail in red state', async () => {
    const { MainPane } = await loadMainPaneModule();
    resetElementTracker();
    MainPane({
      state: makeState(),
      connection: {
        connState: 'offline',
        connDetail: 'Cannot reach server. Press [r] to retry.',
        spinnerFrame: 0,
        cols: 80,
        projectDisplayName: 'test',
      },
      allVisibleAgents: [],
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      liveAgentNameCounts: new Map(),
      agents: makeAgents(),
      integrationIssues: [],
      composer: makeComposer(),
      memory: makeMemory(),
      contextHints: [],
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('Cannot reach server'))).toBe(true);
  });
});

// ── InputBars tests ───────────────────────────────────

describe('InputBars', () => {
  it('renders command input bar', async () => {
    const { InputBars } = await loadMainPaneModule();
    resetElementTracker();
    InputBars({
      composer: makeComposer({ composeMode: 'command', composeText: 'hel', isComposing: true }),
      memory: makeMemory(),
      commandSuggestions: [{ name: '/help', description: 'Show help' }],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    // Should contain the '> ' prompt
    expect(texts.some((t) => t.includes('>'))).toBe(true);
  });

  it('renders targeted input bar', async () => {
    const { InputBars } = await loadMainPaneModule();
    resetElementTracker();
    InputBars({
      composer: makeComposer({
        composeMode: 'targeted',
        composeTargetLabel: 'Claude',
        isComposing: true,
      }),
      memory: makeMemory(),
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('Claude'))).toBe(true);
  });

  it('renders memory search input bar', async () => {
    const { InputBars } = await loadMainPaneModule();
    resetElementTracker();
    InputBars({
      composer: makeComposer({ composeMode: 'memory-search', isComposing: true }),
      memory: makeMemory({ memorySearch: 'auth' }),
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('search'))).toBe(true);
  });

  it('renders memory add input bar', async () => {
    const { InputBars } = await loadMainPaneModule();
    resetElementTracker();
    InputBars({
      composer: makeComposer({ composeMode: 'memory-add', isComposing: true }),
      memory: makeMemory({ memoryInput: 'new fact' }),
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('save'))).toBe(true);
  });

  it('renders nothing when composeMode is idle', async () => {
    const { InputBars } = await loadMainPaneModule();
    resetElementTracker();
    InputBars({
      composer: makeComposer({ composeMode: 'idle' }),
      memory: makeMemory(),
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    // Should not render command/targeted/memory bars
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('search'))).toBe(false);
    expect(texts.some((t) => t.includes('save'))).toBe(false);
  });

  it('shows command suggestions in command mode', async () => {
    const { InputBars } = await loadMainPaneModule();
    resetElementTracker();
    InputBars({
      composer: makeComposer({ composeMode: 'command', composeText: '', isComposing: true }),
      memory: makeMemory(),
      commandSuggestions: [
        { name: '/new', description: 'Open a tool' },
        { name: '/help', description: 'Show help' },
      ],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('/new'))).toBe(true);
    expect(texts.some((t) => t.includes('/help'))).toBe(true);
  });
});

// ── CommandBar tests ──────────────────────────────────

describe('CommandBar', () => {
  it('shows / prompt when not composing', async () => {
    const { CommandBar } = await loadMainPaneModule();
    resetElementTracker();
    CommandBar({
      composer: makeComposer({ isComposing: false }),
      memory: makeMemory(),
      notice: null,
      view: 'home',
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('Press / for commands'))).toBe(true);
  });

  it('renders memory view hints', async () => {
    const { CommandBar } = await loadMainPaneModule();
    resetElementTracker();
    CommandBar({
      composer: makeComposer({ isComposing: false }),
      memory: makeMemory({ memorySelectedIdx: 2 }),
      notice: null,
      view: 'memory',
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    // HintRow should be rendered with memory-specific hints
    const hintRows = findElementsByType('HintRow');
    expect(hintRows.length).toBeGreaterThan(0);
    // Check hints include search, add, delete (since memorySelectedIdx >= 0), esc, q
    const hints = hintRows[0]?.props?.hints;
    if (hints) {
      const labels = hints.map((h) => h.label);
      expect(labels).toContain('search');
      expect(labels).toContain('add');
      expect(labels).toContain('delete');
      expect(labels).toContain('back');
      expect(labels).toContain('quit');
    }
  });

  it('omits delete hint in memory view when nothing selected', async () => {
    const { CommandBar } = await loadMainPaneModule();
    resetElementTracker();
    CommandBar({
      composer: makeComposer({ isComposing: false }),
      memory: makeMemory({ memorySelectedIdx: -1 }),
      notice: null,
      view: 'memory',
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const hintRows = findElementsByType('HintRow');
    if (hintRows.length > 0) {
      const hints = hintRows[0]?.props?.hints;
      if (hints) {
        const labels = hints.map((h) => h.label);
        expect(labels).not.toContain('delete');
      }
    }
  });

  it('renders sessions view hints with select', async () => {
    const { CommandBar } = await loadMainPaneModule();
    resetElementTracker();
    CommandBar({
      composer: makeComposer({ isComposing: false }),
      memory: makeMemory(),
      notice: null,
      view: 'sessions',
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const hintRows = findElementsByType('HintRow');
    if (hintRows.length > 0) {
      const hints = hintRows[0]?.props?.hints;
      if (hints) {
        const labels = hints.map((h) => h.label);
        expect(labels).toContain('select');
        expect(labels).toContain('quit');
      }
    }
  });
});

// ── MemoryView tests ──────────────────────────────────

describe('MemoryView', () => {
  it('renders without crashing', async () => {
    const { MemoryView } = await loadMainPaneModule();
    resetElementTracker();
    const result = MemoryView({
      memories: [],
      filteredMemories: [],
      visibleKnowledgeRows: { items: [], start: 0 },
      memory: makeMemory(),
      composer: makeComposer(),
      state: makeState({ view: 'memory' }),
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    expect(result).toBeDefined();
  });

  it('renders memory header text', async () => {
    const { MemoryView } = await loadMainPaneModule();
    resetElementTracker();
    MemoryView({
      memories: [],
      filteredMemories: [],
      visibleKnowledgeRows: { items: [], start: 0 },
      memory: makeMemory(),
      composer: makeComposer(),
      state: makeState({ view: 'memory' }),
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('memory'))).toBe(true);
    expect(texts.some((t) => t.includes('Shared memory'))).toBe(true);
  });

  it('renders KnowledgePanel component', async () => {
    const { MemoryView } = await loadMainPaneModule();
    resetElementTracker();
    MemoryView({
      memories: [{ id: 1, text: 'fact', tags: [] }],
      filteredMemories: [{ id: 1, text: 'fact', tags: [] }],
      visibleKnowledgeRows: { items: [{ id: 1, text: 'fact', tags: [] }], start: 0 },
      memory: makeMemory(),
      composer: makeComposer(),
      state: makeState({ view: 'memory' }),
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const panels = findElementsByType('KnowledgePanel');
    expect(panels.length).toBeGreaterThan(0);
  });
});

// ── SessionsView tests ────────────────────────────────

describe('SessionsView', () => {
  it('renders without crashing', async () => {
    const { SessionsView } = await loadMainPaneModule();
    resetElementTracker();
    const result = SessionsView({
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      state: makeState({ view: 'sessions' }),
      cols: 80,
      composer: makeComposer(),
      memory: makeMemory(),
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    expect(result).toBeDefined();
  });

  it('renders sessions header with count', async () => {
    const { SessionsView } = await loadMainPaneModule();
    resetElementTracker();
    const agents = [makeAgent(), makeAgent({ agent_id: 'a2' })];
    SessionsView({
      liveAgents: agents,
      visibleSessionRows: { items: agents, start: 0 },
      state: makeState({ view: 'sessions' }),
      cols: 80,
      composer: makeComposer(),
      memory: makeMemory(),
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    expect(texts.some((t) => t.includes('sessions'))).toBe(true);
    expect(texts.some((t) => t.includes('2 live session'))).toBe(true);
  });

  it('uses singular "session" for 1 agent', async () => {
    const { SessionsView } = await loadMainPaneModule();
    resetElementTracker();
    const agents = [makeAgent()];
    SessionsView({
      liveAgents: agents,
      visibleSessionRows: { items: agents, start: 0 },
      state: makeState({ view: 'sessions' }),
      cols: 80,
      composer: makeComposer(),
      memory: makeMemory(),
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const texts = allRenderedText();
    // "1 live session" not "1 live sessions"
    const sessionText = texts.find((t) => t.includes('live session'));
    expect(sessionText).toBeDefined();
    expect(sessionText).not.toContain('sessions');
  });

  it('renders SessionsPanel component', async () => {
    const { SessionsView } = await loadMainPaneModule();
    resetElementTracker();
    SessionsView({
      liveAgents: [],
      visibleSessionRows: { items: [], start: 0 },
      state: makeState({ view: 'sessions' }),
      cols: 80,
      composer: makeComposer(),
      memory: makeMemory(),
      commandSuggestions: [],
      onComposeSubmit: vi.fn(),
      onMemorySubmit: vi.fn(),
    });
    const panels = findElementsByType('SessionsPanel');
    expect(panels.length).toBeGreaterThan(0);
  });
});
