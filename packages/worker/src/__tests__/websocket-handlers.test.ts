import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id = 'test-team') {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// =====================================================================
// WebSocket handler tests
//
// The TeamDO's webSocketMessage() and webSocketClose() are Hibernation
// API callbacks invoked by the Workers runtime - they can't be called
// directly via RPC. Instead, we test through two complementary paths:
//
// 1. The DO's fetch() endpoint (WebSocket connection setup and validation)
// 2. The RPC methods that exercise the same pure functions the WS handlers
//    delegate to (activity.ts, membership.ts, locks.ts)
//
// This ensures the underlying business logic is correct, even though we
// can't inject raw WebSocket frames in the workerd test environment.
// =====================================================================

// --- WebSocket connection setup: validation ---
// NOTE: The workerd runtime requires 'Upgrade: websocket' to return a 101 response.
// Since the vitest pool doesn't support real WebSocket handshakes, we only test the
// rejection/error paths of the fetch() endpoint here. The success path (101) is
// implicitly validated by the DO accepting connections in production.

describe('WebSocket connection setup - validation', () => {
  const team = () => getTeam('ws-setup-validation');
  const agentId = 'cursor:ws-setup-val1';
  const ownerId = 'user-ws-setup-val1';

  it('setup: join team', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('rejects when X-Chinmeister-Verified header has wrong value ("true" instead of "1")', async () => {
    const res = await team().fetch(
      new Request(`http://localhost/ws?agentId=${agentId}&ownerId=${ownerId}&role=agent`, {
        headers: { 'X-Chinmeister-Verified': 'true' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects when X-Chinmeister-Verified header is "0"', async () => {
    const res = await team().fetch(
      new Request(`http://localhost/ws?agentId=${agentId}&ownerId=${ownerId}&role=agent`, {
        headers: { 'X-Chinmeister-Verified': '0' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects when X-Chinmeister-Verified header is empty string', async () => {
    const res = await team().fetch(
      new Request(`http://localhost/ws?agentId=${agentId}&ownerId=${ownerId}&role=agent`, {
        headers: { 'X-Chinmeister-Verified': '' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects agent that was never joined', async () => {
    const res = await team().fetch(
      new Request(`http://localhost/ws?agentId=cursor:ghost&ownerId=user-ghost&role=agent`, {
        headers: { 'X-Chinmeister-Verified': '1' },
      }),
    );
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain('Not a member');
  });

  it('rejects agent with mismatched ownerId', async () => {
    const res = await team().fetch(
      new Request(`http://localhost/ws?agentId=${agentId}&ownerId=wrong-owner&role=agent`, {
        headers: { 'X-Chinmeister-Verified': '1' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects when agentId is empty string', async () => {
    const res = await team().fetch(
      new Request(`http://localhost/ws?agentId=&ownerId=${ownerId}&role=agent`, {
        headers: { 'X-Chinmeister-Verified': '1' },
      }),
    );
    // Empty string is falsy, so this triggers the 400 path
    expect(res.status).toBe(400);
  });

  it('rejects when ownerId is empty string', async () => {
    const res = await team().fetch(
      new Request(`http://localhost/ws?agentId=${agentId}&ownerId=&role=agent`, {
        headers: { 'X-Chinmeister-Verified': '1' },
      }),
    );
    expect(res.status).toBe(400);
  });
});

// --- WebSocket fetch endpoint: path routing ---

describe('WebSocket fetch endpoint - path routing', () => {
  const team = () => getTeam('ws-path-routing');

  it('returns 404 for /ws/extra path', async () => {
    const res = await team().fetch(
      new Request('http://localhost/ws/extra', {
        headers: { 'X-Chinmeister-Verified': '1' },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for root path /', async () => {
    const res = await team().fetch(
      new Request('http://localhost/', {
        headers: { 'X-Chinmeister-Verified': '1' },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for empty path', async () => {
    const res = await team().fetch(
      new Request('http://localhost', {
        headers: { 'X-Chinmeister-Verified': '1' },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for /health path', async () => {
    const res = await team().fetch(
      new Request('http://localhost/health', {
        headers: { 'X-Chinmeister-Verified': '1' },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('rejects /ws without verification header before checking params', async () => {
    const res = await team().fetch(new Request('http://localhost/ws'));
    expect(res.status).toBe(403);
  });

  it('missing both agentId and ownerId returns 400', async () => {
    const res = await team().fetch(
      new Request('http://localhost/ws', {
        headers: { 'X-Chinmeister-Verified': '1' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('missing ownerId returns 400 with descriptive message', async () => {
    const res = await team().fetch(
      new Request('http://localhost/ws?agentId=cursor:test', {
        headers: { 'X-Chinmeister-Verified': '1' },
      }),
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Missing');
  });

  it('missing agentId returns 400', async () => {
    const res = await team().fetch(
      new Request('http://localhost/ws?ownerId=user-test', {
        headers: { 'X-Chinmeister-Verified': '1' },
      }),
    );
    expect(res.status).toBe(400);
  });
});

// --- Heartbeat behavior (mirrors the ping handler in webSocketMessage) ---

describe('Heartbeat behavior (WS ping handler path)', () => {
  const team = () => getTeam('ws-hb-behavior');
  const agentId = 'cursor:ws-hb-beh1';
  const ownerId = 'user-ws-hb-beh1';

  it('setup: join team', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('heartbeat keeps agent active in context (simulates WS ping handler)', async () => {
    // The WS ping handler calls: UPDATE members SET last_heartbeat = datetime('now')
    // The RPC heartbeat() does the same thing
    const hb = await team().heartbeat(agentId, ownerId);
    expect(hb.ok).toBe(true);

    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me).toBeDefined();
    expect(me.status).toBe('active');
  });

  it('join itself bumps heartbeat (agent starts active)', async () => {
    // Join sets last_heartbeat to datetime('now'), same as WS connect
    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me.status).toBe('active');
  });
});

// --- Ping message behavior (exercises heartbeat + last_tool_use logic) ---

describe('Ping/heartbeat message behavior', () => {
  const team = () => getTeam('ws-ping-tests');
  const agentId = 'cursor:ws-ping1';
  const ownerId = 'user-ws-ping1';

  it('setup: join', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('heartbeat updates last_heartbeat and keeps agent active', async () => {
    const res = await team().heartbeat(agentId, ownerId);
    expect(res.ok).toBe(true);

    // Verify agent is active
    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me).toBeDefined();
    expect(me.status).toBe('active');
  });

  it('multiple rapid heartbeats succeed without error', async () => {
    // Simulates rapid ping messages (the WS handler calls heartbeat on each ping)
    for (let i = 0; i < 5; i++) {
      const res = await team().heartbeat(agentId, ownerId);
      expect(res.ok).toBe(true);
    }
  });

  it('heartbeat for non-member returns NOT_MEMBER error', async () => {
    const res = await team().heartbeat('cursor:nobody', 'user-nobody');
    expect(res.error).toContain('Not a member');
    expect(res.code).toBe('NOT_MEMBER');
  });

  it('heartbeat with wrong owner is rejected', async () => {
    const res = await team().heartbeat(agentId, 'wrong-owner');
    expect(res.error).toBeTruthy();
  });
});

// --- Activity update message behavior (WS type=activity) ---

describe('Activity update via WS path (updateActivity)', () => {
  const team = () => getTeam('ws-activity-msg');
  const agent1 = 'cursor:ws-act1';
  const agent2 = 'claude:ws-act2';
  const owner1 = 'user-ws-act1';
  const owner2 = 'user-ws-act2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('activity update with files and summary stores correctly', async () => {
    const res = await team().updateActivity(
      agent1,
      ['src/handler.ts', 'src/router.ts'],
      'Refactoring WebSocket handlers',
      owner1,
    );
    expect(res.ok).toBe(true);

    // Verify via context
    const ctx = await team().getContext(agent1, owner1);
    const me = ctx.members.find((m) => m.agent_id === agent1);
    expect(me.activity.files).toContain('src/handler.ts');
    expect(me.activity.files).toContain('src/router.ts');
    expect(me.activity.summary).toBe('Refactoring WebSocket handlers');
  });

  it('activity update with empty files array succeeds', async () => {
    // WS handler sends (data.files || []) - empty arrays are valid
    const res = await team().updateActivity(agent1, [], '', owner1);
    expect(res.ok).toBe(true);
  });

  it('activity update with empty summary succeeds', async () => {
    // WS handler sends (data.summary || '') - empty string is valid
    const res = await team().updateActivity(agent1, ['src/a.js'], '', owner1);
    expect(res.ok).toBe(true);
  });

  it('activity update replaces previous activity (not appends)', async () => {
    await team().updateActivity(agent1, ['src/old.js'], 'Old work', owner1);
    await team().updateActivity(agent1, ['src/new.js'], 'New work', owner1);

    const ctx = await team().getContext(agent1, owner1);
    const me = ctx.members.find((m) => m.agent_id === agent1);
    expect(me.activity.files).toContain('src/new.js');
    expect(me.activity.files).not.toContain('src/old.js');
    expect(me.activity.summary).toBe('New work');
  });

  it('activity update is visible to other agents in context', async () => {
    await team().updateActivity(agent1, ['src/visible.js'], 'Should be seen', owner1);

    const ctx = await team().getContext(agent2, owner2);
    const alice = ctx.members.find((m) => m.agent_id === agent1);
    expect(alice.activity.files).toContain('src/visible.js');
    expect(alice.activity.summary).toBe('Should be seen');
  });

  it('activity update with wrong owner is rejected', async () => {
    const res = await team().updateActivity(agent1, ['src/x.js'], 'test', 'wrong-owner');
    expect(res.error).toContain('Not a member');
  });

  it('activity update for non-member is rejected', async () => {
    const res = await team().updateActivity('cursor:ghost', ['src/x.js'], 'test', 'user-ghost');
    expect(res.error).toContain('Not a member');
  });

  it('activity update normalizes file paths', async () => {
    await team().updateActivity(agent1, ['./src/normalized.js'], 'Path test', owner1);

    const ctx = await team().getContext(agent1, owner1);
    const me = ctx.members.find((m) => m.agent_id === agent1);
    // normalizePath strips leading ./
    expect(me.activity.files).toContain('src/normalized.js');
    expect(me.activity.files).not.toContain('./src/normalized.js');
  });
});

// --- File report message behavior (WS type=file) ---

describe('File report via WS path (reportFile)', () => {
  const team = () => getTeam('ws-file-report');
  const agentId = 'cursor:ws-file1';
  const ownerId = 'user-ws-file1';

  it('setup: join', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('reportFile adds file to activity list', async () => {
    const res = await team().reportFile(agentId, 'src/first.js', ownerId);
    expect(res.ok).toBe(true);

    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me.activity.files).toContain('src/first.js');
  });

  it('reportFile appends to existing file list (does not replace)', async () => {
    await team().reportFile(agentId, 'src/second.js', ownerId);

    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me.activity.files).toContain('src/first.js');
    expect(me.activity.files).toContain('src/second.js');
  });

  it('reportFile does not duplicate existing file', async () => {
    await team().reportFile(agentId, 'src/first.js', ownerId);

    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    const firstCount = me.activity.files.filter((f) => f === 'src/first.js').length;
    expect(firstCount).toBe(1);
  });

  it('reportFile normalizes file paths', async () => {
    await team().reportFile(agentId, './src/normalized-report.js', ownerId);

    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me.activity.files).toContain('src/normalized-report.js');
  });

  it('reportFile for non-member is rejected', async () => {
    const res = await team().reportFile('cursor:ghost', 'src/x.js', 'user-ghost');
    expect(res.error).toContain('Not a member');
  });

  it('reportFile with wrong owner is rejected', async () => {
    const res = await team().reportFile(agentId, 'src/x.js', 'wrong-owner');
    expect(res.error).toBeTruthy();
  });
});

// --- WebSocket close behavior: lock release on disconnect ---

describe('WebSocket close - lock release on disconnect', () => {
  const team = () => getTeam('ws-close-lock-release');
  const agent1 = 'cursor:ws-cl1';
  const agent2 = 'claude:ws-cl2';
  const owner1 = 'user-ws-cl1';
  const owner2 = 'user-ws-cl2';

  it('setup: join two agents and claim multiple locks', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');

    const claim = await team().claimFiles(
      agent1,
      ['src/a.js', 'src/b.js', 'src/c.js'],
      'alice',
      'cursor',
      owner1,
    );
    expect(claim.ok).toBe(true);
    expect(claim.claimed).toHaveLength(3);
  });

  it('releaseFiles(null) releases ALL locks (simulates webSocketClose)', async () => {
    // webSocketClose calls releaseFilesFn(sql, agentId, null) - no ownerId check
    const rel = await team().releaseFiles(agent1, null, owner1);
    expect(rel.ok).toBe(true);

    // All files should be claimable by agent2
    const claim = await team().claimFiles(
      agent2,
      ['src/a.js', 'src/b.js', 'src/c.js'],
      'bob',
      'claude',
      owner2,
    );
    expect(claim.claimed).toHaveLength(3);
    expect(claim.blocked).toHaveLength(0);
  });
});

// --- WebSocket close behavior: agent leave (member_left) ---

describe('WebSocket close - agent leaves team', () => {
  const team = () => getTeam('ws-close-leave');
  const agent1 = 'cursor:ws-leave1';
  const agent2 = 'claude:ws-leave2';
  const owner1 = 'user-ws-leave1';
  const owner2 = 'user-ws-leave2';

  it('setup: join two agents with activity and locks', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');

    await team().updateActivity(agent1, ['src/leaving.js'], 'About to disconnect', owner1);
    await team().claimFiles(agent1, ['src/leaving.js'], 'alice', 'cursor', owner1);
  });

  it('leaving releases locks and removes from member list', async () => {
    const leaveRes = await team().leave(agent1, owner1);
    expect(leaveRes.ok).toBe(true);

    // Agent1 should no longer appear in context
    const ctx = await team().getContext(agent2, owner2);
    const alice = ctx.members.find((m) => m.agent_id === agent1);
    expect(alice).toBeUndefined();

    // File should be claimable
    const claim = await team().claimFiles(agent2, ['src/leaving.js'], 'bob', 'claude', owner2);
    expect(claim.claimed).toContain('src/leaving.js');
    expect(claim.blocked).toHaveLength(0);
  });

  it('heartbeat for left agent fails', async () => {
    const res = await team().heartbeat(agent1);
    expect(res.error).toBeTruthy();
  });
});

// --- WebSocket close: abnormal close (no explicit leave, just disconnect) ---

describe('WebSocket close - abnormal disconnect (locks released, member stays)', () => {
  const team = () => getTeam('ws-close-abnormal');
  const agent1 = 'cursor:ws-abnormal1';
  const agent2 = 'claude:ws-abnormal2';
  const owner1 = 'user-ws-abnormal1';
  const owner2 = 'user-ws-abnormal2';

  it('setup: join agents and claim locks', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');

    await team().claimFiles(agent1, ['src/crash.js'], 'alice', 'cursor', owner1);
  });

  it('release all locks without leaving (simulates abnormal WS close)', async () => {
    // webSocketClose releases locks but doesn't call leave()
    const rel = await team().releaseFiles(agent1, null, owner1);
    expect(rel.ok).toBe(true);

    // Agent1 is still a member (can heartbeat)
    const hb = await team().heartbeat(agent1, owner1);
    expect(hb.ok).toBe(true);

    // But their locks are gone
    const claim = await team().claimFiles(agent2, ['src/crash.js'], 'bob', 'claude', owner2);
    expect(claim.claimed).toContain('src/crash.js');
    expect(claim.blocked).toHaveLength(0);
  });
});

// --- Watcher role restrictions ---

describe('Watcher role restrictions (watchers cannot update activity or report files)', () => {
  const team = () => getTeam('ws-watcher-restrict');
  const watcherAgent = 'cursor:ws-watcher1';
  const agentAgent = 'cursor:ws-agent1';
  const watcherOwner = 'user-ws-watcher1';
  const agentOwner = 'user-ws-agent1';

  it('setup: join both as members (role is determined at WS connect, not join)', async () => {
    await team().join(watcherAgent, watcherOwner, 'watcher-alice', 'cursor');
    await team().join(agentAgent, agentOwner, 'agent-bob', 'cursor');
  });

  // NOTE: The watcher restriction (isAgent check) happens inside webSocketMessage()
  // which we can't call directly. However, the RPC methods themselves don't have
  // role restrictions - they work for any team member. The role check is specifically
  // a WebSocket-layer guard. We verify the RPC path works for both to ensure the
  // underlying functions don't have unexpected restrictions.

  it('updateActivity works via RPC regardless of WS role', async () => {
    const res = await team().updateActivity(
      watcherAgent,
      ['src/watch.js'],
      'Watching',
      watcherOwner,
    );
    expect(res.ok).toBe(true);
  });

  it('reportFile works via RPC regardless of WS role', async () => {
    const res = await team().reportFile(watcherAgent, 'src/reported.js', watcherOwner);
    expect(res.ok).toBe(true);
  });

  it('both watcher and agent members can use getContext', async () => {
    const watcherCtx = await team().getContext(watcherAgent, watcherOwner);
    expect(watcherCtx.members).toBeDefined();
    expect(watcherCtx.members.length).toBe(2);

    const agentCtx = await team().getContext(agentAgent, agentOwner);
    expect(agentCtx.members).toBeDefined();
    expect(agentCtx.members.length).toBe(2);
  });

  it('both roles can see each other in context', async () => {
    const ctx = await team().getContext(watcherAgent, watcherOwner);
    const agent = ctx.members.find((m) => m.agent_id === agentAgent);
    expect(agent).toBeDefined();
    expect(agent.handle).toBe('agent-bob');
  });
});

// --- Conflict detection after activity update (WS-triggered path) ---

describe('Conflict detection after WS-style activity updates', () => {
  const team = () => getTeam('ws-conflict-detection');
  const agent1 = 'cursor:ws-conf1';
  const agent2 = 'claude:ws-conf2';
  const agent3 = 'windsurf:ws-conf3';
  const owner1 = 'user-ws-conf1';
  const owner2 = 'user-ws-conf2';
  const owner3 = 'user-ws-conf3';

  it('setup: join three agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
    await team().join(agent3, owner3, 'carol', 'windsurf');
  });

  it('no conflict when only one agent updates activity on a file', async () => {
    await team().updateActivity(agent1, ['src/solo.js'], 'Solo work', owner1);
    const res = await team().checkConflicts(agent1, ['src/solo.js'], owner1);
    expect(res.conflicts).toHaveLength(0);
  });

  it('conflict when two agents report same file via activity', async () => {
    await team().updateActivity(agent1, ['src/shared-ws.js'], 'Agent 1', owner1);
    await team().updateActivity(agent2, ['src/shared-ws.js'], 'Agent 2', owner2);

    const res = await team().checkConflicts(agent1, ['src/shared-ws.js'], owner1);
    expect(res.conflicts.length).toBeGreaterThan(0);
    expect(res.conflicts[0].owner_handle).toBe('bob');
  });

  it('conflict from reportFile appears in checkConflicts', async () => {
    // Clear previous activity
    await team().updateActivity(agent1, ['src/report-conflict.js'], 'File report path', owner1);
    await team().reportFile(agent2, 'src/report-conflict.js', owner2);

    const res = await team().checkConflicts(agent1, ['src/report-conflict.js'], owner1);
    expect(res.conflicts.length).toBeGreaterThan(0);
  });

  it('locked file appears in checkConflicts.locked', async () => {
    await team().claimFiles(agent2, ['src/locked-ws.js'], 'bob', 'claude', owner2);

    const res = await team().checkConflicts(agent1, ['src/locked-ws.js'], owner1);
    expect(res.locked.length).toBeGreaterThan(0);
    expect(res.locked[0].file).toBe('src/locked-ws.js');
    expect(res.locked[0].held_by).toBe('bob');
  });
});

// --- Multiple concurrent WebSocket connections ---

describe('Multiple concurrent WebSocket connections per team', () => {
  const team = () => getTeam('ws-concurrent');
  const agents = [
    { id: 'cursor:ws-conc1', owner: 'user-ws-conc1', handle: 'alice' },
    { id: 'claude:ws-conc2', owner: 'user-ws-conc2', handle: 'bob' },
    { id: 'windsurf:ws-conc3', owner: 'user-ws-conc3', handle: 'carol' },
  ];

  it('setup: join all agents', async () => {
    for (const a of agents) {
      const res = await team().join(a.id, a.owner, a.handle, a.id.split(':')[0]);
      expect(res.ok).toBe(true);
    }
  });

  it('all agents can heartbeat simultaneously (simulates concurrent WS connections)', async () => {
    const results = await Promise.all(agents.map((a) => team().heartbeat(a.id, a.owner)));

    for (const res of results) {
      expect(res.ok).toBe(true);
    }
  });

  it('all agents are visible in context after connecting', async () => {
    const ctx = await team().getContext(agents[0].id, agents[0].owner);
    expect(ctx.members.length).toBe(3);

    for (const a of agents) {
      const member = ctx.members.find((m) => m.agent_id === a.id);
      expect(member).toBeDefined();
      expect(member.handle).toBe(a.handle);
    }
  });

  it('activity update from one agent is visible to all others', async () => {
    await team().updateActivity(
      agents[0].id,
      ['src/shared-conc.js'],
      'Concurrent work',
      agents[0].owner,
    );

    for (let i = 1; i < agents.length; i++) {
      const ctx = await team().getContext(agents[i].id, agents[i].owner);
      const alice = ctx.members.find((m) => m.agent_id === agents[0].id);
      expect(alice.activity.files).toContain('src/shared-conc.js');
    }
  });
});

// --- Initial context delivery on connect ---

describe('Initial context delivery on WebSocket connect', () => {
  const team = () => getTeam('ws-initial-context');
  const agent1 = 'cursor:ws-init1';
  const agent2 = 'claude:ws-init2';
  const owner1 = 'user-ws-init1';
  const owner2 = 'user-ws-init2';

  it('setup: join two agents with activity', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
    await team().updateActivity(agent1, ['src/pre-existing.js'], 'Before connect', owner1);
    await team().saveMemory(agent1, 'Test memory', ['pattern'], null, 'alice', null, owner1);
  });

  it('getContext includes pre-existing activity from other agents', async () => {
    const ctx = await team().getContext(agent2, owner2);
    expect(ctx.members).toBeDefined();
    expect(ctx.members.length).toBe(2);

    const alice = ctx.members.find((m) => m.agent_id === agent1);
    expect(alice).toBeDefined();
    expect(alice.activity.files).toContain('src/pre-existing.js');
  });

  it('getContext includes team memories', async () => {
    const ctx = await team().getContext(agent2, owner2);
    expect(ctx.memories).toBeDefined();
    expect(ctx.memories.length).toBeGreaterThan(0);
    expect(ctx.memories.some((m) => m.text === 'Test memory')).toBe(true);
  });

  it('getContext includes lock information', async () => {
    await team().claimFiles(agent1, ['src/locked-init.js'], 'alice', 'cursor', owner1);

    const ctx = await team().getContext(agent2, owner2);
    expect(ctx.locks).toBeDefined();
    expect(ctx.locks.some((l) => l.file_path === 'src/locked-init.js')).toBe(true);
  });
});

// --- Edge: rapid fire activity updates (stress-tests the WS handler path) ---

describe('Rapid-fire activity updates (WS message flood resilience)', () => {
  const team = () => getTeam('ws-rapid-fire');
  const agentId = 'cursor:ws-rapid1';
  const ownerId = 'user-ws-rapid1';

  it('setup: join', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('10 rapid activity updates all succeed', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        team().updateActivity(agentId, [`src/file${i}.js`], `Update ${i}`, ownerId),
      ),
    );

    for (const res of results) {
      expect(res.ok).toBe(true);
    }

    // Last update wins (activity is replaced, not appended)
    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me.activity.files).toHaveLength(1);
  });

  it('10 rapid reportFile calls all succeed and accumulate', async () => {
    // Reset activity first
    await team().updateActivity(agentId, [], '', ownerId);

    for (let i = 0; i < 10; i++) {
      const res = await team().reportFile(agentId, `src/rapid${i}.js`, ownerId);
      expect(res.ok).toBe(true);
    }

    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me.activity.files.length).toBe(10);
  });

  it('10 rapid heartbeats all succeed', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => team().heartbeat(agentId, ownerId)),
    );

    for (const res of results) {
      expect(res.ok).toBe(true);
    }
  });
});

// --- Edge: operations after agent disconnects (simulated by leave) ---

describe('Operations after agent disconnect', () => {
  const team = () => getTeam('ws-post-disconnect');
  const agentId = 'cursor:ws-postdc1';
  const ownerId = 'user-ws-postdc1';

  it('setup: join and then leave', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().leave(agentId, ownerId);
  });

  it('updateActivity after leave fails', async () => {
    const res = await team().updateActivity(agentId, ['src/x.js'], 'test', ownerId);
    expect(res.error).toBeTruthy();
  });

  it('reportFile after leave fails', async () => {
    const res = await team().reportFile(agentId, 'src/x.js', ownerId);
    expect(res.error).toBeTruthy();
  });

  it('heartbeat after leave fails', async () => {
    const res = await team().heartbeat(agentId, ownerId);
    expect(res.error).toBeTruthy();
  });

  it('checkConflicts after leave fails', async () => {
    const res = await team().checkConflicts(agentId, ['src/x.js'], ownerId);
    expect(res.error).toBeTruthy();
  });

  it('getContext after leave fails', async () => {
    const res = await team().getContext(agentId, ownerId);
    expect(res.error).toBeTruthy();
  });

  it('can rejoin after leave and resume normal operations', async () => {
    const joinRes = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(joinRes.ok).toBe(true);

    const actRes = await team().updateActivity(agentId, ['src/rejoin.js'], 'Back', ownerId);
    expect(actRes.ok).toBe(true);

    const ctx = await team().getContext(agentId, ownerId);
    const me = ctx.members.find((m) => m.agent_id === agentId);
    expect(me.activity.files).toContain('src/rejoin.js');
  });
});

// --- Lock release edge cases during disconnect ---

describe('Lock release edge cases during disconnect', () => {
  const team = () => getTeam('ws-close-lock-edge');
  const agent1 = 'cursor:ws-cle1';
  const agent2 = 'claude:ws-cle2';
  const owner1 = 'user-ws-cle1';
  const owner2 = 'user-ws-cle2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('release all with no locks held is a no-op', async () => {
    const res = await team().releaseFiles(agent1, null, owner1);
    expect(res.ok).toBe(true);
  });

  it('release all releases only this agent locks, not others', async () => {
    // Both claim different files
    await team().claimFiles(agent1, ['src/alice.js'], 'alice', 'cursor', owner1);
    await team().claimFiles(agent2, ['src/bob.js'], 'bob', 'claude', owner2);

    // Agent1 disconnects (release all)
    await team().releaseFiles(agent1, null, owner1);

    // Agent1's file is free, agent2's is still locked
    const claim1 = await team().claimFiles(agent2, ['src/alice.js'], 'bob', 'claude', owner2);
    expect(claim1.claimed).toContain('src/alice.js');

    // Agent2's lock is still held
    const locks = await team().getLockedFiles(agent2, owner2);
    expect(locks.locks.some((l) => l.file_path === 'src/bob.js')).toBe(true);
  });

  it('claiming after disconnect release succeeds for any agent', async () => {
    // Clean up: release everything
    await team().releaseFiles(agent2, null, owner2);

    // Agent1 claims and then "disconnects"
    await team().claimFiles(agent1, ['src/recover.js'], 'alice', 'cursor', owner1);
    await team().releaseFiles(agent1, null, owner1);

    // Agent2 can immediately claim
    const claim = await team().claimFiles(agent2, ['src/recover.js'], 'bob', 'claude', owner2);
    expect(claim.claimed).toContain('src/recover.js');
    expect(claim.blocked).toHaveLength(0);
  });
});

// --- Session interaction with WebSocket lifecycle ---

describe('Session interaction with WebSocket lifecycle', () => {
  const team = () => getTeam('ws-session-lifecycle');
  const agentId = 'cursor:ws-sess1';
  const ownerId = 'user-ws-sess1';

  it('setup: join and start session', async () => {
    const joinRes = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(joinRes.ok).toBe(true);
  });

  it('session started during WS connection records edits correctly', async () => {
    const sess = await team().startSession(agentId, 'alice', 'react', null, ownerId);
    expect(sess.ok).toBe(true);

    // Simulate file edits that would be reported via WS
    const edit1 = await team().recordEdit(agentId, 'src/component.tsx', 0, 0, ownerId);
    expect(edit1.ok).toBe(true);
    expect(edit1.skipped).toBeUndefined();

    const edit2 = await team().recordEdit(agentId, 'src/hook.ts', 0, 0, ownerId);
    expect(edit2.ok).toBe(true);

    // Session reflects the edits
    const history = await team().getHistory(agentId, 1, ownerId);
    const session = history.sessions.find((s) => s.owner_handle === 'alice');
    expect(session.edit_count).toBe(2);
    expect(session.files_touched).toContain('src/component.tsx');
    expect(session.files_touched).toContain('src/hook.ts');

    await team().endSession(agentId, sess.session_id, ownerId);
  });

  it('leave does not auto-end session (session stays for history)', async () => {
    const sess = await team().startSession(agentId, 'alice', 'react', null, ownerId);
    expect(sess.ok).toBe(true);

    // Agent disconnects (simulated by leave)
    await team().leave(agentId, ownerId);

    // Rejoin to check history
    await team().join(agentId, ownerId, 'alice', 'cursor');

    // Session history should still have the session
    const history = await team().getHistory(agentId, 1, ownerId);
    expect(history.sessions.length).toBeGreaterThanOrEqual(1);
  });
});
