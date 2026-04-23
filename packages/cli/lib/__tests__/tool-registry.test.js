import { describe, expect, it } from 'vitest';
import { MCP_TOOLS } from '@chinmeister/shared/tool-registry.js';

describe('shared MCP tool registry', () => {
  it('uses unique ids for every configurable tool', () => {
    const ids = MCP_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes discovery metadata for every tool, and configurability invariants for MCP-compatible ones', () => {
    for (const tool of MCP_TOOLS) {
      // Every registered tool needs basic catalog metadata — this is what the
      // install/catalog UI renders regardless of MCP compatibility.
      expect(tool.catalog?.name ?? tool.name).toBeTruthy();
      expect(tool.catalog?.description).toBeTruthy();
      expect(tool.catalog?.website).toBeTruthy();
      // Non-MCP tools (e.g. Copilot) legitimately live in the registry for
      // clientInfo attribution without supporting MCP configuration. The
      // invariant we actually want: claiming `mcpCompatible` implies being
      // `mcpConfigurable` (can't say "works with MCP" if `chinmeister add` has
      // nothing to write).
      if (tool.catalog?.mcpCompatible) {
        expect(tool.catalog?.mcpConfigurable, `${tool.id}`).toBe(true);
      }
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
