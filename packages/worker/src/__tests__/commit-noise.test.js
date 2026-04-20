import { describe, it, expect } from 'vitest';
import {
  isNoiseCommit,
  isMergeCommit,
  isConventionalNoise,
  isWipCheckpoint,
  isTrivialSmallDiff,
} from '../dos/team/commit-noise.js';

describe('isMergeCommit', () => {
  it('flags auto-generated merge messages', () => {
    expect(isMergeCommit('Merge branch main into feature/x')).toBe(true);
    expect(isMergeCommit('Merge pull request #42 from foo/bar')).toBe(true);
    expect(isMergeCommit('Merge remote-tracking branch origin/main')).toBe(true);
    expect(isMergeCommit('Merge tag v1.2.0')).toBe(true);
  });

  it('does not flag human prose using the word merge', () => {
    expect(isMergeCommit('Merge two helpers into one')).toBe(false);
    expect(isMergeCommit('refactor: merge auth and session modules')).toBe(false);
  });
});

describe('isConventionalNoise', () => {
  it('flags dependency bumps', () => {
    expect(isConventionalNoise('chore(deps): bump react from 19.0 to 19.1')).toBe(true);
    expect(isConventionalNoise('chore(deps-dev): update vitest')).toBe(true);
    expect(isConventionalNoise('chore(dependencies): upgrade typescript')).toBe(true);
  });

  it('flags formatting / lint / style commits', () => {
    expect(isConventionalNoise('chore: prettier')).toBe(true);
    expect(isConventionalNoise('refactor: cleanup whitespace')).toBe(true);
    expect(isConventionalNoise('style: format imports')).toBe(true);
    expect(isConventionalNoise('style(web): reflow')).toBe(true);
  });

  it('flags doc typo fixes', () => {
    expect(isConventionalNoise('docs: fix typo in README')).toBe(true);
    expect(isConventionalNoise('docs(api): typo')).toBe(true);
  });

  it('does not flag substantive chore/refactor/docs commits', () => {
    expect(isConventionalNoise('chore(release): v1.2.0')).toBe(false);
    expect(isConventionalNoise('refactor(auth): split middleware')).toBe(false);
    expect(isConventionalNoise('docs: add architecture diagram')).toBe(false);
    expect(isConventionalNoise('feat: add billing window widget')).toBe(false);
    expect(isConventionalNoise('fix: race condition in lock reaper')).toBe(false);
  });
});

describe('isWipCheckpoint', () => {
  it('flags WIP and temp messages', () => {
    expect(isWipCheckpoint('wip')).toBe(true);
    expect(isWipCheckpoint('WIP: trying something')).toBe(true);
    expect(isWipCheckpoint('temp checkpoint')).toBe(true);
    expect(isWipCheckpoint('tmp: save progress')).toBe(true);
    expect(isWipCheckpoint('checkpoint before refactor')).toBe(true);
  });

  it('flags fixup and squash markers', () => {
    expect(isWipCheckpoint('fixup! prior commit')).toBe(true);
    expect(isWipCheckpoint('!fixup')).toBe(true);
    expect(isWipCheckpoint('squash this')).toBe(true);
    expect(isWipCheckpoint('amend last commit')).toBe(true);
  });

  it('does not flag substantive messages that contain wip-like words', () => {
    expect(isWipCheckpoint('add temperature sensor support')).toBe(false);
    expect(isWipCheckpoint('refactor: remove temporary workaround')).toBe(false);
  });
});

describe('isTrivialSmallDiff', () => {
  it('flags terse messages on tiny diffs', () => {
    expect(
      isTrivialSmallDiff({ message: 'fix', files_changed: 1, lines_added: 1, lines_removed: 1 }),
    ).toBe(true);
    expect(
      isTrivialSmallDiff({ message: '.', files_changed: 1, lines_added: 0, lines_removed: 0 }),
    ).toBe(true);
    expect(
      isTrivialSmallDiff({
        message: 'oops typo',
        files_changed: 1,
        lines_added: 1,
        lines_removed: 1,
      }),
    ).toBe(true);
  });

  it('does not flag terse messages on large diffs', () => {
    expect(
      isTrivialSmallDiff({ message: 'fix', files_changed: 5, lines_added: 200, lines_removed: 50 }),
    ).toBe(false);
  });

  it('does not flag substantive messages on small diffs', () => {
    expect(
      isTrivialSmallDiff({
        message: 'Disable retries when circuit breaker is open',
        files_changed: 1,
        lines_added: 1,
        lines_removed: 1,
      }),
    ).toBe(false);
  });

  it('does not flag empty messages (caller decides default)', () => {
    expect(isTrivialSmallDiff({ message: '', files_changed: 1, lines_added: 1 })).toBe(false);
  });
});

describe('isNoiseCommit (composition)', () => {
  it('returns false for substantive feature commits', () => {
    expect(
      isNoiseCommit({
        message: 'feat(worker): add commit noise filter',
        files_changed: 4,
        lines_added: 200,
        lines_removed: 12,
      }),
    ).toBe(false);
  });

  it('returns false when no message is provided (fail-substantive)', () => {
    expect(isNoiseCommit({ files_changed: 1, lines_added: 1, lines_removed: 0 })).toBe(false);
    expect(isNoiseCommit({ message: null, files_changed: 1 })).toBe(false);
    expect(isNoiseCommit({ message: '   ', files_changed: 1 })).toBe(false);
  });

  it('flags any of the four rule families', () => {
    expect(
      isNoiseCommit({
        message: 'Merge pull request #99 from foo/bar',
        files_changed: 0,
        lines_added: 0,
        lines_removed: 0,
      }),
    ).toBe(true);
    expect(
      isNoiseCommit({
        message: 'chore(deps): bump react',
        files_changed: 1,
        lines_added: 1,
        lines_removed: 1,
      }),
    ).toBe(true);
    expect(
      isNoiseCommit({
        message: 'wip',
        files_changed: 3,
        lines_added: 50,
        lines_removed: 0,
      }),
    ).toBe(true);
    expect(
      isNoiseCommit({
        message: 'fix',
        files_changed: 1,
        lines_added: 2,
        lines_removed: 0,
      }),
    ).toBe(true);
  });

  it('handles missing diff fields by treating them as 0', () => {
    // No files/lines info on a "fix" message → trivial-small-diff fires
    // because 0 + 0 < 5 and undefined files_changed defaults to 0 (≤ 1).
    expect(isNoiseCommit({ message: 'fix' })).toBe(true);
    // But a verbose message with no diff info stays substantive.
    expect(
      isNoiseCommit({
        message: 'Replace the legacy authentication middleware with token-aware variant',
      }),
    ).toBe(false);
  });
});
