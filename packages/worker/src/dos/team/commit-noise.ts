// Commit noise classification. Pure function; no DO state.
//
// Distinguishes substantive commits from noise (dependency bumps, formatting
// passes, WIP checkpoints, trivial-message + small-diff combos). Flagged
// commits are still recorded - they get `is_noise = 1` in the commits table
// - but they don't bump the session-level `commit_count` and analytics
// queries filter them out by default. The audit trail stays intact; the
// signal stays clean.
//
// Adapted from memorix's `src/git/noise-filter.ts` (Apache 2.0). Rules are
// a deliberate subset of memorix's set - lockfile-only detection is omitted
// because the commits schema doesn't carry per-file change lists. If that
// becomes valuable, add a `changed_files` column and extend the rule set
// here.

export interface CommitForNoiseCheck {
  message?: string | null;
  files_changed?: number | null;
  lines_added?: number | null;
  lines_removed?: number | null;
}

const MERGE_PREFIXES = /^Merge (branch|pull request|remote-tracking|tag|commit) /i;

const CONVENTIONAL_NOISE = [
  // Dep bumps: chore(deps): bump foo, chore(deps-dev): update bar
  /^chore\((deps|deps-dev|dependencies)\)\s*:\s*(bump|update|upgrade|pin|unpin)\b/i,
  // Pure formatting / lint passes
  /^(chore|refactor)(\([^)]*\))?\s*:\s*(format|lint|prettier|eslint|whitespace|trailing|cleanup|reformat)\b/i,
  // Conventional `style:` is reserved for non-semantic changes
  /^style(\([^)]*\))?\s*:/i,
  // Doc typo fixes
  /^docs?(\([^)]*\))?\s*:\s*(fix\s+)?typo/i,
];

const WIP_PATTERNS = [
  /^wip\b/i,
  /^(temp|tmp)\b/i,
  /^checkpoint\b/i,
  /^squash\s*(this|me)?\b/i,
  /^!?fixup!?\b/i, // git fixup commits and `!fixup` shorthand
  /^amend\b/i,
];

export function isMergeCommit(message: string): boolean {
  return MERGE_PREFIXES.test(message);
}

export function isConventionalNoise(message: string): boolean {
  return CONVENTIONAL_NOISE.some((re) => re.test(message));
}

export function isWipCheckpoint(message: string): boolean {
  return WIP_PATTERNS.some((re) => re.test(message));
}

export function isTrivialSmallDiff(commit: CommitForNoiseCheck): boolean {
  const msg = (commit.message ?? '').trim();
  if (!msg) return false;
  const wordCount = msg.split(/\s+/).filter(Boolean).length;
  const isShortMessage = msg.length <= 3 || wordCount <= 2;
  if (!isShortMessage) return false;
  const totalLines = (commit.lines_added ?? 0) + (commit.lines_removed ?? 0);
  const filesChanged = commit.files_changed ?? 0;
  // Only flag when both the message and the diff are tiny. A short message
  // on a large diff is probably a genuine but terse commit; a verbose
  // message on a one-line diff is probably substantive (a one-line bug fix
  // with detailed explanation).
  return totalLines < 5 && filesChanged <= 1;
}

export function isNoiseCommit(commit: CommitForNoiseCheck): boolean {
  const msg = (commit.message ?? '').trim();
  if (!msg) return false; // No message → can't classify; default to substantive.
  return (
    isMergeCommit(msg) ||
    isConventionalNoise(msg) ||
    isWipCheckpoint(msg) ||
    isTrivialSmallDiff(commit)
  );
}
