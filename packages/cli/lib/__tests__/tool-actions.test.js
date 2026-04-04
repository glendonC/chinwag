import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Tests for packages/cli/lib/utils/tool-actions.ts.
 *
 * We mock the MCP_TOOLS registry and configureTool to isolate
 * the addToolToProject logic.
 */

async function loadModule(
  mcpTools = [],
  configureResult = { ok: true, name: 'Test', detail: 'configured' },
) {
  vi.resetModules();

  vi.doMock('../tools.js', () => ({
    MCP_TOOLS: mcpTools,
  }));

  vi.doMock('../mcp-config.js', () => ({
    configureTool: vi.fn(() => configureResult),
  }));

  const mod = await import('../utils/tool-actions.js');
  const { configureTool } = await import('../mcp-config.js');
  return { addToolToProject: mod.addToolToProject, configureTool };
}

describe('addToolToProject', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── MCP tool path ─────────────────────────────────────

  describe('MCP-configured tools', () => {
    it('returns success when configureTool succeeds', async () => {
      const { addToolToProject } = await loadModule([{ id: 'cursor' }], {
        ok: true,
        name: 'Cursor',
        detail: 'MCP config written',
      });
      const result = addToolToProject({ id: 'cursor', name: 'Cursor' }, '/project');
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Added Cursor');
      expect(result.message).toContain('MCP config written');
    });

    it('returns failure when configureTool fails', async () => {
      const { addToolToProject } = await loadModule([{ id: 'cursor' }], {
        ok: false,
        name: 'Cursor',
        error: 'Permission denied',
      });
      const result = addToolToProject({ id: 'cursor', name: 'Cursor' }, '/project');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Could not add Cursor');
      expect(result.message).toContain('Permission denied');
    });

    it('uses tool.name as fallback when result.name is missing', async () => {
      const { addToolToProject } = await loadModule([{ id: 'cursor' }], {
        ok: false,
        error: 'Unknown error',
      });
      const result = addToolToProject({ id: 'cursor', name: 'Cursor' }, '/project');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Cursor');
    });

    it('calls configureTool with correct arguments', async () => {
      const { addToolToProject, configureTool } = await loadModule([{ id: 'my-tool' }], {
        ok: true,
        name: 'My Tool',
        detail: 'done',
      });
      addToolToProject({ id: 'my-tool', name: 'My Tool' }, '/my/project');
      expect(configureTool).toHaveBeenCalledWith('/my/project', 'my-tool');
    });
  });

  // ── Install command path ──────────────────────────────

  describe('tools with installCmd', () => {
    it('returns success with install instructions', async () => {
      const { addToolToProject } = await loadModule([], {});
      const result = addToolToProject(
        {
          id: 'eslint',
          name: 'ESLint',
          installCmd: 'npm install eslint',
          website: 'https://eslint.org',
        },
        '/project',
      );
      expect(result.ok).toBe(true);
      expect(result.message).toContain('ESLint');
      expect(result.message).toContain('npm install eslint');
      expect(result.message).toContain('https://eslint.org');
    });

    it('includes install command and website in message', async () => {
      const { addToolToProject } = await loadModule([], {});
      const result = addToolToProject(
        { id: 'tool', name: 'Tool', installCmd: 'brew install tool', website: 'https://tool.dev' },
        '/project',
      );
      expect(result.message).toMatch(/Install.*brew install tool/);
      expect(result.message).toContain('https://tool.dev');
    });
  });

  // ── Website-only path ─────────────────────────────────

  describe('tools with website only', () => {
    it('returns success with visit link', async () => {
      const { addToolToProject } = await loadModule([], {});
      const result = addToolToProject(
        { id: 'notion', name: 'Notion', website: 'https://notion.so' },
        '/project',
      );
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Notion');
      expect(result.message).toContain('Visit');
      expect(result.message).toContain('https://notion.so');
    });
  });

  // ── No configuration available ────────────────────────

  describe('tools with no configuration', () => {
    it('returns failure when tool has no installCmd or website', async () => {
      const { addToolToProject } = await loadModule([], {});
      const result = addToolToProject({ id: 'mystery', name: 'Mystery Tool' }, '/project');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Mystery Tool');
      expect(result.message).toContain('no configuration available');
    });

    it('returns failure when installCmd is null and website is undefined', async () => {
      const { addToolToProject } = await loadModule([], {});
      const result = addToolToProject({ id: 'noop', name: 'NoOp', installCmd: null }, '/project');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('no configuration available');
    });
  });

  // ── Priority: MCP > installCmd > website ──────────────

  describe('priority ordering', () => {
    it('prefers MCP configuration over installCmd and website', async () => {
      const { addToolToProject } = await loadModule([{ id: 'tool-x' }], {
        ok: true,
        name: 'Tool X',
        detail: 'MCP configured',
      });
      const result = addToolToProject(
        { id: 'tool-x', name: 'Tool X', installCmd: 'npm i tool-x', website: 'https://x.dev' },
        '/project',
      );
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Added Tool X');
      expect(result.message).toContain('MCP configured');
      expect(result.message).not.toContain('Install');
    });
  });
});
