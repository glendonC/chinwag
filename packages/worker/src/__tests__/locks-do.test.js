import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id = 'test-team') {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// --- Partial claim: mixed claimable and blocked files ---

describe('Partial file claim (mixed results)', () => {
  const team = () => getTeam('partial-claim');
  const agent1 = 'cursor:pc1';
  const agent2 = 'claude:pc2';
  const owner1 = 'user-pc1';
  const owner2 = 'user-pc2';

  it('setup: join two agents, agent1 claims some files', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');

    const claim = await team().claimFiles(
      agent1,
      ['src/locked-a.js', 'src/locked-b.js'],
      'alice',
      'cursor',
      owner1,
    );
    expect(claim.claimed).toHaveLength(2);
  });

  it('agent2 claims mix of free and locked files — partial result', async () => {
    const claim = await team().claimFiles(
      agent2,
      ['src/locked-a.js', 'src/free-c.js', 'src/locked-b.js', 'src/free-d.js'],
      'bob',
      'claude',
      owner2,
    );

    expect(claim.ok).toBe(true);
    // Free files should be claimed
    expect(claim.claimed).toContain('src/free-c.js');
    expect(claim.claimed).toContain('src/free-d.js');
    expect(claim.claimed).toHaveLength(2);

    // Locked files should be blocked with details
    expect(claim.blocked).toHaveLength(2);
    const blockedFiles = claim.blocked.map((b) => b.file);
    expect(blockedFiles).toContain('src/locked-a.js');
    expect(blockedFiles).toContain('src/locked-b.js');

    // Blocked entries should show who holds the lock
    for (const b of claim.blocked) {
      expect(b.held_by).toBe('alice');
      expect(b.tool || b.host_tool).toBe('cursor');
      expect(b.claimed_at).toBeDefined();
    }
  });
});

// --- Lock ownership verification ---

describe('Lock ownership verification', () => {
  const team = () => getTeam('lock-ownership');
  const agent1 = 'cursor:lo1';
  const owner1 = 'user-lo1';

  it('setup: join', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
  });

  it('claimFiles rejects non-member agent', async () => {
    const res = await team().claimFiles(
      'cursor:nonexistent',
      ['src/file.js'],
      'hacker',
      'cursor',
      'bad-owner',
    );
    expect(res.error).toBeTruthy();
    expect(res.error).toContain('Not a member');
  });

  it('releaseFiles rejects wrong owner', async () => {
    await team().claimFiles(agent1, ['src/owned.js'], 'alice', 'cursor', owner1);

    // Wrong owner tries to release
    const res = await team().releaseFiles(agent1, ['src/owned.js'], 'wrong-owner');
    expect(res.error).toBeTruthy();

    // Verify lock is still held
    const claim = await team().claimFiles(agent1, ['src/owned.js'], 'alice', 'cursor', owner1);
    // Re-claiming own lock should succeed (idempotent refresh)
    expect(claim.claimed).toContain('src/owned.js');
  });
});

// --- getLockedFiles: filtering by active agents ---

describe('getLockedFiles — active agent filtering', () => {
  const team = () => getTeam('getlockedfiles-active');
  const agent1 = 'cursor:glf1';
  const agent2 = 'claude:glf2';
  const owner1 = 'user-glf1';
  const owner2 = 'user-glf2';

  it('setup: join two agents and claim files', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');

    const c1 = await team().claimFiles(agent1, ['src/alice-file.js'], 'alice', 'cursor', owner1);
    expect(c1.claimed).toContain('src/alice-file.js');

    const c2 = await team().claimFiles(agent2, ['src/bob-file.js'], 'bob', 'claude', owner2);
    expect(c2.claimed).toContain('src/bob-file.js');
  });

  it('getLockedFiles returns all active agent locks', async () => {
    // Both agents have fresh heartbeats from join
    const res = await team().getLockedFiles(agent1, owner1);
    expect(res.ok).toBe(true);
    expect(res.locks.length).toBe(2);

    const paths = res.locks.map((l) => l.file_path);
    expect(paths).toContain('src/alice-file.js');
    expect(paths).toContain('src/bob-file.js');
  });

  it('getLockedFiles includes lock metadata', async () => {
    const res = await team().getLockedFiles(agent1, owner1);
    const aliceLock = res.locks.find((l) => l.file_path === 'src/alice-file.js');
    expect(aliceLock).toBeDefined();
    expect(aliceLock.handle).toBe('alice');
    expect(aliceLock.host_tool).toBe('cursor');
    expect(aliceLock.claimed_at).toBeDefined();
    // minutes_held should be a number (zero or very small since we just claimed)
    expect(typeof aliceLock.minutes_held).toBe('number');
    expect(aliceLock.minutes_held).toBeGreaterThanOrEqual(0);
  });
});

