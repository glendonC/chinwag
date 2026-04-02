import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@chinwag/shared/config.js', () => ({
  CONFIG_DIR: '/tmp/test-chinwag',
  CONFIG_FILE: '/tmp/test-chinwag/config.json',
}));

import { validateConfig, registerProfile } from '../auth.js';

describe('validateConfig', () => {
  let exitSpy;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits with code 1 when config does not exist', async () => {
    await expect(
      validateConfig({
        configExists: () => false,
        loadConfig: () => null,
        api: vi.fn(),
      }),
    ).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No config found'));
  });

  it('exits with code 1 when config has no token', async () => {
    await expect(
      validateConfig({
        configExists: () => true,
        loadConfig: () => ({ handle: 'alice' }),
        api: vi.fn(),
      }),
    ).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('missing token'));
  });

  it('returns config when valid and token is active', async () => {
    const mockClient = { get: vi.fn().mockResolvedValue({ handle: 'alice' }) };
    const result = await validateConfig({
      configExists: () => true,
      loadConfig: () => ({ token: 'tok_abc', handle: 'alice' }),
      api: vi.fn().mockReturnValue(mockClient),
    });
    expect(result.config).toEqual({ token: 'tok_abc', handle: 'alice' });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('refreshes token on 401 when refresh_token is available', async () => {
    const err401 = new Error('Unauthorized');
    err401.status = 401;
    const mockClient = {
      get: vi.fn().mockRejectedValue(err401),
      post: vi.fn().mockResolvedValue({ token: 'tok_new', refresh_token: 'rt_new' }),
    };
    const result = await validateConfig({
      configExists: () => true,
      loadConfig: () => ({ token: 'tok_old', refresh_token: 'rt_old', handle: 'alice' }),
      api: vi.fn().mockReturnValue(mockClient),
    });
    expect(result.config.token).toBe('tok_new');
    expect(result.config.refresh_token).toBe('rt_new');
  });

  it('exits on 401 with no refresh token', async () => {
    const err401 = new Error('Unauthorized');
    err401.status = 401;
    const mockClient = { get: vi.fn().mockRejectedValue(err401) };
    await expect(
      validateConfig({
        configExists: () => true,
        loadConfig: () => ({ token: 'tok_expired', handle: 'alice' }),
        api: vi.fn().mockReturnValue(mockClient),
      }),
    ).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('proceeds on non-401 errors (temporary network issue)', async () => {
    const err500 = new Error('Server error');
    err500.status = 500;
    const mockClient = { get: vi.fn().mockRejectedValue(err500) };
    const result = await validateConfig({
      configExists: () => true,
      loadConfig: () => ({ token: 'tok_abc', handle: 'alice' }),
      api: vi.fn().mockReturnValue(mockClient),
    });
    expect(result.config.token).toBe('tok_abc');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('registerProfile', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls PUT /agent/profile with the profile data', async () => {
    const client = { put: vi.fn().mockResolvedValue({ ok: true }) };
    const profile = { languages: ['js'], frameworks: ['react'], tools: [] };

    await registerProfile(client, profile);

    expect(client.put).toHaveBeenCalledWith('/agent/profile', profile);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Profile registered: js, react'),
    );
  });

  it('logs error but does not throw on API failure', async () => {
    const client = { put: vi.fn().mockRejectedValue(new Error('Network error')) };
    const profile = { languages: [], frameworks: [], tools: [] };

    await registerProfile(client, profile);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to register profile'),
      'Network error',
    );
  });

  it('shows "no stack detected" when profile is empty', async () => {
    const client = { put: vi.fn().mockResolvedValue({ ok: true }) };
    const profile = { languages: [], frameworks: [], tools: [] };

    await registerProfile(client, profile);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no stack detected'));
  });
});
