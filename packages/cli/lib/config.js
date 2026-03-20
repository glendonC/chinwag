import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.chinwag');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function configExists() {
  return existsSync(CONFIG_FILE);
}

export function loadConfig() {
  const raw = readFileSync(CONFIG_FILE, 'utf-8');
  return JSON.parse(raw);
}

export function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

export function deleteConfig() {
  if (existsSync(CONFIG_FILE)) {
    unlinkSync(CONFIG_FILE);
  }
}
