import { describe, it, expect } from 'vitest';
import { summarizeOutput, looksLikeTerminalNoise, appendOutput } from '../process/output.js';

// ── looksLikeTerminalNoise ───────────────────────────────

describe('looksLikeTerminalNoise', () => {
  it('detects escape sequence lines', () => {
    expect(looksLikeTerminalNoise('[0m')).toBe(true);
    expect(looksLikeTerminalNoise('[32;1m')).toBe(true);
    expect(looksLikeTerminalNoise('[?25h')).toBe(true);
  });

  it('does not flag real content', () => {
    expect(looksLikeTerminalNoise('hello world')).toBe(false);
    expect(looksLikeTerminalNoise('Running tests...')).toBe(false);
    expect(looksLikeTerminalNoise('')).toBe(false);
  });

  it('detects multiple sequential escape codes', () => {
    expect(looksLikeTerminalNoise('[0m[32m')).toBe(true);
    expect(looksLikeTerminalNoise('[0m[32;1m[49m')).toBe(true);
  });
});

// ── summarizeOutput ──────────────────────────────────────

describe('summarizeOutput', () => {
  it('returns null for empty buffer', () => {
    expect(summarizeOutput([])).toBeNull();
  });

  it('returns null when all lines are empty', () => {
    expect(summarizeOutput(['', '  ', '\t'])).toBeNull();
  });

  it('returns the last meaningful line', () => {
    expect(summarizeOutput(['Setting up...', 'Building components', 'Auth flow complete'])).toBe(
      'Auth flow complete',
    );
  });

  it('skips boilerplate status lines', () => {
    const buffer = ['Setting up...', 'Building...', 'Done in 450ms'];
    expect(summarizeOutput(buffer)).toBe('Building...');
  });

  it('skips "Running" status line', () => {
    const buffer = ['Setup complete', 'Running'];
    expect(summarizeOutput(buffer)).toBe('Setup complete');
  });

  it('skips "Completed" status line', () => {
    const buffer = ['Processed files', 'Completed'];
    expect(summarizeOutput(buffer)).toBe('Processed files');
  });

  it('skips "Live" status line', () => {
    const buffer = ['Server started', 'Live'];
    expect(summarizeOutput(buffer)).toBe('Server started');
  });

  it('skips lines matching the task text', () => {
    const buffer = ['Refactor auth flow', 'Working on auth module'];
    expect(summarizeOutput(buffer, 'Refactor auth flow')).toBe('Working on auth module');
  });

  it('skips "No files reported yet" placeholder', () => {
    const buffer = ['Starting...', 'No files reported yet'];
    expect(summarizeOutput(buffer)).toBe('Starting...');
  });

  it('skips "No current work summary" placeholder', () => {
    const buffer = ['Initializing', 'No current work summary'];
    expect(summarizeOutput(buffer)).toBe('Initializing');
  });

  it('skips "No captured output yet" placeholder', () => {
    const buffer = ['Connecting', 'No captured output yet'];
    expect(summarizeOutput(buffer)).toBe('Connecting');
  });

  it('skips terminal noise lines', () => {
    const buffer = ['Real output', '[0m[32m'];
    expect(summarizeOutput(buffer)).toBe('Real output');
  });

  it('truncates long output to 200 chars', () => {
    const longLine = 'A'.repeat(300);
    const buffer = [longLine];
    const result = summarizeOutput(buffer);
    expect(result.length).toBe(200);
  });

  it('returns null when all lines are skippable', () => {
    const buffer = ['Done in 100ms', 'Running', 'Completed', '[0m'];
    expect(summarizeOutput(buffer)).toBeNull();
  });

  it('skips "failed (" exit lines', () => {
    const buffer = ['Actual output', 'failed (exit 1)'];
    expect(summarizeOutput(buffer)).toBe('Actual output');
  });

  it('skips "exited (" exit lines', () => {
    const buffer = ['Actual output', 'exited (0)'];
    expect(summarizeOutput(buffer)).toBe('Actual output');
  });
});

// ── appendOutput ─────────────────────────────────────────

describe('appendOutput', () => {
  function makeProc() {
    return {
      outputBuffer: [],
      _lastNewline: true,
      _killTimer: null,
    };
  }

  it('appends a single line', () => {
    const proc = makeProc();
    appendOutput(proc, 'hello\n');
    expect(proc.outputBuffer).toContain('hello');
  });

  it('appends multiple lines from a single chunk', () => {
    const proc = makeProc();
    appendOutput(proc, 'line1\nline2\nline3\n');
    expect(proc.outputBuffer).toContain('line1');
    expect(proc.outputBuffer).toContain('line2');
    expect(proc.outputBuffer).toContain('line3');
  });

  it('handles partial lines (no trailing newline)', () => {
    const proc = makeProc();
    appendOutput(proc, 'partial');
    expect(proc._lastNewline).toBe(false);

    appendOutput(proc, ' rest\n');
    // The partial and rest should be joined
    expect(proc.outputBuffer.some((l) => l.includes('partial rest'))).toBe(true);
  });

  it('merges continuation of partial last line', () => {
    const proc = makeProc();
    appendOutput(proc, 'hello');
    expect(proc._lastNewline).toBe(false);

    appendOutput(proc, ' world\n');
    expect(proc.outputBuffer).toContain('hello world');
    expect(proc._lastNewline).toBe(true);
  });

  it('tracks _lastNewline correctly', () => {
    const proc = makeProc();
    appendOutput(proc, 'no newline');
    expect(proc._lastNewline).toBe(false);

    appendOutput(proc, '\n');
    expect(proc._lastNewline).toBe(true);
  });

  it('handles empty data', () => {
    const proc = makeProc();
    appendOutput(proc, '');
    expect(proc.outputBuffer.length).toBeLessThanOrEqual(1);
  });

  it('truncates very large chunks', () => {
    const proc = makeProc();
    const bigChunk = 'A'.repeat(2_000_000);
    appendOutput(proc, bigChunk);
    // Should not have millions of lines; chunk is truncated to 1MB
    const totalChars = proc.outputBuffer.join('').length;
    expect(totalChars).toBeLessThanOrEqual(1_048_576 + 100);
  });
});
