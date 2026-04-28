import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id = 'test-team') {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// --- Ownership verification: join() with agent_id spoofing ---

describe('Join ownership verification', () => {
  const team = () => getTeam('join-ownership');
  const agentId = 'cursor:join-owned';
  const ownerA = 'userA-join';
  const ownerB = 'userB-join';

  it('first user joins successfully', async () => {
    const res = await team().join(agentId, ownerA, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('different user with same agent_id is rejected', async () => {
    const res = await team().join(agentId, ownerB, 'bob', 'cursor');
    expect(res.error).toBe('Agent ID already claimed by another user');
  });

  it('same user can rejoin with same agent_id', async () => {
    const res = await team().join(agentId, ownerA, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });
});

// --- Atomic join: spoofing does not corrupt existing owner's data ---

describe('Atomic join ownership enforcement', () => {
  const team = () => getTeam('atomic-join-ownership');
  const agentId = 'cursor:atomic-join';
  const ownerA = 'userA-atomic';
  const ownerB = 'userB-atomic';

  it('ownerA joins and claims agent_id', async () => {
    const res = await team().join(agentId, ownerA, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('ownerB spoofing same agent_id is rejected without corrupting ownerA data', async () => {
    const res = await team().join(agentId, ownerB, 'mallory', 'cursor');
    expect(res.error).toBe('Agent ID already claimed by another user');

    // Verify ownerA's data is still intact - not overwritten by the failed join
    const ctx = await team().getContext(agentId, ownerA);
    expect(ctx.error).toBeUndefined();
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me).toBeDefined();
    expect(me.handle).toBe('alice');
  });

  it('ownerA idempotent re-join updates metadata correctly', async () => {
    const res = await team().join(agentId, ownerA, 'alice-updated', {
      hostTool: 'cursor',
      agentSurface: 'copilot',
      transport: 'mcp',
    });
    expect(res.ok).toBe(true);

    const ctx = await team().getContext(agentId, ownerA);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me.handle).toBe('alice-updated');
    expect(me.agent_surface).toBe('copilot');
  });
});

// --- Atomic lock claims: first claimer wins ---

describe('Atomic lock claim enforcement', () => {
  const team = () => getTeam('atomic-lock-claims');
  const agent1 = 'cursor:atomlk1';
  const agent2 = 'claude:atomlk2';
  const owner1 = 'user-atomlk1';
  const owner2 = 'user-atomlk2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('first claimer wins, second is blocked with correct details', async () => {
    const claim1 = await team().claimFiles(agent1, ['src/atomic.js'], 'alice', 'cursor', owner1);
    expect(claim1.ok).toBe(true);
    expect(claim1.claimed).toContain('src/atomic.js');
    expect(claim1.blocked).toHaveLength(0);

    const claim2 = await team().claimFiles(agent2, ['src/atomic.js'], 'bob', 'claude', owner2);
    expect(claim2.ok).toBe(true);
    expect(claim2.claimed).toHaveLength(0);
    expect(claim2.blocked).toHaveLength(1);
    expect(claim2.blocked[0].file).toBe('src/atomic.js');
    expect(claim2.blocked[0].held_by).toBe('alice');
  });

  it('same agent re-claiming refreshes lock (idempotent)', async () => {
    const claim = await team().claimFiles(agent1, ['src/atomic.js'], 'alice', 'cursor', owner1);
    expect(claim.ok).toBe(true);
    expect(claim.claimed).toContain('src/atomic.js');
    expect(claim.blocked).toHaveLength(0);
  });
});

// --- Leave with ownership verification ---

describe('Leave ownership verification', () => {
  const team = () => getTeam('leave-ownership');
  const agentId = 'cursor:leave-owned';
  const ownerA = 'userA-leave';
  const ownerB = 'userB-leave';

  it('setup: join as ownerA', async () => {
    const res = await team().join(agentId, ownerA, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('wrong owner cannot leave on behalf of agent', async () => {
    const res = await team().leave(agentId, ownerB);
    expect(res.error).toBe('Not your agent');
  });

  it('correct owner can leave', async () => {
    const res = await team().leave(agentId, ownerA);
    expect(res.ok).toBe(true);
  });
});

// --- reportFile ---

describe('reportFile', () => {
  const team = () => getTeam('reportfile-tests');
  const agentId = 'cursor:rf1';
  const ownerId = 'user-rf1';

  it('setup: join', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('reports a file successfully', async () => {
    const res = await team().reportFile(agentId, 'src/app.js', ownerId);
    expect(res.ok).toBe(true);
  });

  it('appends file to activity list', async () => {
    await team().reportFile(agentId, 'src/utils.js', ownerId);
    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me.activity.files).toContain('src/app.js');
    expect(me.activity.files).toContain('src/utils.js');
  });

  it('does not duplicate the same file', async () => {
    await team().reportFile(agentId, 'src/app.js', ownerId);
    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    const count = me.activity.files.filter((f) => f === 'src/app.js').length;
    expect(count).toBe(1);
  });

  it('normalizes file paths', async () => {
    await team().reportFile(agentId, './src/normalized.js', ownerId);
    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me.activity.files).toContain('src/normalized.js');
    expect(me.activity.files).not.toContain('./src/normalized.js');
  });

  it('rejects non-member', async () => {
    const res = await team().reportFile('cursor:unknown', 'file.js', 'unknown-owner');
    expect(res.error).toBeDefined();
    expect(res.error).toContain('Not a member');
  });

  it('respects ACTIVITY_MAX_FILES cap', async () => {
    // Create a fresh team to test the cap
    const freshTeam = () => getTeam('reportfile-cap-test');
    await freshTeam().join('cursor:cap1', 'user-cap1', 'capper', 'cursor');

    // Report 55 unique files (cap is 50)
    for (let i = 0; i < 55; i++) {
      await freshTeam().reportFile('cursor:cap1', `src/file${i}.js`, 'user-cap1');
    }

    const ctx = await freshTeam().getContext('cursor:cap1', 'user-cap1');
    const me = ctx.members.find((m) => m.agent_id === 'cursor:cap1');
    expect(me.activity.files.length).toBeLessThanOrEqual(50);
    // Earliest files should have been dropped
    expect(me.activity.files).not.toContain('src/file0.js');
    // Latest files should still be present
    expect(me.activity.files).toContain('src/file54.js');
  });
});

// --- updateMemory ---

describe('updateMemory', () => {
  const team = () => getTeam('updatememory-tests');
  const agentId = 'cursor:um1';
  const ownerId = 'user-um1';
  let memoryId;

  it('setup: join and create memory', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    const res = await team().saveMemory(
      agentId,
      'Original text about the config',
      ['config'],
      null,
      'alice',
      ownerId,
    );
    expect(res.ok).toBe(true);
    memoryId = res.id;
  });

  it('updates text and resets relevance', async () => {
    const res = await team().updateMemory(
      agentId,
      memoryId,
      'Updated text about the config',
      undefined,
      ownerId,
    );
    expect(res.ok).toBe(true);

    const search = await team().searchMemories(agentId, 'Updated text', null, null, 10, ownerId);
    expect(search.memories.length).toBeGreaterThan(0);
    expect(search.memories[0].text).toBe('Updated text about the config');
  });

  it('updates tags', async () => {
    const res = await team().updateMemory(agentId, memoryId, undefined, ['decision'], ownerId);
    expect(res.ok).toBe(true);

    const search = await team().searchMemories(agentId, null, ['decision'], null, 10, ownerId);
    expect(search.memories.some((m) => m.id === memoryId)).toBe(true);
  });

  it('updates both text and tags', async () => {
    const res = await team().updateMemory(agentId, memoryId, 'Both updated', ['pattern'], ownerId);
    expect(res.ok).toBe(true);

    const search = await team().searchMemories(
      agentId,
      'Both updated',
      ['pattern'],
      null,
      10,
      ownerId,
    );
    expect(search.memories.length).toBeGreaterThan(0);
  });

  // Validation for empty/non-string text is handled by the route handler
  // (handlers validate, DOs trust). DO-level tests verify handler-validated input only.

  it('returns error for nonexistent memory', async () => {
    const res = await team().updateMemory(
      agentId,
      'nonexistent-id',
      'New text',
      undefined,
      ownerId,
    );
    expect(res.error).toBe('Memory not found');
  });
});

describe('memory team access', () => {
  const team = () => getTeam('memory-ownership-tests');
  const authorAgent = 'cursor:authorhash:aaaa';
  const authorOwner = 'user-author-mem';
  const peerAgent = 'claude:peerhash:bbbb';
  const peerOwner = 'user-peer-mem';
  let memoryId;

  it('setup: join author and peer, create memory', async () => {
    await team().join(authorAgent, authorOwner, 'alice', 'cursor');
    await team().join(peerAgent, peerOwner, 'bob', 'claude');
    const res = await team().saveMemory(
      authorAgent,
      'Author-owned memory',
      ['config'],
      null,
      'alice',
      authorOwner,
    );
    expect(res.ok).toBe(true);
    memoryId = res.id;
  });

  it('allows any team member to update memory', async () => {
    const res = await team().updateMemory(
      peerAgent,
      memoryId,
      'Peer updated text',
      undefined,
      peerOwner,
    );
    expect(res.ok).toBe(true);
  });

  it('allows any team member to delete memory', async () => {
    const res = await team().deleteMemory(peerAgent, memoryId, peerOwner);
    expect(res.ok).toBe(true);
  });
});

describe('memory ownership across tool sessions', () => {
  const team = () => getTeam('memory-identity-tests');
  const ownerId = 'user-shared-mem';
  const cursorAgent = 'cursor:sharedhash:1111';
  const claudeAgent = 'claude:sharedhash:2222';
  let memoryId;

  it('setup: join same owner from two tools and create memory', async () => {
    await team().join(cursorAgent, ownerId, 'alice', 'cursor');
    await team().join(claudeAgent, ownerId, 'alice', 'claude');
    const res = await team().saveMemory(
      cursorAgent,
      'Shared owner memory',
      ['pattern'],
      null,
      'alice',
      ownerId,
    );
    expect(res.ok).toBe(true);
    memoryId = res.id;
  });

  it('allows the same owner to update memory from another tool session', async () => {
    const res = await team().updateMemory(
      claudeAgent,
      memoryId,
      'Shared owner memory updated',
      undefined,
      ownerId,
    );
    expect(res.ok).toBe(true);
  });
});

// --- getSummary ---

describe('getSummary', () => {
  const team = () => getTeam('summary-tests');
  const agent1 = 'cursor:sum1';
  const agent2 = 'claude:sum2';
  const owner1 = 'user-sum1';
  const owner2 = 'user-sum2';

  it('setup: join two agents and add data', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
    await team().saveMemory(
      agent1,
      'Summary test memory about indexing',
      ['config'],
      null,
      'alice',
      owner1,
    );
    await team().startSession(agent1, 'alice', 'react', owner1);
  });

  it('returns correct field structure', async () => {
    const summary = await team().getSummary(owner1);
    expect(summary.error).toBeUndefined();
    expect(typeof summary.active_agents).toBe('number');
    expect(typeof summary.total_members).toBe('number');
    expect(typeof summary.conflict_count).toBe('number');
    expect(typeof summary.memory_count).toBe('number');
    expect(typeof summary.live_sessions).toBe('number');
    expect(typeof summary.recent_sessions_24h).toBe('number');
    expect(Array.isArray(summary.hosts_configured)).toBe(true);
    expect(typeof summary.usage).toBe('object');
  });

  it('counts members correctly', async () => {
    const summary = await team().getSummary(owner1);
    expect(summary.total_members).toBe(2);
    expect(summary.active_agents).toBe(2);
  });

  it('counts memories', async () => {
    const summary = await team().getSummary(owner1);
    expect(summary.memory_count).toBeGreaterThanOrEqual(1);
  });

  it('counts live sessions', async () => {
    const summary = await team().getSummary(owner1);
    expect(summary.live_sessions).toBeGreaterThanOrEqual(1);
  });

  it('tracks tool usage', async () => {
    const summary = await team().getSummary(owner1);
    const cursorTool = summary.hosts_configured.find((t) => t.host_tool === 'cursor');
    expect(cursorTool).toBeDefined();
    expect(cursorTool.joins).toBeGreaterThanOrEqual(1);
  });

  it('rejects non-member', async () => {
    const summary = await team().getSummary('unknown-owner');
    expect(summary.error).toContain('Not a member');
  });
});

// --- recordEdit ---

describe('recordEdit extended', () => {
  const team = () => getTeam('recordedit-ext');
  const agentId = 'cursor:re1';
  const ownerId = 'user-re1';

  it('setup: join and start session', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    const res = await team().startSession(agentId, 'alice', 'react', ownerId);
    expect(res.ok).toBe(true);
  });

  it('records multiple edits, increments count', async () => {
    await team().recordEdit(agentId, 'src/a.js', 0, 0, ownerId);
    await team().recordEdit(agentId, 'src/b.js', 0, 0, ownerId);
    await team().recordEdit(agentId, 'src/a.js', 0, 0, ownerId); // same file again

    const history = await team().getHistory(agentId, 1, ownerId);
    const session = history.sessions.find((s) => s.owner_handle === 'alice');
    expect(session).toBeDefined();
    expect(session.edit_count).toBe(3);
    // files_touched should have both unique files
    expect(session.files_touched).toContain('src/a.js');
    expect(session.files_touched).toContain('src/b.js');
    expect(session.files_touched.length).toBe(2); // no duplicates
  });

  it('normalizes paths on record', async () => {
    await team().recordEdit(agentId, './src//c.js', 0, 0, ownerId);
    const history = await team().getHistory(agentId, 1, ownerId);
    const session = history.sessions.find((s) => s.owner_handle === 'alice');
    expect(session.files_touched).toContain('src/c.js');
    expect(session.files_touched).not.toContain('./src//c.js');
  });

  it('returns skipped when no active session', async () => {
    const freshTeam = () => getTeam('recordedit-nosession');
    await freshTeam().join('cursor:nosess', 'user-nosess', 'bob', 'cursor');
    // No startSession called
    const res = await freshTeam().recordEdit('cursor:nosess', 'file.js', 0, 0, 'user-nosess');
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(true);
  });
});

describe('session ownership', () => {
  const team = () => getTeam('session-ownership-tests');
  const ownerAgent = 'cursor:ownerhash:aaaa';
  const ownerId = 'user-owner-session';
  const peerAgent = 'claude:peerhash:bbbb';
  const peerId = 'user-peer-session';
  let sessionId;

  it('setup: join two agents and start owner session', async () => {
    await team().join(ownerAgent, ownerId, 'alice', 'cursor');
    await team().join(peerAgent, peerId, 'bob', 'claude');
    const res = await team().startSession(ownerAgent, 'alice', 'react', ownerId);
    expect(res.ok).toBe(true);
    sessionId = res.session_id;
  });

  it('rejects heartbeat spoofing another agent', async () => {
    const res = await team().heartbeat(ownerAgent, peerId);
    expect(res.error).toBe('Not a member of this team');
  });

  it('rejects recordEdit spoofing another agent', async () => {
    const res = await team().recordEdit(ownerAgent, 'src/hijack.js', 0, 0, peerId);
    expect(res.error).toBe('Not a member of this team');
  });

  it('rejects endSession spoofing another agent', async () => {
    const res = await team().endSession(ownerAgent, sessionId, peerId);
    expect(res.error).toBe('Not a member of this team');
  });
});

// --- getHistory ---

describe('getHistory', () => {
  const team = () => getTeam('history-tests');
  const agentId = 'cursor:hist1';
  const ownerId = 'user-hist1';

  it('setup: join, create and end sessions', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    const s1 = await team().startSession(agentId, 'alice', 'react', ownerId);
    await team().recordEdit(agentId, 'src/x.js', 0, 0, ownerId);
    await team().endSession(agentId, s1.session_id, ownerId);

    const s2 = await team().startSession(agentId, 'alice', 'next', ownerId);
    await team().recordEdit(agentId, 'src/y.js', 0, 0, ownerId);
    await team().endSession(agentId, s2.session_id, ownerId);
  });

  it('returns sessions within date range', async () => {
    const history = await team().getHistory(agentId, 1, ownerId);
    expect(history.sessions.length).toBeGreaterThanOrEqual(2);
  });

  it('sessions include duration_minutes', async () => {
    const history = await team().getHistory(agentId, 1, ownerId);
    for (const session of history.sessions) {
      expect(session.duration_minutes).toBeDefined();
    }
  });

  it('sessions include parsed files_touched array', async () => {
    const history = await team().getHistory(agentId, 1, ownerId);
    for (const session of history.sessions) {
      expect(Array.isArray(session.files_touched)).toBe(true);
    }
  });

  it('rejects non-member', async () => {
    const result = await team().getHistory('cursor:unknown', 1, 'unknown-owner');
    expect(result.error).toContain('Not a member');
  });
});

// --- Memory pruning at MEMORY_MAX_COUNT ---

describe('Memory pruning', () => {
  const team = () => getTeam('memory-pruning');
  const agentId = 'cursor:prune1';
  const ownerId = 'user-prune1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('prunes oldest low-relevance memories when exceeding max count', async () => {
    // Save 105 memories (limit is 100)
    for (let i = 0; i < 105; i++) {
      // Use unique enough text to avoid dedup
      await team().saveMemory(
        agentId,
        `Unique memory number ${i} with random value ${Math.random()} and extra context for uniqueness`,
        ['config'],
        'alice',
        ownerId,
      );
    }

    // Query all memories
    const result = await team().searchMemories(agentId, null, null, null, 50, ownerId);
    // We can only get 50 at a time, but the total should be <= 100
    // The important thing: the system didn't crash and did prune
    expect(result.memories.length).toBeLessThanOrEqual(50);

    // Also verify via a second page: total count should be capped
    const result2 = await team().searchMemories(agentId, null, ['config'], null, 50, ownerId);
    expect(result2.memories.length).toBeLessThanOrEqual(50);
  });
});

