import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id = 'test-team') {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// --- WebSocket connection setup (via fetch to /ws) ---

describe('WebSocket fetch endpoint', () => {
  const team = () => getTeam('ws-fetch-tests');
  const agentId = 'cursor:ws-fetch1';
  const ownerId = 'user-ws-fetch1';

  it('setup: join team', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('rejects requests without X-Chinwag-Verified header', async () => {
    const res = await team().fetch(
      new Request(`http://localhost/ws?agentId=${agentId}&ownerId=${ownerId}&role=agent`),
    );
    expect(res.status).toBe(403);
  });

  it('rejects requests without agentId param', async () => {
    const res = await team().fetch(
      new Request('http://localhost/ws?role=agent', {
        headers: { 'X-Chinwag-Verified': '1' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects non-member agent', async () => {
    const res = await team().fetch(
      new Request(`http://localhost/ws?agentId=cursor:nonexistent&ownerId=${ownerId}&role=agent`, {
        headers: { 'X-Chinwag-Verified': '1' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects agent owned by different user', async () => {
    const res = await team().fetch(
      new Request(`http://localhost/ws?agentId=${agentId}&ownerId=other-user&role=agent`, {
        headers: { 'X-Chinwag-Verified': '1' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-ws paths', async () => {
    const res = await team().fetch(
      new Request('http://localhost/other', {
        headers: { 'X-Chinwag-Verified': '1' },
      }),
    );
    expect(res.status).toBe(404);
  });
});

// --- WebSocket message handling ---

describe('WebSocket message handling via activity updates', () => {
  const team = () => getTeam('ws-message-tests');
  const agentId = 'cursor:ws-msg1';
  const ownerId = 'user-ws-msg1';

  it('setup: join team', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('ping message via RPC heartbeat works', async () => {
    // We can test the heartbeat as a proxy for the ping handler's behavior
    const res = await team().heartbeat(agentId);
    expect(res.ok).toBe(true);
  });

  it('heartbeat fails for non-member', async () => {
    const res = await team().heartbeat('cursor:unknown');
    expect(res).toEqual({ error: 'Not a member of this team', code: 'NOT_MEMBER' });
  });
});

// --- WebSocket close behavior (lock release) ---

describe('WebSocket close behavior — lock release', () => {
  const team = () => getTeam('ws-close-tests');
  const agent1 = 'cursor:ws-close1';
  const agent2 = 'claude:ws-close2';
  const owner1 = 'user-ws-close1';
  const owner2 = 'user-ws-close2';

  it('setup: join two agents and claim locks', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');

    const res = await team().claimFiles(agent1, ['src/lock-test.js'], 'alice', 'cursor', owner1);
    expect(res.ok).toBe(true);
    expect(res.claimed).toContain('src/lock-test.js');
  });

  it('locks are released when agent leaves (simulating WS close)', async () => {
    // Simulate the behavior of webSocketClose: release locks and leave
    const releaseRes = await team().releaseFiles(agent1, null, owner1);
    expect(releaseRes.ok).toBe(true);

    // Other agent can now claim the file
    const claimRes = await team().claimFiles(agent2, ['src/lock-test.js'], 'bob', 'claude', owner2);
    expect(claimRes.ok).toBe(true);
    expect(claimRes.claimed).toContain('src/lock-test.js');
    expect(claimRes.blocked).toHaveLength(0);
  });
});

// --- Agent vs watcher role distinction ---

describe('Agent vs watcher role behavior', () => {
  const team = () => getTeam('ws-role-tests');
  const agentId = 'cursor:ws-role1';
  const ownerId = 'user-ws-role1';

  it('setup: join team', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('agent role allows activity updates', async () => {
    const res = await team().updateActivity(agentId, ['src/main.js'], 'Working', ownerId);
    expect(res.ok).toBe(true);
  });

  it('agent role allows file reporting', async () => {
    const res = await team().reportFile(agentId, 'src/other.js', ownerId);
    expect(res.ok).toBe(true);
  });
});

// --- Heartbeat updates on connect ---

describe('Heartbeat on connect behavior', () => {
  const team = () => getTeam('ws-heartbeat-tests');
  const agentId = 'cursor:ws-hb1';
  const ownerId = 'user-ws-hb1';

  it('setup: join', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('heartbeat keeps agent active and visible in context', async () => {
    await team().heartbeat(agentId, ownerId);

    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me).toBeDefined();
    expect(me.status).toBe('active');
  });
});

// --- Broadcast on status change ---

describe('Status change broadcast behavior', () => {
  const team = () => getTeam('ws-broadcast-tests');
  const agent1 = 'cursor:ws-bc1';
  const agent2 = 'claude:ws-bc2';
  const owner1 = 'user-ws-bc1';
  const owner2 = 'user-ws-bc2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('activity update from one agent is visible in context for other', async () => {
    await team().updateActivity(agent1, ['src/broadcast.js'], 'Broadcasting changes', owner1);

    const ctx = await team().getContext(agent2, owner2);
    const alice = ctx.members.find((m) => m.agent_id === agent1);
    expect(alice).toBeDefined();
    expect(alice.activity.files).toContain('src/broadcast.js');
    expect(alice.activity.summary).toBe('Broadcasting changes');
  });

  it('lock changes from one agent are visible to other', async () => {
    await team().claimFiles(agent1, ['src/shared.js'], 'alice', 'cursor', owner1);

    const locks = await team().getLockedFiles(agent2, owner2);
    expect(locks.locks.some((l) => l.file_path === 'src/shared.js')).toBe(true);
  });
});

// --- Malformed input resilience ---

describe('Malformed input resilience', () => {
  const team = () => getTeam('ws-malformed-tests');
  const agentId = 'cursor:ws-mal1';
  const ownerId = 'user-ws-mal1';

  it('setup: join', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('updateActivity with empty files array succeeds', async () => {
    // The DO accepts it — validation is in the route handler
    const res = await team().updateActivity(agentId, [], '', ownerId);
    expect(res.ok).toBe(true);
  });

  it('operations with wrong owner are rejected', async () => {
    const res = await team().updateActivity(agentId, ['file.js'], 'test', 'wrong-owner');
    expect(res.error).toContain('Not a member');
  });

  it('heartbeat for non-existent agent fails gracefully', async () => {
    const res = await team().heartbeat('cursor:doesnotexist');
    expect(res.error).toBeTruthy();
  });
});
