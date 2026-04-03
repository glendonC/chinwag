import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';

// Mock fs before importing config module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';
import { loadConfig, configExists } from '../config.js';

const CONFIG_FILE = join(homedir(), '.chinwag', 'config.json');

describe('configExists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when config file exists', () => {
    existsSync.mockReturnValue(true);
    expect(configExists()).toBe(true);
    expect(existsSync).toHaveBeenCalledWith(CONFIG_FILE);
  });

  it('returns false when config file does not exist', () => {
    existsSync.mockReturnValue(false);
    expect(configExists()).toBe(false);
    expect(existsSync).toHaveBeenCalledWith(CONFIG_FILE);
  });
});

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed config when file exists and is valid JSON', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(
      JSON.stringify({
        token: 'tok_abc123',
        handle: 'glendon',
        userId: 'usr_xyz',
      }),
    );

    const config = loadConfig();
    expect(config).toEqual({
      token: 'tok_abc123',
      handle: 'glendon',
      userId: 'usr_xyz',
    });
    expect(readFileSync).toHaveBeenCalledWith(CONFIG_FILE, 'utf-8');
  });

  it('returns null when config file does not exist', () => {
    existsSync.mockReturnValue(false);
    const config = loadConfig();
    expect(config).toBeNull();
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('returns null when config file contains malformed JSON', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('this is not json {{{');

    // Should log warning and return null, not throw
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = loadConfig();
    expect(config).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('invalid JSON'));
    consoleSpy.mockRestore();
  });

  it('returns null when readFileSync throws', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = loadConfig();
    expect(config).toBeNull();
    consoleSpy.mockRestore();
  });

  it('returns empty object when config file is valid JSON but empty object', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('{}');

    const config = loadConfig();
    expect(config).toEqual({});
  });

  it('preserves all fields from config file', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(
      JSON.stringify({
        token: 'tok_test',
        handle: 'testuser',
        userId: 'usr_1',
        extraField: 'bonus',
      }),
    );

    const config = loadConfig();
    expect(config.token).toBe('tok_test');
    expect(config.handle).toBe('testuser');
    expect(config.extraField).toBe('bonus');
  });
});
