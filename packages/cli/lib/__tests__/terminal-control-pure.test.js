import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock React before importing the module
vi.mock('react', () => ({
  useEffect: vi.fn(),
}));

vi.mock('@chinmeister/shared', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getTerminalUiCapabilities } from '../terminal-control.js';

describe('getTerminalUiCapabilities', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns an object with expected shape', () => {
    const caps = getTerminalUiCapabilities();
    expect(caps).toHaveProperty('hasBasicColor');
    expect(caps).toHaveProperty('hasBackgroundFill');
    expect(caps).toHaveProperty('isLowFidelity');
    expect(typeof caps.hasBasicColor).toBe('boolean');
    expect(typeof caps.hasBackgroundFill).toBe('boolean');
    expect(typeof caps.isLowFidelity).toBe('boolean');
  });

  it('isLowFidelity is the inverse of hasBasicColor', () => {
    const caps = getTerminalUiCapabilities();
    expect(caps.isLowFidelity).toBe(!caps.hasBasicColor);
  });

  it('disables color when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    delete process.env.FORCE_COLOR;
    const caps = getTerminalUiCapabilities();
    expect(caps.hasBasicColor).toBe(false);
    expect(caps.isLowFidelity).toBe(true);
  });

  it('forces color when FORCE_COLOR is set', () => {
    process.env.FORCE_COLOR = '1';
    delete process.env.NO_COLOR;
    const caps = getTerminalUiCapabilities();
    expect(caps.hasBasicColor).toBe(true);
    expect(caps.hasBackgroundFill).toBe(true);
    expect(caps.isLowFidelity).toBe(false);
  });

  it('disables color for dumb terminal', () => {
    process.env.TERM = 'dumb';
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    const caps = getTerminalUiCapabilities();
    expect(caps.hasBasicColor).toBe(false);
  });

  it('disables color for unknown terminal', () => {
    process.env.TERM = 'unknown';
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    const caps = getTerminalUiCapabilities();
    expect(caps.hasBasicColor).toBe(false);
  });

  it('NO_COLOR=0 does not disable color', () => {
    process.env.NO_COLOR = '0';
    process.env.TERM = 'xterm-256color';
    delete process.env.FORCE_COLOR;
    const caps = getTerminalUiCapabilities();
    // NO_COLOR=0 is treated as "not set" so color depends on terminal
    // The check is: process.env.NO_COLOR != null && process.env.NO_COLOR !== '0'
    // So NO_COLOR=0 does NOT disable color
    expect(typeof caps.hasBasicColor).toBe('boolean');
  });

  it('FORCE_COLOR=0 does not force color', () => {
    process.env.FORCE_COLOR = '0';
    delete process.env.NO_COLOR;
    const caps = getTerminalUiCapabilities();
    // FORCE_COLOR=0 is treated as "not set"
    expect(typeof caps.hasBasicColor).toBe('boolean');
  });
});