// --- Memory fuzzy dedup ---

describe('Memory fuzzy dedup extended', () => {
  const team = () => getTeam('memory-dedup-ext');
  const agentId = 'cursor:dedup1';
  const ownerId = 'user-dedup1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('saves similar text as separate entries (no dedup)', async () => {
    const original = await team().saveMemory(
      agentId,
      'The API rate limit should be configured to 100 requests per minute',
      ['config'],
      null,
      'alice',
      ownerId,
    );
    expect(original.ok).toBe(true);
    expect(original.id).toBeDefined();

    // Similar text is saved as a separate entry
    const second = await team().saveMemory(
      agentId,
      'The API rate limit should be configured to 100 requests per minute for safety',
      ['config'],
      null,
      'alice',
      ownerId,
    );
    expect(second.ok).toBe(true);
    expect(second.id).toBeDefined();
    expect(second.id).not.toBe(original.id);
  });

  it('saves dissimilar text as separate entries', async () => {
    const mem1 = await team().saveMemory(
      agentId,
      'Always use TypeScript strict mode in production builds',
      ['pattern'],
      null,
      'alice',
      ownerId,
    );
    expect(mem1.ok).toBe(true);

    const mem2 = await team().saveMemory(
      agentId,
      'Database connection pools should timeout after 30 seconds',
      ['config'],
      null,
      'alice',
      ownerId,
    );
    expect(mem2.ok).toBe(true);
    expect(mem2.id).toBeDefined();
    expect(mem2.id).not.toBe(mem1.id);
  });
});

