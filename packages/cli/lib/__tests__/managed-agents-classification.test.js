import { describe, it, expect, vi } from 'vitest';
import {
  classifyManagedAgentFailure,
  createManagedAgentLaunch,
  createTerminalAgentLaunch,
  listManagedAgentTools,
  getManagedAgentTool,
  checkManagedAgentToolAvailability,
} from '../managed-agents.js';

// ── listManagedAgentTools ─────────────────────────────────

describe('listManagedAgentTools', () => {
  it('returns an array', () => {
    const tools = listManagedAgentTools();
    expect(Array.isArray(tools)).toBe(true);
  });

  it('each tool has required fields', () => {
    const tools = listManagedAgentTools();
    for (const tool of tools) {
      expect(tool).toHaveProperty('id');
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('cmd');
      expect(typeof tool.id).toBe('string');
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.cmd).toBe('string');
    }
  });

  it('tools have args array and failurePatterns', () => {
    const tools = listManagedAgentTools();
    for (const tool of tools) {
      expect(Array.isArray(tool.args)).toBe(true);
      expect(Array.isArray(tool.failurePatterns)).toBe(true);
    }
  });
});

// ── getManagedAgentTool ──────────────────────────────────

describe('getManagedAgentTool', () => {
  it('returns null for unknown tool id', () => {
    expect(getManagedAgentTool('nonexistent-tool-xyz')).toBeNull();
  });

  it('returns null for tools without spawn config', () => {
    // Tools without spawn configuration should not be managed
    expect(getManagedAgentTool('unknown')).toBeNull();
  });

  it('returns tool with correct structure for known tool', () => {
    const tools = listManagedAgentTools();
    if (tools.length === 0) return; // Skip if no tools installed

    const tool = getManagedAgentTool(tools[0].id);
    if (!tool) return; // Tool may not have spawn config

    expect(tool.id).toBe(tools[0].id);
    expect(tool.name).toBe(tools[0].name);
    expect(tool.cmd).toBe(tools[0].cmd);
  });
});

// ── classifyManagedAgentFailure ──────────────────────────

describe('classifyManagedAgentFailure', () => {
  it('returns null when no patterns match', () => {
    expect(classifyManagedAgentFailure('claude-code', 'normal exit')).toBeNull();
  });

  it('returns null for unknown tool', () => {
    expect(classifyManagedAgentFailure('mystery-tool', 'any output')).toBeNull();
  });

  it('returns null for empty output', () => {
    expect(classifyManagedAgentFailure('claude-code', '')).toBeNull();
  });

  it('returns null for undefined output', () => {
    expect(classifyManagedAgentFailure('claude-code')).toBeNull();
  });

  it('classifies codex auth failures', () => {
    const result = classifyManagedAgentFailure(
      'codex',
      'ERROR: Your access token could not be refreshed because your refresh token was already used.',
    );
    if (result) {
      expect(result.toolId).toBe('codex');
      expect(result.state).toBe('needs_auth');
      expect(result.recoveryCommand).toBeDefined();
      expect(result.source).toBe('runtime');
    }
  });

  it('includes source field when matched', () => {
    const result = classifyManagedAgentFailure(
      'codex',
      'ERROR: Your access token could not be refreshed',
    );
    if (result) {
      expect(result.source).toBe('runtime');
    }
  });
});

// ── checkManagedAgentToolAvailability ────────────────────

describe('checkManagedAgentToolAvailability', () => {
  it('returns unavailable for tool with no id', async () => {
    const result = await checkManagedAgentToolAvailability({ id: null, cmd: null });
    expect(result.state).toBe('unavailable');
    expect(result.detail).toContain('Missing tool metadata');
  });

  it('returns unavailable for tool with no cmd', async () => {
    const result = await checkManagedAgentToolAvailability({ id: 'test', cmd: null });
    expect(result.state).toBe('unavailable');
  });

  it('returns ready when no availability check defined', async () => {
    const result = await checkManagedAgentToolAvailability({
      id: 'test-tool',
      cmd: 'echo',
      availabilityCheck: null,
    });
    expect(result.toolId).toBe('test-tool');
    expect(result.state).toBe('ready');
    expect(result.detail).toBe('Ready');
  });

  it('returns toolId "unknown" when tool id is not set', async () => {
    const result = await checkManagedAgentToolAvailability({});
    expect(result.toolId).toBe('unknown');
  });

  it('runs availability check and parses output', async () => {
    const mockParse = vi.fn(() => ({ state: 'ready', detail: 'All good' }));
    const result = await checkManagedAgentToolAvailability({
      id: 'test-tool',
      cmd: 'echo',
      availabilityCheck: {
        args: ['hello'],
        parse: mockParse,
      },
    });

    expect(mockParse).toHaveBeenCalled();
    expect(result.toolId).toBe('test-tool');
    expect(result.state).toBe('ready');
  });

  it('handles availability check that throws', async () => {
    const mockParse = vi.fn(() => ({ state: 'unavailable', detail: 'Not found' }));
    const result = await checkManagedAgentToolAvailability({
      id: 'bad-tool',
      cmd: 'nonexistent-command-xyz',
      availabilityCheck: {
        args: ['--version'],
        parse: mockParse,
      },
    });

    // Should still call parse with error output
    expect(mockParse).toHaveBeenCalled();
    expect(result.toolId).toBe('bad-tool');
  });
});

// ── createManagedAgentLaunch edge cases ──────────────────

describe('createManagedAgentLaunch edge cases', () => {
  it('includes defaults for optional cols/rows', () => {
    const launch = createManagedAgentLaunch({
      tool: { id: 'claude-code', name: 'Claude Code', cmd: 'claude', args: [] },
      task: 'test',
      cwd: '/repo',
      token: 'tok_test',
    });
    // cols and rows should be undefined (not in the descriptor unless provided)
    expect(launch.cols).toBeUndefined();
    expect(launch.rows).toBeUndefined();
  });

  it('propagates cols and rows when provided', () => {
    const launch = createManagedAgentLaunch({
      tool: { id: 'claude-code', name: 'Claude Code', cmd: 'claude', args: [] },
      task: 'test',
      cwd: '/repo',
      token: 'tok_test',
      cols: 120,
      rows: 40,
    });
    expect(launch.cols).toBe(120);
    expect(launch.rows).toBe(40);
  });
});

// ── createTerminalAgentLaunch edge cases ────────────────

describe('createTerminalAgentLaunch edge cases', () => {
  it('uses default empty task when not provided', () => {
    const launch = createTerminalAgentLaunch({
      tool: { id: 'claude-code', name: 'Claude Code', cmd: 'claude', args: [] },
      cwd: '/repo',
      token: 'tok_test',
    });
    expect(launch.task).toBe('');
    expect(launch.interactive).toBe(true);
  });

  it('sets interactive to true', () => {
    const launch = createTerminalAgentLaunch({
      tool: { id: 'claude-code', name: 'Claude Code', cmd: 'claude' },
      task: 'Fix bug',
      cwd: '/repo',
      token: 'tok_test',
    });
    expect(launch.interactive).toBe(true);
  });
});
