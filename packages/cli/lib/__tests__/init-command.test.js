import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock the API module
vi.mock('../api.js', () => ({
  api: vi.fn(),
  initAccount: vi.fn(),
}));

// Mock the config module
vi.mock('../config.js', () => ({
  configExists: vi.fn(),
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

// Mock the mcp-config module
vi.mock('../mcp-config.js', () => ({
  detectTools: vi.fn(),
  configureTool: vi.fn(),
}));

import { api, initAccount } from '../api.js';
import { configExists, loadConfig, saveConfig } from '../config.js';
import { detectTools, configureTool } from '../mcp-config.js';
import { runInit } from '../commands/init.js';

let tmpDir;

// Suppress console.log during tests
let consoleLogSpy;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinwag-init-test-'));
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  // Default: no tools detected
  detectTools.mockReturnValue([]);
  configureTool.mockReturnValue({ ok: true, name: 'Tool', detail: 'path' });
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helper to create a mock API client with chainable methods
function createMockApiClient(overrides = {}) {
  return {
    get: vi.fn().mockResolvedValue({ handle: 'glendon', color: 'cyan' }),
    post: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

describe('runInit', () => {
  describe('account setup', () => {
    it('creates account when no config exists', async () => {
      configExists.mockReturnValue(false);
      initAccount.mockResolvedValue({ token: 'tok_new', handle: 'newuser', color: 'green' });

      const mockClient = createMockApiClient({
        post: vi.fn().mockResolvedValueOnce({ team_id: 't_new123' }).mockResolvedValue({ ok: true }),
      });
      api.mockReturnValue(mockClient);

      // Need to create a .chinwag-less dir to trigger team creation
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        await runInit();
      } finally {
        process.chdir(origCwd);
      }

      expect(initAccount).toHaveBeenCalled();
      expect(saveConfig).toHaveBeenCalledWith({ token: 'tok_new', handle: 'newuser', color: 'green' });
    });

    it('uses existing config when it exists and is valid', async () => {
      configExists.mockReturnValue(true);
      loadConfig.mockReturnValue({ token: 'tok_existing', handle: 'glendon' });

      const mockClient = createMockApiClient({
        post: vi.fn().mockResolvedValueOnce({ team_id: 't_abc' }).mockResolvedValue({ ok: true }),
      });
      api.mockReturnValue(mockClient);

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        await runInit();
      } finally {
        process.chdir(origCwd);
      }

      expect(initAccount).not.toHaveBeenCalled();
      expect(saveConfig).not.toHaveBeenCalled();
    });

    it('recreates account when existing token is invalid (401)', async () => {
      configExists.mockReturnValue(true);
      loadConfig.mockReturnValue({ token: 'tok_expired' });

      const err401 = new Error('Unauthorized');
      err401.status = 401;

      const mockClient = createMockApiClient({
        get: vi.fn().mockRejectedValue(err401),
        post: vi.fn().mockResolvedValueOnce({ team_id: 't_new' }).mockResolvedValue({ ok: true }),
      });
      api.mockReturnValue(mockClient);
      initAccount.mockResolvedValue({ token: 'tok_fresh', handle: 'newuser', color: 'red' });

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        await runInit();
      } finally {
        process.chdir(origCwd);
      }

      expect(initAccount).toHaveBeenCalled();
      expect(saveConfig).toHaveBeenCalledWith({ token: 'tok_fresh', handle: 'newuser', color: 'red' });
    });

    it('handles server unreachable gracefully', async () => {
      configExists.mockReturnValue(true);
      loadConfig.mockReturnValue({ token: 'tok_ok' });

      const errNetwork = new Error('Network error');
      errNetwork.status = 0;

      const mockClient = createMockApiClient({ get: vi.fn().mockRejectedValue(errNetwork) });
      api.mockReturnValue(mockClient);

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        await runInit();
      } finally {
        process.chdir(origCwd);
      }

      // Should print error, not crash
      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/Could not reach server/);
    });
  });

  describe('team setup', () => {
    beforeEach(() => {
      configExists.mockReturnValue(true);
      loadConfig.mockReturnValue({ token: 'tok_ok', handle: 'glendon' });
    });

    it('joins existing team when .chinwag file exists', async () => {
      const chinwagFile = path.join(tmpDir, '.chinwag');
      fs.writeFileSync(chinwagFile, JSON.stringify({ team: 't_existing', name: 'my-project' }));

      const mockClient = createMockApiClient();
      api.mockReturnValue(mockClient);

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        await runInit();
      } finally {
        process.chdir(origCwd);
      }

      expect(mockClient.post).toHaveBeenCalledWith(
        '/teams/t_existing/join',
        expect.objectContaining({ name: expect.any(String) })
      );
    });

    it('creates new team when no .chinwag file', async () => {
      const mockClient = createMockApiClient({
        post: vi.fn()
          .mockResolvedValueOnce({ team_id: 't_created' }) // POST /teams
          .mockResolvedValue({ ok: true }), // POST /teams/:id/join
      });
      api.mockReturnValue(mockClient);

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        await runInit();
      } finally {
        process.chdir(origCwd);
      }

      expect(mockClient.post).toHaveBeenCalledWith('/teams', expect.objectContaining({ name: expect.any(String) }));

      // .chinwag file should be created
      const chinwagFile = path.join(tmpDir, '.chinwag');
      expect(fs.existsSync(chinwagFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(chinwagFile, 'utf-8'));
      expect(content.team).toBe('t_created');
    });

    it('handles team join 404 error', async () => {
      const chinwagFile = path.join(tmpDir, '.chinwag');
      fs.writeFileSync(chinwagFile, JSON.stringify({ team: 't_stale' }));

      const err404 = new Error('Not Found');
      err404.status = 404;

      const mockClient = createMockApiClient({
        post: vi.fn().mockRejectedValue(err404),
      });
      api.mockReturnValue(mockClient);

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        await runInit();
      } finally {
        process.chdir(origCwd);
      }

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/Failed to join team/);
      expect(logCalls).toMatch(/stale/i);
    });

    it('handles team creation rate limit', async () => {
      const err429 = new Error('Rate limit');
      err429.status = 429;

      const mockClient = createMockApiClient({
        post: vi.fn().mockRejectedValue(err429),
      });
      api.mockReturnValue(mockClient);

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        await runInit();
      } finally {
        process.chdir(origCwd);
      }

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/Failed to create team/);
    });
  });

  describe('tool configuration', () => {
    beforeEach(() => {
      configExists.mockReturnValue(true);
      loadConfig.mockReturnValue({ token: 'tok_ok', handle: 'glendon' });
    });

    it('writes MCP config files for detected tools', async () => {
      detectTools.mockReturnValue([
        { id: 'cursor', name: 'Cursor' },
        { id: 'claude-code', name: 'Claude Code' },
      ]);
      configureTool.mockReturnValueOnce({ ok: true, name: 'Cursor', detail: '.cursor/mcp.json' })
        .mockReturnValueOnce({ ok: true, name: 'Claude Code', detail: '.mcp.json + hooks + channel' });

      const mockClient = createMockApiClient({
        post: vi.fn().mockResolvedValueOnce({ team_id: 't_tools' }).mockResolvedValue({ ok: true }),
      });
      api.mockReturnValue(mockClient);

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      const resolvedCwd = process.cwd(); // macOS resolves /var -> /private/var
      try {
        await runInit();
      } finally {
        process.chdir(origCwd);
      }

      expect(configureTool).toHaveBeenCalledWith(resolvedCwd, 'cursor');
      expect(configureTool).toHaveBeenCalledWith(resolvedCwd, 'claude-code');

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/Configured 2 tools/);
    });

    it('handles configuration failure for individual tools', async () => {
      detectTools.mockReturnValue([
        { id: 'badtool', name: 'BadTool' },
      ]);
      configureTool.mockReturnValue({ error: 'Permission denied' });

      const mockClient = createMockApiClient({
        post: vi.fn().mockResolvedValueOnce({ team_id: 't_x' }).mockResolvedValue({ ok: true }),
      });
      api.mockReturnValue(mockClient);

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        await runInit();
      } finally {
        process.chdir(origCwd);
      }

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/Could not configure BadTool/);
    });

    it('shows "no tools detected" message when empty', async () => {
      detectTools.mockReturnValue([]);

      const mockClient = createMockApiClient({
        post: vi.fn().mockResolvedValueOnce({ team_id: 't_empty' }).mockResolvedValue({ ok: true }),
      });
      api.mockReturnValue(mockClient);

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        await runInit();
      } finally {
        process.chdir(origCwd);
      }

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/No tools detected/);
    });
  });
});
