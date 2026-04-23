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
  buildChinmeisterCliArgs,
  buildChinmeisterHookCommand,
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
      writeJson('/tmp/test.json', { mcpServers: { chinmeister: { command: 'npx' } } });
      const written = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(written.mcpServers.chinmeister.command).toBe('npx');
    });
  });

  // ---------------------------------------------------------------------------
  // buildChinmeisterCliArgs
  // ---------------------------------------------------------------------------
  describe('buildChinmeisterCliArgs', () => {
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

    it('omits --tool when hostId is null', () => {
      expect(buildChinmeisterCliArgs('mcp', { hostId: null })).toEqual([
        '-y',
        'chinmeister',
        'mcp',
      ]);
    });

    it('omits --surface when surfaceId is null', () => {
      expect(buildChinmeisterCliArgs('mcp', { surfaceId: null })).toEqual([
        '-y',
        'chinmeister',
        'mcp',
      ]);
    });

    it('omits --tool when hostId is empty string (falsy)', () => {
      expect(buildChinmeisterCliArgs('mcp', { hostId: '' })).toEqual(['-y', 'chinmeister', 'mcp']);
    });

    it('works with the channel subcommand', () => {
      expect(buildChinmeisterCliArgs('channel')).toEqual(['-y', 'chinmeister', 'channel']);
    });

    it('works with no options argument', () => {
      expect(buildChinmeisterCliArgs('mcp')).toEqual(['-y', 'chinmeister', 'mcp']);
    });
  });

  // ---------------------------------------------------------------------------
  // buildChinmeisterHookCommand
  // ---------------------------------------------------------------------------
  describe('buildChinmeisterHookCommand', () => {
    it('builds basic hook command for check-conflict (default host)', () => {
      const cmd = buildChinmeisterHookCommand('check-conflict');
      expect(cmd).toBe('npx -y chinmeister hook check-conflict');
    });

    it('builds hook command for report-edit', () => {
      const cmd = buildChinmeisterHookCommand('report-edit');
      expect(cmd).toBe('npx -y chinmeister hook report-edit');
    });

    it('builds hook command for session-start', () => {
      const cmd = buildChinmeisterHookCommand('session-start');
      expect(cmd).toBe('npx -y chinmeister hook session-start');
    });

    it('includes --tool when hostId differs from default', () => {
      const cmd = buildChinmeisterHookCommand('check-conflict', { hostId: 'cursor' });
      expect(cmd).toBe('npx -y chinmeister hook check-conflict --tool cursor');
    });

    it('omits --tool when hostId equals default (claude-code)', () => {
      const cmd = buildChinmeisterHookCommand('report-edit', { hostId: 'claude-code' });
      expect(cmd).toBe('npx -y chinmeister hook report-edit');
    });

    it('includes --surface when surfaceId is provided', () => {
      const cmd = buildChinmeisterHookCommand('session-start', { surfaceId: 'cline' });
      expect(cmd).toBe('npx -y chinmeister hook session-start --surface cline');
    });

    it('includes both --tool and --surface', () => {
      const cmd = buildChinmeisterHookCommand('check-conflict', {
        hostId: 'vscode',
        surfaceId: 'continue',
      });
      expect(cmd).toBe('npx -y chinmeister hook check-conflict --tool vscode --surface continue');
    });

    it('omits --surface when surfaceId is null', () => {
      const cmd = buildChinmeisterHookCommand('check-conflict', { surfaceId: null });
      expect(cmd).toBe('npx -y chinmeister hook check-conflict');
    });
  });

  // ---------------------------------------------------------------------------
  // hasMatchingMcpEntry
  // ---------------------------------------------------------------------------
  describe('hasMatchingMcpEntry', () => {
    it('returns true for correct primary MCP entry', () => {
      const config = {
        mcpServers: {
          chinmeister: {
            command: 'npx',
            args: ['-y', 'chinmeister', 'mcp', '--tool', 'cursor'],
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
          chinmeister: {
            command: 'node',
            args: ['-y', 'chinmeister', 'mcp', '--tool', 'cursor'],
          },
        },
      };
      expect(hasMatchingMcpEntry(config, 'cursor')).toBe(false);
    });

    it('returns false when args do not match', () => {
      const config = {
        mcpServers: {
          chinmeister: {
            command: 'npx',
            args: ['-y', 'chinmeister', 'mcp', '--tool', 'vscode'],
          },
        },
      };
      expect(hasMatchingMcpEntry(config, 'cursor')).toBe(false);
    });

    it('returns true for shared root config (no --tool in args)', () => {
      const config = {
        mcpServers: {
          chinmeister: {
            command: 'npx',
            args: ['-y', 'chinmeister', 'mcp'],
          },
        },
      };
      expect(hasMatchingMcpEntry(config, 'claude-code', { sharedRoot: true })).toBe(true);
    });

    it('returns true when channel entry also matches', () => {
      const config = {
        mcpServers: {
          chinmeister: {
            command: 'npx',
            args: ['-y', 'chinmeister', 'mcp'],
          },
          'chinmeister-channel': {
            command: 'npx',
            args: ['-y', 'chinmeister', 'channel'],
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
          chinmeister: {
            command: 'npx',
            args: ['-y', 'chinmeister', 'mcp'],
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
          chinmeister: {
            command: 'npx',
            args: ['-y', 'chinmeister', 'mcp'],
          },
          'chinmeister-channel': {
            command: 'npx',
            args: ['-y', 'chinmeister', 'mcp'], // wrong subcommand
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
          chinmeister: {
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
          chinmeister: {
            command: 'npx',
            args: ['-y', 'chinmeister', 'mcp', '--tool', 'cursor'],
          },
          'chinmeister-channel': {
            command: 'npx',
            args: ['-y', 'chinmeister', 'channel'],
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
        PreToolUse: [{ hooks: [{ command: 'npx -y chinmeister hook check-conflict' }] }],
        PostToolUse: [{ hooks: [{ command: 'npx -y chinmeister hook report-edit' }] }],
        SessionStart: [{ hooks: [{ command: 'npx -y chinmeister hook session-start' }] }],
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
          PreToolUse: [{ command: 'npx -y chinmeister hook check-conflict' }],
          PostToolUse: [{ command: 'npx -y chinmeister hook report-edit' }],
          SessionStart: [{ command: 'npx -y chinmeister hook session-start' }],
        },
      };
      expect(hasMatchingHookConfig(config)).toBe(true);
    });

    it('returns false when hook command is for a different tool', () => {
      const config = {
        hooks: {
          PreToolUse: [{ hooks: [{ command: 'npx -y other-tool hook check' }] }],
          PostToolUse: [{ hooks: [{ command: 'npx -y chinmeister hook report-edit' }] }],
          SessionStart: [{ hooks: [{ command: 'npx -y chinmeister hook session-start' }] }],
        },
      };
      expect(hasMatchingHookConfig(config)).toBe(false);
    });

    it('returns true when chinmeister hooks exist alongside other hooks', () => {
      const config = {
        hooks: {
          PreToolUse: [
            { command: 'other-tool pre-check' },
            { hooks: [{ command: 'npx -y chinmeister hook check-conflict' }] },
          ],
          PostToolUse: [{ hooks: [{ command: 'npx -y chinmeister hook report-edit' }] }],
          SessionStart: [{ hooks: [{ command: 'npx -y chinmeister hook session-start' }] }],
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
    it('writes chinmeister MCP entry to host-specific config file', () => {
      readFileSync.mockReturnValue('{}');

      const result = writeMcpConfig('/project', '.cursor/mcp.json', { hostId: 'cursor' });
      expect(result).toEqual({ ok: true });
      expect(writeFileSync).toHaveBeenCalled();

      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinmeister.command).toBe('npx');
      expect(writtenContent.mcpServers.chinmeister.args).toContain('--tool');
      expect(writtenContent.mcpServers.chinmeister.args).toContain('cursor');
    });

    it('adds chinmeister-channel entry when channel option is true', () => {
      readFileSync.mockReturnValue('{}');

      writeMcpConfig('/project', '.mcp.json', { channel: true, hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers['chinmeister-channel']).toBeDefined();
      expect(writtenContent.mcpServers['chinmeister-channel'].command).toBe('npx');
      expect(writtenContent.mcpServers['chinmeister-channel'].args).toContain('channel');
    });

    it('removes old chinmeister-prefixed entries for host-specific config', () => {
      readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            chinmeister: { command: 'old' },
            'chinmeister-old': { command: 'old' },
            'other-server': { command: 'keep' },
          },
        }),
      );
      existsSync.mockReturnValue(true);

      writeMcpConfig('/project', '.cursor/mcp.json', { hostId: 'cursor' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers['chinmeister-old']).toBeUndefined();
      expect(writtenContent.mcpServers['other-server']).toBeDefined();
      expect(writtenContent.mcpServers.chinmeister).toBeDefined();
    });

    it('for shared root (.mcp.json), omits --tool from primary args', () => {
      readFileSync.mockReturnValue('{}');

      writeMcpConfig('/project', '.mcp.json', { hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinmeister.args).not.toContain('--tool');
    });

    it('for shared root (.mcp.json), preserves chinmeister-channel and cleans old chinmeister-X entries', () => {
      readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            chinmeister: { command: 'old' },
            'chinmeister-channel': { command: 'old-channel', args: ['old'] },
            'chinmeister-old-plugin': { command: 'old-plugin' },
            'other-server': { command: 'keep' },
          },
        }),
      );
      existsSync.mockReturnValue(true);

      writeMcpConfig('/project', '.mcp.json', { hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      // chinmeister-channel is preserved (updated in-place), chinmeister-old-plugin is removed
      expect(writtenContent.mcpServers['chinmeister-channel']).toBeDefined();
      expect(writtenContent.mcpServers['chinmeister-old-plugin']).toBeUndefined();
      expect(writtenContent.mcpServers['other-server']).toBeDefined();
    });

    it('for shared root with mcp.json (no dot prefix)', () => {
      readFileSync.mockReturnValue('{}');

      writeMcpConfig('/project', 'mcp.json', { hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinmeister.args).not.toContain('--tool');
    });

    it('for shared root with channel, omits --tool from channel args', () => {
      readFileSync.mockReturnValue('{}');

      writeMcpConfig('/project', '.mcp.json', { channel: true, hostId: 'claude-code' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers['chinmeister-channel'].args).not.toContain('--tool');
    });

    it('for non-shared root with channel, includes --tool in channel args', () => {
      readFileSync.mockReturnValue('{}');

      writeMcpConfig('/project', '.cursor/mcp.json', { channel: true, hostId: 'cursor' });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers['chinmeister-channel'].args).toContain('--tool');
      expect(writtenContent.mcpServers['chinmeister-channel'].args).toContain('cursor');
    });

    it('includes --surface in args when surfaceId is provided', () => {
      readFileSync.mockReturnValue('{}');

      writeMcpConfig('/project', '.cursor/mcp.json', {
        hostId: 'cursor',
        surfaceId: 'cline',
      });
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      expect(writtenContent.mcpServers.chinmeister.args).toContain('--surface');
      expect(writtenContent.mcpServers.chinmeister.args).toContain('cline');
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
      expect(writtenContent.mcpServers.chinmeister).toBeDefined();
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

    it('preserves non-chinmeister hooks', () => {
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

    it('replaces existing chinmeister hooks (removes old, adds new)', () => {
      readFileSync.mockReturnValue(
        JSON.stringify({
          hooks: {
            PreToolUse: [
              { hooks: [{ command: 'npx -y chinmeister hook check-conflict' }] },
              { command: 'other-tool' },
            ],
          },
        }),
      );
      existsSync.mockReturnValue(true);

      writeHooksConfig('/project');
      const writtenContent = JSON.parse(writeFileSync.mock.calls[0][1].trim());
      const preToolHooks = writtenContent.hooks.PreToolUse;
      const chinmeisterHooks = preToolHooks.filter((h) =>
        (h.hooks?.[0]?.command || h.command || '').includes('chinmeister'),
      );
      expect(chinmeisterHooks).toHaveLength(1);
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

    it('removes chinmeister hooks identified by flat command format', () => {
      readFileSync.mockReturnValue(
        JSON.stringify({
          hooks: {
            PostToolUse: [
              { command: 'npx -y chinmeister hook report-edit' },
              { command: 'keep-me' },
            ],
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
      expect(writtenContent.mcpServers.chinmeister.args).toContain('--surface');
      expect(writtenContent.mcpServers.chinmeister.args).toContain('cline');
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
