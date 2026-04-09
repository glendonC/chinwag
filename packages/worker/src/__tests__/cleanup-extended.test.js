import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id = 'test-team') {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// --- Leave cleans up activities and locks ---

describe('Leave cleanup — activities and locks removed', () => {
  const team = () => getTeam('cleanup-ext-leave');
  const agentId = 'cursor:cxl1';
  const ownerId = 'user-cxl1';
  const observer = 'claude:cxl2';
  const observerOwner = 'user-cxl2';

  it('setup: join, create activity, claim files', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().join(observer, observerOwner, 'bob', 'claude');

    const activity = await team().updateActivity(
      agentId,
      ['src/cleanup-a.js', 'src/cleanup-b.js'],
      'Working on cleanup files',
      ownerId,
    );
    expect(activity).toEqual({ ok: true });

    const claim = await team().claimFiles(
      agentId,
      ['src/cleanup-a.js', 'src/cleanup-b.js'],
      'alice',
      'cursor',
      ownerId,
    );
    expect(claim.claimed).toHaveLength(2);
  });

  it('after leave, activities and locks are cleaned up', async () => {
    const leaveRes = await team().leave(agentId, ownerId);
    expect(leaveRes.ok).toBe(true);

    // Observer should see no trace of the left agent
    const ctx = await team().getContext(observer, observerOwner);

    // Agent should not be in members list
    expect(ctx.members.some((m) => m.agent_id === agentId)).toBe(false);

    // Locks should be released — observer can claim them
    const claim = await team().claimFiles(
      observer,
      ['src/cleanup-a.js', 'src/cleanup-b.js'],
      'bob',
      'claude',
      observerOwner,
    );
    expect(claim.claimed).toHaveLength(2);
    expect(claim.blocked).toHaveLength(0);
  });
});

// --- getContext triggers cleanup without crash ---

describe('getContext triggers cleanup safely', () => {
  const team = () => getTeam('cleanup-ext-context');
  const agentId = 'cursor:cxc1';
  const ownerId = 'user-cxc1';

  it('setup: join and add data', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().updateActivity(agentId, ['src/safe.js'], 'Safe activity', ownerId);
    await team().saveMemory(agentId, 'Context cleanup test', ['test'], null, 'alice', ownerId);
    await team().startSession(agentId, 'alice', 'react', ownerId);
  });

  it('getContext does not crash and returns valid data', async () => {
    const ctx = await team().getContext(agentId, ownerId);
    expect(ctx.error).toBeUndefined();
    expect(ctx.members).toBeDefined();
    expect(ctx.members.length).toBeGreaterThanOrEqual(1);
    expect(ctx.memories).toBeDefined();
    expect(ctx.recentSessions).toBeDefined();
    expect(ctx.locks).toBeDefined();
    expect(ctx.conflicts).toBeDefined();
  });

  it('repeated getContext calls are stable', async () => {
    const ctx1 = await team().getContext(agentId, ownerId);
    const ctx2 = await team().getContext(agentId, ownerId);
    const ctx3 = await team().getContext(agentId, ownerId);

    // All should succeed and return consistent member counts
    expect(ctx1.members.length).toBe(ctx2.members.length);
    expect(ctx2.members.length).toBe(ctx3.members.length);
  });
});

// --- Recently active members are NOT evicted by cleanup ---

describe('Recently active members survive cleanup', () => {
  const team = () => getTeam('cleanup-ext-active');
  const agent1 = 'cursor:cxa1';
  const agent2 = 'claude:cxa2';
  const agent3 = 'windsurf:cxa3';
  const owner1 = 'user-cxa1';
  const owner2 = 'user-cxa2';
  const owner3 = 'user-cxa3';

  it('setup: join three agents with data', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
    await team().join(agent3, owner3, 'carol', 'windsurf');

    await team().updateActivity(agent1, ['src/a.js'], 'Alice working', owner1);
    await team().updateActivity(agent2, ['src/b.js'], 'Bob working', owner2);
    await team().claimFiles(agent3, ['src/c.js'], 'carol', 'windsurf', owner3);
  });

  it('all recently active members survive after cleanup trigger', async () => {
    // Heartbeat all agents to keep them fresh
    await team().heartbeat(agent1, owner1);
    await team().heartbeat(agent2, owner2);
    await team().heartbeat(agent3, owner3);

    // Trigger cleanup via getContext
    const ctx = await team().getContext(agent1, owner1);
    expect(ctx.members.length).toBe(3);
    expect(ctx.members.some((m) => m.agent_id === agent1)).toBe(true);
    expect(ctx.members.some((m) => m.agent_id === agent2)).toBe(true);
    expect(ctx.members.some((m) => m.agent_id === agent3)).toBe(true);
  });

  it('activities are preserved for active members', async () => {
    const ctx = await team().getContext(agent1, owner1);
    const alice = ctx.members.find((m) => m.agent_id === agent1);
    const bob = ctx.members.find((m) => m.agent_id === agent2);

    expect(alice.activity).not.toBeNull();
    expect(alice.activity.files).toContain('src/a.js');
    expect(bob.activity).not.toBeNull();
    expect(bob.activity.files).toContain('src/b.js');
  });
});

