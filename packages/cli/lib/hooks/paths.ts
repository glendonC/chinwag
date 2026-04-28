// Resolve the git hooks directory for a repo. Respects `core.hooksPath` so
// repos already using husky, lefthook, or a monorepo-level hooks dir keep
// working after `chinmeister init` - we install into whatever path git actually
// consults, not a hard-coded `.git/hooks/`.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export interface GitHookLocation {
  /** Absolute path to the repo root (git toplevel). */
  repoRoot: string;
  /** Absolute path to the hooks directory (may not exist yet). */
  hooksDir: string;
  /**
   * Whether `core.hooksPath` was set to a non-default value. Used by the
   * installer to phrase the status line honestly ("installed to
   * .git/hooks" vs "installed to custom hooksPath").
   */
  customHooksPath: boolean;
}

/**
 * Look up the git hooks location for `cwd`. Returns null if `cwd` isn't
 * inside a git repo. Never throws - any error becomes null so the init
 * flow can degrade gracefully on non-git directories.
 */
export function resolveGitHookLocation(cwd: string): GitHookLocation | null {
  let repoRoot: string;
  try {
    repoRoot = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
  if (!repoRoot || !existsSync(repoRoot)) return null;

  // `core.hooksPath` is git's escape hatch for tools like husky that want
  // to own the hooks directory. When set, it overrides the default fully.
  let hooksPath = '';
  try {
    hooksPath = execFileSync('git', ['-C', repoRoot, 'config', '--get', 'core.hooksPath'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // `git config --get` exits 1 when the key is unset. That's expected,
    // not an error. Fall through to the default.
    hooksPath = '';
  }

  const customHooksPath = hooksPath.length > 0;
  const hooksDir = customHooksPath
    ? isAbsolute(hooksPath)
      ? hooksPath
      : resolve(repoRoot, hooksPath)
    : join(repoRoot, '.git', 'hooks');

  return { repoRoot, hooksDir, customHooksPath };
}

/** True if `path` exists and is a regular file (not a dir or broken symlink). */
export function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
