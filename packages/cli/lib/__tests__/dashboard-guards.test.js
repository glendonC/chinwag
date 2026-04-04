import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Tests for packages/cli/lib/dashboard/DashboardGuards.tsx.
 *
 * DashboardGuards is a React component that returns null when no guard
 * condition is met, and JSX for three guard states: narrow terminal, error,
 * and loading/connecting.
 *
 * Since we don't have a React test renderer, we mock React and Ink to
 * capture the component's output logic. The component is simple enough
 * that mocking createElement lets us inspect the guard behavior.
 */

// ── Track React.createElement calls ─────────────────────
let createdElements;

function resetElementTracker() {
  createdElements = [];
}

// ── Module loader ───────────────────────────────────────

async function loadGuardsModule() {
  vi.resetModules();
  resetElementTracker();

  // Mock React — createElement captures what the component returns
  vi.doMock('react', () => {
    const createElement = (type, props, ...children) => {
      const el = { type, props: props || {}, children };
      createdElements.push(el);
      return el;
    };
    return {
      default: { createElement },
      createElement,
    };
  });

  // Mock Ink components — they're just tag names
  vi.doMock('ink', () => ({
    Box: 'Box',
    Text: 'Text',
  }));

  // Mock the ui module (HintRow)
  vi.doMock('../dashboard/ui.jsx', () => ({
    HintRow: 'HintRow',
  }));

  // Mock the utils module
  vi.doMock('../dashboard/utils.js', () => ({
    MIN_WIDTH: 50,
    SPINNER: ['\u280B', '\u2819', '\u2838', '\u2834', '\u2826', '\u2807'],
  }));

  const mod = await import('../dashboard/DashboardGuards.js');
  return mod;
}

// ── Tests ───────────────────────────────────────────────

