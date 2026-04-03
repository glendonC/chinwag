import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id = 'test-team') {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// --- Membership ---

describe('Membership', () => {
  const team = () => getTeam('membership-tests');
  const agentId = 'cursor:agent-m1';
  const ownerId = 'user-m1';

  it('join returns ok', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res).toEqual({ ok: true });
  });

  it('heartbeat succeeds for member', async () => {
    const res = await team().heartbeat(agentId);
    expect(res).toEqual({ ok: true });
  });

  it('heartbeat fails for non-member', async () => {
    const res = await team().heartbeat('cursor:nonexistent');
    expect(res).toEqual({ error: 'Not a member of this team', code: 'NOT_MEMBER' });
  });

  it('leave removes member', async () => {
    const res = await team().leave(agentId);
    expect(res).toEqual({ ok: true });
    // Heartbeat should now fail
    const hb = await team().heartbeat(agentId);
    expect(hb.error).toBeTruthy();
  });

  it('persists structured runtime metadata across all entities', async () => {
    const runtimeTeam = () => getTeam('membership-runtime-tests');
    const runtimeAgent = 'cursor:runtime-m1';
    const runtimeOwner = 'user-runtime-m1';

    const joinRes = await runtimeTeam().join(runtimeAgent, runtimeOwner, 'alice', {
      hostTool: 'cursor',
      agentSurface: 'cline',
      transport: 'mcp',
      tier: 'connected',
    });
    expect(joinRes.ok).toBe(true);

    const sessionRes = await runtimeTeam().startSession(
      runtimeAgent,
      'alice',
      'react',
      {
        hostTool: 'cursor',
        agentSurface: 'cline',
        transport: 'mcp',
        tier: 'connected',
      },
      runtimeOwner,
    );
    expect(sessionRes.ok).toBe(true);

    const memoryRes = await runtimeTeam().saveMemory(
      runtimeAgent,
      'Structured runtime memory',
      ['runtime'],
      'alice',
      { hostTool: 'cursor', agentSurface: 'cline', transport: 'mcp', tier: 'connected' },
      runtimeOwner,
    );
    expect(memoryRes.ok).toBe(true);

    const messageRes = await runtimeTeam().sendMessage(
      runtimeAgent,
      'alice',
      { hostTool: 'cursor', agentSurface: 'cline', transport: 'mcp', tier: 'connected' },
      'Runtime hello',
      null,
      runtimeOwner,
    );
    expect(messageRes.ok).toBe(true);

    const lockRes = await runtimeTeam().claimFiles(
      runtimeAgent,
      ['src/runtime.js'],
      'alice',
      { hostTool: 'cursor', agentSurface: 'cline', transport: 'mcp', tier: 'connected' },
      runtimeOwner,
    );
    expect(lockRes.ok).toBe(true);

    const ctx = await runtimeTeam().getContext(runtimeAgent, runtimeOwner);
    const me = ctx.members.find((m) => m.agent_id === runtimeAgent);
    expect(me.host_tool).toBe('cursor');
    expect(me.agent_surface).toBe('cline');
    expect(me.transport).toBe('mcp');

    expect(ctx.memories[0].host_tool).toBe('cursor');
    expect(ctx.memories[0].source_agent_surface).toBe('cline');

    expect(ctx.messages[0].from_host_tool).toBe('cursor');
    expect(ctx.messages[0].from_agent_surface).toBe('cline');

    expect(ctx.locks[0].host_tool).toBe('cursor');
    expect(ctx.locks[0].agent_surface).toBe('cline');

    const session = ctx.recentSessions.find((s) => s.agent_id === runtimeAgent);
    expect(session.host_tool).toBe('cursor');
    expect(session.agent_surface).toBe('cline');
    expect(session.transport).toBe('mcp');

    const summary = await runtimeTeam().getSummary(runtimeOwner);
    expect(summary.hosts_configured.some((item) => item.host_tool === 'cursor')).toBe(true);
    expect(summary.surfaces_seen.some((item) => item.agent_surface === 'cline')).toBe(true);
  });
});

// --- Ownership verification ---

