// Memory analytics queries — covers queryMemoryUsage,
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

describe('queryMemoryUsage — empty team', () => {
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
    // artifact — both worth a second look.
    expect(m.memories_updated_period).toBeUndefined();
    expect(m.merged_memories).toBeUndefined();
    expect(m.secrets_blocked_period).toBeUndefined();
  });
});

describe('queryMemoryUsage — populated', () => {
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

    // Two searches: one that hits, one that misses — should produce 50% hit rate.
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

describe('queryMemoryOutcomeCorrelation — bucket semantics', () => {
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
    // The 2026-04-21 memory audit renamed this bucket for B1 clarity —
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
    // never-accessed memory must not appear — the widget is explicitly
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
    // (see memory.ts:568 — last_accessed_at only bumps on stale rows).
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
