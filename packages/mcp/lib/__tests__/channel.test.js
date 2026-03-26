import { describe, it, expect, beforeEach } from 'vitest';
import { diffState } from '../diff-state.js';

// --- Tests ---

describe('diffState', () => {
  let stucknessAlerted;

  beforeEach(() => {
    stucknessAlerted = new Map();
  });

  // -- Agent join/disconnect --

  describe('agent join and disconnect', () => {
    it('detects a new agent joining', () => {
      const prev = { members: [] };
      const curr = { members: [{ handle: 'alice', agent_id: 'cursor:abc123' }] };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['Agent alice joined the team']);
    });

    it('includes activity info when a joining agent has files', () => {
      const prev = { members: [] };
      const curr = {
        members: [{
          handle: 'alice',
          agent_id: 'cursor:abc123',
          tool: 'cursor',
          activity: { files: ['src/index.js', 'src/utils.js'] },
        }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['Agent alice (cursor) joined the team — working on src/index.js, src/utils.js']);
    });

    it('detects an agent disconnecting', () => {
      const prev = { members: [{ handle: 'bob', agent_id: 'aider:def456', tool: 'aider' }] };
      const curr = { members: [] };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['Agent bob (aider) disconnected']);
    });

    it('detects join and disconnect simultaneously', () => {
      const prev = { members: [{ handle: 'bob', agent_id: 'a1' }] };
      const curr = { members: [{ handle: 'alice', agent_id: 'a2' }] };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toContain('Agent alice joined the team');
      expect(events).toContain('Agent bob disconnected');
    });

    it('uses agent_id as key when present, handle as fallback', () => {
      const prev = { members: [{ handle: 'alice', agent_id: 'id1' }] };
      // Same handle, different agent_id => treated as different agent
      const curr = { members: [{ handle: 'alice', agent_id: 'id2' }] };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toContain('Agent alice joined the team');
      expect(events).toContain('Agent alice disconnected');
    });
  });

  // -- File activity changes --

  describe('file activity changes', () => {
    it('detects when an existing agent starts editing new files', () => {
      const prev = {
        members: [{ handle: 'alice', agent_id: 'a1', activity: { files: ['a.js'] } }],
      };
      const curr = {
        members: [{ handle: 'alice', agent_id: 'a1', activity: { files: ['a.js', 'b.js'] } }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['alice started editing b.js']);
    });

    it('does not emit for files the agent was already editing', () => {
      const prev = {
        members: [{ handle: 'alice', agent_id: 'a1', activity: { files: ['a.js'] } }],
      };
      const curr = {
        members: [{ handle: 'alice', agent_id: 'a1', activity: { files: ['a.js'] } }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual([]);
    });

    it('does not emit file activity for newly joined agents (handled by join event)', () => {
      const prev = { members: [] };
      const curr = {
        members: [{ handle: 'alice', agent_id: 'a1', activity: { files: ['a.js'] } }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      // Should only have a join event, not a file activity event
      expect(events.length).toBe(1);
      expect(events[0]).toMatch(/joined the team/);
    });

    it('handles agent going from no activity to having activity', () => {
      const prev = {
        members: [{ handle: 'alice', agent_id: 'a1' }],
      };
      const curr = {
        members: [{ handle: 'alice', agent_id: 'a1', activity: { files: ['new.js'] } }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['alice started editing new.js']);
    });

    it('handles agent with activity going to no activity (no event)', () => {
      const prev = {
        members: [{ handle: 'alice', agent_id: 'a1', activity: { files: ['old.js'] } }],
      };
      const curr = {
        members: [{ handle: 'alice', agent_id: 'a1' }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      // No events for removed files (not a tracked event)
      expect(events).toEqual([]);
    });

    it('includes tool label in file activity events', () => {
      const prev = {
        members: [{ handle: 'alice', agent_id: 'a1', tool: 'cursor', activity: { files: [] } }],
      };
      const curr = {
        members: [{ handle: 'alice', agent_id: 'a1', tool: 'cursor', activity: { files: ['x.ts'] } }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['alice (cursor) started editing x.ts']);
    });
  });

  // -- Conflict detection --

  describe('conflict detection', () => {
    it('detects a new conflict when two active agents edit the same file', () => {
      const prev = {
        members: [
          { handle: 'alice', agent_id: 'a1', status: 'active', activity: { files: ['shared.js'] } },
          { handle: 'bob', agent_id: 'a2', status: 'active', activity: { files: ['other.js'] } },
        ],
      };
      const curr = {
        members: [
          { handle: 'alice', agent_id: 'a1', status: 'active', activity: { files: ['shared.js'] } },
          { handle: 'bob', agent_id: 'a2', status: 'active', activity: { files: ['shared.js'] } },
        ],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events.some(e => e.startsWith('CONFLICT:') && e.includes('shared.js'))).toBe(true);
    });

    it('does not re-emit a conflict that already existed in previous state', () => {
      const members = [
        { handle: 'alice', agent_id: 'a1', status: 'active', activity: { files: ['shared.js'] } },
        { handle: 'bob', agent_id: 'a2', status: 'active', activity: { files: ['shared.js'] } },
      ];
      const prev = { members };
      const curr = { members };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events.filter(e => e.startsWith('CONFLICT:'))).toEqual([]);
    });

    it('ignores inactive agents for conflict detection', () => {
      const prev = {
        members: [
          { handle: 'alice', agent_id: 'a1', status: 'active', activity: { files: ['shared.js'] } },
          { handle: 'bob', agent_id: 'a2', status: 'idle', activity: { files: ['other.js'] } },
        ],
      };
      const curr = {
        members: [
          { handle: 'alice', agent_id: 'a1', status: 'active', activity: { files: ['shared.js'] } },
          { handle: 'bob', agent_id: 'a2', status: 'idle', activity: { files: ['shared.js'] } },
        ],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events.filter(e => e.startsWith('CONFLICT:'))).toEqual([]);
    });

    it('ignores agents without activity for conflict detection', () => {
      const prev = {
        members: [
          { handle: 'alice', agent_id: 'a1', status: 'active', activity: { files: ['shared.js'] } },
          { handle: 'bob', agent_id: 'a2', status: 'active' },
        ],
      };
      const curr = {
        members: [
          { handle: 'alice', agent_id: 'a1', status: 'active', activity: { files: ['shared.js'] } },
          { handle: 'bob', agent_id: 'a2', status: 'active' },
        ],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events.filter(e => e.startsWith('CONFLICT:'))).toEqual([]);
    });
  });

  // -- Stuckness detection --

  describe('stuckness detection', () => {
    it('alerts when an agent has been on the same task longer than 15 minutes (server-computed)', () => {
      const prev = { members: [] };
      const curr = {
        members: [{
          handle: 'alice',
          agent_id: 'a1',
          status: 'active',
          activity: { files: ['stuck.js'], updated_at: '2026-01-01T00:00:00Z' },
          minutes_since_update: 20,
        }],
      };
      // alice is new, so join event fires; but stuckness should also fire
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events.some(e => e.includes('may be stuck') && e.includes('20 min'))).toBe(true);
    });

    it('does not alert for agents active less than 15 minutes', () => {
      const prev = { members: [] };
      const curr = {
        members: [{
          handle: 'alice',
          agent_id: 'a1',
          status: 'active',
          activity: { files: ['fine.js'], updated_at: '2026-01-01T00:00:00Z' },
          minutes_since_update: 10,
        }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events.some(e => e.includes('may be stuck'))).toBe(false);
    });

    it('deduplicates stuckness alerts (same updated_at = no repeat)', () => {
      const member = {
        handle: 'alice',
        agent_id: 'a1',
        status: 'active',
        activity: { files: ['stuck.js'], updated_at: '2026-01-01T00:00:00Z' },
        minutes_since_update: 20,
      };
      const prev = { members: [member] };
      const curr = { members: [member] };

      // First diff should alert
      const events1 = diffState(prev, curr, stucknessAlerted);
      expect(events1.some(e => e.includes('may be stuck'))).toBe(true);

      // Second diff with same state should NOT alert (dedup)
      const events2 = diffState(curr, curr, stucknessAlerted);
      expect(events2.some(e => e.includes('may be stuck'))).toBe(false);
    });

    it('re-alerts after activity updates (updated_at changes)', () => {
      const member1 = {
        handle: 'alice',
        agent_id: 'a1',
        status: 'active',
        activity: { files: ['stuck.js'], updated_at: '2026-01-01T00:00:00Z' },
        minutes_since_update: 20,
      };
      const state1 = { members: [member1] };

      diffState(state1, state1, stucknessAlerted);
      expect(stucknessAlerted.has('a1')).toBe(true);

      // Activity updated — different updated_at, still stuck
      const member2 = {
        ...member1,
        activity: { files: ['stuck.js'], updated_at: '2026-01-01T00:20:00Z' },
        minutes_since_update: 25,
      };
      const state2 = { members: [member2] };
      const events = diffState(state1, state2, stucknessAlerted);
      expect(events.some(e => e.includes('may be stuck'))).toBe(true);
    });

    it('clears stuckness alert when agent disconnects', () => {
      const member = {
        handle: 'alice',
        agent_id: 'a1',
        status: 'active',
        activity: { files: ['stuck.js'], updated_at: '2026-01-01T00:00:00Z' },
        minutes_since_update: 20,
      };
      const prev = { members: [member] };
      diffState(prev, prev, stucknessAlerted);
      expect(stucknessAlerted.has('a1')).toBe(true);

      // Agent disconnects
      diffState(prev, { members: [] }, stucknessAlerted);
      expect(stucknessAlerted.has('a1')).toBe(false);
    });

    it('does not alert for inactive agents even if minutes_since_update is high', () => {
      const prev = { members: [] };
      const curr = {
        members: [{
          handle: 'alice',
          agent_id: 'a1',
          status: 'idle',
          activity: { files: ['idle.js'], updated_at: '2026-01-01T00:00:00Z' },
          minutes_since_update: 60,
        }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events.some(e => e.includes('may be stuck'))).toBe(false);
    });

    it('falls back to Date.now calculation when minutes_since_update is null', () => {
      // Set updated_at to 30 minutes ago
      const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
      const prev = { members: [] };
      const curr = {
        members: [{
          handle: 'alice',
          agent_id: 'a1',
          status: 'active',
          activity: { files: ['old.js'], updated_at: thirtyMinAgo },
          // no minutes_since_update
        }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events.some(e => e.includes('may be stuck'))).toBe(true);
    });
  });

  // -- New memories --

  describe('memories', () => {
    it('detects new memories by id', () => {
      const prev = { memories: [{ id: 'm1', text: 'old', category: 'gotcha' }] };
      const curr = {
        memories: [
          { id: 'm1', text: 'old', category: 'gotcha' },
          { id: 'm2', text: 'Redis needed on port 6379', category: 'config' },
        ],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['New team knowledge: [config] Redis needed on port 6379']);
    });

    it('detects new memories by text when id is missing', () => {
      const prev = { memories: [{ text: 'old fact', category: 'pattern' }] };
      const curr = {
        memories: [
          { text: 'old fact', category: 'pattern' },
          { text: 'new fact', category: 'decision' },
        ],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['New team knowledge: [decision] new fact']);
    });

    it('does not emit for memories that existed before', () => {
      const mems = [{ id: 'm1', text: 'same', category: 'gotcha' }];
      const events = diffState({ memories: mems }, { memories: mems }, stucknessAlerted);
      expect(events).toEqual([]);
    });
  });

  // -- Lock changes --

  describe('lock changes', () => {
    it('detects new locks', () => {
      const prev = { locks: [] };
      const curr = {
        locks: [{ file_path: 'auth.js', owner_handle: 'alice', tool: 'cursor' }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['alice (cursor) locked auth.js']);
    });

    it('detects released locks', () => {
      const prev = {
        locks: [{ file_path: 'auth.js', owner_handle: 'alice', tool: 'cursor' }],
      };
      const curr = { locks: [] };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['alice (cursor) released lock on auth.js']);
    });

    it('omits tool label when tool is "unknown"', () => {
      const prev = { locks: [] };
      const curr = {
        locks: [{ file_path: 'auth.js', owner_handle: 'alice', tool: 'unknown' }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['alice locked auth.js']);
    });

    it('omits tool label when tool is missing', () => {
      const prev = { locks: [] };
      const curr = {
        locks: [{ file_path: 'auth.js', owner_handle: 'alice' }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['alice locked auth.js']);
    });

    it('does not emit when locks are unchanged', () => {
      const locks = [{ file_path: 'auth.js', owner_handle: 'alice', tool: 'cursor' }];
      const events = diffState({ locks }, { locks }, stucknessAlerted);
      expect(events).toEqual([]);
    });
  });

  // -- New messages --

  describe('messages', () => {
    it('detects new messages', () => {
      const prev = { messages: [] };
      const curr = {
        messages: [{ from_handle: 'bob', from_tool: 'aider', text: 'Rebased!', created_at: '2026-01-01T00:00:00Z' }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['Message from bob (aider): Rebased!']);
    });

    it('does not emit for messages that existed before', () => {
      const msgs = [{ from_handle: 'bob', from_tool: 'aider', text: 'Hi', created_at: '2026-01-01T00:00:00Z' }];
      const events = diffState({ messages: msgs }, { messages: msgs }, stucknessAlerted);
      expect(events).toEqual([]);
    });

    it('omits tool when from_tool is "unknown"', () => {
      const prev = { messages: [] };
      const curr = {
        messages: [{ from_handle: 'bob', from_tool: 'unknown', text: 'Hi', created_at: '2026-01-01T00:00:00Z' }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual(['Message from bob: Hi']);
    });
  });

  // -- Edge cases --

  describe('edge cases', () => {
    it('returns empty array when both states are identical', () => {
      const state = {
        members: [{ handle: 'alice', agent_id: 'a1', status: 'active', activity: { files: ['a.js'] } }],
        memories: [{ id: 'm1', text: 'fact', category: 'gotcha' }],
        locks: [{ file_path: 'b.js', owner_handle: 'alice', tool: 'cursor' }],
        messages: [{ from_handle: 'alice', text: 'hi', created_at: 't1' }],
      };
      const events = diffState(state, state, stucknessAlerted);
      expect(events).toEqual([]);
    });

    it('handles empty states', () => {
      const events = diffState({}, {}, stucknessAlerted);
      expect(events).toEqual([]);
    });

    it('handles null/undefined fields gracefully', () => {
      const prev = { members: null, memories: undefined, locks: null, messages: undefined };
      const curr = { members: undefined, memories: null, locks: undefined, messages: null };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events).toEqual([]);
    });

    it('handles transition from empty state to populated state', () => {
      const prev = {};
      const curr = {
        members: [{ handle: 'alice', agent_id: 'a1', tool: 'cursor' }],
        memories: [{ id: 'm1', text: 'note', category: 'config' }],
        locks: [{ file_path: 'x.js', owner_handle: 'alice', tool: 'cursor' }],
        messages: [{ from_handle: 'alice', from_tool: 'cursor', text: 'hey', created_at: 't1' }],
      };
      const events = diffState(prev, curr, stucknessAlerted);
      expect(events.length).toBe(4);
      expect(events[0]).toMatch(/joined the team/);
      expect(events[1]).toMatch(/New team knowledge/);
      expect(events[2]).toMatch(/locked/);
      expect(events[3]).toMatch(/Message from/);
    });

    it('handles transition from populated state to empty state', () => {
      const prev = {
        members: [{ handle: 'alice', agent_id: 'a1', tool: 'cursor' }],
        memories: [{ id: 'm1', text: 'note', category: 'config' }],
        locks: [{ file_path: 'x.js', owner_handle: 'alice', tool: 'cursor' }],
        messages: [{ from_handle: 'alice', text: 'hey', created_at: 't1' }],
      };
      const curr = {};
      const events = diffState(prev, curr, stucknessAlerted);
      // Agent disconnect + lock released (memories/messages disappearing doesn't emit)
      expect(events.some(e => e.includes('disconnected'))).toBe(true);
      expect(events.some(e => e.includes('released lock'))).toBe(true);
    });
  });
});
