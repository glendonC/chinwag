// Verbatim scripts copied into the user's git hooks directory by
// `installChinwagHooks`. Everything here is the exact text the user will
// eventually see on disk — no transformation, no string templating at
// install time. Keeping the scripts inline as string constants (rather
// than loading from files at runtime) means they travel inside the
// bundled CLI with no build-system plumbing to configure.
//
// Design rules for these scripts:
//   - Must work under every Node version chinwag supports (>= 22). Use
//     CJS `require`; the installed file has no extension so Node treats
//     it as CJS unconditionally.
//   - Zero chinwag dependencies. The scripts are standalone: they read
//     ~/.chinwag/config.json, the project's .chinwag, and the staged
//     file list from git, then hit the public HTTPS API. Nothing else.
//   - Fail-open: any unexpected failure (no config, no team, network
//     error, non-2xx) exits 0 silently. A developer's local commit must
//     never be broken by our infrastructure being down. The only non-zero
//     exit path is "CHINWAG_GUARD=block was explicitly set AND the API
//     returned real conflicts."
//
// The `CHINWAG_HOOK_MARKER` inside both scripts lets the installer detect
// its own previous output during re-runs, so upgrading is a straight
// overwrite instead of an ever-growing pile of `.orig` files.

export const CHINWAG_HOOK_MARKER = '# chinwag-managed-hook';

/**
 * Chain-runner installed as `pre-commit`. Iterates `pre-commit.d/*` in
 * lexical order, bails on first non-zero exit. Also invokes any
 * pre-existing user hook preserved as `pre-commit.orig`.
 */
export const RUNNER_SCRIPT = `#!/usr/bin/env node
// ${CHINWAG_HOOK_MARKER}
//
// chinwag chain-runner for the pre-commit hook. Runs the user's own
// pre-existing pre-commit (preserved as pre-commit.orig) first, then
// every plugin in pre-commit.d/ in lexical order. Any non-zero exit
// aborts the commit.

'use strict';
const { readdirSync, statSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const hooksDir = __dirname;

function run(scriptPath) {
  try {
    statSync(scriptPath);
  } catch {
    return 0;
  }
  const result = spawnSync(scriptPath, [], { stdio: 'inherit' });
  return result.status == null ? 1 : result.status;
}

// Run the preserved original hook first, if any. Preserves workflow for
// users who had a pre-commit before chinwag init.
const origStatus = run(join(hooksDir, 'pre-commit.orig'));
if (origStatus !== 0) process.exit(origStatus);

const pluginsDir = join(hooksDir, 'pre-commit.d');
let plugins = [];
try {
  plugins = readdirSync(pluginsDir)
    .filter((f) => !f.startsWith('.') && !f.endsWith('.orig'))
    .sort();
} catch {
  // no plugins dir — nothing to run
  process.exit(0);
}

for (const name of plugins) {
  const status = run(join(pluginsDir, name));
  if (status !== 0) process.exit(status);
}
process.exit(0);
`;

/**
 * Plugin installed at `pre-commit.d/50-chinwag-guard.js`. Asks the
 * chinwag API whether any staged file collides with a peer's active
 * lock (exact path or glob umbrella). Prints a summary line per
 * conflict and respects CHINWAG_GUARD (off | advisory | block).
 */
export const GUARD_SCRIPT = `#!/usr/bin/env node
// ${CHINWAG_HOOK_MARKER}
//
// chinwag pre-commit guard plugin. Asks the chinwag API whether any
// staged file is covered by a peer's active lock (exact path or glob)
// and surfaces the result. Fail-open: any unexpected error exits 0.
//
// Modes (via CHINWAG_GUARD env var):
//   off       — skip the check entirely
//   advisory  — print conflicts, exit 0 (default; lets the commit go)
//   block     — print conflicts, exit 1 if any found

'use strict';
const { readFileSync, existsSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { homedir } = require('node:os');

const MODE = (process.env.CHINWAG_GUARD || 'advisory').toLowerCase();
if (MODE === 'off') process.exit(0);

const API_BASE =
  process.env.CHINWAG_API_BASE ||
  'https://chinwag-api.glendonchin.workers.dev';

function failOpen(reason) {
  // Used for expected "can't run the check" paths (no config, no team,
  // network down, etc). The developer's local commit must never be
  // broken by chinwag infrastructure being unavailable.
  if (process.env.CHINWAG_HOOK_DEBUG) {
    process.stderr.write('[chinwag] guard skipped: ' + reason + '\\n');
  }
  process.exit(0);
}

// 1) Read the user's auth token from the same config file the CLI uses.
let token;
try {
  const cfgPath = join(homedir(), '.chinwag', 'config.json');
  if (!existsSync(cfgPath)) return failOpen('no account config');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  token = cfg && cfg.token;
  if (!token) return failOpen('no token in config');
} catch (e) {
  return failOpen('config read failed: ' + e.message);
}

// 2) Read the project's team id from .chinwag.
let teamId;
try {
  // cwd is the repo root when git spawns the hook.
  const chinwagPath = join(process.cwd(), '.chinwag');
  if (!existsSync(chinwagPath)) return failOpen('no .chinwag in repo');
  const data = JSON.parse(readFileSync(chinwagPath, 'utf-8'));
  teamId = data && data.team;
  if (!teamId) return failOpen('no team in .chinwag');
} catch (e) {
  return failOpen('.chinwag read failed: ' + e.message);
}

// 3) Collect staged files via git. Use -z for NUL-delimited output so
//    paths with newlines survive (rare but real).
let staged;
try {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], {
    encoding: 'utf-8',
  });
  staged = out.split('\\0').filter(Boolean);
} catch (e) {
  return failOpen('git diff --cached failed: ' + e.message);
}
if (staged.length === 0) process.exit(0);

// 4) Ask the API. Fetch is built into Node 22+.
(async () => {
  let res;
  try {
    res = await fetch(API_BASE + '/teams/' + encodeURIComponent(teamId) + '/locks/check', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ files: staged }),
    });
  } catch (e) {
    return failOpen('network error: ' + e.message);
  }
  if (!res.ok) return failOpen('api ' + res.status);

  let payload;
  try {
    payload = await res.json();
  } catch {
    return failOpen('non-json response');
  }
  const blocked = Array.isArray(payload.blocked) ? payload.blocked : [];
  if (blocked.length === 0) process.exit(0);

  // Render conflicts. Keep the message dense but explicit.
  process.stderr.write('chinwag: staged files conflict with peer locks\\n');
  for (const b of blocked) {
    const scope = b.blocked_by_glob ? ' via scope ' + b.blocked_by_glob : '';
    process.stderr.write('  ' + b.file + ' — held by ' + b.held_by + scope + '\\n');
  }
  process.stderr.write(
    MODE === 'block'
      ? '\\nCommit blocked. Set CHINWAG_GUARD=off to override once, or ask the lock holder to release.\\n'
      : '\\n(advisory) Set CHINWAG_GUARD=block to have chinwag refuse the commit.\\n'
  );
  process.exit(MODE === 'block' ? 1 : 0);
})();
`;
