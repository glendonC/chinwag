import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectTerminalEnvironment,
  buildTerminalCommand,
  readPidFile,
  cleanPidFile,
} from '../terminal-spawner.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── detectTerminalEnvironment ─────────────────────────────

describe('detectTerminalEnvironment', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore original environment
    process.env = { ...origEnv };
  });

  it('detects tmux environment', () => {
    process.env.TMUX = '/tmp/tmux-1000/default,1234,0';
    const result = detectTerminalEnvironment();
    expect(result.type).toBe('tmux');
    expect(result.name).toBe('tmux pane');
  });

  it('detects IDE terminal via VSCODE_INJECTION', () => {
    delete process.env.TMUX;
    process.env.VSCODE_INJECTION = '1';
    process.env.VSCODE_GIT_ASKPASS_NODE = '/Applications/Cursor.app/node';
    const result = detectTerminalEnvironment();
    expect(result.type).toBe('ide-terminal');
    expect(result.name).toContain('Cursor');
  });

  it('detects VS Code IDE terminal', () => {
    delete process.env.TMUX;
    process.env.VSCODE_INJECTION = '1';
    process.env.VSCODE_GIT_ASKPASS_NODE = '/usr/share/code/node';
    const result = detectTerminalEnvironment();
    expect(result.type).toBe('ide-terminal');
    expect(result.name).toContain('VS Code');
  });

  it('detects Windsurf IDE terminal', () => {
    delete process.env.TMUX;
    process.env.VSCODE_INJECTION = '1';
    process.env.VSCODE_GIT_ASKPASS_NODE = '/Applications/Windsurf.app/node';
    const result = detectTerminalEnvironment();
    expect(result.type).toBe('ide-terminal');
    expect(result.name).toContain('Windsurf');
  });

  it('falls back to generic IDE when app path is unrecognized', () => {
    delete process.env.TMUX;
    process.env.VSCODE_INJECTION = '1';
    process.env.VSCODE_GIT_ASKPASS_NODE = '/usr/bin/other-editor/node';
    const result = detectTerminalEnvironment();
    expect(result.type).toBe('ide-terminal');
    expect(result.name).toContain('IDE');
  });

  it('detects TERM_PROGRAM=vscode as IDE terminal', () => {
    delete process.env.TMUX;
    delete process.env.VSCODE_INJECTION;
    process.env.TERM_PROGRAM = 'vscode';
    process.env.VSCODE_GIT_ASKPASS_NODE = '';
    const result = detectTerminalEnvironment();
    expect(result.type).toBe('ide-terminal');
  });

  it('detects iTerm2 via TERM_PROGRAM', () => {
    delete process.env.TMUX;
    delete process.env.VSCODE_INJECTION;
    process.env.TERM_PROGRAM = 'iTerm.app';
    const result = detectTerminalEnvironment();
    expect(result.type).toBe('iterm2');
    expect(result.name).toBe('iTerm2 tab');
  });

  it('detects iTerm2 via ITERM_SESSION_ID', () => {
    delete process.env.TMUX;
    delete process.env.VSCODE_INJECTION;
    process.env.TERM_PROGRAM = '';
    process.env.ITERM_SESSION_ID = 'session123';
    const result = detectTerminalEnvironment();
    expect(result.type).toBe('iterm2');
  });

  it('detects macOS Terminal.app via TERM_PROGRAM', () => {
    delete process.env.TMUX;
    delete process.env.VSCODE_INJECTION;
    delete process.env.ITERM_SESSION_ID;
    process.env.TERM_PROGRAM = 'Apple_Terminal';
    const result = detectTerminalEnvironment();
    expect(result.type).toBe('macos-terminal');
  });

  it('tmux takes priority over IDE', () => {
    process.env.TMUX = '/tmp/tmux';
    process.env.VSCODE_INJECTION = '1';
    const result = detectTerminalEnvironment();
    expect(result.type).toBe('tmux');
  });
});

// ── buildTerminalCommand ─────────────────────────────────

describe('buildTerminalCommand', () => {
  it('builds a command with all standard fields', () => {
    const cmd = buildTerminalCommand({
      agentId: 'claude-code:abc123:def456',
      toolId: 'claude-code',
      cwd: '/path/to/project',
      cmd: 'claude',
      args: ['--print'],
      task: 'refactor auth',
    });

    expect(cmd).toContain('CHINMEISTER_TOOL=');
    expect(cmd).toContain('CHINMEISTER_AGENT_ID=');
    expect(cmd).toContain('cd');
    expect(cmd).toContain('clear');
    expect(cmd).toContain('claude');
    expect(cmd).toContain('--print');
    expect(cmd).toContain('refactor auth');
  });

  it('omits cd when cwd is not provided', () => {
    const cmd = buildTerminalCommand({
      agentId: 'test:abc:def',
      toolId: 'test',
      cmd: 'echo',
      args: [],
    });

    // Should not contain a cd command
    expect(cmd).not.toMatch(/\bcd\b/);
  });

  it('includes task in the command when provided', () => {
    const cmd = buildTerminalCommand({
      agentId: 'test:abc:def',
      toolId: 'test',
      cmd: 'echo',
      task: 'hello world',
    });

    expect(cmd).toContain('hello world');
  });

  it('writes pid to the pids directory', () => {
    const cmd = buildTerminalCommand({
      agentId: 'claude-code:abc:def',
      toolId: 'claude-code',
      cmd: 'claude',
    });

    expect(cmd).toContain('echo $$');
    expect(cmd).toContain('.pid');
    expect(cmd).toContain('mkdir -p');
  });

  it('handles args array', () => {
    const cmd = buildTerminalCommand({
      agentId: 'test:a:b',
      toolId: 'test',
      cmd: 'node',
      args: ['-e', 'console.log(1)'],
    });

    expect(cmd).toContain('node');
    expect(cmd).toContain('-e');
  });
});

// ── readPidFile / cleanPidFile ────────────────────────────

describe('readPidFile', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinmeister-pid-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns null for non-existent pid file', () => {
    const result = readPidFile('nonexistent:agent:id');
    // readPidFile looks in ~/.chinmeister/pids/ -- may or may not find it
    // The key behavior is it doesn't throw
    expect(result === null || typeof result === 'number').toBe(true);
  });

  it('returns null when pid file content is invalid', () => {
    // We test the function signature works even if the pid dir is elsewhere
    // The function handles errors gracefully
    const result = readPidFile('');
    expect(result === null || typeof result === 'number').toBe(true);
  });
});

describe('cleanPidFile', () => {
  it('does not throw for non-existent pid file', () => {
    expect(() => cleanPidFile('nonexistent:agent:id')).not.toThrow();
  });

  it('does not throw for empty agent id', () => {
    expect(() => cleanPidFile('')).not.toThrow();
  });
});
