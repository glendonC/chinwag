import { describe, expect, it } from 'vitest';
import { MCP_TOOLS } from '@chinwag/shared/tool-registry.js';

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

  it('declares at least one process inference hint for every tool', () => {
    for (const tool of MCP_TOOLS) {
      // Tools can be detected by any of: executable name (detect.cmds /
      // processDetection.executables), or by a package substring match in the
      // full ps command line (processDetection.commandPatterns). VS Code-hosted
      // agents like Cline have no executable of their own and rely on the
      // package pattern; that is still a valid process-level detection path.
      const candidates = new Set([
        ...(tool.detect?.cmds || []),
        ...(tool.processDetection?.executables || []),
        ...(tool.processDetection?.commandPatterns || []),
      ]);
      expect(candidates.size, `tool "${tool.id}" has no process inference hints`).toBeGreaterThan(
        0,
      );
    }
  });
});
