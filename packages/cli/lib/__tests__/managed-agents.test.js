import { describe, expect, it } from 'vitest';
import { classifyManagedAgentFailure, createManagedAgentLaunch } from '../managed-agents.js';

describe('createManagedAgentLaunch', () => {
  it('creates a canonical managed-agent launch descriptor', () => {
    const launch = createManagedAgentLaunch({
      tool: {
        id: 'claude-code',
        name: 'Claude Code',
        cmd: 'claude',
        args: ['--print'],
      },
      task: 'Refactor auth flow',
      cwd: '/repo',
      token: 'tok_123',
      cols: 90,
      rows: 30,
    });

    expect(launch).toMatchObject({
      toolId: 'claude-code',
      toolName: 'Claude Code',
      cmd: 'claude',
      args: ['--print'],
      task: 'Refactor auth flow',
      cwd: '/repo',
      cols: 90,
      rows: 30,
    });
    expect(launch.agentId).toMatch(/^claude-code:[0-9a-f]{12}:[0-9a-f]{8}$/);
    expect(launch.env.CHINWAG_TOOL).toBe('claude-code');
    expect(launch.env.CHINWAG_AGENT_ID).toBe(launch.agentId);
  });

  it('classifies Codex auth failures for launcher gating', () => {
    const failure = classifyManagedAgentFailure(
      'codex',
      'ERROR: Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.'
    );

    expect(failure).toMatchObject({
      toolId: 'codex',
      state: 'needs_auth',
      recoveryCommand: 'codex login',
    });
  });
});
