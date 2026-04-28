import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeSessionRecord,
  readSessionRecord,
  writeCompletedSession,
  readCompletedSession,
  getSessionFilePath,
  getCompletedSessionPath,
} from '../session-registry.js';

// Write-path tests use real fs in a tmp home to catch torn-write regressions and
// file-mode drift. Mock-based assertions lived in session-registry.test.js until
// atomic writes were introduced - expectations on `writeFileSync(target, ...)`
// broke because writes now go through a tmp file + rename.

describe('session-registry write paths (real fs)', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = join(tmpdir(), `chinmeister-session-${process.pid}-${Date.now()}`);
  });

  afterEach(() => {
    try {
      rmSync(homeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('writeSessionRecord', () => {
    it('writes the payload with the agentId merged in', () => {
      const path = writeSessionRecord(
        'cursor:abc',
        { pid: 1234, tool: 'cursor', cwd: '/project', tty: '/dev/ttys001' },
        { homeDir },
      );
      expect(path).toBe(getSessionFilePath('cursor:abc', homeDir));
      const written = JSON.parse(readFileSync(path, 'utf-8').trim());
      expect(written).toEqual({
        agentId: 'cursor:abc',
        pid: 1234,
        tool: 'cursor',
        cwd: '/project',
        tty: '/dev/ttys001',
      });
    });

    it('writes to the sanitized path', () => {
      const path = writeSessionRecord(
        'agent-1',
        { pid: 1, tool: 'test', cwd: '/', tty: null },
        { homeDir },
      );
      expect(path).toBe(join(homeDir, '.chinmeister', 'sessions', 'agent-1.json'));
    });

    it('preserves optional fields like createdAt and commandMarker', () => {
      const path = writeSessionRecord(
        'agent',
        {
          pid: 1,
          tool: 'test',
          cwd: '/',
          tty: null,
          createdAt: 12345,
          commandMarker: 'chinmeister-mcp',
        },
        { homeDir },
      );
      const written = JSON.parse(readFileSync(path, 'utf-8').trim());
      expect(written.createdAt).toBe(12345);
      expect(written.commandMarker).toBe('chinmeister-mcp');
    });

    it('includes a trailing newline so the file is line-oriented', () => {
      const path = writeSessionRecord(
        'agent',
        { pid: 1, tool: 'test', cwd: '/', tty: null },
        { homeDir },
      );
      expect(readFileSync(path, 'utf-8')).toMatch(/\n$/);
    });

    it('creates the sessions directory with 0o700 permissions', () => {
      writeSessionRecord('agent', { pid: 1, tool: 'test', cwd: '/', tty: null }, { homeDir });
      if (process.platform !== 'win32') {
        const mode = statSync(join(homeDir, '.chinmeister', 'sessions')).mode & 0o777;
        expect(mode).toBe(0o700);
      }
    });

    it('writes the record file with 0o600 permissions', () => {
      const path = writeSessionRecord(
        'agent',
        { pid: 1, tool: 'test', cwd: '/', tty: null },
        { homeDir },
      );
      if (process.platform !== 'win32') {
        const mode = statSync(path).mode & 0o777;
        expect(mode).toBe(0o600);
      }
    });

    it('overwrites atomically - a concurrent reader sees the previous content, not a half-written file', () => {
      const path = writeSessionRecord(
        'agent',
        { pid: 1, tool: 'test', cwd: '/', tty: null },
        { homeDir },
      );
      const first = readFileSync(path, 'utf-8');
      expect(first.trim().length).toBeGreaterThan(0);

      writeSessionRecord('agent', { pid: 99, tool: 'test', cwd: '/', tty: null }, { homeDir });
      const after = readFileSync(path, 'utf-8');
      expect(JSON.parse(after.trim())).toMatchObject({ pid: 99 });
    });

    it('round-trips through readSessionRecord', () => {
      writeSessionRecord('agent', { pid: 1, tool: 'test', cwd: '/', tty: null }, { homeDir });
      const read = readSessionRecord('agent', { homeDir });
      expect(read).toMatchObject({ agentId: 'agent', pid: 1, tool: 'test' });
    });
  });

  describe('writeCompletedSession', () => {
    it('writes to the .completed.json sibling of the session file', () => {
      const record = {
        agentId: 'agent-1',
        sessionId: 'sess_abc123',
        teamId: 't_team',
        toolId: 'claude-code',
        cwd: '/repo',
        startedAt: 1000,
        completedAt: 2000,
      };
      const path = writeCompletedSession(record, { homeDir });
      expect(path).toBe(getCompletedSessionPath('agent-1', homeDir));
      expect(existsSync(path)).toBe(true);
    });

    it('round-trips the record through readCompletedSession', () => {
      const record = {
        agentId: 'agent-2',
        sessionId: 'sess_xyz',
        teamId: 't_team',
        toolId: 'codex',
        cwd: '/repo',
        startedAt: 1000,
        completedAt: 2000,
      };
      writeCompletedSession(record, { homeDir });
      expect(readCompletedSession('agent-2', { homeDir })).toEqual(record);
    });

    it('writes the completion file with 0o600 permissions', () => {
      const record = {
        agentId: 'agent-3',
        sessionId: 'sess_abc',
        teamId: 't_team',
        toolId: 'cursor',
        cwd: '/repo',
        startedAt: 1000,
        completedAt: 2000,
      };
      const path = writeCompletedSession(record, { homeDir });
      if (process.platform !== 'win32') {
        const mode = statSync(path).mode & 0o777;
        expect(mode).toBe(0o600);
      }
    });
  });
});
