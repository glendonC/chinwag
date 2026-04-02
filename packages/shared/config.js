import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * @typedef {Object} ChinwagConfig
 * @property {string} [token] - Authentication token
 * @property {string} [handle] - User display handle
 * @property {string} [userId] - User ID
 */

export const CONFIG_DIR = join(homedir(), '.chinwag');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Check if ~/.chinwag/config.json exists.
 * @returns {boolean}
 */
export function configExists() {
  return existsSync(CONFIG_FILE);
}

/**
 * Load and parse config. Returns null if missing or corrupt.
 * @returns {ChinwagConfig|null}
 */
export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    console.error('[chinwag] Warning: config file corrupted, ignoring');
    return null;
  }
}
