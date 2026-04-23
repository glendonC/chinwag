import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { readProcessInfo, getProcessTtyPath, getProcessCommandString } from '../process-utils.js';
import { EXEC_TIMEOUT_MS } from '../constants.js';
import { execFileSync } from 'node:child_process';

describe('process-utils', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    delete process.env.CHINMEISTER_DEBUG;
  });

  // ---------------------------------------------------------------------------
  // readProcessInfo
  // ---------------------------------------------------------------------------
  describe('readProcessInfo', () => {
    it('returns {ppid, command} on valid ps output', () => {
      execFileSync.mockReturnValue('  1234 /usr/bin/node index.js\n');

      const result = readProcessInfo(42);
      expect(result).toEqual({ ppid: 1234, command: '/usr/bin/node index.js' });
      expect(execFileSync).toHaveBeenCalledWith('ps', ['-o', 'ppid=,command=', '-p', '42'], {
        encoding: 'utf-8',
        timeout: EXEC_TIMEOUT_MS,
      });
    });

    it('parses ppid with no leading whitespace', () => {
      execFileSync.mockReturnValue('1 /sbin/launchd');

      const result = readProcessInfo(1);
      expect(result).toEqual({ ppid: 1, command: '/sbin/launchd' });
    });

    it('handles command strings containing spaces and special characters', () => {
      execFileSync.mockReturnValue('  500 /usr/bin/node --flag=true /path/to my app/index.js');

      const result = readProcessInfo(99);
      expect(result).toEqual({
        ppid: 500,
        command: '/usr/bin/node --flag=true /path/to my app/index.js',
      });
    });

    it('handles multiline command output (command with newlines)', () => {
      execFileSync.mockReturnValue('  100 some-command\nwith extra lines');

      const result = readProcessInfo(10);
      expect(result).toEqual({
        ppid: 100,
        command: 'some-command\nwith extra lines',
      });
    });

    it('returns null when pid is 0', () => {
      const result = readProcessInfo(0);
      expect(result).toBeNull();
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it('returns null when pid is negative', () => {
      const result = readProcessInfo(-1);
      expect(result).toBeNull();
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it('returns null when pid is NaN', () => {
      const result = readProcessInfo(NaN);
      expect(result).toBeNull();
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it('returns null when pid is undefined (falsy)', () => {
      const result = readProcessInfo(undefined);
      expect(result).toBeNull();
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it('returns null on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const result = readProcessInfo(42);
      expect(result).toBeNull();
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it('returns null when ps returns empty output', () => {
      execFileSync.mockReturnValue('   \n');

      const result = readProcessInfo(42);
      expect(result).toBeNull();
    });

    it('returns null when ps output does not match expected format', () => {
      execFileSync.mockReturnValue('garbage output no numbers');

      const result = readProcessInfo(42);
      expect(result).toBeNull();
    });

    it('returns null when ps output is just a number with no command', () => {
      execFileSync.mockReturnValue('1234');
      // The regex requires at least one space between ppid and command
      const result = readProcessInfo(42);
      expect(result).toBeNull();
    });

    it('returns null when execFileSync throws (process not found)', () => {
      execFileSync.mockImplementation(() => {
        throw new Error('Command failed: ps');
      });

      const result = readProcessInfo(42);
      expect(result).toBeNull();
    });

    it('logs debug info when CHINMEISTER_DEBUG is set and ps fails', () => {
      process.env.CHINMEISTER_DEBUG = '1';
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      execFileSync.mockImplementation(() => {
        throw new Error('ps failed');
      });

      readProcessInfo(42);

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('readProcessInfo(42) failed: ps failed'),
      );
      spy.mockRestore();
    });

    it('does not log when CHINMEISTER_DEBUG is not set and ps fails', () => {
      delete process.env.CHINMEISTER_DEBUG;
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      execFileSync.mockImplementation(() => {
        throw new Error('ps failed');
      });

      readProcessInfo(42);

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('works on non-win32 platforms (linux)', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      execFileSync.mockReturnValue('  1 /bin/bash');

      const result = readProcessInfo(55);
      expect(result).toEqual({ ppid: 1, command: '/bin/bash' });
    });

    it('works on darwin platform', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      execFileSync.mockReturnValue('  100 /usr/bin/zsh');

      const result = readProcessInfo(1);
      expect(result).toEqual({ ppid: 100, command: '/usr/bin/zsh' });
    });

    it('converts pid to string when calling ps', () => {
      execFileSync.mockReturnValue('  1 /bin/sh');

      readProcessInfo(999);
      expect(execFileSync).toHaveBeenCalledWith(
        'ps',
        ['-o', 'ppid=,command=', '-p', '999'],
        expect.any(Object),
      );
    });

    it('uses the shared EXEC_TIMEOUT_MS for execFileSync', () => {
      execFileSync.mockReturnValue('  1 /bin/sh');

      readProcessInfo(1);
      expect(execFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ timeout: EXEC_TIMEOUT_MS }),
      );
    });

    it('handles large ppid numbers', () => {
      execFileSync.mockReturnValue('  999999 /usr/bin/node');

      const result = readProcessInfo(1);
      expect(result).toEqual({ ppid: 999999, command: '/usr/bin/node' });
    });
  });

  // ---------------------------------------------------------------------------
  // getProcessTtyPath
  // ---------------------------------------------------------------------------
  describe('getProcessTtyPath', () => {
    it('returns /dev/<tty> when ps reports a tty', () => {
      execFileSync.mockReturnValue('ttys003\n');

      const result = getProcessTtyPath(42);
      expect(result).toBe('/dev/ttys003');
      expect(execFileSync).toHaveBeenCalledWith('ps', ['-o', 'tty=', '-p', '42'], {
        encoding: 'utf-8',
        timeout: EXEC_TIMEOUT_MS,
      });
    });

    it('returns null when tty is "??" (no controlling terminal)', () => {
      execFileSync.mockReturnValue('??');

      const result = getProcessTtyPath(42);
      expect(result).toBeNull();
    });

    it('returns null when tty is "?" (no controlling terminal)', () => {
      execFileSync.mockReturnValue('?');

      const result = getProcessTtyPath(42);
      expect(result).toBeNull();
    });

    it('returns null when tty output is empty', () => {
      execFileSync.mockReturnValue('   \n');

      const result = getProcessTtyPath(42);
      expect(result).toBeNull();
    });

    it('returns null when tty output is just whitespace', () => {
      execFileSync.mockReturnValue('  ');

      const result = getProcessTtyPath(42);
      expect(result).toBeNull();
    });

    it('returns null when execFileSync throws', () => {
      execFileSync.mockImplementation(() => {
        throw new Error('ps failed');
      });

      const result = getProcessTtyPath(42);
      expect(result).toBeNull();
    });

    it('handles pts-style tty names (Linux)', () => {
      execFileSync.mockReturnValue('pts/0\n');

      const result = getProcessTtyPath(42);
      expect(result).toBe('/dev/pts/0');
    });

    it('handles pts with higher numbers', () => {
      execFileSync.mockReturnValue('pts/42\n');

      const result = getProcessTtyPath(100);
      expect(result).toBe('/dev/pts/42');
    });

    it('trims whitespace from tty name', () => {
      execFileSync.mockReturnValue('  ttys005  \n');

      const result = getProcessTtyPath(1);
      expect(result).toBe('/dev/ttys005');
    });

    it('logs debug info when CHINMEISTER_DEBUG is set and ps fails', () => {
      process.env.CHINMEISTER_DEBUG = '1';
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      execFileSync.mockImplementation(() => {
        throw new Error('tty lookup failed');
      });

      getProcessTtyPath(99);

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('getProcessTtyPath(99) failed: tty lookup failed'),
      );
      spy.mockRestore();
    });

    it('does not log when CHINMEISTER_DEBUG is not set and ps fails', () => {
      delete process.env.CHINMEISTER_DEBUG;
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      execFileSync.mockImplementation(() => {
        throw new Error('tty lookup failed');
      });

      getProcessTtyPath(99);

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // getProcessCommandString
  // ---------------------------------------------------------------------------
  describe('getProcessCommandString', () => {
    it('returns the trimmed command string on success', () => {
      execFileSync.mockReturnValue('  /usr/bin/node server.js  \n');

      const result = getProcessCommandString(42);
      expect(result).toBe('/usr/bin/node server.js');
      expect(execFileSync).toHaveBeenCalledWith('ps', ['-o', 'command=', '-p', '42'], {
        encoding: 'utf-8',
        timeout: EXEC_TIMEOUT_MS,
      });
    });

    it('returns an empty string when ps returns only whitespace', () => {
      execFileSync.mockReturnValue('  \n');

      const result = getProcessCommandString(42);
      expect(result).toBe('');
    });

    it('returns null when execFileSync throws (process not found)', () => {
      execFileSync.mockImplementation(() => {
        throw new Error('Command failed: ps');
      });

      const result = getProcessCommandString(42);
      expect(result).toBeNull();
    });

    it('handles commands with complex arguments', () => {
      execFileSync.mockReturnValue(
        '/usr/bin/python3 -u script.py --config=/etc/app.conf --verbose',
      );

      const result = getProcessCommandString(100);
      expect(result).toBe('/usr/bin/python3 -u script.py --config=/etc/app.conf --verbose');
    });

    it('handles command strings with equals signs and quotes', () => {
      execFileSync.mockReturnValue('node --max-old-space-size=4096 app.js');

      const result = getProcessCommandString(200);
      expect(result).toBe('node --max-old-space-size=4096 app.js');
    });

    it('logs debug info when CHINMEISTER_DEBUG is set and ps fails', () => {
      process.env.CHINMEISTER_DEBUG = '1';
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      execFileSync.mockImplementation(() => {
        throw new Error('command lookup failed');
      });

      getProcessCommandString(77);

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('getProcessCommandString(77) failed: command lookup failed'),
      );
      spy.mockRestore();
    });

    it('does not log when CHINMEISTER_DEBUG is not set and ps fails', () => {
      delete process.env.CHINMEISTER_DEBUG;
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      execFileSync.mockImplementation(() => {
        throw new Error('command lookup failed');
      });

      getProcessCommandString(77);

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('handles non-Error thrown values in debug log', () => {
      process.env.CHINMEISTER_DEBUG = '1';
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      execFileSync.mockImplementation(() => {
        throw 'string error';
      });

      getProcessCommandString(5);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('string error'));
      spy.mockRestore();
    });

    it('uses the shared EXEC_TIMEOUT_MS', () => {
      execFileSync.mockReturnValue('cmd');

      getProcessCommandString(1);
      expect(execFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ timeout: EXEC_TIMEOUT_MS }),
      );
    });
  });
});