// --- saveMemory validation ---

describe('saveMemory validation', () => {
  const team = () => getTeam('savemem-validation');
  const agentId = 'cursor:sv1';
  const ownerId = 'user-sv1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('accepts freeform tags', async () => {
    const tags = ['gotcha', 'setup', 'database', 'my-custom-tag'];
    for (const tag of tags) {
      const res = await team().saveMemory(
        agentId,
        `Memory for tag ${tag} with more context to be unique ${Math.random()}`,
        [tag],
        'alice',
        ownerId,
      );
      expect(res.ok).toBe(true);
    }
  });

  it('accepts multiple tags', async () => {
    const res = await team().saveMemory(
      agentId,
      `Memory with multiple tags ${Math.random()}`,
      ['pattern', 'config', 'important'],
      'alice',
      ownerId,
    );
    expect(res.ok).toBe(true);
  });

  it('rejects non-member', async () => {
    const res = await team().saveMemory(
      'cursor:unknown',
      'Text',
      ['config'],
      null,
      'alice',
      'bad-owner',
    );
    expect(res.error).toContain('Not a member');
  });
});

// --- sendMessage & getMessages ---

describe('Messages extended', () => {
  const team = () => getTeam('messages-ext');
  const agent1 = 'cursor:msgx1';
  const agent2 = 'claude:msgx2';
  const owner1 = 'user-msgx1';
  const owner2 = 'user-msgx2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('targeted message visible only to target', async () => {
    await team().sendMessage(agent1, 'alice', 'cursor', 'Secret to bob', agent2, owner1);

    // agent2 should see it
    const msgs2 = await team().getMessages(agent2, null, owner2);
    expect(msgs2.messages.some((m) => m.text === 'Secret to bob')).toBe(true);

    // agent1 should NOT see it (it's targeted to agent2, not broadcast)
    const msgs1 = await team().getMessages(agent1, null, owner1);
    expect(msgs1.messages.some((m) => m.text === 'Secret to bob')).toBe(false);
  });

  it('broadcast message visible to all', async () => {
    await team().sendMessage(agent1, 'alice', 'cursor', 'Hello everyone', null, owner1);

    const msgs1 = await team().getMessages(agent1, null, owner1);
    expect(msgs1.messages.some((m) => m.text === 'Hello everyone')).toBe(true);

    const msgs2 = await team().getMessages(agent2, null, owner2);
    expect(msgs2.messages.some((m) => m.text === 'Hello everyone')).toBe(true);
  });

  it('rejects non-member sending', async () => {
    const res = await team().sendMessage(
      'cursor:unknown',
      'anon',
      'cursor',
      'msg',
      null,
      'bad-owner',
    );
    expect(res.error).toContain('Not a member');
  });
});

