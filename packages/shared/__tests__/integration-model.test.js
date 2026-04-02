import { describe, it, expect } from 'vitest';
import {
  HOST_INTEGRATIONS,
  AGENT_SURFACES,
  getHostIntegrationById,
  buildHostIntegrationCatalogEntries,
  buildAgentSurfaceCatalogEntries,
} from '../integration-model.js';

describe('integration-model', () => {
  describe('HOST_INTEGRATIONS', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(HOST_INTEGRATIONS)).toBe(true);
      expect(HOST_INTEGRATIONS.length).toBeGreaterThan(0);
    });

    it('every integration has required fields', () => {
      for (const host of HOST_INTEGRATIONS) {
        expect(host.id).toEqual(expect.any(String));
        expect(host.name).toEqual(expect.any(String));
        expect(host.kind).toBe('host');
        expect(host.tier).toEqual(expect.any(String));
        expect(Array.isArray(host.capabilities)).toBe(true);
        expect(host.displayGroup).toEqual(expect.any(String));
        expect(host.runtime).toBeDefined();
        expect(host.runtime.hostId).toBe(host.id);
      }
    });

    it('claude-code is managed tier with full capabilities', () => {
      const cc = HOST_INTEGRATIONS.find(h => h.id === 'claude-code');
      expect(cc.tier).toBe('managed');
      expect(cc.capabilities).toContain('mcp');
      expect(cc.capabilities).toContain('hooks');
      expect(cc.capabilities).toContain('channel');
      expect(cc.capabilities).toContain('managed-process');
    });

    it('cursor is connected tier with mcp capability', () => {
      const cursor = HOST_INTEGRATIONS.find(h => h.id === 'cursor');
      expect(cursor.tier).toBe('connected');
      expect(cursor.capabilities).toEqual(['mcp']);
    });

    it('all IDs are unique', () => {
      const ids = HOST_INTEGRATIONS.map(h => h.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every integration has mcp capability', () => {
      for (const host of HOST_INTEGRATIONS) {
        expect(host.capabilities).toContain('mcp');
      }
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
        expect(Array.isArray(surface.capabilities)).toBe(true);
        expect(surface.catalog).toBeDefined();
      }
    });

    it('includes cline, continue, and roo-code', () => {
      const ids = AGENT_SURFACES.map(s => s.id);
      expect(ids).toContain('cline');
      expect(ids).toContain('continue');
      expect(ids).toContain('roo-code');
    });

    it('cline supports vscode and cursor', () => {
      const cline = AGENT_SURFACES.find(s => s.id === 'cline');
      expect(cline.supportedHosts).toContain('vscode');
      expect(cline.supportedHosts).toContain('cursor');
    });
  });

  describe('getHostIntegrationById', () => {
    it('returns matching integration', () => {
      const cc = getHostIntegrationById('claude-code');
      expect(cc).toBeDefined();
      expect(cc.id).toBe('claude-code');
    });

    it('returns null for unknown ID', () => {
      expect(getHostIntegrationById('nonexistent')).toBeNull();
    });

    it('returns null for null', () => {
      expect(getHostIntegrationById(null)).toBeNull();
    });
  });

  describe('buildHostIntegrationCatalogEntries', () => {
    it('returns array of catalog entries with id and name', () => {
      const entries = buildHostIntegrationCatalogEntries();
      expect(entries.length).toBe(HOST_INTEGRATIONS.length);
      for (const entry of entries) {
        expect(entry.id).toEqual(expect.any(String));
        expect(entry.name).toEqual(expect.any(String));
        expect(entry.description).toEqual(expect.any(String));
      }
    });
  });

  describe('buildAgentSurfaceCatalogEntries', () => {
    it('returns array of catalog entries with supportedHosts', () => {
      const entries = buildAgentSurfaceCatalogEntries();
      expect(entries.length).toBe(AGENT_SURFACES.length);
      for (const entry of entries) {
        expect(entry.id).toEqual(expect.any(String));
        expect(entry.name).toEqual(expect.any(String));
        expect(Array.isArray(entry.supportedHosts)).toBe(true);
      }
    });

    it('returns copies of supportedHosts arrays (not references)', () => {
      const entries = buildAgentSurfaceCatalogEntries();
      const clineEntry = entries.find(e => e.id === 'cline');
      const clineSurface = AGENT_SURFACES.find(s => s.id === 'cline');
      expect(clineEntry.supportedHosts).not.toBe(clineSurface.supportedHosts);
      expect(clineEntry.supportedHosts).toEqual(clineSurface.supportedHosts);
    });
  });
});
