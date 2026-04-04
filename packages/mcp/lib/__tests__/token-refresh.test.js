import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@chinwag/shared/api-client.js', () => ({
  createJsonApiClient: vi.fn(),
}));

const { getConfigPathsMock, saveConfigMock } = vi.hoisted(() => ({
  getConfigPathsMock: vi.fn(() => ({
    profile: 'prod',
    configDir: '/home/user/.chinwag',
    configFile: '/home/user/.chinwag/config.json',
  })),
  saveConfigMock: vi.fn(),
}));

vi.mock('@chinwag/shared/config.js', () => ({
  getConfigPaths: getConfigPathsMock,
  saveConfig: saveConfigMock,
}));

import { createJsonApiClient } from '@chinwag/shared/api-client.js';
import { refreshAndPersistToken, _resetInflightRefresh } from '../token-refresh.js';

describe('refreshAndPersistToken', () => {
  let mockPost;

  beforeEach(() => {
    vi.resetAllMocks();
    _resetInflightRefresh();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPost = vi.fn();
    createJsonApiClient.mockReturnValue({ post: mockPost });
    getConfigPathsMock.mockReturnValue({
      profile: 'prod',
      configDir: '/home/user/.chinwag',
      configFile: '/home/user/.chinwag/config.json',
    });
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

    expect(saveConfigMock).toHaveBeenCalledWith({
      handle: 'alice',
      team_id: 't_abc',
      token: 'new_tok',
      refresh_token: 'new_ref',
    });
  });

  // --- Missing token in response ---

  it('returns null when response has no token', async () => {
    mockPost.mockResolvedValue({ refresh_token: 'ref_only' });

    const result = await refreshAndPersistToken('https://api.example.com', 'old_ref', {});

    expect(result).toBeNull();
    expect(saveConfigMock).not.toHaveBeenCalled();
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
    saveConfigMock.mockImplementation(() => {
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
    saveConfigMock.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    await refreshAndPersistToken('https://api.example.com', 'old_ref', {});

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('disk persist failed'));
  });

  // --- Edge cases ---

  it('preserves existing config fields when writing', async () => {
    mockPost.mockResolvedValue({ token: 'new_t', refresh_token: 'new_r' });

    await refreshAndPersistToken('https://api.example.com', 'old_ref', {
      handle: 'bob',
      team_id: 't_xyz',
      custom_field: 42,
    });

    expect(saveConfigMock).toHaveBeenCalledWith({
      handle: 'bob',
      team_id: 't_xyz',
      custom_field: 42,
      token: 'new_t',
      refresh_token: 'new_r',
    });
  });

  it('logs success message after persisting', async () => {
    mockPost.mockResolvedValue({ token: 'tok', refresh_token: 'ref' });

    await refreshAndPersistToken('https://api.example.com', 'old_ref', {});

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Token refreshed and persisted successfully'),
    );
  });

  // --- Concurrent refresh deduplication ---

  it('deduplicates concurrent refresh calls — only one API call is made', async () => {
    let resolvePost;
    mockPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );

    // Fire two concurrent refreshes
    const p1 = refreshAndPersistToken('https://api.example.com', 'rt_1', {});
    const p2 = refreshAndPersistToken('https://api.example.com', 'rt_2', {});

    // Resolve the single inflight POST
    resolvePost({ token: 'deduped_tok', refresh_token: 'deduped_ref' });

    const [r1, r2] = await Promise.all([p1, p2]);

    // Both callers get the same result
    expect(r1).toEqual({ token: 'deduped_tok', refresh_token: 'deduped_ref' });
    expect(r2).toEqual({ token: 'deduped_tok', refresh_token: 'deduped_ref' });

    // Only one API call was made
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('allows a new refresh after the inflight one completes', async () => {
    mockPost
      .mockResolvedValueOnce({ token: 'tok_1', refresh_token: 'ref_1' })
      .mockResolvedValueOnce({ token: 'tok_2', refresh_token: 'ref_2' });

    const r1 = await refreshAndPersistToken('https://api.example.com', 'rt_a', {});
    const r2 = await refreshAndPersistToken('https://api.example.com', 'rt_b', {});

    expect(r1).toEqual({ token: 'tok_1', refresh_token: 'ref_1' });
    expect(r2).toEqual({ token: 'tok_2', refresh_token: 'ref_2' });
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  // --- saveConfig failure preserves in-memory token ---

  it('returns token even when saveConfig fails and logs distinct warning', async () => {
    mockPost.mockResolvedValue({
      token: 'mem_tok',
      refresh_token: 'mem_ref',
    });
    saveConfigMock.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    const result = await refreshAndPersistToken('https://api.example.com', 'old_ref', {
      handle: 'alice',
    });

    // In-memory token is preserved
    expect(result).toEqual({ token: 'mem_tok', refresh_token: 'mem_ref' });

    // Warning distinguishes "refresh succeeded but persist failed"
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Token refresh succeeded but disk persist failed'),
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('in-memory token is valid'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ENOSPC'));

    // Does NOT log the generic "Token refresh failed" message
    const calls = console.error.mock.calls.map((c) => c[0]);
    expect(calls.every((msg) => !msg.includes('Token refresh failed'))).toBe(true);
  });
});
