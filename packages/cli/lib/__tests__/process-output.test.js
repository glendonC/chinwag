import { describe, it, expect } from 'vitest';
import { looksLikeTerminalNoise, summarizeOutput, appendOutput } from '../process/output.js';
import { MAX_OUTPUT_LINES } from '../constants/timings.js';

// ---------------------------------------------------------------------------
// Helper: create a minimal ManagedProcess-like object for appendOutput tests
// ---------------------------------------------------------------------------
function makeFakeProc(overrides = {}) {
  return {
    outputBuffer: [],
    _lastNewline: true,
    ...overrides,
  };
}

// ===========================================================================
// looksLikeTerminalNoise
// ===========================================================================
describe('looksLikeTerminalNoise', () => {
  it('returns true for CSI-style escape fragments', () => {
    expect(looksLikeTerminalNoise('[0m')).toBe(true);
    expect(looksLikeTerminalNoise('[1;32m')).toBe(true);
    expect(looksLikeTerminalNoise('[?25h')).toBe(true);
  });

  it('returns true for concatenated escape fragments', () => {
    expect(looksLikeTerminalNoise('[0m[1;32m[?25h')).toBe(true);
  });

  it('returns false for regular text', () => {
    expect(looksLikeTerminalNoise('hello world')).toBe(false);
  });

  it('returns true when text chars happen to fall within the escape character class', () => {
    // The regex character class [0-9;?<>A-Za-z] includes letters,
    // so "[32mhello[0m" still matches as "noise" because every char is in range.
    expect(looksLikeTerminalNoise('[32mhello[0m')).toBe(true);
  });

  it('returns false for text with spaces (outside the escape character class)', () => {
    expect(looksLikeTerminalNoise('[32m hello [0m')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(looksLikeTerminalNoise('')).toBe(false);
  });

  it('returns true for cursor movement sequences', () => {
    expect(looksLikeTerminalNoise('[H')).toBe(true);
    expect(looksLikeTerminalNoise('[2J')).toBe(true);
    expect(looksLikeTerminalNoise('[10;20H')).toBe(true);
  });

  it('returns false for lines starting with a bracket but containing normal text', () => {
    expect(looksLikeTerminalNoise('[INFO] build complete')).toBe(false);
  });
});

// ===========================================================================
// summarizeOutput
// ===========================================================================
describe('summarizeOutput', () => {
  it('returns the last meaningful line from the buffer', () => {
    const buffer = ['starting...', 'compiling files', 'generated output.js'];
    expect(summarizeOutput(buffer)).toBe('generated output.js');
  });

  it('returns null for an empty buffer', () => {
    expect(summarizeOutput([])).toBeNull();
  });

  it('returns null when buffer contains only blank lines', () => {
    expect(summarizeOutput(['', '  ', '\t'])).toBeNull();
  });

  it('skips status-like lines and returns the previous meaningful line', () => {
    const buffer = ['wrote 5 files', 'Done in 120ms'];
    expect(summarizeOutput(buffer)).toBe('wrote 5 files');
  });

  it('skips "Running", "Live", "Completed" status lines', () => {
    const buffer = ['processing...', 'Running'];
    expect(summarizeOutput(buffer)).toBe('processing...');

    expect(summarizeOutput(['processing...', 'Live'])).toBe('processing...');
    expect(summarizeOutput(['processing...', 'Completed'])).toBe('processing...');
  });

  it('skips "failed (" and "exited (" lines', () => {
    const buffer = ['some real output', 'failed (code 1)'];
    expect(summarizeOutput(buffer)).toBe('some real output');

    expect(summarizeOutput(['real output', 'exited (0)'])).toBe('real output');
  });

  it('skips placeholder messages', () => {
    const buffer = ['No files reported yet'];
    expect(summarizeOutput(buffer)).toBeNull();

    expect(summarizeOutput(['No current work summary'])).toBeNull();
    expect(summarizeOutput(['No captured output yet'])).toBeNull();
  });

  it('skips terminal noise lines', () => {
    const buffer = ['real output here', '[0m[1;32m'];
    expect(summarizeOutput(buffer)).toBe('real output here');
  });

  it('filters out lines that match the task argument', () => {
    const buffer = ['refactor auth', 'wrote updated auth module'];
    expect(summarizeOutput(buffer, 'refactor auth')).toBe('wrote updated auth module');
  });

  it('trims the task argument before comparison', () => {
    const buffer = ['refactor auth', 'done with refactor'];
    expect(summarizeOutput(buffer, '  refactor auth  ')).toBe('done with refactor');
  });

  it('handles task argument with leading/trailing whitespace in buffer lines', () => {
    // Buffer lines are trimmed, so " refactor auth " becomes "refactor auth"
    const buffer = ['  refactor auth  ', 'wrote file'];
    expect(summarizeOutput(buffer, 'refactor auth')).toBe('wrote file');
  });

  it('truncates lines longer than 200 characters', () => {
    const longLine = 'x'.repeat(300);
    const buffer = [longLine];
    const result = summarizeOutput(buffer);
    expect(result).toHaveLength(200);
    expect(result).toBe('x'.repeat(200));
  });

  it('strips ANSI codes before evaluating lines', () => {
    const buffer = ['\x1b[32mSuccessfully compiled\x1b[0m'];
    expect(summarizeOutput(buffer)).toBe('Successfully compiled');
  });

  it('returns null when all lines are skippable', () => {
    const buffer = ['Done in 50ms', 'Running', '[0m', ''];
    expect(summarizeOutput(buffer)).toBeNull();
  });

  it('uses default empty string for task when not provided', () => {
    const buffer = ['some output'];
    expect(summarizeOutput(buffer)).toBe('some output');
  });

  it('returns null when the only meaningful line matches the task', () => {
    const buffer = ['my task'];
    expect(summarizeOutput(buffer, 'my task')).toBeNull();
  });

  it('handles buffer with only ANSI-coded blank lines', () => {
    const buffer = ['\x1b[0m', '\x1b[1;32m \x1b[0m'];
    expect(summarizeOutput(buffer)).toBeNull();
  });
});

// ===========================================================================
// appendOutput
// ===========================================================================
describe('appendOutput', () => {
  it('appends a single line ending with newline', () => {
    const proc = makeFakeProc();
    appendOutput(proc, 'hello\n');

    expect(proc.outputBuffer).toEqual(['hello', '']);
    expect(proc._lastNewline).toBe(true);
  });

  it('appends a single line without trailing newline', () => {
    const proc = makeFakeProc();
    appendOutput(proc, 'hello');

    expect(proc.outputBuffer).toEqual(['hello']);
    expect(proc._lastNewline).toBe(false);
  });

  it('appends multiple lines from a single data chunk', () => {
    const proc = makeFakeProc();
    appendOutput(proc, 'line1\nline2\nline3\n');

    expect(proc.outputBuffer).toEqual(['line1', 'line2', 'line3', '']);
    expect(proc._lastNewline).toBe(true);
  });

  it('merges partial line when _lastNewline is false', () => {
    const proc = makeFakeProc({
      outputBuffer: ['partial'],
      _lastNewline: false,
    });

    appendOutput(proc, ' continued\nfull line\n');

    expect(proc.outputBuffer).toEqual(['partial continued', 'full line', '']);
    expect(proc._lastNewline).toBe(true);
  });

  it('does not merge when _lastNewline is true', () => {
    const proc = makeFakeProc({
      outputBuffer: ['complete line'],
      _lastNewline: true,
    });

    appendOutput(proc, 'new line\n');

    expect(proc.outputBuffer).toEqual(['complete line', 'new line', '']);
    expect(proc._lastNewline).toBe(true);
  });

  it('trims buffer to MAX_OUTPUT_LINES when exceeded', () => {
    const proc = makeFakeProc();

    // Fill the buffer to exactly MAX_OUTPUT_LINES
    for (let i = 0; i < MAX_OUTPUT_LINES; i++) {
      proc.outputBuffer.push(`line-${i}`);
    }
    proc._lastNewline = true;

    // Add more lines that will push it over the limit
    appendOutput(proc, 'overflow1\noverflow2\n');

    expect(proc.outputBuffer.length).toBeLessThanOrEqual(MAX_OUTPUT_LINES);
    // The oldest lines should have been trimmed
    expect(proc.outputBuffer[proc.outputBuffer.length - 2]).toBe('overflow2');
    expect(proc.outputBuffer[proc.outputBuffer.length - 1]).toBe('');
  });

  it('handles empty string data gracefully', () => {
    const proc = makeFakeProc();
    appendOutput(proc, '');

    // Split('') yields [''], so one entry
    expect(proc.outputBuffer).toEqual(['']);
    expect(proc._lastNewline).toBe(false);
  });

  it('handles data that is only a newline', () => {
    const proc = makeFakeProc();
    appendOutput(proc, '\n');

    expect(proc.outputBuffer).toEqual(['', '']);
    expect(proc._lastNewline).toBe(true);
  });

  it('handles sequential partial writes that build up a line', () => {
    const proc = makeFakeProc();

    appendOutput(proc, 'hel');
    expect(proc.outputBuffer).toEqual(['hel']);
    expect(proc._lastNewline).toBe(false);

    appendOutput(proc, 'lo w');
    expect(proc.outputBuffer).toEqual(['hello w']);
    expect(proc._lastNewline).toBe(false);

    appendOutput(proc, 'orld\n');
    expect(proc.outputBuffer).toEqual(['hello world', '']);
    expect(proc._lastNewline).toBe(true);
  });

  it('handles data with multiple consecutive newlines', () => {
    const proc = makeFakeProc();
    appendOutput(proc, 'a\n\n\nb\n');

    expect(proc.outputBuffer).toEqual(['a', '', '', 'b', '']);
    expect(proc._lastNewline).toBe(true);
  });

  it('preserves buffer contents when appending below the limit', () => {
    const proc = makeFakeProc({
      outputBuffer: ['existing1', 'existing2'],
      _lastNewline: true,
    });

    appendOutput(proc, 'new\n');

    expect(proc.outputBuffer).toEqual(['existing1', 'existing2', 'new', '']);
  });

  it('keeps the last MAX_OUTPUT_LINES entries after trimming', () => {
    const proc = makeFakeProc();

    // Build a large data string that exceeds MAX_OUTPUT_LINES
    const lines = [];
    for (let i = 0; i < MAX_OUTPUT_LINES + 50; i++) {
      lines.push(`line-${i}`);
    }
    appendOutput(proc, lines.join('\n') + '\n');

    expect(proc.outputBuffer).toHaveLength(MAX_OUTPUT_LINES);
    // Buffer should contain the most recent lines
    const lastLine = proc.outputBuffer[proc.outputBuffer.length - 1];
    // The last entry is '' from the trailing newline
    expect(lastLine).toBe('');
    // Second to last should be the last numbered line
    const secondToLast = proc.outputBuffer[proc.outputBuffer.length - 2];
    expect(secondToLast).toBe(`line-${MAX_OUTPUT_LINES + 49}`);
  });

  it('merges partial line then trims if buffer overflows', () => {
    // Pre-fill the buffer close to capacity with _lastNewline false
    const proc = makeFakeProc({
      outputBuffer: Array.from({ length: MAX_OUTPUT_LINES - 1 }, (_, i) => `fill-${i}`),
      _lastNewline: false,
    });

    // This should merge with last entry, then add more, causing overflow
    appendOutput(proc, '-suffix\nnew1\nnew2\nnew3\n');

    expect(proc.outputBuffer.length).toBeLessThanOrEqual(MAX_OUTPUT_LINES);
    // The merged line should still be present (unless it was trimmed off)
    // At minimum, the newest lines should be there
    expect(proc.outputBuffer).toContain('new3');
  });
});
