import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import {
  SESSION_COMMAND_MARKER,
  getSessionsDir,
  safeAgentId,
  getSessionFilePath,
  getCurrentTtyPath,
  isProcessAlive,
  isSessionRecordAlive,
  readSessionRecord,
  deleteSessionRecord,
  resolveSessionAgentId,
  setTerminalTitle,
  pingAgentTerminal,
  getCompletedSessionPath,
  readCompletedSession,
  deleteCompletedSession,
} from '../session-registry.js';
import { existsSync, readFileSync, readdirSync, unlinkSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

describe('session-registry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ---------------------------------------------------------------------------
  // SESSION_COMMAND_MARKER
  // ---------------------------------------------------------------------------
  describe('SESSION_COMMAND_MARKER', () => {
    it('equals "chinmeister-mcp"', () => {
      expect(SESSION_COMMAND_MARKER).toBe('chinmeister-mcp');
    });
  });

  // ---------------------------------------------------------------------------
  // getSessionsDir
  // ---------------------------------------------------------------------------
  describe('getSessionsDir', () => {
    it('returns sessions dir under the given home dir', () => {
      expect(getSessionsDir('/home/alice')).toBe('/home/alice/.chinmeister/sessions');
    });

    it('uses default homedir when not provided', () => {
      const dir = getSessionsDir();
      expect(dir).toMatch(/\.chinmeister\/sessions$/);
    });

    it('handles home dir with trailing slash', () => {
      // join normalizes this
      const dir = getSessionsDir('/home/alice/');
      expect(dir).toBe('/home/alice/.chinmeister/sessions');
    });
  });

  // ---------------------------------------------------------------------------
  // safeAgentId
  // ---------------------------------------------------------------------------
  describe('safeAgentId', () => {
    it('replaces colons with underscores', () => {
      expect(safeAgentId('cursor:abc123')).toBe('cursor_abc123');
    });

    it('preserves hyphens and underscores', () => {
      expect(safeAgentId('my-agent_1')).toBe('my-agent_1');
    });

    it('replaces multiple special characters', () => {
      expect(safeAgentId('a:b:c.d')).toBe('a_b_c_d');
    });

    it('handles empty string', () => {
      expect(safeAgentId('')).toBe('');
    });

    it('replaces spaces', () => {
      expect(safeAgentId('agent one')).toBe('agent_one');
    });

    it('replaces slashes and dots', () => {
      expect(safeAgentId('path/to.agent')).toBe('path_to_agent');
    });

    it('preserves purely alphanumeric input', () => {
      expect(safeAgentId('Agent123')).toBe('Agent123');
    });

    it('replaces @ and other symbols', () => {
      expect(safeAgentId('@user!name#1')).toBe('_user_name_1');
    });
  });

  // ---------------------------------------------------------------------------
  // getSessionFilePath
  // ---------------------------------------------------------------------------
  describe('getSessionFilePath', () => {
    it('returns path with safe agent ID and .json extension', () => {
      const path = getSessionFilePath('cursor:abc', '/home/alice');
      expect(path).toBe('/home/alice/.chinmeister/sessions/cursor_abc.json');
    });

    it('sanitizes special characters in agent ID for the file name', () => {
      const path = getSessionFilePath('agent/with.special:chars', '/tmp');
      expect(path).toBe('/tmp/.chinmeister/sessions/agent_with_special_chars.json');
    });
  });

  // ---------------------------------------------------------------------------
  // getCurrentTtyPath
  // ---------------------------------------------------------------------------
  describe('getCurrentTtyPath', () => {
    it('returns /dev/<tty> when ps returns a valid tty', () => {
      execFileSync.mockReturnValue('  ttys001  \n');
      const tty = getCurrentTtyPath(1234);
      expect(tty).toBe('/dev/ttys001');
    });

    it('returns null when ps returns ??', () => {
      execFileSync.mockReturnValue('??\n');
      expect(getCurrentTtyPath(1234)).toBeNull();
    });

    it('returns null when ps returns ?', () => {
      execFileSync.mockReturnValue('?\n');
      expect(getCurrentTtyPath(1234)).toBeNull();
    });

    it('returns null when ps throws', () => {
      execFileSync.mockImplementation(() => {
        throw new Error('No such process');
      });
      expect(getCurrentTtyPath(1234)).toBeNull();
    });

    it('returns null for empty output', () => {
      execFileSync.mockReturnValue('');
      expect(getCurrentTtyPath(1234)).toBeNull();
    });

    it('handles pts-style tty names', () => {
      execFileSync.mockReturnValue('pts/0\n');
      expect(getCurrentTtyPath(1234)).toBe('/dev/pts/0');
    });
  });

  // ---------------------------------------------------------------------------
  // isProcessAlive
  // ---------------------------------------------------------------------------
  describe('isProcessAlive', () => {
    it('returns true when process.kill(pid, 0) succeeds', () => {
      const spy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      expect(isProcessAlive(1234)).toBe(true);
      expect(spy).toHaveBeenCalledWith(1234, 0);
      spy.mockRestore();
    });

    it('returns false when process.kill(pid, 0) throws', () => {
      const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH');
      });
      expect(isProcessAlive(1234)).toBe(false);
      spy.mockRestore();
    });

    it('sends signal 0 (existence check, no actual signal)', () => {
      const spy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      isProcessAlive(9999);
      expect(spy).toHaveBeenCalledWith(9999, 0);
      spy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // isSessionRecordAlive
  // ---------------------------------------------------------------------------
  describe('isSessionRecordAlive', () => {
    it('returns false for null record', () => {
      expect(isSessionRecordAlive(null)).toBe(false);
    });

    it('returns false for undefined record', () => {
      expect(isSessionRecordAlive(undefined)).toBe(false);
    });

    it('returns false for record with no pid', () => {
      expect(isSessionRecordAlive({ pid: null })).toBe(false);
    });

    it('returns false for record with pid of 0', () => {
      expect(isSessionRecordAlive({ pid: 0 })).toBe(false);
    });

    it('returns false when process is not alive', () => {
      expect(isSessionRecordAlive({ pid: 1234 }, { processAlive: () => false })).toBe(false);
    });

    it('returns true when process is alive and no commandMarker', () => {
      expect(isSessionRecordAlive({ pid: 1234 }, { processAlive: () => true })).toBe(true);
    });

    it('returns true when process is alive and command includes commandMarker', () => {
      expect(
        isSessionRecordAlive(
          { pid: 1234, commandMarker: 'chinmeister-mcp' },
          {
            processAlive: () => true,
            processCommand: () => 'node chinmeister-mcp serve',
          },
        ),
      ).toBe(true);
    });

    it('returns false when process is alive but command does not include commandMarker', () => {
      expect(
        isSessionRecordAlive(
          { pid: 1234, commandMarker: 'chinmeister-mcp' },
          {
            processAlive: () => true,
            processCommand: () => '/bin/bash',
          },
        ),
      ).toBe(false);
    });

    it('returns false when processCommand returns null', () => {
      expect(
        isSessionRecordAlive(
          { pid: 1234, commandMarker: 'chinmeister-mcp' },
          {
            processAlive: () => true,
            processCommand: () => null,
          },
        ),
      ).toBe(false);
    });

    it('returns true when commandMarker is empty string (falsy) - treated as no marker', () => {
      expect(
        isSessionRecordAlive({ pid: 1234, commandMarker: '' }, { processAlive: () => true }),
      ).toBe(true);
    });

    it('returns false when processCommand returns empty string and marker is set', () => {
      expect(
        isSessionRecordAlive(
          { pid: 1234, commandMarker: 'chinmeister-mcp' },
          {
            processAlive: () => true,
            processCommand: () => '',
          },
        ),
      ).toBe(false);
    });

    it('uses default processAlive and processCommand when not provided', () => {
      // This tests the default code path (which calls real process.kill and ps)
      // We just verify it doesn't throw for a non-existent PID
      const result = isSessionRecordAlive({ pid: 999999999 });
      expect(typeof result).toBe('boolean');
    });
  });

  // Write-path behavior (real fs) is covered in session-registry-writes.test.ts.
  // This file keeps mocks for lookup/delete/resolve paths.

  // ---------------------------------------------------------------------------
  // readSessionRecord
  // ---------------------------------------------------------------------------
  describe('readSessionRecord', () => {
    it('returns parsed record when file exists', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ agentId: 'cursor:abc', pid: 1234 }));
      const record = readSessionRecord('cursor:abc', { homeDir: '/tmp' });
      expect(record).toEqual({ agentId: 'cursor:abc', pid: 1234 });
    });

    it('returns null when file does not exist', () => {
      existsSync.mockReturnValue(false);
      expect(readSessionRecord('missing', { homeDir: '/tmp' })).toBeNull();
    });

    it('returns null when file contains invalid JSON', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('bad json');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(readSessionRecord('bad', { homeDir: '/tmp' })).toBeNull();
      consoleSpy.mockRestore();
    });

    it('reads from the correct file path based on agent ID and homeDir', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ agentId: 'test', pid: 1 }));
      readSessionRecord('my:agent', { homeDir: '/home/user' });
      expect(readFileSync).toHaveBeenCalledWith(
        '/home/user/.chinmeister/sessions/my_agent.json',
        'utf-8',
      );
    });

    it('logs error when JSON parsing fails', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('{invalid');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      readSessionRecord('bad', { homeDir: '/tmp' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('failed to parse'));
      consoleSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // deleteSessionRecord
  // ---------------------------------------------------------------------------
  describe('deleteSessionRecord', () => {
    it('returns true after deleting the file', () => {
      unlinkSync.mockImplementation(() => {});
      expect(deleteSessionRecord('agent-1', { homeDir: '/tmp' })).toBe(true);
    });

    it('returns false and suppresses ENOENT errors', () => {
      const enoent = new Error('ENOENT');
      enoent.code = 'ENOENT';
      unlinkSync.mockImplementation(() => {
        throw enoent;
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(deleteSessionRecord('missing', { homeDir: '/tmp' })).toBe(false);
      // ENOENT should NOT be logged
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('returns false and logs non-ENOENT errors', () => {
      const eacces = new Error('EACCES');
      eacces.code = 'EACCES';
      unlinkSync.mockImplementation(() => {
        throw eacces;
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(deleteSessionRecord('locked', { homeDir: '/tmp' })).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('failed to delete'));
      consoleSpy.mockRestore();
    });

    it('deletes from the correct path based on agent ID', () => {
      unlinkSync.mockImplementation(() => {});
      deleteSessionRecord('cursor:abc', { homeDir: '/home/user' });
      expect(unlinkSync).toHaveBeenCalledWith('/home/user/.chinmeister/sessions/cursor_abc.json');
    });

    it('returns false when unlinkSync throws a generic error', () => {
      unlinkSync.mockImplementation(() => {
        throw new Error('Unknown');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(deleteSessionRecord('agent', { homeDir: '/tmp' })).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // resolveSessionAgentId
  // ---------------------------------------------------------------------------
  describe('resolveSessionAgentId', () => {
    it('returns fallbackAgentId when tool is not provided', () => {
      expect(resolveSessionAgentId({ fallbackAgentId: 'fb' })).toBe('fb');
    });

    it('returns null when no options provided (defaults)', () => {
      expect(resolveSessionAgentId()).toBeNull();
    });

    it('returns fallbackAgentId when tty is null', () => {
      expect(resolveSessionAgentId({ tool: 'cursor', tty: null, fallbackAgentId: 'fb' })).toBe(
        'fb',
      );
    });

    it('resolves matching session from directory', () => {
      readdirSync.mockReturnValue(['cursor_abc.json']);
      readFileSync.mockReturnValue(
        JSON.stringify({
          agentId: 'cursor:abc',
          tool: 'cursor',
          cwd: '/project',
          tty: '/dev/ttys001',
          createdAt: 100,
        }),
      );

      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        recordAlive: () => true,
      });
      expect(result).toBe('cursor:abc');
    });

    it('returns most recent session when multiple match', () => {
      readdirSync.mockReturnValue(['a.json', 'b.json']);
      readFileSync
        .mockReturnValueOnce(
          JSON.stringify({
            agentId: 'cursor:old',
            tool: 'cursor',
            cwd: '/project',
            tty: '/dev/ttys001',
            createdAt: 50,
          }),
        )
        .mockReturnValueOnce(
          JSON.stringify({
            agentId: 'cursor:new',
            tool: 'cursor',
            cwd: '/project',
            tty: '/dev/ttys001',
            createdAt: 100,
          }),
        );

      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        recordAlive: () => true,
      });
      expect(result).toBe('cursor:new');
    });

    it('skips dead sessions', () => {
      readdirSync.mockReturnValue(['a.json']);
      readFileSync.mockReturnValue(
        JSON.stringify({
          agentId: 'cursor:dead',
          tool: 'cursor',
          cwd: '/project',
          tty: '/dev/ttys001',
        }),
      );

      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        recordAlive: () => false,
        fallbackAgentId: 'fb',
      });
      expect(result).toBe('fb');
    });

    it('returns fallbackAgentId when no sessions match', () => {
      readdirSync.mockReturnValue([]);
      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        fallbackAgentId: 'fb',
      });
      expect(result).toBe('fb');
    });

    it('returns fallbackAgentId when sessions dir does not exist (ENOENT)', () => {
      const enoent = new Error('ENOENT');
      enoent.code = 'ENOENT';
      readdirSync.mockImplementation(() => {
        throw enoent;
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        fallbackAgentId: 'fb',
      });
      expect(result).toBe('fb');
      // ENOENT should NOT be logged
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('returns fallbackAgentId and logs when readdirSync throws non-ENOENT error', () => {
      const eacces = new Error('EACCES');
      eacces.code = 'EACCES';
      readdirSync.mockImplementation(() => {
        throw eacces;
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        fallbackAgentId: 'fb',
      });
      expect(result).toBe('fb');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to resolve session agent ID'),
      );
      consoleSpy.mockRestore();
    });

    it('skips files with invalid JSON', () => {
      readdirSync.mockReturnValue(['bad.json', 'good.json']);
      readFileSync.mockReturnValueOnce('bad json').mockReturnValueOnce(
        JSON.stringify({
          agentId: 'cursor:good',
          tool: 'cursor',
          cwd: '/project',
          tty: '/dev/ttys001',
          createdAt: 100,
        }),
      );

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        recordAlive: () => true,
      });
      expect(result).toBe('cursor:good');
      consoleSpy.mockRestore();
    });

    it('filters out non-.json files', () => {
      readdirSync.mockReturnValue(['readme.txt', 'good.json']);
      readFileSync.mockReturnValue(
        JSON.stringify({
          agentId: 'cursor:good',
          tool: 'cursor',
          cwd: '/project',
          tty: '/dev/ttys001',
        }),
      );

      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        recordAlive: () => true,
      });
      expect(result).toBe('cursor:good');
      // readFileSync should only be called once (for the .json file)
      expect(readFileSync).toHaveBeenCalledTimes(1);
    });

    it('skips records with different tool', () => {
      readdirSync.mockReturnValue(['a.json']);
      readFileSync.mockReturnValue(
        JSON.stringify({
          agentId: 'vscode:abc',
          tool: 'vscode',
          cwd: '/project',
          tty: '/dev/ttys001',
        }),
      );

      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        recordAlive: () => true,
        fallbackAgentId: 'fb',
      });
      expect(result).toBe('fb');
    });

    it('skips records with different cwd', () => {
      readdirSync.mockReturnValue(['a.json']);
      readFileSync.mockReturnValue(
        JSON.stringify({
          agentId: 'cursor:abc',
          tool: 'cursor',
          cwd: '/other-project',
          tty: '/dev/ttys001',
        }),
      );

      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        recordAlive: () => true,
        fallbackAgentId: 'fb',
      });
      expect(result).toBe('fb');
    });

    it('skips records with different tty', () => {
      readdirSync.mockReturnValue(['a.json']);
      readFileSync.mockReturnValue(
        JSON.stringify({
          agentId: 'cursor:abc',
          tool: 'cursor',
          cwd: '/project',
          tty: '/dev/ttys002',
        }),
      );

      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        recordAlive: () => true,
        fallbackAgentId: 'fb',
      });
      expect(result).toBe('fb');
    });

    it('skips records with no agentId', () => {
      readdirSync.mockReturnValue(['a.json']);
      readFileSync.mockReturnValue(
        JSON.stringify({
          tool: 'cursor',
          cwd: '/project',
          tty: '/dev/ttys001',
        }),
      );

      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        recordAlive: () => true,
        fallbackAgentId: 'fb',
      });
      expect(result).toBe('fb');
    });

    it('handles records without createdAt by sorting them as 0', () => {
      readdirSync.mockReturnValue(['a.json', 'b.json']);
      readFileSync
        .mockReturnValueOnce(
          JSON.stringify({
            agentId: 'cursor:no-time',
            tool: 'cursor',
            cwd: '/project',
            tty: '/dev/ttys001',
          }),
        )
        .mockReturnValueOnce(
          JSON.stringify({
            agentId: 'cursor:with-time',
            tool: 'cursor',
            cwd: '/project',
            tty: '/dev/ttys001',
            createdAt: 100,
          }),
        );

      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        recordAlive: () => true,
      });
      // The one with createdAt=100 should win over the one with createdAt=undefined (treated as 0)
      expect(result).toBe('cursor:with-time');
    });
  });

  // ---------------------------------------------------------------------------
  // setTerminalTitle
  // ---------------------------------------------------------------------------
  describe('setTerminalTitle', () => {
    it('returns true and writes escape sequence when tty is valid', () => {
      appendFileSync.mockImplementation(() => {});
      expect(setTerminalTitle('/dev/ttys001', 'My Title')).toBe(true);
      expect(appendFileSync).toHaveBeenCalledWith('/dev/ttys001', '\x1b]0;My Title\x07');
    });

    it('returns false when tty is null', () => {
      expect(setTerminalTitle(null, 'Title')).toBe(false);
      expect(appendFileSync).not.toHaveBeenCalled();
    });

    it('returns false when appendFileSync throws', () => {
      appendFileSync.mockImplementation(() => {
        throw new Error('EACCES');
      });
      expect(setTerminalTitle('/dev/ttys001', 'Title')).toBe(false);
    });

    it('uses OSC escape sequence with BEL terminator', () => {
      appendFileSync.mockImplementation(() => {});
      setTerminalTitle('/dev/ttys001', 'Hello');
      const call = appendFileSync.mock.calls[0];
      expect(call[1]).toBe('\x1b]0;Hello\x07');
    });
  });

  // ---------------------------------------------------------------------------
  // pingAgentTerminal
  // ---------------------------------------------------------------------------
  describe('pingAgentTerminal', () => {
    it('returns false when session record does not exist', () => {
      existsSync.mockReturnValue(false);
      expect(pingAgentTerminal('agent-1', { homeDir: '/tmp' })).toBe(false);
    });

    it('returns false when session record has no tty', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ agentId: 'agent-1', pid: 1234 }));
      expect(
        pingAgentTerminal('agent-1', {
          homeDir: '/tmp',
          recordAlive: () => true,
        }),
      ).toBe(false);
    });

    it('returns false when session is not alive', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(
        JSON.stringify({
          agentId: 'agent-1',
          pid: 1234,
          tty: '/dev/ttys001',
        }),
      );
      expect(
        pingAgentTerminal('agent-1', {
          homeDir: '/tmp',
          recordAlive: () => false,
        }),
      ).toBe(false);
    });

    it('returns true and writes attention + bell sequences when session is alive', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(
        JSON.stringify({
          agentId: 'agent-1',
          pid: 1234,
          tty: '/dev/ttys001',
        }),
      );
      appendFileSync.mockImplementation(() => {});

      const result = pingAgentTerminal('agent-1', {
        homeDir: '/tmp',
        recordAlive: () => true,
      });
      expect(result).toBe(true);
      expect(appendFileSync).toHaveBeenCalledTimes(2);
      // First call: iTerm2 attention request
      expect(appendFileSync.mock.calls[0][1]).toBe('\x1b]1337;RequestAttention=yes\x07');
      // Second call: bell character
      expect(appendFileSync.mock.calls[1][1]).toBe('\x07');
    });

    it('returns false when appendFileSync throws', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(
        JSON.stringify({
          agentId: 'agent-1',
          pid: 1234,
          tty: '/dev/ttys001',
        }),
      );
      appendFileSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      expect(
        pingAgentTerminal('agent-1', {
          homeDir: '/tmp',
          recordAlive: () => true,
        }),
      ).toBe(false);
    });

    it('returns false when tty is null in the record', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(
        JSON.stringify({
          agentId: 'agent-1',
          pid: 1234,
          tty: null,
        }),
      );
      expect(
        pingAgentTerminal('agent-1', {
          homeDir: '/tmp',
          recordAlive: () => true,
        }),
      ).toBe(false);
    });
  });

  describe('completed session records', () => {
    it('sanitizes agentId in the completion file path', () => {
      expect(getCompletedSessionPath('weird/agent?name', '/tmp')).toBe(
        '/tmp/.chinmeister/sessions/weird_agent_name.completed.json',
      );
    });

    it('reads a previously written completion record', () => {
      const record = {
        agentId: 'agent-2',
        sessionId: 'sess_xyz',
        teamId: 't_team',
        toolId: 'codex',
        cwd: '/repo',
        startedAt: 1000,
        completedAt: 2000,
      };
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify(record));
      expect(readCompletedSession('agent-2', { homeDir: '/tmp' })).toEqual(record);
    });

    it('returns null when the completion file is missing', () => {
      existsSync.mockReturnValue(false);
      expect(readCompletedSession('never-was', { homeDir: '/tmp' })).toBeNull();
    });

    it('returns null and logs when the completion file is malformed', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('{ not json');
      expect(readCompletedSession('broken', { homeDir: '/tmp' })).toBeNull();
    });

    it('deletes the completion file and returns true', () => {
      unlinkSync.mockReturnValue(undefined);
      expect(deleteCompletedSession('agent-1', { homeDir: '/tmp' })).toBe(true);
      expect(unlinkSync).toHaveBeenCalledWith('/tmp/.chinmeister/sessions/agent-1.completed.json');
    });

    it('returns false and does not crash when ENOENT on delete', () => {
      const enoent = new Error('not found');
      enoent.code = 'ENOENT';
      unlinkSync.mockImplementation(() => {
        throw enoent;
      });
      expect(deleteCompletedSession('gone', { homeDir: '/tmp' })).toBe(false);
    });
  });
});
