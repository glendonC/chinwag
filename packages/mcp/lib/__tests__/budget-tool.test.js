import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../team.js', () => ({
  loadTeamBudgets: vi.fn().mockReturnValue(null),
}));

vi.mock('../config.js', () => ({
  loadConfig: vi.fn().mockReturnValue(null),
}));

import { registerBudgetTool } from '../tools/budget.ts';
import { BUDGET_DEFAULTS } from '@chinmeister/shared/budget-config.js';
import { loadTeamBudgets } from '../team.js';
import { loadConfig } from '../config.js';

function makeHarness(initialBudgets = { ...BUDGET_DEFAULTS }) {
  const state = { budgets: { ...initialBudgets } };
  const registered = new Map();
  const addTool = (name, _schema, handler) => {
    registered.set(name, handler);
  };
  registerBudgetTool(addTool, { state });
  const handler = registered.get('chinmeister_configure_budget');
  return { state, handler };
}

describe('chinmeister_configure_budget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadTeamBudgets.mockReturnValue(null);
    loadConfig.mockReturnValue(null);
  });

  it('registers the tool', () => {
    const { handler } = makeHarness();
    expect(handler).toBeTypeOf('function');
  });

  it('returns the current budget when no args are provided', async () => {
    const { handler, state } = makeHarness();
    const result = await handler({});
    expect(result.content[0].text).toContain(`memoryResultCap=${state.budgets.memoryResultCap}`);
    expect(state.budgets).toEqual(BUDGET_DEFAULTS);
  });

  it('applies a single override and leaves other fields alone', async () => {
    const { handler, state } = makeHarness();
    const result = await handler({ memoryResultCap: 3 });
    expect(state.budgets.memoryResultCap).toBe(3);
    expect(state.budgets.memoryContentTruncation).toBe(BUDGET_DEFAULTS.memoryContentTruncation);
    expect(state.budgets.coordinationBroadcast).toBe(BUDGET_DEFAULTS.coordinationBroadcast);
    expect(result.content[0].text).toContain('Budget updated');
  });

  it('applies multiple overrides at once', async () => {
    const { handler, state } = makeHarness();
    await handler({
      memoryResultCap: 5,
      memoryContentTruncation: 100,
      coordinationBroadcast: 'silent',
    });
    expect(state.budgets).toEqual({
      memoryResultCap: 5,
      memoryContentTruncation: 100,
      coordinationBroadcast: 'silent',
    });
  });

  it('formats truncation 0 as "unlimited" in the response', async () => {
    const { handler } = makeHarness();
    const result = await handler({ memoryContentTruncation: 0 });
    expect(result.content[0].text).toContain('memoryContentTruncation=unlimited');
  });

  it('reset reverts overrides to the re-resolved team+user baseline', async () => {
    loadTeamBudgets.mockReturnValue({ memoryResultCap: 8 });
    loadConfig.mockReturnValue({ budgets: { memoryContentTruncation: 200 } });

    const { handler, state } = makeHarness({
      memoryResultCap: 2,
      memoryContentTruncation: 50,
      coordinationBroadcast: 'silent',
    });

    const result = await handler({ reset: true });
    expect(state.budgets.memoryResultCap).toBe(8); // from team
    expect(state.budgets.memoryContentTruncation).toBe(200); // from user
    expect(state.budgets.coordinationBroadcast).toBe(BUDGET_DEFAULTS.coordinationBroadcast);
    expect(result.content[0].text).toContain('Runtime overrides cleared');
  });

  it('reset with no team or user config returns hard defaults', async () => {
    const { handler, state } = makeHarness({
      memoryResultCap: 2,
      memoryContentTruncation: 50,
      coordinationBroadcast: 'silent',
    });
    await handler({ reset: true });
    expect(state.budgets).toEqual(BUDGET_DEFAULTS);
  });
});