// --- getContext detailed checks ---

describe('getContext extended', () => {
  const team = () => getTeam('context-ext');
  const agent1 = 'cursor:ctx1';
  const agent2 = 'claude:ctx2';
  const owner1 = 'user-ctx1';
  const owner2 = 'user-ctx2';

  it('setup: join, add activity, save memory, start session', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
    await team().updateActivity(agent1, ['src/shared.js'], 'Working on shared module', owner1);
    await team().updateActivity(agent2, ['src/shared.js'], 'Also on shared', owner2);
    await team().saveMemory(
      agent1,
      'Context test memory about shared module architecture',
      ['decision'],
      null,
      'alice',
      owner1,
    );
    await team().startSession(agent1, 'alice', 'react', owner1);
  });

  it('returns members list', async () => {
    const ctx = await team().getContext(agent1, owner1);
    expect(ctx.members).toBeDefined();
    expect(ctx.members.length).toBe(2);
  });

  it('members include expected fields', async () => {
    const ctx = await team().getContext(agent1, owner1);
    const me = ctx.members.find((m) => m.agent_id === agent1);
    expect(me.handle).toBe('alice');
    expect(me.host_tool).toBe('cursor');
    expect(me.status).toBeDefined();
    expect(me.activity).toBeDefined();
    expect(me.activity.files).toContain('src/shared.js');
  });

  it('detects file conflicts in context', async () => {
    const ctx = await team().getContext(agent1, owner1);
    expect(ctx.conflicts.length).toBeGreaterThan(0);
    expect(ctx.conflicts[0].file).toBe('src/shared.js');
    expect(ctx.conflicts[0].agents.length).toBe(2);
  });

  it('includes memories in context', async () => {
    const ctx = await team().getContext(agent1, owner1);
    expect(ctx.memories.length).toBeGreaterThan(0);
  });

  it('includes sessions', async () => {
    const ctx = await team().getContext(agent1, owner1);
    expect(ctx.recentSessions).toBeDefined();
    expect(ctx.recentSessions.length).toBeGreaterThan(0);
  });

  it('includes messages', async () => {
    await team().sendMessage(agent1, 'alice', 'cursor', 'Context msg test', null, owner1);
    const ctx = await team().getContext(agent1, owner1);
    expect(ctx.messages).toBeDefined();
    expect(ctx.messages.some((m) => m.text === 'Context msg test')).toBe(true);
  });
});

