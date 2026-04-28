import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id) {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// files_touched_total reads COUNT(DISTINCT file_path) from the edits table.
// The scalar must NOT share the HEATMAP_LIMIT=50 cap that applies to the
// ranked file_heatmap list, nor the ACTIVITY_MAX_FILES=50 per-session cap
// on sessions.files_touched. These tests verify both boundaries.

describe('files_touched_total', () => {
  it('returns 0 when no team activity exists', async () => {
    const team = getTeam('ftt-empty');
    const agentId = 'claude-code:ftt-empty';
    const ownerId = 'user-ftt-empty';

    await team.join(agentId, ownerId, 'alice', 'claude-code');
    const analytics = await team.getAnalytics(agentId, 7, ownerId);
    expect(analytics.ok).toBe(true);
    expect(analytics.files_touched_total).toBe(0);
  });

  it('counts a single session beyond the 50-file per-session cap', async () => {
    // Exercises the critical path the old widget was silently capped on.
    // A single session edits 60 distinct files; the edits table captures
    // every edit event regardless of the sessions.files_touched JSON cap,
    // so the uncapped DISTINCT query must report the true 60.
    const team = getTeam('ftt-over-cap');
    const agentId = 'claude-code:ftt-cap';
    const ownerId = 'user-ftt-cap';

    await team.join(agentId, ownerId, 'alice', 'claude-code');
    const sess = await team.startSession(agentId, 'alice', 'react', ownerId);
    expect(sess.ok).toBe(true);

    for (let i = 0; i < 60; i++) {
      const res = await team.recordEdit(agentId, `src/file-${i}.js`, 0, 0, ownerId);
      expect(res.ok).toBe(true);
    }

    const analytics = await team.getAnalytics(agentId, 7, ownerId);
    expect(analytics.ok).toBe(true);
    expect(analytics.files_touched_total).toBe(60);
    // The ranked list is still capped at HEATMAP_LIMIT=50 - that widget's
    // framing matches its capped source. The scalar uses the edits table.
    expect(analytics.file_heatmap.length).toBeLessThanOrEqual(50);
  });

  it('dedupes distinct files across multiple sessions', async () => {
    // Two sessions share 3 files and have 2 unique files each - total
    // distinct files = 3 + 2 + 2 = 7. Proves the DISTINCT is cross-session.
    const team = getTeam('ftt-cross-session');
    const agentId = 'claude-code:ftt-cross';
    const ownerId = 'user-ftt-cross';

    await team.join(agentId, ownerId, 'bob', 'claude-code');

    const s1 = await team.startSession(agentId, 'bob', 'react', ownerId);
    await team.recordEdit(agentId, 'src/shared-a.js', 0, 0, ownerId);
    await team.recordEdit(agentId, 'src/shared-b.js', 0, 0, ownerId);
    await team.recordEdit(agentId, 'src/shared-c.js', 0, 0, ownerId);
    await team.recordEdit(agentId, 'src/uniq-s1-a.js', 0, 0, ownerId);
    await team.recordEdit(agentId, 'src/uniq-s1-b.js', 0, 0, ownerId);
    await team.endSession(agentId, s1.session_id, ownerId);

    const s2 = await team.startSession(agentId, 'bob', 'react', ownerId);
    await team.recordEdit(agentId, 'src/shared-a.js', 0, 0, ownerId);
    await team.recordEdit(agentId, 'src/shared-b.js', 0, 0, ownerId);
    await team.recordEdit(agentId, 'src/shared-c.js', 0, 0, ownerId);
    await team.recordEdit(agentId, 'src/uniq-s2-a.js', 0, 0, ownerId);
    await team.recordEdit(agentId, 'src/uniq-s2-b.js', 0, 0, ownerId);
    await team.endSession(agentId, s2.session_id, ownerId);

    const analytics = await team.getAnalytics(agentId, 7, ownerId);
    expect(analytics.ok).toBe(true);
    expect(analytics.files_touched_total).toBe(7);
  });

  it('counts each edit event once, not per repeat', async () => {
    // Editing the same file 5 times should yield total=1, not 5. DISTINCT
    // on file_path in the edits table is load-bearing.
    const team = getTeam('ftt-repeat-edit');
    const agentId = 'claude-code:ftt-repeat';
    const ownerId = 'user-ftt-repeat';

    await team.join(agentId, ownerId, 'carol', 'claude-code');
    await team.startSession(agentId, 'carol', 'react', ownerId);

    for (let i = 0; i < 5; i++) {
      await team.recordEdit(agentId, 'src/same.js', 0, 0, ownerId);
    }

    const analytics = await team.getAnalytics(agentId, 7, ownerId);
    expect(analytics.ok).toBe(true);
    expect(analytics.files_touched_total).toBe(1);
  });

  it('propagates through the extended analytics path', async () => {
    // getExtendedAnalytics spreads ...getAnalytics; verify files_touched_total
    // survives the spread and the enhanced heatmap override.
    const team = getTeam('ftt-extended');
    const agentId = 'claude-code:ftt-ext';
    const ownerId = 'user-ftt-ext';

    await team.join(agentId, ownerId, 'dave', 'claude-code');
    await team.startSession(agentId, 'dave', 'react', ownerId);
    await team.recordEdit(agentId, 'src/one.js', 0, 0, ownerId);
    await team.recordEdit(agentId, 'src/two.js', 0, 0, ownerId);
    await team.recordEdit(agentId, 'src/three.js', 0, 0, ownerId);

    const extended = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(extended.ok).toBe(true);
    expect(extended.files_touched_total).toBe(3);
  });
});

// The half-split query powers the overview FilesTouched delta - the scalar
// alone can't derive it because distinct-file counts aren't additive across
// days. These tests pin the contract shape and the "too short to split"
// fallback. Time-travel tests (files in previous half) aren't exercised
// here because the harness runs SQLite's datetime('now') live; real
// previous-half coverage would need per-edit created_at overrides.
describe('files_touched_half_split', () => {
  it('returns null when the window is a single day', async () => {
    const team = getTeam('fths-1day');
    const agentId = 'claude-code:fths-1day';
    const ownerId = 'user-fths-1day';

    await team.join(agentId, ownerId, 'alice', 'claude-code');
    await team.startSession(agentId, 'alice', 'react', ownerId);
    await team.recordEdit(agentId, 'src/only.js', 0, 0, ownerId);

    const analytics = await team.getAnalytics(agentId, 1, ownerId);
    expect(analytics.ok).toBe(true);
    expect(analytics.files_touched_half_split).toBeNull();
  });

  it('reports fresh edits as current, not previous', async () => {
    // All edits land "now" in test time, so they fall in the current half
    // (the last halfDays of the window). Previous half is empty. This pins
    // the boundary semantic: the split counts by creation time, not by
    // presence in the window.
    const team = getTeam('fths-fresh');
    const agentId = 'claude-code:fths-fresh';
    const ownerId = 'user-fths-fresh';

    await team.join(agentId, ownerId, 'bob', 'claude-code');
    await team.startSession(agentId, 'bob', 'react', ownerId);
    await team.recordEdit(agentId, 'src/a.js', 0, 0, ownerId);
    await team.recordEdit(agentId, 'src/b.js', 0, 0, ownerId);
    await team.recordEdit(agentId, 'src/c.js', 0, 0, ownerId);

    const analytics = await team.getAnalytics(agentId, 30, ownerId);
    expect(analytics.ok).toBe(true);
    expect(analytics.files_touched_half_split).toEqual({ current: 3, previous: 0 });
  });
});
