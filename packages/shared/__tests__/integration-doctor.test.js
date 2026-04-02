import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

import {
  commandExists,
  buildChinwagCliArgs,
  buildChinwagHookCommand,
  detectHostIntegrations,
  formatIntegrationScanResults,
  summarizeIntegrationScan,
  writeMcpConfig,
  writeHooksConfig,
  configureHostIntegration,
  scanHostIntegrations,
} from '../integration-doctor.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';

describe('integration-doctor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    existsSync.mockReturnValue(false);
    readFileSync.mockReturnValue('{}');
  });

  describe('commandExists', () => {
    it('returns true when which/where finds the command', () => {
      execFileSync.mockImplementation(() => {});
      expect(commandExists('claude')).toBe(true);
    });

    it('returns false when which/where throws', () => {
      execFileSync.mockImplementation(() => { throw new Error('not found'); });
      expect(commandExists('nonexistent')).toBe(false);
    });
  });

  describe('buildChinwagCliArgs', () => {
    it('builds basic args with subcommand', () => {
      const args = buildChinwagCliArgs('mcp');
      expect(args).toEqual(['-y', 'chinwag', 'mcp']);
    });

    it('includes --tool when hostId is provided', () => {
      const args = buildChinwagCliArgs('mcp', { hostId: 'cursor' });
      expect(args).toEqual(['-y', 'chinwag', 'mcp', '--tool', 'cursor']);
    });

    it('includes --surface when surfaceId is provided', () => {
      const args = buildChinwagCliArgs('mcp', { surfaceId: 'cline' });
      expect(args).toEqual(['-y', 'chinwag', 'mcp', '--surface', 'cline']);
    });

    it('includes both --tool and --surface', () => {
      const args = buildChinwagCliArgs('channel', { hostId: 'vscode', surfaceId: 'continue' });
      expect(args).toEqual(['-y', 'chinwag', 'channel', '--tool', 'vscode', '--surface', 'continue']);
    });
  });

  describe('buildChinwagHookCommand', () => {
    it('builds basic hook command for claude-code', () => {
      const cmd = buildChinwagHookCommand('check-conflict');
      expect(cmd).toBe('npx -y chinwag hook check-conflict');
    });

    it('includes --tool when hostId is not claude-code', () => {
      const cmd = buildChinwagHookCommand('check-conflict', { hostId: 'cursor' });
      expect(cmd).toBe('npx -y chinwag hook check-conflict --tool cursor');
    });

    it('omits --tool when hostId is claude-code (default)', () => {
      const cmd = buildChinwagHookCommand('report-edit', { hostId: 'claude-code' });
      expect(cmd).toBe('npx -y chinwag hook report-edit');
    });

    it('includes --surface when surfaceId is provided', () => {
      const cmd = buildChinwagHookCommand('session-start', { surfaceId: 'cline' });
      expect(cmd).toBe('npx -y chinwag hook session-start --surface cline');
    });
  });

  describe('detectHostIntegrations', () => {
    it('detects host when directory exists', () => {
      existsSync.mockImplementation((path) => path.endsWith('.claude'));
      execFileSync.mockImplementation(() => { throw new Error('not found'); });

      const detected = detectHostIntegrations('/project');
      const ids = detected.map(h => h.id);
      expect(ids).toContain('claude-code');
    });

    it('detects host when command exists', () => {
      existsSync.mockReturnValue(false);
      execFileSync.mockImplementation((bin, [cmd]) => {
        if (cmd === 'claude') return '';
        throw new Error('not found');
      });

      const detected = detectHostIntegrations('/project');
      const ids = detected.map(h => h.id);
      expect(ids).toContain('claude-code');
    });

    it('returns empty array when nothing is detected', () => {
      existsSync.mockReturnValue(false);
      execFileSync.mockImplementation(() => { throw new Error('not found'); });

      const detected = detectHostIntegrations('/project');
      expect(detected).toEqual([]);
    });
  });

  describe('formatIntegrationScanResults', () => {
    it('returns "no integrations" message for empty results', () => {
      const output = formatIntegrationScanResults([]);
      expect(output).toContain('No supported integrations');
    });

    it('formats detected integration with status and config path', () => {
      const results = [{
        name: 'Claude Code',
        tier: 'managed',
        detected: true,
        status: 'ready',
        configPath: '.mcp.json',
        capabilities: ['mcp', 'hooks'],
        issues: [],
      }];
      const output = formatIntegrationScanResults(results);
      expect(output).toContain('Claude Code');
      expect(output).toContain('managed');
      expect(output).toContain('ready');
      expect(output).toContain('.mcp.json');
      expect(output).toContain('mcp, hooks');
    });

    it('formats issues when present', () => {
      const results = [{
        name: 'Cursor',
        tier: 'connected',
        detected: true,
        status: 'needs_setup',
        configPath: '.cursor/mcp.json',
        capabilities: ['mcp'],
        issues: ['Missing or outdated config'],
      }];
      const output = formatIntegrationScanResults(results);
      expect(output).toContain('issue: Missing or outdated config');
    });

    it('filters to only detected when onlyDetected is true', () => {
      const results = [
        { name: 'A', detected: true, status: 'ready', tier: 't', capabilities: [], issues: [], configPath: 'a' },
        { name: 'B', detected: false, status: 'not_detected', tier: 't', capabilities: [], issues: [] },
      ];
      const output = formatIntegrationScanResults(results, { onlyDetected: true });
      expect(output).toContain('A');
      expect(output).not.toContain('B');
    });
  });

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
  });

  describe('writeMcpConfig', () => {
    it('writes chinwag MCP entry to config file', () => {
      readFileSync.mockReturnValue('{}');
      existsSync.mockReturnValue(false);

      const result = writeMcpConfig('/project', '.cursor/mcp.json', { hostId: 'cursor' });
      expect(result).toEqual({ ok: true });
      expect(writeFileSync).toHaveBeenCalled();

      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinwag).toBeDefined();
      expect(writtenContent.mcpServers.chinwag.command).toBe('npx');
      expect(writtenContent.mcpServers.chinwag.args).toContain('--tool');
      expect(writtenContent.mcpServers.chinwag.args).toContain('cursor');
    });

    it('adds chinwag-channel entry when channel option is true', () => {
      readFileSync.mockReturnValue('{}');
      existsSync.mockReturnValue(false);

      writeMcpConfig('/project', '.mcp.json', { channel: true, hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers['chinwag-channel']).toBeDefined();
    });

    it('cleans up old chinwag- entries for host-specific config', () => {
      readFileSync.mockReturnValue(JSON.stringify({
        mcpServers: {
          chinwag: { command: 'old' },
          'chinwag-old': { command: 'old' },
          'other-server': { command: 'keep' },
        },
      }));
      existsSync.mockReturnValue(true);

      writeMcpConfig('/project', '.cursor/mcp.json', { hostId: 'cursor' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers['chinwag-old']).toBeUndefined();
      expect(writtenContent.mcpServers['other-server']).toBeDefined();
    });

    it('returns error when writeFileSync throws', () => {
      readFileSync.mockReturnValue('{}');
      existsSync.mockReturnValue(false);
      writeFileSync.mockImplementation(() => { throw new Error('EACCES'); });

      const result = writeMcpConfig('/project', '.cursor/mcp.json');
      expect(result.error).toContain('Failed to write');
    });

    it('for shared root config (.mcp.json), omits --tool from args', () => {
      readFileSync.mockReturnValue('{}');
      existsSync.mockReturnValue(false);

      writeMcpConfig('/project', '.mcp.json', { hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinwag.args).not.toContain('--tool');
    });
  });

  describe('writeHooksConfig', () => {
    it('writes hook entries to .claude/settings.json', () => {
      readFileSync.mockReturnValue('{}');
      existsSync.mockReturnValue(false);

      const result = writeHooksConfig('/project');
      expect(result).toEqual({ ok: true });

      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.hooks.PreToolUse).toBeDefined();
      expect(writtenContent.hooks.PostToolUse).toBeDefined();
      expect(writtenContent.hooks.SessionStart).toBeDefined();
    });

    it('preserves non-chinwag hooks', () => {
      readFileSync.mockReturnValue(JSON.stringify({
        hooks: {
          PreToolUse: [{ command: 'other-tool check' }],
        },
      }));
      existsSync.mockReturnValue(true);

      writeHooksConfig('/project');
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const preToolHooks = writtenContent.hooks.PreToolUse;
      const otherHook = preToolHooks.find(h => h.command === 'other-tool check');
      expect(otherHook).toBeDefined();
    });

    it('replaces existing chinwag hooks', () => {
      readFileSync.mockReturnValue(JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ command: 'npx -y chinwag hook check-conflict' }] },
            { command: 'other-tool' },
          ],
        },
      }));
      existsSync.mockReturnValue(true);

      writeHooksConfig('/project');
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const preToolHooks = writtenContent.hooks.PreToolUse;
      const chinwagHooks = preToolHooks.filter(h =>
        (h.hooks?.[0]?.command || h.command || '').includes('chinwag'),
      );
      // Should have exactly 1 chinwag hook (the new one)
      expect(chinwagHooks).toHaveLength(1);
    });

    it('returns error when writeFileSync throws', () => {
      readFileSync.mockReturnValue('{}');
      existsSync.mockReturnValue(false);
      writeFileSync.mockImplementation(() => { throw new Error('EACCES'); });

      const result = writeHooksConfig('/project');
      expect(result.error).toContain('Failed to write');
    });
  });

  describe('configureHostIntegration', () => {
    it('returns error for unknown host ID', () => {
      const result = configureHostIntegration('/project', 'nonexistent');
      expect(result.error).toContain('Unknown host integration');
    });

    it('configures MCP for a basic host', () => {
      readFileSync.mockReturnValue('{}');
      existsSync.mockReturnValue(false);

      const result = configureHostIntegration('/project', 'cursor');
      expect(result.ok).toBe(true);
      expect(result.name).toBe('Cursor');
      expect(result.detail).toContain('.cursor/mcp.json');
    });

    it('configures MCP + hooks for claude-code', () => {
      readFileSync.mockReturnValue('{}');
      existsSync.mockReturnValue(false);

      const result = configureHostIntegration('/project', 'claude-code');
      expect(result.ok).toBe(true);
      expect(result.detail).toContain('hooks');
      expect(result.detail).toContain('channel');
    });

    it('passes surfaceId through to config', () => {
      readFileSync.mockReturnValue('{}');
      existsSync.mockReturnValue(false);

      const result = configureHostIntegration('/project', 'cursor', { surfaceId: 'cline' });
      expect(result.ok).toBe(true);
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinwag.args).toContain('--surface');
      expect(writtenContent.mcpServers.chinwag.args).toContain('cline');
    });
  });

  describe('scanHostIntegrations', () => {
    it('returns an entry for every known host integration', () => {
      existsSync.mockReturnValue(false);
      execFileSync.mockImplementation(() => { throw new Error('not found'); });
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

    it('marks detected host as ready when config is correct', () => {
      // Simulate claude-code detected with correct config
      existsSync.mockImplementation((path) => {
        if (path.endsWith('.claude')) return true;
        if (path.endsWith('.mcp.json')) return true;
        if (path.endsWith('settings.json')) return true;
        return false;
      });
      execFileSync.mockImplementation(() => { throw new Error('not found'); });

      const correctMcpConfig = {
        mcpServers: {
          chinwag: { command: 'npx', args: ['-y', 'chinwag', 'mcp'] },
          'chinwag-channel': { command: 'npx', args: ['-y', 'chinwag', 'channel'] },
        },
      };
      const correctHooksConfig = {
        hooks: {
          PreToolUse: [{ hooks: [{ command: 'npx -y chinwag hook check-conflict' }] }],
          PostToolUse: [{ hooks: [{ command: 'npx -y chinwag hook report-edit' }] }],
          SessionStart: [{ hooks: [{ command: 'npx -y chinwag hook session-start' }] }],
        },
      };

      readFileSync.mockImplementation((path) => {
        if (path.includes('settings.json')) return JSON.stringify(correctHooksConfig);
        if (path.includes('.mcp.json')) return JSON.stringify(correctMcpConfig);
        return '{}';
      });

      const results = scanHostIntegrations('/project');
      const cc = results.find(r => r.id === 'claude-code');
      expect(cc.detected).toBe(true);
      expect(cc.status).toBe('ready');
      expect(cc.issues).toHaveLength(0);
    });

    it('marks detected host as needs_setup when config is missing', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('.cursor')) return true;
        return false;
      });
      execFileSync.mockImplementation(() => { throw new Error('not found'); });
      readFileSync.mockReturnValue('{}');

      const results = scanHostIntegrations('/project');
      const cursor = results.find(r => r.id === 'cursor');
      expect(cursor.detected).toBe(true);
      expect(cursor.status).toBe('needs_setup');
      expect(cursor.issues.length).toBeGreaterThan(0);
    });
  });
});