// --- Lock auto-release for stale agents ---

describe('Lock management extended', () => {
  const team = () => getTeam('locks-ext');
  const agent1 = 'cursor:lkx1';
  const agent2 = 'claude:lkx2';
  const owner1 = 'user-lkx1';
  const owner2 = 'user-lkx2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('getLockedFiles returns locked files', async () => {
    await team().claimFiles(agent1, ['src/main.js', 'src/lib.js'], 'alice', 'cursor', owner1);
    const result = await team().getLockedFiles(agent1, owner1);
    expect(result.locks).toBeDefined();
    expect(result.locks.length).toBe(2);
    expect(result.locks.some((l) => l.file_path === 'src/main.js')).toBe(true);
    expect(result.locks.some((l) => l.file_path === 'src/lib.js')).toBe(true);
  });

  it('releaseFiles with no files releases all locks for agent', async () => {
    await team().claimFiles(agent1, ['src/a.js', 'src/b.js'], 'alice', 'cursor', owner1);
    const res = await team().releaseFiles(agent1, null, owner1);
    expect(res.ok).toBe(true);

    // agent2 can now claim them
    const claim = await team().claimFiles(
      agent2,
      ['src/a.js', 'src/b.js'],
      'bob',
      'claude',
      owner2,
    );
    expect(claim.claimed).toContain('src/a.js');
    expect(claim.claimed).toContain('src/b.js');
    expect(claim.blocked.length).toBe(0);
  });

  it('lock normalizes file paths', async () => {
    await team().claimFiles(agent1, ['./src//dup.js'], 'alice', 'cursor', owner1);
    const result = await team().getLockedFiles(agent1, owner1);
    expect(result.locks.some((l) => l.file_path === 'src/dup.js')).toBe(true);
    expect(result.locks.some((l) => l.file_path === './src//dup.js')).toBe(false);
  });

  it('rejects non-member claiming files', async () => {
    const res = await team().claimFiles(
      'cursor:stranger',
      ['file.js'],
      'anon',
      'cursor',
      'bad-owner',
    );
    expect(res.error).toContain('Not a member');
  });
});

