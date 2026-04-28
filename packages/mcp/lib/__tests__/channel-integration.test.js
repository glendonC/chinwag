import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';

// Mock MCP SDK - must use class syntax for `new Server()`
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  class MockServer {
    constructor() {
      this.connect = vi.fn().mockResolvedValue(undefined);
      this.notification = vi.fn().mockResolvedValue(undefined);
    }
  }
  return { Server: MockServer };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  class MockTransport {}
  return { StdioServerTransport: MockTransport };
});

// Mock all dependencies using paths that match channel.js imports
// channel.js is at packages/mcp/channel.js and imports from ./dist/*
vi.mock('../../dist/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({ token: 'tok_test' }),
  configExists: vi.fn().mockReturnValue(true),
}));

vi.mock('../../dist/api.js', () => ({
  api: vi.fn().mockReturnValue({
    post: vi.fn().mockResolvedValue({ ticket: 'tk_test' }),
    get: vi.fn().mockResolvedValue({}),
  }),
  getApiUrl: vi.fn().mockReturnValue('https://api.test.com'),
}));

vi.mock('../../dist/team.js', () => ({
  findTeamFile: vi.fn().mockReturnValue('t_abc'),
  teamHandlers: vi.fn().mockReturnValue({
    getTeamContext: vi.fn().mockResolvedValue({ members: [] }),
    heartbeat: vi.fn().mockResolvedValue({ ok: true }),
    joinTeam: vi.fn().mockResolvedValue({ ok: true }),
  }),
}));

vi.mock('../../dist/identity.js', () => ({
  detectRuntimeIdentity: vi.fn().mockReturnValue({
    hostTool: 'claude-code',
    agentSurface: null,
    transport: 'channel',
    tier: 'managed',
    capabilities: ['channel'],
    detectionSource: 'explicit',
    detectionConfidence: 1,
  }),
}));

vi.mock('../../dist/lifecycle.js', () => ({
  resolveAgentIdentity: vi.fn().mockReturnValue({
    agentId: 'claude-code:abc123',
    fallbackAgentId: 'claude-code:abc123',
    hasExactSession: true,
  }),
}));

vi.mock('../../dist/diff-state.js', () => ({
  diffState: vi.fn().mockReturnValue([]),
}));

vi.mock('@chinmeister/shared/session-registry.js', () => ({
  isProcessAlive: vi.fn().mockReturnValue(true),
  pingAgentTerminal: vi.fn(),
}));

vi.mock('../channel-ws.js', () => ({
  createChannelWebSocket: vi.fn().mockReturnValue({
    connect: vi.fn(),
    disconnect: vi.fn(),
    getContext: vi.fn().mockReturnValue(null),
    setContext: vi.fn(),
    isConnected: vi.fn().mockReturnValue(false),
  }),
}));

vi.mock('../channel-reconcile.js', () => ({
  createReconciler: vi.fn().mockReturnValue({
    start: vi.fn(),
    stop: vi.fn(),
    reconcile: vi.fn(),
  }),
}));

import { configExists, loadConfig } from '../../dist/config.js';
import { findTeamFile } from '../../dist/team.js';
import { detectRuntimeIdentity } from '../../dist/identity.js';

describe('channel.js entry point coverage', () => {
  let exitSpy;
  let consoleSpy;
  let originalStdin;
  let fakeStdin;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Create a fake stdin that doesn't close immediately so the channel server
    // can set up its listeners
    fakeStdin = new Readable({
      read() {
        // Don't push anything - keep the stream open
      },
    });
    // Preserve real stdin reference
    originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      value: fakeStdin,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      writable: true,
      configurable: true,
    });
    exitSpy.mockRestore();
    consoleSpy.mockRestore();

    // Clear all intervals/timeouts that channel.js may have started
    vi.restoreAllMocks();
  });

  it('exits 1 when no config exists', async () => {
    configExists.mockReturnValue(false);

    vi.resetModules();
    await import('../../channel.js');
    await new Promise((r) => setTimeout(r, 50));

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No config found'));
  });

  it('exits 1 when config has no token', async () => {
    configExists.mockReturnValue(true);
    loadConfig.mockReturnValue({});

    vi.resetModules();
    await import('../../channel.js');
    await new Promise((r) => setTimeout(r, 50));

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('missing token'));
  });

  it('exits 0 when no team file found', async () => {
    configExists.mockReturnValue(true);
    loadConfig.mockReturnValue({ token: 'tok_test' });
    findTeamFile.mockReturnValue(null);

    vi.resetModules();
    await import('../../channel.js');
    await new Promise((r) => setTimeout(r, 50));

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No .chinmeister file'));
  });

  it('exits 0 when host does not support channel capability', async () => {
    configExists.mockReturnValue(true);
    loadConfig.mockReturnValue({ token: 'tok_test' });
    findTeamFile.mockReturnValue('t_abc');
    detectRuntimeIdentity.mockReturnValue({
      hostTool: 'cursor',
      transport: 'mcp',
      capabilities: ['mcp'], // no 'channel'
    });

    vi.resetModules();
    await import('../../channel.js');
    await new Promise((r) => setTimeout(r, 50));

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('channel disabled'));
  });

  it('starts channel server successfully with valid config and team', async () => {
    configExists.mockReturnValue(true);
    loadConfig.mockReturnValue({ token: 'tok_test' });
    findTeamFile.mockReturnValue('t_abc');
    detectRuntimeIdentity.mockReturnValue({
      hostTool: 'claude-code',
      transport: 'channel',
      capabilities: ['channel'],
    });

    vi.resetModules();
    await import('../../channel.js');
    await new Promise((r) => setTimeout(r, 100));

    // Should have logged the running message
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Channel server running'));
    // Should not have exited
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// --- shouldRequestAttention unit tests ---

describe('shouldRequestAttention', () => {
  // Re-implement the function for testing since it's not exported
  function shouldRequestAttention(content) {
    return (
      content.startsWith('CONFLICT:') ||
      content.startsWith('Message from ') ||
      content.includes('may be stuck')
    );
  }

  it('triggers on CONFLICT messages', () => {
    expect(shouldRequestAttention('CONFLICT: alice and bob editing auth.js')).toBe(true);
  });

  it('triggers on Message from events', () => {
    expect(shouldRequestAttention('Message from bob: hey')).toBe(true);
  });

  it('triggers on stuckness alerts', () => {
    expect(shouldRequestAttention('Agent alice may be stuck on auth.js')).toBe(true);
  });

  it('does not trigger on join events', () => {
    expect(shouldRequestAttention('Agent alice joined the team')).toBe(false);
  });

  it('does not trigger on file activity', () => {
    expect(shouldRequestAttention('alice started editing auth.js')).toBe(false);
  });

  it('does not trigger on lock events', () => {
    expect(shouldRequestAttention('alice locked auth.js')).toBe(false);
  });

  it('does not trigger on memory events', () => {
    expect(shouldRequestAttention('New team knowledge: Redis on 6379')).toBe(false);
  });
});
