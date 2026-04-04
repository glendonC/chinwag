import { describe, it, expect } from 'vitest';
import { diffState } from '../diff-state.js';

describe('diffState', () => {
  /** Shorthand for an active member with files. */
  function member(handle, files = [], opts = {}) {
    return {
      handle,
      agent_id: opts.agent_id || handle,
      tool: opts.tool,
      status: opts.status || 'active',
      activity:
        files.length > 0 || opts.summary
          ? { files, summary: opts.summary, updated_at: opts.updated_at }
          : opts.activity !== undefined
            ? opts.activity
            : null,
      minutes_since_update: opts.minutes_since_update ?? null,
    };
  }

  // --- New members ---

  describe('new members', () => {
    it('detects a single new member joining', () => {
      const prev = { members: [] };
      const curr = { members: [member('alice', [], { tool: 'cursor' })] };
      const events = diffState(prev, curr, new Map());
      expect(events).toContainEqual(expect.stringContaining('alice (cursor) joined the team'));
    });

    it('detects multiple new members joining', () => {
      const prev = { members: [] };
      const curr = {
        members: [member('alice', [], { tool: 'cursor' }), member('bob', [], { tool: 'claude' })],
      };
      const events = diffState(prev, curr, new Map());
      const joinEvents = events.filter((e) => e.includes('joined the team'));
      expect(joinEvents).toHaveLength(2);
    });

    it('includes file activity when new member has files', () => {
      const prev = { members: [] };
      const curr = { members: [member('alice', ['auth.js', 'db.js'])] };
      const events = diffState(prev, curr, new Map());
      expect(events[0]).toContain('working on auth.js, db.js');
    });

    it('does not include activity suffix when files are empty', () => {
      const prev = { members: [] };
      const curr = { members: [member('alice', [])] };
      const events = diffState(prev, curr, new Map());
      expect(events[0]).not.toContain('working on');
    });
  });

  // --- Departed members ---

  describe('departed members', () => {
    it('detects a member disconnecting', () => {
      const prev = { members: [member('alice', [], { tool: 'cursor' })] };
      const curr = { members: [] };
      const events = diffState(prev, curr, new Map());
      expect(events).toContainEqual(expect.stringContaining('alice (cursor) disconnected'));
    });

    it('detects multiple members disconnecting', () => {
      const prev = {
        members: [member('alice', [], { tool: 'cursor' }), member('bob', [], { tool: 'claude' })],
      };
      const curr = { members: [] };
      const events = diffState(prev, curr, new Map());
      const dcEvents = events.filter((e) => e.includes('disconnected'));
      expect(dcEvents).toHaveLength(2);
    });

    it('detects departure when other members remain', () => {
      const prev = {
        members: [member('alice'), member('bob')],
      };
      const curr = { members: [member('alice')] };
      const events = diffState(prev, curr, new Map());
      expect(events).toContainEqual(expect.stringContaining('bob disconnected'));
      expect(events).not.toContainEqual(expect.stringContaining('alice'));
    });
  });

  // --- File activity changes ---

  describe('file activity changes', () => {
    it('detects new files for existing member', () => {
      const prev = { members: [member('alice', ['a.js'])] };
      const curr = { members: [member('alice', ['a.js', 'b.js'])] };
      const events = diffState(prev, curr, new Map());
      expect(events).toContainEqual(expect.stringContaining('alice started editing b.js'));
    });

    it('does not emit when files are unchanged', () => {
      const prev = { members: [member('alice', ['a.js'])] };
      const curr = { members: [member('alice', ['a.js'])] };
      const events = diffState(prev, curr, new Map());
      const editEvents = events.filter((e) => e.includes('started editing'));
      expect(editEvents).toHaveLength(0);
    });

    it('does not emit for new members (they get "joined" event)', () => {
      const prev = { members: [] };
      const curr = { members: [member('alice', ['a.js'])] };
      const events = diffState(prev, curr, new Map());
      const editEvents = events.filter((e) => e.includes('started editing'));
      expect(editEvents).toHaveLength(0);
    });
  });

  // --- Conflict detection ---

  describe('conflict detection', () => {
    it('detects a new conflict when two active members edit the same file', () => {
      const prev = {
        members: [member('alice', ['auth.js']), member('bob', ['other.js'])],
      };
      const curr = {
        members: [member('alice', ['auth.js']), member('bob', ['auth.js'])],
      };
      const events = diffState(prev, curr, new Map());
      const conflicts = events.filter((e) => e.startsWith('CONFLICT:'));
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toContain('auth.js');
      expect(conflicts[0]).toContain('alice');
      expect(conflicts[0]).toContain('bob');
    });

    it('does not re-emit a conflict that existed in prev state', () => {
      const prev = {
        members: [member('alice', ['shared.js']), member('bob', ['shared.js'])],
      };
      const curr = {
        members: [member('alice', ['shared.js']), member('bob', ['shared.js'])],
      };
      const events = diffState(prev, curr, new Map());
      const conflicts = events.filter((e) => e.startsWith('CONFLICT:'));
      expect(conflicts).toHaveLength(0);
    });

    it('does not report conflict for inactive members', () => {
      const prev = { members: [] };
      const curr = {
        members: [
          member('alice', ['a.js'], { status: 'active' }),
          member('bob', ['a.js'], { status: 'idle' }),
        ],
      };
      const events = diffState(prev, curr, new Map());
      const conflicts = events.filter((e) => e.startsWith('CONFLICT:'));
      expect(conflicts).toHaveLength(0);
    });

    it('detects conflict on a new file while an existing one persists', () => {
      const prev = {
        members: [member('alice', ['old.js']), member('bob', ['old.js'])],
      };
      const curr = {
        members: [member('alice', ['old.js', 'new.js']), member('bob', ['old.js', 'new.js'])],
      };
      const events = diffState(prev, curr, new Map());
      const conflicts = events.filter((e) => e.startsWith('CONFLICT:'));
      // old.js was already conflicted, new.js is newly conflicted
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toContain('new.js');
    });
  });

  // --- Lock changes ---

  describe('lock changes', () => {
    it('detects a new lock', () => {
      const prev = { members: [], locks: [] };
      const curr = {
        members: [],
        locks: [{ file_path: 'db.js', owner_handle: 'alice', tool: 'cursor' }],
      };
      const events = diffState(prev, curr, new Map());
      expect(events).toContainEqual(expect.stringContaining('alice (cursor) locked db.js'));
    });

    it('detects a released lock', () => {
      const prev = {
        members: [],
        locks: [{ file_path: 'db.js', owner_handle: 'alice', tool: 'cursor' }],
      };
      const curr = { members: [], locks: [] };
      const events = diffState(prev, curr, new Map());
      expect(events).toContainEqual(
        expect.stringContaining('alice (cursor) released lock on db.js'),
      );
    });

    it('does not emit for unchanged locks', () => {
      const lock = { file_path: 'db.js', owner_handle: 'alice' };
      const prev = { members: [], locks: [lock] };
      const curr = { members: [], locks: [lock] };
      const events = diffState(prev, curr, new Map());
      const lockEvents = events.filter((e) => e.includes('locked') || e.includes('released'));
      expect(lockEvents).toHaveLength(0);
    });

    it('detects multiple lock changes at once', () => {
      const prev = {
        members: [],
        locks: [{ file_path: 'a.js', owner_handle: 'alice' }],
      };
      const curr = {
        members: [],
        locks: [{ file_path: 'b.js', owner_handle: 'bob' }],
      };
      const events = diffState(prev, curr, new Map());
      const lockEvents = events.filter((e) => e.includes('locked') || e.includes('released'));
      expect(lockEvents).toHaveLength(2); // One released, one acquired
    });
  });

  // --- Memory changes ---

  describe('memory / knowledge changes', () => {
    it('detects new memories', () => {
      const prev = { members: [], memories: [] };
      const curr = {
        members: [],
        memories: [{ id: 'mem_1', text: 'Use React 19 for this project', tags: ['stack'] }],
      };
      const events = diffState(prev, curr, new Map());
      expect(events).toContainEqual(expect.stringContaining('New team knowledge: Use React 19'));
      expect(events[0]).toContain('[stack]');
    });

    it('does not re-emit existing memories', () => {
      const mem = { id: 'mem_1', text: 'Existing knowledge' };
      const prev = { members: [], memories: [mem] };
      const curr = { members: [], memories: [mem] };
      const events = diffState(prev, curr, new Map());
      const memEvents = events.filter((e) => e.includes('New team knowledge'));
      expect(memEvents).toHaveLength(0);
    });

    it('falls back to text comparison when id is missing', () => {
      const prev = { members: [], memories: [{ text: 'Old note' }] };
      const curr = { members: [], memories: [{ text: 'Old note' }, { text: 'New note' }] };
      const events = diffState(prev, curr, new Map());
      expect(events).toContainEqual(expect.stringContaining('New note'));
      const memEvents = events.filter((e) => e.includes('New team knowledge'));
      expect(memEvents).toHaveLength(1);
    });
  });

  // --- Message changes ---

  describe('message changes', () => {
    it('detects new messages', () => {
      const prev = { members: [], messages: [] };
      const curr = {
        members: [],
        messages: [{ from_handle: 'alice', from_tool: 'cursor', text: 'Check my PR' }],
      };
      const events = diffState(prev, curr, new Map());
      expect(events).toContainEqual(
        expect.stringContaining('Message from alice (cursor): Check my PR'),
      );
    });

    it('does not re-emit existing messages', () => {
      const msg = { from_handle: 'alice', text: 'Hi', created_at: '2025-01-01T00:00:00Z' };
      const prev = { members: [], messages: [msg] };
      const curr = { members: [], messages: [msg] };
      const events = diffState(prev, curr, new Map());
      const msgEvents = events.filter((e) => e.includes('Message from'));
      expect(msgEvents).toHaveLength(0);
    });

    it('deduplicates by id when present', () => {
      const prev = {
        members: [],
        messages: [{ id: 'msg_1', from_handle: 'alice', text: 'Hi', created_at: '2025-01-01' }],
      };
      const curr = {
        members: [],
        messages: [{ id: 'msg_1', from_handle: 'alice', text: 'Hi', created_at: '2025-01-01' }],
      };
      const events = diffState(prev, curr, new Map());
      expect(events.filter((e) => e.includes('Message from'))).toHaveLength(0);
    });

    it('detects new message by different id even with same text', () => {
      const prev = {
        members: [],
        messages: [{ id: 'msg_1', from_handle: 'alice', text: 'Hi' }],
      };
      const curr = {
        members: [],
        messages: [
          { id: 'msg_1', from_handle: 'alice', text: 'Hi' },
          { id: 'msg_2', from_handle: 'alice', text: 'Hi' },
        ],
      };
      const events = diffState(prev, curr, new Map());
      expect(events.filter((e) => e.includes('Message from'))).toHaveLength(1);
    });

    it('handles null/undefined fields in composite dedup key', () => {
      const prev = {
        members: [],
        messages: [{ from_handle: undefined, text: null, created_at: undefined }],
      };
      const curr = {
        members: [],
        messages: [{ from_handle: undefined, text: null, created_at: undefined }],
      };
      const events = diffState(prev, curr, new Map());
      // Should not crash and should not re-emit (same composite key)
      expect(events.filter((e) => e.includes('Message from'))).toHaveLength(0);
    });

    it('distinguishes messages with different null patterns', () => {
      const prev = {
        members: [],
        messages: [{ from_handle: 'alice', text: undefined }],
      };
      const curr = {
        members: [],
        messages: [
          { from_handle: 'alice', text: undefined },
          { from_handle: 'alice', text: 'Hello' },
        ],
      };
      const events = diffState(prev, curr, new Map());
      expect(events.filter((e) => e.includes('Message from'))).toHaveLength(1);
    });
  });

  // --- No diff when states are identical ---

  describe('no diff', () => {
    it('returns empty array when prev and curr are identical', () => {
      const state = {
        members: [member('alice', ['a.js'])],
        locks: [{ file_path: 'a.js', owner_handle: 'alice' }],
        memories: [{ id: 'm1', text: 'Note' }],
        messages: [{ from_handle: 'bob', text: 'Hello', created_at: '2025-01-01' }],
      };
      const events = diffState(state, state, new Map());
      expect(events).toEqual([]);
    });

    it('returns empty array for two empty contexts', () => {
      const events = diffState({}, {}, new Map());
      expect(events).toEqual([]);
    });

    it('returns empty array when both have empty arrays', () => {
      const state = { members: [], locks: [], memories: [], messages: [] };
      const events = diffState(state, state, new Map());
      expect(events).toEqual([]);
    });
  });

  // --- Stuckness detection ---

  describe('stuckness detection', () => {
    it('flags a member stuck on the same task beyond threshold', () => {
      const prev = { members: [] };
      const curr = {
        members: [
          member('alice', ['a.js'], {
            updated_at: '2025-01-01T00:00:00Z',
            minutes_since_update: 20, // > 15 min threshold
          }),
        ],
      };
      const alerted = new Map();
      const events = diffState(prev, curr, alerted);
      const stuckEvents = events.filter((e) => e.includes('may be stuck'));
      expect(stuckEvents).toHaveLength(1);
      expect(stuckEvents[0]).toContain('20 min');
    });

    it('does not re-alert for the same stuckness', () => {
      const m = member('alice', ['a.js'], {
        updated_at: '2025-01-01T00:00:00Z',
        minutes_since_update: 20,
      });
      const state = { members: [m] };
      const alerted = new Map();

      diffState({ members: [] }, state, alerted);
      expect(alerted.size).toBe(1);

      // Second call with same state — should not alert again
      const events2 = diffState(state, state, alerted);
      const stuckEvents2 = events2.filter((e) => e.includes('may be stuck'));
      expect(stuckEvents2).toHaveLength(0);
    });

    it('clears stuckness alert when agent disconnects', () => {
      const m = member('alice', ['a.js'], {
        updated_at: '2025-01-01T00:00:00Z',
        minutes_since_update: 20,
      });
      const alerted = new Map();

      diffState({ members: [] }, { members: [m] }, alerted);
      expect(alerted.size).toBe(1);

      // Alice disconnects
      diffState({ members: [m] }, { members: [] }, alerted);
      expect(alerted.size).toBe(0);
    });

    it('re-alerts when activity changes after stuckness alert', () => {
      const m1 = member('alice', ['a.js'], {
        updated_at: '2025-01-01T00:00:00Z',
        minutes_since_update: 20,
      });
      const m2 = member('alice', ['a.js'], {
        updated_at: '2025-01-01T01:00:00Z', // different updated_at
        minutes_since_update: 25,
      });
      const alerted = new Map();

      diffState({ members: [] }, { members: [m1] }, alerted);
      // updated_at changed — alert should be cleared then re-checked
      const events = diffState({ members: [m1] }, { members: [m2] }, alerted);
      const stuckEvents = events.filter((e) => e.includes('may be stuck'));
      expect(stuckEvents).toHaveLength(1);
    });
  });
});
