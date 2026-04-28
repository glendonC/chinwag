// Memory analytics queries - covers queryMemoryUsage,
// queryMemoryOutcomeCorrelation, and queryTopMemories. The widget-level
// audit on 2026-04-21 split memory-safety's mixed scopes, renamed fields,
// cut formation-summary, and promoted memory-outcomes to the default
// layout. These tests lock in the query contract so the SQL can be
// refactored without regressing widget behavior.

import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id) {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// queryMemoryUsage ────────────────────────────────────────────────────

describe('queryMemoryUsage - empty team', () => {
  it('returns zero-shaped stats without the deprecated fields', async () => {
    const team = getTeam('mq-usage-empty');
    const agentId = 'claude-code:mq-usage-empty';
    const ownerId = 'user-mq-usage-empty';

    await team.join(agentId, ownerId, 'alice', 'claude-code');
    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);

    const m = a.memory_usage;
    expect(m.total_memories).toBe(0);
    expect(m.searches).toBe(0);
    expect(m.searches_with_results).toBe(0);
    expect(m.search_hit_rate).toBe(0);
    expect(m.memories_created_period).toBe(0);
    expect(m.stale_memories).toBe(0);
    expect(m.avg_memory_age_days).toBe(0);
    expect(m.pending_consolidation_proposals).toBe(0);
    expect(m.secrets_blocked_24h).toBe(0);
    expect(m.formation_observations_by_recommendation).toEqual({
      keep: 0,
      merge: 0,
      evolve: 0,
      discard: 0,
    });

    // Regression guard for the 2026-04-21 field cleanup. If any of these
    // come back, it's either a contract revert or a parallel-WIP merge
    // artifact - both worth a second look.
    expect(m.memories_updated_period).toBeUndefined();
    expect(m.merged_memories).toBeUndefined();
    expect(m.secrets_blocked_period).toBeUndefined();
  });
});

describe('queryMemoryUsage - populated', () => {
  it('counts memories and tracks hit-rate after save/search', async () => {
    const team = getTeam('mq-usage-populated');
    const agentId = 'claude-code:mq-usage-populated';
    const ownerId = 'user-mq-usage-populated';

    await team.join(agentId, ownerId, 'bob', 'claude-code');
    await team.saveMemory(
      agentId,
      'Postgres timeouts should be 30 seconds for OLTP paths',
      ['ops'],
      null,
      'bob',
      null,
      ownerId,
    );
    await team.saveMemory(
      agentId,
      'Redis TTLs default to one hour unless overridden',
      ['ops'],
      null,
      'bob',
      null,
      ownerId,
    );

    // Two searches: one that hits, one that misses - should produce 50% hit rate.
    await team.searchMemories(agentId, 'Postgres', null, null, 10, ownerId);
    await team.searchMemories(agentId, 'xyzneverexists', null, null, 10, ownerId);

    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);

    const m = a.memory_usage;
    expect(m.total_memories).toBe(2);
    expect(m.memories_created_period).toBe(2);
    expect(m.searches).toBe(2);
    expect(m.searches_with_results).toBe(1);
    expect(m.search_hit_rate).toBe(50.0);
  });
});

// queryMemoryOutcomeCorrelation ───────────────────────────────────────

