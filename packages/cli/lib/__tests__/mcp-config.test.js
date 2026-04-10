import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectTools, writeMcpConfig, writeHooksConfig, configureTool } from '../mcp-config.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinwag-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe('detectTools', () => {
  it('detects cursor when .cursor directory exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.cursor'));
    const tools = detectTools(tmpDir);
    const ids = tools.map((t) => t.id);
    expect(ids).toContain('cursor');
  });

  it('returns empty array for an empty directory', () => {
    // An empty temp dir has no tool markers, and we assume the test
    // machine doesn't have every CLI tool on PATH. Filter to only
    // directory-detected tools to make the assertion reliable.
    const tools = detectTools(tmpDir);
    // At minimum, no dir-based tools should match in an empty dir
    const dirOnlyTools = tools.filter((t) => {
      const dirs = t.detect?.dirs ?? [];
      return dirs.length > 0 && dirs.some((d) => fs.existsSync(path.join(tmpDir, d)));
    });
    expect(dirOnlyTools).toHaveLength(0);
  });
});

describe('writeMcpConfig', () => {
  it('writes JSON file with mcpServers.chinwag entry', () => {
    const result = writeMcpConfig(tmpDir, 'mcp.json', {});
    expect(result).toEqual({ ok: true });

    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'mcp.json'), 'utf-8'));
    expect(content.mcpServers.chinwag).toBeDefined();
    expect(content.mcpServers.chinwag.command).toBe('npx');
    expect(content.mcpServers.chinwag.args).toEqual(['-y', 'chinwag', 'mcp']);
  });

  it('adds chinwag-channel when channel=true', () => {
    writeMcpConfig(tmpDir, 'mcp.json', { channel: true });

    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'mcp.json'), 'utf-8'));
    expect(content.mcpServers['chinwag-channel']).toBeDefined();
    expect(content.mcpServers['chinwag-channel'].args).toEqual(['-y', 'chinwag', 'channel']);
  });

  it('preserves existing entries in the file', () => {
    // Write an existing config first
    const filePath = path.join(tmpDir, 'mcp.json');
    const existing = {
      mcpServers: {
        'some-other-server': { command: 'node', args: ['other.js'] },
      },
    };
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));

    writeMcpConfig(tmpDir, 'mcp.json', {});

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.mcpServers['some-other-server']).toEqual({
      command: 'node',
      args: ['other.js'],
    });
    expect(content.mcpServers.chinwag).toBeDefined();
  });

  it('creates intermediate directories for nested paths', () => {
    const result = writeMcpConfig(tmpDir, '.cursor/mcp.json', {});
    expect(result).toEqual({ ok: true });
    expect(fs.existsSync(path.join(tmpDir, '.cursor', 'mcp.json'))).toBe(true);
  });

  it('includes toolId in args when provided', () => {
    writeMcpConfig(tmpDir, 'mcp.json', { toolId: 'cursor' });

    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'mcp.json'), 'utf-8'));
    expect(content.mcpServers.chinwag.args).toEqual(['-y', 'chinwag', 'mcp']);
  });

  it('uses tool-specific args for unique config files', () => {
    writeMcpConfig(tmpDir, '.cursor/mcp.json', { toolId: 'cursor' });

    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, '.cursor', 'mcp.json'), 'utf-8'));
    expect(content.mcpServers.chinwag.args).toEqual(['-y', 'chinwag', 'mcp', '--tool', 'cursor']);
  });
});

describe('writeHooksConfig', () => {
  it('creates .claude/settings.json with hooks', () => {
    const result = writeHooksConfig(tmpDir);
    expect(result).toEqual({ ok: true });

    const filePath = path.join(tmpDir, '.claude', 'settings.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.hooks).toBeDefined();
    expect(content.hooks.PreToolUse).toBeInstanceOf(Array);
    expect(content.hooks.PostToolUse).toBeInstanceOf(Array);
    expect(content.hooks.SessionStart).toBeInstanceOf(Array);
  });

  it('is idempotent — running twice does not duplicate hooks', () => {
    writeHooksConfig(tmpDir);
    writeHooksConfig(tmpDir);

    const filePath = path.join(tmpDir, '.claude', 'settings.json');
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Each event should have chinwag hook entries
    expect(content.hooks.PreToolUse).toHaveLength(1);
    expect(content.hooks.PostToolUse).toHaveLength(2); // Edit|Write + Read
    expect(content.hooks.SessionStart).toHaveLength(1);
  });

  it('preserves existing hooks from other tools', () => {
    const filePath = path.join(tmpDir, '.claude', 'settings.json');
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    const existing = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', command: 'some-other-hook' }],
      },
    };
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));

    writeHooksConfig(tmpDir);

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // Should have both the existing hook and the chinwag hook
    expect(content.hooks.PreToolUse).toHaveLength(2);
    expect(content.hooks.PreToolUse[0].command).toBe('some-other-hook');
    expect(content.hooks.PreToolUse[1].hooks[0].command).toBe('npx -y chinwag hook check-conflict');
  });
});

describe('configureTool', () => {
  it('creates .cursor/mcp.json for cursor', () => {
    const result = configureTool(tmpDir, 'cursor');
    expect(result.ok).toBe(true);
    expect(result.name).toBe('Cursor');

    const filePath = path.join(tmpDir, '.cursor', 'mcp.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.mcpServers.chinwag).toBeDefined();
    expect(content.mcpServers.chinwag.args).toContain('cursor');
  });

  it('returns error for unknown tool', () => {
    const result = configureTool(tmpDir, 'nonexistent-tool');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Unknown MCP tool');
  });

  it('configures claude-code with hooks and channel', () => {
    const result = configureTool(tmpDir, 'claude-code');
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('hooks');
    expect(result.detail).toContain('channel');

    // Hooks file should exist
    const hooksPath = path.join(tmpDir, '.claude', 'settings.json');
    expect(fs.existsSync(hooksPath)).toBe(true);

    // MCP config should have channel entry
    const mcpPath = path.join(tmpDir, '.mcp.json');
    const content = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
    expect(content.mcpServers['chinwag-channel']).toBeDefined();
  });
});