describe('Ownership verification', () => {
  const team = () => getTeam('ownership-tests');
  const agentId = 'cursor:aaa';
  const ownerId = 'userA';

  it('setup: join as userA', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('getContext rejects spoofed agent (wrong owner)', async () => {
    const res = await team().getContext('cursor:bbb', 'userB');
    expect(res.error).toBeTruthy();
  });

  it('getContext succeeds for correct owner', async () => {
    const res = await team().getContext(agentId, ownerId);
    expect(res.error).toBeUndefined();
    expect(res.members).toBeDefined();
  });
});

// --- Activity & Conflicts ---

describe('Activity & Conflicts', () => {
  const team = () => getTeam('activity-tests');
  const agent1 = 'cursor:act1';
  const agent2 = 'claude:act2';
  const owner1 = 'user-act1';
  const owner2 = 'user-act2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('updateActivity stores activity', async () => {
    const res = await team().updateActivity(agent1, ['src/index.js'], 'Editing index', owner1);
    expect(res).toEqual({ ok: true });
  });

  it('two agents on same file produces conflict', async () => {
    await team().updateActivity(agent1, ['src/shared.js'], 'Editing shared', owner1);
    await team().updateActivity(agent2, ['src/shared.js'], 'Also editing shared', owner2);

    const res = await team().checkConflicts(agent1, ['src/shared.js'], owner1);
    expect(res.conflicts.length).toBeGreaterThan(0);
    expect(res.conflicts[0].files).toContain('src/shared.js');
  });

  it('two agents on different files produces no conflict', async () => {
    await team().updateActivity(agent1, ['src/a.js'], 'File A', owner1);
    await team().updateActivity(agent2, ['src/b.js'], 'File B', owner2);

    const res = await team().checkConflicts(agent1, ['src/a.js'], owner1);
    expect(res.conflicts.length).toBe(0);
  });
});

// --- Locks ---

describe('Locks', () => {
  const team = () => getTeam('locks-tests');
  const agent1 = 'cursor:lock1';
  const agent2 = 'claude:lock2';
  const owner1 = 'user-lock1';
  const owner2 = 'user-lock2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('claimFiles returns claimed files', async () => {
    const res = await team().claimFiles(agent1, ['src/main.js'], 'alice', 'cursor', owner1);
    expect(res.ok).toBe(true);
    expect(res.claimed).toContain('src/main.js');
    expect(res.blocked).toHaveLength(0);
  });

  it('another agent claiming same file is blocked', async () => {
    const res = await team().claimFiles(agent2, ['src/main.js'], 'bob', 'claude', owner2);
    expect(res.blocked.length).toBeGreaterThan(0);
    expect(res.blocked[0].file).toBe('src/main.js');
    expect(res.blocked[0].held_by).toBe('alice');
    expect(res.claimed).toHaveLength(0);
  });

  it('releaseFiles frees the lock', async () => {
    const rel = await team().releaseFiles(agent1, ['src/main.js'], owner1);
    expect(rel.ok).toBe(true);

    // Now agent2 can claim it
    const res = await team().claimFiles(agent2, ['src/main.js'], 'bob', 'claude', owner2);
    expect(res.claimed).toContain('src/main.js');
    expect(res.blocked).toHaveLength(0);
  });
});

// --- Memory ---

describe('Memory', () => {
  const team = () => getTeam('memory-tests');
  const agentId = 'cursor:mem1';
  const ownerId = 'user-mem1';
  let savedMemoryId;

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('saveMemory returns ok with id', async () => {
    const res = await team().saveMemory(
      agentId,
      'Always run tests before deploying',
      ['pattern'],
      'alice',
      ownerId,
    );
    expect(res.ok).toBe(true);
    expect(res.id).toBeDefined();
    savedMemoryId = res.id;
  });

  it('searchMemories finds saved memory', async () => {
    const res = await team().searchMemories(agentId, 'tests before deploying', null, 10, ownerId);
    expect(res.memories.length).toBeGreaterThan(0);
    expect(res.memories[0].text).toContain('Always run tests before deploying');
  });

  it('searchMemories filters by tags', async () => {
    const res = await team().searchMemories(agentId, null, ['pattern'], 10, ownerId);
    expect(res.memories.length).toBeGreaterThan(0);
    expect(res.memories.every((m) => m.tags.includes('pattern'))).toBe(true);
  });

  it('deleteMemory removes memory', async () => {
    const res = await team().deleteMemory(agentId, savedMemoryId, ownerId);
    expect(res.ok).toBe(true);

    // Searching should no longer find it
    const search = await team().searchMemories(
      agentId,
      'Always run tests before deploying',
      null,
      10,
      ownerId,
    );
    expect(search.memories.length).toBe(0);
  });

  it('saves similar text as separate entries (no dedup)', async () => {
    // Save original
    const first = await team().saveMemory(
      agentId,
      'The database connection pool should be sized at 10',
      ['config'],
      'alice',
      ownerId,
    );
    expect(first.ok).toBe(true);
    expect(first.id).toBeDefined();

    // Save very similar text — both should succeed as separate entries
    const second = await team().saveMemory(
      agentId,
      'The database connection pool should be sized at 10 connections',
      ['config'],
      'alice',
      ownerId,
    );
    expect(second.ok).toBe(true);
    expect(second.id).toBeDefined();
    expect(second.id).not.toBe(first.id);
  });
});

