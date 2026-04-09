import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id = 'test-team') {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// --- Stale member eviction ---
// The cleanup logic runs in #maybeCleanup(), triggered from getContext/getSummary.
// It evicts members whose last_heartbeat is older than HEARTBEAT_STALE_WINDOW_S (300s)
// and who do NOT have an active WebSocket connection.
// Since we cannot directly manipulate timestamps in SQLite from the test harness,
// we test the behavior that IS observable: recently active members are NOT evicted,
// and the cleanup does not crash or corrupt state.

describe('Cleanup — active members preserved', () => {
  const team = () => getTeam('cleanup-active-tests');
  const agent1 = 'cursor:cleanup-a1';
  const agent2 = 'claude:cleanup-a2';
  const owner1 = 'user-cleanup-a1';
  const owner2 = 'user-cleanup-a2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('recently active members are visible in context', async () => {
    // Both agents just joined, so their heartbeats are fresh
    const ctx = await team().getContext(agent1, owner1);
    expect(ctx.members.length).toBe(2);
    expect(ctx.members.some((m) => m.agent_id === agent1)).toBe(true);
    expect(ctx.members.some((m) => m.agent_id === agent2)).toBe(true);
  });

  it('heartbeat keeps agent active', async () => {
    await team().heartbeat(agent1, owner1);
    const ctx = await team().getContext(agent1, owner1);
    const me = ctx.members.find((m) => m.agent_id === agent1);
    expect(me).toBeDefined();
    expect(me.status).toBe('active');
  });

  it('multiple getContext calls do not erroneously evict active members', async () => {
    // Call getContext multiple times — cleanup should not evict fresh members
    for (let i = 0; i < 5; i++) {
      const ctx = await team().getContext(agent1, owner1);
      expect(ctx.members.length).toBe(2);
    }
  });
});

// --- Cleanup does not remove data for active members ---

describe('Cleanup — data integrity', () => {
  const team = () => getTeam('cleanup-data-tests');
  const agentId = 'cursor:cleanup-d1';
  const ownerId = 'user-cleanup-d1';

  it('setup: join, add data', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().updateActivity(agentId, ['src/keep.js'], 'Active work', ownerId);
    await team().saveMemory(
      agentId,
      'Cleanup data test memory',
      ['config'],
      null,
      'alice',
      ownerId,
    );
    await team().startSession(agentId, 'alice', 'react', ownerId);
    await team().claimFiles(agentId, ['src/locked.js'], 'alice', 'cursor', ownerId);
  });

  it('all data survives cleanup for active member', async () => {
    // Trigger cleanup via getContext
    const ctx = await team().getContext(agentId, ownerId);

    // Member still present
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me).toBeDefined();

    // Activity preserved
    expect(me.activity.files).toContain('src/keep.js');

    // Memory preserved
    expect(ctx.memories.length).toBeGreaterThan(0);

    // Session preserved
    expect(ctx.recentSessions.length).toBeGreaterThan(0);

    // Lock preserved
    expect(ctx.locks.length).toBeGreaterThan(0);
    expect(ctx.locks[0].file_path).toBe('src/locked.js');
  });
});

// --- Session pruning ---
// Sessions older than SESSION_RETENTION_DAYS (30) are pruned.
// Since we can't backdate sessions in the test harness, we test that
// recently created sessions are NOT pruned.

describe('Cleanup — recent sessions preserved', () => {
  const team = () => getTeam('cleanup-session-tests');
  const agentId = 'cursor:cleanup-s1';
  const ownerId = 'user-cleanup-s1';

  it('setup: join and create sessions', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');

    const s1 = await team().startSession(agentId, 'alice', 'react', ownerId);
    await team().recordEdit(agentId, 'src/a.js', 0, 0, ownerId);
    await team().endSession(agentId, s1.session_id, ownerId);

    const s2 = await team().startSession(agentId, 'alice', 'next', ownerId);
    await team().recordEdit(agentId, 'src/b.js', 0, 0, ownerId);
    await team().endSession(agentId, s2.session_id, ownerId);
  });

  it('recent sessions survive cleanup', async () => {
    // Trigger cleanup via getContext
    await team().getContext(agentId, ownerId);

    const history = await team().getHistory(agentId, 7, ownerId);
    expect(history.sessions.length).toBeGreaterThanOrEqual(2);
  });
});

// --- Cleanup throttling ---
// Cleanup runs at most once per CLEANUP_INTERVAL_MS (60s).
// Calling getContext rapidly should not degrade performance.

