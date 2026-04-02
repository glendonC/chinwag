import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs and path before importing
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { isValidTeamId, TEAM_ID_PATTERN, findTeamFile } from '../team-utils.js';
import { existsSync, readFileSync } from 'fs';

describe('team-utils', () => {
  describe('TEAM_ID_PATTERN', () => {
    it('matches alphanumeric strings', () => {
      expect(TEAM_ID_PATTERN.test('abc123')).toBe(true);
    });

    it('matches strings with hyphens and underscores', () => {
      expect(TEAM_ID_PATTERN.test('my-team_1')).toBe(true);
    });

    it('rejects strings with spaces', () => {
      expect(TEAM_ID_PATTERN.test('my team')).toBe(false);
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

  describe('isValidTeamId', () => {
    it('accepts valid alphanumeric IDs', () => {
      expect(isValidTeamId('myteam')).toBe(true);
      expect(isValidTeamId('team123')).toBe(true);
      expect(isValidTeamId('my-team')).toBe(true);
      expect(isValidTeamId('my_team')).toBe(true);
    });

    it('accepts single character ID', () => {
      expect(isValidTeamId('a')).toBe(true);
    });

    it('accepts ID at max length (30 chars)', () => {
      expect(isValidTeamId('a'.repeat(30))).toBe(true);
    });

    it('rejects ID exceeding max length', () => {
      expect(isValidTeamId('a'.repeat(31))).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidTeamId('')).toBe(false);
    });

    it('rejects non-string types', () => {
      expect(isValidTeamId(null)).toBe(false);
      expect(isValidTeamId(undefined)).toBe(false);
      expect(isValidTeamId(123)).toBe(false);
      expect(isValidTeamId({})).toBe(false);
      expect(isValidTeamId([])).toBe(false);
      expect(isValidTeamId(true)).toBe(false);
    });

    it('rejects IDs with special characters', () => {
      expect(isValidTeamId('team@name')).toBe(false);
      expect(isValidTeamId('team.name')).toBe(false);
      expect(isValidTeamId('team name')).toBe(false);
      expect(isValidTeamId('team/name')).toBe(false);
      expect(isValidTeamId('team!name')).toBe(false);
    });
  });

  describe('findTeamFile', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('returns team info when .chinwag file is found in startDir', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ team: 'my-team', name: 'My Project' }));

      const result = findTeamFile('/home/user/project');
      expect(result).toEqual({
        filePath: '/home/user/project/.chinwag',
        root: '/home/user/project',
        teamId: 'my-team',
        teamName: 'My Project',
      });
    });

    it('uses directory basename when name is missing from file', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ team: 'my-team' }));

      const result = findTeamFile('/home/user/project');
      expect(result).toEqual({
        filePath: '/home/user/project/.chinwag',
        root: '/home/user/project',
        teamId: 'my-team',
        teamName: 'project',
      });
    });

    it('walks up directories to find .chinwag file', () => {
      existsSync
        .mockReturnValueOnce(false)   // /home/user/project/sub/.chinwag
        .mockReturnValueOnce(true);    // /home/user/project/.chinwag
      readFileSync.mockReturnValue(JSON.stringify({ team: 'parent-team' }));

      const result = findTeamFile('/home/user/project/sub');
      expect(result).toEqual({
        filePath: '/home/user/project/.chinwag',
        root: '/home/user/project',
        teamId: 'parent-team',
        teamName: 'project',
      });
    });

    it('returns null when no .chinwag file exists', () => {
      existsSync.mockReturnValue(false);

      const result = findTeamFile('/home/user/project');
      expect(result).toBeNull();
    });

    it('returns null when file contains invalid JSON', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('not valid json');

      const result = findTeamFile('/home/user/project');
      expect(result).toBeNull();
    });

    it('returns null when team ID is missing', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ name: 'No Team' }));

      const result = findTeamFile('/home/user/project');
      expect(result).toBeNull();
    });

    it('returns null when team ID is invalid', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ team: 'invalid team!!' }));

      const result = findTeamFile('/home/user/project');
      expect(result).toBeNull();
    });

    it('returns null when team ID exceeds max length', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ team: 'a'.repeat(31) }));

      const result = findTeamFile('/home/user/project');
      expect(result).toBeNull();
    });
  });
});
