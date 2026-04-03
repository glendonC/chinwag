import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';

// This test imports hook.js to get v8 coverage on the entry point.
// We need to mock everything before the dynamic import.

// Mock all dependencies using paths that match hook.js imports
// hook.js is at packages/mcp/hook.js and imports from ./dist/*
vi.mock('../../dist/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({ token: 'tok_test' }),
  configExists: vi.fn().mockReturnValue(true),
}));

vi.mock('../../dist/api.js', () => ({
  api: vi.fn().mockReturnValue({}),
}));

vi.mock('../../dist/team.js', () => ({
  findTeamFile: vi.fn().mockReturnValue('t_abc'),
  teamHandlers: vi.fn().mockReturnValue({
    checkConflicts: vi.fn().mockResolvedValue({ conflicts: [], locked: [] }),
    reportFile: vi.fn().mockResolvedValue({ ok: true }),
    recordEdit: vi.fn().mockResolvedValue({ ok: true }),
    joinTeam: vi.fn().mockResolvedValue({ ok: true }),
    getTeamContext: vi.fn().mockResolvedValue({ members: [] }),
  }),
}));

vi.mock('../../dist/identity.js', () => ({
  detectRuntimeIdentity: vi.fn().mockReturnValue({
    hostTool: 'claude-code',
    agentSurface: null,
    transport: 'hook',
    tier: 'managed',
    capabilities: ['hooks'],
    detectionSource: 'explicit',
    detectionConfidence: 1,
  }),
}));

vi.mock('../../dist/lifecycle.js', () => ({
  resolveAgentIdentity: vi.fn().mockReturnValue({
    agentId: 'claude-code:abc123',
    fallbackAgentId: 'claude-code:abc123',
    hasExactSession: false,
  }),
}));

vi.mock('../../dist/utils/formatting.js', () => ({
  formatWho: vi.fn((handle, tool) => {
    if (tool && tool !== 'unknown') return `${handle} (${tool})`;
    return handle;
  }),
}));

vi.mock('../../dist/utils/display.js', () => ({
  formatTeamContextDisplay: vi.fn().mockReturnValue([]),
}));

import { configExists, loadConfig } from '../../dist/config.js';
import { findTeamFile, teamHandlers } from '../../dist/team.js';
import { resolveAgentIdentity } from '../../dist/lifecycle.js';

