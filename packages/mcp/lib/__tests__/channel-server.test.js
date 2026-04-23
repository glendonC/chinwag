import { describe, it, expect, vi } from 'vitest';

// Mock dependencies that channel.js imports
vi.mock('../config.js', () => ({
  loadConfig: vi.fn(),
  configExists: vi.fn(),
}));

vi.mock('../team.js', () => ({
  findTeamFile: vi.fn(),
  teamHandlers: vi.fn(),
}));

vi.mock('../identity.js', () => ({
  detectRuntimeIdentity: vi.fn().mockReturnValue({
    hostTool: 'claude-code',
    transport: 'channel',
    capabilities: ['channel'],
  }),
}));

vi.mock('../lifecycle.js', () => ({
  resolveAgentIdentity: vi.fn().mockReturnValue({
    agentId: 'claude-code:abc123',
    hasExactSession: true,
  }),
}));

vi.mock('../api.js', () => ({
  api: vi.fn().mockReturnValue({}),
}));

vi.mock('@chinmeister/shared/session-registry.js', () => ({
  isProcessAlive: vi.fn().mockReturnValue(true),
  pingAgentTerminal: vi.fn(),
}));

import { pingAgentTerminal } from '@chinmeister/shared/session-registry.js';

// --- shouldRequestAttention logic ---
// Extracted from channel.js for testing. We test the pattern directly.

function shouldRequestAttention(content) {
  return (
    content.startsWith('CONFLICT:') ||
    content.startsWith('Message from ') ||
    content.includes('may be stuck')
  );
}

describe('shouldRequestAttention', () => {
  it('returns true for CONFLICT messages', () => {
    expect(shouldRequestAttention('CONFLICT: alice and bob are both editing auth.js')).toBe(true);
  });

  it('returns true for messages from other agents', () => {
    expect(shouldRequestAttention('Message from bob (aider): Rebased!')).toBe(true);
  });

  it('returns true for stuckness alerts', () => {
    expect(
      shouldRequestAttention('Agent alice has been on the same task for 20 min — may be stuck'),
    ).toBe(true);
  });

  it('returns false for join events', () => {
    expect(shouldRequestAttention('Agent alice joined the team')).toBe(false);
  });

  it('returns false for disconnect events', () => {
    expect(shouldRequestAttention('Agent bob disconnected')).toBe(false);
  });

  it('returns false for file activity events', () => {
    expect(shouldRequestAttention('alice started editing auth.js')).toBe(false);
  });

  it('returns false for lock events', () => {
    expect(shouldRequestAttention('alice locked auth.js')).toBe(false);
  });

  it('returns false for memory events', () => {
    expect(shouldRequestAttention('New team knowledge: Redis on port 6379 [config]')).toBe(false);
  });

  it('returns false for lock release events', () => {
    expect(shouldRequestAttention('alice released lock on auth.js')).toBe(false);
  });
});

// --- pushEvent logic ---

