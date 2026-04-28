import { describe, expect, it } from 'vitest';
import { TOOL_CATALOG } from '../catalog.js';
import { MCP_TOOLS } from '@chinmeister/shared/tool-registry.js';

describe('tool catalog', () => {
  it('includes every shared MCP-configurable tool exactly once', () => {
    // Non-MCP tools (e.g. Copilot) legitimately live in MCP_TOOLS for
    // clientInfo attribution but aren't mcpConfigurable. The catalog should
    // mirror only the configurable subset, so filter both sides by the same
    // invariant.
    const catalogIds = TOOL_CATALOG.filter((tool) => tool.mcpConfigurable)
      .map((tool) => tool.id)
      .sort();
    const sharedIds = MCP_TOOLS.filter((tool) => tool.catalog.mcpConfigurable)
      .map((tool) => tool.id)
      .sort();

    expect(catalogIds).toEqual(sharedIds);
  });

  it('contains only registry-derived entries with id + name', () => {
    for (const tool of TOOL_CATALOG) {
      expect(tool).toHaveProperty('id');
      expect(tool).toHaveProperty('name');
      // Every entry that flags `mcpConfigurable` must also flag
      // `mcpCompatible` - can't be configurable for MCP without being
      // compatible with it.
      if (tool.mcpConfigurable) {
        expect(tool.mcpCompatible, `${tool.id}`).toBe(true);
      }
    }
  });
});
