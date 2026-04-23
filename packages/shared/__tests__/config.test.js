import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

import {
  CONFIG_DIR,
  CONFIG_FILE,
  LOCAL_CONFIG_DIR,
  LOCAL_CONFIG_FILE,
  validateConfigShape,
  getConfigPaths,
  configExists,
  loadConfig,
  saveConfig,
  deleteConfig,
} from '../config.js';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

describe('config', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ---------------------------------------------------------------------------
  // validateConfigShape
  // ---------------------------------------------------------------------------
  describe('validateConfigShape', () => {
    it('returns null for valid config with all string fields', () => {
      expect(
        validateConfigShape({
          token: 'tok_abc',
          refresh_token: 'ref_123',
          handle: 'alice',
          userId: 'user_1',
          color: 'cyan',
        }),
      ).toBeNull();
    });

    it('returns null for an empty object (all fields optional)', () => {
      expect(validateConfigShape({})).toBeNull();
    });

    it('returns null for config with extra unknown fields', () => {
      expect(validateConfigShape({ token: 'tok', customField: 42 })).toBeNull();
    });

    it('allows undefined values for known fields (field present but undefined)', () => {
      expect(validateConfigShape({ token: undefined })).toBeNull();
    });

    it('returns error when token is a number', () => {
      const result = validateConfigShape({ token: 123 });
      expect(result).toContain('"token" must be a string');
      expect(result).toContain('got number');
    });

    it('returns error when handle is a boolean', () => {
      expect(validateConfigShape({ handle: true })).toContain('"handle" must be a string');
    });

    it('returns error when color is an array', () => {
      expect(validateConfigShape({ color: [] })).toContain('"color" must be a string');
    });

    it('returns error when refresh_token is a number', () => {
      expect(validateConfigShape({ refresh_token: 42 })).toContain(
        '"refresh_token" must be a string',
      );
    });

    it('returns error when userId is an object', () => {
      expect(validateConfigShape({ userId: {} })).toContain('"userId" must be a string');
    });

    it('reports the first invalid field encountered', () => {
      // When multiple fields are invalid, only the first one hit in iteration order is reported
      const result = validateConfigShape({ token: 123, handle: true });
      expect(result).not.toBeNull();
    });

    it('returns error for an array value', () => {
      const result = validateConfigShape([1, 2, 3]);
      expect(result).toContain('array');
    });

    it('returns error for null', () => {
      const result = validateConfigShape(null);
      expect(result).toContain('object');
    });

    it('returns error for a string primitive', () => {
      const result = validateConfigShape('not an object');
      expect(result).toContain('string');
    });

    it('returns error for a number primitive', () => {
      const result = validateConfigShape(42);
      expect(result).toContain('number');
    });

    it('returns error for undefined', () => {
      const result = validateConfigShape(undefined);
      expect(result).toContain('undefined');
    });

    it('returns error for a boolean primitive', () => {
      const result = validateConfigShape(true);
      expect(result).toContain('boolean');
    });

    it('returns null when only extra keys are present', () => {
      expect(validateConfigShape({ foo: 42, bar: [1, 2] })).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // CONFIG_DIR / CONFIG_FILE constants
  // ---------------------------------------------------------------------------
  describe('CONFIG_DIR and CONFIG_FILE', () => {
    it('CONFIG_DIR points to ~/.chinmeister', () => {
      expect(CONFIG_DIR).toBe('/home/testuser/.chinmeister');
    });

    it('CONFIG_FILE points to ~/.chinmeister/config.json', () => {
      expect(CONFIG_FILE).toBe('/home/testuser/.chinmeister/config.json');
    });

    it('LOCAL_CONFIG_DIR points to ~/.chinmeister/local', () => {
      expect(LOCAL_CONFIG_DIR).toBe('/home/testuser/.chinmeister/local');
    });

    it('LOCAL_CONFIG_FILE points to ~/.chinmeister/local/config.json', () => {
      expect(LOCAL_CONFIG_FILE).toBe('/home/testuser/.chinmeister/local/config.json');
    });
  });

  // ---------------------------------------------------------------------------
  // getConfigPaths
  // ---------------------------------------------------------------------------
  describe('getConfigPaths', () => {
    it('defaults to the production config path', () => {
      expect(getConfigPaths()).toEqual({
        profile: 'prod',
        configDir: CONFIG_DIR,
        configFile: CONFIG_FILE,
      });
    });

    it('uses the local config path when CHINMEISTER_PROFILE=local', () => {
      vi.stubEnv('CHINMEISTER_PROFILE', 'local');
      expect(getConfigPaths()).toEqual({
        profile: 'local',
        configDir: LOCAL_CONFIG_DIR,
        configFile: LOCAL_CONFIG_FILE,
      });
    });

    it('infers the local config path from a loopback API override', () => {
      vi.stubEnv('CHINMEISTER_API_URL', 'http://localhost:8787');
      expect(getConfigPaths()).toEqual({
        profile: 'local',
        configDir: LOCAL_CONFIG_DIR,
        configFile: LOCAL_CONFIG_FILE,
      });
    });

    it('infers local from CHINMEISTER_DASHBOARD_URL pointing to loopback', () => {
      vi.stubEnv('CHINMEISTER_DASHBOARD_URL', 'http://localhost:56790/dashboard.html');
      expect(getConfigPaths().profile).toBe('local');
    });

    it('infers local from CHINMEISTER_WS_URL pointing to loopback', () => {
      vi.stubEnv('CHINMEISTER_WS_URL', 'ws://localhost:8787/ws/chat');
      expect(getConfigPaths().profile).toBe('local');
    });

    it('allows callers to override the profile explicitly', () => {
      expect(getConfigPaths({ profile: 'local' }).configFile).toBe(LOCAL_CONFIG_FILE);
      expect(getConfigPaths({ profile: 'prod' }).configFile).toBe(CONFIG_FILE);
    });

    it('explicit profile option takes precedence over env vars', () => {
      vi.stubEnv('CHINMEISTER_PROFILE', 'local');
      expect(getConfigPaths({ profile: 'prod' }).profile).toBe('prod');
    });

    it('accepts development as a profile alias for local', () => {
      expect(getConfigPaths({ profile: 'development' }).profile).toBe('local');
    });

    it('accepts production as a profile alias for prod', () => {
      expect(getConfigPaths({ profile: 'production' }).profile).toBe('prod');
    });

    it('falls back to prod for unrecognized profile strings', () => {
      expect(getConfigPaths({ profile: 'staging' }).profile).toBe('prod');
    });

    it('accepts apiUrl option to infer local profile', () => {
      expect(getConfigPaths({ apiUrl: 'http://127.0.0.1:8787' }).profile).toBe('local');
    });

    it('returns prod when apiUrl is a remote URL', () => {
      expect(getConfigPaths({ apiUrl: 'https://example.com' }).profile).toBe('prod');
    });
  });

  // ---------------------------------------------------------------------------
  // configExists
  // ---------------------------------------------------------------------------
  describe('configExists', () => {
    it('returns true when config file exists', () => {
      existsSync.mockReturnValue(true);
      expect(configExists()).toBe(true);
    });

    it('returns false when config file does not exist', () => {
      existsSync.mockReturnValue(false);
      expect(configExists()).toBe(false);
    });

    it('checks the local config file when profile is local', () => {
      existsSync.mockReturnValue(true);
      configExists({ profile: 'local' });
      expect(existsSync).toHaveBeenCalledWith(LOCAL_CONFIG_FILE);
    });

    it('checks the prod config file by default', () => {
      existsSync.mockReturnValue(false);
      configExists();
      expect(existsSync).toHaveBeenCalledWith(CONFIG_FILE);
    });
  });

  // ---------------------------------------------------------------------------
  // loadConfig
  // ---------------------------------------------------------------------------
  describe('loadConfig', () => {
    it('returns null when config file does not exist', () => {
      existsSync.mockReturnValue(false);
      expect(loadConfig()).toBeNull();
    });

    it('returns parsed config when file exists and is valid JSON', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(
        JSON.stringify({
          token: 'test-token',
          refresh_token: 'refresh-test-token',
          handle: 'alice',
        }),
      );
      const config = loadConfig();
      expect(config).toEqual({
        token: 'test-token',
        refresh_token: 'refresh-test-token',
        handle: 'alice',
      });
    });

    it('returns null when file is corrupted (invalid JSON)', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('not json!!!');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const config = loadConfig();
      expect(config).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('invalid JSON'));
      consoleSpy.mockRestore();
    });

    it('includes a content preview in the JSON error log', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('broken{');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      loadConfig();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Content preview'));
      consoleSpy.mockRestore();
    });

    it('truncates long content in the JSON error preview', () => {
      existsSync.mockReturnValue(true);
      const longContent = 'x'.repeat(200);
      readFileSync.mockReturnValue(longContent);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      loadConfig();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('...'));
      consoleSpy.mockRestore();
    });

    it('returns empty object when file contains valid JSON empty object', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('{}');
      expect(loadConfig()).toEqual({});
    });

    it('returns null when file contains a JSON array', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('[1,2,3]');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(loadConfig()).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('invalid shape'));
      consoleSpy.mockRestore();
    });

    it('returns null when a known field has the wrong type', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ token: 123 }));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(loadConfig()).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"token" must be a string'));
      consoleSpy.mockRestore();
    });

    it('handles readFileSync throwing an error', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockImplementation(() => {
        throw new Error('EACCES');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(loadConfig()).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
      consoleSpy.mockRestore();
    });

    it('reads from the local config file when profile is local', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ handle: 'local_user' }));
      const config = loadConfig({ profile: 'local' });
      expect(readFileSync).toHaveBeenCalledWith(LOCAL_CONFIG_FILE, 'utf-8');
      expect(config).toEqual({ handle: 'local_user' });
    });

    it('returns config with unknown extra fields preserved', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ token: 'tok', extra: { nested: true } }));
      const config = loadConfig();
      expect(config.token).toBe('tok');
      expect(config.extra).toEqual({ nested: true });
    });

    it('returns null when JSON is a string primitive', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('"just a string"');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(loadConfig()).toBeNull();
      consoleSpy.mockRestore();
    });

    it('returns null when JSON is a number', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('42');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(loadConfig()).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // saveConfig
  // ---------------------------------------------------------------------------
  describe('saveConfig', () => {
    it('writes to the local config path when the local profile is active', () => {
      vi.stubEnv('CHINMEISTER_PROFILE', 'local');

      saveConfig({ token: 'tok_local' });

      expect(mkdirSync).toHaveBeenCalledWith(LOCAL_CONFIG_DIR, { recursive: true, mode: 0o700 });
      expect(writeFileSync).toHaveBeenCalledWith(
        LOCAL_CONFIG_FILE,
        expect.stringContaining('"token": "tok_local"'),
        { mode: 0o600 },
      );
    });

    it('writes to the default config path in production profile', () => {
      saveConfig({ token: 'tok_prod', handle: 'alice' });

      expect(mkdirSync).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true, mode: 0o700 });
      expect(writeFileSync).toHaveBeenCalledWith(
        CONFIG_FILE,
        expect.stringContaining('"token": "tok_prod"'),
        { mode: 0o600 },
      );
    });

    it('creates directory with 0o700 permissions', () => {
      saveConfig({ token: 'tok' });
      expect(mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ mode: 0o700 }),
      );
    });

    it('writes file with 0o600 permissions', () => {
      saveConfig({ token: 'tok' });
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ mode: 0o600 }),
      );
    });

    it('includes trailing newline in written content', () => {
      saveConfig({ handle: 'bob' });
      const writtenContent = writeFileSync.mock.calls[0][1];
      expect(writtenContent).toMatch(/\n$/);
    });

    it('serializes config as pretty-printed JSON', () => {
      saveConfig({ token: 'tok', handle: 'alice' });
      const writtenContent = writeFileSync.mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed).toEqual({ token: 'tok', handle: 'alice' });
      // Verify indentation (2 spaces)
      expect(writtenContent).toContain('  "token"');
    });

    it('writes to local path when explicit local profile option is used', () => {
      saveConfig({ token: 'tok' }, { profile: 'local' });
      expect(mkdirSync).toHaveBeenCalledWith(LOCAL_CONFIG_DIR, { recursive: true, mode: 0o700 });
    });

    it('writes an empty config object', () => {
      saveConfig({});
      const writtenContent = writeFileSync.mock.calls[0][1];
      expect(JSON.parse(writtenContent)).toEqual({});
    });

    it('preserves extra unknown fields', () => {
      saveConfig({ token: 'tok', customData: { nested: true } });
      const writtenContent = writeFileSync.mock.calls[0][1];
      expect(JSON.parse(writtenContent).customData).toEqual({ nested: true });
    });
  });

  // ---------------------------------------------------------------------------
  // deleteConfig
  // ---------------------------------------------------------------------------
  describe('deleteConfig', () => {
    it('deletes from the active config path', () => {
      vi.stubEnv('CHINMEISTER_PROFILE', 'local');
      existsSync.mockReturnValue(true);

      deleteConfig();

      expect(unlinkSync).toHaveBeenCalledWith(LOCAL_CONFIG_FILE);
    });

    it('does nothing when config file does not exist', () => {
      existsSync.mockReturnValue(false);

      deleteConfig();

      expect(unlinkSync).not.toHaveBeenCalled();
    });

    it('deletes the default config file in production profile', () => {
      existsSync.mockReturnValue(true);

      deleteConfig();

      expect(unlinkSync).toHaveBeenCalledWith(CONFIG_FILE);
    });

    it('checks for existence of the correct file path', () => {
      existsSync.mockReturnValue(false);
      deleteConfig({ profile: 'local' });
      expect(existsSync).toHaveBeenCalledWith(LOCAL_CONFIG_FILE);
    });

    it('uses explicit profile option over env var', () => {
      vi.stubEnv('CHINMEISTER_PROFILE', 'local');
      existsSync.mockReturnValue(true);

      deleteConfig({ profile: 'prod' });

      expect(unlinkSync).toHaveBeenCalledWith(CONFIG_FILE);
    });
  });
});
