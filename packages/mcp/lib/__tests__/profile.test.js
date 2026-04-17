import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs before importing scanEnvironment
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';
import { scanEnvironment } from '../profile.js';

describe('scanEnvironment', () => {
  let savedEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    // Save and clear agent framework env vars
    savedEnv = {};
    for (const key of ['CLAUDE_CODE', 'CODEX_HOME', 'WINDSURF_MCP']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // Default: no files exist
    existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    // Restore env vars
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val !== undefined) process.env[key] = val;
      else delete process.env[key];
    }
  });

  describe('agent framework detection', () => {
    it('returns "unknown" when no agent env vars are set', () => {
      const profile = scanEnvironment('/test');
      expect(profile.framework).toBe('unknown');
    });

    it('detects claude-code from CLAUDE_CODE env var', () => {
      process.env.CLAUDE_CODE = '1';
      const profile = scanEnvironment('/test');
      expect(profile.framework).toBe('claude-code');
    });

    it('detects codex from CODEX_HOME env var', () => {
      process.env.CODEX_HOME = '/some/path';
      const profile = scanEnvironment('/test');
      expect(profile.framework).toBe('codex');
    });

    it('detects windsurf from WINDSURF_MCP env var', () => {
      process.env.WINDSURF_MCP = 'true';
      const profile = scanEnvironment('/test');
      expect(profile.framework).toBe('windsurf');
    });

    it('returns first matching framework when multiple env vars are set', () => {
      process.env.CLAUDE_CODE = '1';
      process.env.CODEX_HOME = '/path';
      const profile = scanEnvironment('/test');
      // AGENT_SIGNALS order: claude-code first
      expect(profile.framework).toBe('claude-code');
    });
  });

  describe('package.json language and framework detection', () => {
    function mockPackageJson(pkg) {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('package.json')) return true;
        return false;
      });
      readFileSync.mockReturnValue(JSON.stringify(pkg));
    }

    it('adds javascript when package.json exists', () => {
      mockPackageJson({});
      const profile = scanEnvironment('/test');
      expect(profile.languages).toContain('javascript');
    });

    it('detects react framework', () => {
      mockPackageJson({ dependencies: { react: '^18.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.frameworks).toContain('react');
    });

    it('detects nextjs framework', () => {
      mockPackageJson({ dependencies: { next: '^14.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.frameworks).toContain('nextjs');
    });

    it('detects vue framework', () => {
      mockPackageJson({ dependencies: { vue: '^3.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.frameworks).toContain('vue');
    });

    it('detects express framework', () => {
      mockPackageJson({ dependencies: { express: '^4.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.frameworks).toContain('express');
    });

    it('detects hono framework', () => {
      mockPackageJson({ dependencies: { hono: '^4.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.frameworks).toContain('hono');
    });

    it('detects ink framework', () => {
      mockPackageJson({ dependencies: { ink: '^4.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.frameworks).toContain('ink');
    });

    it('detects angular framework', () => {
      mockPackageJson({ dependencies: { '@angular/core': '^17.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.frameworks).toContain('angular');
    });

    it('detects svelte framework', () => {
      mockPackageJson({ devDependencies: { svelte: '^4.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.frameworks).toContain('svelte');
    });

    it('detects sveltekit framework', () => {
      mockPackageJson({ devDependencies: { '@sveltejs/kit': '^2.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.frameworks).toContain('sveltekit');
    });

    it('detects frameworks from devDependencies', () => {
      mockPackageJson({ devDependencies: { react: '^18.0.0', next: '^14.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.frameworks).toContain('react');
      expect(profile.frameworks).toContain('nextjs');
    });

    it('detects multiple frameworks simultaneously', () => {
      mockPackageJson({
        dependencies: { react: '^18.0.0', express: '^4.0.0' },
        devDependencies: { next: '^14.0.0' },
      });
      const profile = scanEnvironment('/test');
      expect(profile.frameworks).toEqual(expect.arrayContaining(['react', 'nextjs', 'express']));
    });
  });

  describe('tool detection from package.json', () => {
    function mockPackageJson(pkg) {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('package.json')) return true;
        return false;
      });
      readFileSync.mockReturnValue(JSON.stringify(pkg));
    }

    it('detects typescript', () => {
      mockPackageJson({ devDependencies: { typescript: '^5.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.tools).toContain('typescript');
    });

    it('detects eslint', () => {
      mockPackageJson({ devDependencies: { eslint: '^8.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.tools).toContain('eslint');
    });

    it('detects prettier', () => {
      mockPackageJson({ devDependencies: { prettier: '^3.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.tools).toContain('prettier');
    });

    it('detects vitest', () => {
      mockPackageJson({ devDependencies: { vitest: '^1.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.tools).toContain('vitest');
    });

    it('detects jest', () => {
      mockPackageJson({ devDependencies: { jest: '^29.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.tools).toContain('jest');
    });

    it('detects esbuild', () => {
      mockPackageJson({ devDependencies: { esbuild: '^0.19.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.tools).toContain('esbuild');
    });

    it('detects vite', () => {
      mockPackageJson({ devDependencies: { vite: '^5.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.tools).toContain('vite');
    });

    it('detects prisma', () => {
      mockPackageJson({ dependencies: { prisma: '^5.0.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.tools).toContain('prisma');
    });

    it('detects drizzle', () => {
      mockPackageJson({ dependencies: { 'drizzle-orm': '^0.28.0' } });
      const profile = scanEnvironment('/test');
      expect(profile.tools).toContain('drizzle');
    });
  });

  describe('config file language detection', () => {
    it('detects TypeScript from tsconfig.json', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('tsconfig.json')) return true;
        return false;
      });
      const profile = scanEnvironment('/test');
      expect(profile.languages).toContain('typescript');
    });

    it('detects Python from pyproject.toml', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('pyproject.toml')) return true;
        return false;
      });
      const profile = scanEnvironment('/test');
      expect(profile.languages).toContain('python');
    });

    it('detects Go from go.mod', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('go.mod')) return true;
        return false;
      });
      const profile = scanEnvironment('/test');
      expect(profile.languages).toContain('go');
    });

    it('detects Rust from Cargo.toml', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('Cargo.toml')) return true;
        return false;
      });
      const profile = scanEnvironment('/test');
      expect(profile.languages).toContain('rust');
    });
  });

  describe('platform detection', () => {
    it('detects Cloudflare from wrangler.toml', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('wrangler.toml')) return true;
        return false;
      });
      const profile = scanEnvironment('/test');
      expect(profile.platforms).toContain('cloudflare');
    });

    it('detects Cloudflare from wrangler.jsonc', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('wrangler.jsonc')) return true;
        return false;
      });
      const profile = scanEnvironment('/test');
      expect(profile.platforms).toContain('cloudflare');
    });

    it('detects Vercel from vercel.json', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('vercel.json')) return true;
        return false;
      });
      const profile = scanEnvironment('/test');
      expect(profile.platforms).toContain('vercel');
    });

    it('detects Fly from fly.toml', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('fly.toml')) return true;
        return false;
      });
      const profile = scanEnvironment('/test');
      expect(profile.platforms).toContain('fly');
    });

    it('detects Docker from Dockerfile', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('Dockerfile')) return true;
        return false;
      });
      const profile = scanEnvironment('/test');
      expect(profile.platforms).toContain('docker');
    });
  });

  describe('edge cases', () => {
    it('handles missing package.json gracefully', () => {
      existsSync.mockReturnValue(false);
      const profile = scanEnvironment('/test');
      expect(profile.languages).toEqual([]);
      expect(profile.frameworks).toEqual([]);
      expect(profile.tools).toEqual([]);
    });

    it('handles malformed package.json gracefully', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('package.json')) return true;
        return false;
      });
      readFileSync.mockReturnValue('not valid json {{{');
      const profile = scanEnvironment('/test');
      // Should not crash, just skip package.json parsing
      expect(profile.languages).toEqual([]);
      expect(profile.frameworks).toEqual([]);
    });

    it('handles package.json with no dependencies', () => {
      existsSync.mockImplementation((path) => {
        if (path.endsWith('package.json')) return true;
        return false;
      });
      readFileSync.mockReturnValue(JSON.stringify({ name: 'test' }));
      const profile = scanEnvironment('/test');
      expect(profile.languages).toEqual(['javascript']);
      expect(profile.frameworks).toEqual([]);
      expect(profile.tools).toEqual([]);
    });

    it('deduplicates languages when detected from multiple sources', () => {
      existsSync.mockImplementation((path) => {
        // Both package.json and tsconfig.json exist
        if (path.endsWith('package.json')) return true;
        if (path.endsWith('tsconfig.json')) return true;
        return false;
      });
      readFileSync.mockReturnValue(
        JSON.stringify({
          devDependencies: { typescript: '^5.0.0' },
        }),
      );
      const profile = scanEnvironment('/test');
      // javascript from package.json + typescript from tsconfig.json
      expect(profile.languages).toEqual(['javascript', 'typescript']);
      // No duplicates
      const langSet = new Set(profile.languages);
      expect(langSet.size).toBe(profile.languages.length);
    });

    it('returns correct shape even with completely empty environment', () => {
      existsSync.mockReturnValue(false);
      const profile = scanEnvironment('/test');
      expect(profile).toEqual({
        framework: 'unknown',
        languages: [],
        frameworks: [],
        tools: [],
        platforms: [],
      });
    });

    it('uses provided cwd parameter', () => {
      existsSync.mockReturnValue(false);
      scanEnvironment('/custom/path');
      // Check that existsSync was called with paths under /custom/path
      const calls = existsSync.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.startsWith('/custom/path/'))).toBe(true);
    });
  });
});
