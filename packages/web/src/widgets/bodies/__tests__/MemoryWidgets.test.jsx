// @vitest-environment jsdom

// memory-outcomes is the only memory widget after the 2026-04-25 audit cut
// memory-activity, memory-health, memory-safety, and top-memories. The
// MEMORY_OUTCOMES_MIN_SESSIONS = 10 sample-size gate is the load-bearing
// guard the test locks: below 10 sessions the 3-bucket bar chart collapses
// to one bar (rubric C1 fail).

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

  it('renders the three-bucket chart when session count clears the gate', async () => {
    const W = await loadMemoryWidget('memory-outcomes');
    const r = render(
      W,
      makeProps({
        memory_outcome_correlation: [
          { bucket: 'hit memory', sessions: 8, completed: 7, completion_rate: 87.5 },
          { bucket: 'searched, no results', sessions: 3, completed: 1, completion_rate: 33.3 },
          { bucket: 'no search', sessions: 4, completed: 2, completion_rate: 50.0 },
        ],
      }),
    );
    expect(r.container.textContent).toContain('hit memory');
    expect(r.container.textContent).toContain('searched, no results');
    expect(r.container.textContent).toContain('no search');
    expect(r.container.textContent).toContain('87.5%');
    r.unmount();
  });
});
