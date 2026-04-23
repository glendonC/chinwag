import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectRuntimeIdentity,
  detectToolName,
  generateAgentId,
  generateSessionAgentId,
  getConfiguredAgentId,
  inferToolFromClientInfo,
} from '../agent-identity.js';

describe('agent-identity', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('detectRuntimeIdentity', () => {
    it('returns default host when no detection source is available', () => {
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(result.hostTool).toBe('unknown');
      expect(result.detectionSource).toBe('fallback');
      expect(result.detectionConfidence).toBe(0.2);
      expect(result.transport).toBe('mcp');
    });

    it('detects tool from --tool argv flag (explicit source)', () => {
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js', '--tool', 'cursor'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(result.hostTool).toBe('cursor');
      expect(result.detectionSource).toBe('explicit');
      expect(result.detectionConfidence).toBe(1);
    });

    it('detects tool from CHINMEISTER_TOOL env var', () => {
      process.env.CHINMEISTER_TOOL = 'windsurf';
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(result.hostTool).toBe('windsurf');
      expect(result.detectionSource).toBe('explicit');
    });

    it('argv --tool takes precedence over CHINMEISTER_TOOL env', () => {
      process.env.CHINMEISTER_TOOL = 'windsurf';
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js', '--tool', 'cursor'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(result.hostTool).toBe('cursor');
    });

    it('detects surface from --surface argv flag', () => {
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js', '--surface', 'cline'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(result.agentSurface).toBe('cline');
    });

    it('detects surface from CHINMEISTER_SURFACE env var', () => {
      process.env.CHINMEISTER_SURFACE = 'continue';
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(result.agentSurface).toBe('continue');
    });

    it('detects transport from --transport argv flag', () => {
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js', '--transport', 'managed-cli'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(result.transport).toBe('managed-cli');
    });

    it('detects transport from CHINMEISTER_TRANSPORT env var', () => {
      process.env.CHINMEISTER_TRANSPORT = 'managed-cli';
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(result.transport).toBe('managed-cli');
    });

    it('walks parent process tree to detect tool', () => {
      const processTree = {
        100: { ppid: 50, command: '/usr/bin/node chinmeister-mcp' },
        50: { ppid: 25, command: '/opt/bin/cursor --some-flag' },
        25: { ppid: 1, command: 'init' },
      };
      const readFn = (pid) => processTree[pid] || null;

      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
      });
      // chinmeister-mcp is skipped, cursor should match
      expect(result.hostTool).toBe('cursor');
      expect(result.detectionSource).toBe('parent-process');
      expect(result.detectionConfidence).toBe(0.7);
    });

    it('stops walking when process info returns null', () => {
      const readFn = vi.fn().mockReturnValue(null);
      const result = detectRuntimeIdentity('fallback-tool', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
      });
      expect(result.hostTool).toBe('fallback-tool');
      expect(readFn).toHaveBeenCalledTimes(1);
    });

    it('stops walking when ppid equals pid (cycle)', () => {
      const readFn = vi.fn().mockReturnValue({ ppid: 100, command: '/bin/sh' });
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
      });
      expect(result.hostTool).toBe('unknown');
      expect(readFn).toHaveBeenCalledTimes(1);
    });

    it('respects maxParentHops limit', () => {
      let pid = 100;
      const readFn = vi.fn().mockImplementation(() => {
        pid -= 1;
        return { ppid: pid, command: '/bin/bash' };
      });

      detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
        maxParentHops: 3,
      });
      expect(readFn).toHaveBeenCalledTimes(3);
    });

    it('skips chinmeister-mcp and chinmeister-channel commands in process tree', () => {
      const processTree = {
        100: { ppid: 50, command: 'node chinmeister-mcp serve' },
        50: { ppid: 25, command: 'node chinmeister-channel start' },
        25: { ppid: 1, command: 'claude --some-flag' },
      };
      const readFn = (pid) => processTree[pid] || null;

      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
      });
      expect(result.hostTool).toBe('claude-code');
    });

    it('detects tool via alias matching in process tree (e.g., "claude code")', () => {
      const processTree = {
        100: { ppid: 50, command: '/usr/bin/node some-script' },
        50: { ppid: 25, command: 'claude code --project /foo' },
        25: { ppid: 1, command: 'init' },
      };
      const readFn = (pid) => processTree[pid] || null;

      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
      });
      expect(result.hostTool).toBe('claude-code');
      expect(result.detectionSource).toBe('parent-process');
    });

    it('detects tool from --tool=value flag syntax (with equals)', () => {
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js', '--tool=windsurf'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(result.hostTool).toBe('windsurf');
      expect(result.detectionSource).toBe('explicit');
    });

    it('detects transport from --transport=value flag syntax', () => {
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js', '--transport=managed-cli'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(result.transport).toBe('managed-cli');
    });

    it('detects surface from --surface=value flag syntax', () => {
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js', '--surface=cline'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(result.agentSurface).toBe('cline');
    });

    it('respects options.defaultTransport fallback', () => {
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: () => null,
        parentPid: 1,
        defaultTransport: 'channel',
      });
      expect(result.transport).toBe('channel');
    });

    it('stops process walk when ppid is 0 (falsy)', () => {
      const readFn = vi.fn().mockReturnValue({ ppid: 0, command: '/bin/sh' });
      const result = detectRuntimeIdentity('fallback', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
      });
      expect(result.hostTool).toBe('fallback');
      expect(readFn).toHaveBeenCalledTimes(1);
    });

    it('detects jetbrains via "intellij idea" alias', () => {
      const processTree = {
        100: { ppid: 1, command: 'IntelliJ IDEA Ultimate /some/path' },
      };
      const readFn = (pid) => processTree[pid] || null;

      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
      });
      expect(result.hostTool).toBe('jetbrains');
    });

    it('detects vscode via "code helper" alias', () => {
      const processTree = {
        100: {
          ppid: 1,
          command:
            '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)',
        },
      };
      const readFn = (pid) => processTree[pid] || null;

      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
      });
      expect(result.hostTool).toBe('vscode');
    });

    it('returns capabilities sorted alphabetically', () => {
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js', '--tool', 'claude-code'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      const caps = result.capabilities;
      expect(caps).toEqual([...caps].sort());
    });

    it('sets tier to managed when transport is managed-cli and host is unknown', () => {
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js', '--transport', 'managed-cli'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(result.tier).toBe('managed');
    });
  });

  describe('detectToolName', () => {
    it('returns just the hostTool from detectRuntimeIdentity', () => {
      const tool = detectToolName('fallback', {
        argv: ['node', 'script.js', '--tool', 'cursor'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(tool).toBe('cursor');
    });

    it('returns default when nothing detected', () => {
      const tool = detectToolName('my-default', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: () => null,
        parentPid: 1,
      });
      expect(tool).toBe('my-default');
    });
  });

  describe('generateAgentId', () => {
    it('creates a deterministic ID from token and tool name string', () => {
      const id1 = generateAgentId('token123', 'cursor');
      const id2 = generateAgentId('token123', 'cursor');
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^cursor:[a-f0-9]{12}$/);
    });

    it('produces different IDs for different tokens', () => {
      const id1 = generateAgentId('token-a', 'cursor');
      const id2 = generateAgentId('token-b', 'cursor');
      expect(id1).not.toBe(id2);
    });

    it('accepts a runtime identity object with hostTool', () => {
      const id = generateAgentId('token', { hostTool: 'windsurf' });
      expect(id).toMatch(/^windsurf:[a-f0-9]{12}$/);
    });

    it('accepts a runtime identity object with tool field', () => {
      const id = generateAgentId('token', { tool: 'vscode' });
      expect(id).toMatch(/^vscode:[a-f0-9]{12}$/);
    });

    it('falls back to "unknown" when tool name is null', () => {
      const id = generateAgentId('token', null);
      expect(id).toMatch(/^unknown:[a-f0-9]{12}$/);
    });

    it('falls back to "unknown" for undefined tool', () => {
      const id = generateAgentId('token', undefined);
      expect(id).toMatch(/^unknown:[a-f0-9]{12}$/);
    });
  });

  describe('generateSessionAgentId', () => {
    it('extends generateAgentId with a random suffix', () => {
      const id = generateSessionAgentId('token', 'cursor');
      expect(id).toMatch(/^cursor:[a-f0-9]{12}:[a-f0-9]{8}$/);
    });

    it('generates unique IDs on each call (random suffix)', () => {
      const id1 = generateSessionAgentId('token', 'cursor');
      const id2 = generateSessionAgentId('token', 'cursor');
      expect(id1).not.toBe(id2);
      // But the base prefix is the same
      expect(id1.slice(0, id1.lastIndexOf(':'))).toBe(id2.slice(0, id2.lastIndexOf(':')));
    });
  });

  describe('getConfiguredAgentId', () => {
    afterEach(() => {
      delete process.env.CHINMEISTER_AGENT_ID;
    });

    it('returns null when CHINMEISTER_AGENT_ID is not set', () => {
      delete process.env.CHINMEISTER_AGENT_ID;
      expect(getConfiguredAgentId()).toBeNull();
    });

    it('returns null when CHINMEISTER_AGENT_ID is empty', () => {
      process.env.CHINMEISTER_AGENT_ID = '';
      expect(getConfiguredAgentId()).toBeNull();
    });

    it('returns null when CHINMEISTER_AGENT_ID is whitespace only', () => {
      process.env.CHINMEISTER_AGENT_ID = '   ';
      expect(getConfiguredAgentId()).toBeNull();
    });

    it('returns null when CHINMEISTER_AGENT_ID exceeds 60 chars', () => {
      process.env.CHINMEISTER_AGENT_ID = 'a'.repeat(61);
      expect(getConfiguredAgentId()).toBeNull();
    });

    it('returns the agent ID when valid and no tool constraint', () => {
      process.env.CHINMEISTER_AGENT_ID = 'cursor:abc123def456';
      expect(getConfiguredAgentId()).toBe('cursor:abc123def456');
    });

    it('returns the agent ID when tool prefix matches', () => {
      process.env.CHINMEISTER_AGENT_ID = 'cursor:abc123def456';
      expect(getConfiguredAgentId('cursor')).toBe('cursor:abc123def456');
    });

    it('returns null when tool prefix does not match', () => {
      process.env.CHINMEISTER_AGENT_ID = 'cursor:abc123def456';
      expect(getConfiguredAgentId('windsurf')).toBeNull();
    });

    it('accepts runtime identity objects for tool name', () => {
      process.env.CHINMEISTER_AGENT_ID = 'vscode:abc';
      expect(getConfiguredAgentId({ hostTool: 'vscode' })).toBe('vscode:abc');
      expect(getConfiguredAgentId({ hostTool: 'cursor' })).toBeNull();
    });

    it('trims whitespace from CHINMEISTER_AGENT_ID', () => {
      process.env.CHINMEISTER_AGENT_ID = '  cursor:abc  ';
      expect(getConfiguredAgentId('cursor')).toBe('cursor:abc');
    });
  });

  describe('inferToolFromClientInfo', () => {
    it('resolves Claude Code from exact clientInfo name', () => {
      expect(inferToolFromClientInfo('claude-code')).toBe('claude-code');
    });

    it('resolves Claude Code case-insensitively', () => {
      expect(inferToolFromClientInfo('Claude Code')).toBe('claude-code');
      expect(inferToolFromClientInfo('CLAUDE-CODE')).toBe('claude-code');
    });

    it('resolves Cursor', () => {
      expect(inferToolFromClientInfo('Cursor')).toBe('cursor');
      expect(inferToolFromClientInfo('cursor')).toBe('cursor');
    });

    it('resolves Windsurf and its alias', () => {
      expect(inferToolFromClientInfo('windsurf')).toBe('windsurf');
      expect(inferToolFromClientInfo('Codeium')).toBe('windsurf');
    });

    it('resolves VS Code from multiple names', () => {
      expect(inferToolFromClientInfo('Visual Studio Code')).toBe('vscode');
      expect(inferToolFromClientInfo('vscode')).toBe('vscode');
      expect(inferToolFromClientInfo('VS Code')).toBe('vscode');
    });

    it('resolves GitHub Copilot as a distinct tool from VS Code', () => {
      // Copilot sessions used to fold into `vscode`; now they route to
      // `copilot` so analytics can attribute cost/tokens/conversation
      // signals to the actual product, not the host editor.
      expect(inferToolFromClientInfo('GitHub Copilot')).toBe('copilot');
      expect(inferToolFromClientInfo('copilot')).toBe('copilot');
    });

    it('resolves Codex', () => {
      expect(inferToolFromClientInfo('codex')).toBe('codex');
      expect(inferToolFromClientInfo('openai-codex')).toBe('codex');
    });

    it('resolves JetBrains IDEs', () => {
      expect(inferToolFromClientInfo('IntelliJ IDEA')).toBe('jetbrains');
      expect(inferToolFromClientInfo('PyCharm')).toBe('jetbrains');
      expect(inferToolFromClientInfo('WebStorm')).toBe('jetbrains');
    });

    it('resolves Amazon Q', () => {
      expect(inferToolFromClientInfo('Amazon Q')).toBe('amazon-q');
      expect(inferToolFromClientInfo('Q Developer')).toBe('amazon-q');
    });

    it('resolves Aider', () => {
      expect(inferToolFromClientInfo('aider')).toBe('aider');
      expect(inferToolFromClientInfo('aider-chat')).toBe('aider');
    });

    it('returns null for unknown clients', () => {
      expect(inferToolFromClientInfo('some-random-client')).toBeNull();
      expect(inferToolFromClientInfo('')).toBeNull();
    });

    it('trims whitespace', () => {
      expect(inferToolFromClientInfo('  cursor  ')).toBe('cursor');
    });
  });

  describe('detectRuntimeIdentity with clientInfoName', () => {
    it('uses clientInfoName when no explicit tool is set', () => {
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: () => null,
        parentPid: 1,
        clientInfoName: 'Claude Code',
      });
      expect(result.hostTool).toBe('claude-code');
      expect(result.detectionSource).toBe('mcp-client-info');
      expect(result.detectionConfidence).toBe(0.95);
    });

    it('explicit --tool takes precedence over clientInfoName', () => {
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js', '--tool', 'windsurf'],
        readProcessInfoFn: () => null,
        parentPid: 1,
        clientInfoName: 'Claude Code',
      });
      expect(result.hostTool).toBe('windsurf');
      expect(result.detectionSource).toBe('explicit');
    });

    it('CHINMEISTER_TOOL env takes precedence over clientInfoName', () => {
      process.env.CHINMEISTER_TOOL = 'codex';
      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: () => null,
        parentPid: 1,
        clientInfoName: 'Cursor',
      });
      expect(result.hostTool).toBe('codex');
      expect(result.detectionSource).toBe('explicit');
    });

    it('clientInfoName takes precedence over process tree detection', () => {
      const processTree = {
        100: { ppid: 1, command: '/opt/bin/cursor --some-flag' },
      };
      const readFn = (pid) => processTree[pid] || null;

      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
        clientInfoName: 'Claude Code',
      });
      expect(result.hostTool).toBe('claude-code');
      expect(result.detectionSource).toBe('mcp-client-info');
    });

    it('falls through to process tree when clientInfoName is unrecognized', () => {
      const processTree = {
        100: { ppid: 1, command: '/opt/bin/cursor --some-flag' },
      };
      const readFn = (pid) => processTree[pid] || null;

      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
        clientInfoName: 'totally-unknown-client',
      });
      expect(result.hostTool).toBe('cursor');
      expect(result.detectionSource).toBe('parent-process');
    });
  });

  describe('commandPatterns in process tree detection', () => {
    it('detects Claude Code from npm package path in command string', () => {
      const processTree = {
        100: {
          ppid: 1,
          command:
            '/usr/local/bin/node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
        },
      };
      const readFn = (pid) => processTree[pid] || null;

      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
      });
      expect(result.hostTool).toBe('claude-code');
      expect(result.detectionSource).toBe('parent-process');
    });

    it('detects Codex from npm package path in command string', () => {
      const processTree = {
        100: {
          ppid: 1,
          command: 'node /home/user/.npm/_npx/@openai/codex/bin/codex.js',
        },
      };
      const readFn = (pid) => processTree[pid] || null;

      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
      });
      expect(result.hostTool).toBe('codex');
      expect(result.detectionSource).toBe('parent-process');
    });

    it('detects Aider from pip package path in command string', () => {
      const processTree = {
        100: {
          ppid: 1,
          command: '/usr/bin/python3 /home/user/.local/bin/aider-chat --model gpt-4',
        },
      };
      const readFn = (pid) => processTree[pid] || null;

      const result = detectRuntimeIdentity('unknown', {
        argv: ['node', 'script.js'],
        readProcessInfoFn: readFn,
        parentPid: 100,
      });
      expect(result.hostTool).toBe('aider');
      expect(result.detectionSource).toBe('parent-process');
    });
  });
});
