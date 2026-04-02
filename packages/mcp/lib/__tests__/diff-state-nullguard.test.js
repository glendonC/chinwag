import { describe, it, expect } from 'vitest';
import { diffState } from '../diff-state.js';

describe('diffState null guard for malformed activity data', () => {
  it('handles member with activity object but missing files property (join)', () => {
    const prev = { members: [] };
    const curr = {
      members: [
        {
          handle: 'alice',
          agent_id: 'a1',
          tool: 'cursor',
          activity: { summary: 'Working on something' },
          // files is missing
        },
      ],
    };
    const events = diffState(prev, curr, new Map());
    // Should join without crashing, and not mention files
    expect(events).toEqual(['Agent alice (cursor) joined the team']);
  });

  it('handles member with activity.files set to null', () => {
    const prev = { members: [] };
    const curr = {
      members: [
        {
          handle: 'alice',
          agent_id: 'a1',
          activity: { files: null, summary: 'test' },
        },
      ],
    };
    const events = diffState(prev, curr, new Map());
    expect(events).toEqual(['Agent alice joined the team']);
  });

  it('handles member with activity.files as empty array', () => {
    const prev = { members: [] };
    const curr = {
      members: [
        {
          handle: 'bob',
          agent_id: 'b1',
          activity: { files: [], summary: 'test' },
        },
      ],
    };
    const events = diffState(prev, curr, new Map());
    // Empty files = no activity suffix
    expect(events).toEqual(['Agent bob joined the team']);
  });

  it('handles file activity diff when prev has activity but no files', () => {
    const prev = {
      members: [{ handle: 'alice', agent_id: 'a1', activity: { summary: 'old' } }],
    };
    const curr = {
      members: [
        { handle: 'alice', agent_id: 'a1', activity: { files: ['new.js'], summary: 'new' } },
      ],
    };
    const events = diffState(prev, curr, new Map());
    expect(events).toEqual(['alice started editing new.js']);
  });

  it('handles file activity diff when curr has activity but no files', () => {
    const prev = {
      members: [{ handle: 'alice', agent_id: 'a1', activity: { files: ['old.js'] } }],
    };
    const curr = {
      members: [{ handle: 'alice', agent_id: 'a1', activity: { summary: 'thinking' } }],
    };
    const events = diffState(prev, curr, new Map());
    // No new files, so no event
    expect(events).toEqual([]);
  });

  it('handles conflict detection when activity exists but files is missing', () => {
    const prev = {
      members: [
        { handle: 'alice', agent_id: 'a1', status: 'active', activity: { summary: 'test' } },
        { handle: 'bob', agent_id: 'b1', status: 'active', activity: { files: ['shared.js'] } },
      ],
    };
    const curr = {
      members: [
        { handle: 'alice', agent_id: 'a1', status: 'active', activity: { summary: 'test' } },
        { handle: 'bob', agent_id: 'b1', status: 'active', activity: { files: ['shared.js'] } },
      ],
    };
    // Should not crash — alice has no files, so no conflict
    const events = diffState(prev, curr, new Map());
    expect(events.filter((e) => e.startsWith('CONFLICT:'))).toEqual([]);
  });
});