describe('queryMemoryOutcomeCorrelation - bucket semantics', () => {
  it('returns empty array on a fresh team', async () => {
    const team = getTeam('mq-corr-empty');
    const agentId = 'claude-code:mq-corr-empty';
    const ownerId = 'user-mq-corr-empty';

    await team.join(agentId, ownerId, 'carol', 'claude-code');
    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);
    expect(a.memory_outcome_correlation).toEqual([]);
  });

  it('uses the "searched, no results" label (not the old "missed search")', async () => {
    // The 2026-04-21 memory audit renamed this bucket for B1 clarity -
    // "missed search" read ambiguously ("searched for the wrong thing"
    // vs "searched and found nothing"). Regression guard.
    const team = getTeam('mq-corr-missed');
    const agentId = 'claude-code:mq-corr-missed';
    const ownerId = 'user-mq-corr-missed';

    await team.join(agentId, ownerId, 'dana', 'claude-code');
    const sess = await team.startSession(agentId, 'dana', 'react', ownerId);
    expect(sess.ok).toBe(true);

    await team.searchMemories(agentId, 'nothingexistsforthis', null, null, 10, ownerId);
    await team.endSession(agentId, sess.session_id, ownerId);

    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);

    const labels = a.memory_outcome_correlation.map((r) => r.bucket);
    expect(labels).toContain('searched, no results');
    expect(labels).not.toContain('missed search');
  });

  it('classifies a no-search session as "no search"', async () => {
    const team = getTeam('mq-corr-none');
    const agentId = 'claude-code:mq-corr-none';
    const ownerId = 'user-mq-corr-none';

    await team.join(agentId, ownerId, 'erin', 'claude-code');
    const sess = await team.startSession(agentId, 'erin', 'react', ownerId);
    await team.endSession(agentId, sess.session_id, ownerId);

    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);

    const row = a.memory_outcome_correlation.find((r) => r.bucket === 'no search');
    expect(row).toBeDefined();
    expect(row.sessions).toBeGreaterThanOrEqual(1);
  });

  it('classifies a hitting session as "hit memory"', async () => {
    const team = getTeam('mq-corr-hit');
    const agentId = 'claude-code:mq-corr-hit';
    const ownerId = 'user-mq-corr-hit';

    await team.join(agentId, ownerId, 'frank', 'claude-code');
    await team.saveMemory(
      agentId,
      'Primary Redis cache is cluster-mode on port 6380',
      ['ops'],
      null,
      'frank',
      null,
      ownerId,
    );

    const sess = await team.startSession(agentId, 'frank', 'react', ownerId);
    await team.searchMemories(agentId, 'Redis', null, null, 10, ownerId);
    await team.endSession(agentId, sess.session_id, ownerId);

    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);

    const row = a.memory_outcome_correlation.find((r) => r.bucket === 'hit memory');
    expect(row).toBeDefined();
    expect(row.sessions).toBeGreaterThanOrEqual(1);
  });
});

// queryTopMemories ────────────────────────────────────────────────────

describe('queryTopMemories', () => {
  it('returns empty array on a fresh team', async () => {
    const team = getTeam('mq-top-empty');
    const agentId = 'claude-code:mq-top-empty';
    const ownerId = 'user-mq-top-empty';

    await team.join(agentId, ownerId, 'gina', 'claude-code');
    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);
    expect(a.top_memories).toEqual([]);
  });

  it('excludes memories that were saved but never accessed', async () => {
    // top-memories windows by last_accessed_at, not by created_at. A
    // never-accessed memory must not appear - the widget is explicitly
    // "most-accessed," not "all memories."
    const team = getTeam('mq-top-unaccessed');
    const agentId = 'claude-code:mq-top-unaccessed';
    const ownerId = 'user-mq-top-unaccessed';

    await team.join(agentId, ownerId, 'henry', 'claude-code');
    await team.saveMemory(
      agentId,
      'Saved but never searched',
      ['ops'],
      null,
      'henry',
      null,
      ownerId,
    );

    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);
    expect(a.top_memories).toEqual([]);
  });

  it('returns only the accessed subset when some memories are searched and others are not', async () => {
    // The SQL throttles access_count increments so rapid back-to-back
    // searches inside one test can't reliably produce a count gradient
    // (see memory.ts:568 - last_accessed_at only bumps on stale rows).
    // What the test CAN lock in: the `access_count > 0 AND
    // last_accessed_at IS NOT NULL` filter means only memories the agent
    // actually retrieved appear in the list.
    const team = getTeam('mq-top-subset');
    const agentId = 'claude-code:mq-top-subset';
    const ownerId = 'user-mq-top-subset';

    await team.join(agentId, ownerId, 'iris', 'claude-code');
    await team.saveMemory(
      agentId,
      'Alpha-unique-token memory content',
      ['ops'],
      null,
      'iris',
      null,
      ownerId,
    );
    await team.saveMemory(
      agentId,
      'Beta-unique-token memory content',
      ['ops'],
      null,
      'iris',
      null,
      ownerId,
    );
    await team.saveMemory(
      agentId,
      'Gamma-unique-token memory content',
      ['ops'],
      null,
      'iris',
      null,
      ownerId,
    );

    // Retrieve two of three.
    await team.searchMemories(agentId, 'Alpha-unique-token', null, null, 10, ownerId);
    await team.searchMemories(agentId, 'Beta-unique-token', null, null, 10, ownerId);

    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);
    expect(a.top_memories.length).toBe(2);
    const previews = a.top_memories.map((m) => m.text_preview);
    expect(previews.some((p) => p.includes('Alpha-unique-token'))).toBe(true);
    expect(previews.some((p) => p.includes('Beta-unique-token'))).toBe(true);
    expect(previews.some((p) => p.includes('Gamma-unique-token'))).toBe(false);
  });

  it('truncates text_preview to 120 chars (plus ellipsis) for long entries', async () => {
    const team = getTeam('mq-top-preview');
    const agentId = 'claude-code:mq-top-preview';
    const ownerId = 'user-mq-top-preview';

    await team.join(agentId, ownerId, 'jules', 'claude-code');
    const longText = 'A'.repeat(200) + ' searchable-tail';
    await team.saveMemory(agentId, longText, ['ops'], null, 'jules', null, ownerId);
    await team.searchMemories(agentId, 'searchable-tail', null, null, 10, ownerId);

    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);
    expect(a.top_memories.length).toBe(1);
    // 120 char body + '...' suffix.
    expect(a.top_memories[0].text_preview.length).toBe(123);
    expect(a.top_memories[0].text_preview.endsWith('...')).toBe(true);
  });
});

