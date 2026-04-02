import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
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
  writeSessionRecord,
  readSessionRecord,
  deleteSessionRecord,
  resolveSessionAgentId,
  setTerminalTitle,
  pingAgentTerminal,
} from '../session-registry.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, appendFileSync } from 'fs';
import { execFileSync } from 'child_process';

describe('session-registry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('SESSION_COMMAND_MARKER', () => {
    it('equals "chinwag-mcp"', () => {
      expect(SESSION_COMMAND_MARKER).toBe('chinwag-mcp');
    });
  });

  describe('getSessionsDir', () => {
    it('returns sessions dir under the given home dir', () => {
      expect(getSessionsDir('/home/alice')).toBe('/home/alice/.chinwag/sessions');
    });

    it('uses default homedir when not provided', () => {
      const dir = getSessionsDir();
      expect(dir).toMatch(/\.chinwag\/sessions$/);
    });
  });

  describe('safeAgentId', () => {
    it('replaces non-alphanumeric characters with underscores', () => {
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
  });

  describe('getSessionFilePath', () => {
    it('returns path with safe agent ID and .json extension', () => {
      const path = getSessionFilePath('cursor:abc', '/home/alice');
      expect(path).toBe('/home/alice/.chinwag/sessions/cursor_abc.json');
    });
  });

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
      execFileSync.mockImplementation(() => { throw new Error('No such process'); });
      expect(getCurrentTtyPath(1234)).toBeNull();
    });

    it('returns null for empty output', () => {
      execFileSync.mockReturnValue('');
      expect(getCurrentTtyPath(1234)).toBeNull();
    });
  });

  describe('isProcessAlive', () => {
    it('returns true when process.kill(pid, 0) succeeds', () => {
      const spy = vi.spyOn(process, 'kill').mockImplementation(() => {});
      expect(isProcessAlive(1234)).toBe(true);
      spy.mockRestore();
    });

    it('returns false when process.kill(pid, 0) throws', () => {
      const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH');
      });
      expect(isProcessAlive(1234)).toBe(false);
      spy.mockRestore();
    });
  });

  describe('isSessionRecordAlive', () => {
    it('returns false for null record', () => {
      expect(isSessionRecordAlive(null)).toBe(false);
    });

    it('returns false for record with no pid', () => {
      expect(isSessionRecordAlive({ pid: null })).toBe(false);
    });

    it('returns false when process is not alive', () => {
      expect(isSessionRecordAlive(
        { pid: 1234 },
        { processAlive: () => false },
      )).toBe(false);
    });

    it('returns true when process is alive and no commandMarker', () => {
      expect(isSessionRecordAlive(
        { pid: 1234 },
        { processAlive: () => true },
      )).toBe(true);
    });

    it('returns true when process is alive and command includes commandMarker', () => {
      expect(isSessionRecordAlive(
        { pid: 1234, commandMarker: 'chinwag-mcp' },
        {
          processAlive: () => true,
          processCommand: () => 'node chinwag-mcp serve',
        },
      )).toBe(true);
    });

    it('returns false when process is alive but command does not include commandMarker', () => {
      expect(isSessionRecordAlive(
        { pid: 1234, commandMarker: 'chinwag-mcp' },
        {
          processAlive: () => true,
          processCommand: () => '/bin/bash',
        },
      )).toBe(false);
    });

    it('returns false when processCommand returns null', () => {
      expect(isSessionRecordAlive(
        { pid: 1234, commandMarker: 'chinwag-mcp' },
        {
          processAlive: () => true,
          processCommand: () => null,
        },
      )).toBe(false);
    });
  });

  describe('writeSessionRecord', () => {
    it('writes session file with correct path and content', () => {
      writeSessionRecord('cursor:abc', { pid: 1234, tool: 'cursor' }, { homeDir: '/tmp/test' });
      expect(mkdirSync).toHaveBeenCalledWith(
        '/tmp/test/.chinwag/sessions',
        { recursive: true, mode: 0o700 },
      );
      expect(writeFileSync).toHaveBeenCalledWith(
        '/tmp/test/.chinwag/sessions/cursor_abc.json',
        expect.stringContaining('"agentId":"cursor:abc"'),
        { mode: 0o600 },
      );
    });

    it('returns the file path', () => {
      const path = writeSessionRecord('agent-1', { pid: 1 }, { homeDir: '/tmp' });
      expect(path).toBe('/tmp/.chinwag/sessions/agent-1.json');
    });
  });

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
      expect(readSessionRecord('bad', { homeDir: '/tmp' })).toBeNull();
    });
  });

  describe('deleteSessionRecord', () => {
    it('returns true after deleting the file', () => {
      unlinkSync.mockImplementation(() => {});
      expect(deleteSessionRecord('agent-1', { homeDir: '/tmp' })).toBe(true);
    });

    it('returns false when unlinkSync throws', () => {
      unlinkSync.mockImplementation(() => { throw new Error('ENOENT'); });
      expect(deleteSessionRecord('missing', { homeDir: '/tmp' })).toBe(false);
    });
  });

  describe('resolveSessionAgentId', () => {
    it('returns fallbackAgentId when tool is not provided', () => {
      expect(resolveSessionAgentId({ fallbackAgentId: 'fb' })).toBe('fb');
    });

    it('returns fallbackAgentId when tty is not provided', () => {
      expect(resolveSessionAgentId({ tool: 'cursor', tty: null, fallbackAgentId: 'fb' })).toBe('fb');
    });

    it('resolves matching session from directory', () => {
      readdirSync.mockReturnValue(['cursor_abc.json']);
      readFileSync.mockReturnValue(JSON.stringify({
        agentId: 'cursor:abc',
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        createdAt: 100,
      }));

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
        .mockReturnValueOnce(JSON.stringify({
          agentId: 'cursor:old',
          tool: 'cursor',
          cwd: '/project',
          tty: '/dev/ttys001',
          createdAt: 50,
        }))
        .mockReturnValueOnce(JSON.stringify({
          agentId: 'cursor:new',
          tool: 'cursor',
          cwd: '/project',
          tty: '/dev/ttys001',
          createdAt: 100,
        }));

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
      readFileSync.mockReturnValue(JSON.stringify({
        agentId: 'cursor:dead',
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
      }));

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

    it('returns fallbackAgentId when readdirSync throws', () => {
      readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        fallbackAgentId: 'fb',
      });
      expect(result).toBe('fb');
    });

    it('skips files with invalid JSON', () => {
      readdirSync.mockReturnValue(['bad.json', 'good.json']);
      readFileSync
        .mockReturnValueOnce('bad json')
        .mockReturnValueOnce(JSON.stringify({
          agentId: 'cursor:good',
          tool: 'cursor',
          cwd: '/project',
          tty: '/dev/ttys001',
          createdAt: 100,
        }));

      const result = resolveSessionAgentId({
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
        homeDir: '/tmp',
        recordAlive: () => true,
      });
      expect(result).toBe('cursor:good');
    });
  });

  describe('setTerminalTitle', () => {
    it('returns true and writes escape sequence when tty is valid', () => {
      appendFileSync.mockImplementation(() => {});
      expect(setTerminalTitle('/dev/ttys001', 'My Title')).toBe(true);
      expect(appendFileSync).toHaveBeenCalledWith(
        '/dev/ttys001',
        '\x1b]0;My Title\x07',
      );
    });

    it('returns false when tty is null', () => {
      expect(setTerminalTitle(null, 'Title')).toBe(false);
    });

    it('returns false when appendFileSync throws', () => {
      appendFileSync.mockImplementation(() => { throw new Error('EACCES'); });
      expect(setTerminalTitle('/dev/ttys001', 'Title')).toBe(false);
    });
  });

  describe('pingAgentTerminal', () => {
    it('returns false when session record does not exist', () => {
      existsSync.mockReturnValue(false);
      expect(pingAgentTerminal('agent-1', { homeDir: '/tmp' })).toBe(false);
    });

    it('returns false when session record has no tty', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ agentId: 'agent-1', pid: 1234 }));
      expect(pingAgentTerminal('agent-1', {
        homeDir: '/tmp',
        recordAlive: () => true,
      })).toBe(false);
    });

    it('returns false when session is not alive', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({
        agentId: 'agent-1',
        pid: 1234,
        tty: '/dev/ttys001',
      }));
      expect(pingAgentTerminal('agent-1', {
        homeDir: '/tmp',
        recordAlive: () => false,
      })).toBe(false);
    });

    it('returns true and writes attention sequences when session is alive', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({
        agentId: 'agent-1',
        pid: 1234,
        tty: '/dev/ttys001',
      }));
      appendFileSync.mockImplementation(() => {});

      const result = pingAgentTerminal('agent-1', {
        homeDir: '/tmp',
        recordAlive: () => true,
      });
      expect(result).toBe(true);
      expect(appendFileSync).toHaveBeenCalledTimes(2);
    });
  });
});
