import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the shared team-utils module
vi.mock('@chinwag/shared/team-utils.js', () => ({
  TEAM_ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  isValidTeamId: vi.fn((id) => typeof id === 'string' && /^t_[a-zA-Z0-9_-]+$/.test(id)),
  findTeamFile: vi.fn(),
}));

import { findTeamFile, teamHandlers } from '../team.js';
import { findTeamFile as findTeamFileShared } from '@chinwag/shared/team-utils.js';

// --- findTeamFile ---

describe('findTeamFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns teamId when .chinwag file is found', () => {
    findTeamFileShared.mockReturnValue({ teamId: 't_abc123' });
    expect(findTeamFile()).toBe('t_abc123');
  });

  it('returns null when .chinwag file is not found', () => {
    findTeamFileShared.mockReturnValue(null);
    expect(findTeamFile()).toBeNull();
  });
});

// --- teamHandlers ---

describe('teamHandlers', () => {
  let client, team;

  beforeEach(() => {
    client = {
      get: vi.fn().mockResolvedValue({}),
      post: vi.fn().mockResolvedValue({ ok: true }),
      put: vi.fn().mockResolvedValue({ ok: true }),
      del: vi.fn().mockResolvedValue({ ok: true }),
    };
    team = teamHandlers(client);
  });

  // --- Validation ---

  describe('team ID validation', () => {
    it('throws on null teamId', async () => {
      await expect(team.joinTeam(null)).rejects.toThrow('Invalid or missing team ID');
    });

    it('throws on undefined teamId', async () => {
      await expect(team.joinTeam(undefined)).rejects.toThrow('Invalid or missing team ID');
    });

    it('throws on empty string teamId', async () => {
      await expect(team.joinTeam('')).rejects.toThrow('Invalid or missing team ID');
    });

    it('throws on invalid teamId format', async () => {
      await expect(team.joinTeam('not-a-valid-id')).rejects.toThrow('Invalid or missing team ID');
    });
  });

  // --- joinTeam ---

  describe('joinTeam', () => {
    it('calls POST /teams/:id/join', async () => {
      await team.joinTeam('t_abc', 'my-project');
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/join', { name: 'my-project' });
    });

    it('sends empty body when no name provided', async () => {
      await team.joinTeam('t_abc');
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/join', {});
    });
  });

  // --- leaveTeam ---

  describe('leaveTeam', () => {
    it('calls POST /teams/:id/leave', async () => {
      await team.leaveTeam('t_abc');
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/leave', {});
    });
  });

  // --- updateActivity ---

  describe('updateActivity', () => {
    it('calls PUT /teams/:id/activity with files and summary', async () => {
      await team.updateActivity('t_abc', ['auth.js', 'db.js'], 'Fixing auth');
      expect(client.put).toHaveBeenCalledWith('/teams/t_abc/activity', {
        files: ['auth.js', 'db.js'],
        summary: 'Fixing auth',
      });
    });
  });

  // --- checkConflicts ---

  describe('checkConflicts', () => {
    it('calls POST /teams/:id/conflicts with files', async () => {
      await team.checkConflicts('t_abc', ['auth.js']);
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/conflicts', { files: ['auth.js'] });
    });
  });

  // --- getTeamContext ---

  describe('getTeamContext', () => {
    it('calls GET /teams/:id/context', async () => {
      await team.getTeamContext('t_abc');
      expect(client.get).toHaveBeenCalledWith('/teams/t_abc/context');
    });
  });

  // --- heartbeat ---

  describe('heartbeat', () => {
    it('calls POST /teams/:id/heartbeat', async () => {
      await team.heartbeat('t_abc');
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/heartbeat', {});
    });
  });

  // --- reportFile ---

  describe('reportFile', () => {
    it('calls POST /teams/:id/file with file path', async () => {
      await team.reportFile('t_abc', 'src/auth.js');
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/file', { file: 'src/auth.js' });
    });
  });

  // --- saveMemory ---

  describe('saveMemory', () => {
    it('calls POST /teams/:id/memory with text and tags', async () => {
      await team.saveMemory('t_abc', 'Redis on port 6379', ['config']);
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/memory', {
        text: 'Redis on port 6379',
        tags: ['config'],
      });
    });

    it('uses empty tags array when tags are undefined', async () => {
      await team.saveMemory('t_abc', 'Important fact');
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/memory', {
        text: 'Important fact',
        tags: [],
      });
    });
  });

  // --- searchMemories ---

  describe('searchMemories', () => {
    it('calls GET /teams/:id/memory with query params', async () => {
      await team.searchMemories('t_abc', 'redis', ['config'], undefined, 5);
      expect(client.get).toHaveBeenCalledWith('/teams/t_abc/memory?q=redis&tags=config&limit=5');
    });

    it('calls GET without query params when none provided', async () => {
      await team.searchMemories('t_abc');
      expect(client.get).toHaveBeenCalledWith('/teams/t_abc/memory');
    });

    it('handles multiple tags', async () => {
      await team.searchMemories('t_abc', 'test', ['config', 'redis'], undefined, 10);
      expect(client.get).toHaveBeenCalledWith(
        '/teams/t_abc/memory?q=test&tags=config%2Credis&limit=10',
      );
    });

    it('handles just a query without tags or limit', async () => {
      await team.searchMemories('t_abc', 'redis');
      expect(client.get).toHaveBeenCalledWith('/teams/t_abc/memory?q=redis');
    });
  });

  // --- updateMemory ---

  describe('updateMemory', () => {
    it('calls PUT /teams/:id/memory with id, text, and tags', async () => {
      await team.updateMemory('t_abc', 'mem_123', 'Updated text', ['decision']);
      expect(client.put).toHaveBeenCalledWith('/teams/t_abc/memory', {
        id: 'mem_123',
        text: 'Updated text',
        tags: ['decision'],
      });
    });

    it('omits text when undefined', async () => {
      await team.updateMemory('t_abc', 'mem_123', undefined, ['gotcha']);
      expect(client.put).toHaveBeenCalledWith('/teams/t_abc/memory', {
        id: 'mem_123',
        tags: ['gotcha'],
      });
    });

    it('omits tags when undefined', async () => {
      await team.updateMemory('t_abc', 'mem_123', 'New text');
      expect(client.put).toHaveBeenCalledWith('/teams/t_abc/memory', {
        id: 'mem_123',
        text: 'New text',
      });
    });
  });

  // --- deleteMemory ---

  describe('deleteMemory', () => {
    it('calls DEL /teams/:id/memory with id', async () => {
      await team.deleteMemory('t_abc', 'mem_123');
      expect(client.del).toHaveBeenCalledWith('/teams/t_abc/memory', { id: 'mem_123' });
    });
  });

  // --- claimFiles ---

  describe('claimFiles', () => {
    it('calls POST /teams/:id/locks with files', async () => {
      await team.claimFiles('t_abc', ['auth.js', 'db.js']);
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/locks', {
        files: ['auth.js', 'db.js'],
      });
    });
  });

  // --- releaseFiles ---

  describe('releaseFiles', () => {
    it('calls DEL /teams/:id/locks with specific files', async () => {
      await team.releaseFiles('t_abc', ['auth.js']);
      expect(client.del).toHaveBeenCalledWith('/teams/t_abc/locks', { files: ['auth.js'] });
    });

    it('calls DEL /teams/:id/locks with empty body when no files specified', async () => {
      await team.releaseFiles('t_abc');
      expect(client.del).toHaveBeenCalledWith('/teams/t_abc/locks', {});
    });
  });

  // --- sendMessage ---

  describe('sendMessage', () => {
    it('calls POST /teams/:id/messages with text', async () => {
      await team.sendMessage('t_abc', 'Hello team');
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/messages', { text: 'Hello team' });
    });

    it('includes target when specified', async () => {
      await team.sendMessage('t_abc', 'Hey', 'cursor:abc123');
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/messages', {
        text: 'Hey',
        target: 'cursor:abc123',
      });
    });
  });

  // --- startSession ---

  describe('startSession', () => {
    it('calls POST /teams/:id/sessions with framework', async () => {
      await team.startSession('t_abc', 'react');
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/sessions', { framework: 'react' });
    });
  });

  // --- endSession ---

  describe('endSession', () => {
    it('calls POST /teams/:id/sessionend with session_id', async () => {
      await team.endSession('t_abc', 'sess_123');
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/sessionend', {
        session_id: 'sess_123',
      });
    });
  });

  // --- recordEdit ---

  describe('recordEdit', () => {
    it('calls POST /teams/:id/sessionedit with file', async () => {
      await team.recordEdit('t_abc', 'src/auth.js');
      expect(client.post).toHaveBeenCalledWith('/teams/t_abc/sessionedit', { file: 'src/auth.js' });
    });
  });

  // --- reportModel ---

  describe('reportModel', () => {
    it('calls PUT /teams/:id/sessionmodel with model', async () => {
      await team.reportModel('t_abc', 'claude-opus-4-6');
      expect(client.put).toHaveBeenCalledWith('/teams/t_abc/sessionmodel', {
        model: 'claude-opus-4-6',
      });
    });
  });
});
