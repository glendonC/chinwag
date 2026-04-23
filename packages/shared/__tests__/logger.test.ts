import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../logger.js';

describe('createLogger', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = process.env.CHINMEISTER_DEBUG;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.CHINMEISTER_DEBUG;
  });

  afterEach(() => {
    errorSpy.mockRestore();
    if (originalEnv !== undefined) {
      process.env.CHINMEISTER_DEBUG = originalEnv;
    } else {
      delete process.env.CHINMEISTER_DEBUG;
    }
  });

  // -------------------------------------------------------------------------
  // Normal mode (CHINMEISTER_DEBUG not set)
  // -------------------------------------------------------------------------

  describe('normal mode (CHINMEISTER_DEBUG not set)', () => {
    it('logs info with [chinmeister] prefix', () => {
      const log = createLogger('test');
      log.info('hello');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister] hello');
    });

    it('logs warn with [chinmeister] prefix', () => {
      const log = createLogger('test');
      log.warn('careful');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister] careful');
    });

    it('logs error with [chinmeister] prefix', () => {
      const log = createLogger('test');
      log.error('broken');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister] broken');
    });

    it('suppresses debug messages entirely', () => {
      const log = createLogger('test');
      log.debug('hidden');
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('ignores context parameter in normal mode', () => {
      const log = createLogger('test');
      log.info('msg', { key: 'val' });
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister] msg');
    });

    it('does not include source name in normal mode output', () => {
      const log = createLogger('mySpecialModule');
      log.info('test');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister] test');
    });

    it('does not include level tag in normal mode output', () => {
      const log = createLogger('src');
      log.warn('issue');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister] issue');
    });

    it('debug with context is still suppressed', () => {
      const log = createLogger('test');
      log.debug('trace', { depth: 3 });
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Debug mode (CHINMEISTER_DEBUG=1)
  // -------------------------------------------------------------------------

  describe('debug mode (CHINMEISTER_DEBUG=1)', () => {
    beforeEach(() => {
      process.env.CHINMEISTER_DEBUG = '1';
    });

    it('includes source tag in output', () => {
      const log = createLogger('myModule');
      log.info('event');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:myModule] event');
    });

    it('includes WARN level tag', () => {
      const log = createLogger('myModule');
      log.warn('something');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:myModule] WARN something');
    });

    it('includes ERROR level tag', () => {
      const log = createLogger('myModule');
      log.error('fail');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:myModule] ERROR fail');
    });

    it('includes DEBUG level tag', () => {
      const log = createLogger('myModule');
      log.debug('trace');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:myModule] DEBUG trace');
    });

    it('omits level tag for info (info is the default level)', () => {
      const log = createLogger('src');
      log.info('started');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:src] started');
    });

    it('includes context as JSON', () => {
      const log = createLogger('myModule');
      log.info('event', { key: 'val' });
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:myModule] event {"key":"val"}');
    });

    it('includes context with multiple keys', () => {
      const log = createLogger('src');
      log.warn('issue', { code: 42, msg: 'bad' });
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:src] WARN issue {"code":42,"msg":"bad"}');
    });

    it('omits context when it is an empty object', () => {
      const log = createLogger('src');
      log.info('clean', {});
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:src] clean');
    });

    it('omits context when undefined', () => {
      const log = createLogger('src');
      log.info('no ctx');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:src] no ctx');
    });

    it('shows debug messages in debug mode', () => {
      const log = createLogger('myModule');
      log.debug('trace');
      expect(errorSpy).toHaveBeenCalled();
    });

    it('includes context for debug level', () => {
      const log = createLogger('mod');
      log.debug('detail', { step: 1, ok: true });
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:mod] DEBUG detail {"step":1,"ok":true}');
    });

    it('includes context for error level', () => {
      const log = createLogger('mod');
      log.error('crash', { stack: 'trace' });
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:mod] ERROR crash {"stack":"trace"}');
    });

    it('works with any truthy CHINMEISTER_DEBUG value', () => {
      process.env.CHINMEISTER_DEBUG = 'true';
      const log = createLogger('test');
      log.debug('visible');
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Stdio safety: all levels use console.error, never console.log
  // -------------------------------------------------------------------------

  describe('stdio safety (never console.log)', () => {
    it('uses console.error for info, warn, error', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('test');
      log.info('msg');
      log.warn('msg');
      log.error('msg');
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(3);
      logSpy.mockRestore();
    });

    it('uses console.error for debug when in debug mode', () => {
      process.env.CHINMEISTER_DEBUG = '1';
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('test');
      log.debug('msg');
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      logSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Logger interface
  // -------------------------------------------------------------------------

  describe('logger interface', () => {
    it('returns an object with debug, info, warn, error methods', () => {
      const log = createLogger('test');
      expect(typeof log.debug).toBe('function');
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
    });

    it('different source names produce independent loggers', () => {
      process.env.CHINMEISTER_DEBUG = '1';
      const logA = createLogger('moduleA');
      const logB = createLogger('moduleB');
      logA.info('from A');
      logB.info('from B');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:moduleA] from A');
      expect(errorSpy).toHaveBeenCalledWith('[chinmeister:moduleB] from B');
    });
  });
});
