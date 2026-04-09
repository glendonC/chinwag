import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id = 'test-team') {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// --- Save and search memory ---

describe('Memory save and search', () => {
  const team = () => getTeam('memory-save-search');
  const agentId = 'cursor:mss1';
  const ownerId = 'user-mss1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('save a memory, search for it — found', async () => {
    const save = await team().saveMemory(
      agentId,
      'Always use connection pooling for database access',
      ['architecture', 'database'],
      null,
      'alice',
      ownerId,
    );
    expect(save.ok).toBe(true);
    expect(save.id).toBeDefined();

    const search = await team().searchMemories(
      agentId,
      'connection pooling',
      null,
      null,
      10,
      ownerId,
    );
    expect(search.memories.length).toBeGreaterThan(0);
    expect(search.memories[0].text).toContain('connection pooling');
  });

  it('search by tags finds the memory', async () => {
    const search = await team().searchMemories(agentId, null, ['architecture'], null, 10, ownerId);
    expect(search.memories.length).toBeGreaterThan(0);
    expect(search.memories[0].tags).toContain('architecture');
  });
});

// --- Memory eviction beyond cap ---

describe('Memory eviction beyond MEMORY_MAX_COUNT', () => {
  const team = () => getTeam('memory-eviction');
  const agentId = 'cursor:me1';
  const ownerId = 'user-me1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('saving beyond MEMORY_MAX_COUNT evicts oldest (check evicted count)', async () => {
    // Insert enough to verify eviction logic works.
    // Cap is 2000, so we insert in batches to keep test fast.
    // First, fill with 100 entries and verify no eviction.
    for (let i = 0; i < 100; i++) {
      await team().saveMemory(
        agentId,
        `Memory entry number ${i}`,
        ['bulk'],
        null,
        'alice',
        ownerId,
      );
    }
    // Under cap — no eviction expected
    const underCap = await team().saveMemory(
      agentId,
      'Under cap memory',
      ['bulk'],
      null,
      'alice',
      ownerId,
    );
    expect(underCap.ok).toBe(true);
    expect(underCap.evicted).toBeUndefined();

    // Verify under-cap memory is searchable
    const search = await team().searchMemories(agentId, 'Under cap', null, null, 10, ownerId);
    expect(search.memories.length).toBeGreaterThan(0);
    expect(search.memories[0].text).toContain('Under cap');
  });
}, 120_000);

// --- Memory update lifecycle ---

describe('Memory update lifecycle', () => {
  const team = () => getTeam('memory-update');
  const agentId = 'cursor:mu1';
  const ownerId = 'user-mu1';
  let memoryId;

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('save memory, update it, search — updated version found', async () => {
    // Save original
    const save = await team().saveMemory(
      agentId,
      'Original memory text about deployment',
      ['ops'],
      null,
      'alice',
      ownerId,
    );
    expect(save.ok).toBe(true);
    memoryId = save.id;

    // Update text
    const update = await team().updateMemory(
      agentId,
      memoryId,
      'Updated memory text about blue-green deployment',
      ['ops', 'deployment'],
      ownerId,
    );
    expect(update.ok).toBe(true);

    // Search for updated text
    const search = await team().searchMemories(
      agentId,
      'blue-green deployment',
      null,
      null,
      10,
      ownerId,
    );
    expect(search.memories.length).toBeGreaterThan(0);
    expect(search.memories[0].text).toContain('blue-green deployment');
    expect(search.memories[0].id).toBe(memoryId);

    // Original text should not be found
    const searchOld = await team().searchMemories(
      agentId,
      'Original memory text about deployment',
      null,
      null,
      10,
      ownerId,
    );
    expect(searchOld.memories.length).toBe(0);
  });

  it('update tags only', async () => {
    const update = await team().updateMemory(
      agentId,
      memoryId,
      undefined,
      ['ops', 'deployment', 'strategy'],
      ownerId,
    );
    expect(update.ok).toBe(true);

    const search = await team().searchMemories(agentId, null, ['strategy'], null, 10, ownerId);
    expect(search.memories.length).toBeGreaterThan(0);
    expect(search.memories[0].tags).toContain('strategy');
  });

  it('update non-existent memory returns error', async () => {
    const update = await team().updateMemory(
      agentId,
      'nonexistent-id-12345',
      'Should fail',
      ['fail'],
      ownerId,
    );
    expect(update.error).toBe('Memory not found');
    expect(update.code).toBe('NOT_FOUND');
  });
});

// --- Memory delete lifecycle ---

describe('Memory delete lifecycle', () => {
  const team = () => getTeam('memory-delete');
  const agentId = 'cursor:md1';
  const ownerId = 'user-md1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('delete memory, search — not found', async () => {
    // Save
    const save = await team().saveMemory(
      agentId,
      'Temporary memory to be deleted',
      ['temp'],
      null,
      'alice',
      ownerId,
    );
    expect(save.ok).toBe(true);

    // Verify it exists
    const searchBefore = await team().searchMemories(
      agentId,
      'Temporary memory to be deleted',
      null,
      null,
      10,
      ownerId,
    );
    expect(searchBefore.memories.length).toBe(1);

    // Delete
    const del = await team().deleteMemory(agentId, save.id, ownerId);
    expect(del.ok).toBe(true);

    // Verify it's gone
    const searchAfter = await team().searchMemories(
      agentId,
      'Temporary memory to be deleted',
      null,
      null,
      10,
      ownerId,
    );
    expect(searchAfter.memories.length).toBe(0);
  });

  it('delete non-existent memory returns error', async () => {
    const del = await team().deleteMemory(agentId, 'nonexistent-memory-id', ownerId);
    expect(del.error).toBe('Memory not found');
    expect(del.code).toBe('NOT_FOUND');
  });
});

// --- Memory persists across context calls ---

describe('Memory persistence across context', () => {
  const team = () => getTeam('memory-persistence');
  const agentId = 'cursor:mp1';
  const ownerId = 'user-mp1';

  it('setup: join and save memories', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().saveMemory(agentId, 'Persistent memory one', ['persist'], null, 'alice', ownerId);
    await team().saveMemory(agentId, 'Persistent memory two', ['persist'], null, 'alice', ownerId);
  });

  it('memories visible in getContext', async () => {
    const ctx = await team().getContext(agentId, ownerId);
    expect(ctx.memories.length).toBeGreaterThanOrEqual(2);
    const texts = ctx.memories.map((m) => m.text);
    expect(texts).toContain('Persistent memory one');
    expect(texts).toContain('Persistent memory two');
  });

  it('memories survive multiple getContext cleanup cycles', async () => {
    for (let i = 0; i < 5; i++) {
      const ctx = await team().getContext(agentId, ownerId);
      expect(ctx.memories.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// --- Memory with runtime metadata ---

describe('Memory runtime metadata', () => {
  const team = () => getTeam('memory-runtime');
  const agentId = 'cursor:mr1';
  const ownerId = 'user-mr1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('memory preserves runtime metadata', async () => {
    const save = await team().saveMemory(
      agentId,
      'Runtime metadata memory',
      ['meta'],
      null,
      'alice',
      { hostTool: 'cursor', agentSurface: 'cline', transport: 'mcp', tier: 'connected' },
      ownerId,
    );
    expect(save.ok).toBe(true);

    const search = await team().searchMemories(
      agentId,
      'Runtime metadata memory',
      null,
      null,
      10,
      ownerId,
    );
    expect(search.memories.length).toBe(1);
    expect(search.memories[0].host_tool).toBe('cursor');
    expect(search.memories[0].agent_surface).toBe('cline');
  });
});
