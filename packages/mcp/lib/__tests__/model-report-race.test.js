import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the context module
vi.mock('../context.js', () => ({
  refreshContext: vi.fn().mockResolvedValue({ members: [] }),
  teamPreamble: vi.fn().mockResolvedValue(''),
  offlinePrefix: vi.fn().mockReturnValue(''),
  getCachedContext: vi.fn().mockReturnValue(null),
  clearContextCache: vi.fn(),
}));

vi.mock('@chinmeister/shared/session-registry.js', () => ({
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
    state = { teamId: 't_race', modelReported: null, modelReportInflight: null };
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
    const call1 = collector.callTool('chinmeister_get_team_context', { model: 'claude-opus-4-6' });
    const call2 = collector.callTool('chinmeister_get_team_context', { model: 'claude-opus-4-6' });
    const call3 = collector.callTool('chinmeister_get_team_context', { model: 'claude-opus-4-6' });

    // All three should proceed without waiting for reportModel
    await Promise.all([call1, call2, call3]);

    // reportModel should only have been called ONCE
    expect(team.reportModel).toHaveBeenCalledTimes(1);
    expect(team.reportModel).toHaveBeenCalledWith('t_race', 'claude-opus-4-6');

    // Resolve the report
    resolveReport();
    await new Promise((r) => setTimeout(r, 10));

    // State should track which model was reported
    expect(state.modelReported).toBe('claude-opus-4-6');

    // A fourth call with the SAME model should NOT call reportModel again
    team.reportModel.mockClear();
    await collector.callTool('chinmeister_get_team_context', { model: 'claude-opus-4-6' });
    expect(team.reportModel).not.toHaveBeenCalled();
  });

  it('reports again when a different model is provided', async () => {
    team.reportModel.mockResolvedValue({ ok: true });

    await collector.callTool('chinmeister_get_team_context', { model: 'gpt-4o' });
    await new Promise((r) => setTimeout(r, 10));
    expect(state.modelReported).toBe('gpt-4o');

    // A call with a DIFFERENT model should trigger a new report
    await collector.callTool('chinmeister_get_team_context', { model: 'claude-opus-4-6' });
    await new Promise((r) => setTimeout(r, 10));
    expect(team.reportModel).toHaveBeenCalledTimes(2);
    expect(state.modelReported).toBe('claude-opus-4-6');
  });

  it('flag is only set after successful completion, not before', async () => {
    let resolveReport;
    team.reportModel.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReport = resolve;
        }),
    );

    await collector.callTool('chinmeister_get_team_context', { model: 'gpt-4o' });

    // State should NOT be set yet (report is still in-flight)
    expect(state.modelReported).toBeNull();

    // Complete the report
    resolveReport();
    await new Promise((r) => setTimeout(r, 10));

    expect(state.modelReported).toBe('gpt-4o');
  });

  it('allows retry after failure (promise is cleared)', async () => {
    // Both retry attempts fail
    team.reportModel
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'));

    await collector.callTool('chinmeister_get_team_context', { model: 'gpt-4o' });

    // Wait for the full retry cycle (1s delay between attempts + buffer)
    await new Promise((r) => setTimeout(r, 1200));

    // State should remain null after all retries exhausted
    expect(state.modelReported).toBeNull();

    // Second call should spawn a fresh report
    team.reportModel.mockResolvedValueOnce({ ok: true });
    await collector.callTool('chinmeister_get_team_context', { model: 'gpt-4o' });
    await new Promise((r) => setTimeout(r, 10));

    expect(team.reportModel).toHaveBeenCalledTimes(3); // 2 retries + 1 fresh
    expect(state.modelReported).toBe('gpt-4o');
  });

  it('does not report when model is not provided', async () => {
    await collector.callTool('chinmeister_get_team_context', {});
    expect(team.reportModel).not.toHaveBeenCalled();
    expect(state.modelReported).toBeNull();
  });

  it('does not report when not in a team', async () => {
    state.teamId = null;
    await collector.callTool('chinmeister_get_team_context', { model: 'claude-opus-4-6' });
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
    const result = await collector.callTool('chinmeister_get_team_context', {
      model: 'claude-opus-4-6',
    });
    expect(result.content).toBeDefined();
    expect(result.content[0].text).toMatch(/No other agents/);

    // Clean up
    resolveReport();
    await new Promise((r) => setTimeout(r, 10));
  });
});
