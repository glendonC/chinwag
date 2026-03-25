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
    expect(res).toEqual({ error: 'Not a member of this team' });
  });

  it('leave removes member', async () => {
    const res = await team().leave(agentId);
    expect(res).toEqual({ ok: true });
    // Heartbeat should now fail
    const hb = await team().heartbeat(agentId);
    expect(hb.error).toBeTruthy();
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
    const res = await team().saveMemory(agentId, 'Always run tests before deploying', 'pattern', 'alice', ownerId);
    expect(res.ok).toBe(true);
    expect(res.id).toBeDefined();
    savedMemoryId = res.id;
  });

  it('searchMemories finds saved memory', async () => {
    const res = await team().searchMemories(agentId, 'tests before deploying', null, 10, ownerId);
    expect(res.memories.length).toBeGreaterThan(0);
    expect(res.memories[0].text).toContain('Always run tests before deploying');
  });

  it('searchMemories filters by category', async () => {
    const res = await team().searchMemories(agentId, null, 'pattern', 10, ownerId);
    expect(res.memories.length).toBeGreaterThan(0);
    expect(res.memories.every(m => m.category === 'pattern')).toBe(true);
  });

  it('deleteMemory removes memory', async () => {
    const res = await team().deleteMemory(agentId, savedMemoryId, ownerId);
    expect(res.ok).toBe(true);

    // Searching should no longer find it
    const search = await team().searchMemories(agentId, 'Always run tests before deploying', null, 10, ownerId);
    expect(search.memories.length).toBe(0);
  });

  it('fuzzy dedup: saving similar text returns matched_id', async () => {
    // Save original
    const first = await team().saveMemory(agentId, 'The database connection pool should be sized at 10', 'config', 'alice', ownerId);
    expect(first.ok).toBe(true);
    expect(first.id).toBeDefined();

    // Save very similar text (>70% word overlap)
    const second = await team().saveMemory(agentId, 'The database connection pool should be sized at 10 connections', 'config', 'alice', ownerId);
    expect(second.ok).toBe(true);
    expect(second.deduplicated).toBe(true);
    expect(second.matched_id).toBe(first.id);
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
    expect(res.messages[0].from_handle).toBe('alice');
    expect(res.messages[0].from_tool).toBe('cursor');
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
    const session = history.sessions.find(s => s.owner_handle === 'alice');
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