// queryMemoryPerEntryOutcomes ─────────────────────────────────────────
//
// The per-memory outcome correlation is gated on the memory_search_results
// join (migration 028). These tests lock in: empty on a fresh team, only
// memories above the min-sample floor surface, and completion_rate
// reflects distinct sessions that returned a memory rather than raw
// search calls.

describe('queryMemoryPerEntryOutcomes', () => {
  it('returns empty array on a fresh team', async () => {
    const team = getTeam('mq-pme-empty');
    const agentId = 'claude-code:mq-pme-empty';
    const ownerId = 'user-mq-pme-empty';

    await team.join(agentId, ownerId, 'jules', 'claude-code');
    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);
    expect(a.memory_per_entry_outcomes).toEqual([]);
  });

  it('suppresses memories that fall under the min-sample floor', async () => {
    // Per-memory rates pivot wildly at low N. The query enforces a
    // 3-session floor; a memory returned by exactly one completed session
    // would otherwise read as 100% with no honest signal behind it.
    const team = getTeam('mq-pme-low-n');
    const agentId = 'claude-code:mq-pme-low-n';
    const ownerId = 'user-mq-pme-low-n';

    await team.join(agentId, ownerId, 'kayla', 'claude-code');
    await team.saveMemory(
      agentId,
      'Lonely-memory unique-token under sample floor',
      ['ops'],
      null,
      'kayla',
      null,
      ownerId,
    );

    const sess = await team.startSession(agentId, 'kayla', 'react', ownerId);
    expect(sess.ok).toBe(true);
    await team.searchMemories(agentId, 'Lonely-memory', null, null, 10, ownerId);
    await team.reportOutcome(agentId, 'completed', null, ownerId);
    await team.endSession(agentId, sess.session_id, ownerId);

    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);
    // One session is below the 3-session floor; nothing should surface.
    expect(a.memory_per_entry_outcomes).toEqual([]);
  });

  it('attributes per-memory completion across distinct sessions', async () => {
    // Same memory returned by 3 sessions, 2 of which complete. Expect a
    // single entry with sessions=3, completed=2, completion_rate=66.7.
    const team = getTeam('mq-pme-attribution');
    const agentId = 'claude-code:mq-pme-attribution';
    const ownerId = 'user-mq-pme-attribution';

    await team.join(agentId, ownerId, 'liam', 'claude-code');
    await team.saveMemory(
      agentId,
      'Quark-unique-token target memory',
      ['ops'],
      null,
      'liam',
      null,
      ownerId,
    );

    for (let i = 0; i < 3; i++) {
      const sess = await team.startSession(agentId, 'liam', 'react', ownerId);
      expect(sess.ok).toBe(true);
      await team.searchMemories(agentId, 'Quark-unique-token', null, null, 10, ownerId);
      // First two sessions complete; third abandons.
      const outcome = i < 2 ? 'completed' : 'abandoned';
      await team.reportOutcome(agentId, outcome, null, ownerId);
      await team.endSession(agentId, sess.session_id, ownerId);
    }

    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);
    const entry = a.memory_per_entry_outcomes.find((m) =>
      m.text_preview.includes('Quark-unique-token'),
    );
    expect(entry).toBeDefined();
    expect(entry.sessions).toBe(3);
    expect(entry.completed).toBe(2);
    // 2/3 = 66.666... rounded to 1dp = 66.7.
    expect(entry.completion_rate).toBeCloseTo(66.7, 1);
  });

  it('counts a session once even when it searches the same memory twice', async () => {
    // PRIMARY KEY (session_id, memory_id) on memory_search_results means a
    // session that re-searches and re-fetches the same memory only counts
    // once. The question is "did this session see this memory," not "how
    // many times did the agent re-fetch it."
    const team = getTeam('mq-pme-dedupe');
    const agentId = 'claude-code:mq-pme-dedupe';
    const ownerId = 'user-mq-pme-dedupe';

    await team.join(agentId, ownerId, 'maya', 'claude-code');
    await team.saveMemory(
      agentId,
      'Photon-unique-token target memory',
      ['ops'],
      null,
      'maya',
      null,
      ownerId,
    );

    // Three sessions; each searches the same memory three times.
    for (let i = 0; i < 3; i++) {
      const sess = await team.startSession(agentId, 'maya', 'react', ownerId);
      for (let k = 0; k < 3; k++) {
        await team.searchMemories(agentId, 'Photon-unique-token', null, null, 10, ownerId);
      }
      await team.reportOutcome(agentId, 'completed', null, ownerId);
      await team.endSession(agentId, sess.session_id, ownerId);
    }

    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);
    const entry = a.memory_per_entry_outcomes.find((m) =>
      m.text_preview.includes('Photon-unique-token'),
    );
    expect(entry).toBeDefined();
    // 3 distinct sessions, not 9.
    expect(entry.sessions).toBe(3);
    expect(entry.completed).toBe(3);
    expect(entry.completion_rate).toBe(100);
  });
});

