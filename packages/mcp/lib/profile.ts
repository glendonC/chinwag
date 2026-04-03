import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Agent environment detection signals.
// Only tools that set identifiable env vars when spawning MCP servers
// are listed here. Most tools (Cursor, VS Code, JetBrains, etc.) don't
// set unique env vars, so detectAgentFramework() returns 'unknown' for them.
// This is acceptable -- the framework field is informational, not functional.
// Add entries here as tools document their env vars -- no logic changes needed.
interface AgentSignal {
  id: string;
  env: string;
}

const AGENT_SIGNALS: AgentSignal[] = [
  { id: 'claude-code', env: 'CLAUDE_CODE' },
  { id: 'codex', env: 'CODEX_HOME' },
  { id: 'windsurf', env: 'WINDSURF_MCP' },
];

export interface EnvironmentProfile {
  framework: string;
  languages: string[];
  frameworks: string[];
  tools: string[];
  platforms: string[];
}

export function scanEnvironment(cwd: string = process.cwd()): EnvironmentProfile {
  const profile: EnvironmentProfile = {
    framework: detectAgentFramework(),
    languages: [],
    frameworks: [],
    tools: [],
    platforms: [],
  };

  // package.json
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps: Record<string, string> = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      profile.languages.push('javascript');

      const frameworkMap: Record<string, string> = {
        react: 'react',
        next: 'nextjs',
        vue: 'vue',
        nuxt: 'nuxt',
        svelte: 'svelte',
        '@sveltejs/kit': 'sveltekit',
        express: 'express',
        fastify: 'fastify',
        hono: 'hono',
        ink: 'ink',
        '@angular/core': 'angular',
        astro: 'astro',
      };

      for (const [dep, tag] of Object.entries(frameworkMap)) {
        if (allDeps[dep]) profile.frameworks.push(tag);
      }

      const toolMap: Record<string, string> = {
        esbuild: 'esbuild',
        vite: 'vite',
        webpack: 'webpack',
        typescript: 'typescript',
        eslint: 'eslint',
        prettier: 'prettier',
        jest: 'jest',
        vitest: 'vitest',
        prisma: 'prisma',
        'drizzle-orm': 'drizzle',
      };

      for (const [dep, tag] of Object.entries(toolMap)) {
        if (allDeps[dep]) profile.tools.push(tag);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'malformed package.json';
      console.error('[chinwag]', message);
    }
  }

  // TypeScript
  if (existsSync(join(cwd, 'tsconfig.json'))) {
    profile.languages.push('typescript');
  }

  // Python
  if (existsSync(join(cwd, 'pyproject.toml'))) {
    profile.languages.push('python');
  }

  // Go
  if (existsSync(join(cwd, 'go.mod'))) {
    profile.languages.push('go');
  }

  // Rust
  if (existsSync(join(cwd, 'Cargo.toml'))) {
    profile.languages.push('rust');
  }

  // Platforms
  if (existsSync(join(cwd, 'wrangler.toml')) || existsSync(join(cwd, 'wrangler.jsonc'))) {
    profile.platforms.push('cloudflare');
  }
  if (existsSync(join(cwd, 'vercel.json'))) {
    profile.platforms.push('vercel');
  }
  if (existsSync(join(cwd, 'fly.toml'))) {
    profile.platforms.push('fly');
  }
  if (existsSync(join(cwd, 'Dockerfile'))) {
    profile.platforms.push('docker');
  }

  // Deduplicate
  profile.languages = [...new Set(profile.languages)];
  profile.frameworks = [...new Set(profile.frameworks)];
  profile.tools = [...new Set(profile.tools)];
  profile.platforms = [...new Set(profile.platforms)];

  return profile;
}

function detectAgentFramework(): string {
  for (const { id, env } of AGENT_SIGNALS) {
    if (process.env[env]) return id;
  }
  return 'unknown';
}
