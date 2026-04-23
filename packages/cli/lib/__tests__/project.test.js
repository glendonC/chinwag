import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getProjectContext } from '../project.js';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'chinmeister-project-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('getProjectContext', () => {
  it('returns null when no .chinmeister file exists', () => {
    expect(getProjectContext(tmpDir)).toBeNull();
  });

  it('returns project context when .chinmeister exists', () => {
    writeFileSync(
      join(tmpDir, '.chinmeister'),
      JSON.stringify({
        team: 't_abc1230000000000',
        name: 'my-project',
      }),
    );

    const ctx = getProjectContext(tmpDir);
    expect(ctx).not.toBeNull();
    expect(ctx.teamId).toBe('t_abc1230000000000');
    expect(ctx.teamName).toBe('my-project');
    expect(ctx.root).toBe(tmpDir);
  });

  it('walks up parent directories to find .chinmeister', () => {
    const subDir = join(tmpDir, 'src', 'lib');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(tmpDir, '.chinmeister'),
      JSON.stringify({
        team: 't_aabbccddee001122',
        name: 'parent-project',
      }),
    );

    const ctx = getProjectContext(subDir);
    expect(ctx).not.toBeNull();
    expect(ctx.teamId).toBe('t_aabbccddee001122');
  });
});