// --- Messages ---

describe('Messages', () => {
  const team = () => getTeam('messages-tests');
  const agentId = 'cursor:msg1';
  const ownerId = 'user-msg1';

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('sendMessage returns ok', async () => {
    const res = await team().sendMessage(agentId, 'alice', 'cursor', 'Hello team!', null, ownerId);
    expect(res.ok).toBe(true);
    expect(res.id).toBeDefined();
  });

  it('getMessages returns the sent message', async () => {
    const res = await team().getMessages(agentId, null, ownerId);
    expect(res.messages.length).toBeGreaterThan(0);
    expect(res.messages[0].text).toBe('Hello team!');
    expect(res.messages[0].handle).toBe('alice');
    expect(res.messages[0].host_tool).toBe('cursor');
  });
});

// --- Sessions ---

describe('Sessions', () => {
  const team = () => getTeam('sessions-tests');
  const agentId = 'cursor:sess1';
  const ownerId = 'user-sess1';
  let sessionId;

  it('setup: join', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('startSession returns session_id', async () => {
    const res = await team().startSession(agentId, 'alice', 'react', ownerId);
    expect(res.ok).toBe(true);
    expect(res.session_id).toBeDefined();
    sessionId = res.session_id;
  });

  it('recordEdit increments edit count', async () => {
    const res = await team().recordEdit(agentId, 'src/app.js', ownerId);
    expect(res.ok).toBe(true);
    expect(res.skipped).toBeUndefined();

    // Record another edit on the same file
    const res2 = await team().recordEdit(agentId, 'src/app.js', ownerId);
    expect(res2.ok).toBe(true);

    // Verify via getHistory
    const history = await team().getHistory(agentId, 1, ownerId);
    const session = history.sessions.find((s) => s.owner_handle === 'alice');
    expect(session).toBeDefined();
    expect(session.edit_count).toBe(2);
    expect(session.files_touched).toContain('src/app.js');
  });

  it('endSession marks session ended', async () => {
    const res = await team().endSession(agentId, sessionId, ownerId);
    expect(res.ok).toBe(true);
  });

  it('endSession fails for already-ended session', async () => {
    const res = await team().endSession(agentId, sessionId, ownerId);
    expect(res.error).toBeTruthy();
  });
});

// --- Session lifecycle edge cases ---

describe('Session lifecycle — edge cases', () => {
  const team = () => getTeam('session-edge-cases');
  const agentId = 'cursor:se1';
  const ownerId = 'user-se1';

  it('setup: join', async () => {
    const res = await team().join(agentId, ownerId, 'alice', 'cursor');
    expect(res.ok).toBe(true);
  });

  it('full lifecycle: start → heartbeat → recordEdit → end', async () => {
    const s = await team().startSession(agentId, 'alice', 'react', ownerId);
    expect(s.ok).toBe(true);
    expect(s.session_id).toBeDefined();

    const hb = await team().heartbeat(agentId);
    expect(hb.ok).toBe(true);

    const edit = await team().recordEdit(agentId, 'src/lifecycle.js', ownerId);
    expect(edit.ok).toBe(true);
    expect(edit.skipped).toBeUndefined();

    const end = await team().endSession(agentId, s.session_id, ownerId);
    expect(end.ok).toBe(true);
  });

  it('heartbeat for non-existent agent returns error', async () => {
    const res = await team().heartbeat('cursor:does-not-exist');
    expect(res.error).toBeTruthy();
    expect(res.error).toContain('Not a member');
  });

  it('duplicate session start auto-closes previous session', async () => {
    const s1 = await team().startSession(agentId, 'alice', 'react', ownerId);
    expect(s1.ok).toBe(true);

    const s2 = await team().startSession(agentId, 'alice', 'next', ownerId);
    expect(s2.ok).toBe(true);
    expect(s2.session_id).not.toBe(s1.session_id);

    // s1 should be auto-closed, can't end it again
    const end1 = await team().endSession(agentId, s1.session_id, ownerId);
    expect(end1.error).toBeTruthy();

    // s2 should still be active
    const end2 = await team().endSession(agentId, s2.session_id, ownerId);
    expect(end2.ok).toBe(true);
  });

  it('endSession with wrong session_id returns error', async () => {
    const s = await team().startSession(agentId, 'alice', 'react', ownerId);
    expect(s.ok).toBe(true);

    const res = await team().endSession(agentId, 'nonexistent-session-id', ownerId);
    expect(res.error).toBeTruthy();
  });

  it('recordEdit without active session returns skipped', async () => {
    // End any existing session first
    const s = await team().startSession(agentId, 'alice', 'react', ownerId);
    await team().endSession(agentId, s.session_id, ownerId);

    const edit = await team().recordEdit(agentId, 'src/no-session.js', ownerId);
    expect(edit.ok).toBe(true);
    expect(edit.skipped).toBe(true);
  });
});

// --- Membership cleanup on leave ---

describe('Leave cleans up locks and activities', () => {
  const team = () => getTeam('leave-cleanup');
  const agentId = 'cursor:lc1';
  const ownerId = 'user-lc1';
  const otherAgent = 'claude:lc2';
  const otherOwner = 'user-lc2';

  it('setup: join, claim files, update activity', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().join(otherAgent, otherOwner, 'bob', 'claude');

    const claim = await team().claimFiles(agentId, ['src/cleanup.js'], 'alice', 'cursor', ownerId);
    expect(claim.ok).toBe(true);
    expect(claim.claimed).toContain('src/cleanup.js');

    await team().updateActivity(agentId, ['src/cleanup.js'], 'Working on cleanup', ownerId);
  });

  it('leaving releases locks so others can claim', async () => {
    await team().leave(agentId, ownerId);

    // Other agent should now be able to claim the file
    const claim = await team().claimFiles(
      otherAgent,
      ['src/cleanup.js'],
      'bob',
      'claude',
      otherOwner,
    );
    expect(claim.claimed).toContain('src/cleanup.js');
    expect(claim.blocked).toHaveLength(0);
  });
});