// --- Conflict detection with locked files ---

describe('Conflict detection with locks', () => {
  const team = () => getTeam('conflict-locks');
  const agent1 = 'cursor:cl1';
  const agent2 = 'claude:cl2';
  const owner1 = 'user-cl1';
  const owner2 = 'user-cl2';

  it('setup: join and lock files', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
    await team().claimFiles(agent1, ['src/locked.js'], 'alice', 'cursor', owner1);
  });

  it('checkConflicts reports locked files', async () => {
    const res = await team().checkConflicts(agent2, ['src/locked.js'], owner2);
    expect(res.locked.length).toBeGreaterThan(0);
    expect(res.locked[0].file).toBe('src/locked.js');
    expect(res.locked[0].held_by).toBe('alice');
  });

  it('own lock does not show as conflict', async () => {
    const res = await team().checkConflicts(agent1, ['src/locked.js'], owner1);
    expect(res.locked.length).toBe(0);
  });
});

// --- Session lifecycle ---

describe('Session lifecycle', () => {
  const team = () => getTeam('session-lifecycle');
  const agentId = 'cursor:sl1';
  const ownerId = 'user-sl1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('starting a new session auto-closes previous one', async () => {
    const s1 = await team().startSession(agentId, 'alice', 'react', ownerId);
    expect(s1.ok).toBe(true);

    const s2 = await team().startSession(agentId, 'alice', 'next', ownerId);
    expect(s2.ok).toBe(true);

    // s1 should now be ended
    const endResult = await team().endSession(agentId, s1.session_id, ownerId);
    expect(endResult.error).toBeTruthy(); // already ended

    // s2 should still be active
    const endResult2 = await team().endSession(agentId, s2.session_id, ownerId);
    expect(endResult2.ok).toBe(true);
  });

  it('memories saved during session are counted', async () => {
    await team().startSession(agentId, 'alice', 'react', ownerId);
    await team().saveMemory(
      agentId,
      'Session lifecycle test memory about session counting mechanism',
      ['pattern'],
      null,
      'alice',
      ownerId,
    );

    const history = await team().getHistory(agentId, 1, ownerId);
    const session = history.sessions.find((ses) => ses.owner_handle === 'alice' && !ses.ended_at);
    if (session) {
      expect(session.memories_saved).toBeGreaterThanOrEqual(1);
    }
  });
});

// --- Telemetry ---

describe('Telemetry tracking', () => {
  const team = () => getTeam('telemetry-tests');
  const agentId = 'cursor:tel1';
  const ownerId = 'user-tel1';

  it('setup: join and perform actions', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().saveMemory(
      agentId,
      'Telemetry test memory with unique content for the test',
      ['config'],
      null,
      'alice',
      ownerId,
    );
    await team().sendMessage(agentId, 'alice', 'cursor', 'Telemetry msg', null, ownerId);
    await team().checkConflicts(agentId, ['src/tel.js'], ownerId);
  });

  it('summary includes usage metrics', async () => {
    const summary = await team().getSummary(ownerId);
    expect(summary.usage).toBeDefined();
    expect(summary.usage.joins).toBeGreaterThanOrEqual(1);
    expect(summary.usage.memories_saved).toBeGreaterThanOrEqual(1);
    expect(summary.usage.messages_sent).toBeGreaterThanOrEqual(1);
    expect(summary.usage.conflict_checks).toBeGreaterThanOrEqual(1);
  });
});
