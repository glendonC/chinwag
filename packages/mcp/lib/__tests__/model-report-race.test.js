import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the context module
vi.mock('../context.js', () => ({
  refreshContext: vi.fn().mockResolvedValue({ members: [] }),
  teamPreamble: vi.fn().mockResolvedValue(''),
  offlinePrefix: vi.fn().mockReturnValue(''),
  getCachedContext: vi.fn().mockReturnValue(null),
  clearContextCache: vi.fn(),
}));

vi.mock('@chinwag/shared/session-registry.js', () => ({
  setTerminalTitle: vi.fn(),
}));

import { refreshContext } from '../context.js';
import { registerContextTool } from '../tools/context.js';

function createToolCollector() {
  const tools = new Map();
  const addTool = (name, opts, handler) => tools.set(name, { opts, handler });
  return {
    addTool,
    tools,
    callTool: async (name, args = {}) => {
      const t = tools.get(name);
      if (!t) throw new Error(`Tool not registered: ${name}`);
      return t.handler(args);
    },
  };
}

describe('model report race condition', () => {
  let collector, team, state;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createToolCollector();
    team = {
      reportModel: vi.fn(),
      getTeamContext: vi.fn().mockResolvedValue({ members: [] }),
    };
    state = { teamId: 't_race', modelReported: false };
    refreshContext.mockResolvedValue({ members: [] });
    registerContextTool(collector.addTool, { team, state });
  });

  it('concurrent calls share a single in-flight report (no duplicates)', async () => {
    // reportModel takes a while to resolve
    let resolveReport;
    team.reportModel.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReport = resolve;
        }),
    );

    // Fire three concurrent calls with a model
    const call1 = collector.callTool('chinwag_get_team_context', { model: 'claude-opus-4-6' });
    const call2 = collector.callTool('chinwag_get_team_context', { model: 'claude-opus-4-6' });
    const call3 = collector.callTool('chinwag_get_team_context', { model: 'claude-opus-4-6' });

    // All three should proceed without waiting for reportModel
    await Promise.all([call1, call2, call3]);

    // reportModel should only have been called ONCE
    expect(team.reportModel).toHaveBeenCalledTimes(1);
    expect(team.reportModel).toHaveBeenCalledWith('t_race', 'claude-opus-4-6');

    // Resolve the report
    resolveReport();
    await new Promise((r) => setTimeout(r, 10));

    // Flag should now be set
    expect(state.modelReported).toBe(true);

    // A fourth call should NOT call reportModel again
    team.reportModel.mockClear();
    await collector.callTool('chinwag_get_team_context', { model: 'claude-opus-4-6' });
    expect(team.reportModel).not.toHaveBeenCalled();
  });

  it('flag is only set after successful completion, not before', async () => {
    let resolveReport;
    team.reportModel.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReport = resolve;
        }),
    );

    await collector.callTool('chinwag_get_team_context', { model: 'gpt-4o' });

    // Flag should NOT be true yet (report is still in-flight)
    expect(state.modelReported).toBe(false);

    // Complete the report
    resolveReport();
    await new Promise((r) => setTimeout(r, 10));

    expect(state.modelReported).toBe(true);
  });

  it('allows retry after failure (promise is cleared)', async () => {
    // First call fails
    team.reportModel.mockRejectedValueOnce(new Error('network error'));

    await collector.callTool('chinwag_get_team_context', { model: 'gpt-4o' });
    await new Promise((r) => setTimeout(r, 10));

    // Flag should remain false after failure
    expect(state.modelReported).toBe(false);

    // Second call should retry
    team.reportModel.mockResolvedValueOnce({ ok: true });
    await collector.callTool('chinwag_get_team_context', { model: 'gpt-4o' });
    await new Promise((r) => setTimeout(r, 10));

    expect(team.reportModel).toHaveBeenCalledTimes(2);
    expect(state.modelReported).toBe(true);
  });

  it('does not report when model is not provided', async () => {
    await collector.callTool('chinwag_get_team_context', {});
    expect(team.reportModel).not.toHaveBeenCalled();
    expect(state.modelReported).toBe(false);
  });

  it('does not report when not in a team', async () => {
    state.teamId = null;
    await collector.callTool('chinwag_get_team_context', { model: 'claude-opus-4-6' });
    expect(team.reportModel).not.toHaveBeenCalled();
  });

  it('does not block the tool response on the model report', async () => {
    let resolveReport;
    team.reportModel.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReport = resolve;
        }),
    );

    // The tool call should resolve immediately even though reportModel is pending
    const result = await collector.callTool('chinwag_get_team_context', {
      model: 'claude-opus-4-6',
    });
    expect(result.content).toBeDefined();
    expect(result.content[0].text).toMatch(/No other agents/);

    // Clean up
    resolveReport();
    await new Promise((r) => setTimeout(r, 10));
  });
});
