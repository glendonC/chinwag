import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomicSync } from '../fs-atomic.js';

describe('writeFileAtomicSync', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `chinmeister-atomic-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('writes content to target path', () => {
    const target = join(dir, 'out.json');
    writeFileAtomicSync(target, '{"hello":"world"}');
    expect(readFileSync(target, 'utf-8')).toBe('{"hello":"world"}');
  });

  it('creates parent directory if missing', () => {
    const target = join(dir, 'nested', 'deep', 'out.json');
    writeFileAtomicSync(target, 'x');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('x');
  });

  it('replaces existing content atomically', () => {
    const target = join(dir, 'out.json');
    writeFileSync(target, 'old content');
    writeFileAtomicSync(target, 'new content');
    expect(readFileSync(target, 'utf-8')).toBe('new content');
  });

  it('does not leave tmp files after successful write', () => {
    const target = join(dir, 'out.json');
    writeFileAtomicSync(target, 'data');
    const leftover = readdirSync(dir).filter((f) => f.includes('.tmp'));
    expect(leftover).toEqual([]);
  });

  it('accepts Buffer input', () => {
    const target = join(dir, 'out.bin');
    writeFileAtomicSync(target, Buffer.from([0x01, 0x02, 0x03]));
    const data = readFileSync(target);
    expect(Array.from(data)).toEqual([0x01, 0x02, 0x03]);
  });

  it('leaves target untouched if rename fails', () => {
    const target = join(dir, 'out.json');
    writeFileSync(target, 'original');
    const badTarget = join(dir, 'baddir');
    mkdirSync(badTarget);
    writeFileSync(join(badTarget, 'child'), 'x');
    expect(() => writeFileAtomicSync(badTarget, 'new')).toThrow();
    expect(readFileSync(target, 'utf-8')).toBe('original');
    const leftover = readdirSync(dir).filter((f) => f.startsWith('baddir.') && f.endsWith('.tmp'));
    expect(leftover).toEqual([]);
  });

  it('applies the requested file mode', () => {
    if (process.platform === 'win32') return;
    const target = join(dir, 'secret.json');
    writeFileAtomicSync(target, '{}', { mode: 0o600 });
    const mode = statSync(target).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
