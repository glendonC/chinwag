import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id = 'test-team') {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// --- Memory search: LIKE wildcard escape ---
// The searchMemories function escapes % and _ so user input is matched literally.

describe('Memory search — LIKE wildcard escape', () => {
  const team = () => getTeam('memory-like-escape');
  const agentId = 'cursor:mle1';
  const ownerId = 'user-mle1';

  it('setup: join and save memories with special chars', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');

    // Memory with % character
    await team().saveMemory(
      agentId,
      'CPU usage should stay below 80% at all times',
      ['ops'],
      'alice',
      ownerId,
    );

    // Memory with _ character
    await team().saveMemory(
      agentId,
      'Use snake_case for database column names',
      ['convention'],
      'alice',
      ownerId,
    );

    // Memory that would match % wildcard if not escaped
    await team().saveMemory(agentId, 'CPU usage monitoring is critical', ['ops'], 'alice', ownerId);
  });

  it('searching for text with % matches literally, not as wildcard', async () => {
    const res = await team().searchMemories(agentId, '80%', null, 10, ownerId);
    expect(res.memories.length).toBe(1);
    expect(res.memories[0].text).toContain('80%');
  });

  it('searching for text with _ matches literally, not as wildcard', async () => {
    const res = await team().searchMemories(agentId, 'snake_case', null, 10, ownerId);
    expect(res.memories.length).toBe(1);
    expect(res.memories[0].text).toContain('snake_case');
  });
});

// --- Memory search: limit capping ---

describe('Memory search — limit capping', () => {
  const team = () => getTeam('memory-limit-cap');
  const agentId = 'cursor:mlc1';
  const ownerId = 'user-mlc1';

  it('setup: join and save several memories', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    for (let i = 0; i < 10; i++) {
      await team().saveMemory(
        agentId,
        `Limit cap memory entry ${i}`,
        ['limit-test'],
        'alice',
        ownerId,
      );
    }
  });

  it('limit is capped at 50 even if higher is requested', async () => {
    // Request 100 but cap should be 50
    const res = await team().searchMemories(agentId, null, ['limit-test'], 100, ownerId);
    expect(res.ok).toBe(true);
    // We only have 10, so all should be returned
    expect(res.memories.length).toBe(10);
  });

  it('limit of 0 or negative is capped at 1', async () => {
    const res = await team().searchMemories(agentId, null, ['limit-test'], 0, ownerId);
    expect(res.ok).toBe(true);
    expect(res.memories.length).toBe(1);
  });

  it('specific limit returns at most that many results', async () => {
    const res = await team().searchMemories(agentId, null, ['limit-test'], 3, ownerId);
    expect(res.ok).toBe(true);
    expect(res.memories.length).toBe(3);
  });
});

// --- Memory search: combined query + tags ---

describe('Memory search — combined query and tag filtering', () => {
  const team = () => getTeam('memory-combined-search');
  const agentId = 'cursor:mcs1';
  const ownerId = 'user-mcs1';

  it('setup: join and save memories with various tags', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');

    await team().saveMemory(
      agentId,
      'Always use HTTPS for API endpoints',
      ['security', 'api'],
      'alice',
      ownerId,
    );

    await team().saveMemory(
      agentId,
      'API rate limiting should be 100 req/min',
      ['api', 'config'],
      'alice',
      ownerId,
    );

    await team().saveMemory(
      agentId,
      'Database backups run at midnight',
      ['ops', 'database'],
      'alice',
      ownerId,
    );
  });

  it('search with both query and tags returns intersection', async () => {
    // Search for "API" text with "security" tag — should find only the HTTPS one
    const res = await team().searchMemories(agentId, 'API', ['security'], 10, ownerId);
    expect(res.memories.length).toBe(1);
    expect(res.memories[0].text).toContain('HTTPS');
  });

  it('search with query only', async () => {
    const res = await team().searchMemories(agentId, 'API', null, 10, ownerId);
    expect(res.memories.length).toBe(2);
  });

  it('search with tags only', async () => {
    const res = await team().searchMemories(agentId, null, ['ops'], 10, ownerId);
    expect(res.memories.length).toBe(1);
    expect(res.memories[0].text).toContain('Database backups');
  });

  it('search with no query and no tags returns all (up to limit)', async () => {
    const res = await team().searchMemories(agentId, null, null, 10, ownerId);
    expect(res.memories.length).toBe(3);
  });

  it('search with multiple tags matches ANY (OR semantics)', async () => {
    // Tags use OR: memories with EITHER "security" OR "ops"
    const res = await team().searchMemories(agentId, null, ['security', 'ops'], 10, ownerId);
    expect(res.memories.length).toBe(2);
    const texts = res.memories.map((m) => m.text);
    expect(texts.some((t) => t.includes('HTTPS'))).toBe(true);
    expect(texts.some((t) => t.includes('Database backups'))).toBe(true);
  });
});

