/**
 * ANSI escape sequence handling.
 *
 * Uses the comprehensive implementation from process-manager.js which handles
 * OSC, DCS/PM/APC, CSI, character set selection, and other escape sequences.
 */

/* eslint-disable no-control-regex */

/** Strip all ANSI escape codes, OSC sequences, control characters, and carriage returns. */
export function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '') // OSC sequences (title, hyperlinks, etc.)
    .replace(/\x1b[P^_][\s\S]*?\x1b\\/g, '') // DCS, PM, APC sequences
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '') // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\([A-Z]/g, '') // Character set selection
    .replace(/\x1b[@-_]/g, '') // Other 2-char escape sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // Control characters (keep \n \r \t)
    .replace(/\r/g, '');
}
