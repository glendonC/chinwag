import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import {
  commandExists,
  buildChinmeisterCliArgs,
  buildChinmeisterHookCommand,
  detectHostIntegrations,
  formatIntegrationScanResults,
  summarizeIntegrationScan,
  writeMcpConfig,
  writeHooksConfig,
  configureHostIntegration,
  scanHostIntegrations,
} from '../integration-doctor.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

describe('integration-doctor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    existsSync.mockReturnValue(false);
    readFileSync.mockReturnValue('{}');
  });

  // ---------------------------------------------------------------------------
  // Re-exported functions (smoke tests; detailed tests in dedicated files)
  // ---------------------------------------------------------------------------
  describe('re-exported commandExists', () => {
    it('returns true when which finds the command', () => {
      execFileSync.mockImplementation(() => {});
      expect(commandExists('claude')).toBe(true);
    });

    it('returns false when which throws', () => {
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      expect(commandExists('nonexistent')).toBe(false);
    });
  });

  describe('re-exported buildChinmeisterCliArgs', () => {
    it('builds basic args with subcommand', () => {
      expect(buildChinmeisterCliArgs('mcp')).toEqual(['-y', 'chinmeister', 'mcp']);
    });

    it('includes --tool when hostId is provided', () => {
      expect(buildChinmeisterCliArgs('mcp', { hostId: 'cursor' })).toEqual([
        '-y',
        'chinmeister',
        'mcp',
        '--tool',
        'cursor',
      ]);
    });

    it('includes --surface when surfaceId is provided', () => {
      expect(buildChinmeisterCliArgs('mcp', { surfaceId: 'cline' })).toEqual([
        '-y',
        'chinmeister',
        'mcp',
        '--surface',
        'cline',
      ]);
    });

    it('includes both --tool and --surface', () => {
      expect(
        buildChinmeisterCliArgs('channel', { hostId: 'vscode', surfaceId: 'continue' }),
      ).toEqual(['-y', 'chinmeister', 'channel', '--tool', 'vscode', '--surface', 'continue']);
    });
  });

  describe('re-exported buildChinmeisterHookCommand', () => {
    it('builds basic hook command for claude-code', () => {
      expect(buildChinmeisterHookCommand('check-conflict')).toBe(
        'npx -y chinmeister hook check-conflict',
      );
    });

    it('includes --tool when hostId is not claude-code', () => {
      expect(buildChinmeisterHookCommand('check-conflict', { hostId: 'cursor' })).toBe(
        'npx -y chinmeister hook check-conflict --tool cursor',
      );
    });

    it('omits --tool when hostId is claude-code (default)', () => {
      expect(buildChinmeisterHookCommand('report-edit', { hostId: 'claude-code' })).toBe(
        'npx -y chinmeister hook report-edit',
      );
    });

    it('includes --surface when surfaceId is provided', () => {
      expect(buildChinmeisterHookCommand('session-start', { surfaceId: 'cline' })).toBe(
        'npx -y chinmeister hook session-start --surface cline',
      );
    });
  });

  describe('re-exported detectHostIntegrations', () => {
    it('detects host when directory exists', () => {
      existsSync.mockImplementation((path) => path.endsWith('.claude'));
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const detected = detectHostIntegrations('/project');
      const ids = detected.map((h) => h.id);
      expect(ids).toContain('claude-code');
    });

    it('detects host when command exists', () => {
      execFileSync.mockImplementation((bin, [cmd]) => {
        if (cmd === 'claude') return '';
        throw new Error('not found');
      });

      const detected = detectHostIntegrations('/project');
      const ids = detected.map((h) => h.id);
      expect(ids).toContain('claude-code');
    });

    it('returns empty array when nothing is detected', () => {
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      expect(detectHostIntegrations('/project')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // formatIntegrationScanResults
  // ---------------------------------------------------------------------------
  describe('formatIntegrationScanResults', () => {
    it('returns "no integrations" message for empty results', () => {
      const output = formatIntegrationScanResults([]);
      expect(output).toContain('No supported integrations');
    });

    it('formats detected integration with status, tier, config path, and capabilities', () => {
      const results = [
        {
          name: 'Claude Code',
          tier: 'managed',
          detected: true,
          status: 'ready',
          configPath: '.mcp.json',
          capabilities: ['mcp', 'hooks'],
          issues: [],
        },
      ];
      const output = formatIntegrationScanResults(results);
      expect(output).toContain('Claude Code');
      expect(output).toContain('managed');
      expect(output).toContain('ready');
      expect(output).toContain('.mcp.json');
      expect(output).toContain('mcp, hooks');
    });

    it('formats issues when present', () => {
      const results = [
        {
          name: 'Cursor',
          tier: 'connected',
          detected: true,
          status: 'needs_setup',
          configPath: '.cursor/mcp.json',
          capabilities: ['mcp'],
          issues: ['Missing or outdated config'],
        },
      ];
      const output = formatIntegrationScanResults(results);
      expect(output).toContain('issue: Missing or outdated config');
    });

    it('filters to only detected when onlyDetected is true', () => {
      const results = [
        {
          name: 'A',
          detected: true,
          status: 'ready',
          tier: 't',
          capabilities: [],
          issues: [],
          configPath: 'a',
        },
        {
          name: 'B',
          detected: false,
          status: 'not_detected',
          tier: 't',
          capabilities: [],
          issues: [],
        },
      ];
      const output = formatIntegrationScanResults(results, { onlyDetected: true });
      expect(output).toContain('A');
      expect(output).not.toContain('B');
    });

    it('returns "no integrations" when onlyDetected is true and none are detected', () => {
      const results = [
        {
          name: 'A',
          detected: false,
          status: 'not_detected',
          tier: 't',
          capabilities: [],
          issues: [],
        },
      ];
      const output = formatIntegrationScanResults(results, { onlyDetected: true });
      expect(output).toContain('No supported integrations');
    });

    it('does not show config path for undetected integrations', () => {
      const results = [
        {
          name: 'Cursor',
          tier: 'connected',
          detected: false,
          status: 'not_detected',
          configPath: '.cursor/mcp.json',
          capabilities: ['mcp'],
          issues: [],
        },
      ];
      const output = formatIntegrationScanResults(results);
      expect(output).not.toContain('config:');
    });

    it('omits capability text when capabilities array is empty', () => {
      const results = [
        {
          name: 'Test',
          tier: 'connected',
          detected: true,
          status: 'ready',
          configPath: 'test.json',
          capabilities: [],
          issues: [],
        },
      ];
      const output = formatIntegrationScanResults(results);
      expect(output).not.toContain('()');
    });

    it('starts output with "Integrations:" header', () => {
      const results = [
        {
          name: 'Test',
          tier: 'connected',
          detected: false,
          status: 'not_detected',
          configPath: 'test.json',
          capabilities: [],
          issues: [],
        },
      ];
      const output = formatIntegrationScanResults(results);
      expect(output).toMatch(/^Integrations:/);
    });

    it('formats multiple issues', () => {
      const results = [
        {
          name: 'Test',
          tier: 'managed',
          detected: true,
          status: 'needs_repair',
          configPath: 'test.json',
          capabilities: ['mcp'],
          issues: ['Missing MCP config', 'Hooks are outdated'],
        },
      ];
      const output = formatIntegrationScanResults(results);
      expect(output).toContain('issue: Missing MCP config');
      expect(output).toContain('issue: Hooks are outdated');
    });
  });

  // ---------------------------------------------------------------------------
  // summarizeIntegrationScan
  // ---------------------------------------------------------------------------
  describe('summarizeIntegrationScan', () => {
    it('returns info tone for no detected integrations', () => {
      const summary = summarizeIntegrationScan([]);
      expect(summary.tone).toBe('info');
      expect(summary.text).toContain('No supported integrations');
    });

    it('returns success tone when all are ready', () => {
      const results = [
        { detected: true, status: 'ready' },
        { detected: true, status: 'ready' },
      ];
      const summary = summarizeIntegrationScan(results);
      expect(summary.tone).toBe('success');
      expect(summary.text).toContain('2 integrations ready');
    });

    it('returns success tone with singular for one ready', () => {
      const results = [{ detected: true, status: 'ready' }];
      const summary = summarizeIntegrationScan(results);
      expect(summary.text).toContain('1 integration ready');
    });

    it('returns warning tone when some need attention', () => {
      const results = [
        { detected: true, status: 'ready' },
        { detected: true, status: 'needs_setup' },
      ];
      const summary = summarizeIntegrationScan(results);
      expect(summary.tone).toBe('warning');
      expect(summary.text).toContain('1 ready');
      expect(summary.text).toContain('1 need attention');
    });

    it('filters to only detected by default', () => {
      const results = [
        { detected: true, status: 'ready' },
        { detected: false, status: 'not_detected' },
      ];
      const summary = summarizeIntegrationScan(results);
      expect(summary.text).toContain('1 integration ready');
    });

    it('includes undetected when onlyDetected is false', () => {
      const results = [
        { detected: true, status: 'ready' },
        { detected: false, status: 'not_detected' },
      ];
      const summary = summarizeIntegrationScan(results, { onlyDetected: false });
      expect(summary.tone).toBe('warning');
      expect(summary.text).toContain('1 ready');
      expect(summary.text).toContain('1 need attention');
    });

    it('returns warning when all detected need attention', () => {
      const results = [
        { detected: true, status: 'needs_setup' },
        { detected: true, status: 'needs_repair' },
      ];
      const summary = summarizeIntegrationScan(results);
      expect(summary.tone).toBe('warning');
      expect(summary.text).toContain('0 ready');
      expect(summary.text).toContain('2 need attention');
    });

    it('returns info when no results at all and onlyDetected is false', () => {
      const summary = summarizeIntegrationScan([], { onlyDetected: false });
      expect(summary.tone).toBe('info');
    });

    it('counts needs_repair as needing attention', () => {
      const results = [
        { detected: true, status: 'ready' },
        { detected: true, status: 'needs_repair' },
      ];
      const summary = summarizeIntegrationScan(results);
      expect(summary.tone).toBe('warning');
    });
  });

  // ---------------------------------------------------------------------------
  // Re-exported writeMcpConfig
  // ---------------------------------------------------------------------------
  describe('re-exported writeMcpConfig', () => {
    it('writes chinmeister MCP entry to config file', () => {
      readFileSync.mockReturnValue('{}');

      const result = writeMcpConfig('/project', '.cursor/mcp.json', { hostId: 'cursor' });
      expect(result).toEqual({ ok: true });
      expect(writeFileSync).toHaveBeenCalled();

      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinmeister).toBeDefined();
      expect(writtenContent.mcpServers.chinmeister.command).toBe('npx');
      expect(writtenContent.mcpServers.chinmeister.args).toContain('--tool');
      expect(writtenContent.mcpServers.chinmeister.args).toContain('cursor');
    });

    it('returns error when writeFileSync throws', () => {
      readFileSync.mockReturnValue('{}');
      writeFileSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      const result = writeMcpConfig('/project', '.cursor/mcp.json');
      expect(result.error).toContain('Failed to write');
    });
  });

  // ---------------------------------------------------------------------------
  // Re-exported writeHooksConfig
  // ---------------------------------------------------------------------------
  describe('re-exported writeHooksConfig', () => {
    it('writes hook entries to .claude/settings.json', () => {
      readFileSync.mockReturnValue('{}');

      const result = writeHooksConfig('/project');
      expect(result).toEqual({ ok: true });

      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.hooks.PreToolUse).toBeDefined();
      expect(writtenContent.hooks.PostToolUse).toBeDefined();
      expect(writtenContent.hooks.SessionStart).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Re-exported configureHostIntegration
  // ---------------------------------------------------------------------------
  describe('re-exported configureHostIntegration', () => {
    it('returns error for unknown host ID', () => {
      const result = configureHostIntegration('/project', 'nonexistent');
      expect(result.error).toContain('Unknown host integration');
    });

    it('configures MCP for a basic host', () => {
      readFileSync.mockReturnValue('{}');

      const result = configureHostIntegration('/project', 'cursor');
      expect(result.ok).toBe(true);
      expect(result.name).toBe('Cursor');
    });

    it('configures MCP + hooks for claude-code', () => {
      readFileSync.mockReturnValue('{}');

      const result = configureHostIntegration('/project', 'claude-code');
      expect(result.ok).toBe(true);
      expect(result.detail).toContain('hooks');
      expect(result.detail).toContain('channel');
    });
  });

  // ---------------------------------------------------------------------------
  // scanHostIntegrations
  // ---------------------------------------------------------------------------
  describe('scanHostIntegrations', () => {
    it('returns an entry for every known host integration', () => {
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      readFileSync.mockReturnValue('{}');

      const results = scanHostIntegrations('/project');
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.id).toEqual(expect.any(String));
        expect(r.name).toEqual(expect.any(String));
        expect(r.detected).toBe(false);
        expect(r.status).toBe('not_detected');
      }
    });

    it('each result has expected fields', () => {
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      readFileSync.mockReturnValue('{}');

      const results = scanHostIntegrations('/project');
      for (const r of results) {
        expect(r).toHaveProperty('id');
        expect(r).toHaveProperty('name');
        expect(r).toHaveProperty('tier');
        expect(r).toHaveProperty('capabilities');
        expect(r).toHaveProperty('detected');
        expect(r).toHaveProperty('status');
        expect(r).toHaveProperty('configPath');
        expect(r).toHaveProperty('mcpConfigured');
        expect(r).toHaveProperty('hooksConfigured');
        expect(r).toHaveProperty('issues');
        expect(r).toHaveProperty('repairable');
      }
    });

    it('marks detected host as ready when config is correct', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('.claude')) return true;
        if (path.endsWith('.mcp.json')) return true;
        if (path.endsWith('settings.json')) return true;
        return false;
      });
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const correctMcpConfig = {
        mcpServers: {
          chinmeister: { command: 'npx', args: ['-y', 'chinmeister', 'mcp'] },
          'chinmeister-channel': { command: 'npx', args: ['-y', 'chinmeister', 'channel'] },
        },
      };
      const correctHooksConfig = {
        hooks: {
          PreToolUse: [{ hooks: [{ command: 'npx -y chinmeister hook check-conflict' }] }],
          PostToolUse: [{ hooks: [{ command: 'npx -y chinmeister hook report-edit' }] }],
          SessionStart: [{ hooks: [{ command: 'npx -y chinmeister hook session-start' }] }],
        },
      };

      readFileSync.mockImplementation((path) => {
        if (path.includes('settings.json')) return JSON.stringify(correctHooksConfig);
        if (path.includes('.mcp.json')) return JSON.stringify(correctMcpConfig);
        return '{}';
      });

      const results = scanHostIntegrations('/project');
      const cc = results.find((r) => r.id === 'claude-code');
      expect(cc.detected).toBe(true);
      expect(cc.status).toBe('ready');
      expect(cc.issues).toHaveLength(0);
      expect(cc.mcpConfigured).toBe(true);
      expect(cc.hooksConfigured).toBe(true);
    });

    it('marks detected host as needs_setup when config is missing', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('.cursor')) return true;
        return false;
      });
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      readFileSync.mockReturnValue('{}');

      const results = scanHostIntegrations('/project');
      const cursor = results.find((r) => r.id === 'cursor');
      expect(cursor.detected).toBe(true);
      expect(cursor.status).toBe('needs_setup');
      expect(cursor.issues.length).toBeGreaterThan(0);
    });

    it('marks detected host as needs_repair when MCP is configured but hooks are missing', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('.claude')) return true;
        if (path.endsWith('.mcp.json')) return true;
        return false;
      });
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const correctMcpConfig = {
        mcpServers: {
          chinmeister: { command: 'npx', args: ['-y', 'chinmeister', 'mcp'] },
          'chinmeister-channel': { command: 'npx', args: ['-y', 'chinmeister', 'channel'] },
        },
      };

      readFileSync.mockImplementation((path) => {
        if (path.includes('.mcp.json')) return JSON.stringify(correctMcpConfig);
        return '{}';
      });

      const results = scanHostIntegrations('/project');
      const cc = results.find((r) => r.id === 'claude-code');
      expect(cc.detected).toBe(true);
      expect(cc.mcpConfigured).toBe(true);
      expect(cc.hooksConfigured).toBe(false);
      expect(cc.status).toBe('needs_repair');
      expect(cc.issues).toContain('Hooks are missing or outdated');
    });

    it('sets repairable to true for detected hosts and false for undetected', () => {
      existsSync.mockImplementation((path) => path.endsWith('.cursor'));
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      readFileSync.mockReturnValue('{}');

      const results = scanHostIntegrations('/project');
      const cursor = results.find((r) => r.id === 'cursor');
      const vscode = results.find((r) => r.id === 'vscode');
      expect(cursor.repairable).toBe(true);
      expect(vscode.repairable).toBe(false);
    });

    it('hooksConfigured is always true for hosts without hooks', () => {
      existsSync.mockImplementation((path) => path.endsWith('.vscode'));
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      readFileSync.mockReturnValue('{}');

      const results = scanHostIntegrations('/project');
      // VS Code, Codex, Aider, JetBrains, Amazon Q, Cline have no hooks.
      // Pick any one to exercise the non-hook branch.
      const vscode = results.find((r) => r.id === 'vscode');
      expect(vscode.hooksConfigured).toBe(true);
    });

    it('includes issue text about missing config for detected but unconfigured hosts', () => {
      existsSync.mockImplementation((path) => path.endsWith('.windsurf'));
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      readFileSync.mockReturnValue('{}');

      const results = scanHostIntegrations('/project');
      const windsurf = results.find((r) => r.id === 'windsurf');
      expect(windsurf.issues.some((i) => i.includes('Missing or outdated config'))).toBe(true);
    });

    it('capabilities array is a copy (not a reference to the original)', () => {
      execFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      readFileSync.mockReturnValue('{}');

      const results = scanHostIntegrations('/project');
      const cc = results.find((r) => r.id === 'claude-code');
      expect(Array.isArray(cc.capabilities)).toBe(true);
      // Modifying the result should not affect the source
      cc.capabilities.push('test');
      const results2 = scanHostIntegrations('/project');
      const cc2 = results2.find((r) => r.id === 'claude-code');
      expect(cc2.capabilities).not.toContain('test');
    });
  });
});
