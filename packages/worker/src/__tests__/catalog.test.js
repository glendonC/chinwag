import { describe, expect, it } from 'vitest';
import { TOOL_CATALOG } from '../catalog.js';
import { MCP_TOOLS } from '../../../shared/tool-registry.js';

describe('tool catalog', () => {
  it('includes every shared MCP-configurable tool exactly once', () => {
    const catalogIds = TOOL_CATALOG
      .filter((tool) => tool.mcpConfigurable)
      .map((tool) => tool.id)
      .sort();
    const sharedIds = MCP_TOOLS.map((tool) => tool.id).sort();

    expect(catalogIds).toEqual(sharedIds);
  });
});
