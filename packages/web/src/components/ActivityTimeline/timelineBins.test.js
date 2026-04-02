import { describe, expect, it, vi } from 'vitest';
import { BIN_COUNT, buildTimelineBins } from './timelineBins.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('BIN_COUNT', () => {
  it('is 18', () => {
    expect(BIN_COUNT).toBe(18);
  });
});

describe('buildTimelineBins', () => {
  it('returns array of BIN_COUNT zeros for no sessions', () => {
    const bins = buildTimelineBins([], 0);
    expect(bins).toHaveLength(BIN_COUNT);
    expect(bins.every((v) => v === 0)).toBe(true);
  });

  it('adds liveCount weight to last bin', () => {
    const bins = buildTimelineBins([], 3);
    expect(bins[BIN_COUNT - 1]).toBeCloseTo(3 * 0.9);
    // All other bins should be 0
    for (let i = 0; i < BIN_COUNT - 1; i++) {
      expect(bins[i]).toBe(0);
    }
  });

  it('distributes a session across correct bins', () => {
    const now = Date.now();
    const binSize = DAY_MS / BIN_COUNT;

    // Session started 4 bins ago, ended 3 bins ago (well before the last bin)
    const sessions = [{
      started_at: new Date(now - 4 * binSize).toISOString(),
      ended_at: new Date(now - 3 * binSize).toISOString(),
      edit_count: 0,
    }];

    const bins = buildTimelineBins(sessions, 0);
    // Session should have activity somewhere in the middle bins
    const hasActivity = bins.some((v) => v > 0);
    expect(hasActivity).toBe(true);
    // Last bin has no liveCount and session ended well before it
    expect(bins[BIN_COUNT - 1]).toBe(0);
  });

  it('weights sessions by edit_count', () => {
    const now = Date.now();
    const binSize = DAY_MS / BIN_COUNT;

    const noEdits = [{
      started_at: new Date(now - binSize).toISOString(),
      ended_at: new Date(now - binSize / 2).toISOString(),
      edit_count: 0,
    }];

    const manyEdits = [{
      started_at: new Date(now - binSize).toISOString(),
      ended_at: new Date(now - binSize / 2).toISOString(),
      edit_count: 100,
    }];

    const binsNoEdits = buildTimelineBins(noEdits, 0);
    const binsManyEdits = buildTimelineBins(manyEdits, 0);

    // Session with more edits should have higher weight
    const sumNoEdits = binsNoEdits.reduce((s, v) => s + v, 0);
    const sumManyEdits = binsManyEdits.reduce((s, v) => s + v, 0);
    expect(sumManyEdits).toBeGreaterThan(sumNoEdits);
  });

  it('skips sessions with no started_at', () => {
    const sessions = [{ ended_at: new Date().toISOString(), edit_count: 10 }];
    const bins = buildTimelineBins(sessions, 0);
    expect(bins.every((v) => v === 0)).toBe(true);
  });

  it('treats live sessions (no ended_at) as ending at now', () => {
    const now = Date.now();
    const binSize = DAY_MS / BIN_COUNT;

    const sessions = [{
      started_at: new Date(now - binSize).toISOString(),
      // no ended_at - live session
      edit_count: 0,
    }];

    const bins = buildTimelineBins(sessions, 0);
    // Should have activity in the last bin since session extends to now
    expect(bins[BIN_COUNT - 1]).toBeGreaterThan(0);
  });

  it('clamps sessions older than 24h to the first bin', () => {
    const now = Date.now();

    const sessions = [{
      started_at: new Date(now - 2 * DAY_MS).toISOString(),
      ended_at: new Date(now - DAY_MS + 1000).toISOString(),
      edit_count: 0,
    }];

    const bins = buildTimelineBins(sessions, 0);
    // Should have some activity in the first bin
    expect(bins[0]).toBeGreaterThan(0);
  });

  it('handles invalid dates gracefully', () => {
    const sessions = [
      { started_at: 'invalid', edit_count: 5 },
      { started_at: null, edit_count: 5 },
    ];
    const bins = buildTimelineBins(sessions, 0);
    expect(bins).toHaveLength(BIN_COUNT);
    expect(bins.every((v) => v === 0)).toBe(true);
  });
});
