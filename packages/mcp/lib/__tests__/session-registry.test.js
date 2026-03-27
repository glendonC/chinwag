import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteSessionRecord,
  pingAgentTerminal,
  readSessionRecord,
  resolveSessionAgentId,
  safeAgentId,
  writeSessionRecord,
} from '../../../shared/session-registry.js';

let tempHome;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'chinwag-sessions-'));
});

afterEach(() => {
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe('session registry', () => {
  it('sanitizes agent ids for filenames', () => {
    expect(safeAgentId('claude-code:abc123:def456')).toBe('claude-code_abc123_def456');
  });

  it('writes, reads, and deletes exact session records', () => {
    writeSessionRecord('cursor:abc123:def456', {
      tool: 'cursor',
      tty: '/tmp/fake-tty',
      pid: 12345,
      cwd: '/repo',
      createdAt: 1,
    }, { homeDir: tempHome });

    expect(readSessionRecord('cursor:abc123:def456', { homeDir: tempHome })).toMatchObject({
      agentId: 'cursor:abc123:def456',
      tool: 'cursor',
      cwd: '/repo',
    });

    expect(deleteSessionRecord('cursor:abc123:def456', { homeDir: tempHome })).toBe(true);
    expect(readSessionRecord('cursor:abc123:def456', { homeDir: tempHome })).toBeNull();
  });

  it('resolves the matching live session for tool, cwd, and tty', () => {
    writeSessionRecord('claude-code:hash:1111', {
      tool: 'claude-code',
      tty: '/dev/ttys001',
      pid: 111,
      cwd: '/repo-a',
      createdAt: 1,
      commandMarker: 'chinwag-mcp',
    }, { homeDir: tempHome });
    writeSessionRecord('claude-code:hash:2222', {
      tool: 'claude-code',
      tty: '/dev/ttys001',
      pid: 222,
      cwd: '/repo-a',
      createdAt: 2,
      commandMarker: 'chinwag-mcp',
    }, { homeDir: tempHome });
    writeSessionRecord('claude-code:hash:3333', {
      tool: 'claude-code',
      tty: '/dev/ttys002',
      pid: 333,
      cwd: '/repo-a',
      createdAt: 3,
      commandMarker: 'chinwag-mcp',
    }, { homeDir: tempHome });

    const resolved = resolveSessionAgentId({
      tool: 'claude-code',
      cwd: '/repo-a',
      tty: '/dev/ttys001',
      homeDir: tempHome,
      fallbackAgentId: 'claude-code:hash',
      recordAlive: () => true,
    });

    expect(resolved).toBe('claude-code:hash:2222');
  });

  it('falls back when there is no exact live match', () => {
    const resolved = resolveSessionAgentId({
      tool: 'claude-code',
      cwd: '/repo-a',
      tty: '/dev/ttys001',
      homeDir: tempHome,
      fallbackAgentId: 'claude-code:hash',
      recordAlive: () => false,
    });

    expect(resolved).toBe('claude-code:hash');
  });

  it('pings the terminal for an exact agent id', () => {
    const fakeTty = path.join(tempHome, 'tty.txt');
    fs.writeFileSync(fakeTty, '');
    writeSessionRecord('cursor:abc123:def456', {
      tool: 'cursor',
      tty: fakeTty,
      pid: 12345,
      cwd: '/repo',
      createdAt: 1,
    }, { homeDir: tempHome });

    const pinged = pingAgentTerminal('cursor:abc123:def456', {
      homeDir: tempHome,
      recordAlive: () => true,
    });

    expect(pinged).toBe(true);
    const written = fs.readFileSync(fakeTty, 'utf-8');
    expect(written).toContain('\x1b]1337;RequestAttention=yes\x07');
    expect(written).toContain('\x07');
  });
});
