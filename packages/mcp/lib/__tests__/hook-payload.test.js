import { describe, it, expect } from 'vitest';
import {
  parseHookArgs,
  extractFilePath,
  extractEditLineCounts,
  extractBashCommand,
  extractBashResult,
  rawLooksLikeGitCommit,
  getHookBlockExitCode,
} from '../hook-payload.ts';

describe('parseHookArgs', () => {
  it('returns default host and no subcommand for bare argv', () => {
    expect(parseHookArgs(['node', 'script'])).toEqual({
      subcommand: null,
      hostId: 'claude-code',
    });
  });

  it('parses a Claude Code invocation without --tool', () => {
    expect(parseHookArgs(['node', 'script', 'check-conflict'])).toEqual({
      subcommand: 'check-conflict',
      hostId: 'claude-code',
    });
  });

  it('parses a Cursor invocation with --tool', () => {
    expect(parseHookArgs(['node', 'script', 'report-edit', '--tool', 'cursor'])).toEqual({
      subcommand: 'report-edit',
      hostId: 'cursor',
    });
  });

  it('parses a Windsurf invocation with --tool', () => {
    expect(parseHookArgs(['node', 'script', 'report-commit', '--tool', 'windsurf'])).toEqual({
      subcommand: 'report-commit',
      hostId: 'windsurf',
    });
  });

  it('accepts --host as an alias for --tool', () => {
    expect(parseHookArgs(['node', 'script', 'report-edit', '--host', 'windsurf'])).toEqual({
      subcommand: 'report-edit',
      hostId: 'windsurf',
    });
  });

  it('tolerates --tool appearing before subcommand', () => {
    expect(parseHookArgs(['node', 'script', '--tool', 'windsurf', 'report-edit'])).toEqual({
      subcommand: 'report-edit',
      hostId: 'windsurf',
    });
  });

  it('ignores --tool without a value', () => {
    expect(parseHookArgs(['node', 'script', 'report-edit', '--tool'])).toEqual({
      subcommand: 'report-edit',
      hostId: 'claude-code',
    });
  });

  it('ignores --tool when followed by another flag (malformed config)', () => {
    expect(parseHookArgs(['node', 'script', 'report-edit', '--tool', '--surface', 'cli'])).toEqual({
      subcommand: 'report-edit',
      hostId: 'claude-code',
    });
  });

  it('last --tool wins when specified multiple times', () => {
    expect(
      parseHookArgs(['node', 'script', 'report-edit', '--tool', 'cursor', '--tool', 'windsurf']),
    ).toEqual({
      subcommand: 'report-edit',
      hostId: 'windsurf',
    });
  });
});

describe('getHookBlockExitCode', () => {
  it('returns 2 for Windsurf (Cascade spec)', () => {
    expect(getHookBlockExitCode('windsurf')).toBe(2);
  });

  it('returns 1 (default) for Claude Code', () => {
    expect(getHookBlockExitCode('claude-code')).toBe(1);
  });

  it('returns 1 (default) for Cursor', () => {
    expect(getHookBlockExitCode('cursor')).toBe(1);
  });

  it('returns 1 (default) for unknown host ids so malformed configs degrade safely', () => {
    expect(getHookBlockExitCode('definitely-not-a-real-tool')).toBe(1);
  });
});

describe('extractFilePath', () => {
  it('extracts from Claude Code payload', () => {
    expect(extractFilePath({ tool_input: { file_path: 'src/auth.ts' } }, 'claude-code')).toBe(
      'src/auth.ts',
    );
  });

  it('extracts from Cursor payload (same shape as Claude Code)', () => {
    expect(extractFilePath({ tool_input: { file_path: 'app/page.tsx' } }, 'cursor')).toBe(
      'app/page.tsx',
    );
  });

  it('extracts from Windsurf tool_info shape', () => {
    expect(
      extractFilePath(
        { agent_action_name: 'post_write_code', tool_info: { file_path: '/abs/path.py' } },
        'windsurf',
      ),
    ).toBe('/abs/path.py');
  });

  it('returns null when field missing', () => {
    expect(extractFilePath({}, 'claude-code')).toBeNull();
    expect(extractFilePath({ tool_info: {} }, 'windsurf')).toBeNull();
    expect(extractFilePath(null, 'claude-code')).toBeNull();
  });

  it('does not cross-leak between shapes', () => {
    // Claude Code payload path should not be read when host is windsurf.
    expect(extractFilePath({ tool_input: { file_path: 'wrong.ts' } }, 'windsurf')).toBeNull();
    // Windsurf payload path should not be read when host is claude-code.
    expect(extractFilePath({ tool_info: { file_path: 'wrong.py' } }, 'claude-code')).toBeNull();
  });
});

