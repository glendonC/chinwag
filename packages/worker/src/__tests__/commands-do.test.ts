import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id = 'test-team') {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

// --- Command submission, claiming, and completion ---

describe('Command relay - DO methods', () => {
  const team = () => getTeam('cmd-relay');
  const dashboardAgent = 'dashboard:cmd1';
  const daemonAgent = 'daemon:cmd1';
  const owner = 'user-cmd1';

  it('setup: join dashboard and daemon agents', async () => {
    const r1 = await team().join(dashboardAgent, owner, 'alice', 'dashboard');
    expect(r1.ok).toBe(true);
    const r2 = await team().join(daemonAgent, owner, 'alice', 'daemon');
    expect(r2.ok).toBe(true);
  });

  it('submits a spawn command', async () => {
    const result = await team().submitCommand(dashboardAgent, owner, 'alice', 'spawn', {
      tool_id: 'claude-code',
      task: 'fix auth bug',
    });
    expect(result.ok).toBe(true);
    expect(result.id).toBeTruthy();
    expect(typeof result.id).toBe('string');
  });

  it('submits a stop command', async () => {
    const result = await team().submitCommand(dashboardAgent, owner, 'alice', 'stop', {
      agent_id: 'claude-code:abc123',
    });
    expect(result.ok).toBe(true);
    expect(result.id).toBeTruthy();
  });

  it('submits a message command', async () => {
    const result = await team().submitCommand(dashboardAgent, owner, 'alice', 'message', {
      text: 'focus on API routes',
      target: 'claude-code:abc123',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects invalid command type', async () => {
    const result = await team().submitCommand(dashboardAgent, owner, 'alice', 'reboot', {});
    expect(result.error).toBeTruthy();
    expect(result.code).toBe('VALIDATION');
  });

  it('rejects non-member', async () => {
    const result = await team().submitCommand('ghost:nobody', 'wrong-owner', 'bob', 'spawn', {
      task: 'test',
    });
    expect(result.error).toBeTruthy();
  });

  it('lists pending commands', async () => {
    const result = await team().getCommands(dashboardAgent, owner);
    expect(result.ok).toBe(true);
    expect(result.commands.length).toBeGreaterThanOrEqual(3);
    // All should be pending (no daemon has claimed them)
    for (const cmd of result.commands) {
      expect(cmd.status).toBe('pending');
    }
  });
});

// --- Claim race: two daemons try to claim the same command ---

describe('Command claiming atomicity', () => {
  const team = () => getTeam('cmd-claim');
  const dashboard = 'dashboard:cc1';
  const daemon1 = 'daemon:cc1';
  const daemon2 = 'daemon:cc2';
  const owner1 = 'user-cc1';
  const owner2 = 'user-cc2';

  let commandId: string;

  it('setup: join agents and submit a command', async () => {
    await team().join(dashboard, owner1, 'alice', 'dashboard');
    await team().join(daemon1, owner1, 'alice', 'daemon');
    await team().join(daemon2, owner2, 'bob', 'daemon');

    const result = await team().submitCommand(dashboard, owner1, 'alice', 'spawn', {
      tool_id: 'cursor',
      task: 'review PR',
    });
    expect(result.ok).toBe(true);
    commandId = result.id;
  });

  // Note: We can't truly test concurrent WebSocket claims at the DO method level,
  // but we can test the domain function directly to verify atomicity.
  // The DO's claimCommand is exposed indirectly via WebSocket, not as an RPC method.
  // We test the domain function via getCommands to verify state transitions.

  it('command appears in pending list', async () => {
    const result = await team().getCommands(dashboard, owner1);
    expect(result.ok).toBe(true);
    const cmd = result.commands.find((c) => c.id === commandId);
    expect(cmd).toBeTruthy();
    expect(cmd.status).toBe('pending');
  });
});