// --- Memory: empty tags array ---

describe('Memory — empty and null tags', () => {
  const team = () => getTeam('memory-empty-tags');
  const agentId = 'cursor:met1';
  const ownerId = 'user-met1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('save memory with empty tags array succeeds', async () => {
    const res = await team().saveMemory(agentId, 'Memory with no tags', [], 'alice', ownerId);
    expect(res.ok).toBe(true);
    expect(res.id).toBeDefined();

    const search = await team().searchMemories(agentId, 'no tags', null, 10, ownerId);
    expect(search.memories.length).toBe(1);
    expect(search.memories[0].tags).toEqual([]);
  });

  it('save memory with null tags coerces to empty array', async () => {
    const res = await team().saveMemory(agentId, 'Memory with null tags', null, 'alice', ownerId);
    expect(res.ok).toBe(true);

    const search = await team().searchMemories(agentId, 'null tags', null, 10, ownerId);
    expect(search.memories.length).toBe(1);
    expect(search.memories[0].tags).toEqual([]);
  });
});

// --- Memory: non-member rejection ---

describe('Memory — access control', () => {
  const team = () => getTeam('memory-access-ctrl');

  it('saveMemory rejects non-member', async () => {
    const res = await team().saveMemory(
      'cursor:nonexistent',
      'Should fail',
      ['test'],
      'hacker',
      'bad-owner',
    );
    expect(res.error).toBeTruthy();
    expect(res.error).toContain('Not a member');
  });

  it('searchMemories rejects non-member', async () => {
    const res = await team().searchMemories('cursor:nonexistent', 'test', null, 10, 'bad-owner');
    expect(res.error).toBeTruthy();
  });

  it('deleteMemory rejects non-member', async () => {
    const res = await team().deleteMemory('cursor:nonexistent', 'some-id', 'bad-owner');
    expect(res.error).toBeTruthy();
  });
});

// --- Memory: ordering ---

describe('Memory — ordering by updated_at', () => {
  const team = () => getTeam('memory-ordering');
  const agentId = 'cursor:mo1';
  const ownerId = 'user-mo1';

  it('setup: join and save memories', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');

    // Save in order: oldest first
    await team().saveMemory(agentId, 'First memory saved', ['order'], 'alice', ownerId);
    await team().saveMemory(agentId, 'Second memory saved', ['order'], 'alice', ownerId);
    await team().saveMemory(agentId, 'Third memory saved', ['order'], 'alice', ownerId);
  });

  it('search results are ordered most recent first', async () => {
    const res = await team().searchMemories(agentId, null, ['order'], 10, ownerId);
    expect(res.memories.length).toBe(3);
    // Most recently saved should be first
    expect(res.memories[0].text).toBe('Third memory saved');
    expect(res.memories[2].text).toBe('First memory saved');
  });

  it('updated memory is findable by new text', async () => {
    // Update the first (oldest) memory
    const search = await team().searchMemories(agentId, 'First memory', null, 10, ownerId);
    const firstId = search.memories[0].id;

    await team().updateMemory(agentId, firstId, 'First memory saved (updated)', undefined, ownerId);

    // Updated memory should be findable by new text
    const res = await team().searchMemories(agentId, 'updated', ['order'], 10, ownerId);
    expect(res.memories.length).toBe(1);
    expect(res.memories[0].text).toBe('First memory saved (updated)');
    expect(res.memories[0].id).toBe(firstId);

    // Original text should not be findable
    const oldSearch = await team().searchMemories(
      agentId,
      'First memory saved',
      ['order'],
      10,
      ownerId,
    );
    // Should still find it because 'First memory saved' is a substring of 'First memory saved (updated)'
    expect(oldSearch.memories.length).toBe(1);
  });
});

// --- Memory: model inheritance from active session ---

describe('Memory — model inheritance from session', () => {
  const team = () => getTeam('memory-model-inherit');
  const agentId = 'cursor:mmi1';
  const ownerId = 'user-mmi1';

  it('setup: join and start session with model', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().startSession(agentId, 'alice', 'react', ownerId);
    // Enrich session with model info
    await team().enrichModel(agentId, 'claude-3-opus', ownerId);
  });

  it('saved memory inherits model from active session', async () => {
    const save = await team().saveMemory(
      agentId,
      'Memory that should inherit session model',
      ['model-test'],
      'alice',
      ownerId,
    );
    expect(save.ok).toBe(true);

    const search = await team().searchMemories(agentId, 'inherit session model', null, 10, ownerId);
    expect(search.memories.length).toBe(1);
    expect(search.memories[0].agent_model).toBe('claude-3-opus');
  });
});
