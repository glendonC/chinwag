// Shared file-path normalization for MCP tool handlers.
// Ensures consistent comparison across tools - activity, conflicts, and locks
// all see the same canonical form of a file path.

import path from 'path';

/**
 * Normalize a file path for consistent cross-tool comparison.
 * Uses path.posix.normalize for robust handling of ./, ../, and duplicate
 * slashes, then strips any trailing slash. posix ensures consistent
 * forward-slash behavior regardless of platform.
 */
export function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath).replace(/\/$/, '');
}

/**
 * Normalize an array of file paths, deduplicating after normalization.
 */
export function normalizeFiles(files: string[]): string[] {
  return [...new Set(files.map(normalizePath))];
}
