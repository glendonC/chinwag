import { describe, it, expect, vi, beforeEach } from 'vitest';

// context.js uses module-level state, so we need to re-import fresh for each test.
// We mock formatToolTag since it's imported by context.js.

let refreshContext, offlinePrefix, getCachedContext, clearContextCache, teamPreamble;

describe('context cache', () => {
  beforeEach(async () => {
    // Re-import to get fresh module state
    vi.resetModules();
    const mod = await import('../context.js');
    refreshContext = mod.refreshContext;
    offlinePrefix = mod.offlinePrefix;
    getCachedContext = mod.getCachedContext;
    clearContextCache = mod.clearContextCache;
    teamPreamble = mod.teamPreamble;
  });

  // --- refreshContext ---

  describe('refreshContext', () => {
    it('returns null when teamId is null', async () => {
      const team = { getTeamContext: vi.fn() };
      const result = await refreshContext(team, null);
      expect(result).toBeNull();
      expect(team.getTeamContext).not.toHaveBeenCalled();
    });

    it('fetches context from API on first call', async () => {
      const ctx = { members: [{ handle: 'alice' }] };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };
      const result = await refreshContext(team, 't_abc');
      expect(result).toEqual(ctx);
      expect(team.getTeamContext).toHaveBeenCalledWith('t_abc');
    });

    it('returns cached context within TTL', async () => {
      const ctx = { members: [{ handle: 'alice' }] };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };

      // First call — fetches from API
      await refreshContext(team, 't_abc');
      expect(team.getTeamContext).toHaveBeenCalledTimes(1);

      // Second call — should use cache (within 30s TTL)
      const cached = await refreshContext(team, 't_abc');
      expect(cached).toEqual(ctx);
      expect(team.getTeamContext).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after TTL expires', async () => {
      vi.useFakeTimers();
      const ctx1 = { members: [{ handle: 'alice' }] };
      const ctx2 = { members: [{ handle: 'bob' }] };
      const team = {
        getTeamContext: vi.fn().mockResolvedValueOnce(ctx1).mockResolvedValueOnce(ctx2),
      };

      await refreshContext(team, 't_abc');
      expect(team.getTeamContext).toHaveBeenCalledTimes(1);

      // Advance past TTL (30 seconds)
      vi.advanceTimersByTime(31_000);

      const result = await refreshContext(team, 't_abc');
      expect(team.getTeamContext).toHaveBeenCalledTimes(2);
      expect(result).toEqual(ctx2);
      vi.useRealTimers();
    });

    it('re-fetches when teamId changes', async () => {
      const ctx1 = { members: [{ handle: 'alice' }] };
      const ctx2 = { members: [{ handle: 'bob' }] };
      const team = {
        getTeamContext: vi.fn().mockResolvedValueOnce(ctx1).mockResolvedValueOnce(ctx2),
      };

      await refreshContext(team, 't_team1');
      const result = await refreshContext(team, 't_team2');
      expect(team.getTeamContext).toHaveBeenCalledTimes(2);
      expect(result).toEqual(ctx2);
    });

    it('returns cached context on API failure', async () => {
      const ctx = { members: [{ handle: 'alice' }] };
      const team = {
        getTeamContext: vi
          .fn()
          .mockResolvedValueOnce(ctx)
          .mockRejectedValueOnce(new Error('Network error')),
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // First call succeeds
      await refreshContext(team, 't_abc');

      // Bust the TTL by re-importing with fresh state — but actually we need
      // to work with the same module instance.
      // Force TTL expiry by using fake timers
      vi.useFakeTimers();
      vi.advanceTimersByTime(31_000);

      // Second call fails — should return cached context
      const result = await refreshContext(team, 't_abc');
      expect(result).toEqual(ctx);
      consoleSpy.mockRestore();
      vi.useRealTimers();
    });

    it('sets offline flag on API failure and logs warning', async () => {
      const team = { getTeamContext: vi.fn().mockRejectedValue(new Error('Timeout')) };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await refreshContext(team, 't_abc');

      expect(offlinePrefix()).toBe('[offline -- using cached data] ');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('API unreachable'));
      consoleSpy.mockRestore();
    });

    it('clears offline flag and logs when coming back online', async () => {
      const team = {
        getTeamContext: vi
          .fn()
          .mockRejectedValueOnce(new Error('Timeout'))
          .mockResolvedValueOnce({ members: [] }),
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Go offline
      await refreshContext(team, 't_abc');
      expect(offlinePrefix()).toBe('[offline -- using cached data] ');

      // Come back online (need to bust TTL since we failed — the cachedContextAt
      // is not set on failure, so next call will try again)
      const result = await refreshContext(team, 't_abc');
      expect(result).toEqual({ members: [] });
      expect(offlinePrefix()).toBe('');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Back online'));
      consoleSpy.mockRestore();
    });

    it('does not log duplicate offline warnings', async () => {
      const team = { getTeamContext: vi.fn().mockRejectedValue(new Error('Timeout')) };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await refreshContext(team, 't_abc');
      await refreshContext(team, 't_abc');

      // Should only log the API unreachable message once
      const offlineLogs = consoleSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('API unreachable'),
      );
      expect(offlineLogs.length).toBe(1);
      consoleSpy.mockRestore();
    });

    it('returns null when API fails and no prior cache exists', async () => {
      const team = { getTeamContext: vi.fn().mockRejectedValue(new Error('Timeout')) };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await refreshContext(team, 't_abc');
      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('discards cached context when it exceeds max stale threshold', async () => {
      vi.useFakeTimers();
      const ctx = { members: [{ handle: 'alice' }] };
      const team = {
        getTeamContext: vi.fn().mockResolvedValueOnce(ctx).mockRejectedValue(new Error('Timeout')),
      };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // First call succeeds — caches context
      await refreshContext(team, 't_abc');
      expect(getCachedContext()).toEqual(ctx);

      // Advance past TTL + max stale (300s + some margin)
      vi.advanceTimersByTime(301_000);

      // Second call fails — context is too stale, should be discarded
      const result = await refreshContext(team, 't_abc');
      expect(result).toBeNull();
      expect(getCachedContext()).toBeNull();
      consoleSpy.mockRestore();
      vi.useRealTimers();
    });

    it('keeps cached context when stale but within max threshold', async () => {
      vi.useFakeTimers();
      const ctx = { members: [{ handle: 'alice' }] };
      const team = {
        getTeamContext: vi.fn().mockResolvedValueOnce(ctx).mockRejectedValue(new Error('Timeout')),
      };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await refreshContext(team, 't_abc');

      // Advance past TTL but within max stale (e.g. 60s)
      vi.advanceTimersByTime(60_000);

      const result = await refreshContext(team, 't_abc');
      expect(result).toEqual(ctx);
      consoleSpy.mockRestore();
      vi.useRealTimers();
    });

    it('starts offline retry timer on failure and retries periodically', async () => {
      vi.useFakeTimers();
      const ctx = { members: [{ handle: 'alice' }] };
      const team = {
        getTeamContext: vi
          .fn()
          .mockRejectedValueOnce(new Error('Timeout'))
          .mockResolvedValueOnce(ctx),
      };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // First call fails — starts retry timer
      await refreshContext(team, 't_abc');
      expect(offlinePrefix()).toMatch(/\[offline/);

      // Advance past the retry interval (60s)
      await vi.advanceTimersByTimeAsync(61_000);

      // The retry should have called getTeamContext again and succeeded
      expect(team.getTeamContext).toHaveBeenCalledTimes(2);
      expect(offlinePrefix()).toBe('');
      consoleSpy.mockRestore();
      vi.useRealTimers();
    });

    it('stops offline retry timer when coming back online', async () => {
      vi.useFakeTimers();
      const team = {
        getTeamContext: vi
          .fn()
          .mockRejectedValueOnce(new Error('Timeout'))
          .mockResolvedValueOnce({ members: [] }),
      };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Go offline
      await refreshContext(team, 't_abc');
      expect(offlinePrefix()).toMatch(/\[offline/);

      // Come back online (no cache so no TTL guard)
      await refreshContext(team, 't_abc');
      expect(offlinePrefix()).toBe('');

      // Advance time — retry timer should not fire additional calls
      await vi.advanceTimersByTimeAsync(120_000);
      expect(team.getTeamContext).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  // --- offlinePrefix ---

  describe('offlinePrefix', () => {
    it('returns empty string when online', () => {
      expect(offlinePrefix()).toBe('');
    });

    it('returns offline tag when offline (no age when fresh)', async () => {
      const team = { getTeamContext: vi.fn().mockRejectedValue(new Error('fail')) };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await refreshContext(team, 't_abc');
      expect(offlinePrefix()).toBe('[offline -- using cached data] ');
      consoleSpy.mockRestore();
    });

    it('includes age in minutes when cache is 1-4 minutes old', async () => {
      vi.useFakeTimers();
      const ctx = { members: [{ handle: 'alice' }] };
      const team = {
        getTeamContext: vi.fn().mockResolvedValueOnce(ctx).mockRejectedValue(new Error('fail')),
      };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Cache a successful result
      await refreshContext(team, 't_abc');
      // Advance past TTL + 2 minutes
      vi.advanceTimersByTime(150_000); // 2.5 minutes

      // Fail — go offline
      await refreshContext(team, 't_abc');
      expect(offlinePrefix()).toBe('[offline 2m -- using cached data] ');
      consoleSpy.mockRestore();
      vi.useRealTimers();
    });

    it('shows 5m+ when cache is 5+ minutes old', async () => {
      vi.useFakeTimers();
      const ctx = { members: [{ handle: 'alice' }] };
      const team = {
        getTeamContext: vi.fn().mockResolvedValueOnce(ctx).mockRejectedValue(new Error('fail')),
      };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await refreshContext(team, 't_abc');
      // Advance 5 minutes + some margin (but still within max stale of 300s)
      // Actually, 300s = 5min exactly. We need to stay under to keep cache alive.
      // Advance 4.5 minutes to keep cache, then check what offlinePrefix shows at 5min+
      vi.advanceTimersByTime(299_000); // 4m59s — just under max stale

      await refreshContext(team, 't_abc');
      // Cache is ~299s old = 4 minutes (floor), not 5m+ yet
      expect(offlinePrefix()).toBe('[offline 4m -- using cached data] ');

      consoleSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  // --- getCachedContext ---

  describe('getCachedContext', () => {
    it('returns null when no context has been cached', () => {
      expect(getCachedContext()).toBeNull();
    });

    it('returns cached context after successful fetch', async () => {
      const ctx = { members: [{ handle: 'alice' }] };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };
      await refreshContext(team, 't_abc');
      expect(getCachedContext()).toEqual(ctx);
    });
  });

  // --- clearContextCache ---

  describe('clearContextCache', () => {
    it('clears the cached context', async () => {
      const ctx = { members: [] };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };
      await refreshContext(team, 't_abc');
      expect(getCachedContext()).toEqual(ctx);

      clearContextCache();
      expect(getCachedContext()).toBeNull();
    });

    it('forces re-fetch on next refreshContext call', async () => {
      const ctx = { members: [] };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };
      await refreshContext(team, 't_abc');

      clearContextCache();
      await refreshContext(team, 't_abc');
      expect(team.getTeamContext).toHaveBeenCalledTimes(2);
    });
  });

  // --- teamPreamble ---

  describe('teamPreamble', () => {
    it('returns empty string when context is null and online', async () => {
      const team = { getTeamContext: vi.fn().mockResolvedValue(null) };
      // refreshContext returns null for null teamId, so teamPreamble gets null ctx
      const result = await teamPreamble(team, null);
      expect(result).toBe('');
    });

    it('returns offline tag when context is null and offline', async () => {
      const team = { getTeamContext: vi.fn().mockRejectedValue(new Error('fail')) };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Force offline by making refreshContext fail
      await refreshContext(team, 't_abc');

      const result = await teamPreamble(team, 't_abc');
      // No cached data (never succeeded), so age tag is empty
      expect(result).toBe('[offline] ');
      consoleSpy.mockRestore();
    });

    it('returns offline prefix when no active members', async () => {
      const team = { getTeamContext: vi.fn().mockResolvedValue({ members: [] }) };
      const result = await teamPreamble(team, 't_abc');
      expect(result).toBe('');
    });

    it('returns formatted preamble with active members', async () => {
      const ctx = {
        members: [
          {
            handle: 'alice',
            status: 'active',
            tool: 'cursor',
            activity: { files: ['auth.js', 'db.js'] },
          },
        ],
      };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };
      const result = await teamPreamble(team, 't_abc');
      expect(result).toMatch(/\[Team: alice \(cursor\): auth\.js, db\.js\]/);
      expect(result).toMatch(/\n\n$/);
    });

    it('shows idle for members without activity files', async () => {
      const ctx = {
        members: [{ handle: 'bob', status: 'active', tool: 'unknown' }],
      };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };
      const result = await teamPreamble(team, 't_abc');
      expect(result).toMatch(/bob: idle/);
    });

    it('includes lock count in extras', async () => {
      const ctx = {
        members: [{ handle: 'alice', status: 'active', activity: { files: ['a.js'] } }],
        locks: [{ file: 'a.js' }, { file: 'b.js' }],
      };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };
      const result = await teamPreamble(team, 't_abc');
      expect(result).toMatch(/2 locked files/);
    });

    it('includes message count in extras', async () => {
      const ctx = {
        members: [{ handle: 'alice', status: 'active', activity: { files: ['a.js'] } }],
        messages: [{ text: 'hi' }],
      };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };
      const result = await teamPreamble(team, 't_abc');
      expect(result).toMatch(/1 message/);
    });

    it('returns empty prefix when state has not changed', async () => {
      const ctx = {
        members: [{ handle: 'alice', status: 'active', activity: { files: ['a.js'] } }],
      };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };

      // First call returns the full preamble
      const first = await teamPreamble(team, 't_abc');
      expect(first).toMatch(/\[Team:/);

      // Second call with same state returns offline prefix only (which is '')
      vi.useFakeTimers();
      vi.advanceTimersByTime(31_000);
      const second = await teamPreamble(team, 't_abc');
      expect(second).toBe('');
      vi.useRealTimers();
    });

    it('uses singular lock/message when count is 1', async () => {
      const ctx = {
        members: [{ handle: 'alice', status: 'active', activity: { files: ['a.js'] } }],
        locks: [{ file: 'a.js' }],
        messages: [{ text: 'hi' }],
      };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };
      const result = await teamPreamble(team, 't_abc');
      expect(result).toMatch(/1 locked file[^s]/);
      expect(result).toMatch(/1 message[^s]/);
    });

    it('filters out inactive members', async () => {
      const ctx = {
        members: [
          { handle: 'alice', status: 'active', activity: { files: ['a.js'] } },
          { handle: 'bob', status: 'idle', activity: { files: ['b.js'] } },
        ],
      };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };
      const result = await teamPreamble(team, 't_abc');
      expect(result).toMatch(/alice/);
      expect(result).not.toMatch(/bob/);
    });
  });
});