// --- getSummary returns data after cleanup ---

describe('getSummary after cleanup', () => {
  const team = () => getTeam('cleanup-ext-summary');
  const agent1 = 'cursor:cxs1';
  const agent2 = 'claude:cxs2';
  const owner1 = 'user-cxs1';
  const owner2 = 'user-cxs2';

  it('setup: join agents with sessions and memories', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');

    await team().startSession(agent1, 'alice', 'react', owner1);
    await team().saveMemory(agent1, 'Summary test memory', ['config'], null, 'alice', owner1);
    await team().updateActivity(agent1, ['src/summary.js'], 'Working', owner1);
    await team().updateActivity(agent2, ['src/summary.js'], 'Also working', owner2);
  });

  it('getSummary returns valid data after cleanup trigger', async () => {
    // Trigger cleanup via getSummary itself
    const summary = await team().getSummary(owner1);
    expect(summary.error).toBeUndefined();
    expect(summary.ok).toBe(true);
    expect(summary.total_members).toBeGreaterThanOrEqual(2);
    expect(summary.active_agents).toBeGreaterThanOrEqual(2);
    expect(summary.memory_count).toBeGreaterThanOrEqual(1);
    expect(summary.live_sessions).toBeGreaterThanOrEqual(1);
  });

  it('getSummary detects conflicts', async () => {
    const summary = await team().getSummary(owner1);
    // Both agents are on src/summary.js — conflict_count should be >= 1
    expect(summary.conflict_count).toBeGreaterThanOrEqual(1);
  });
});

// --- Leave then rejoin ---

describe('Leave then rejoin — clean slate', () => {
  const team = () => getTeam('cleanup-ext-rejoin');
  const agentId = 'cursor:cxr1';
  const ownerId = 'user-cxr1';

  it('join, add data, leave, rejoin — old data is gone', async () => {
    // Join and add data
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().updateActivity(agentId, ['src/old-file.js'], 'Old activity', ownerId);
    await team().claimFiles(agentId, ['src/old-lock.js'], 'alice', 'cursor', ownerId);

    // Leave
    const leaveRes = await team().leave(agentId, ownerId);
    expect(leaveRes.ok).toBe(true);

    // Rejoin
    const rejoinRes = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(rejoinRes.ok).toBe(true);

    // Old activity should be gone
    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me).toBeDefined();
    expect(me.activity).toBeNull();

    // Old lock should be released
    expect(ctx.locks.length).toBe(0);
  });
});

// --- Multiple rapid cleanup triggers are safe ---

describe('Rapid cleanup triggers', () => {
  const team = () => getTeam('cleanup-ext-rapid');
  const agentId = 'cursor:cxrp1';
  const ownerId = 'user-cxrp1';

  it('setup: join with data', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().updateActivity(agentId, ['src/rapid.js'], 'Rapid test', ownerId);
    await team().saveMemory(agentId, 'Rapid cleanup memory', ['test'], null, 'alice', ownerId);
  });

  it('10 rapid getContext calls all succeed without data loss', async () => {
    const results = [];
    for (let i = 0; i < 10; i++) {
      const ctx = await team().getContext(agentId, ownerId);
      results.push(ctx);
    }

    // All should succeed
    expect(results.every((r) => !r.error)).toBe(true);

    // Member should be present in all results
    expect(results.every((r) => r.members.some((m) => m.agent_id === agentId))).toBe(true);

    // Memory should be present in all results
    expect(results.every((r) => r.memories.length > 0)).toBe(true);
  });
});
