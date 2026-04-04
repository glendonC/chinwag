import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadTeamsModule({
  token = 'tok_123',
  apiMock = vi.fn(),
  requestRefreshMock = vi.fn(),
} = {}) {
  vi.resetModules();
  vi.doMock('../api.js', () => ({
    api: apiMock,
  }));
  vi.doMock('./auth.js', () => ({
    authActions: {
      getState: () => ({ token }),
    },
  }));
  vi.doMock('./refresh.js', () => ({
    requestRefresh: requestRefreshMock,
  }));
  const mod = await import('../teams.js');
  return { ...mod, apiMock, requestRefreshMock };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('team store', () => {
  describe('team selection', () => {
    it('selects a specific team', async () => {
      const apiMock = vi.fn().mockResolvedValue({
        teams: [{ team_id: 't_one' }, { team_id: 't_two' }],
      });
      const { teamActions } = await loadTeamsModule({ apiMock });

      await teamActions.loadTeams();
      teamActions.selectTeam('t_two');

      expect(teamActions.getState().activeTeamId).toBe('t_two');
    });

    it('selects null for overview mode', async () => {
      const apiMock = vi.fn().mockResolvedValue({
        teams: [{ team_id: 't_solo' }],
      });
      const { teamActions } = await loadTeamsModule({ apiMock });

      await teamActions.loadTeams();
      expect(teamActions.getState().activeTeamId).toBe('t_solo');

      teamActions.selectTeam(null);
      expect(teamActions.getState().activeTeamId).toBeNull();
    });

    it('auto-selects overview when multiple teams exist', async () => {
      const apiMock = vi.fn().mockResolvedValue({
        teams: [{ team_id: 't_one' }, { team_id: 't_two' }],
      });
      const { teamActions } = await loadTeamsModule({ apiMock });

      await teamActions.loadTeams();

      expect(teamActions.getState()).toMatchObject({
        teams: [{ team_id: 't_one' }, { team_id: 't_two' }],
        activeTeamId: null,
      });
    });

    it('auto-selects the only team when there is exactly one', async () => {
      const apiMock = vi.fn().mockResolvedValue({
        teams: [{ team_id: 't_solo' }],
      });
      const { teamActions } = await loadTeamsModule({ apiMock });

      await teamActions.loadTeams();

      expect(teamActions.getState()).toMatchObject({
        teams: [{ team_id: 't_solo' }],
        activeTeamId: 't_solo',
      });
    });
  });

  describe('joined teams tracking', () => {
    it('only joins a team once per session', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ok: true });
      const { teamActions } = await loadTeamsModule({ apiMock });

      await teamActions.ensureJoined('t_repeat');
      await teamActions.ensureJoined('t_repeat');

      expect(apiMock).toHaveBeenCalledTimes(1);
      expect(apiMock).toHaveBeenCalledWith('POST', '/teams/t_repeat/join', {}, 'tok_123');
    });

    it('resets the join cache when the auth token changes', async () => {
      const tokenState = { token: 'tok_123' };
      vi.resetModules();
      const apiMock = vi.fn().mockResolvedValue({ ok: true });
      const requestRefreshMock = vi.fn();
      vi.doMock('../api.js', () => ({
        api: apiMock,
      }));
      vi.doMock('./auth.js', () => ({
        authActions: {
          getState: () => tokenState,
        },
      }));
      vi.doMock('./refresh.js', () => ({
        requestRefresh: requestRefreshMock,
      }));
      const { teamActions } = await import('../teams.js');

      await teamActions.ensureJoined('t_repeat');
      tokenState.token = 'tok_456';
      await teamActions.ensureJoined('t_repeat');

      expect(apiMock).toHaveBeenCalledTimes(2);
    });

    it('handles join failure silently', async () => {
      const apiMock = vi.fn().mockRejectedValue(new Error('Server error'));
      const { teamActions } = await loadTeamsModule({ apiMock });

      // Should not throw
      await expect(teamActions.ensureJoined('t_fail')).resolves.toBeUndefined();
    });
  });

  describe('memory operations', () => {
    it('updates memory and triggers a refresh', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ok: true });
      const requestRefreshMock = vi.fn();
      const { teamActions } = await loadTeamsModule({ apiMock, requestRefreshMock });

      await teamActions.updateMemory('t_team', 'mem_1', 'Updated note', ['decision', 'api']);

      expect(apiMock).toHaveBeenCalledWith(
        'PUT',
        '/teams/t_team/memory',
        { id: 'mem_1', text: 'Updated note', tags: ['decision', 'api'] },
        'tok_123',
      );
      expect(requestRefreshMock).toHaveBeenCalledTimes(1);
    });

    it('deletes memory and triggers a refresh', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ok: true });
      const requestRefreshMock = vi.fn();
      const { teamActions } = await loadTeamsModule({ apiMock, requestRefreshMock });

      await teamActions.deleteMemory('t_team', 'mem_1');

      expect(apiMock).toHaveBeenCalledWith(
        'DELETE',
        '/teams/t_team/memory',
        { id: 'mem_1' },
        'tok_123',
      );
      expect(requestRefreshMock).toHaveBeenCalledTimes(1);
    });

    it('updates memory with only text (no tags)', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ok: true });
      const requestRefreshMock = vi.fn();
      const { teamActions } = await loadTeamsModule({ apiMock, requestRefreshMock });

      await teamActions.updateMemory('t_team', 'mem_1', 'Just text');

      expect(apiMock).toHaveBeenCalledWith(
        'PUT',
        '/teams/t_team/memory',
        { id: 'mem_1', text: 'Just text' },
        'tok_123',
      );
    });

    it('sends a message with a target', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ok: true });
      const requestRefreshMock = vi.fn();
      const { teamActions } = await loadTeamsModule({ apiMock, requestRefreshMock });

      await teamActions.sendMessage('t_team', 'Heads up', 'cursor:abc123');

      expect(apiMock).toHaveBeenCalledWith(
        'POST',
        '/teams/t_team/messages',
        { text: 'Heads up', target: 'cursor:abc123' },
        'tok_123',
      );
      expect(requestRefreshMock).toHaveBeenCalledTimes(1);
    });

    it('sends a message without a target', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ok: true });
      const requestRefreshMock = vi.fn();
      const { teamActions } = await loadTeamsModule({ apiMock, requestRefreshMock });

      await teamActions.sendMessage('t_team', 'Broadcast');

      expect(apiMock).toHaveBeenCalledWith(
        'POST',
        '/teams/t_team/messages',
        { text: 'Broadcast' },
        'tok_123',
      );
    });
  });

  describe('error handling', () => {
    it('records a load error when loading teams fails', async () => {
      const apiMock = vi.fn().mockRejectedValue(new Error('offline'));
      const { teamActions } = await loadTeamsModule({ apiMock });

      await teamActions.loadTeams();

      expect(teamActions.getState()).toMatchObject({
        teams: [],
        activeTeamId: null,
        teamsError: 'offline',
      });
    });

    it('formats 401 errors with session expired message', async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 });
      const apiMock = vi.fn().mockRejectedValue(err);
      const { teamActions } = await loadTeamsModule({ apiMock });

      await teamActions.loadTeams();

      expect(teamActions.getState().teamsError).toBe('Your session expired. Sign in again.');
    });

    it('formats 408 errors with timeout message', async () => {
      const err = Object.assign(new Error('Timeout'), { status: 408 });
      const apiMock = vi.fn().mockRejectedValue(err);
      const { teamActions } = await loadTeamsModule({ apiMock });

      await teamActions.loadTeams();

      expect(teamActions.getState().teamsError).toBe('Request timed out while loading projects.');
    });

    it('formats network failures', async () => {
      const err = new TypeError('Failed to fetch');
      const apiMock = vi.fn().mockRejectedValue(err);
      const { teamActions } = await loadTeamsModule({ apiMock });

      await teamActions.loadTeams();

      expect(teamActions.getState().teamsError).toBe('Cannot reach server to load projects.');
    });
  });
});
