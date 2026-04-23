import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  configureHostIntegration,
  scanHostIntegrations,
} from '@chinmeister/shared/integration-doctor.js';
import {
  AGENT_SURFACES,
  HOST_INTEGRATIONS,
  buildAgentSurfaceCatalogEntries,
} from '@chinmeister/shared/integration-model.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinmeister-integration-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('shared integration model', () => {
  it('keeps every surface mapped to known hosts', () => {
    const hostIds = new Set(HOST_INTEGRATIONS.map((host) => host.id));
    for (const surface of AGENT_SURFACES) {
      for (const hostId of surface.supportedHosts) {
        expect(hostIds.has(hostId)).toBe(true);
      }
    }
  });

  it('builds discovery entries for every known surface', () => {
    const entries = buildAgentSurfaceCatalogEntries();
    expect(entries.map((entry) => entry.id).sort()).toEqual(
      AGENT_SURFACES.map((surface) => surface.id).sort(),
    );
  });
});

describe('shared integration doctor', () => {
  it('marks detected hosts as needing setup before config is written', () => {
    fs.mkdirSync(path.join(tmpDir, '.cursor'));

    const cursor = scanHostIntegrations(tmpDir).find((item) => item.id === 'cursor');
    expect(cursor.detected).toBe(true);
    expect(cursor.status).toBe('needs_setup');
    expect(cursor.issues).toContain('Missing or outdated config at .cursor/mcp.json');
  });

  it('writes a host integration config that scans as ready', () => {
    fs.mkdirSync(path.join(tmpDir, '.cursor'));

    const result = configureHostIntegration(tmpDir, 'cursor');
    expect(result).toMatchObject({ ok: true, name: 'Cursor' });

    const cursor = scanHostIntegrations(tmpDir).find((item) => item.id === 'cursor');
    expect(cursor.status).toBe('ready');
    expect(cursor.mcpConfigured).toBe(true);
  });

  it('writes Claude Code hooks through the shared doctor', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'));

    const result = configureHostIntegration(tmpDir, 'claude-code');
    expect(result).toMatchObject({ ok: true, name: 'Claude Code' });

    const content = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf-8'),
    );
    expect(content.hooks.SessionStart[0].hooks[0].command).toBe(
      'npx -y chinmeister hook session-start',
    );
  });
});