// queryCrossToolMemoryFlow ────────────────────────────────────────────
//
// The cross-tool flow is rebuilt on the memory_search_results join so the
// numbers reflect actual reads, not co-presence. These tests lock in:
// empty on a fresh team, same-tool reads do not appear, distinct
// (author_tool, consumer_tool) pairs surface with the right counts, and
// within-session dedupe is enforced by the join PK.

describe('queryCrossToolMemoryFlow', () => {
  it('returns empty array on a fresh team', async () => {
    const team = getTeam('mq-xtf-empty');
    const agentId = 'claude-code:mq-xtf-empty';
    const ownerId = 'user-mq-xtf-empty';

    await team.join(agentId, ownerId, 'nick', 'claude-code');
    const a = await team.getAnalytics(agentId, 7, ownerId, true);
    expect(a.ok).toBe(true);
    expect(a.cross_tool_memory_flow).toEqual([]);
  });

  it('excludes same-tool reads', async () => {
    // A claude-code session reading a memory written by another claude-code
    // session is in-tool reuse, not cross-tool flow. The query filters on
    // m.host_tool != s.host_tool, so the row should not appear.
    const team = getTeam('mq-xtf-same-tool');
    const claudeAgent = 'claude-code:mq-xtf-same-tool';
    const ownerId = 'user-mq-xtf-same-tool';

    await team.join(claudeAgent, ownerId, 'olive', 'claude-code');
    await team.saveMemory(
      claudeAgent,
      'Same-tool-token only claude-code touches this',
      ['ops'],
      null,
      'olive',
      null,
      ownerId,
    );

    const sess = await team.startSession(claudeAgent, 'olive', 'react', null, ownerId);
    expect(sess.ok).toBe(true);
    await team.searchMemories(claudeAgent, 'Same-tool-token', null, null, 10, ownerId);
    await team.endSession(claudeAgent, sess.session_id, ownerId);

    const a = await team.getAnalytics(claudeAgent, 7, ownerId, true);
    expect(a.ok).toBe(true);
    expect(a.cross_tool_memory_flow).toEqual([]);
  });

  it('attributes reads from a different tool to the right author/consumer pair', async () => {
    // claude-code writes a memory, cursor's session searches and finds it.
    // The join writes one row keyed on (cursor_session_id, memory_id), and
    // the cross-tool query groups it as (claude-code → cursor).
    const team = getTeam('mq-xtf-cross-tool');
    const claudeAgent = 'claude-code:mq-xtf-cross-tool';
    const cursorAgent = 'cursor:mq-xtf-cross-tool';
    const ownerId = 'user-mq-xtf-cross-tool';

    await team.join(claudeAgent, ownerId, 'paul', 'claude-code');
    await team.join(cursorAgent, ownerId, 'paul', 'cursor');
    await team.saveMemory(
      claudeAgent,
      'Plasma-unique-token shared across tools',
      ['ops'],
      null,
      'paul',
      null,
      ownerId,
    );

    const cursorSess = await team.startSession(cursorAgent, 'paul', 'react', null, ownerId);
    expect(cursorSess.ok).toBe(true);
    await team.searchMemories(cursorAgent, 'Plasma-unique-token', null, null, 10, ownerId);
    await team.endSession(cursorAgent, cursorSess.session_id, ownerId);

    const a = await team.getAnalytics(claudeAgent, 7, ownerId, true);
    expect(a.ok).toBe(true);
    const pair = a.cross_tool_memory_flow.find(
      (r) => r.author_tool === 'claude-code' && r.consumer_tool === 'cursor',
    );
    expect(pair).toBeDefined();
    expect(pair.memories_read).toBe(1);
    expect(pair.reading_sessions).toBe(1);
    // Reverse pair must not exist - cursor wrote nothing for claude-code to read.
    const reverse = a.cross_tool_memory_flow.find(
      (r) => r.author_tool === 'cursor' && r.consumer_tool === 'claude-code',
    );
    expect(reverse).toBeUndefined();
  });

  it('counts a session once even when it re-searches the same memory', async () => {
    // PRIMARY KEY (session_id, memory_id) on memory_search_results means a
    // session that re-fetches the same cross-tool memory only contributes
    // one row. memories_read uses COUNT(DISTINCT memory_id) and
    // reading_sessions uses COUNT(DISTINCT session_id), so the pair
    // remains 1×1 even after multiple searches.
    const team = getTeam('mq-xtf-dedupe');
    const claudeAgent = 'claude-code:mq-xtf-dedupe';
    const cursorAgent = 'cursor:mq-xtf-dedupe';
    const ownerId = 'user-mq-xtf-dedupe';

    await team.join(claudeAgent, ownerId, 'quinn', 'claude-code');
    await team.join(cursorAgent, ownerId, 'quinn', 'cursor');
    await team.saveMemory(
      claudeAgent,
      'Quasar-unique-token re-read across calls',
      ['ops'],
      null,
      'quinn',
      null,
      ownerId,
    );

    const cursorSess = await team.startSession(cursorAgent, 'quinn', 'react', null, ownerId);
    for (let k = 0; k < 4; k++) {
      await team.searchMemories(cursorAgent, 'Quasar-unique-token', null, null, 10, ownerId);
    }
    await team.endSession(cursorAgent, cursorSess.session_id, ownerId);

    const a = await team.getAnalytics(claudeAgent, 7, ownerId, true);
    expect(a.ok).toBe(true);
    const pair = a.cross_tool_memory_flow.find(
      (r) => r.author_tool === 'claude-code' && r.consumer_tool === 'cursor',
    );
    expect(pair).toBeDefined();
    expect(pair.memories_read).toBe(1);
    expect(pair.reading_sessions).toBe(1);
  });
});
