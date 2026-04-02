import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../utils/ansi.js';

describe('stripAnsi', () => {
  it('strips basic CSI color sequences', () => {
    expect(stripAnsi('\x1b[31mred text\x1b[0m')).toBe('red text');
  });

  it('strips complex CSI sequences (SGR, cursor movement)', () => {
    expect(stripAnsi('\x1b[1;32;45m bold green on magenta \x1b[0m')).toBe(
      ' bold green on magenta ',
    );
  });

  it('strips OSC sequences (window title)', () => {
    expect(stripAnsi('\x1b]0;My Title\x07rest')).toBe('rest');
  });

  it('strips OSC sequences with ST terminator', () => {
    expect(stripAnsi('\x1b]8;id=foo;https://example.com\x1b\\link text\x1b]8;;\x1b\\')).toBe(
      'link text',
    );
  });

  it('strips DCS sequences', () => {
    expect(stripAnsi('\x1bPsome data\x1b\\rest')).toBe('rest');
  });

  it('strips character set selection', () => {
    expect(stripAnsi('\x1b(Btext')).toBe('text');
  });

  it('strips carriage returns', () => {
    expect(stripAnsi('hello\rworld')).toBe('helloworld');
  });

  it('strips control characters but preserves newlines and tabs', () => {
    expect(stripAnsi('hello\n\tworld')).toBe('hello\n\tworld');
    expect(stripAnsi('hello\x00world')).toBe('helloworld');
  });

  it('handles strings with no escape sequences', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('handles multiple mixed sequences', () => {
    const input = '\x1b[36m\x1b[1mBold Cyan\x1b[22m\x1b[39m plain \x1b[31mRed\x1b[0m';
    expect(stripAnsi(input)).toBe('Bold Cyan plain Red');
  });
});
