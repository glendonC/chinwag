import { existsSync, readFileSync } from 'fs';
import { join, dirname, basename } from 'path';

/**
 * @typedef {Object} TeamFileInfo
 * @property {string} filePath - Absolute path to the .chinwag file
 * @property {string} root - Directory containing the .chinwag file
 * @property {string} teamId - Validated team ID
 * @property {string} teamName - Team display name
 */

export const TEAM_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isValidTeamId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 30 && TEAM_ID_PATTERN.test(id);
}

/**
 * Walk up from startDir to find .chinwag file.
 * Returns { filePath, root, teamId, teamName } or null if not found.
 * Returns null if the file is unparseable or the team ID is invalid.
 * @param {string} [startDir] - Directory to start searching from (defaults to process.cwd())
 * @returns {TeamFileInfo|null}
 */
export function findTeamFile(startDir = process.cwd()) {
  let dir = startDir;
  while (true) {
    const filePath = join(dir, '.chinwag');
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        const teamId = data.team || null;
        if (!teamId || !isValidTeamId(teamId)) return null;
        return {
          filePath,
          root: dir,
          teamId,
          teamName: data.name || basename(dir),
        };
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
