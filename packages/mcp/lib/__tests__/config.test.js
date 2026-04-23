import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sharedConfigMock } = vi.hoisted(() => ({
  sharedConfigMock: {
    getConfigPaths: vi.fn(() => ({
      profile: 'prod',
      configDir: '/home/testuser/.chinmeister',
      configFile: '/home/testuser/.chinmeister/config.json',
    })),
    configExists: vi.fn(() => true),
    loadConfig: vi.fn(() => ({ token: 'tok_test' })),
    saveConfig: vi.fn(),
  },
}));

vi.mock('@chinmeister/shared/config.js', () => sharedConfigMock);

import * as mcpConfig from '../config.js';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('mcp config module', () => {
  it('re-exports shared config helpers', () => {
    expect(mcpConfig.getConfigPaths).toBe(sharedConfigMock.getConfigPaths);
    expect(mcpConfig.configExists).toBe(sharedConfigMock.configExists);
    expect(mcpConfig.loadConfig).toBe(sharedConfigMock.loadConfig);
    expect(mcpConfig.saveConfig).toBe(sharedConfigMock.saveConfig);
  });
});
