import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../diff-state.js', () => ({
  diffState: vi.fn().mockReturnValue([]),
}));

import { diffState } from '../diff-state.js';
import { createReconciler } from '../channel-reconcile.js';

describe('createReconciler', () => {
  let team, opts, logger;
  const teamId = 't_reconcile';
  const stucknessAlerted = new Map();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    diffState.mockReturnValue([]);

    team = {
      getTeamContext: vi.fn().mockResolvedValue({ members: [], locks: [], memories: [] }),
    };
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    opts = {
      team,
      teamId,
      getLocalContext: vi.fn().mockReturnValue({ members: [{ agent_id: 'local' }] }),
      replaceContext: vi.fn(),
      onEvents: vi.fn(),
      stucknessAlerted,
      isWsConnected: vi.fn().mockReturnValue(true),
      logger,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls at 60s interval when WS is connected', async () => {
    const r = createReconciler(opts);
    r.start();

    // Should not poll immediately
    expect(team.getTeamContext).not.toHaveBeenCalled();

    // After 60s
    await vi.advanceTimersByTimeAsync(60_000);
    expect(team.getTeamContext).toHaveBeenCalledTimes(1);
    expect(team.getTeamContext).toHaveBeenCalledWith(teamId);

    r.stop();
  });

  it('polls at 10s interval when WS is disconnected', async () => {
    opts.isWsConnected.mockReturnValue(false);
    const r = createReconciler(opts);
    r.start();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(team.getTeamContext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(team.getTeamContext).toHaveBeenCalledTimes(2);

    r.stop();
  });

  it('diffs HTTP context against local context', async () => {
    const httpCtx = { members: [{ agent_id: 'http' }] };
    team.getTeamContext.mockResolvedValue(httpCtx);

    const r = createReconciler(opts);
    r.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(diffState).toHaveBeenCalledWith(opts.getLocalContext(), httpCtx, stucknessAlerted);

    r.stop();
  });

  it('calls onEvents when drift is detected', async () => {
    diffState.mockReturnValue(['Agent alice joined the team', 'CONFLICT: alice and bob']);

    const r = createReconciler(opts);
    r.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(opts.onEvents).toHaveBeenCalledWith([
      'Agent alice joined the team',
      'CONFLICT: alice and bob',
    ]);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('2 missed event(s)'));

    r.stop();
  });

  it('does not call onEvents when no drift', async () => {
    diffState.mockReturnValue([]);

    const r = createReconciler(opts);
    r.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(opts.onEvents).not.toHaveBeenCalled();

    r.stop();
  });

  it('replaces local context with HTTP context', async () => {
    const httpCtx = { members: [{ agent_id: 'fresh' }] };
    team.getTeamContext.mockResolvedValue(httpCtx);

    const r = createReconciler(opts);
    r.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(opts.replaceContext).toHaveBeenCalledWith(httpCtx);

    r.stop();
  });

  it('handles HTTP fetch errors gracefully', async () => {
    team.getTeamContext.mockRejectedValue(new Error('network error'));

    const r = createReconciler(opts);
    r.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Reconciliation failed'));
    expect(opts.replaceContext).not.toHaveBeenCalled();

    // Should still schedule next poll
    team.getTeamContext.mockResolvedValue({ members: [] });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(team.getTeamContext).toHaveBeenCalledTimes(2);

    r.stop();
  });

  it('logs recovery after failures', async () => {
    team.getTeamContext.mockRejectedValueOnce(new Error('fail'));

    const r = createReconciler(opts);
    r.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(logger.error).toHaveBeenCalled();

    // Recover on next poll
    team.getTeamContext.mockResolvedValue({ members: [] });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('recovered after 1 failure'));

    r.stop();
  });

  it('skips diff when local context is null', async () => {
    opts.getLocalContext.mockReturnValue(null);

    const r = createReconciler(opts);
    r.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(diffState).not.toHaveBeenCalled();
    // But still replaces context
    expect(opts.replaceContext).toHaveBeenCalled();

    r.stop();
  });

  it('stop cancels pending timer', async () => {
    const r = createReconciler(opts);
    r.start();
    r.stop();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(team.getTeamContext).not.toHaveBeenCalled();
  });

  it('reconcile can be called directly', async () => {
    const r = createReconciler(opts);
    await r.reconcile();

    expect(team.getTeamContext).toHaveBeenCalledTimes(1);
  });
});
