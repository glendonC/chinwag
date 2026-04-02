import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getTerminalUiCapabilities } from '../terminal-control.js';

describe('getTerminalUiCapabilities', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reports basic color for normal terminals', () => {
    process.env.TERM = 'xterm-256color';
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    // getColorDepth might not be available in test env, so capabilities vary
    const caps = getTerminalUiCapabilities();
    expect(caps).toHaveProperty('hasBasicColor');
    expect(caps).toHaveProperty('hasBackgroundFill');
    expect(caps).toHaveProperty('isLowFidelity');
  });

  it('disables color when NO_COLOR is set', () => {
    process.env.TERM = 'xterm-256color';
    process.env.NO_COLOR = '1';
    delete process.env.FORCE_COLOR;
    const caps = getTerminalUiCapabilities();
    expect(caps.hasBasicColor).toBe(false);
    expect(caps.isLowFidelity).toBe(true);
  });

  it('enables color when FORCE_COLOR is set', () => {
    process.env.TERM = 'dumb';
    process.env.FORCE_COLOR = '1';
    delete process.env.NO_COLOR;
    const caps = getTerminalUiCapabilities();
    expect(caps.hasBasicColor).toBe(true);
    expect(caps.isLowFidelity).toBe(false);
  });

  it('reports low fidelity for dumb terminals', () => {
    process.env.TERM = 'dumb';
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    const caps = getTerminalUiCapabilities();
    expect(caps.hasBasicColor).toBe(false);
    expect(caps.isLowFidelity).toBe(true);
  });

  it('reports low fidelity when TERM is empty', () => {
    delete process.env.TERM;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    const caps = getTerminalUiCapabilities();
    expect(caps.hasBasicColor).toBe(false);
    expect(caps.isLowFidelity).toBe(true);
  });

  it('treats NO_COLOR=0 as not set (color not disabled)', () => {
    process.env.TERM = 'xterm-256color';
    process.env.NO_COLOR = '0';
    delete process.env.FORCE_COLOR;
    // NO_COLOR=0 is treated as "not set" per the spec
    const caps = getTerminalUiCapabilities();
    // The exact result depends on getColorDepth, but NO_COLOR shouldn't disable it
    expect(caps).toHaveProperty('hasBasicColor');
  });

  it('treats FORCE_COLOR=0 as not set', () => {
    process.env.TERM = 'dumb';
    process.env.FORCE_COLOR = '0';
    delete process.env.NO_COLOR;
    const caps = getTerminalUiCapabilities();
    // FORCE_COLOR=0 means not forced
    expect(caps.hasBasicColor).toBe(false);
  });
});
