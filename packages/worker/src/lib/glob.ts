// Tiny glob matcher for file-lease patterns. Supports the subset we need for
// advisory-lease intent claims; deliberately narrower than picomatch so we
// don't take a 30KB dep on a single call site.
//
// Supported:
//   *       - match any run of chars, stopping at `/`
//   **      - match any run of chars, including `/` (use for directory spans)
//   ?       - match exactly one char, not `/`
//   literal - anything else (regex metachars are escaped)
//
// Not supported (yet, add when a real call site needs them):
//   [abc]          character class
//   {a,b}          brace expansion
//   !prefix / !pat negation (would require pass-two logic in the conflict
//                  check, not a pattern-local transform)
//
// Leading slashes are stripped on both sides before matching so
// `src/auth/**` and `/src/auth/tokens.ts` match cleanly.

const GLOB_CHARS = /[*?[]/;

/** Returns true if `s` contains any glob metacharacter. */
export function isGlobPattern(s: string): boolean {
  return GLOB_CHARS.test(s);
}

/**
 * Compile a gitignore-flavoured glob to a RegExp. Anchored at both ends so
 * the pattern matches the entire path, not a substring.
 */
export function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/^\//, '');
  let regex = '';
  let i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      // Double-star: span any run including path separators. Consume an
      // immediately-following `/` so `**/foo` cleanly matches `foo` at the
      // root - otherwise the regex would require a leading slash.
      if (g[i + 1] === '*') {
        regex += '.*';
        i += 2;
        if (g[i] === '/') i += 1;
      } else {
        // Single-star: span any run except the path separator. This is what
        // gives `src/*.ts` its "one directory deep" semantics.
        regex += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      regex += '[^/]';
      i += 1;
    } else if (c && /[.+^$(){}|\\]/.test(c)) {
      // Regex metacharacters that have no glob meaning - escape them so they
      // match literally. `/` intentionally falls through as a literal.
      regex += '\\' + c;
      i += 1;
    } else if (c !== undefined) {
      regex += c;
      i += 1;
    } else {
      break;
    }
  }
  return new RegExp('^' + regex + '$');
}

/**
 * Test whether a concrete path matches a glob pattern. Path and pattern are
 * both stripped of leading slashes before matching so callers don't have to
 * normalise.
 */
export function matchesGlob(path: string, glob: string): boolean {
  const normalized = path.replace(/^\//, '');
  return globToRegExp(glob).test(normalized);
}
