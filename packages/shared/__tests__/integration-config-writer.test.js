import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import {
  readJson,
  writeJson,
  buildChinwagCliArgs,
  buildChinwagHookCommand,
  hasMatchingMcpEntry,
  hasMatchingHookConfig,
  writeMcpConfig,
  writeHooksConfig,
  configureHostIntegration,
} from '../integration-config-writer.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

describe('integration-config-writer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    existsSync.mockReturnValue(false);
    readFileSync.mockReturnValue('{}');
  });

  // ---------------------------------------------------------------------------
  // readJson
  // ---------------------------------------------------------------------------
  describe('readJson', () => {
    it('returns empty object when file does not exist', () => {
      existsSync.mockReturnValue(false);
      expect(readJson('/some/path.json')).toEqual({});
    });

    it('returns parsed JSON when file exists', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ mcpServers: { test: {} } }));
      expect(readJson('/some/path.json')).toEqual({ mcpServers: { test: {} } });
    });

    it('returns empty object when file contains invalid JSON', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('not valid json{');
      expect(readJson('/some/path.json')).toEqual({});
    });

    it('returns empty object when readFileSync throws', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockImplementation(() => {
        throw new Error('EACCES');
      });
      expect(readJson('/some/path.json')).toEqual({});
    });

    it('reads file with utf-8 encoding', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('{}');
      readJson('/some/path.json');
      expect(readFileSync).toHaveBeenCalledWith('/some/path.json', 'utf-8');
    });
  });

  // ---------------------------------------------------------------------------
  // writeJson
  // ---------------------------------------------------------------------------
  describe('writeJson', () => {
    it('writes pretty-printed JSON with trailing newline', () => {
      writeJson('/tmp/test.json', { key: 'value' });
      expect(writeFileSync).toHaveBeenCalledWith('/tmp/test.json', '{\n  "key": "value"\n}\n');
    });

    it('creates parent directory recursively', () => {
      writeJson('/tmp/nested/dir/test.json', {});
      expect(mkdirSync).toHaveBeenCalledWith('/tmp/nested/dir', { recursive: true });
    });

    it('does not create directory when dirname is "."', () => {
      writeJson('test.json', {});
      expect(mkdirSync).not.toHaveBeenCalled();
    });

    it('writes empty object', () => {
      writeJson('/tmp/test.json', {});
      expect(writeFileSync).toHaveBeenCalledWith('/tmp/test.json', '{}\n');
    });

    it('preserves nested structure', () => {
      writeJson('/tmp/test.json', { mcpServers: { chinwag: { command: 'npx' } } });
      const written = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(written.mcpServers.chinwag.command).toBe('npx');
    });
  });

  // ---------------------------------------------------------------------------
  // buildChinwagCliArgs
  // ---------------------------------------------------------------------------
  describe('buildChinwagCliArgs', () => {
    it('builds basic args with subcommand', () => {
      expect(buildChinwagCliArgs('mcp')).toEqual(['-y', 'chinwag', 'mcp']);
    });

    it('includes --tool when hostId is provided', () => {
      expect(buildChinwagCliArgs('mcp', { hostId: 'cursor' })).toEqual([
        '-y',
        'chinwag',
        'mcp',
        '--tool',
        'cursor',
      ]);
    });

    it('includes --surface when surfaceId is provided', () => {
      expect(buildChinwagCliArgs('mcp', { surfaceId: 'cline' })).toEqual([
        '-y',
        'chinwag',
        'mcp',
        '--surface',
        'cline',
      ]);
    });

    it('includes both --tool and --surface', () => {
      expect(buildChinwagCliArgs('channel', { hostId: 'vscode', surfaceId: 'continue' })).toEqual([
        '-y',
        'chinwag',
        'channel',
        '--tool',
        'vscode',
        '--surface',
        'continue',
      ]);
    });

    it('omits --tool when hostId is null', () => {
      expect(buildChinwagCliArgs('mcp', { hostId: null })).toEqual(['-y', 'chinwag', 'mcp']);
    });

    it('omits --surface when surfaceId is null', () => {
      expect(buildChinwagCliArgs('mcp', { surfaceId: null })).toEqual(['-y', 'chinwag', 'mcp']);
    });

    it('omits --tool when hostId is empty string (falsy)', () => {
      expect(buildChinwagCliArgs('mcp', { hostId: '' })).toEqual(['-y', 'chinwag', 'mcp']);
    });

    it('works with the channel subcommand', () => {
      expect(buildChinwagCliArgs('channel')).toEqual(['-y', 'chinwag', 'channel']);
    });

    it('works with no options argument', () => {
      expect(buildChinwagCliArgs('mcp')).toEqual(['-y', 'chinwag', 'mcp']);
    });
  });

  // ---------------------------------------------------------------------------
  // buildChinwagHookCommand
  // ---------------------------------------------------------------------------
  describe('buildChinwagHookCommand', () => {
    it('builds basic hook command for check-conflict (default host)', () => {
      const cmd = buildChinwagHookCommand('check-conflict');
      expect(cmd).toBe('npx -y chinwag hook check-conflict');
    });

    it('builds hook command for report-edit', () => {
      const cmd = buildChinwagHookCommand('report-edit');
      expect(cmd).toBe('npx -y chinwag hook report-edit');
    });

    it('builds hook command for session-start', () => {
      const cmd = buildChinwagHookCommand('session-start');
      expect(cmd).toBe('npx -y chinwag hook session-start');
    });

    it('includes --tool when hostId differs from default', () => {
      const cmd = buildChinwagHookCommand('check-conflict', { hostId: 'cursor' });
      expect(cmd).toBe('npx -y chinwag hook check-conflict --tool cursor');
    });

    it('omits --tool when hostId equals default (claude-code)', () => {
      const cmd = buildChinwagHookCommand('report-edit', { hostId: 'claude-code' });
      expect(cmd).toBe('npx -y chinwag hook report-edit');
    });

    it('includes --surface when surfaceId is provided', () => {
      const cmd = buildChinwagHookCommand('session-start', { surfaceId: 'cline' });
      expect(cmd).toBe('npx -y chinwag hook session-start --surface cline');
    });

    it('includes both --tool and --surface', () => {
      const cmd = buildChinwagHookCommand('check-conflict', {
        hostId: 'vscode',
        surfaceId: 'continue',
      });
      expect(cmd).toBe('npx -y chinwag hook check-conflict --tool vscode --surface continue');
    });

    it('omits --surface when surfaceId is null', () => {
      const cmd = buildChinwagHookCommand('check-conflict', { surfaceId: null });
      expect(cmd).toBe('npx -y chinwag hook check-conflict');
    });
  });

  // ---------------------------------------------------------------------------
  // hasMatchingMcpEntry
  // ---------------------------------------------------------------------------
  describe('hasMatchingMcpEntry', () => {
    it('returns true for correct primary MCP entry', () => {
      const config = {
        mcpServers: {
          chinwag: {
            command: 'npx',
            args: ['-y', 'chinwag', 'mcp', '--tool', 'cursor'],
          },
        },
      };
      expect(hasMatchingMcpEntry(config, 'cursor')).toBe(true);
    });

    it('returns false when primary entry is missing', () => {
      const config = { mcpServers: {} };
      expect(hasMatchingMcpEntry(config, 'cursor')).toBe(false);
    });

    it('returns false when command is not npx', () => {
      const config = {
        mcpServers: {
          chinwag: {
            command: 'node',
            args: ['-y', 'chinwag', 'mcp', '--tool', 'cursor'],
          },
        },
      };
      expect(hasMatchingMcpEntry(config, 'cursor')).toBe(false);
    });

    it('returns false when args do not match', () => {
      const config = {
        mcpServers: {
          chinwag: {
            command: 'npx',
            args: ['-y', 'chinwag', 'mcp', '--tool', 'vscode'],
          },
        },
      };
      expect(hasMatchingMcpEntry(config, 'cursor')).toBe(false);
    });

    it('returns true for shared root config (no --tool in args)', () => {
      const config = {
        mcpServers: {
          chinwag: {
            command: 'npx',
            args: ['-y', 'chinwag', 'mcp'],
          },
        },
      };
      expect(hasMatchingMcpEntry(config, 'claude-code', { sharedRoot: true })).toBe(true);
    });

    it('returns true when channel entry also matches', () => {
      const config = {
        mcpServers: {
          chinwag: {
            command: 'npx',
            args: ['-y', 'chinwag', 'mcp'],
          },
          'chinwag-channel': {
            command: 'npx',
            args: ['-y', 'chinwag', 'channel'],
          },
        },
      };
      expect(hasMatchingMcpEntry(config, 'claude-code', { channel: true, sharedRoot: true })).toBe(
        true,
      );
    });

    it('returns false when channel is expected but missing', () => {
      const config = {
        mcpServers: {
          chinwag: {
            command: 'npx',
            args: ['-y', 'chinwag', 'mcp'],
          },
        },
      };
      expect(hasMatchingMcpEntry(config, 'claude-code', { channel: true, sharedRoot: true })).toBe(
        false,
      );
    });

    it('returns false when channel entry has wrong args', () => {
      const config = {
        mcpServers: {
          chinwag: {
            command: 'npx',
            args: ['-y', 'chinwag', 'mcp'],
          },
          'chinwag-channel': {
            command: 'npx',
            args: ['-y', 'chinwag', 'mcp'], // wrong subcommand
          },
        },
      };
      expect(hasMatchingMcpEntry(config, 'claude-code', { channel: true, sharedRoot: true })).toBe(
        false,
      );
    });

    it('returns false when mcpServers is undefined', () => {
      expect(hasMatchingMcpEntry({}, 'cursor')).toBe(false);
    });

    it('treats missing args as empty array', () => {
      const config = {
        mcpServers: {
          chinwag: {
            command: 'npx',
            // no args property
          },
        },
      };
      expect(hasMatchingMcpEntry(config, 'cursor')).toBe(false);
    });

    it('returns true when channel is not requested even if channel entry exists', () => {
      const config = {
        mcpServers: {
          chinwag: {
            command: 'npx',
            args: ['-y', 'chinwag', 'mcp', '--tool', 'cursor'],
          },
          'chinwag-channel': {
            command: 'npx',
            args: ['-y', 'chinwag', 'channel'],
          },
        },
      };
      // channel defaults to false, so just primary check
      expect(hasMatchingMcpEntry(config, 'cursor')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // hasMatchingHookConfig
  // ---------------------------------------------------------------------------
  describe('hasMatchingHookConfig', () => {
    const correctHooks = {
      hooks: {
        PreToolUse: [{ hooks: [{ command: 'npx -y chinwag hook check-conflict' }] }],
        PostToolUse: [{ hooks: [{ command: 'npx -y chinwag hook report-edit' }] }],
        SessionStart: [{ hooks: [{ command: 'npx -y chinwag hook session-start' }] }],
      },
    };

    it('returns true when all 3 hook events are configured correctly', () => {
      expect(hasMatchingHookConfig(correctHooks)).toBe(true);
    });

    it('returns false when PreToolUse hook is missing', () => {
      const config = {
        hooks: {
          PostToolUse: correctHooks.hooks.PostToolUse,
          SessionStart: correctHooks.hooks.SessionStart,
        },
      };
      expect(hasMatchingHookConfig(config)).toBe(false);
    });

    it('returns false when PostToolUse hook is missing', () => {
      const config = {
        hooks: {
          PreToolUse: correctHooks.hooks.PreToolUse,
          SessionStart: correctHooks.hooks.SessionStart,
        },
      };
      expect(hasMatchingHookConfig(config)).toBe(false);
    });

    it('returns false when SessionStart hook is missing', () => {
      const config = {
        hooks: {
          PreToolUse: correctHooks.hooks.PreToolUse,
          PostToolUse: correctHooks.hooks.PostToolUse,
        },
      };
      expect(hasMatchingHookConfig(config)).toBe(false);
    });

    it('returns false when hooks object is empty', () => {
      expect(hasMatchingHookConfig({ hooks: {} })).toBe(false);
    });

    it('returns false for null config', () => {
      expect(hasMatchingHookConfig(null)).toBe(false);
    });

    it('returns false when config has no hooks property', () => {
      expect(hasMatchingHookConfig({})).toBe(false);
    });

    it('matches hooks with command in hook.command (flat format)', () => {
      const config = {
        hooks: {
          PreToolUse: [{ command: 'npx -y chinwag hook check-conflict' }],
          PostToolUse: [{ command: 'npx -y chinwag hook report-edit' }],
          SessionStart: [{ command: 'npx -y chinwag hook session-start' }],
        },
      };
      expect(hasMatchingHookConfig(config)).toBe(true);
    });

    it('returns false when hook command is for a different tool', () => {
      const config = {
        hooks: {
          PreToolUse: [{ hooks: [{ command: 'npx -y other-tool hook check' }] }],
          PostToolUse: [{ hooks: [{ command: 'npx -y chinwag hook report-edit' }] }],
          SessionStart: [{ hooks: [{ command: 'npx -y chinwag hook session-start' }] }],
        },
      };
      expect(hasMatchingHookConfig(config)).toBe(false);
    });

    it('returns true when chinwag hooks exist alongside other hooks', () => {
      const config = {
        hooks: {
          PreToolUse: [
            { command: 'other-tool pre-check' },
            { hooks: [{ command: 'npx -y chinwag hook check-conflict' }] },
          ],
          PostToolUse: [{ hooks: [{ command: 'npx -y chinwag hook report-edit' }] }],
          SessionStart: [{ hooks: [{ command: 'npx -y chinwag hook session-start' }] }],
        },
      };
      expect(hasMatchingHookConfig(config)).toBe(true);
    });

    it('returns false when hook events have empty arrays', () => {
      const config = {
        hooks: {
          PreToolUse: [],
          PostToolUse: [],
          SessionStart: [],
        },
      };
      expect(hasMatchingHookConfig(config)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // writeMcpConfig
  // ---------------------------------------------------------------------------
  describe('writeMcpConfig', () => {
    it('writes chinwag MCP entry to host-specific config file', () => {
      readFileSync.mockReturnValue('{}');

      const result = writeMcpConfig('/project', '.cursor/mcp.json', { hostId: 'cursor' });
      expect(result).toEqual({ ok: true });
      expect(writeFileSync).toHaveBeenCalled();

      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinwag.command).toBe('npx');
      expect(writtenContent.mcpServers.chinwag.args).toContain('--tool');
      expect(writtenContent.mcpServers.chinwag.args).toContain('cursor');
    });

    it('adds chinwag-channel entry when channel option is true', () => {
      readFileSync.mockReturnValue('{}');

      writeMcpConfig('/project', '.mcp.json', { channel: true, hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers['chinwag-channel']).toBeDefined();
      expect(writtenContent.mcpServers['chinwag-channel'].command).toBe('npx');
      expect(writtenContent.mcpServers['chinwag-channel'].args).toContain('channel');
    });

    it('removes old chinwag-prefixed entries for host-specific config', () => {
      readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            chinwag: { command: 'old' },
            'chinwag-old': { command: 'old' },
            'other-server': { command: 'keep' },
          },
        }),
      );
      existsSync.mockReturnValue(true);

      writeMcpConfig('/project', '.cursor/mcp.json', { hostId: 'cursor' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers['chinwag-old']).toBeUndefined();
      expect(writtenContent.mcpServers['other-server']).toBeDefined();
      expect(writtenContent.mcpServers.chinwag).toBeDefined();
    });

    it('for shared root (.mcp.json), omits --tool from primary args', () => {
      readFileSync.mockReturnValue('{}');

      writeMcpConfig('/project', '.mcp.json', { hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinwag.args).not.toContain('--tool');
    });

    it('for shared root (.mcp.json), preserves chinwag-channel and cleans old chinwag-X entries', () => {
      readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            chinwag: { command: 'old' },
            'chinwag-channel': { command: 'old-channel', args: ['old'] },
            'chinwag-old-plugin': { command: 'old-plugin' },
            'other-server': { command: 'keep' },
          },
        }),
      );
      existsSync.mockReturnValue(true);

      writeMcpConfig('/project', '.mcp.json', { hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      // chinwag-channel is preserved (updated in-place), chinwag-old-plugin is removed
      expect(writtenContent.mcpServers['chinwag-channel']).toBeDefined();
      expect(writtenContent.mcpServers['chinwag-old-plugin']).toBeUndefined();
      expect(writtenContent.mcpServers['other-server']).toBeDefined();
    });

    it('for shared root with mcp.json (no dot prefix)', () => {
      readFileSync.mockReturnValue('{}');

      writeMcpConfig('/project', 'mcp.json', { hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinwag.args).not.toContain('--tool');
    });

    it('for shared root with channel, omits --tool from channel args', () => {
      readFileSync.mockReturnValue('{}');

      writeMcpConfig('/project', '.mcp.json', { channel: true, hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers['chinwag-channel'].args).not.toContain('--tool');
    });

    it('for non-shared root with channel, includes --tool in channel args', () => {
      readFileSync.mockReturnValue('{}');

      writeMcpConfig('/project', '.cursor/mcp.json', { channel: true, hostId: 'cursor' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers['chinwag-channel'].args).toContain('--tool');
      expect(writtenContent.mcpServers['chinwag-channel'].args).toContain('cursor');
    });

    it('includes --surface in args when surfaceId is provided', () => {
      readFileSync.mockReturnValue('{}');

      writeMcpConfig('/project', '.cursor/mcp.json', {
        hostId: 'cursor',
        surfaceId: 'cline',
      });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinwag.args).toContain('--surface');
      expect(writtenContent.mcpServers.chinwag.args).toContain('cline');
    });

    it('returns error when writeJson throws', () => {
      readFileSync.mockReturnValue('{}');
      writeFileSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      const result = writeMcpConfig('/project', '.cursor/mcp.json');
      expect(result.error).toContain('Failed to write');
      expect(result.error).toContain('.cursor/mcp.json');
    });

    it('initializes mcpServers if not present in existing config', () => {
      readFileSync.mockReturnValue(JSON.stringify({ otherKey: true }));
      existsSync.mockReturnValue(true);

      writeMcpConfig('/project', '.cursor/mcp.json', { hostId: 'cursor' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers).toBeDefined();
      expect(writtenContent.otherKey).toBe(true);
    });

    it('works with default options (no hostId, no channel, no surfaceId)', () => {
      readFileSync.mockReturnValue('{}');

      const result = writeMcpConfig('/project', '.cursor/mcp.json');
      expect(result).toEqual({ ok: true });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinwag).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // writeHooksConfig
  // ---------------------------------------------------------------------------
  describe('writeHooksConfig', () => {
    it('writes hook entries to .claude/settings.json', () => {
      readFileSync.mockReturnValue('{}');

      const result = writeHooksConfig('/project');
      expect(result).toEqual({ ok: true });

      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.hooks.PreToolUse).toBeDefined();
      expect(writtenContent.hooks.PostToolUse).toBeDefined();
      expect(writtenContent.hooks.SessionStart).toBeDefined();
    });

    it('PreToolUse hook has Edit|Write matcher', () => {
      readFileSync.mockReturnValue('{}');

      writeHooksConfig('/project');
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const preToolHook = writtenContent.hooks.PreToolUse[0];
      expect(preToolHook.matcher).toBe('Edit|Write');
    });

    it('PostToolUse hook has Edit|Write matcher', () => {
      readFileSync.mockReturnValue('{}');

      writeHooksConfig('/project');
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const postToolHook = writtenContent.hooks.PostToolUse[0];
      expect(postToolHook.matcher).toBe('Edit|Write');
    });

    it('SessionStart hook has no matcher', () => {
      readFileSync.mockReturnValue('{}');

      writeHooksConfig('/project');
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const sessionHook = writtenContent.hooks.SessionStart[0];
      expect(sessionHook.matcher).toBeUndefined();
    });

    it('hook commands have type "command"', () => {
      readFileSync.mockReturnValue('{}');

      writeHooksConfig('/project');
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const preHookCmd = writtenContent.hooks.PreToolUse[0].hooks[0];
      expect(preHookCmd.type).toBe('command');
    });

    it('preserves non-chinwag hooks', () => {
      readFileSync.mockReturnValue(
        JSON.stringify({
          hooks: {
            PreToolUse: [{ command: 'other-tool check' }],
          },
        }),
      );
      existsSync.mockReturnValue(true);

      writeHooksConfig('/project');
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const preToolHooks = writtenContent.hooks.PreToolUse;
      const otherHook = preToolHooks.find((h) => h.command === 'other-tool check');
      expect(otherHook).toBeDefined();
    });

    it('replaces existing chinwag hooks (removes old, adds new)', () => {
      readFileSync.mockReturnValue(
        JSON.stringify({
          hooks: {
            PreToolUse: [
              { hooks: [{ command: 'npx -y chinwag hook check-conflict' }] },
              { command: 'other-tool' },
            ],
          },
        }),
      );
      existsSync.mockReturnValue(true);

      writeHooksConfig('/project');
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const preToolHooks = writtenContent.hooks.PreToolUse;
      const chinwagHooks = preToolHooks.filter((h) =>
        (h.hooks?.[0]?.command || h.command || '').includes('chinwag'),
      );
      expect(chinwagHooks).toHaveLength(1);
    });

    it('includes --tool when hostId is not the default', () => {
      readFileSync.mockReturnValue('{}');

      writeHooksConfig('/project', { hostId: 'cursor' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const preHookCmd = writtenContent.hooks.PreToolUse[0].hooks[0].command;
      expect(preHookCmd).toContain('--tool cursor');
    });

    it('omits --tool when hostId is the default (claude-code)', () => {
      readFileSync.mockReturnValue('{}');

      writeHooksConfig('/project', { hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const preHookCmd = writtenContent.hooks.PreToolUse[0].hooks[0].command;
      expect(preHookCmd).not.toContain('--tool');
    });

    it('includes --surface when surfaceId is provided', () => {
      readFileSync.mockReturnValue('{}');

      writeHooksConfig('/project', { surfaceId: 'cline' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const sessionCmd = writtenContent.hooks.SessionStart[0].hooks[0].command;
      expect(sessionCmd).toContain('--surface cline');
    });

    it('returns error when writeJson throws', () => {
      readFileSync.mockReturnValue('{}');
      writeFileSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      const result = writeHooksConfig('/project');
      expect(result.error).toContain('Failed to write');
      expect(result.error).toContain('.claude/settings.json');
    });

    it('writes to .claude/settings.json path under cwd', () => {
      readFileSync.mockReturnValue('{}');

      writeHooksConfig('/my/project');
      expect(writeFileSync).toHaveBeenCalledWith(
        '/my/project/.claude/settings.json',
        expect.any(String),
      );
    });

    it('initializes hooks property if not present in existing config', () => {
      readFileSync.mockReturnValue(JSON.stringify({ otherSetting: true }));
      existsSync.mockReturnValue(true);

      writeHooksConfig('/project');
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.hooks).toBeDefined();
      expect(writtenContent.otherSetting).toBe(true);
    });

    it('removes chinwag hooks identified by flat command format', () => {
      readFileSync.mockReturnValue(
        JSON.stringify({
          hooks: {
            PostToolUse: [{ command: 'npx -y chinwag hook report-edit' }, { command: 'keep-me' }],
          },
        }),
      );
      existsSync.mockReturnValue(true);

      writeHooksConfig('/project');
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const kept = writtenContent.hooks.PostToolUse.filter((h) => h.command === 'keep-me');
      expect(kept).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // configureHostIntegration
  // ---------------------------------------------------------------------------
  describe('configureHostIntegration', () => {
    it('returns error for unknown host ID', () => {
      const result = configureHostIntegration('/project', 'nonexistent');
      expect(result.error).toContain('Unknown host integration');
    });

    it('configures MCP and hooks for cursor (no channel)', () => {
      readFileSync.mockReturnValue('{}');

      const result = configureHostIntegration('/project', 'cursor');
      expect(result.ok).toBe(true);
      expect(result.name).toBe('Cursor');
      expect(result.detail).toContain('.cursor/mcp.json');
      expect(result.detail).toContain('hooks');
      expect(result.detail).not.toContain('channel');
    });

    it('configures MCP + hooks + channel for claude-code', () => {
      readFileSync.mockReturnValue('{}');

      const result = configureHostIntegration('/project', 'claude-code');
      expect(result.ok).toBe(true);
      expect(result.name).toBe('Claude Code');
      expect(result.detail).toContain('hooks');
      expect(result.detail).toContain('channel');
    });

    it('passes surfaceId through to config writing', () => {
      readFileSync.mockReturnValue('{}');

      const result = configureHostIntegration('/project', 'cursor', { surfaceId: 'cline' });
      expect(result.ok).toBe(true);
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinwag.args).toContain('--surface');
      expect(writtenContent.mcpServers.chinwag.args).toContain('cline');
    });

    it('returns MCP write error if MCP config write fails', () => {
      readFileSync.mockReturnValue('{}');
      writeFileSync.mockImplementation(() => {
        throw new Error('disk full');
      });

      const result = configureHostIntegration('/project', 'cursor');
      expect(result.error).toContain('Failed to write');
    });

    it('returns hooks write error if hooks config write fails', () => {
      let callCount = 0;
      writeFileSync.mockImplementation(() => {
        callCount++;
        // Let MCP write succeed, fail on hooks write
        if (callCount > 1) throw new Error('hooks write failed');
      });
      readFileSync.mockReturnValue('{}');

      const result = configureHostIntegration('/project', 'claude-code');
      expect(result.error).toContain('Failed to write');
    });

    it('configures windsurf host correctly', () => {
      readFileSync.mockReturnValue('{}');

      const result = configureHostIntegration('/project', 'windsurf');
      expect(result.ok).toBe(true);
      expect(result.name).toBe('Windsurf');
      expect(result.detail).toContain('.windsurf/mcp.json');
    });

    it('configures vscode host correctly', () => {
      readFileSync.mockReturnValue('{}');

      const result = configureHostIntegration('/project', 'vscode');
      expect(result.ok).toBe(true);
      expect(result.name).toBe('VS Code');
      expect(result.detail).toContain('.vscode/mcp.json');
    });

    it('configures jetbrains host correctly', () => {
      readFileSync.mockReturnValue('{}');

      const result = configureHostIntegration('/project', 'jetbrains');
      expect(result.ok).toBe(true);
      expect(result.name).toBe('JetBrains');
    });

    it('handles null surfaceId option', () => {
      readFileSync.mockReturnValue('{}');

      const result = configureHostIntegration('/project', 'cursor', { surfaceId: null });
      expect(result.ok).toBe(true);
    });
  });
});
