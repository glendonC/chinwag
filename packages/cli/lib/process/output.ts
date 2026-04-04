/**
 * Output capture, line buffering, and PTY output handling.
 */
import { stripAnsi } from '../utils/ansi.js';
import { MAX_OUTPUT_LINES } from '../constants/timings.js';
import type { ManagedProcess } from './types.js';

/**
 * Check if a line looks like terminal control noise (escape sequences only).
 */
export function looksLikeTerminalNoise(line: string): boolean {
  return /^(\[[0-9;?<>A-Za-z]+)+$/.test(line);
}

/**
 * Summarize process output, returning the last meaningful line.
 */
export function summarizeOutput(outputBuffer: string[], task = ''): string | null {
  const taskText = task.trim();
  const lines = outputBuffer
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean)
    .filter((line) => line !== taskText);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^(Done in \d+ms|Live|Running|Completed|failed \(|exited \()/i.test(line)) continue;
    if (/^(No files reported yet|No current work summary|No captured output yet)$/i.test(line))
      continue;
    if (looksLikeTerminalNoise(line)) continue;
    return line.slice(0, 200);
  }

  return null;
}

/**
 * Append a line to the circular output buffer, maintaining the max size.
 */
export function appendOutput(proc: ManagedProcess, data: string): void {
  // Split incoming data on newlines, merge with any partial last line
  const lines = data.split('\n');

  if (lines.length === 0) return;

  // If buffer has content, the last entry might be a partial line -- append to it
  if (proc.outputBuffer.length > 0 && !proc._lastNewline) {
    proc.outputBuffer[proc.outputBuffer.length - 1] += lines[0];
    lines.shift();
  }

  for (const line of lines) {
    proc.outputBuffer.push(line);
  }

  // Track whether last chunk ended with a newline
  proc._lastNewline = data.endsWith('\n');

  // Trim to max buffer size
  if (proc.outputBuffer.length > MAX_OUTPUT_LINES) {
    proc.outputBuffer = proc.outputBuffer.slice(-MAX_OUTPUT_LINES);
  }
}
