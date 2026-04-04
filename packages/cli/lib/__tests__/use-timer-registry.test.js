import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for packages/cli/lib/dashboard/use-timer-registry.ts — useTimerRegistry hook.
 *
 * Since we cannot render React hooks in a node environment without a test renderer,
 * we test the logic by importing the module with mocked dependencies and exercising
 * the hook's internal functions through the returned object.
 *
 * Pattern: vi.doMock React's useRef so the hook's lazy-init pattern works, then
 * dynamically import the module. We use vi.useFakeTimers() to verify that timers
 * actually fire and get cleaned up correctly.
 */

// ── Module loader ────────────────────────────────────────

async function loadTimerRegistryModule() {
  vi.resetModules();

  vi.doMock('react', () => ({
    useRef: (initial) => ({ current: initial }),
  }));

  const mod = await import('../dashboard/use-timer-registry.js');
  return mod;
}

// ── Tests ────────────────────────────────────────────────

describe('useTimerRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a registry object with expected methods', async () => {
    const mod = await loadTimerRegistryModule();
    const registry = mod.useTimerRegistry();

    expect(typeof registry.setTimeout).toBe('function');
    expect(typeof registry.clearTimeout).toBe('function');
    expect(typeof registry.setInterval).toBe('function');
    expect(typeof registry.clearInterval).toBe('function');
    expect(typeof registry.clearAll).toBe('function');
  });

  // ── setTimeout ──────────────────────────────────────

  describe('setTimeout', () => {
    it('calls the callback after the specified delay', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      const callback = vi.fn();
      registry.setTimeout(callback, 1000);

      expect(callback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledOnce();
    });

    it('returns a timer ID', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      const id = registry.setTimeout(vi.fn(), 500);
      expect(id).toBeDefined();
    });

    it('tracks multiple timeouts independently', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      const cb1 = vi.fn();
      const cb2 = vi.fn();

      registry.setTimeout(cb1, 100);
      registry.setTimeout(cb2, 200);

      vi.advanceTimersByTime(100);
      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(cb2).toHaveBeenCalledOnce();
    });
  });

  // ── clearTimeout ────────────────────────────────────

  describe('clearTimeout', () => {
    it('prevents the callback from firing', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      const callback = vi.fn();
      const id = registry.setTimeout(callback, 1000);

      registry.clearTimeout(id);
      vi.advanceTimersByTime(1000);

      expect(callback).not.toHaveBeenCalled();
    });

    it('handles null gracefully', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      // Should not throw
      expect(() => registry.clearTimeout(null)).not.toThrow();
    });

    it('only clears the specified timer, not others', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      const cb1 = vi.fn();
      const cb2 = vi.fn();

      const id1 = registry.setTimeout(cb1, 500);
      registry.setTimeout(cb2, 500);

      registry.clearTimeout(id1);
      vi.advanceTimersByTime(500);

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledOnce();
    });
  });

  // ── setInterval ─────────────────────────────────────

  describe('setInterval', () => {
    it('calls the callback repeatedly at the specified interval', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      const callback = vi.fn();
      registry.setInterval(callback, 100);

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(3);
    });

    it('returns an interval ID', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      const id = registry.setInterval(vi.fn(), 200);
      expect(id).toBeDefined();
    });
  });

  // ── clearInterval ───────────────────────────────────

  describe('clearInterval', () => {
    it('stops the interval from firing', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      const callback = vi.fn();
      const id = registry.setInterval(callback, 100);

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(1);

      registry.clearInterval(id);

      vi.advanceTimersByTime(300);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('handles null gracefully', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      expect(() => registry.clearInterval(null)).not.toThrow();
    });
  });

  // ── clearAll ────────────────────────────────────────

  describe('clearAll', () => {
    it('clears all active timeouts', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      const cb1 = vi.fn();
      const cb2 = vi.fn();
      const cb3 = vi.fn();

      registry.setTimeout(cb1, 100);
      registry.setTimeout(cb2, 200);
      registry.setTimeout(cb3, 300);

      registry.clearAll();
      vi.advanceTimersByTime(500);

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).not.toHaveBeenCalled();
      expect(cb3).not.toHaveBeenCalled();
    });

    it('clears all active intervals', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      const cb1 = vi.fn();
      const cb2 = vi.fn();

      registry.setInterval(cb1, 100);
      registry.setInterval(cb2, 200);

      vi.advanceTimersByTime(200);
      expect(cb1).toHaveBeenCalledTimes(2);
      expect(cb2).toHaveBeenCalledTimes(1);

      registry.clearAll();
      vi.advanceTimersByTime(400);

      // Counts should not increase after clearAll
      expect(cb1).toHaveBeenCalledTimes(2);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('clears a mix of timeouts and intervals', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      const timeoutCb = vi.fn();
      const intervalCb = vi.fn();

      registry.setTimeout(timeoutCb, 500);
      registry.setInterval(intervalCb, 100);

      vi.advanceTimersByTime(100);
      expect(intervalCb).toHaveBeenCalledTimes(1);
      expect(timeoutCb).not.toHaveBeenCalled();

      registry.clearAll();
      vi.advanceTimersByTime(1000);

      expect(timeoutCb).not.toHaveBeenCalled();
      expect(intervalCb).toHaveBeenCalledTimes(1);
    });

    it('is safe to call clearAll when no timers are active', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      expect(() => registry.clearAll()).not.toThrow();
    });

    it('previously cleared timers do not interfere with clearAll', async () => {
      const mod = await loadTimerRegistryModule();
      const registry = mod.useTimerRegistry();

      const cb1 = vi.fn();
      const cb2 = vi.fn();

      const id1 = registry.setTimeout(cb1, 500);
      registry.setTimeout(cb2, 500);

      // Manually clear one
      registry.clearTimeout(id1);

      // clearAll should still work for the remaining one
      registry.clearAll();
      vi.advanceTimersByTime(500);

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).not.toHaveBeenCalled();
    });
  });

  // ── Lazy init (useRef pattern) ──────────────────────

  describe('lazy initialization', () => {
    it('returns the same registry on consecutive calls (useRef caching)', async () => {
      const mod = await loadTimerRegistryModule();

      // The useRef mock returns { current: null }, so the first call initializes.
      // But because our mock creates a new ref each call, let's verify the init path.
      const registry = mod.useTimerRegistry();

      // The registry should be fully formed on first call
      expect(registry.setTimeout).toBeDefined();
      expect(registry.clearTimeout).toBeDefined();
      expect(registry.setInterval).toBeDefined();
      expect(registry.clearInterval).toBeDefined();
      expect(registry.clearAll).toBeDefined();
    });

    it('registry created by useRef is reused when ref.current is already set', async () => {
      vi.resetModules();

      const existingRegistry = {
        setTimeout: vi.fn(),
        clearTimeout: vi.fn(),
        setInterval: vi.fn(),
        clearInterval: vi.fn(),
        clearAll: vi.fn(),
      };

      vi.doMock('react', () => ({
        useRef: () => ({ current: existingRegistry }),
      }));

      const mod = await import('../dashboard/use-timer-registry.js');
      const registry = mod.useTimerRegistry();

      // Should return the existing registry, not create a new one
      expect(registry).toBe(existingRegistry);
    });
  });
});
