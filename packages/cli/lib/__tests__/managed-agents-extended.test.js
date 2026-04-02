import { describe, expect, it, vi } from 'vitest';
import {
  classifyManagedAgentFailure,
  createManagedAgentLaunch,
  createTerminalAgentLaunch,
  checkManagedAgentToolAvailability,
} from '../managed-agents.js';

describe('createManagedAgentLaunch validation', () => {
  it('throws when tool is missing', () => {
    expect(() =>
      createManagedAgentLaunch({
        tool: null,
        task: 'test',
        cwd: '/repo',
        token: 'tok',
      }),
    ).toThrow('Missing managed agent tool metadata');
  });

  it('throws when tool.id is missing', () => {
    expect(() =>
      createManagedAgentLaunch({
        tool: { cmd: 'claude' },
        task: 'test',
        cwd: '/repo',
        token: 'tok',
      }),
    ).toThrow('Missing managed agent tool metadata');
  });

  it('throws when tool.cmd is missing', () => {
    expect(() =>
      createManagedAgentLaunch({
        tool: { id: 'claude-code' },
        task: 'test',
        cwd: '/repo',
        token: 'tok',
      }),
    ).toThrow('Missing managed agent tool metadata');
  });

  it('throws when task is empty', () => {
    expect(() =>
      createManagedAgentLaunch({
        tool: { id: 'claude-code', cmd: 'claude' },
        task: '',
        cwd: '/repo',
        token: 'tok',
      }),
    ).toThrow('Task is required');
  });

  it('throws when task is whitespace-only', () => {
    expect(() =>
      createManagedAgentLaunch({
        tool: { id: 'claude-code', cmd: 'claude' },
        task: '   ',
        cwd: '/repo',
        token: 'tok',
      }),
    ).toThrow('Task is required');
  });

  it('throws when cwd is missing', () => {
    expect(() =>
      createManagedAgentLaunch({
        tool: { id: 'claude-code', cmd: 'claude' },
        task: 'test',
        cwd: '',
        token: 'tok',
      }),
    ).toThrow('Working directory is required');
  });

  it('throws when token is missing', () => {
    expect(() =>
      createManagedAgentLaunch({
        tool: { id: 'claude-code', cmd: 'claude' },
        task: 'test',
        cwd: '/repo',
        token: '',
      }),
    ).toThrow('Missing chinwag auth token');
  });

  it('generates a valid agent ID', () => {
    const launch = createManagedAgentLaunch({
      tool: { id: 'claude-code', name: 'Claude Code', cmd: 'claude', args: [] },
      task: 'do stuff',
      cwd: '/repo',
      token: 'tok_abc123',
    });

    expect(launch.agentId).toMatch(/^claude-code:[0-9a-f]+:[0-9a-f]+$/);
    expect(launch.env.CHINWAG_TOOL).toBe('claude-code');
    expect(launch.env.CHINWAG_AGENT_ID).toBe(launch.agentId);
  });

  it('trims whitespace from task', () => {
    const launch = createManagedAgentLaunch({
      tool: { id: 'claude-code', name: 'Claude Code', cmd: 'claude', args: [] },
      task: '  trim me  ',
      cwd: '/repo',
      token: 'tok',
    });

    expect(launch.task).toBe('trim me');
  });
});

describe('createTerminalAgentLaunch', () => {
  it('creates a terminal launch descriptor', () => {
    const launch = createTerminalAgentLaunch({
      tool: { id: 'claude-code', name: 'Claude Code', cmd: 'claude', args: ['--print'] },
      task: 'Fix bug',
      cwd: '/repo',
      token: 'tok_123',
    });

    expect(launch).toMatchObject({
      toolId: 'claude-code',
      toolName: 'Claude Code',
      cmd: 'claude',
      task: 'Fix bug',
      cwd: '/repo',
      interactive: true,
    });
    expect(launch.agentId).toMatch(/^claude-code:/);
  });

  it('trims empty task', () => {
    const launch = createTerminalAgentLaunch({
      tool: { id: 'claude-code', name: 'Claude Code', cmd: 'claude' },
      task: '',
      cwd: '/repo',
      token: 'tok',
    });

    expect(launch.task).toBe('');
  });

  it('throws when tool is missing metadata', () => {
    expect(() =>
      createTerminalAgentLaunch({
        tool: { id: null },
        cwd: '/repo',
        token: 'tok',
      }),
    ).toThrow('Missing managed agent tool metadata');
  });

  it('throws when cwd is missing', () => {
    expect(() =>
      createTerminalAgentLaunch({
        tool: { id: 'claude-code', cmd: 'claude' },
        cwd: '',
        token: 'tok',
      }),
    ).toThrow('Working directory is required');
  });

  it('throws when token is missing', () => {
    expect(() =>
      createTerminalAgentLaunch({
        tool: { id: 'claude-code', cmd: 'claude' },
        cwd: '/repo',
        token: '',
      }),
    ).toThrow('Missing chinwag auth token');
  });
});

describe('checkManagedAgentToolAvailability', () => {
  it('returns unavailable when tool metadata is missing', async () => {
    const result = await checkManagedAgentToolAvailability({ id: null });
    expect(result.state).toBe('unavailable');
    expect(result.detail).toContain('Missing tool metadata');
  });

  it('returns ready when no availability check is defined', async () => {
    const result = await checkManagedAgentToolAvailability({
      id: 'test-tool',
      cmd: 'test',
    });
    expect(result).toEqual({ toolId: 'test-tool', state: 'ready', detail: 'Ready' });
  });
});

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
});