// --- Lock path normalization consistency ---

describe('Lock path normalization consistency', () => {
  const team = () => getTeam('lock-normalization');
  const agent1 = 'cursor:ln1';
  const agent2 = 'claude:ln2';
  const owner1 = 'user-ln1';
  const owner2 = 'user-ln2';

  it('setup: join two agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('claims ./src/api.js and blocks src/api.js (same file after normalization)', async () => {
    const claim1 = await team().claimFiles(agent1, ['./src/api.js'], 'alice', 'cursor', owner1);
    expect(claim1.claimed).toContain('src/api.js'); // normalized

    const claim2 = await team().claimFiles(agent2, ['src/api.js'], 'bob', 'claude', owner2);
    expect(claim2.claimed).toHaveLength(0);
    expect(claim2.blocked).toHaveLength(1);
    expect(claim2.blocked[0].file).toBe('src/api.js');
  });

  it('releases with different path format still works', async () => {
    const rel = await team().releaseFiles(agent1, ['./src/api.js'], owner1);
    expect(rel.ok).toBe(true);

    // Now agent2 can claim it
    const claim = await team().claimFiles(agent2, ['src/api.js'], 'bob', 'claude', owner2);
    expect(claim.claimed).toContain('src/api.js');
  });

  it('conflicting paths with // normalize to same file', async () => {
    await team().releaseFiles(agent2, null, owner2); // release all

    // Double slashes collapse: 'src//lib//utils.js' → 'src/lib/utils.js'
    const claim1 = await team().claimFiles(
      agent1,
      ['src//lib//utils.js'],
      'alice',
      'cursor',
      owner1,
    );
    expect(claim1.claimed).toContain('src/lib/utils.js');

    const claim2 = await team().claimFiles(agent2, ['src/lib/utils.js'], 'bob', 'claude', owner2);
    expect(claim2.blocked).toHaveLength(1);
    expect(claim2.blocked[0].file).toBe('src/lib/utils.js');
  });
});

// --- Conflict detection edge cases ---

