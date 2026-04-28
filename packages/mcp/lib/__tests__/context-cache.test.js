import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Re-import fresh module per test group to get clean cache state.
let refreshContext, clearContextCache, teamPreamble;

describe('context cache (TTL, inflight dedup, preamble memoization)', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../context.js');
    refreshContext = mod.refreshContext;
    clearContextCache = mod.clearContextCache;
    teamPreamble = mod.teamPreamble;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- Cache returns stale data within TTL ---

  describe('TTL behavior', () => {
    it('returns cached data within TTL without re-fetching', async () => {
      vi.useFakeTimers();
      const ctx = { members: [{ handle: 'alice', status: 'active' }] };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };

      await refreshContext(team, 't_abc');
      expect(team.getTeamContext).toHaveBeenCalledTimes(1);

      // Advance to 29 seconds - still within 30s TTL
      vi.advanceTimersByTime(29_000);

      const result = await refreshContext(team, 't_abc');
      expect(result).toEqual(ctx);
      expect(team.getTeamContext).toHaveBeenCalledTimes(1); // No re-fetch
    });

    it('returns stale data at exactly TTL boundary (< check)', async () => {
      vi.useFakeTimers();
      const ctx = { members: [] };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };

      await refreshContext(team, 't_abc');

      // Advance to exactly 29.999s - still within TTL
      vi.advanceTimersByTime(29_999);

      await refreshContext(team, 't_abc');
      expect(team.getTeamContext).toHaveBeenCalledTimes(1);
    });

    // --- Cache refreshes after TTL expires ---

    it('re-fetches after TTL expires', async () => {
      vi.useFakeTimers();
      const ctx1 = { members: [{ handle: 'alice' }] };
      const ctx2 = { members: [{ handle: 'bob' }] };
      const team = {
        getTeamContext: vi.fn().mockResolvedValueOnce(ctx1).mockResolvedValueOnce(ctx2),
      };

      await refreshContext(team, 't_abc');
      expect(team.getTeamContext).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(31_000);

      const result = await refreshContext(team, 't_abc');
      expect(team.getTeamContext).toHaveBeenCalledTimes(2);
      expect(result).toEqual(ctx2);
    });

    it('refreshes when team ID changes even within TTL', async () => {
      const ctx1 = { members: [{ handle: 'alice' }] };
      const ctx2 = { members: [{ handle: 'bob' }] };
      const team = {
        getTeamContext: vi.fn().mockResolvedValueOnce(ctx1).mockResolvedValueOnce(ctx2),
      };

      await refreshContext(team, 't_team_a');
      const result = await refreshContext(team, 't_team_b');

      expect(team.getTeamContext).toHaveBeenCalledTimes(2);
      expect(result).toEqual(ctx2);
    });
  });

  // --- Inflight deduplication ---

  describe('inflight deduplication', () => {
    it('concurrent calls share the same promise', async () => {
      let resolveApi;
      const apiPromise = new Promise((resolve) => {
        resolveApi = resolve;
      });
      const ctx = { members: [{ handle: 'alice' }] };
      const team = { getTeamContext: vi.fn().mockReturnValue(apiPromise) };

      // Fire two concurrent refreshes - neither should have resolved yet
      const p1 = refreshContext(team, 't_abc');
      const p2 = refreshContext(team, 't_abc');

      // Only one API call should be in flight
      expect(team.getTeamContext).toHaveBeenCalledTimes(1);

      // Resolve the shared promise
      resolveApi(ctx);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual(ctx);
      expect(r2).toEqual(ctx);
      expect(team.getTeamContext).toHaveBeenCalledTimes(1);
    });

    it('clears inflight after resolution allowing subsequent fetches', async () => {
      vi.useFakeTimers();
      const ctx1 = { members: [] };
      const ctx2 = { members: [{ handle: 'bob' }] };
      const team = {
        getTeamContext: vi.fn().mockResolvedValueOnce(ctx1).mockResolvedValueOnce(ctx2),
      };

      await refreshContext(team, 't_abc');
      expect(team.getTeamContext).toHaveBeenCalledTimes(1);

      // Bust TTL
      vi.advanceTimersByTime(31_000);

      const result = await refreshContext(team, 't_abc');
      expect(team.getTeamContext).toHaveBeenCalledTimes(2);
      expect(result).toEqual(ctx2);
    });

    it('clears inflight even when the API call rejects', async () => {
      vi.useFakeTimers();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const ctx = { members: [] };
      const team = {
        getTeamContext: vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(ctx),
      };

      // First call fails - inflight should be cleared
      await refreshContext(team, 't_abc');

      // Second call should try again (cache was never populated so TTL check is skipped)
      const result = await refreshContext(team, 't_abc');
      expect(team.getTeamContext).toHaveBeenCalledTimes(2);
      expect(result).toEqual(ctx);
      consoleSpy.mockRestore();
    });
  });

  // --- Preamble memoization ---

  describe('preamble memoization', () => {
    it('returns full preamble on first call', async () => {
      const ctx = {
        members: [
          { handle: 'alice', status: 'active', tool: 'cursor', activity: { files: ['app.js'] } },
        ],
      };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };

      const result = await teamPreamble(team, 't_abc');
      expect(result).toMatch(/\[Team: alice \(cursor\): app\.js\]/);
      expect(result).toMatch(/\n\n$/);
    });

    it('returns empty prefix when state string has not changed', async () => {
      vi.useFakeTimers();
      const ctx = {
        members: [{ handle: 'alice', status: 'active', activity: { files: ['a.js'] } }],
      };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };

      // First call: full preamble
      const first = await teamPreamble(team, 't_abc');
      expect(first).toMatch(/\[Team:/);

      // Bust TTL, but context is unchanged
      vi.advanceTimersByTime(31_000);

      const second = await teamPreamble(team, 't_abc');
      expect(second).toBe(''); // Memoized - no new info
    });

    it('returns full preamble again when state changes', async () => {
      vi.useFakeTimers();
      const ctx1 = {
        members: [{ handle: 'alice', status: 'active', activity: { files: ['a.js'] } }],
      };
      const ctx2 = {
        members: [{ handle: 'alice', status: 'active', activity: { files: ['b.js'] } }],
      };
      const team = {
        getTeamContext: vi.fn().mockResolvedValueOnce(ctx1).mockResolvedValueOnce(ctx2),
      };

      const first = await teamPreamble(team, 't_abc');
      expect(first).toMatch(/a\.js/);

      vi.advanceTimersByTime(31_000);

      const second = await teamPreamble(team, 't_abc');
      expect(second).toMatch(/b\.js/);
      expect(second).toMatch(/\[Team:/);
    });

    it('treats lock count changes as state change', async () => {
      vi.useFakeTimers();
      const ctx1 = {
        members: [{ handle: 'alice', status: 'active', activity: { files: ['a.js'] } }],
        locks: [],
      };
      const ctx2 = {
        members: [{ handle: 'alice', status: 'active', activity: { files: ['a.js'] } }],
        locks: [{ file_path: 'a.js' }],
      };
      const team = {
        getTeamContext: vi.fn().mockResolvedValueOnce(ctx1).mockResolvedValueOnce(ctx2),
      };

      await teamPreamble(team, 't_abc');
      vi.advanceTimersByTime(31_000);

      const second = await teamPreamble(team, 't_abc');
      expect(second).toMatch(/1 locked file/);
    });

    it('treats message count changes as state change', async () => {
      vi.useFakeTimers();
      const ctx1 = {
        members: [{ handle: 'alice', status: 'active', activity: { files: ['a.js'] } }],
        messages: [],
      };
      const ctx2 = {
        members: [{ handle: 'alice', status: 'active', activity: { files: ['a.js'] } }],
        messages: [{ text: 'hello' }, { text: 'world' }],
      };
      const team = {
        getTeamContext: vi.fn().mockResolvedValueOnce(ctx1).mockResolvedValueOnce(ctx2),
      };

      await teamPreamble(team, 't_abc');
      vi.advanceTimersByTime(31_000);

      const second = await teamPreamble(team, 't_abc');
      expect(second).toMatch(/2 messages/);
    });
  });

  // --- clearContextCache resets memoization ---

  describe('clearContextCache', () => {
    it('resets preamble memoization so next call returns full preamble', async () => {
      const ctx = {
        members: [{ handle: 'alice', status: 'active', activity: { files: ['a.js'] } }],
      };
      const team = { getTeamContext: vi.fn().mockResolvedValue(ctx) };

      const first = await teamPreamble(team, 't_abc');
      expect(first).toMatch(/\[Team:/);

      clearContextCache();

      const afterClear = await teamPreamble(team, 't_abc');
      expect(afterClear).toMatch(/\[Team:/); // Full preamble again
    });
  });
});