describe('extractEditLineCounts', () => {
  it('counts from Claude Code Edit tool (old_string/new_string)', () => {
    const result = extractEditLineCounts(
      { tool_input: { old_string: 'a\nb', new_string: 'a\nb\nc\nd' } },
      'claude-code',
    );
    expect(result).toEqual({ linesAdded: 4, linesRemoved: 2 });
  });

  it('counts from Claude Code Write tool (content only)', () => {
    const result = extractEditLineCounts(
      { tool_input: { content: 'line1\nline2\nline3' } },
      'claude-code',
    );
    expect(result).toEqual({ linesAdded: 3, linesRemoved: 0 });
  });

  it('returns zeros when no edit fields present', () => {
    expect(extractEditLineCounts({ tool_input: {} }, 'claude-code')).toEqual({
      linesAdded: 0,
      linesRemoved: 0,
    });
  });

  it('sums Windsurf edits array', () => {
    const result = extractEditLineCounts(
      {
        tool_info: {
          file_path: 'x.py',
          edits: [
            { old_string: 'a', new_string: 'a\nb\nc' },
            { old_string: 'x\ny\nz', new_string: 'x' },
          ],
        },
      },
      'windsurf',
    );
    expect(result).toEqual({ linesAdded: 4, linesRemoved: 4 });
  });

  it('returns zeros for empty Windsurf edits array', () => {
    expect(extractEditLineCounts({ tool_info: { edits: [] } }, 'windsurf')).toEqual({
      linesAdded: 0,
      linesRemoved: 0,
    });
  });

  it('returns zeros when Windsurf edits field missing', () => {
    expect(extractEditLineCounts({ tool_info: {} }, 'windsurf')).toEqual({
      linesAdded: 0,
      linesRemoved: 0,
    });
  });
});

describe('extractBashCommand', () => {
  it('extracts from Claude Code tool_input.command', () => {
    expect(
      extractBashCommand({ tool_input: { command: 'git commit -m "x"' } }, 'claude-code'),
    ).toBe('git commit -m "x"');
  });

  it('extracts from Windsurf tool_info.command_line', () => {
    expect(
      extractBashCommand({ tool_info: { command_line: 'npm install', cwd: '/proj' } }, 'windsurf'),
    ).toBe('npm install');
  });

  it('returns empty string for missing command', () => {
    expect(extractBashCommand({}, 'claude-code')).toBe('');
    expect(extractBashCommand({}, 'windsurf')).toBe('');
  });
});

describe('extractBashResult', () => {
  it('extracts stdout object field for Claude Code', () => {
    const result = extractBashResult(
      { tool_result: { stdout: '[main abc1234] message' } },
      'claude-code',
    );
    expect(result).toBe('[main abc1234] message');
  });

  it('extracts string tool_result for Claude Code', () => {
    expect(extractBashResult({ tool_result: 'plain output' }, 'claude-code')).toBe('plain output');
  });

  it('returns empty string for Windsurf (no stdout in payload)', () => {
    expect(extractBashResult({ tool_info: { command_line: 'git commit -m x' } }, 'windsurf')).toBe(
      '',
    );
  });

  it('returns empty string when tool_result missing', () => {
    expect(extractBashResult({}, 'claude-code')).toBe('');
  });
});

describe('rawLooksLikeGitCommit', () => {
  it('returns true when raw contains "git commit"', () => {
    expect(rawLooksLikeGitCommit('{"tool_input":{"command":"git commit -m x"}}')).toBe(true);
    expect(rawLooksLikeGitCommit('{"tool_info":{"command_line":"git commit"}}')).toBe(true);
  });

  it('returns false for non-commit commands', () => {
    expect(rawLooksLikeGitCommit('{"tool_input":{"command":"npm test"}}')).toBe(false);
  });

  it('returns false for non-strings', () => {
    expect(rawLooksLikeGitCommit('')).toBe(false);
    expect(rawLooksLikeGitCommit(null)).toBe(false);
    expect(rawLooksLikeGitCommit(undefined)).toBe(false);
  });
});
