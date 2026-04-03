/**
 * Shell utility functions shared across CLI modules.
 * Consolidated from process-manager.js and open-command-in-terminal.js.
 */

/** Quote a string for safe shell usage. */
export function shellQuote(value: string): string {
  return JSON.stringify(String(value));
}

/** Escape a string for embedding inside AppleScript double-quoted strings. */
export function escapeAppleScriptString(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