describe('hook.js entry point coverage', () => {
  let originalArgv;
  let originalStdin;
  let exitSpy;
  let consoleSpy;
  let stdoutWriteSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    originalArgv = process.argv;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.argv = originalArgv;
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
  });

  it('exits 0 when configExists returns false (check-conflict)', async () => {
    configExists.mockReturnValue(false);
    process.argv = ['node', 'hook.js', 'check-conflict'];

    // Create a fake stdin that emits end immediately
    const fakeStdin = new Readable({
      read() {
        this.push(null);
      },
    });
    Object.defineProperty(process, 'stdin', {
      value: fakeStdin,
      writable: true,
      configurable: true,
    });

    vi.resetModules();
    await import('../../hook.js');

    // Wait for async main() to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(exitSpy).toHaveBeenCalledWith(0);

    // Restore stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin || process.stdin,
      writable: true,
      configurable: true,
    });
  });

  it('exits 0 when config has no token (report-edit)', async () => {
    configExists.mockReturnValue(true);
    loadConfig.mockReturnValue({});
    process.argv = ['node', 'hook.js', 'report-edit'];

    const fakeStdin = new Readable({
      read() {
        this.push(null);
      },
    });
    Object.defineProperty(process, 'stdin', {
      value: fakeStdin,
      writable: true,
      configurable: true,
    });

    vi.resetModules();
    await import('../../hook.js');
    await new Promise((r) => setTimeout(r, 50));

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits 0 when no team file found', async () => {
    configExists.mockReturnValue(true);
    loadConfig.mockReturnValue({ token: 'tok_test' });
    findTeamFile.mockReturnValue(null);
    process.argv = ['node', 'hook.js', 'session-start'];

    const fakeStdin = new Readable({
      read() {
        this.push(null);
      },
    });
    Object.defineProperty(process, 'stdin', {
      value: fakeStdin,
      writable: true,
      configurable: true,
    });

    vi.resetModules();
    await import('../../hook.js');
    await new Promise((r) => setTimeout(r, 50));

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('runs check-conflict with no conflicts', async () => {
    configExists.mockReturnValue(true);
    loadConfig.mockReturnValue({ token: 'tok_test' });
    findTeamFile.mockReturnValue('t_abc');
    const team = teamHandlers();
    team.checkConflicts.mockResolvedValue({ conflicts: [], locked: [] });
    process.argv = ['node', 'hook.js', 'check-conflict'];

    const data = JSON.stringify({ tool_input: { file_path: 'src/auth.js' } });
    const fakeStdin = new Readable({
      read() {
        this.push(data);
        this.push(null);
      },
    });
    // Expose setEncoding and listeners like real stdin
    fakeStdin.setEncoding =
      fakeStdin.setEncoding ||
      function (enc) {
        this._readableState.encoding = enc;
        return this;
      };
    Object.defineProperty(process, 'stdin', {
      value: fakeStdin,
      writable: true,
      configurable: true,
    });

    vi.resetModules();
    await import('../../hook.js');
    await new Promise((r) => setTimeout(r, 100));

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('runs check-conflict with conflicts detected', async () => {
    configExists.mockReturnValue(true);
    loadConfig.mockReturnValue({ token: 'tok_test' });
    findTeamFile.mockReturnValue('t_abc');
    const team = teamHandlers();
    team.checkConflicts.mockResolvedValue({
      conflicts: [
        {
          owner_handle: 'alice',
          tool: 'cursor',
          files: ['src/auth.js'],
          summary: 'Fixing login',
        },
      ],
      locked: [],
    });
    process.argv = ['node', 'hook.js', 'check-conflict'];

    const data = JSON.stringify({ tool_input: { file_path: 'src/auth.js' } });
    const fakeStdin = new Readable({
      read() {
        this.push(data);
        this.push(null);
      },
    });
    fakeStdin.setEncoding =
      fakeStdin.setEncoding ||
      function (enc) {
        return this;
      };
    Object.defineProperty(process, 'stdin', {
      value: fakeStdin,
      writable: true,
      configurable: true,
    });

    vi.resetModules();
    await import('../../hook.js');
    await new Promise((r) => setTimeout(r, 100));

    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('CONFLICT:'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('runs report-edit successfully', async () => {
    configExists.mockReturnValue(true);
    loadConfig.mockReturnValue({ token: 'tok_test' });
    findTeamFile.mockReturnValue('t_abc');
    const team = teamHandlers();
    process.argv = ['node', 'hook.js', 'report-edit'];

    const data = JSON.stringify({ tool_input: { file_path: 'src/auth.js' } });
    const fakeStdin = new Readable({
      read() {
        this.push(data);
        this.push(null);
      },
    });
    fakeStdin.setEncoding =
      fakeStdin.setEncoding ||
      function (enc) {
        return this;
      };
    Object.defineProperty(process, 'stdin', {
      value: fakeStdin,
      writable: true,
      configurable: true,
    });

    vi.resetModules();
    await import('../../hook.js');
    await new Promise((r) => setTimeout(r, 100));

    expect(team.reportFile).toHaveBeenCalled();
    expect(team.recordEdit).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('runs session-start and displays context', async () => {
    configExists.mockReturnValue(true);
    loadConfig.mockReturnValue({ token: 'tok_test' });
    findTeamFile.mockReturnValue('t_abc');
    resolveAgentIdentity.mockReturnValue({
      agentId: 'claude-code:abc123',
      hasExactSession: true,
    });
    const team = teamHandlers();
    team.getTeamContext.mockResolvedValue({
      members: [{ handle: 'alice', status: 'active' }],
    });
    process.argv = ['node', 'hook.js', 'session-start'];

    const fakeStdin = new Readable({
      read() {
        this.push(null);
      },
    });
    fakeStdin.setEncoding =
      fakeStdin.setEncoding ||
      function (enc) {
        return this;
      };
    Object.defineProperty(process, 'stdin', {
      value: fakeStdin,
      writable: true,
      configurable: true,
    });

    vi.resetModules();
    await import('../../hook.js');
    await new Promise((r) => setTimeout(r, 100));

    expect(team.joinTeam).toHaveBeenCalled();
    expect(team.getTeamContext).toHaveBeenCalled();
    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('chinwag team context'));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits 1 for unknown subcommand', async () => {
    configExists.mockReturnValue(true);
    loadConfig.mockReturnValue({ token: 'tok_test' });
    findTeamFile.mockReturnValue('t_abc');
    process.argv = ['node', 'hook.js', 'unknown-command'];

    const fakeStdin = new Readable({
      read() {
        this.push(null);
      },
    });
    fakeStdin.setEncoding =
      fakeStdin.setEncoding ||
      function (enc) {
        return this;
      };
    Object.defineProperty(process, 'stdin', {
      value: fakeStdin,
      writable: true,
      configurable: true,
    });

    vi.resetModules();
    await import('../../hook.js');
    await new Promise((r) => setTimeout(r, 100));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown hook subcommand'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
