// @vitest-environment jsdom

// Memory widget renderers. The 2026-04-21 audit shipped:
//   - memory-activity / memory-health: SectionEmpty (not GhostStatRow) on
//     empty, so the solo day-1 user isn't shown pulsing em-dashes that
//     imply activity
//   - memory-safety: re-scoped to live, three conditional blocks, virtuous
//     "Nothing needs review" empty copy
//   - memory-outcomes: MEMORY_OUTCOMES_MIN_SESSIONS = 10 sample-size gate
//     so the 3-bucket bar chart doesn't collapse to one bar on low-N days
//   - top-memories: TOP_MEMORIES_VISIBLE = 8 with a "+N more" affordance
//     when the server returns the full 20-row list
// These tests lock in each of those decisions.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function loadMemoryWidget(id) {
  vi.resetModules();
  const mod = await import('./MemoryWidgets.js');
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

function makeProps({ memory_usage, memory_outcome_correlation = [], top_memories = [] } = {}) {
  return {
    analytics: {
      memory_usage: memory_usage ?? emptyMemoryUsage(),
      memory_outcome_correlation,
      top_memories,
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

// memory-activity ──────────────────────────────────────────────────────

describe('MemoryActivityWidget — empty state', () => {
  it('renders SectionEmpty copy, not pulsing ghost rows', async () => {
    const W = await loadMemoryWidget('memory-activity');
    const r = render(W, makeProps());
    // The audit explicitly replaced GhostStatRow with SectionEmpty here so
    // solo day 1 reads as "nothing to do yet," not "activity loading."
    expect(r.container.textContent).toContain('No memory searches this period');
    // GhostStatRow renders em-dashes. SectionEmpty does not.
    expect(r.container.textContent).not.toContain('—');
    r.unmount();
  });
});

describe('MemoryActivityWidget — populated', () => {
  it('renders searches, hit rate, and created blocks', async () => {
    const W = await loadMemoryWidget('memory-activity');
    const r = render(
      W,
      makeProps({
        memory_usage: emptyMemoryUsage({
          searches: 12,
          search_hit_rate: 75,
          memories_created_period: 4,
        }),
      }),
    );
    expect(r.container.textContent).toContain('12');
    expect(r.container.textContent).toContain('75%');
    expect(r.container.textContent).toContain('4');
    r.unmount();
  });

  it('hides the hit-rate block when hit rate is zero', async () => {
    const W = await loadMemoryWidget('memory-activity');
    const r = render(
      W,
      makeProps({
        memory_usage: emptyMemoryUsage({ searches: 5, memories_created_period: 1 }),
      }),
    );
    // Progressive-disclosure: no hit rate to show means no hit-rate block.
    expect(r.container.textContent).not.toContain('hit rate');
    r.unmount();
  });
});

// memory-health ────────────────────────────────────────────────────────

describe('MemoryHealthWidget — empty state', () => {
  it('names the empty condition plainly', async () => {
    const W = await loadMemoryWidget('memory-health');
    const r = render(W, makeProps());
    expect(r.container.textContent).toContain('No memories saved yet');
    r.unmount();
  });
});

describe('MemoryHealthWidget — populated', () => {
  it('renders total, avg age, and stale blocks', async () => {
    const W = await loadMemoryWidget('memory-health');
    const r = render(
      W,
      makeProps({
        memory_usage: emptyMemoryUsage({
          total_memories: 42,
          avg_memory_age_days: 18.5,
          stale_memories: 7,
        }),
      }),
    );
    expect(r.container.textContent).toContain('42');
    expect(r.container.textContent).toContain('19d'); // rounded
    expect(r.container.textContent).toContain('7');
    r.unmount();
  });

  it('hides stale block when stale count is zero (progressive disclosure)', async () => {
    const W = await loadMemoryWidget('memory-health');
    const r = render(
      W,
      makeProps({
        memory_usage: emptyMemoryUsage({ total_memories: 10, avg_memory_age_days: 5 }),
      }),
    );
    expect(r.container.textContent).not.toContain('stale');
    r.unmount();
  });
});

// memory-safety ────────────────────────────────────────────────────────

describe('MemorySafetyWidget — empty state', () => {
  it('renders virtuous "Nothing needs review" copy, not ghost rows', async () => {
    // The 2026-04-21 rework made this widget live-scoped with a positive
    // empty state. It should read like live-conflicts ("nothing to do")
    // rather than the accusatory "no activity yet."
    const W = await loadMemoryWidget('memory-safety');
    const r = render(W, makeProps());
    expect(r.container.textContent).toContain('Nothing needs review');
    expect(r.container.textContent).not.toContain('—');
    r.unmount();
  });
});

describe('MemorySafetyWidget — populated', () => {
  it('renders review queue, auditor-flagged, and secrets caught blocks', async () => {
    const W = await loadMemoryWidget('memory-safety');
    const r = render(
      W,
      makeProps({
        memory_usage: emptyMemoryUsage({
          pending_consolidation_proposals: 3,
          formation_observations_by_recommendation: { keep: 0, merge: 2, evolve: 1, discard: 1 },
          secrets_blocked_24h: 5,
        }),
      }),
    );
    expect(r.container.textContent).toContain('review queue');
    expect(r.container.textContent).toContain('auditor-flagged');
    expect(r.container.textContent).toContain('secrets caught');
    // Auditor-flagged = merge + evolve + discard = 4 (keep is trivial, excluded).
    expect(r.container.textContent).toContain('4');
    r.unmount();
  });

  it('does not render auditor-flagged block when only keep observations exist', async () => {
    // `keep` is the trivial case — auditor classifies memories as keep but
    // nothing is flagged for review. Widget should not surface this as a
    // false-positive "auditor-flagged" signal.
    const W = await loadMemoryWidget('memory-safety');
    const r = render(
      W,
      makeProps({
        memory_usage: emptyMemoryUsage({
          pending_consolidation_proposals: 1,
          formation_observations_by_recommendation: { keep: 20, merge: 0, evolve: 0, discard: 0 },
        }),
      }),
    );
    expect(r.container.textContent).toContain('review queue');
    expect(r.container.textContent).not.toContain('auditor-flagged');
    r.unmount();
  });
});

// memory-outcomes ──────────────────────────────────────────────────────

describe('MemoryOutcomesWidget — sample-size gate', () => {
  it('shows the "no sessions" empty when the period has zero sessions', async () => {
    const W = await loadMemoryWidget('memory-outcomes');
    const r = render(W, makeProps({ memory_outcome_correlation: [] }));
    expect(r.container.textContent).toContain('No sessions this period');
    r.unmount();
  });

  it('renders a "need 10+ sessions" gate when below the minimum', async () => {
    // The 3-bucket bar chart collapses below N=10 — rubric C1 says a bar
    // chart with one populated bucket is a stat pretending. Gate it
    // explicitly.
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

  it('does not render the old "missed search" label', async () => {
    // Regression guard for the 2026-04-21 bucket rename.
    const W = await loadMemoryWidget('memory-outcomes');
    const r = render(
      W,
      makeProps({
        memory_outcome_correlation: [
          { bucket: 'searched, no results', sessions: 15, completed: 5, completion_rate: 33 },
        ],
      }),
    );
    expect(r.container.textContent).not.toContain('missed search');
    r.unmount();
  });
});

// top-memories ─────────────────────────────────────────────────────────

describe('TopMemoriesWidget — empty state', () => {
  it('names the empty condition', async () => {
    const W = await loadMemoryWidget('top-memories');
    const r = render(W, makeProps({ top_memories: [] }));
    expect(r.container.textContent).toContain('No memories accessed');
    r.unmount();
  });
});

describe('TopMemoriesWidget — populated', () => {
  function makeMemories(n) {
    return Array.from({ length: n }, (_, i) => ({
      id: `mem-${i}`,
      text_preview: `Memory preview ${i}`,
      access_count: n - i,
      last_accessed_at: new Date(Date.now() - i * 86_400_000).toISOString(),
    }));
  }

  it('renders up to TOP_MEMORIES_VISIBLE rows without a "+N more" line', async () => {
    const W = await loadMemoryWidget('top-memories');
    const r = render(W, makeProps({ top_memories: makeMemories(5) }));
    expect(r.container.textContent).toContain('Memory preview 0');
    expect(r.container.textContent).toContain('Memory preview 4');
    expect(r.container.textContent).not.toMatch(/\+\d+ more/);
    r.unmount();
  });

  it('caps visible rows at 8 and renders "+N more" when the server returns more', async () => {
    // The SQL returns up to 20 (memory.ts:235). The widget clamps to 8 for
    // legibility at the default 6×3 size; the overflow indicator keeps the
    // truncation honest.
    const W = await loadMemoryWidget('top-memories');
    const r = render(W, makeProps({ top_memories: makeMemories(12) }));
    expect(r.container.textContent).toContain('Memory preview 0');
    expect(r.container.textContent).toContain('Memory preview 7');
    expect(r.container.textContent).not.toContain('Memory preview 8');
    expect(r.container.textContent).toContain('+4 more');
    r.unmount();
  });
});
