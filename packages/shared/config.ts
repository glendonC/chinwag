import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { formatError } from './error-utils.js';

export interface ChinwagConfig {
  token?: string;
  handle?: string;
  userId?: string;
  color?: string;
}

const OPTIONAL_STRING_FIELDS: ReadonlyArray<keyof ChinwagConfig> = [
  'token',
  'handle',
  'userId',
  'color',
];

/**
 * Structurally validate a parsed value against the ChinwagConfig shape.
 * Returns an error string if invalid, or null if the shape is acceptable.
 */
export function validateConfigShape(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `Expected a JSON object, got ${Array.isArray(value) ? 'array' : typeof value}`;
  }

  const obj = value as Record<string, unknown>;
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (field in obj && obj[field] !== undefined && typeof obj[field] !== 'string') {
      return `Field "${field}" must be a string, got ${typeof obj[field]}`;
    }
  }

  return null;
}

export const CONFIG_DIR = join(homedir(), '.chinwag');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

export function loadConfig(): ChinwagConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  let raw: string;
  try {
    raw = readFileSync(CONFIG_FILE, 'utf-8');
  } catch (err: unknown) {
    console.error(`[chinwag] Failed to read config file ${CONFIG_FILE}: ${formatError(err)}`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const preview = raw.length > 120 ? raw.slice(0, 120) + '...' : raw;
    console.error(
      `[chinwag] Config file ${CONFIG_FILE} contains invalid JSON: ${formatError(err)}` +
        `\n  Content preview: ${JSON.stringify(preview)}`,
    );
    return null;
  }

  const validationError = validateConfigShape(parsed);
  if (validationError) {
    console.error(`[chinwag] Config file ${CONFIG_FILE} has invalid shape: ${validationError}`);
    return null;
  }

  return parsed as ChinwagConfig;
}
