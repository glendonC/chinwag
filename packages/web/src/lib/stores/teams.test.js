import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadTeamsModule({ token = 'tok_123', apiMock = vi.fn(), forceRefreshMock = vi.fn() } = {}) {
  vi.resetModules();
  vi.doMock('../api.js', () => ({
    api: apiMock,
  }));
  vi.doMock('./auth.js', () => ({
    authActions: {
      getState: () => ({ token }),
    },
  }));
  vi.doMock('./polling.js', () => ({
    forceRefresh: forceRefreshMock,
  }));
  const mod = await import('./teams.js');
  return { ...mod, apiMock, forceRefreshMock };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('team store', () => {
  it('loads teams and enters overview mode when multiple teams exist', async () => {
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

  it('loads teams and auto-selects the only team', async () => {
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

  it('clears teams when loading fails', async () => {
    const apiMock = vi.fn().mockRejectedValue(new Error('offline'));
    const { teamActions } = await loadTeamsModule({ apiMock });

    await teamActions.loadTeams();

    expect(teamActions.getState()).toMatchObject({
      teams: [],
      activeTeamId: null,
    });
  });

  it('only joins a team once per session', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ok: true });
    const { teamActions } = await loadTeamsModule({ apiMock });

    await teamActions.ensureJoined('t_repeat');
    await teamActions.ensureJoined('t_repeat');

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('POST', '/teams/t_repeat/join', {}, 'tok_123');
  });

  it('updates memory and triggers a refresh', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ok: true });
    const forceRefreshMock = vi.fn();
    const { teamActions } = await loadTeamsModule({ apiMock, forceRefreshMock });

    await teamActions.updateMemory('t_team', 'mem_1', 'Updated note', 'decision');

    expect(apiMock).toHaveBeenCalledWith('PUT', '/teams/t_team/memory', {
      id: 'mem_1',
      text: 'Updated note',
      category: 'decision',
    }, 'tok_123');
    expect(forceRefreshMock).toHaveBeenCalledTimes(1);
  });

  it('deletes memories and sends messages through the API', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ok: true });
    const forceRefreshMock = vi.fn();
    const { teamActions } = await loadTeamsModule({ apiMock, forceRefreshMock });

    await teamActions.deleteMemory('t_team', 'mem_1');
    await teamActions.sendMessage('t_team', 'Heads up', 'cursor:abc123');

    expect(apiMock).toHaveBeenNthCalledWith(1, 'DELETE', '/teams/t_team/memory', { id: 'mem_1' }, 'tok_123');
    expect(apiMock).toHaveBeenNthCalledWith(2, 'POST', '/teams/t_team/messages', {
      text: 'Heads up',
      target: 'cursor:abc123',
    }, 'tok_123');
    expect(forceRefreshMock).toHaveBeenCalledTimes(2);
  });
});
