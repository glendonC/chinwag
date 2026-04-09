import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id = 'test-team') {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// --- Cleanup: data consistency across cleanup cycles ---
// Tests that cleanup preserves referential integrity -- activities, locks,
// memories, and sessions for active members are never orphaned or corrupted.

describe('Cleanup — data consistency across multiple cycles', () => {
  const team = () => getTeam('cleanup-consistency');
  const agent1 = 'cursor:cc1';
  const agent2 = 'claude:cc2';
  const owner1 = 'user-cc1';
  const owner2 = 'user-cc2';

  it('setup: join agents with full state', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');

    // Agent 1: full state
    await team().updateActivity(agent1, ['src/a.js', 'src/b.js'], 'Editing', owner1);
    await team().claimFiles(agent1, ['src/a.js'], 'alice', 'cursor', owner1);
    await team().saveMemory(
      agent1,
      'Important decision about architecture',
      ['arch'],
      null,
      'alice',
      owner1,
    );
    await team().startSession(agent1, 'alice', 'react', owner1);
    await team().recordEdit(agent1, 'src/a.js', 0, 0, owner1);
    await team().sendMessage(agent1, 'alice', 'cursor', 'Working on feature X', null, owner1);

    // Agent 2: partial state
    await team().updateActivity(agent2, ['src/c.js'], 'Reading', owner2);
    await team().saveMemory(agent2, 'Bob contribution to memory', ['config'], null, 'bob', owner2);
  });

  it('all data survives repeated cleanup triggers', async () => {
    // Trigger cleanup multiple times via getContext
    for (let i = 0; i < 5; i++) {
      await team().heartbeat(agent1, owner1);
      await team().heartbeat(agent2, owner2);

      const ctx = await team().getContext(agent1, owner1);

      // Members present
      expect(ctx.members.length).toBe(2);

      // Agent 1's data intact
      const me = ctx.members.find((m) => m.agent_id === agent1);
      expect(me).toBeDefined();
      expect(me.activity.files).toContain('src/a.js');

      // Locks intact
      expect(ctx.locks.length).toBeGreaterThanOrEqual(1);
      expect(ctx.locks.some((l) => l.file_path === 'src/a.js')).toBe(true);

      // Memories intact
      expect(ctx.memories.length).toBeGreaterThanOrEqual(2);

      // Sessions intact
      expect(ctx.recentSessions.length).toBeGreaterThanOrEqual(1);

      // Messages intact (within 1-hour window)
      expect(ctx.messages.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// --- Cleanup: leave during active session closes session ---

describe('Cleanup — leave closes active session', () => {
  const team = () => getTeam('cleanup-leave-session');
  const agent1 = 'cursor:cls1';
  const agent2 = 'claude:cls2';
  const owner1 = 'user-cls1';
  const owner2 = 'user-cls2';

  it('setup: join, start session, leave', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');

    const session = await team().startSession(agent1, 'alice', 'react', owner1);
    expect(session.ok).toBe(true);

    await team().recordEdit(agent1, 'src/leaving.js', 0, 0, owner1);

    // Leave
    const leaveRes = await team().leave(agent1, owner1);
    expect(leaveRes.ok).toBe(true);
  });

  it('after leaving, agent cannot end their session', async () => {
    // Agent is gone, so endSession should fail (can't resolve identity)
    const res = await team().endSession(agent1, 'nonexistent-session-id', owner1);
    expect(res.error).toBeTruthy();
  });

  it('remaining agent can still operate normally', async () => {
    const ctx = await team().getContext(agent2, owner2);
    expect(ctx.members.length).toBe(1);
    expect(ctx.members[0].agent_id).toBe(agent2);

    // Bob can still do everything
    const mem = await team().saveMemory(
      agent2,
      'Alice left, noting for record',
      ['notes'],
      null,
      'bob',
      owner2,
    );
    expect(mem.ok).toBe(true);
  });
});

// --- Cleanup: getSummary triggers cleanup ---

describe('Cleanup — getSummary triggers cleanup', () => {
  const team = () => getTeam('cleanup-summary-trigger');
  const agentId = 'cursor:cst1';
  const ownerId = 'user-cst1';

  it('setup: join and add state', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().startSession(agentId, 'alice', 'react', ownerId);
    await team().saveMemory(agentId, 'Summary test memory', ['test'], null, 'alice', ownerId);
  });

  it('getSummary returns valid summary and does not corrupt state', async () => {
    const summary = await team().getSummary(ownerId);
    expect(summary.error).toBeUndefined();
    expect(summary.total_members).toBeGreaterThanOrEqual(1);

    // Verify state is still intact after summary-triggered cleanup
    const ctx = await team().getContext(agentId, ownerId);
    expect(ctx.members.length).toBe(1);
    expect(ctx.memories.length).toBeGreaterThanOrEqual(1);
    expect(ctx.recentSessions.length).toBeGreaterThanOrEqual(1);
  });

  it('getSummary rejects non-member', async () => {
    const res = await team().getSummary('nonexistent-owner');
    expect(res.error).toBeTruthy();
    expect(res.error).toContain('Not a member');
  });
});

// --- Cleanup: multiple leave+rejoin cycles ---

describe('Cleanup — leave and rejoin cycle', () => {
  const team = () => getTeam('cleanup-rejoin-cycle');
  const agentId = 'cursor:crc1';
  const ownerId = 'user-crc1';
  const observerAgent = 'claude:crc2';
  const observerOwner = 'user-crc2';

  it('setup: observer joins to keep team alive', async () => {
    await team().join(observerAgent, observerOwner, 'observer', 'claude');
  });

  it('agent can leave and rejoin cleanly multiple times', async () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      // Join
      const joinRes = await team().join(agentId, ownerId, 'alice', 'cursor');
      expect(joinRes.ok).toBe(true);

      // Do some work
      await team().updateActivity(agentId, [`src/cycle${cycle}.js`], `Cycle ${cycle}`, ownerId);
      await team().claimFiles(agentId, [`src/cycle${cycle}.js`], 'alice', 'cursor', ownerId);

      // Verify state
      const ctx = await team().getContext(agentId, ownerId);
      const me = ctx.members.find((m) => m.agent_id === agentId);
      expect(me).toBeDefined();

      // Leave
      const leaveRes = await team().leave(agentId, ownerId);
      expect(leaveRes.ok).toBe(true);

      // Verify clean removal
      const hb = await team().heartbeat(agentId);
      expect(hb.error).toBeTruthy();

      // Verify lock is released
      const claim = await team().claimFiles(
        observerAgent,
        [`src/cycle${cycle}.js`],
        'observer',
        'claude',
        observerOwner,
      );
      expect(claim.claimed).toContain(`src/cycle${cycle}.js`);
      // Release observer's lock for next cycle
      await team().releaseFiles(observerAgent, [`src/cycle${cycle}.js`], observerOwner);
    }
  });
});

// --- Cleanup: memory persists across member lifecycle ---

describe('Cleanup — memories persist after author leaves', () => {
  const team = () => getTeam('cleanup-memory-persist');
  const author = 'cursor:cmp1';
  const authorOwner = 'user-cmp1';
  const reader = 'claude:cmp2';
  const readerOwner = 'user-cmp2';

  it('author creates memory then leaves', async () => {
    await team().join(author, authorOwner, 'alice', 'cursor');
    await team().join(reader, readerOwner, 'bob', 'claude');

    const save = await team().saveMemory(
      author,
      'Important architecture decision: use event sourcing',
      ['architecture', 'decision'],
      null,
      'alice',
      authorOwner,
    );
    expect(save.ok).toBe(true);

    // Author leaves
    await team().leave(author, authorOwner);
  });

  it('memories survive author departure and are searchable', async () => {
    const search = await team().searchMemories(
      reader,
      'event sourcing',
      null,
      null,
      10,
      readerOwner,
    );
    expect(search.memories.length).toBe(1);
    expect(search.memories[0].text).toContain('event sourcing');
    expect(search.memories[0].handle).toBe('alice');
  });

  it('remaining member can update departed author memory', async () => {
    const search = await team().searchMemories(
      reader,
      'event sourcing',
      null,
      null,
      1,
      readerOwner,
    );
    const memId = search.memories[0].id;

    const update = await team().updateMemory(
      reader,
      memId,
      'Updated: use event sourcing with CQRS pattern',
      ['architecture', 'decision', 'cqrs'],
      readerOwner,
    );
    expect(update.ok).toBe(true);
  });

  it('remaining member can delete departed author memory', async () => {
    const search = await team().searchMemories(reader, 'CQRS', null, null, 1, readerOwner);
    const memId = search.memories[0].id;

    const del = await team().deleteMemory(reader, memId, readerOwner);
    expect(del.ok).toBe(true);

    // Verify deletion
    const searchAfter = await team().searchMemories(reader, 'CQRS', null, null, 10, readerOwner);
    expect(searchAfter.memories.length).toBe(0);
  });
});

// --- Cleanup: session history survives cleanup ---

describe('Cleanup — session history integrity', () => {
  const team = () => getTeam('cleanup-session-history');
  const agentId = 'cursor:csh1';
  const ownerId = 'user-csh1';

  it('setup: create multiple completed sessions', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');

    for (let i = 0; i < 3; i++) {
      const s = await team().startSession(agentId, 'alice', `framework-${i}`, ownerId);
      await team().recordEdit(agentId, `src/file-${i}.js`, 0, 0, ownerId);
      await team().endSession(agentId, s.session_id, ownerId);
    }
  });

  it('completed sessions survive cleanup triggers', async () => {
    // Trigger cleanup multiple times
    for (let i = 0; i < 3; i++) {
      await team().getContext(agentId, ownerId);
    }

    const history = await team().getHistory(agentId, 7, ownerId);
    expect(history.sessions.length).toBe(3);

    // Verify each session has correct data
    for (let i = 0; i < 3; i++) {
      const session = history.sessions.find((s) => s.framework === `framework-${i}`);
      expect(session).toBeDefined();
      expect(session.edit_count).toBe(1);
      expect(session.files_touched).toContain(`src/file-${i}.js`);
      expect(session.ended_at).toBeDefined();
    }
  });
});

// --- Cleanup: enrichModel for active session ---

describe('Cleanup — enrichModel and session model tracking', () => {
  const team = () => getTeam('cleanup-enrich-model');
  const agentId = 'cursor:cem1';
  const ownerId = 'user-cem1';

  it('setup: join and start session', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().startSession(agentId, 'alice', 'react', ownerId);
  });

  it('enrichModel sets model on session and member', async () => {
    const res = await team().enrichModel(agentId, 'claude-3-5-sonnet', ownerId);
    expect(res.ok).toBe(true);

    const ctx = await team().getContext(agentId, ownerId);
    const session = ctx.recentSessions.find((s) => !s.ended_at);
    expect(session).toBeDefined();
    expect(session.agent_model).toBe('claude-3-5-sonnet');
  });

  it('enrichModel does not overwrite existing model', async () => {
    // Try to overwrite with a different model
    const res = await team().enrichModel(agentId, 'gpt-4', ownerId);
    expect(res.ok).toBe(true);

    // Model should still be the first one (WHERE agent_model IS NULL prevents overwrite)
    const ctx = await team().getContext(agentId, ownerId);
    const session = ctx.recentSessions.find((s) => !s.ended_at);
    expect(session.agent_model).toBe('claude-3-5-sonnet');
  });
});
