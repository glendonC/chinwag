import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

import { configExists, loadConfig, CONFIG_DIR, CONFIG_FILE } from '../config.js';
import { existsSync, readFileSync } from 'fs';

describe('config', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('CONFIG_DIR and CONFIG_FILE', () => {
    it('CONFIG_DIR points to ~/.chinwag', () => {
      expect(CONFIG_DIR).toBe('/home/testuser/.chinwag');
    });

    it('CONFIG_FILE points to ~/.chinwag/config.json', () => {
      expect(CONFIG_FILE).toBe('/home/testuser/.chinwag/config.json');
    });
  });

  describe('configExists', () => {
    it('returns true when config file exists', () => {
      existsSync.mockReturnValue(true);
      expect(configExists()).toBe(true);
    });

    it('returns false when config file does not exist', () => {
      existsSync.mockReturnValue(false);
      expect(configExists()).toBe(false);
    });
  });

  describe('loadConfig', () => {
    it('returns null when config file does not exist', () => {
      existsSync.mockReturnValue(false);
      expect(loadConfig()).toBeNull();
    });

    it('returns parsed config when file exists and is valid JSON', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({
        token: 'test-token',
        handle: 'alice',
      }));
      const config = loadConfig();
      expect(config).toEqual({ token: 'test-token', handle: 'alice' });
    });

    it('returns null when file is corrupted (invalid JSON)', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('not json!!!');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const config = loadConfig();
      expect(config).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('corrupted'));
      consoleSpy.mockRestore();
    });

    it('returns empty object when file contains valid JSON empty object', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('{}');
      expect(loadConfig()).toEqual({});
    });

    it('returns array when file contains valid JSON array', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('[1,2,3]');
      expect(loadConfig()).toEqual([1, 2, 3]);
    });

    it('handles readFileSync throwing an error', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockImplementation(() => { throw new Error('EACCES'); });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(loadConfig()).toBeNull();
      consoleSpy.mockRestore();
    });
  });
});
