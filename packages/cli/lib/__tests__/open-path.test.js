import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock execFileSync before importing the module
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

import { openPath } from '../open-path.js';
import { execFileSync } from 'child_process';

describe('openPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error for null/undefined path', () => {
    expect(openPath(null)).toEqual({ ok: false, error: 'Missing path' });
    expect(openPath(undefined)).toEqual({ ok: false, error: 'Missing path' });
    expect(openPath('')).toEqual({ ok: false, error: 'Missing path' });
  });

  it('opens path on macOS', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    const result = openPath('/some/path');

    expect(result).toEqual({ ok: true });
    expect(execFileSync).toHaveBeenCalledWith(
      'open',
      ['/some/path'],
      expect.objectContaining({ stdio: 'ignore' }),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('opens path on Linux', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const result = openPath('/some/path');

    expect(result).toEqual({ ok: true });
    expect(execFileSync).toHaveBeenCalledWith(
      'xdg-open',
      ['/some/path'],
      expect.objectContaining({ stdio: 'ignore' }),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('opens path on Windows', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const result = openPath('/some/path');

    expect(result).toEqual({ ok: true });
    expect(execFileSync).toHaveBeenCalledWith(
      'cmd',
      ['/c', 'start', '', '/some/path'],
      expect.objectContaining({ stdio: 'ignore' }),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns error for unsupported platform', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });

    const result = openPath('/some/path');

    expect(result).toEqual({ ok: false, error: 'Unsupported platform' });

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns error when command fails', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    const result = openPath('/some/path');

    expect(result).toEqual({ ok: false, error: 'spawn failed' });
  });

  it('returns fallback error when exception has no message', () => {
    execFileSync.mockImplementation(() => {
      throw {};
    });

    const result = openPath('/some/path');

    expect(result).toEqual({ ok: false, error: 'Could not open path' });
  });
});
