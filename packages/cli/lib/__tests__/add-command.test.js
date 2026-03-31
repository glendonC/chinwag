import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the tools registry
vi.mock('../tools.js', () => ({
  MCP_TOOLS: [
    { id: 'cursor', name: 'Cursor' },
    { id: 'claude-code', name: 'Claude Code' },
  ],
}));

// Mock the mcp-config module
vi.mock('../mcp-config.js', () => ({
  configureTool: vi.fn(),
}));

// Mock the config module
vi.mock('../config.js', () => ({
  configExists: vi.fn(),
  loadConfig: vi.fn(),
}));

// Mock the API module
vi.mock('../api.js', () => ({
  api: vi.fn(),
}));

import { configureTool } from '../mcp-config.js';
import { configExists, loadConfig } from '../config.js';
import { api } from '../api.js';
import { runAdd } from '../add-command.js';

let consoleLogSpy;
let processExitSpy;

beforeEach(() => {
  vi.clearAllMocks();
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  processExitSpy.mockRestore();
});

describe('runAdd', () => {
  describe('MCP-configurable tools', () => {
    it('adds tool config from the MCP registry', async () => {
      configureTool.mockReturnValue({ ok: true, name: 'Cursor', detail: '.cursor/mcp.json' });

      await runAdd('cursor');

      expect(configureTool).toHaveBeenCalledWith(process.cwd(), 'cursor');
      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/Added Cursor: \.cursor\/mcp\.json/);
    });

    it('handles configuration error for MCP tool', async () => {
      configureTool.mockReturnValue({ error: 'Permission denied' });

      await runAdd('cursor');

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/Permission denied/);
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('catalog tools (non-MCP)', () => {
    it('handles unknown tool name with no catalog match', async () => {
      configExists.mockReturnValue(true);
      loadConfig.mockReturnValue({ token: 'tok_ok' });

      const mockClient = {
        get: vi.fn().mockResolvedValue({
          tools: [
            { id: 'some-tool', name: 'SomeTool', description: 'A tool', category: 'other' },
          ],
          categories: { other: 'Other' },
        }),
      };
      api.mockReturnValue(mockClient);

      await runAdd('completely-unknown');

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/Unknown tool "completely-unknown"/);
    });

    it('suggests closest match for unknown tool', async () => {
      configExists.mockReturnValue(true);
      loadConfig.mockReturnValue({ token: 'tok_ok' });

      const mockClient = {
        get: vi.fn().mockResolvedValue({
          tools: [
            { id: 'windsurf', name: 'Windsurf', description: 'AI code editor', category: 'editors' },
          ],
          categories: { editors: 'Editors' },
        }),
      };
      api.mockReturnValue(mockClient);

      await runAdd('wind');

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/Did you mean "windsurf"/);
    });

    it('shows catalog tool info when found', async () => {
      configExists.mockReturnValue(true);
      loadConfig.mockReturnValue({ token: 'tok_ok' });

      const mockClient = {
        get: vi.fn().mockResolvedValue({
          tools: [
            {
              id: 'copilot',
              name: 'GitHub Copilot',
              description: 'AI pair programmer',
              mcpCompatible: false,
              category: 'ai',
              website: 'https://copilot.github.com',
            },
          ],
          categories: { ai: 'AI Tools' },
        }),
      };
      api.mockReturnValue(mockClient);

      await runAdd('copilot');

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/GitHub Copilot/);
      expect(logCalls).toMatch(/does not support MCP/);
      expect(logCalls).toMatch(/copilot\.github\.com/);
    });

    it('handles API errors when fetching catalog', async () => {
      configExists.mockReturnValue(true);
      loadConfig.mockReturnValue({ token: 'tok_ok' });

      const mockClient = {
        get: vi.fn().mockRejectedValue(new Error('Server unavailable')),
      };
      api.mockReturnValue(mockClient);

      await runAdd('sometool');

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/Could not fetch tool catalog/);
    });
  });

  describe('--list mode', () => {
    it('lists available tools from catalog', async () => {
      configExists.mockReturnValue(true);
      loadConfig.mockReturnValue({ token: 'tok_ok' });

      const mockClient = {
        get: vi.fn().mockResolvedValue({
          tools: [
            { id: 'cursor', name: 'Cursor', description: 'AI editor', mcpCompatible: true, mcpConfigurable: true, category: 'editors' },
            { id: 'aider', name: 'Aider', description: 'AI terminal tool', mcpCompatible: true, mcpConfigurable: false, category: 'cli' },
          ],
          categories: { editors: 'Editors', cli: 'CLI Tools' },
        }),
      };
      api.mockReturnValue(mockClient);

      await runAdd('--list');

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/Available tools/);
      expect(logCalls).toMatch(/cursor/);
      expect(logCalls).toMatch(/aider/);
    });

    it('handles empty/null tool arg as --list', async () => {
      configExists.mockReturnValue(true);
      loadConfig.mockReturnValue({ token: 'tok_ok' });

      const mockClient = {
        get: vi.fn().mockResolvedValue({ tools: [], categories: {} }),
      };
      api.mockReturnValue(mockClient);

      await runAdd(null);

      // Should call the catalog endpoint (list mode)
      expect(mockClient.get).toHaveBeenCalledWith('/tools/catalog');
    });

    it('handles catalog fetch failure in list mode', async () => {
      configExists.mockReturnValue(false);
      loadConfig.mockReturnValue(null);

      const mockClient = {
        get: vi.fn().mockRejectedValue(new Error('Offline')),
      };
      api.mockReturnValue(mockClient);

      await runAdd('--list');

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).toMatch(/Could not fetch tool catalog/);
    });
  });
});
