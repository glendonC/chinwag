import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectTerminalEnvironment,
  buildTerminalCommand,
  readPidFile,
  cleanPidFile,
  isProcessAlive,
} from '../terminal-spawner.js';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PIDS_DIR = join(homedir(), '.chinmeister', 'pids');

describe('detectTerminalEnvironment', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('detects tmux when TMUX is set', () => {
    process.env.TMUX = '/tmp/tmux-501/default,12345,0';
    expect(detectTerminalEnvironment().type).toBe('tmux');
  });

  it('detects iTerm2 when TERM_PROGRAM is iTerm.app', () => {
    delete process.env.TMUX;
    delete process.env.VSCODE_INJECTION;
    process.env.TERM_PROGRAM = 'iTerm.app';
    expect(detectTerminalEnvironment().type).toBe('iterm2');
  });

  it('detects IDE terminal when TERM_PROGRAM is vscode', () => {
    delete process.env.TMUX;
    process.env.TERM_PROGRAM = 'vscode';
    const result = detectTerminalEnvironment();
    expect(result.type).toBe('ide-terminal');
  });

  it('detects Terminal.app on macOS', () => {
    delete process.env.TMUX;
    delete process.env.VSCODE_INJECTION;
    delete process.env.ITERM_SESSION_ID;
    process.env.TERM_PROGRAM = 'Apple_Terminal';
    expect(detectTerminalEnvironment().type).toBe('macos-terminal');
  });

  it('returns fallback for unknown environment', () => {
    delete process.env.TMUX;
    delete process.env.TERM_PROGRAM;
    delete process.env.ITERM_SESSION_ID;
    delete process.env.VSCODE_INJECTION;
    // Can't easily mock platform, but verify it returns an object with type
    const result = detectTerminalEnvironment();
    expect(result).toHaveProperty('type');
    expect(result).toHaveProperty('name');
  });
});

describe('buildTerminalCommand', () => {
  it('builds command with env vars, pidfile, cd, and tool', () => {
    const cmd = buildTerminalCommand({
      agentId: 'claude-code:abc123:def456',
      toolId: 'claude-code',
      cwd: '/Users/test/project',
      cmd: 'claude',
      args: [],
      task: 'refactor auth',
    });

    expect(cmd).toContain('CHINMEISTER_TOOL');
    expect(cmd).toContain('claude-code');
    expect(cmd).toContain('CHINMEISTER_AGENT_ID');
    expect(cmd).toContain('mkdir -p');
    expect(cmd).toContain('.chinmeister/pids');
    expect(cmd).toContain('echo $$');
    expect(cmd).toContain('cd');
    expect(cmd).toContain('/Users/test/project');
    expect(cmd).toContain("claude 'refactor auth'");
  });

  it('includes args in the tool command', () => {
    const cmd = buildTerminalCommand({
      agentId: 'codex:abc:def',
      toolId: 'codex',
      cwd: '/project',
      cmd: 'codex',
      args: ['exec', '--color', 'never'],
      task: 'fix bug',
    });

    expect(cmd).toContain('codex exec --color never');
  });

  it('handles tasks with special characters', () => {
    const cmd = buildTerminalCommand({
      agentId: 'test:abc:def',
      toolId: 'test',
      cwd: '/project',
      cmd: 'claude',
      args: [],
      task: "fix the user's auth flow",
    });

    // Should be properly quoted
    expect(cmd).toContain('claude');
    expect(cmd).not.toContain('undefined');
  });
});

describe('pidfile operations', () => {
  const testAgentId = 'test-agent:abc:def';
  const safeName = testAgentId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const pidPath = join(PIDS_DIR, `${safeName}.pid`);

  beforeEach(() => {
    mkdirSync(PIDS_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      unlinkSync(pidPath);
    } catch {
      /* cleanup best effort */
    }
  });

  it('reads a valid pidfile', () => {
    writeFileSync(pidPath, '12345\n');
    expect(readPidFile(testAgentId)).toBe(12345);
  });

  it('returns null for missing pidfile', () => {
    expect(readPidFile('nonexistent:agent:id')).toBeNull();
  });

  it('returns null for corrupt pidfile', () => {
    writeFileSync(pidPath, 'not-a-number\n');
    expect(readPidFile(testAgentId)).toBeNull();
  });

  it('cleans up pidfile', () => {
    writeFileSync(pidPath, '12345\n');
    cleanPidFile(testAgentId);
    expect(existsSync(pidPath)).toBe(false);
  });
});

describe('isProcessAlive', () => {
  it('returns true for current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for non-existent PID', () => {
    expect(isProcessAlive(999999999)).toBe(false);
  });
});