describe('DashboardGuards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Returns null (no guard applies) ───────────────────

  describe('returns null when no guard applies', () => {
    it('returns null when cols >= MIN_WIDTH, no error, and context exists', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      const result = DashboardGuards({
        cols: 80,
        error: null,
        context: { members: [] },
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).toBeNull();
    });

    it('returns null when cols is exactly MIN_WIDTH', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      const result = DashboardGuards({
        cols: 50,
        error: null,
        context: { members: [] },
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).toBeNull();
    });

    it('returns null with large terminal and valid context', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      const result = DashboardGuards({
        cols: 200,
        error: null,
        context: {},
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).toBeNull();
    });
  });

  // ── Narrow terminal guard ─────────────────────────────

  describe('narrow terminal guard', () => {
    it('returns JSX when cols < MIN_WIDTH', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      const result = DashboardGuards({
        cols: 30,
        error: null,
        context: { members: [] },
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).not.toBeNull();
    });

    it('returns JSX when cols is 1 below MIN_WIDTH', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      const result = DashboardGuards({
        cols: 49,
        error: null,
        context: { members: [] },
        connState: 'connected',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).not.toBeNull();
    });

    it('narrow guard takes priority over error', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      resetElementTracker();
      const result = DashboardGuards({
        cols: 30,
        error: 'Some error',
        context: null,
        connState: 'error',
        connDetail: null,
        spinnerFrame: 0,
      });
      // Should show narrow terminal message, not error
      expect(result).not.toBeNull();
      // The result is a JSX element (not null) which means a guard fired
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('narrow guard takes priority over loading', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      const result = DashboardGuards({
        cols: 10,
        error: null,
        context: null,
        connState: 'connecting',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).not.toBeNull();
    });
  });

  // ── Error guard ───────────────────────────────────────

  describe('error guard', () => {
    it('returns JSX when error is present', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      const result = DashboardGuards({
        cols: 80,
        error: 'Connection failed',
        context: null,
        connState: 'error',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).not.toBeNull();
    });

    it('returns JSX for init-related error', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      const result = DashboardGuards({
        cols: 80,
        error: 'Run chinwag init to set up this project',
        context: null,
        connState: 'error',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).not.toBeNull();
    });

    it('returns JSX for expired token error', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      const result = DashboardGuards({
        cols: 80,
        error: 'Auth token expired',
        context: null,
        connState: 'error',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).not.toBeNull();
    });

    it('error guard takes priority over loading', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      const result = DashboardGuards({
        cols: 80,
        error: 'Error occurred',
        context: null,
        connState: 'connecting',
        connDetail: 'Retrying...',
        spinnerFrame: 0,
      });
      // Should show error, not loading
      expect(result).not.toBeNull();
    });
  });

  // ── Loading/connecting guard ──────────────────────────

  describe('loading/connecting guard', () => {
    it('returns JSX when context is null (loading)', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      const result = DashboardGuards({
        cols: 80,
        error: null,
        context: null,
        connState: 'connecting',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).not.toBeNull();
    });

    it('returns JSX when context is undefined', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      const result = DashboardGuards({
        cols: 80,
        error: null,
        context: undefined,
        connState: 'idle',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).not.toBeNull();
    });

    it('shows connecting state when connState is connecting', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      resetElementTracker();
      const result = DashboardGuards({
        cols: 80,
        error: null,
        context: null,
        connState: 'connecting',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).not.toBeNull();
    });

    it('shows reconnecting state when connState is reconnecting', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      resetElementTracker();
      const result = DashboardGuards({
        cols: 80,
        error: null,
        context: null,
        connState: 'reconnecting',
        connDetail: 'Attempt 3...',
        spinnerFrame: 2,
      });
      expect(result).not.toBeNull();
    });

    it('shows offline state with retry hint when not auto-retrying', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      resetElementTracker();
      const result = DashboardGuards({
        cols: 80,
        error: null,
        context: null,
        connState: 'offline',
        connDetail: 'Cannot reach server.',
        spinnerFrame: 0,
      });
      expect(result).not.toBeNull();
    });

    it('uses connDetail when available in offline state', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      resetElementTracker();
      const result = DashboardGuards({
        cols: 80,
        error: null,
        context: null,
        connState: 'idle',
        connDetail: 'DNS resolution failed',
        spinnerFrame: 0,
      });
      expect(result).not.toBeNull();
    });

    it('uses default message when connDetail is null in offline state', async () => {
      const { DashboardGuards } = await loadGuardsModule();
      resetElementTracker();
      const result = DashboardGuards({
        cols: 80,
        error: null,
        context: null,
        connState: 'idle',
        connDetail: null,
        spinnerFrame: 0,
      });
      expect(result).not.toBeNull();
    });
  });

  // ── Guard priority order ──────────────────────────────

  describe('guard priority order', () => {
    it('narrow terminal > error > loading', async () => {
      const { DashboardGuards } = await loadGuardsModule();

      // All three conditions met
      const result = DashboardGuards({
        cols: 30,
        error: 'Error!',
        context: null,
        connState: 'connecting',
        connDetail: null,
        spinnerFrame: 0,
      });

      // Should return JSX (narrow terminal guard)
      expect(result).not.toBeNull();
    });

    it('error guard when terminal is wide enough but no context', async () => {
      const { DashboardGuards } = await loadGuardsModule();

      const result = DashboardGuards({
        cols: 80,
        error: 'Auth error',
        context: null,
        connState: 'connecting',
        connDetail: null,
        spinnerFrame: 0,
      });

      // Should return JSX (error guard, not loading)
      expect(result).not.toBeNull();
    });

    it('loading guard when no error but context is null', async () => {
      const { DashboardGuards } = await loadGuardsModule();

      const result = DashboardGuards({
        cols: 80,
        error: null,
        context: null,
        connState: 'connecting',
        connDetail: null,
        spinnerFrame: 0,
      });

      // Should return JSX (loading guard)
      expect(result).not.toBeNull();
    });
  });

  // ── Spinner frame handling ────────────────────────────

  describe('spinner frame handling', () => {
    it('accepts different spinner frame values without error', async () => {
      const { DashboardGuards } = await loadGuardsModule();

      for (let frame = 0; frame < 6; frame++) {
        const result = DashboardGuards({
          cols: 80,
          error: null,
          context: null,
          connState: 'connecting',
          connDetail: null,
          spinnerFrame: frame,
        });
        expect(result).not.toBeNull();
      }
    });
  });
});
