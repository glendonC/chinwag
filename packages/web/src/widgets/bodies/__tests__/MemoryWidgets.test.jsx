// @vitest-environment jsdom

// memory-outcomes is the only memory widget after the 2026-04-25 audit cut
// memory-activity, memory-health, memory-safety, and top-memories. Two
// sample-size gates lock the chart's honesty:
//   total floor (10 sessions) — below this the period is too sparse to
//     compare anything (avoids rubric C1 fail of one-bar bar chart).
//   per-bucket floor (5 sessions) and a min-2-bucket guard — block the case
//     where a bucket of 1-2 sessions reads as 100% completion and the
//     widget reads as a comparison even though only one bucket cleared.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function loadMemoryWidget(id) {
  vi.resetModules();
  const mod = await import('../MemoryWidgets.js');
  return mod.memoryWidgets[id];
}

function emptyMemoryUsage(overrides = {}) {
  return {
    total_memories: 0,
    searches: 0,
    searches_with_results: 0,
    search_hit_rate: 0,
    memories_created_period: 0,
    stale_memories: 0,
    avg_memory_age_days: 0,
    pending_consolidation_proposals: 0,
    formation_observations_by_recommendation: { keep: 0, merge: 0, evolve: 0, discard: 0 },
    secrets_blocked_24h: 0,
    ...overrides,
  };
}

function makeProps({ memory_usage, memory_outcome_correlation = [] } = {}) {
  return {
    analytics: {
      memory_usage: memory_usage ?? emptyMemoryUsage(),
      memory_outcome_correlation,
    },
    conversationData: { sessions: [] },
    summaries: [],
    liveAgents: [],
    locks: [],
    selectTeam: () => {},
  };
}

function render(Component, props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Component {...props} />);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('MemoryOutcomesWidget — sample-size gate', () => {
  it('shows the "no sessions" empty when the period has zero sessions', async () => {
    const W = await loadMemoryWidget('memory-outcomes');
    const r = render(W, makeProps({ memory_outcome_correlation: [] }));
    expect(r.container.textContent).toContain('No sessions this period');
    r.unmount();
  });

  it('renders a "need 10+ sessions" gate when below the minimum', async () => {
    const W = await loadMemoryWidget('memory-outcomes');
    const r = render(
      W,
      makeProps({
        memory_outcome_correlation: [
          { bucket: 'no search', sessions: 3, completed: 2, completion_rate: 66.7 },
        ],
      }),
    );
    expect(r.container.textContent).toContain('Need 10');
    expect(r.container.textContent).toContain('reliable correlation');
    r.unmount();
  });

  it('renders the three-bucket chart when every bucket clears the per-bucket floor', async () => {
    const W = await loadMemoryWidget('memory-outcomes');
    const r = render(
      W,
      makeProps({
        memory_outcome_correlation: [
          { bucket: 'hit memory', sessions: 8, completed: 7, completion_rate: 87.5 },
          { bucket: 'searched, no results', sessions: 5, completed: 1, completion_rate: 20.0 },
          { bucket: 'no search', sessions: 7, completed: 3, completion_rate: 42.9 },
        ],
      }),
    );
    expect(r.container.textContent).toContain('hit memory');
    expect(r.container.textContent).toContain('searched, no results');
    expect(r.container.textContent).toContain('no search');
    expect(r.container.textContent).toContain('87.5%');
    r.unmount();
  });

  it('suppresses sub-floor buckets and shows the per-bucket gate when only one clears', async () => {
    const W = await loadMemoryWidget('memory-outcomes');
    const r = render(
      W,
      makeProps({
        memory_outcome_correlation: [
          { bucket: 'hit memory', sessions: 2, completed: 2, completion_rate: 100.0 },
          { bucket: 'searched, no results', sessions: 1, completed: 0, completion_rate: 0.0 },
          { bucket: 'no search', sessions: 9, completed: 5, completion_rate: 55.6 },
        ],
      }),
    );
    expect(r.container.textContent).toContain('Need 5');
    expect(r.container.textContent).toContain('2+ buckets');
    expect(r.container.textContent).not.toContain('100');
    r.unmount();
  });
});