describe('Conflict detection — edge cases', () => {
  const team = () => getTeam('conflict-edge');
  const agent1 = 'cursor:ce1';
  const agent2 = 'claude:ce2';
  const agent3 = 'windsurf:ce3';
  const owner1 = 'user-ce1';
  const owner2 = 'user-ce2';
  const owner3 = 'user-ce3';

  it('setup: join three agents', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
    await team().join(agent3, owner3, 'carol', 'windsurf');
  });

  it('no conflict when checking files nobody else touches', async () => {
    await team().updateActivity(agent1, ['src/unique-a.js'], 'Only me', owner1);
    const res = await team().checkConflicts(agent1, ['src/unique-a.js'], owner1);
    expect(res.conflicts).toHaveLength(0);
    expect(res.locked).toHaveLength(0);
  });

  it('three-way conflict: all three agents on same file', async () => {
    await team().updateActivity(agent1, ['src/shared.js'], 'Agent 1 editing', owner1);
    await team().updateActivity(agent2, ['src/shared.js'], 'Agent 2 editing', owner2);
    await team().updateActivity(agent3, ['src/shared.js'], 'Agent 3 editing', owner3);

    const res = await team().checkConflicts(agent1, ['src/shared.js'], owner1);
    expect(res.conflicts.length).toBe(2); // two others on same file
    const conflictHandles = res.conflicts.map((c) => c.owner_handle);
    expect(conflictHandles).toContain('bob');
    expect(conflictHandles).toContain('carol');
  });

  it('conflict detection with normalized paths: ./src/x.js vs src/x.js', async () => {
    await team().updateActivity(agent1, ['./src/norm.js'], 'Agent 1', owner1);
    await team().updateActivity(agent2, ['src/norm.js'], 'Agent 2', owner2);

    const res = await team().checkConflicts(agent1, ['src/norm.js'], owner1);
    expect(res.conflicts.length).toBeGreaterThan(0);
    expect(res.conflicts[0].files).toContain('src/norm.js');
  });

  it('checking empty file list returns no conflicts', async () => {
    const res = await team().checkConflicts(agent1, [], owner1);
    expect(res.conflicts).toHaveLength(0);
    expect(res.locked).toHaveLength(0);
  });

  it('non-member cannot check conflicts', async () => {
    const res = await team().checkConflicts('cursor:stranger', ['src/file.js'], 'bad-owner');
    expect(res.error).toContain('Not a member');
  });
});

// --- Lock release edge cases ---

describe('Lock release — edge cases', () => {
  const team = () => getTeam('lock-release-edge');
  const agent1 = 'cursor:lre1';
  const agent2 = 'claude:lre2';
  const owner1 = 'user-lre1';
  const owner2 = 'user-lre2';

  it('setup: join', async () => {
    await team().join(agent1, owner1, 'alice', 'cursor');
    await team().join(agent2, owner2, 'bob', 'claude');
  });

  it('releasing a file not held by this agent is a no-op (not an error)', async () => {
    // Claim with agent1
    await team().claimFiles(agent1, ['src/owned.js'], 'alice', 'cursor', owner1);

    // agent2 tries to release agent1's file — should succeed (no-op, not error)
    const res = await team().releaseFiles(agent2, ['src/owned.js'], owner2);
    expect(res.ok).toBe(true);

    // agent1's lock should still be in place
    const claim = await team().claimFiles(agent2, ['src/owned.js'], 'bob', 'claude', owner2);
    expect(claim.blocked).toHaveLength(1);
    expect(claim.blocked[0].held_by).toBe('alice');
  });

  it('releasing a file nobody holds is a no-op', async () => {
    const res = await team().releaseFiles(agent1, ['src/nonexistent-file.js'], owner1);
    expect(res.ok).toBe(true);
  });

  it('release all with null files releases all locks for the agent', async () => {
    await team().claimFiles(
      agent1,
      ['src/f1.js', 'src/f2.js', 'src/f3.js'],
      'alice',
      'cursor',
      owner1,
    );
    const res = await team().releaseFiles(agent1, null, owner1);
    expect(res.ok).toBe(true);

    // All should be claimable by agent2 now
    const claim = await team().claimFiles(
      agent2,
      ['src/f1.js', 'src/f2.js', 'src/f3.js'],
      'bob',
      'claude',
      owner2,
    );
    expect(claim.claimed).toHaveLength(3);
    expect(claim.blocked).toHaveLength(0);
  });
});
