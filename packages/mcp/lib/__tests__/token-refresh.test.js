import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('@chinwag/shared/api-client.js', () => ({
  createJsonApiClient: vi.fn(),
}));

vi.mock('@chinwag/shared/config.js', () => ({
  CONFIG_DIR: '/home/user/.chinwag',
  CONFIG_FILE: '/home/user/.chinwag/config.json',
}));

import { mkdirSync, writeFileSync } from 'fs';
import { createJsonApiClient } from '@chinwag/shared/api-client.js';
import { CONFIG_DIR, CONFIG_FILE } from '@chinwag/shared/config.js';
import { refreshAndPersistToken } from '../token-refresh.js';

describe('refreshAndPersistToken', () => {
  let mockPost;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPost = vi.fn();
    createJsonApiClient.mockReturnValue({ post: mockPost });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Successful refresh ---

  it('calls the refresh endpoint with the refresh token', async () => {
    mockPost.mockResolvedValue({
      token: 'new_access_token',
      refresh_token: 'new_refresh_token',
    });

    await refreshAndPersistToken('https://api.example.com', 'old_refresh_token', {});

    expect(createJsonApiClient).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      userAgent: 'chinwag-mcp/1.0',
    });
    expect(mockPost).toHaveBeenCalledWith('/auth/refresh', {
      refresh_token: 'old_refresh_token',
    });
  });

  it('returns the new token pair on success', async () => {
    mockPost.mockResolvedValue({
      token: 'new_access_token',
      refresh_token: 'new_refresh_token',
    });

    const result = await refreshAndPersistToken('https://api.example.com', 'old_refresh', {});

    expect(result).toEqual({
      token: 'new_access_token',
      refresh_token: 'new_refresh_token',
    });
  });

  it('persists the updated config to disk', async () => {
    mockPost.mockResolvedValue({
      token: 'new_tok',
      refresh_token: 'new_ref',
    });

    const currentConfig = { handle: 'alice', team_id: 't_abc', token: 'old_tok' };
    await refreshAndPersistToken('https://api.example.com', 'old_ref', currentConfig);

    expect(mkdirSync).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true, mode: 0o700 });
    expect(writeFileSync).toHaveBeenCalledWith(
      CONFIG_FILE,
      expect.stringContaining('"token": "new_tok"'),
      { mode: 0o600 },
    );
    // Verify the full JSON includes old config keys
    const writtenContent = writeFileSync.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent.trim());
    expect(parsed.handle).toBe('alice');
    expect(parsed.team_id).toBe('t_abc');
    expect(parsed.token).toBe('new_tok');
    expect(parsed.refresh_token).toBe('new_ref');
  });

  // --- Missing token in response ---

  it('returns null when response has no token', async () => {
    mockPost.mockResolvedValue({ refresh_token: 'ref_only' });

    const result = await refreshAndPersistToken('https://api.example.com', 'old_ref', {});

    expect(result).toBeNull();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('returns null when response token is empty string', async () => {
    mockPost.mockResolvedValue({ token: '', refresh_token: 'ref' });

    const result = await refreshAndPersistToken('https://api.example.com', 'old_ref', {});

    // Empty string is falsy, so !result.token is true -> returns null
    expect(result).toBeNull();
  });

  // --- Network / fetch failure ---

  it('returns null when fetch throws', async () => {
    mockPost.mockRejectedValue(new Error('Network timeout'));

    const result = await refreshAndPersistToken('https://api.example.com', 'old_ref', {});

    expect(result).toBeNull();
  });

  it('logs error message when fetch throws', async () => {
    mockPost.mockRejectedValue(new Error('Connection refused'));

    await refreshAndPersistToken('https://api.example.com', 'old_ref', {});

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Token refresh failed'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Connection refused'));
  });

  // --- Write failure ---

  it('still returns the token when writeFileSync throws', async () => {
    mockPost.mockResolvedValue({
      token: 'good_tok',
      refresh_token: 'good_ref',
    });
    writeFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const result = await refreshAndPersistToken('https://api.example.com', 'old_ref', {});

    expect(result).toEqual({
      token: 'good_tok',
      refresh_token: 'good_ref',
    });
  });

  it('logs warning when write fails but does not throw', async () => {
    mockPost.mockResolvedValue({
      token: 'good_tok',
      refresh_token: 'good_ref',
    });
    writeFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    await refreshAndPersistToken('https://api.example.com', 'old_ref', {});

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not persist refreshed token'),
    );
  });

  it('still returns token when mkdirSync throws', async () => {
    mockPost.mockResolvedValue({
      token: 'tok',
      refresh_token: 'ref',
    });
    mkdirSync.mockImplementation(() => {
      throw new Error('ENOSPC');
    });

    const result = await refreshAndPersistToken('https://api.example.com', 'old_ref', {});

    // mkdirSync error is caught in the inner try
    expect(result).toEqual({ token: 'tok', refresh_token: 'ref' });
  });

  // --- Edge cases ---

  it('preserves existing config fields when writing', async () => {
    mockPost.mockResolvedValue({ token: 'new_t', refresh_token: 'new_r' });

    await refreshAndPersistToken('https://api.example.com', 'old_ref', {
      handle: 'bob',
      team_id: 't_xyz',
      custom_field: 42,
    });

    const writtenContent = writeFileSync.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent.trim());
    expect(parsed.handle).toBe('bob');
    expect(parsed.custom_field).toBe(42);
    expect(parsed.token).toBe('new_t');
  });

  it('logs success message after persisting', async () => {
    mockPost.mockResolvedValue({ token: 'tok', refresh_token: 'ref' });

    await refreshAndPersistToken('https://api.example.com', 'old_ref', {});

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Token refreshed successfully'),
    );
  });
});
