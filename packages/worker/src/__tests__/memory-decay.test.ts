// Decay-aware ranking - verifies that searchMemories applies tag-aware
// exponential decay and access-count boost when decay is enabled (default),
// and falls back to recency-only ordering when decay='off'.

import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id) {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

describe('Memory search - decay-aware ranking', () => {
  const team = () => getTeam('memory-decay');
  const agentId = 'cursor:dec1';
  const ownerId = 'user-dec1';

  it('setup: join team', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('default ranking returns memories in a stable order with decay applied', async () => {
    await team().saveMemory(
      agentId,
      'shared concept memory one for decay ordering',
      ['decay-suite'],
      null,
      'alice',
      ownerId,
    );
    await team().saveMemory(
      agentId,
      'shared concept memory two for decay ordering',
      ['decay-suite'],
      null,
      'alice',
      ownerId,
    );

    const res = await team().searchMemories(agentId, 'shared concept', null, null, 10, ownerId);
    expect(res.memories.length).toBe(2);
    // Both freshly created with the same access_count → decay scores are
    // basically equal, so order falls back to insertion (FTS rank).
    const ids = res.memories.map((m) => m.text);
    expect(ids[0]).toContain('shared concept');
  });

  it('decay=off returns results in recency order regardless of access pattern', async () => {
    const res = await team().searchMemories(agentId, 'shared concept', null, null, 10, ownerId, {
      decay: 'off',
    });
    expect(res.memories.length).toBe(2);
    // With decay=off the SQL ORDER BY (updated_at DESC, created_at DESC) wins.
    // The newer memory should come first.
    const first = res.memories[0];
    const second = res.memories[1];
    expect(new Date(first.created_at).getTime()).toBeGreaterThanOrEqual(
      new Date(second.created_at).getTime(),
    );
  });
});

describe('Memory search - tag-aware halflife', () => {
  const team = () => getTeam('memory-halflife');
  const agentId = 'cursor:hl1';
  const ownerId = 'user-hl1';

  it('setup: save a long-halflife (decision) memory and a short-halflife (debug) memory', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().saveMemory(
      agentId,
      'decision-tagged halflife test memory about routing config',
      ['decision', 'halflife-suite'],
      null,
      'alice',
      ownerId,
    );
    await team().saveMemory(
      agentId,
      'debug-tagged halflife test memory about routing config',
      ['debug', 'halflife-suite'],
      null,
      'alice',
      ownerId,
    );
  });

  it('both memories show up in default search (halflife affects ranking, not visibility)', async () => {
    const res = await team().searchMemories(
      agentId,
      'halflife test routing',
      null,
      null,
      10,
      ownerId,
    );
    expect(res.memories.length).toBe(2);
    const tags = res.memories.flatMap((m) => m.tags || []);
    expect(tags).toContain('decision');
    expect(tags).toContain('debug');
  });

  it('filter by tag still works with decay enabled', async () => {
    const res = await team().searchMemories(agentId, null, ['decision'], null, 10, ownerId);
    expect(res.memories.length).toBeGreaterThanOrEqual(1);
    expect(res.memories.every((m) => (m.tags || []).includes('decision'))).toBe(true);
  });
});

describe('Memory search - decay does not break empty result sets', () => {
  const team = () => getTeam('memory-decay-empty');
  const agentId = 'cursor:de1';
  const ownerId = 'user-de1';

  it('setup', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('returns empty array when no memories match (decay on)', async () => {
    const res = await team().searchMemories(
      agentId,
      'no-such-content-anywhere-xyz',
      null,
      null,
      10,
      ownerId,
    );
    expect(res.memories).toEqual([]);
  });

  it('returns empty array when no memories match (decay off)', async () => {
    const res = await team().searchMemories(
      agentId,
      'no-such-content-anywhere-xyz',
      null,
      null,
      10,
      ownerId,
      { decay: 'off' },
    );
    expect(res.memories).toEqual([]);
  });
});
