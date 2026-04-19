import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { installChinwagHooks } from '../install.js';
import { resolveGitHookLocation } from '../paths.js';
import { CHINWAG_HOOK_MARKER, RUNNER_SCRIPT, GUARD_SCRIPT } from '../templates.js';

/** Unique tmp dir per test. Isolation over cleanup efficiency. */
function tmpRepo() {
  return join(
    tmpdir(),
    `chinwag-hooks-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

function initGitRepo(dir) {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  // git doesn't let commits happen without user.email/name; set them so
  // any downstream commit-based test doesn't need its own fixture setup.
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
}

describe('resolveGitHookLocation', () => {
  let dir;
  beforeEach(() => {
    dir = tmpRepo();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null outside a git repo', () => {
    mkdirSync(dir, { recursive: true });
    expect(resolveGitHookLocation(dir)).toBeNull();
  });

  it('returns .git/hooks by default', () => {
    initGitRepo(dir);
    const loc = resolveGitHookLocation(dir);
    expect(loc).not.toBeNull();
    expect(loc.hooksDir).toBe(join(loc.repoRoot, '.git', 'hooks'));
    expect(loc.customHooksPath).toBe(false);
  });

  it('resolves core.hooksPath when set (relative path)', () => {
    initGitRepo(dir);
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });
    const loc = resolveGitHookLocation(dir);
    expect(loc.customHooksPath).toBe(true);
    expect(loc.hooksDir).toBe(join(loc.repoRoot, '.githooks'));
  });
});

describe('installChinwagHooks', () => {
  let dir;
  beforeEach(() => {
    dir = tmpRepo();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('skips outside a git repo', () => {
    mkdirSync(dir, { recursive: true });
    const res = installChinwagHooks(dir);
    expect(res.status).toBe('skipped-not-a-repo');
  });

  it('installs a fresh pre-commit + guard plugin in a clean repo', () => {
    initGitRepo(dir);
    const res = installChinwagHooks(dir);
    expect(res.status).toBe('installed');
    expect(res.preservedOriginal).toBe(false);

    const hooksDir = join(dir, '.git', 'hooks');
    const preCommit = join(hooksDir, 'pre-commit');
    const guard = join(hooksDir, 'pre-commit.d', '50-chinwag-guard.js');

    expect(readFileSync(preCommit, 'utf-8')).toContain(CHINWAG_HOOK_MARKER);
    expect(readFileSync(guard, 'utf-8')).toContain(CHINWAG_HOOK_MARKER);

    if (platform() !== 'win32') {
      // 0o100755 = regular file + rwxr-xr-x. Check the executable bit.
      expect(statSync(preCommit).mode & 0o111).not.toBe(0);
      expect(statSync(guard).mode & 0o111).not.toBe(0);
    }
  });

  it('preserves a user-authored pre-commit as .orig on first install', () => {
    initGitRepo(dir);
    const preCommit = join(dir, '.git', 'hooks', 'pre-commit');
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
    writeFileSync(preCommit, '#!/bin/sh\necho user hook\n', { mode: 0o755 });

    const res = installChinwagHooks(dir);
    expect(res.status).toBe('installed');
    expect(res.preservedOriginal).toBe(true);
    expect(existsSync(`${preCommit}.orig`)).toBe(true);
    expect(readFileSync(`${preCommit}.orig`, 'utf-8')).toContain('echo user hook');
    expect(readFileSync(preCommit, 'utf-8')).toContain(CHINWAG_HOOK_MARKER);
  });

  it('re-running reports upgraded and does NOT create a second .orig', () => {
    initGitRepo(dir);
    // First install — clean
    installChinwagHooks(dir);
    // Second install — should upgrade in place
    const res = installChinwagHooks(dir);
    expect(res.status).toBe('upgraded');
    expect(existsSync(join(dir, '.git', 'hooks', 'pre-commit.orig'))).toBe(false);
  });

  it('honours core.hooksPath and installs into the custom directory', () => {
    initGitRepo(dir);
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });
    const res = installChinwagHooks(dir);
    expect(res.status).toBe('installed');
    expect(res.customHooksPath).toBe(true);
    expect(existsSync(join(dir, '.githooks', 'pre-commit'))).toBe(true);
    expect(existsSync(join(dir, '.githooks', 'pre-commit.d', '50-chinwag-guard.js'))).toBe(true);
  });
});

describe('chain-runner behaviour (executes the installed script)', () => {
  let dir;
  beforeEach(() => {
    dir = tmpRepo();
    initGitRepo(dir);
    installChinwagHooks(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('runs pre-commit.orig before plugins and passes through its exit code', () => {
    const hooksDir = join(dir, '.git', 'hooks');
    const orig = join(hooksDir, 'pre-commit.orig');
    writeFileSync(orig, `#!/usr/bin/env node\nprocess.exit(7);\n`, { mode: 0o755 });

    // Run the chain-runner directly via node so the test works regardless
    // of how git would spawn it.
    const result = spawnSync(process.execPath, [join(hooksDir, 'pre-commit')], {
      encoding: 'utf-8',
    });
    expect(result.status).toBe(7);
  });

  it('runs every plugin in pre-commit.d in lex order and aborts on first failure', () => {
    const hooksDir = join(dir, '.git', 'hooks');
    const pluginsDir = join(hooksDir, 'pre-commit.d');
    // 10- runs before 20-. 20- exits 42, so the runner should exit 42
    // and 30- should never execute (we prove it by a sentinel file that
    // 30- would touch if it ever ran).
    writeFileSync(join(pluginsDir, '10-a.js'), `#!/usr/bin/env node\nprocess.exit(0);\n`, {
      mode: 0o755,
    });
    writeFileSync(join(pluginsDir, '20-b.js'), `#!/usr/bin/env node\nprocess.exit(42);\n`, {
      mode: 0o755,
    });
    const sentinel = join(dir, 'never-created.txt');
    writeFileSync(
      join(pluginsDir, '30-c.js'),
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'x');\n`,
      { mode: 0o755 },
    );
    // Remove chinwag-guard for this test so the exit code reflects the
    // scripted plugins only (guard would otherwise fail-open at exit 0).
    rmSync(join(pluginsDir, '50-chinwag-guard.js'));

    const result = spawnSync(process.execPath, [join(hooksDir, 'pre-commit')], {
      encoding: 'utf-8',
    });
    expect(result.status).toBe(42);
    expect(existsSync(sentinel)).toBe(false);
  });
});

describe('template shape (sanity checks on the shipped scripts)', () => {
  it('runner starts with a node shebang and the marker', () => {
    expect(RUNNER_SCRIPT.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(RUNNER_SCRIPT).toContain(CHINWAG_HOOK_MARKER);
  });

  it('guard plugin respects CHINWAG_GUARD=off (documented contract)', () => {
    expect(GUARD_SCRIPT).toContain('process.env.CHINWAG_GUARD');
    expect(GUARD_SCRIPT).toContain("'advisory'");
    expect(GUARD_SCRIPT).toContain("'block'");
  });
});

describe('guard plugin fail-open paths (runs the shipped script)', () => {
  let dir;
  let guardPath;
  beforeEach(() => {
    dir = tmpRepo();
    initGitRepo(dir);
    installChinwagHooks(dir);
    guardPath = join(dir, '.git', 'hooks', 'pre-commit.d', '50-chinwag-guard.js');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /**
   * Spawn the guard plugin in `dir` with a HOME pointing at `fakeHome`
   * (so the script's ~/.chinwag/config.json lookup can be controlled
   * without touching the developer's real config). Returns the
   * spawnSync result.
   */
  function runGuard({ fakeHome, env = {} } = {}) {
    const home = fakeHome ?? join(dir, 'fake-home');
    mkdirSync(home, { recursive: true });
    return spawnSync(process.execPath, [guardPath], {
      cwd: dir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home, // Windows equivalent, harmless on POSIX
        // Point at a nonsense base URL so a leaky test can't accidentally
        // hit the production API. Fail-open paths should exit before any
        // fetch attempt anyway.
        CHINWAG_API_BASE: 'http://127.0.0.1:1', // unreachable
        ...env,
      },
    });
  }

  it('exit 0 when CHINWAG_GUARD=off, no config reads performed', () => {
    const result = runGuard({ env: { CHINWAG_GUARD: 'off' } });
    expect(result.status).toBe(0);
  });

  it('exit 0 when no ~/.chinwag/config.json (fail-open)', () => {
    const result = runGuard();
    expect(result.status).toBe(0);
  });

  it('exit 0 when no .chinwag in the repo (fail-open)', () => {
    // Give the fake home a valid config so the first gate passes, then
    // rely on the missing .chinwag to short-circuit.
    const fakeHome = join(dir, 'fake-home');
    mkdirSync(join(fakeHome, '.chinwag'), { recursive: true });
    writeFileSync(
      join(fakeHome, '.chinwag', 'config.json'),
      JSON.stringify({ token: 't', handle: 'a', color: 'cyan' }),
    );
    const result = runGuard({ fakeHome });
    expect(result.status).toBe(0);
  });

  it('exit 0 when nothing is staged (no work to check)', () => {
    const fakeHome = join(dir, 'fake-home');
    mkdirSync(join(fakeHome, '.chinwag'), { recursive: true });
    writeFileSync(
      join(fakeHome, '.chinwag', 'config.json'),
      JSON.stringify({ token: 't', handle: 'a', color: 'cyan' }),
    );
    writeFileSync(join(dir, '.chinwag'), JSON.stringify({ team: 't_test', name: 'test' }));
    const result = runGuard({ fakeHome });
    expect(result.status).toBe(0);
  });
});
