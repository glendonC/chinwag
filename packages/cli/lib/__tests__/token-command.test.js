import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configExistsMock = vi.fn();
const getConfigPathsMock = vi.fn(() => ({
  profile: 'prod',
  configDir: '/home/testuser/.chinmeister',
  configFile: '/home/testuser/.chinmeister/config.json',
}));
const loadConfigMock = vi.fn();

vi.mock('../config.js', () => ({
  configExists: configExistsMock,
  getConfigPaths: getConfigPathsMock,
  loadConfig: loadConfigMock,
}));

describe('runToken', () => {
  const originalExit = process.exit;
  let stdoutWriteSpy;

  beforeEach(() => {
    vi.resetModules();
    configExistsMock.mockReset();
    getConfigPathsMock.mockReset();
    getConfigPathsMock.mockReturnValue({
      profile: 'prod',
      configDir: '/home/testuser/.chinmeister',
      configFile: '/home/testuser/.chinmeister/config.json',
    });
    loadConfigMock.mockReset();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exit = originalExit;
  });

  it('prints the active token to stdout', async () => {
    configExistsMock.mockReturnValue(true);
    loadConfigMock.mockReturnValue({ token: 'tok_print_me' });

    const { runToken } = await import('../commands/token.js');
    await runToken();

    expect(stdoutWriteSpy).toHaveBeenCalledWith('tok_print_me\n');
  });

  it('exits with a helpful message when the config is missing', async () => {
    configExistsMock.mockReturnValue(false);

    const { runToken } = await import('../commands/token.js');
    await expect(runToken()).rejects.toThrow('process.exit:1');
  });
});