describe('Cleanup throttling', () => {
  const team = () => getTeam('cleanup-throttle-tests');
  const agentId = 'cursor:cleanup-t1';
  const ownerId = 'user-cleanup-t1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().updateActivity(agentId, ['src/throttle.js'], 'Testing throttle', ownerId);
  });

  it('multiple rapid getContext calls succeed (cleanup throttled)', async () => {
    // Call getContext 10 times rapidly — cleanup should not run more than once
    const results = [];
    for (let i = 0; i < 10; i++) {
      const ctx = await team().getContext(agentId, ownerId);
      results.push(ctx);
    }

    // All calls should succeed
    expect(results.every((r) => !r.error)).toBe(true);
    // All calls should return the same member
    expect(results.every((r) => r.members.some((m) => m.agent_id === agentId))).toBe(true);
  });

  it('getSummary also triggers cleanup without error', async () => {
    const summary = await team().getSummary(ownerId);
    expect(summary.error).toBeUndefined();
    expect(summary.total_members).toBeGreaterThanOrEqual(1);
  });
});

// --- Leave triggers cleanup of associated data ---

describe('Leave cleans up member data', () => {
  const team = () => getTeam('cleanup-leave-tests');
  const agentId = 'cursor:cleanup-l1';
  const ownerId = 'user-cleanup-l1';
  const otherAgent = 'claude:cleanup-l2';
  const otherOwner = 'user-cleanup-l2';

  it('setup: join, add data, then leave', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().join(otherAgent, otherOwner, 'bob', 'claude');
    await team().updateActivity(agentId, ['src/gone.js'], 'Will leave', ownerId);
    await team().claimFiles(agentId, ['src/gone.js'], 'alice', 'cursor', ownerId);

    const leaveRes = await team().leave(agentId, ownerId);
    expect(leaveRes.ok).toBe(true);
  });

  it('left member is no longer in context', async () => {
    const ctx = await team().getContext(otherAgent, otherOwner);
    expect(ctx.members.some((m) => m.agent_id === agentId)).toBe(false);
  });

  it('locks released by left member are claimable', async () => {
    const claim = await team().claimFiles(otherAgent, ['src/gone.js'], 'bob', 'claude', otherOwner);
    expect(claim.claimed).toContain('src/gone.js');
    expect(claim.blocked).toHaveLength(0);
  });
});

// --- Stale lock cleanup ---
// Locks from stale agents (no heartbeat, no WS) are cleaned up.
// We can test that active members' locks are NOT cleaned up.

describe('Stale lock cleanup — active locks preserved', () => {
  const team = () => getTeam('cleanup-stalelock-tests');
  const agent1 = 'cursor:slk1';
  const agent2 = 'claude:slk2';
  const owner1 = 'user-slk1';
  const owner2 = 'user-slk2';

  it('setup: join two agents and claim locks', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
    await team().claimFiles(agent1, ['src/alice-lock.js'], 'alice', 'cursor', owner1);
    await team().claimFiles(agent2, ['src/bob-lock.js'], 'bob', 'claude', owner2);
  });

  it('active agents locks are preserved after cleanup', async () => {
    // Heartbeat both agents to keep them active
    await team().heartbeat(agent1, owner1);
    await team().heartbeat(agent2, owner2);

    // Trigger cleanup via getContext
    await team().getContext(agent1, owner1);

    const locks = await team().getLockedFiles(agent1, owner1);
    expect(locks.locks.some((l) => l.file_path === 'src/alice-lock.js')).toBe(true);
    expect(locks.locks.some((l) => l.file_path === 'src/bob-lock.js')).toBe(true);
  });
});

// --- Orphaned session auto-close ---
// When a member goes stale, their open sessions are auto-closed.
// We test that active members' sessions are NOT auto-closed.

describe('Orphaned session auto-close — active sessions preserved', () => {
  const team = () => getTeam('cleanup-orphan-tests');
  const agentId = 'cursor:orphan1';
  const ownerId = 'user-orphan1';

  it('setup: join and start session', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    const res = await team().startSession(agentId, 'alice', 'react', ownerId);
    expect(res.ok).toBe(true);
  });

  it('active session remains open after cleanup', async () => {
    // Keep the agent active
    await team().heartbeat(agentId, ownerId);

    // Trigger cleanup
    await team().getContext(agentId, ownerId);

    const history = await team().getHistory(agentId, 1, ownerId);
    const activeSession = history.sessions.find((s) => !s.ended_at);
    expect(activeSession).toBeDefined();
    expect(activeSession.owner_handle).toBe('alice');
  });
});