// --- Lock with runtime metadata ---

describe('Lock with runtime metadata', () => {
  const team = () => getTeam('lock-runtime-meta');
  const agentId = 'cursor:lrm1';
  const ownerId = 'user-lrm1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('claimFiles with structured runtime preserves metadata', async () => {
    const runtime = {
      hostTool: 'cursor',
      agentSurface: 'cline',
      transport: 'mcp',
    };
    const claim = await team().claimFiles(
      agentId,
      ['src/runtime-lock.js'],
      'alice',
      runtime,
      ownerId,
    );
    expect(claim.ok).toBe(true);
    expect(claim.claimed).toContain('src/runtime-lock.js');

    // Verify metadata in lock listing
    const locks = await team().getLockedFiles(agentId, ownerId);
    const lock = locks.locks.find((l) => l.file_path === 'src/runtime-lock.js');
    expect(lock).toBeDefined();
    expect(lock.host_tool).toBe('cursor');
    expect(lock.agent_surface).toBe('cline');
  });
});

// --- Idempotent lock refresh ---

describe('Idempotent lock refresh', () => {
  const team = () => getTeam('lock-refresh');
  const agentId = 'cursor:lr1';
  const ownerId = 'user-lr1';

  it('setup: join and claim', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    const claim = await team().claimFiles(agentId, ['src/refresh.js'], 'alice', 'cursor', ownerId);
    expect(claim.claimed).toContain('src/refresh.js');
  });

  it('re-claiming same file refreshes lock (still claimed, not blocked)', async () => {
    const claim = await team().claimFiles(agentId, ['src/refresh.js'], 'alice', 'cursor', ownerId);
    expect(claim.ok).toBe(true);
    expect(claim.claimed).toContain('src/refresh.js');
    expect(claim.blocked).toHaveLength(0);
  });

  it('re-claiming with updated handle preserves the lock', async () => {
    const claim = await team().claimFiles(
      agentId,
      ['src/refresh.js'],
      'alice-renamed',
      'cursor',
      ownerId,
    );
    expect(claim.ok).toBe(true);
    expect(claim.claimed).toContain('src/refresh.js');

    // Verify updated handle in lock
    const locks = await team().getLockedFiles(agentId, ownerId);
    const lock = locks.locks.find((l) => l.file_path === 'src/refresh.js');
    expect(lock.handle).toBe('alice-renamed');
  });
});

// --- Lock with empty file array ---

describe('Lock edge cases — empty arrays', () => {
  const team = () => getTeam('lock-empty-edge');
  const agentId = 'cursor:lee1';
  const ownerId = 'user-lee1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('claimFiles with empty array returns empty results', async () => {
    const claim = await team().claimFiles(agentId, [], 'alice', 'cursor', ownerId);
    expect(claim.ok).toBe(true);
    expect(claim.claimed).toHaveLength(0);
    expect(claim.blocked).toHaveLength(0);
  });

  it('releaseFiles with empty array is a release-all operation', async () => {
    // Claim some files first
    await team().claimFiles(agentId, ['src/e1.js', 'src/e2.js'], 'alice', 'cursor', ownerId);

    // Release with empty array (treated as "release all")
    const res = await team().releaseFiles(agentId, [], ownerId);
    expect(res.ok).toBe(true);

    // All locks should be gone
    const locks = await team().getLockedFiles(agentId, ownerId);
    const myLocks = locks.locks.filter((l) => l.agent_id === agentId);
    expect(myLocks).toHaveLength(0);
  });
});
