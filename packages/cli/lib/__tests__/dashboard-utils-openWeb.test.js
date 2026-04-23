import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process before importing
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

import { openWebDashboard, getDashboardUrl } from '../dashboard/utils.js';
import { execFileSync } from 'child_process';

describe('openWebDashboard', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('opens dashboard URL with token hash on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    const result = openWebDashboard('my-token');

    expect(result).toEqual({ ok: true });
    expect(execFileSync).toHaveBeenCalledWith(
      'open',
      [`${getDashboardUrl()}#token=my-token`],
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('opens dashboard URL without token hash when token is falsy', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    const result = openWebDashboard(null);

    expect(result).toEqual({ ok: true });
    expect(execFileSync).toHaveBeenCalledWith(
      'open',
      [getDashboardUrl()],
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('opens on Linux with xdg-open', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const result = openWebDashboard('tok');

    expect(result).toEqual({ ok: true });
    expect(execFileSync).toHaveBeenCalledWith(
      'xdg-open',
      expect.any(Array),
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('uses the local dashboard URL when the local profile is active', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    vi.stubEnv('CHINMEISTER_PROFILE', 'local');

    const result = openWebDashboard('tok');

    expect(result).toEqual({ ok: true });
    expect(execFileSync).toHaveBeenCalledWith(
      'open',
      ['http://localhost:56790/dashboard.html#token=tok'],
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('opens on Windows with cmd /c start', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const result = openWebDashboard('tok');

    expect(result).toEqual({ ok: true });
    expect(execFileSync).toHaveBeenCalledWith(
      'cmd',
      ['/c', 'start', '', expect.stringContaining('token=tok')],
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('returns error for unsupported platform', () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });

    const result = openWebDashboard('tok');

    expect(result).toEqual({ ok: false, error: 'Unsupported platform' });
  });

  it('returns error when command fails', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    execFileSync.mockImplementation(() => {
      throw new Error('open failed');
    });

    const result = openWebDashboard('tok');

    expect(result).toEqual({ ok: false, error: 'Could not open browser' });
  });
});
