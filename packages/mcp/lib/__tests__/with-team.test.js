import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the context module
vi.mock('../context.js', () => ({
  refreshContext: vi.fn().mockResolvedValue(null),
  teamPreamble: vi.fn().mockResolvedValue(''),
  offlinePrefix: vi.fn().mockReturnValue(''),
  getCachedContext: vi.fn().mockReturnValue(null),
  clearContextCache: vi.fn(),
}));

import { teamPreamble } from '../context.js';
import { withTeam } from '../tools/index.js';

describe('withTeam middleware', () => {
  let team, state, deps;

  beforeEach(() => {
    vi.clearAllMocks();
    team = {
      getTeamContext: vi.fn().mockResolvedValue({ members: [] }),
    };
    state = { teamId: 't_test' };
    deps = { team, state };
    teamPreamble.mockResolvedValue('[Team: alice: auth.js]\n\n');
  });

  it('returns noTeam error when teamId is null', async () => {
    state.teamId = null;
    const handler = withTeam(deps, async () => {
      return { content: [{ type: 'text', text: 'should not reach' }] };
    });

    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in a team/i);
  });

  it('passes preamble to handler', async () => {
    const handler = withTeam(deps, async (args, { preamble }) => {
      return { content: [{ type: 'text', text: `${preamble}Hello` }] };
    });

    const result = await handler({});
    expect(result.content[0].text).toMatch(/^\[Team: alice: auth\.js\]/);
    expect(result.content[0].text).toMatch(/Hello$/);
  });

  it('skips preamble when skipPreamble option is true', async () => {
    const handler = withTeam(
      deps,
      async (args, { preamble }) => {
        return { content: [{ type: 'text', text: `${preamble}Hello` }] };
      },
      { skipPreamble: true },
    );

    const result = await handler({});
    expect(result.content[0].text).toBe('Hello');
    expect(teamPreamble).not.toHaveBeenCalled();
  });

  it('catches errors and returns errorResult', async () => {
    const handler = withTeam(deps, async () => {
      throw new Error('Something broke');
    });

    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Something broke');
  });

  it('returns auth error for 401 status', async () => {
    const handler = withTeam(deps, async () => {
      const err = new Error('Unauthorized');
      err.status = 401;
      throw err;
    });

    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Authentication expired/);
  });

  it('passes args to the handler', async () => {
    const handler = withTeam(deps, async ({ name }, { preamble }) => {
      return { content: [{ type: 'text', text: `${preamble}Hi ${name}` }] };
    });

    const result = await handler({ name: 'Bob' });
    expect(result.content[0].text).toMatch(/Hi Bob/);
  });

  it('handler can return isError results without the catch intercepting', async () => {
    const handler = withTeam(deps, async () => {
      return { content: [{ type: 'text', text: 'Custom error' }], isError: true };
    });

    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Custom error');
  });

  // ── Team-join race guard ─────────────────────────────────────────────────
  // Tool calls that race the initial joinTeamOnce would hit the backend before
  // the DO registered membership and get a 403. withTeam awaits a pending join
  // promise so the first call blocks until membership is real.

  it('waits for teamJoinComplete before running handler', async () => {
    const order = [];
    let resolveJoin;
    state.teamJoinComplete = new Promise((res) => {
      resolveJoin = () => {
        order.push('join-resolved');
        res();
      };
    });

    const handler = withTeam(deps, async () => {
      order.push('handler-ran');
      return { content: [{ type: 'text', text: 'ok' }] };
    });

    const resultPromise = handler({});
    // Give the event loop a tick so handler would have run if unguarded.
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([]);

    resolveJoin();
    await resultPromise;
    expect(order).toEqual(['join-resolved', 'handler-ran']);
  });

  it('surfaces noTeam error when join settles with teamId cleared', async () => {
    state.teamJoinComplete = Promise.resolve();
    state.teamId = null;
    state.teamJoinError = 'Join failed for team "t_x": network down';

    const handler = withTeam(deps, async () => {
      return { content: [{ type: 'text', text: 'should not reach' }] };
    });

    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/network down/);
  });

  it('no wait when teamJoinComplete is null (post-join steady state)', async () => {
    state.teamJoinComplete = null;
    const handler = withTeam(deps, async () => {
      return { content: [{ type: 'text', text: 'ran' }] };
    });
    const result = await handler({});
    expect(result.content[0].text).toMatch(/ran$/);
  });
});
