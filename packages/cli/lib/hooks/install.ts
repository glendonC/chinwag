// Install the chinwag pre-commit chain-runner + guard plugin into a git
// repository. Idempotent: re-running upgrades in place. Non-destructive:
// any pre-existing `pre-commit` hook we didn't write is preserved as
// `pre-commit.orig` and re-run first by the chain-runner, so users who
// already had a custom hook keep their workflow.

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { resolveGitHookLocation, isRegularFile } from './paths.js';
import { CHINWAG_HOOK_MARKER, GUARD_SCRIPT, RUNNER_SCRIPT } from './templates.js';

export type HookInstallResult =
  | { status: 'installed'; hooksDir: string; preservedOriginal: boolean; customHooksPath: boolean }
  | { status: 'upgraded'; hooksDir: string; customHooksPath: boolean }
  | { status: 'skipped-not-a-repo' }
  | { status: 'error'; error: string };

/**
 * Install (or upgrade) chinwag's pre-commit chain-runner + guard plugin
 * for the repo rooted at `cwd`. Returns a structured status so the init
 * command can print an honest line ("installed" vs "upgraded" vs
 * "skipped" vs "error").
 */
export function installChinwagHooks(cwd: string): HookInstallResult {
  const location = resolveGitHookLocation(cwd);
  if (!location) return { status: 'skipped-not-a-repo' };

  const { hooksDir, customHooksPath } = location;
  const preCommit = join(hooksDir, 'pre-commit');
  const pluginsDir = join(hooksDir, 'pre-commit.d');
  const guardPlugin = join(pluginsDir, '50-chinwag-guard.js');

  try {
    mkdirSync(pluginsDir, { recursive: true });
  } catch (err) {
    return { status: 'error', error: `could not create ${pluginsDir}: ${describe(err)}` };
  }

  // Detect whether a pre-commit is already in place and who owns it.
  let preservedOriginal = false;
  let upgradingOurs = false;
  if (isRegularFile(preCommit)) {
    const existing = safeReadHead(preCommit);
    if (existing.includes(CHINWAG_HOOK_MARKER)) {
      // Re-running `chinwag init`. Overwrite without touching .orig — the
      // original was already moved aside on the first install.
      upgradingOurs = true;
    } else {
      // User's own hook (or some other tool's). Move aside; chain-runner
      // will invoke it before our plugin on every commit.
      try {
        renameSync(preCommit, `${preCommit}.orig`);
        preservedOriginal = true;
      } catch (err) {
        return {
          status: 'error',
          error: `could not preserve existing pre-commit: ${describe(err)}`,
        };
      }
    }
  }

  try {
    writeFileSync(preCommit, RUNNER_SCRIPT, { encoding: 'utf-8' });
    writeFileSync(guardPlugin, GUARD_SCRIPT, { encoding: 'utf-8' });
  } catch (err) {
    return { status: 'error', error: `write failed: ${describe(err)}` };
  }

  // POSIX needs executable bits so git will run the hook. Windows git
  // (git-for-windows) delegates to its bundled sh which honours the
  // shebang regardless of chmod, so the chmod is a no-op but harmless.
  if (platform() !== 'win32') {
    try {
      chmodSync(preCommit, 0o755);
      chmodSync(guardPlugin, 0o755);
    } catch (err) {
      return { status: 'error', error: `chmod failed: ${describe(err)}` };
    }
  }

  if (upgradingOurs) {
    return { status: 'upgraded', hooksDir, customHooksPath };
  }
  return { status: 'installed', hooksDir, preservedOriginal, customHooksPath };
}

/**
 * Read the first few lines of a file for marker detection. Fails open
 * to empty string so a partial/locked file during install doesn't crash
 * the installer.
 */
function safeReadHead(path: string): string {
  try {
    const full = readFileSync(path, 'utf-8');
    return full.slice(0, 512);
  } catch {
    return '';
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
