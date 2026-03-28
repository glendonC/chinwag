import { describe, expect, it } from 'vitest';
import { MCP_TOOLS } from '../../../shared/tool-registry.js';

describe('shared MCP tool registry', () => {
  it('uses unique ids for every configurable tool', () => {
    const ids = MCP_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes discovery metadata for every configurable tool', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.catalog?.name ?? tool.name).toBeTruthy();
      expect(tool.catalog?.description).toBeTruthy();
      expect(tool.catalog?.website).toBeTruthy();
      expect(tool.catalog?.mcpCompatible).toBe(true);
      expect(tool.catalog?.mcpConfigurable).toBe(true);
    }
  });

  it('keeps process inference hints aligned with known executables', () => {
    for (const tool of MCP_TOOLS) {
      const candidates = new Set([
        ...(tool.detect?.cmds || []),
        ...(tool.processDetection?.executables || []),
      ]);
      expect(candidates.size).toBeGreaterThan(0);
    }
  });
});
