import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id = 'test-team') {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// --- Concurrent file claims: first claimer wins ---

describe('Concurrent file claims', () => {
  const team = () => getTeam('concurrent-claims');
  const agent1 = 'cursor:cc1';
  const agent2 = 'claude:cc2';
  const owner1 = 'user-cc1';
  const owner2 = 'user-cc2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('two agents claim the same file simultaneously - one gets the lock', async () => {
    const [claim1, claim2] = await Promise.all([
      team().claimFiles(agent1, ['src/contested.js'], 'alice', 'cursor', owner1),
      team().claimFiles(agent2, ['src/contested.js'], 'bob', 'claude', owner2),
    ]);

    // Both should return ok (claimFiles always returns ok with claimed/blocked arrays)
    expect(claim1.ok).toBe(true);
    expect(claim2.ok).toBe(true);

    // Exactly one should have claimed, one should be blocked
    const totalClaimed = claim1.claimed.length + claim2.claimed.length;
    const totalBlocked = claim1.blocked.length + claim2.blocked.length;
    expect(totalClaimed).toBe(1);
    expect(totalBlocked).toBe(1);

    // The blocked entry should reference the winner
    const blockedResult = claim1.blocked.length > 0 ? claim1 : claim2;
    expect(blockedResult.blocked[0].file).toBe('src/contested.js');
    expect(['alice', 'bob']).toContain(blockedResult.blocked[0].held_by);
  });
});

// --- Conflict detection after concurrent activity ---

describe('Conflict detection after activity', () => {
  const team = () => getTeam('conflict-after-activity');
  const agent1 = 'cursor:cfa1';
  const agent2 = 'claude:cfa2';
  const owner1 = 'user-cfa1';
  const owner2 = 'user-cfa2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('agent A claims file, agent B checks conflicts - B sees the conflict', async () => {
    await team().claimFiles(agent1, ['src/locked-file.js'], 'alice', 'cursor', owner1);
    await team().updateActivity(agent1, ['src/locked-file.js'], 'Editing locked file', owner1);

    const conflicts = await team().checkConflicts(agent2, ['src/locked-file.js'], owner2);
    expect(conflicts.ok).toBe(true);

    // Agent B should see either an activity conflict or a lock conflict (or both)
    const hasActivityConflict = conflicts.conflicts.length > 0;
    const hasLockConflict = conflicts.locked.length > 0;
    expect(hasActivityConflict || hasLockConflict).toBe(true);

    if (hasLockConflict) {
      expect(conflicts.locked[0].file).toBe('src/locked-file.js');
      expect(conflicts.locked[0].held_by).toBe('alice');
    }
    if (hasActivityConflict) {
      expect(conflicts.conflicts[0].files).toContain('src/locked-file.js');
      expect(conflicts.conflicts[0].owner_handle).toBe('alice');
    }
  });
});

// --- Concurrent joins: both succeed ---

describe('Concurrent joins', () => {
  const team = () => getTeam('concurrent-joins');
  const agent1 = 'cursor:cj1';
  const agent2 = 'claude:cj2';
  const owner1 = 'user-cj1';
  const owner2 = 'user-cj2';

  it('two agents join simultaneously - both succeed', async () => {
    const [join1, join2] = await Promise.all([
      team().join(agent1, owner1, 'alice', 'cursor'),
      team().join(agent2, owner2, 'bob', 'claude'),
    ]);

    expect(join1.ok).toBe(true);
    expect(join2.ok).toBe(true);

    // Verify both are visible in context
    const ctx = await team().getContext(agent1, owner1);
    expect(ctx.members.length).toBe(2);
    expect(ctx.members.some((m) => m.agent_id === agent1)).toBe(true);
    expect(ctx.members.some((m) => m.agent_id === agent2)).toBe(true);
  });
});

// --- Lock release on leave ---

describe('Lock release on leave', () => {
  const team = () => getTeam('lock-release-on-leave');
  const agent1 = 'cursor:lrol1';
  const agent2 = 'claude:lrol2';
  const owner1 = 'user-lrol1';
  const owner2 = 'user-lrol2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('agent claims file, disconnects (leave), lock is released', async () => {
    // Agent 1 claims a file
    const claim = await team().claimFiles(agent1, ['src/release-me.js'], 'alice', 'cursor', owner1);
    expect(claim.ok).toBe(true);
    expect(claim.claimed).toContain('src/release-me.js');

    // Agent 2 cannot claim it
    const blocked = await team().claimFiles(agent2, ['src/release-me.js'], 'bob', 'claude', owner2);
    expect(blocked.blocked.length).toBe(1);
    expect(blocked.blocked[0].held_by).toBe('alice');

    // Agent 1 leaves (disconnects)
    const leaveRes = await team().leave(agent1, owner1);
    expect(leaveRes.ok).toBe(true);

    // Now agent 2 can claim the file
    const claimed = await team().claimFiles(agent2, ['src/release-me.js'], 'bob', 'claude', owner2);
    expect(claimed.claimed).toContain('src/release-me.js');
    expect(claimed.blocked).toHaveLength(0);
  });
});

// --- Concurrent activity updates ---

describe('Concurrent activity updates', () => {
  const team = () => getTeam('concurrent-activity');
  const agent1 = 'cursor:ca1';
  const agent2 = 'claude:ca2';
  const owner1 = 'user-ca1';
  const owner2 = 'user-ca2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('two agents update activity simultaneously - both succeed', async () => {
    const [res1, res2] = await Promise.all([
      team().updateActivity(agent1, ['src/file-a.js'], 'Agent 1 working', owner1),
      team().updateActivity(agent2, ['src/file-b.js'], 'Agent 2 working', owner2),
    ]);

    expect(res1).toEqual({ ok: true });
    expect(res2).toEqual({ ok: true });

    // Both activities should be visible
    const ctx = await team().getContext(agent1, owner1);
    const m1 = ctx.members.find((m) => m.agent_id === agent1);
    const m2 = ctx.members.find((m) => m.agent_id === agent2);
    expect(m1.activity.files).toContain('src/file-a.js');
    expect(m2.activity.files).toContain('src/file-b.js');
  });
});

// --- Concurrent claims on different files ---

describe('Concurrent claims on different files', () => {
  const team = () => getTeam('concurrent-diff-claims');
  const agent1 = 'cursor:cdc1';
  const agent2 = 'claude:cdc2';
  const owner1 = 'user-cdc1';
  const owner2 = 'user-cdc2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('two agents claim different files simultaneously - both succeed', async () => {
    const [claim1, claim2] = await Promise.all([
      team().claimFiles(agent1, ['src/alice-only.js'], 'alice', 'cursor', owner1),
      team().claimFiles(agent2, ['src/bob-only.js'], 'bob', 'claude', owner2),
    ]);

    expect(claim1.claimed).toContain('src/alice-only.js');
    expect(claim1.blocked).toHaveLength(0);
    expect(claim2.claimed).toContain('src/bob-only.js');
    expect(claim2.blocked).toHaveLength(0);
  });
});
