import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs before importing the module under test
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { isValidTeamId, TEAM_ID_PATTERN, findTeamFile } from '../team-utils.js';
import type { TeamFileInfo } from '../team-utils.js';
import { existsSync, readFileSync } from 'node:fs';

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// TEAM_ID_PATTERN
// ---------------------------------------------------------------------------

describe('TEAM_ID_PATTERN', () => {
  it('matches valid team IDs (t_ + 16 lowercase hex chars)', () => {
    expect(TEAM_ID_PATTERN.test('t_abcdef0123456789')).toBe(true);
    expect(TEAM_ID_PATTERN.test('t_0000000000000000')).toBe(true);
    expect(TEAM_ID_PATTERN.test('t_ffffffffffffffff')).toBe(true);
    expect(TEAM_ID_PATTERN.test('t_a1b2c3d4e5f60718')).toBe(true);
  });

  it('rejects IDs without t_ prefix', () => {
    expect(TEAM_ID_PATTERN.test('abcdef0123456789')).toBe(false);
    expect(TEAM_ID_PATTERN.test('x_abcdef0123456789')).toBe(false);
    expect(TEAM_ID_PATTERN.test('T_abcdef0123456789')).toBe(false);
    expect(TEAM_ID_PATTERN.test('_abcdef0123456789')).toBe(false);
  });

  it('rejects IDs with wrong hex length (too short)', () => {
    expect(TEAM_ID_PATTERN.test('t_abc123')).toBe(false);
    expect(TEAM_ID_PATTERN.test('t_abc')).toBe(false);
    expect(TEAM_ID_PATTERN.test('t_')).toBe(false);
    expect(TEAM_ID_PATTERN.test('t_abcdef012345678')).toBe(false); // 15 chars
  });

  it('rejects IDs with wrong hex length (too long)', () => {
    expect(TEAM_ID_PATTERN.test('t_abcdef01234567890')).toBe(false); // 17 chars
  });

  it('rejects IDs with uppercase hex characters', () => {
    expect(TEAM_ID_PATTERN.test('t_ABCDEF0123456789')).toBe(false);
    expect(TEAM_ID_PATTERN.test('t_Abcdef0123456789')).toBe(false);
    expect(TEAM_ID_PATTERN.test('t_abcdeF0123456789')).toBe(false);
  });

  it('rejects IDs with non-hex characters', () => {
    expect(TEAM_ID_PATTERN.test('t_ghijklmnopqrstuv')).toBe(false);
    expect(TEAM_ID_PATTERN.test('t_abcdefg123456789')).toBe(false);
  });

  it('rejects strings with spaces', () => {
    expect(TEAM_ID_PATTERN.test('my team')).toBe(false);
    expect(TEAM_ID_PATTERN.test('t_ abcdef01234567')).toBe(false);
  });

  it('rejects strings with special characters', () => {
    expect(TEAM_ID_PATTERN.test('team@foo')).toBe(false);
    expect(TEAM_ID_PATTERN.test('team.foo')).toBe(false);
    expect(TEAM_ID_PATTERN.test('team/foo')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(TEAM_ID_PATTERN.test('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidTeamId
// ---------------------------------------------------------------------------

describe('isValidTeamId', () => {
  describe('valid team IDs', () => {
    it('accepts canonical team IDs', () => {
      expect(isValidTeamId('t_abcdef0123456789')).toBe(true);
      expect(isValidTeamId('t_0000000000000000')).toBe(true);
      expect(isValidTeamId('t_a7b3c9d2e1f04856')).toBe(true);
      expect(isValidTeamId('t_ffffffffffffffff')).toBe(true);
    });
  });

  describe('invalid strings', () => {
    it('rejects freeform strings', () => {
      expect(isValidTeamId('myteam')).toBe(false);
      expect(isValidTeamId('team123')).toBe(false);
      expect(isValidTeamId('my-team')).toBe(false);
      expect(isValidTeamId('my_team')).toBe(false);
    });

    it('rejects too-short hex after prefix', () => {
      expect(isValidTeamId('t_abc')).toBe(false);
    });

    it('rejects too-long hex after prefix', () => {
      expect(isValidTeamId('t_abcdef01234567890')).toBe(false);
    });

    it('rejects wrong prefix', () => {
      expect(isValidTeamId('x_abcdef0123456789')).toBe(false);
      expect(isValidTeamId('T_abcdef0123456789')).toBe(false);
      expect(isValidTeamId('team_abcdef0123456789')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidTeamId('')).toBe(false);
    });

    it('rejects IDs with special characters', () => {
      expect(isValidTeamId('team@name')).toBe(false);
      expect(isValidTeamId('team.name')).toBe(false);
      expect(isValidTeamId('team name')).toBe(false);
      expect(isValidTeamId('team/name')).toBe(false);
      expect(isValidTeamId('team!name')).toBe(false);
    });
  });

  describe('non-string types', () => {
    it('rejects null', () => {
      expect(isValidTeamId(null)).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isValidTeamId(undefined)).toBe(false);
    });

    it('rejects numbers', () => {
      expect(isValidTeamId(123)).toBe(false);
      expect(isValidTeamId(0)).toBe(false);
    });

    it('rejects objects', () => {
      expect(isValidTeamId({})).toBe(false);
      expect(isValidTeamId({ id: 't_abcdef0123456789' })).toBe(false);
    });

    it('rejects arrays', () => {
      expect(isValidTeamId([])).toBe(false);
      expect(isValidTeamId(['t_abcdef0123456789'])).toBe(false);
    });

    it('rejects booleans', () => {
      expect(isValidTeamId(true)).toBe(false);
      expect(isValidTeamId(false)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// findTeamFile
// ---------------------------------------------------------------------------

describe('findTeamFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('found in current directory', () => {
    it('returns TeamFileInfo when .chinwag is in the start dir', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ team: 't_abcdef0123456789', name: 'My Project' }),
      );

      const result = findTeamFile('/home/user/project');
      expect(result).toEqual({
        filePath: '/home/user/project/.chinwag',
        root: '/home/user/project',
        teamId: 't_abcdef0123456789',
        teamName: 'My Project',
        budgets: null,
      } satisfies TeamFileInfo);
    });

    it('parses team-level budget overrides when present', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          team: 't_abcdef0123456789',
          name: 'Team with budgets',
          budgets: {
            memoryResultCap: 5,
            coordinationBroadcast: 'silent',
            unknownField: 'dropped',
          },
        }),
      );

      const result = findTeamFile('/home/user/project');
      expect(result?.budgets).toEqual({
        memoryResultCap: 5,
        coordinationBroadcast: 'silent',
      });
    });

    it('leaves budgets null when the field is absent', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ team: 't_abcdef0123456789', name: 'No budgets' }),
      );

      const result = findTeamFile('/home/user/project');
      expect(result?.budgets).toBeNull();
    });
  });

  describe('directory walk-up', () => {
    it('walks up one level to find .chinwag', () => {
      mockExistsSync
        .mockReturnValueOnce(false) // /home/user/project/sub/.chinwag
        .mockReturnValueOnce(true); // /home/user/project/.chinwag
      mockReadFileSync.mockReturnValue(JSON.stringify({ team: 't_0000000000000001' }));

      const result = findTeamFile('/home/user/project/sub');
      expect(result).toEqual({
        filePath: '/home/user/project/.chinwag',
        root: '/home/user/project',
        teamId: 't_0000000000000001',
        teamName: 'project', // defaults to basename
        budgets: null,
      });
    });

    it('walks multiple levels up to find .chinwag', () => {
      mockExistsSync
        .mockReturnValueOnce(false) // /a/b/c/.chinwag
        .mockReturnValueOnce(false) // /a/b/.chinwag
        .mockReturnValueOnce(true); // /a/.chinwag
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ team: 't_1111111111111111', name: 'Root' }),
      );

      const result = findTeamFile('/a/b/c');
      expect(result).toEqual({
        filePath: '/a/.chinwag',
        root: '/a',
        teamId: 't_1111111111111111',
        teamName: 'Root',
        budgets: null,
      });
    });

    it('returns null when not found (reaches filesystem root)', () => {
      mockExistsSync.mockReturnValue(false);
      const result = findTeamFile('/home/user/project');
      expect(result).toBeNull();
    });
  });

  describe('invalid file content', () => {
    it('returns null on invalid JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not valid json {{{');
      expect(findTeamFile('/home/user/project')).toBeNull();
    });

    it('returns null on empty file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('');
      expect(findTeamFile('/home/user/project')).toBeNull();
    });

    it('returns null when file contains a string instead of object', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('"just a string"');
      // JSON.parse succeeds but data.team is undefined -> returns null
      expect(findTeamFile('/home/user/project')).toBeNull();
    });
  });

  describe('invalid team ID in file', () => {
    it('returns null when team is a freeform string (not t_ prefixed)', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ team: 'my-team' }));
      expect(findTeamFile('/home/user/project')).toBeNull();
    });

    it('returns null when team is an invalid ID pattern', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ team: 'invalid team!!' }));
      expect(findTeamFile('/home/user/project')).toBeNull();
    });

    it('returns null when team ID is missing from file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'No Team' }));
      expect(findTeamFile('/home/user/project')).toBeNull();
    });

    it('returns null when team is null in JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ team: null }));
      expect(findTeamFile('/home/user/project')).toBeNull();
    });

    it('returns null when team is a number', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ team: 12345 }));
      expect(findTeamFile('/home/user/project')).toBeNull();
    });
  });

  describe('team name fallback', () => {
    it('uses directory basename when name is missing', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ team: 't_abcdef0123456789' }));

      const result = findTeamFile('/home/user/my-project');
      expect(result!.teamName).toBe('my-project');
    });

    it('uses directory basename when name is empty string', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ team: 't_abcdef0123456789', name: '' }));

      const result = findTeamFile('/home/user/cool-repo');
      expect(result!.teamName).toBe('cool-repo');
    });

    it('uses directory basename when name is null', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ team: 't_abcdef0123456789', name: null }));

      const result = findTeamFile('/home/user/repo-name');
      expect(result!.teamName).toBe('repo-name');
    });

    it('uses explicit name from file when present', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ team: 't_abcdef0123456789', name: 'Custom Name' }),
      );

      const result = findTeamFile('/home/user/project');
      expect(result!.teamName).toBe('Custom Name');
    });
  });

  describe('readFileSync error handling', () => {
    it('returns null when readFileSync throws', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('EACCES permission denied');
      });
      expect(findTeamFile('/home/user/project')).toBeNull();
    });
  });
});
