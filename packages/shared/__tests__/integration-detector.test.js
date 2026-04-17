import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { commandExists, detectHost, detectHostIntegrations } from '../integration-detector.js';
import { EXEC_TIMEOUT_MS } from '../constants.js';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

describe('integration-detector', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
    existsSync.mockReturnValue(false);
    execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  // ---------------------------------------------------------------------------
  // commandExists
  // ---------------------------------------------------------------------------
  describe('commandExists', () => {
    it('returns true when which finds the command', () => {
      execFileSync.mockImplementation(() => '/usr/bin/claude');
      expect(commandExists('claude')).toBe(true);
    });

    it('returns false when which throws (command not found)', () => {
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      expect(commandExists('nonexistent')).toBe(false);
    });

    it('uses "which" on non-Windows platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      execFileSync.mockImplementation(() => '/usr/bin/test');

      commandExists('test-cmd');
      expect(execFileSync).toHaveBeenCalledWith('which', ['test-cmd'], expect.any(Object));
    });

    it('uses "where" on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      execFileSync.mockImplementation(() => 'C:\\cmd.exe');

      commandExists('cmd');
      expect(execFileSync).toHaveBeenCalledWith('where', ['cmd'], expect.any(Object));
    });

    it('passes stdio: "ignore" to suppress output', () => {
      execFileSync.mockImplementation(() => '');

      commandExists('something');
      expect(execFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ stdio: 'ignore' }),
      );
    });

    it('uses the shared EXEC_TIMEOUT_MS constant', () => {
      execFileSync.mockImplementation(() => '');

      commandExists('cmd');
      // Assert the call wires through the shared constant rather than a
      // hardcoded number so the timeout can be tuned in one place.
      expect(execFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ timeout: EXEC_TIMEOUT_MS }),
      );
    });

    it('returns true even if execFileSync returns empty string (command exists but no output)', () => {
      execFileSync.mockReturnValue('');
      expect(commandExists('silent-cmd')).toBe(true);
    });

    it('returns false when execFileSync throws a timeout error', () => {
      const err = new Error('ETIMEDOUT');
      err.code = 'ETIMEDOUT';
      execFileSync.mockImplementation(() => {
        throw err;
      });
      expect(commandExists('slow-cmd')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // detectHost
  // ---------------------------------------------------------------------------
  describe('detectHost', () => {
    it('returns true when a detect dir exists', () => {
      existsSync.mockImplementation((path) => path === '/project/.claude');

      const host = { detect: { dirs: ['.claude'], cmds: [] } };
      expect(detectHost('/project', host)).toBe(true);
    });

    it('returns true when a detect command exists', () => {
      execFileSync.mockImplementation((bin, [cmd]) => {
        if (cmd === 'claude') return '/usr/bin/claude';
        throw new Error('not found');
      });

      const host = { detect: { dirs: [], cmds: ['claude'] } };
      expect(detectHost('/project', host)).toBe(true);
    });

    it('returns false when neither dirs nor cmds are detected', () => {
      const host = { detect: { dirs: ['.cursor'], cmds: ['cursor'] } };
      expect(detectHost('/project', host)).toBe(false);
    });

    it('returns true when any one of multiple dirs exists', () => {
      existsSync.mockImplementation((path) => path === '/project/.idea');

      const host = { detect: { dirs: ['.vscode', '.idea'], cmds: [] } };
      expect(detectHost('/project', host)).toBe(true);
    });

    it('returns true when any one of multiple cmds exists', () => {
      execFileSync.mockImplementation((bin, [cmd]) => {
        if (cmd === 'webstorm') return '/usr/bin/webstorm';
        throw new Error('not found');
      });

      const host = {
        detect: { dirs: [], cmds: ['idea', 'pycharm', 'webstorm'] },
      };
      expect(detectHost('/project', host)).toBe(true);
    });

    it('handles host with empty detect arrays', () => {
      const host = { detect: { dirs: [], cmds: [] } };
      expect(detectHost('/project', host)).toBe(false);
    });

    it('handles host with undefined detect.dirs', () => {
      const host = { detect: { cmds: ['claude'] } };
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      expect(detectHost('/project', host)).toBe(false);
    });

    it('handles host with undefined detect.cmds', () => {
      const host = { detect: { dirs: ['.claude'] } };
      existsSync.mockReturnValue(false);
      expect(detectHost('/project', host)).toBe(false);
    });

    it('handles host with no detect property at all', () => {
      const host = { detect: {} };
      expect(detectHost('/project', host)).toBe(false);
    });

    it('joins cwd with dir when checking existsSync', () => {
      existsSync.mockReturnValue(false);

      const host = { detect: { dirs: ['.cursor'], cmds: [] } };
      detectHost('/my/project', host);
      expect(existsSync).toHaveBeenCalledWith('/my/project/.cursor');
    });

    it('prioritizes dir detection (short-circuits before cmd check)', () => {
      existsSync.mockReturnValue(true);

      const host = { detect: { dirs: ['.claude'], cmds: ['claude'] } };
      detectHost('/project', host);
      // Since dir detection returns true, cmds should not be checked
      expect(execFileSync).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // detectHostIntegrations
  // ---------------------------------------------------------------------------
  describe('detectHostIntegrations', () => {
    it('returns empty array when nothing is detected', () => {
      const detected = detectHostIntegrations('/project');
      expect(detected).toEqual([]);
    });

    it('detects claude-code when .claude directory exists', () => {
      existsSync.mockImplementation((path) => path.endsWith('.claude'));

      const detected = detectHostIntegrations('/project');
      const ids = detected.map((h) => h.id);
      expect(ids).toContain('claude-code');
    });

    it('detects cursor when .cursor directory exists', () => {
      existsSync.mockImplementation((path) => path.endsWith('.cursor'));

      const detected = detectHostIntegrations('/project');
      const ids = detected.map((h) => h.id);
      expect(ids).toContain('cursor');
    });

    it('detects multiple hosts simultaneously', () => {
      existsSync.mockImplementation((path) => {
        return path.endsWith('.claude') || path.endsWith('.cursor') || path.endsWith('.vscode');
      });

      const detected = detectHostIntegrations('/project');
      const ids = detected.map((h) => h.id);
      expect(ids).toContain('claude-code');
      expect(ids).toContain('cursor');
      expect(ids).toContain('vscode');
    });

    it('detects host by command presence', () => {
      execFileSync.mockImplementation((bin, [cmd]) => {
        if (cmd === 'cursor') return '';
        throw new Error('not found');
      });

      const detected = detectHostIntegrations('/project');
      const ids = detected.map((h) => h.id);
      expect(ids).toContain('cursor');
    });

    it('returns host integration objects with expected shape', () => {
      existsSync.mockImplementation((path) => path.endsWith('.claude'));

      const detected = detectHostIntegrations('/project');
      const cc = detected.find((h) => h.id === 'claude-code');
      expect(cc).toBeDefined();
      expect(cc.name).toBe('Claude Code');
      expect(cc.mcpConfig).toBe('.mcp.json');
      expect(cc.detect).toBeDefined();
    });

    it('detects windsurf when .windsurf directory exists', () => {
      existsSync.mockImplementation((path) => path.endsWith('.windsurf'));

      const detected = detectHostIntegrations('/project');
      const ids = detected.map((h) => h.id);
      expect(ids).toContain('windsurf');
    });

    it('detects jetbrains when .idea directory exists', () => {
      existsSync.mockImplementation((path) => path.endsWith('.idea'));

      const detected = detectHostIntegrations('/project');
      const ids = detected.map((h) => h.id);
      expect(ids).toContain('jetbrains');
    });

    it('detects codex when codex command exists', () => {
      execFileSync.mockImplementation((bin, [cmd]) => {
        if (cmd === 'codex') return '/usr/bin/codex';
        throw new Error('not found');
      });

      const detected = detectHostIntegrations('/project');
      const ids = detected.map((h) => h.id);
      expect(ids).toContain('codex');
    });

    it('detects aider when aider command exists', () => {
      execFileSync.mockImplementation((bin, [cmd]) => {
        if (cmd === 'aider') return '/usr/bin/aider';
        throw new Error('not found');
      });

      const detected = detectHostIntegrations('/project');
      const ids = detected.map((h) => h.id);
      expect(ids).toContain('aider');
    });

    it('detects amazon-q when q command exists', () => {
      execFileSync.mockImplementation((bin, [cmd]) => {
        if (cmd === 'q') return '/usr/bin/q';
        throw new Error('not found');
      });

      const detected = detectHostIntegrations('/project');
      const ids = detected.map((h) => h.id);
      expect(ids).toContain('amazon-q');
    });
  });
});