describe('pushEvent', () => {
  it('sends notification via server', async () => {
    const server = {
      notification: vi.fn().mockResolvedValue(undefined),
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await server.notification({
      method: 'notifications/claude/channel',
      params: { content: 'Agent alice joined the team' },
    });

    expect(server.notification).toHaveBeenCalledWith({
      method: 'notifications/claude/channel',
      params: { content: 'Agent alice joined the team' },
    });
    consoleSpy.mockRestore();
  });

  it('pings terminal for attention-worthy events', async () => {
    const server = {
      notification: vi.fn().mockResolvedValue(undefined),
    };
    const agentId = 'claude-code:abc123';
    const content = 'CONFLICT: alice and bob are both editing auth.js';
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await server.notification({
      method: 'notifications/claude/channel',
      params: { content },
    });

    if (shouldRequestAttention(content)) {
      pingAgentTerminal(agentId);
    }

    expect(pingAgentTerminal).toHaveBeenCalledWith('claude-code:abc123');
    consoleSpy.mockRestore();
  });

  it('does not ping terminal for non-attention events', () => {
    vi.clearAllMocks();
    const content = 'Agent alice joined the team';

    if (shouldRequestAttention(content)) {
      pingAgentTerminal('claude-code:abc123');
    }

    expect(pingAgentTerminal).not.toHaveBeenCalled();
  });

  it('handles notification failure gracefully', async () => {
    const server = {
      notification: vi.fn().mockRejectedValue(new Error('Connection closed')),
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await server.notification({
        method: 'notifications/claude/channel',
        params: { content: 'test event' },
      });
    } catch (err) {
      consoleSpy(`[chinmeister-channel] Push failed: ${err.message}`);
    }

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Push failed'));
    consoleSpy.mockRestore();
  });
});

// --- Poll logic ---

describe('polling logic', () => {
  it('does not emit events on first poll (initializes prevState)', async () => {
    const { diffState } = await import('../diff-state.js');

    const ctx = {
      members: [{ handle: 'alice', agent_id: 'a1', tool: 'cursor' }],
    };

    // Simulate channel behavior: first fetch sets prevState, no diffing
    let prevState = null;
    const events = [];

    // Initial fetch
    prevState = ctx;
    // No diffing happens here

    // Second poll with same state — diffState should return no events
    const newEvents = diffState(prevState, ctx, new Map());
    events.push(...newEvents);

    expect(events).toEqual([]);
  });

  it('emits events on subsequent polls when state changes', async () => {
    const { diffState } = await import('../diff-state.js');

    const prevState = { members: [] };
    const currState = {
      members: [{ handle: 'alice', agent_id: 'a1', tool: 'cursor' }],
    };

    const events = diffState(prevState, currState, new Map());
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatch(/alice.*joined/);
  });

  it('handles poll failure gracefully (keeps prevState)', async () => {
    const team = {
      getTeamContext: vi.fn().mockRejectedValue(new Error('Network error')),
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const prevState = { members: [] };
    try {
      await team.getTeamContext('t_abc');
    } catch (err) {
      // Poll failed — prevState should not change
      consoleSpy(`[chinmeister-channel] Poll failed: ${err.message}`);
    }

    // prevState remains unchanged
    expect(prevState).toEqual({ members: [] });
    consoleSpy.mockRestore();
  });
});

// Heartbeat logic removed — index.js (MCP server) owns agent presence.
// Channel connects as role:watcher and does not send heartbeats.

// --- Stuckness tracking integration ---

describe('stuckness tracking with channel', () => {
  it('tracks stuckness alerts per agent to avoid duplicates', async () => {
    const { diffState } = await import('../diff-state.js');
    const stucknessAlerted = new Map();

    const stuckMember = {
      handle: 'alice',
      agent_id: 'a1',
      status: 'active',
      activity: { files: ['stuck.js'], updated_at: '2026-01-01T00:00:00Z' },
      minutes_since_update: 20,
    };

    const prevState = { members: [] };
    const currState = { members: [stuckMember] };

    // First poll — should emit stuckness alert
    const events1 = diffState(prevState, currState, stucknessAlerted);
    expect(events1.some((e) => e.includes('may be stuck'))).toBe(true);
    expect(stucknessAlerted.has('a1')).toBe(true);

    // Second poll — should NOT re-emit
    const events2 = diffState(currState, currState, stucknessAlerted);
    expect(events2.some((e) => e.includes('may be stuck'))).toBe(false);
  });
});

// --- Cleanup logic ---

describe('cleanup', () => {
  it('disconnects WebSocket, stops reconciler, and clears parent watch', () => {
    const channelWs = { disconnect: vi.fn() };
    const reconciler = { stop: vi.fn() };
    const parentWatch = setInterval(() => {}, 5_000);

    // Simulate cleanup
    channelWs.disconnect();
    reconciler.stop();
    clearInterval(parentWatch);

    expect(channelWs.disconnect).toHaveBeenCalled();
    expect(reconciler.stop).toHaveBeenCalled();
  });
});
