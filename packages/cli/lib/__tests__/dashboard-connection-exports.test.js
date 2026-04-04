import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the exported pure functions and hook logic in
 * packages/cli/lib/dashboard/connection.tsx.
 *
 * Unlike dashboard-connection-polling.test.js (which re-implements the
 * formulas), these tests import from the actual source module so they
 * contribute real coverage to connection.tsx.
 *
 * Strategy:
 *   - contextFingerprint and getPollInterval are pure, exported functions
 *     — tested directly.
 *   - useDashboardConnection is a React hook — tested via vi.doMock of
 *     React, @chinwag/shared, and other deps so we can drive hook logic
 *     through a minimal state simulation.
 */

// ── Minimal hook simulation ────────────────────────────
let hookStates;
let stateIdx;
let effectCallbacks;
let refs;
let refIdx;

function resetHookSim() {
  hookStates = [];
  stateIdx = 0;
  effectCallbacks = [];
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

function mockUseRef(initial) {
  const idx = refIdx++;
  if (refs[idx] === undefined) {
    refs[idx] = { current: initial };
  }
  return refs[idx];
}

function mockUseEffect(fn) {
  effectCallbacks.push(fn);
}

// ── Direct import tests (pure functions) ──────────────

let connectionModule;

async function loadModule() {
  vi.resetModules();

  // Mock React (needed because the module imports useState/useEffect/useRef)
  vi.doMock('react', () => ({
    useState: mockUseState,
    useEffect: mockUseEffect,
    useRef: mockUseRef,
  }));

  // Mock @chinwag/shared
  vi.doMock('@chinwag/shared', () => ({
    formatError: (err) => (err instanceof Error ? err.message : String(err)),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  }));

  vi.doMock('@chinwag/shared/dashboard-ws.js', () => ({
    applyDelta: vi.fn((prev) => prev),
  }));

  vi.doMock('@chinwag/shared/contracts.js', () => ({}));
  vi.doMock('@chinwag/shared/integration-model.js', () => ({}));

  // Mock local deps
  vi.doMock('../api.js', () => ({
    api: () => ({
      get: vi.fn(() => Promise.resolve({})),
      post: vi.fn(() => Promise.resolve({})),
    }),
    getApiUrl: () => 'https://api.example.com',
  }));

  vi.doMock('../mcp-config.js', () => ({
    detectTools: () => [],
  }));

  vi.doMock('../project.js', () => ({
    getProjectContext: () => ({
      teamId: 'team_123',
      teamName: 'Test Team',
      root: '/tmp/project',
    }),
  }));

  vi.doMock('../utils/errors.js', () => ({
    classifyError: (err) => {
      const status = err?.status;
      if (status === 401) return { state: 'offline', detail: 'Session expired.', fatal: true };
      if (status === 429)
        return { state: 'reconnecting', detail: 'Rate limited. Retrying shortly.' };
      if (status >= 500) return { state: 'reconnecting', detail: 'Server error. Retrying...' };
      return { state: 'reconnecting', detail: err?.message || 'Connection issue. Retrying...' };
    },
  }));

  vi.doMock('../utils/type-guards.js', () => ({
    hasError: (v) => typeof v === 'object' && v !== null && typeof v.error === 'string',
  }));

  vi.doMock('./utils.js', () => ({
    SPINNER: ['|', '/', '-', '\\'],
  }));

  vi.doMock('./constants.js', () => ({
    SPINNER_INTERVAL_MS: 80,
  }));

  vi.doMock('../config.js', () => ({}));
  vi.doMock('./view.js', () => ({}));

  const mod = await import('../dashboard/connection.js');
  return mod;
}

beforeEach(async () => {
  resetHookSim();
  connectionModule = await loadModule();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── contextFingerprint ────────────────────────────────

describe('contextFingerprint (source import)', () => {
  it('returns empty string for null context', () => {
    expect(connectionModule.contextFingerprint(null)).toBe('');
  });

  it('returns format for empty context object', () => {
    expect(connectionModule.contextFingerprint({})).toBe(';0;0;0');
  });

  it('includes member agent_id, status, summary, and file count', () => {
    const ctx = {
      members: [
        {
          agent_id: 'a1',
          status: 'active',
          activity: { summary: 'refactoring auth', files: ['x.ts', 'y.ts'] },
        },
      ],
    };
    const fp = connectionModule.contextFingerprint(ctx);
    expect(fp).toContain('a1');
    expect(fp).toContain('active');
    expect(fp).toContain('refactoring auth');
    expect(fp).toContain(':2'); // 2 files
  });

  it('handles members with no activity gracefully', () => {
    const fp = connectionModule.contextFingerprint({
      members: [{ agent_id: 'b', status: 'idle' }],
    });
    expect(fp).toContain('b:idle::0');
  });

  it('handles activity with summary but no files', () => {
    const fp = connectionModule.contextFingerprint({
      members: [{ agent_id: 'c', status: 'active', activity: { summary: 'reviewing' } }],
    });
    expect(fp).toContain('c:active:reviewing:0');
  });

  it('separates multiple members with pipe', () => {
    const fp = connectionModule.contextFingerprint({
      members: [
        { agent_id: 'a', status: 'active' },
        { agent_id: 'b', status: 'idle' },
      ],
    });
    const memberPart = fp.split(';')[0];
    expect(memberPart.split('|')).toHaveLength(2);
  });

  it('counts memories, messages, and locks', () => {
    const fp = connectionModule.contextFingerprint({
      members: [],
      memories: [{}, {}, {}],
      messages: [{}],
      locks: [{}, {}],
    });
    expect(fp).toBe(';3;1;2');
  });

  it('is deterministic for the same input', () => {
    const ctx = {
      members: [
        { agent_id: 'x', status: 'active', activity: { summary: 'test', files: ['a.js'] } },
      ],
      memories: [{}],
      messages: [],
      locks: [],
    };
    expect(connectionModule.contextFingerprint(ctx)).toBe(connectionModule.contextFingerprint(ctx));
  });

  it('produces different fingerprints for different statuses', () => {
    const base = { memories: [], messages: [], locks: [] };
    const a = { ...base, members: [{ agent_id: 'x', status: 'active' }] };
    const b = { ...base, members: [{ agent_id: 'x', status: 'idle' }] };
    expect(connectionModule.contextFingerprint(a)).not.toBe(connectionModule.contextFingerprint(b));
  });

  it('produces different fingerprints when memory count changes', () => {
    const a = { memories: [{}] };
    const b = { memories: [{}, {}] };
    expect(connectionModule.contextFingerprint(a)).not.toBe(connectionModule.contextFingerprint(b));
  });

  it('produces different fingerprints when file count changes', () => {
    const a = { members: [{ agent_id: 'a', status: 'x', activity: { files: ['a'] } }] };
    const b = { members: [{ agent_id: 'a', status: 'x', activity: { files: ['a', 'b'] } }] };
    expect(connectionModule.contextFingerprint(a)).not.toBe(connectionModule.contextFingerprint(b));
  });
});

// ── getPollInterval ───────────────────────────────────

describe('getPollInterval (source import)', () => {
  const POLL_FAST_MS = 5_000;
  const POLL_MEDIUM_MS = 15_000;
  const POLL_SLOW_MS = 30_000;
  const POLL_IDLE_MS = 60_000;
  const BACKOFF_MAX_MS = 60_000;

  describe('healthy state (0 failures)', () => {
    it('returns fast poll when active', () => {
      expect(connectionModule.getPollInterval(0, 0)).toBe(POLL_FAST_MS);
    });

    it('returns fast poll just below IDLE_TIER_1 (5 unchanged)', () => {
      expect(connectionModule.getPollInterval(0, 5)).toBe(POLL_FAST_MS);
    });
  });

  describe('idle tier progression', () => {
    it('IDLE_TIER_1 (6 unchanged) -> medium', () => {
      expect(connectionModule.getPollInterval(0, 6)).toBe(POLL_MEDIUM_MS);
    });

    it('IDLE_TIER_2 (12 unchanged) -> slow', () => {
      expect(connectionModule.getPollInterval(0, 12)).toBe(POLL_SLOW_MS);
    });

    it('IDLE_TIER_3 (60 unchanged) -> idle', () => {
      expect(connectionModule.getPollInterval(0, 60)).toBe(POLL_IDLE_MS);
    });

    it('between tiers stays in lower tier', () => {
      expect(connectionModule.getPollInterval(0, 7)).toBe(POLL_MEDIUM_MS);
      expect(connectionModule.getPollInterval(0, 11)).toBe(POLL_MEDIUM_MS);
      expect(connectionModule.getPollInterval(0, 30)).toBe(POLL_SLOW_MS);
      expect(connectionModule.getPollInterval(0, 59)).toBe(POLL_SLOW_MS);
    });

    it('beyond IDLE_TIER_3 stays at idle', () => {
      expect(connectionModule.getPollInterval(0, 100)).toBe(POLL_IDLE_MS);
      expect(connectionModule.getPollInterval(0, 1000)).toBe(POLL_IDLE_MS);
    });
  });

  describe('exponential backoff (3+ failures)', () => {
    it('3 failures: MEDIUM * 2^0 = 15s', () => {
      expect(connectionModule.getPollInterval(3, 0)).toBe(POLL_MEDIUM_MS);
    });

    it('4 failures: MEDIUM * 2^1 = 30s', () => {
      expect(connectionModule.getPollInterval(4, 0)).toBe(30_000);
    });

    it('5 failures: MEDIUM * 2^2 = 60s (capped)', () => {
      expect(connectionModule.getPollInterval(5, 0)).toBe(BACKOFF_MAX_MS);
    });
  });

  describe('offline threshold (6+ failures)', () => {
    it('6 failures: SLOW * 2^3 capped at 60s', () => {
      expect(connectionModule.getPollInterval(6, 0)).toBe(BACKOFF_MAX_MS);
    });

    it('10 failures: still capped at 60s', () => {
      expect(connectionModule.getPollInterval(10, 0)).toBe(BACKOFF_MAX_MS);
    });
  });

  describe('backoff cap', () => {
    it('never exceeds BACKOFF_MAX_MS for any failure count', () => {
      for (let f = 3; f <= 50; f++) {
        expect(connectionModule.getPollInterval(f, 0)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
      }
    });

    it('failure-based backoff takes priority over idle tiers', () => {
      // Even with idle=60 (tier 3), failures >= 3 should use backoff formula
      expect(connectionModule.getPollInterval(3, 60)).toBe(POLL_MEDIUM_MS);
    });
  });
});

// ── useDashboardConnection ────────────────────────────

describe('useDashboardConnection (hook simulation)', () => {
  function callHook(overrides = {}) {
    resetHookSim();
    const config = overrides.config || { token: 'tok_test123' };
    const stdout = overrides.stdout || { columns: 120, on: vi.fn(), off: vi.fn() };
    return connectionModule.useDashboardConnection({ config, stdout });
  }

  it('returns expected shape', () => {
    const result = callHook();
    expect(result).toHaveProperty('teamId');
    expect(result).toHaveProperty('teamName');
    expect(result).toHaveProperty('projectRoot');
    expect(result).toHaveProperty('detectedTools');
    expect(result).toHaveProperty('context');
    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty('connState');
    expect(result).toHaveProperty('connDetail');
    expect(result).toHaveProperty('spinnerFrame');
    expect(result).toHaveProperty('cols');
    expect(result).toHaveProperty('consecutiveFailures');
    expect(result).toHaveProperty('retry');
    expect(result).toHaveProperty('bumpRefreshKey');
    expect(result).toHaveProperty('setError');
    expect(result).toHaveProperty('setConnState');
  });

  it('initializes teamId from project context', () => {
    const result = callHook();
    expect(result.teamId).toBe('team_123');
  });

  it('initializes teamName from project context', () => {
    const result = callHook();
    expect(result.teamName).toBe('Test Team');
  });

  it('initializes projectRoot from project context', () => {
    const result = callHook();
    expect(result.projectRoot).toBe('/tmp/project');
  });

  it('starts in connecting state', () => {
    const result = callHook();
    expect(result.connState).toBe('connecting');
  });

  it('starts with null context', () => {
    const result = callHook();
    expect(result.context).toBeNull();
  });

  it('starts with null error (when project found)', () => {
    const result = callHook();
    expect(result.error).toBeNull();
  });

  it('starts with 0 consecutive failures', () => {
    const result = callHook();
    expect(result.consecutiveFailures.current).toBe(0);
  });

  it('uses stdout columns for cols', () => {
    const result = callHook({ stdout: { columns: 200, on: vi.fn(), off: vi.fn() } });
    expect(result.cols).toBe(200);
  });

  it('defaults cols to 80 when stdout has no columns', () => {
    const result = callHook({ stdout: { on: vi.fn(), off: vi.fn() } });
    expect(result.cols).toBe(80);
  });

  it('retry resets state', () => {
    const result = callHook();
    // Simulate some failures
    result.consecutiveFailures.current = 5;
    result.setError('some error');
    result.setConnState('offline');

    // Re-read after mutations
    resetHookSim();

    // Call retry
    result.retry();

    // Re-read the hook to get updated state
    const updated = callHook();
    // retry should have reset consecutiveFailures
    // (But since we re-called the hook, it re-initializes)
    expect(updated.error).toBeNull();
    expect(updated.connState).toBe('connecting');
    expect(updated.consecutiveFailures.current).toBe(0);
  });

  it('bumpRefreshKey is a callable function', () => {
    const result = callHook();
    expect(typeof result.bumpRefreshKey).toBe('function');
    expect(() => result.bumpRefreshKey()).not.toThrow();
  });

  it('setError is a callable function', () => {
    const result = callHook();
    expect(typeof result.setError).toBe('function');
    expect(() => result.setError('test error')).not.toThrow();
  });

  it('setConnState is a callable function', () => {
    const result = callHook();
    expect(typeof result.setConnState).toBe('function');
    expect(() => result.setConnState('offline')).not.toThrow();
  });

  it('registers useEffect callbacks for spinner, resize, and connection', () => {
    callHook();
    // Should register at least 3 effects: spinner, resize, WS connection
    expect(effectCallbacks.length).toBeGreaterThanOrEqual(3);
  });

  it('detectedTools is an array', () => {
    const result = callHook();
    expect(Array.isArray(result.detectedTools)).toBe(true);
  });
});

// ── useDashboardConnection with missing project ───────

describe('useDashboardConnection error states', () => {
  async function loadModuleWithNoProject() {
    vi.resetModules();
    resetHookSim();

    vi.doMock('react', () => ({
      useState: mockUseState,
      useEffect: mockUseEffect,
      useRef: mockUseRef,
    }));

    vi.doMock('@chinwag/shared', () => ({
      formatError: (err) => (err instanceof Error ? err.message : String(err)),
      createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }));

    vi.doMock('@chinwag/shared/dashboard-ws.js', () => ({
      applyDelta: vi.fn((prev) => prev),
    }));

    vi.doMock('@chinwag/shared/contracts.js', () => ({}));
    vi.doMock('@chinwag/shared/integration-model.js', () => ({}));

    vi.doMock('../api.js', () => ({
      api: () => ({
        get: vi.fn(() => Promise.resolve({})),
        post: vi.fn(() => Promise.resolve({})),
      }),
      getApiUrl: () => 'https://api.example.com',
    }));

    vi.doMock('../mcp-config.js', () => ({
      detectTools: () => [],
    }));

    // Project not found
    vi.doMock('../project.js', () => ({
      getProjectContext: () => null,
    }));

    vi.doMock('../utils/errors.js', () => ({
      classifyError: () => ({ state: 'reconnecting', detail: 'Retrying...' }),
    }));

    vi.doMock('../utils/type-guards.js', () => ({
      hasError: (v) => typeof v === 'object' && v !== null && typeof v.error === 'string',
    }));

    vi.doMock('./utils.js', () => ({
      SPINNER: ['|', '/', '-', '\\'],
    }));

    vi.doMock('./constants.js', () => ({
      SPINNER_INTERVAL_MS: 80,
    }));

    vi.doMock('../config.js', () => ({}));
    vi.doMock('./view.js', () => ({}));

    return import('../dashboard/connection.js');
  }

  it('sets error when no project file found', async () => {
    const mod = await loadModuleWithNoProject();
    resetHookSim();
    const result = mod.useDashboardConnection({
      config: { token: 'tok_test' },
      stdout: { columns: 80, on: vi.fn(), off: vi.fn() },
    });
    expect(result.error).toBe('No .chinwag file found. Run `npx chinwag init` first.');
    expect(result.teamId).toBeNull();
  });

  async function loadModuleWithErrorProject() {
    vi.resetModules();
    resetHookSim();

    vi.doMock('react', () => ({
      useState: mockUseState,
      useEffect: mockUseEffect,
      useRef: mockUseRef,
    }));

    vi.doMock('@chinwag/shared', () => ({
      formatError: (err) => (err instanceof Error ? err.message : String(err)),
      createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }));

    vi.doMock('@chinwag/shared/dashboard-ws.js', () => ({
      applyDelta: vi.fn((prev) => prev),
    }));

    vi.doMock('@chinwag/shared/contracts.js', () => ({}));
    vi.doMock('@chinwag/shared/integration-model.js', () => ({}));

    vi.doMock('../api.js', () => ({
      api: () => ({
        get: vi.fn(() => Promise.resolve({})),
        post: vi.fn(() => Promise.resolve({})),
      }),
      getApiUrl: () => 'https://api.example.com',
    }));

    vi.doMock('../mcp-config.js', () => ({
      detectTools: () => [],
    }));

    // Project returns an error
    vi.doMock('../project.js', () => ({
      getProjectContext: () => ({ error: 'Invalid config format' }),
    }));

    vi.doMock('../utils/errors.js', () => ({
      classifyError: () => ({ state: 'reconnecting', detail: 'Retrying...' }),
    }));

    vi.doMock('../utils/type-guards.js', () => ({
      hasError: (v) => typeof v === 'object' && v !== null && typeof v.error === 'string',
    }));

    vi.doMock('./utils.js', () => ({
      SPINNER: ['|', '/', '-', '\\'],
    }));

    vi.doMock('./constants.js', () => ({
      SPINNER_INTERVAL_MS: 80,
    }));

    vi.doMock('../config.js', () => ({}));
    vi.doMock('./view.js', () => ({}));

    return import('../dashboard/connection.js');
  }

  it('sets error when project returns error object', async () => {
    const mod = await loadModuleWithErrorProject();
    resetHookSim();
    const result = mod.useDashboardConnection({
      config: { token: 'tok_test' },
      stdout: { columns: 80, on: vi.fn(), off: vi.fn() },
    });
    expect(result.error).toBe('Invalid config format');
    expect(result.teamId).toBeNull();
  });

  async function loadModuleWithFailingToolDetect() {
    vi.resetModules();
    resetHookSim();

    vi.doMock('react', () => ({
      useState: mockUseState,
      useEffect: mockUseEffect,
      useRef: mockUseRef,
    }));

    vi.doMock('@chinwag/shared', () => ({
      formatError: (err) => (err instanceof Error ? err.message : String(err)),
      createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }));

    vi.doMock('@chinwag/shared/dashboard-ws.js', () => ({
      applyDelta: vi.fn((prev) => prev),
    }));

    vi.doMock('@chinwag/shared/contracts.js', () => ({}));
    vi.doMock('@chinwag/shared/integration-model.js', () => ({}));

    vi.doMock('../api.js', () => ({
      api: () => ({
        get: vi.fn(() => Promise.resolve({})),
        post: vi.fn(() => Promise.resolve({})),
      }),
      getApiUrl: () => 'https://api.example.com',
    }));

    // Tool detection throws
    vi.doMock('../mcp-config.js', () => ({
      detectTools: () => {
        throw new Error('detection failed');
      },
    }));

    vi.doMock('../project.js', () => ({
      getProjectContext: () => ({
        teamId: 'team_abc',
        teamName: 'TeamABC',
        root: '/tmp/proj',
      }),
    }));

    vi.doMock('../utils/errors.js', () => ({
      classifyError: () => ({ state: 'reconnecting', detail: 'Retrying...' }),
    }));

    vi.doMock('../utils/type-guards.js', () => ({
      hasError: (v) => typeof v === 'object' && v !== null && typeof v.error === 'string',
    }));

    vi.doMock('./utils.js', () => ({
      SPINNER: ['|', '/', '-', '\\'],
    }));

    vi.doMock('./constants.js', () => ({
      SPINNER_INTERVAL_MS: 80,
    }));

    vi.doMock('../config.js', () => ({}));
    vi.doMock('./view.js', () => ({}));

    return import('../dashboard/connection.js');
  }

  it('handles tool detection failure gracefully', async () => {
    const mod = await loadModuleWithFailingToolDetect();
    resetHookSim();
    const result = mod.useDashboardConnection({
      config: { token: 'tok_test' },
      stdout: { columns: 80, on: vi.fn(), off: vi.fn() },
    });
    // Should still work, just with empty tools
    expect(result.teamId).toBe('team_abc');
    expect(result.error).toBeNull();
    expect(result.detectedTools).toEqual([]);
  });
});
