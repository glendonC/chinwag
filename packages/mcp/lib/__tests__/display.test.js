import { describe, it, expect } from 'vitest';
import { formatConflictsList, formatTeamContextDisplay } from '../utils/display.js';

describe('display utilities', () => {
  describe('formatConflictsList', () => {
    it('returns empty array when no conflicts or locks', () => {
      expect(formatConflictsList([], [])).toEqual([]);
    });

    it('formats conflicts with tool info', () => {
      const lines = formatConflictsList(
        [{ owner_handle: 'alice', tool: 'cursor', files: ['auth.js'], summary: 'Fixing login' }],
        [],
      );
      expect(lines.length).toBe(1);
      expect(lines[0]).toMatch(/alice \(cursor\) is working on auth\.js/);
    });

    it('formats locked files', () => {
      const lines = formatConflictsList([], [{ file: 'db.js', held_by: 'bob', tool: 'aider' }]);
      expect(lines.length).toBe(1);
      expect(lines[0]).toMatch(/db\.js is locked by bob \(aider\)/);
    });

    it('omits tool when tool is "unknown" in conflicts', () => {
      const lines = formatConflictsList(
        [{ owner_handle: 'alice', tool: 'unknown', files: ['x.js'], summary: 'stuff' }],
        [],
      );
      expect(lines[0]).toMatch(/alice is working on x\.js/);
      expect(lines[0]).not.toMatch(/unknown/);
    });

    it('omits tool when tool is "unknown" in locks', () => {
      const lines = formatConflictsList([], [{ file: 'db.js', held_by: 'bob', tool: 'unknown' }]);
      expect(lines[0]).toMatch(/db\.js is locked by bob/);
      expect(lines[0]).not.toMatch(/unknown/);
    });
  });

  describe('formatTeamContextDisplay', () => {
    it('returns empty array when no members', () => {
      expect(formatTeamContextDisplay({ members: [] })).toEqual([]);
    });

    it('formats active member with tool and activity', () => {
      const lines = formatTeamContextDisplay({
        members: [
          {
            handle: 'alice',
            status: 'active',
            tool: 'cursor',
            activity: { files: ['auth.js', 'db.js'], summary: 'Fixing login' },
          },
        ],
      });
      expect(lines[0]).toBe(
        '  alice (active, cursor): working on auth.js, db.js \u2014 "Fixing login"',
      );
    });

    it('formats idle member without activity', () => {
      const lines = formatTeamContextDisplay({
        members: [{ handle: 'bob', status: 'active', tool: 'unknown' }],
      });
      expect(lines[0]).toBe('  bob (active): idle');
    });

    it('omits tool when tool is "unknown"', () => {
      const lines = formatTeamContextDisplay({
        members: [{ handle: 'carol', status: 'idle', tool: 'unknown' }],
      });
      expect(lines[0]).not.toMatch(/unknown/);
    });

    it('formats activity without summary', () => {
      const lines = formatTeamContextDisplay({
        members: [
          {
            handle: 'dave',
            status: 'active',
            tool: 'aider',
            activity: { files: ['test.js'] },
          },
        ],
      });
      expect(lines[0]).toBe('  dave (active, aider): working on test.js');
    });

    it('includes lock lines with owner info', () => {
      const lines = formatTeamContextDisplay({
        members: [{ handle: 'alice', status: 'active', tool: 'cursor' }],
        locks: [{ file_path: 'auth.js', owner_handle: 'alice', tool: 'cursor', minutes_held: 5.8 }],
      });
      const lockLine = lines.find((l) => l.includes('auth.js'));
      expect(lockLine).toBe('  auth.js \u2014 alice (cursor) (6m)');
    });

    it('omits tool in lock line when tool is "unknown"', () => {
      const lines = formatTeamContextDisplay({
        members: [{ handle: 'bob', status: 'active', tool: 'unknown' }],
        locks: [{ file_path: 'db.js', owner_handle: 'bob', tool: 'unknown', minutes_held: 3 }],
      });
      const lockLine = lines.find((l) => l.includes('db.js'));
      expect(lockLine).toBe('  db.js \u2014 bob (3m)');
      expect(lockLine).not.toMatch(/unknown/);
    });

    it('formats memory with tags', () => {
      const lines = formatTeamContextDisplay({
        members: [{ handle: 'alice', status: 'active', tool: 'cursor' }],
        memories: [{ text: 'Use Redis for cache', tags: ['config', 'infra'] }],
      });
      const memLine = lines.find((l) => l.includes('Use Redis'));
      expect(memLine).toBe('  Use Redis for cache [config, infra]');
    });

    it('formats memory without tags', () => {
      const lines = formatTeamContextDisplay({
        members: [{ handle: 'alice', status: 'active', tool: 'cursor' }],
        memories: [{ text: 'Important fact' }],
      });
      const memLine = lines.find((l) => l.includes('Important fact'));
      expect(memLine).toBe('  Important fact');
    });

    it('formats memory with empty tags array', () => {
      const lines = formatTeamContextDisplay({
        members: [{ handle: 'alice', status: 'active', tool: 'cursor' }],
        memories: [{ text: 'Note', tags: [] }],
      });
      const memLine = lines.find((l) => l.includes('Note'));
      expect(memLine).toBe('  Note');
    });

    it('shows stuckness insights when enabled and threshold exceeded', () => {
      const lines = formatTeamContextDisplay(
        {
          members: [
            {
              handle: 'alice',
              status: 'active',
              tool: 'cursor',
              activity: { files: ['stuck.js'], updated_at: '2026-01-01T00:00:00Z' },
              minutes_since_update: 20,
            },
          ],
        },
        { showInsights: true },
      );
      const insight = lines.find((l) => l.includes('may need help'));
      expect(insight).toMatch(/alice has been on stuck\.js for 20 min/);
    });
  });
});
