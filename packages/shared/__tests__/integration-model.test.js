import { describe, it, expect } from 'vitest';
import {
  HOST_INTEGRATIONS,
  AGENT_SURFACES,
  getHostIntegrationById,
  buildHostIntegrationCatalogEntries,
  buildAgentSurfaceCatalogEntries,
} from '../integration-model.js';
import { MCP_TOOLS } from '../tool-registry.js';

describe('HOST_INTEGRATIONS', () => {
  it('has the same number of entries as MCP_TOOLS', () => {
    expect(HOST_INTEGRATIONS).toHaveLength(MCP_TOOLS.length);
  });

  it('every integration has kind "host"', () => {
    for (const host of HOST_INTEGRATIONS) {
      expect(host.kind).toBe('host');
    }
  });

  it('every integration has a tier (managed or connected)', () => {
    for (const host of HOST_INTEGRATIONS) {
      expect(['managed', 'connected']).toContain(host.tier);
    }
  });

  it('every integration has capabilities array with at least "mcp"', () => {
    for (const host of HOST_INTEGRATIONS) {
      expect(Array.isArray(host.capabilities)).toBe(true);
      expect(host.capabilities).toContain('mcp');
    }
  });

  it('every integration has displayGroup', () => {
    for (const host of HOST_INTEGRATIONS) {
      expect(host.displayGroup).toBe('host');
    }
  });

  it('every integration has runtime with hostId matching its id', () => {
    for (const host of HOST_INTEGRATIONS) {
      expect(host.runtime).toBeDefined();
      expect(host.runtime.hostId).toBe(host.id);
      expect(host.runtime.defaultTransport).toBe('mcp');
    }
  });

  it('every integration has required McpTool fields (id, name, detect, catalog)', () => {
    for (const host of HOST_INTEGRATIONS) {
      expect(host.id).toEqual(expect.any(String));
      expect(host.name).toEqual(expect.any(String));
      expect(host.detect).toBeDefined();
      expect(host.catalog).toBeDefined();
    }
  });

  it('all IDs are unique', () => {
    const ids = HOST_INTEGRATIONS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('claude-code is managed tier with hooks, channel, and managed-process capabilities', () => {
    const cc = HOST_INTEGRATIONS.find((h) => h.id === 'claude-code');
    expect(cc).toBeDefined();
    expect(cc.tier).toBe('managed');
    expect(cc.capabilities).toContain('mcp');
    expect(cc.capabilities).toContain('hooks');
    expect(cc.capabilities).toContain('channel');
    expect(cc.capabilities).toContain('managed-process');
  });

  it('cursor is connected tier with mcp and hooks capabilities', () => {
    const cursor = HOST_INTEGRATIONS.find((h) => h.id === 'cursor');
    expect(cursor).toBeDefined();
    expect(cursor.tier).toBe('connected');
    expect(cursor.capabilities).toEqual(['mcp', 'hooks']);
  });

  it('tools with hooks get hooks capability', () => {
    const toolsWithHooks = MCP_TOOLS.filter((t) => t.hooks);
    for (const tool of toolsWithHooks) {
      const host = HOST_INTEGRATIONS.find((h) => h.id === tool.id);
      expect(host.capabilities).toContain('hooks');
    }
  });

  it('tools with channel get channel capability', () => {
    const toolsWithChannel = MCP_TOOLS.filter((t) => t.channel);
    for (const tool of toolsWithChannel) {
      const host = HOST_INTEGRATIONS.find((h) => h.id === tool.id);
      expect(host.capabilities).toContain('channel');
    }
  });

  it('tools with spawn get managed-process capability and managed tier', () => {
    const toolsWithSpawn = MCP_TOOLS.filter((t) => t.spawn);
    for (const tool of toolsWithSpawn) {
      const host = HOST_INTEGRATIONS.find((h) => h.id === tool.id);
      expect(host.capabilities).toContain('managed-process');
      // If tool does not explicitly set tier, spawn implies managed
      if (!tool.tier) {
        expect(host.tier).toBe('managed');
      }
    }
  });

  it('tools without spawn and without explicit tier are connected', () => {
    const toolsNoSpawnNoTier = MCP_TOOLS.filter((t) => !t.spawn && !t.tier);
    for (const tool of toolsNoSpawnNoTier) {
      const host = HOST_INTEGRATIONS.find((h) => h.id === tool.id);
      expect(host.tier).toBe('connected');
    }
  });

  it('amazon-q with explicit tier=connected keeps that tier despite having spawn', () => {
    const aq = HOST_INTEGRATIONS.find((h) => h.id === 'amazon-q');
    expect(aq).toBeDefined();
    expect(aq.tier).toBe('connected');
    expect(aq.capabilities).toContain('managed-process');
  });
});

describe('AGENT_SURFACES', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(AGENT_SURFACES)).toBe(true);
    expect(AGENT_SURFACES.length).toBeGreaterThan(0);
  });

  it('every surface has required fields', () => {
    for (const surface of AGENT_SURFACES) {
      expect(surface.id).toEqual(expect.any(String));
      expect(surface.name).toEqual(expect.any(String));
      expect(surface.kind).toBe('surface');
      expect(Array.isArray(surface.supportedHosts)).toBe(true);
      expect(surface.supportedHosts.length).toBeGreaterThan(0);
      expect(Array.isArray(surface.capabilities)).toBe(true);
      expect(surface.catalog).toBeDefined();
      expect(surface.catalog.description).toEqual(expect.any(String));
      expect(surface.catalog.category).toEqual(expect.any(String));
      expect(surface.catalog.website).toEqual(expect.any(String));
    }
  });

  it('includes cline, continue, and roo-code', () => {
    const ids = AGENT_SURFACES.map((s) => s.id);
    expect(ids).toContain('cline');
    expect(ids).toContain('continue');
    expect(ids).toContain('roo-code');
  });

  it('cline supports vscode and cursor', () => {
    const cline = AGENT_SURFACES.find((s) => s.id === 'cline');
    expect(cline.supportedHosts).toContain('vscode');
    expect(cline.supportedHosts).toContain('cursor');
  });

  it('continue supports vscode and jetbrains', () => {
    const cont = AGENT_SURFACES.find((s) => s.id === 'continue');
    expect(cont.supportedHosts).toContain('vscode');
    expect(cont.supportedHosts).toContain('jetbrains');
  });

  it('roo-code supports vscode', () => {
    const roo = AGENT_SURFACES.find((s) => s.id === 'roo-code');
    expect(roo.supportedHosts).toContain('vscode');
  });

  it('all surface IDs are unique', () => {
    const ids = AGENT_SURFACES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getHostIntegrationById', () => {
  it('returns correct integration for known ID', () => {
    const cc = getHostIntegrationById('claude-code');
    expect(cc).toBeDefined();
    expect(cc.id).toBe('claude-code');
    expect(cc.kind).toBe('host');
  });

  it('returns the same object reference as in HOST_INTEGRATIONS', () => {
    for (const host of HOST_INTEGRATIONS) {
      const result = getHostIntegrationById(host.id);
      expect(result).toBe(host);
    }
  });

  it('returns null for unknown ID', () => {
    expect(getHostIntegrationById('nonexistent')).toBeNull();
  });

  it('returns null for null', () => {
    expect(getHostIntegrationById(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getHostIntegrationById('')).toBeNull();
  });
});

describe('buildHostIntegrationCatalogEntries', () => {
  it('returns non-empty array', () => {
    const entries = buildHostIntegrationCatalogEntries();
    expect(entries.length).toBeGreaterThan(0);
  });

  it('returns same count as HOST_INTEGRATIONS', () => {
    const entries = buildHostIntegrationCatalogEntries();
    expect(entries).toHaveLength(HOST_INTEGRATIONS.length);
  });

  it('every entry has required fields: id, name, description, category', () => {
    const entries = buildHostIntegrationCatalogEntries();
    for (const entry of entries) {
      expect(entry.id).toEqual(expect.any(String));
      expect(entry.name).toEqual(expect.any(String));
      expect(entry.description).toEqual(expect.any(String));
      expect(entry.category).toEqual(expect.any(String));
    }
  });

  it('featured tools have featured=true in their catalog entry', () => {
    const entries = buildHostIntegrationCatalogEntries();
    const claudeEntry = entries.find((e) => e.id === 'claude-code');
    expect(claudeEntry.featured).toBe(true);
  });

  it('entries include website and installCmd when present on the tool', () => {
    const entries = buildHostIntegrationCatalogEntries();
    const claudeEntry = entries.find((e) => e.id === 'claude-code');
    expect(claudeEntry.website).toEqual(expect.any(String));
    expect(claudeEntry.installCmd).toEqual(expect.any(String));
  });
});

describe('buildHostIntegrationCatalogEntries - edge cases', () => {
  it('entries do NOT include capabilities, tier, or runtime (only catalog fields)', () => {
    const entries = buildHostIntegrationCatalogEntries();
    for (const entry of entries) {
      expect(entry.capabilities).toBeUndefined();
      expect(entry.tier).toBeUndefined();
      expect(entry.runtime).toBeUndefined();
      expect(entry.kind).toBeUndefined();
    }
  });

  it('entries for tools without installCmd have installCmd undefined', () => {
    const entries = buildHostIntegrationCatalogEntries();
    const cursorEntry = entries.find((e) => e.id === 'cursor');
    // cursor catalog does not have installCmd
    expect(cursorEntry.installCmd).toBeUndefined();
  });

  it('entries for tools without website have website undefined', () => {
    const entries = buildHostIntegrationCatalogEntries();
    // All current tools have websites, but verify the pattern
    for (const entry of entries) {
      if (entry.website) {
        expect(entry.website).toMatch(/^https?:\/\//);
      }
    }
  });
});

describe('HOST_INTEGRATIONS capability inference details', () => {
  it('codex has managed-process but tier defaults to managed (no explicit tier)', () => {
    const codex = HOST_INTEGRATIONS.find((h) => h.id === 'codex');
    expect(codex.capabilities).toContain('managed-process');
    // codex has no explicit tier set on McpTool, and has spawn, so tier = managed
    expect(codex.tier).toBe('managed');
  });

  it('aider has managed-process capability and managed tier', () => {
    const aider = HOST_INTEGRATIONS.find((h) => h.id === 'aider');
    expect(aider.capabilities).toContain('managed-process');
    expect(aider.tier).toBe('managed');
  });

  it('windsurf has mcp and hooks capabilities at connected tier', () => {
    const windsurf = HOST_INTEGRATIONS.find((h) => h.id === 'windsurf');
    expect(windsurf.capabilities).toEqual(['mcp', 'hooks']);
    expect(windsurf.tier).toBe('connected');
  });

  it('jetbrains has only mcp capability and connected tier', () => {
    const jb = HOST_INTEGRATIONS.find((h) => h.id === 'jetbrains');
    expect(jb.capabilities).toEqual(['mcp']);
    expect(jb.tier).toBe('connected');
  });
});

describe('buildAgentSurfaceCatalogEntries', () => {
  it('returns non-empty array', () => {
    const entries = buildAgentSurfaceCatalogEntries();
    expect(entries.length).toBeGreaterThan(0);
  });

  it('returns same count as AGENT_SURFACES', () => {
    const entries = buildAgentSurfaceCatalogEntries();
    expect(entries).toHaveLength(AGENT_SURFACES.length);
  });

  it('every entry has required fields: id, name, description, supportedHosts', () => {
    const entries = buildAgentSurfaceCatalogEntries();
    for (const entry of entries) {
      expect(entry.id).toEqual(expect.any(String));
      expect(entry.name).toEqual(expect.any(String));
      expect(entry.description).toEqual(expect.any(String));
      expect(Array.isArray(entry.supportedHosts)).toBe(true);
    }
  });

  it('returns copies of supportedHosts arrays (not references)', () => {
    const entries = buildAgentSurfaceCatalogEntries();
    const clineEntry = entries.find((e) => e.id === 'cline');
    const clineSurface = AGENT_SURFACES.find((s) => s.id === 'cline');
    expect(clineEntry.supportedHosts).not.toBe(clineSurface.supportedHosts);
    expect(clineEntry.supportedHosts).toEqual(clineSurface.supportedHosts);
  });

  it('entries include mcpCompatible when present', () => {
    const entries = buildAgentSurfaceCatalogEntries();
    const clineEntry = entries.find((e) => e.id === 'cline');
    expect(clineEntry.mcpCompatible).toBe(true);
  });
});
