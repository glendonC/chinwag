import { describe, it, expect, vi } from 'vitest';

// Mock cloudflare:workers so DO class imports resolve outside the Workers runtime
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

import {
  parseTeamPath,
  getAgentRuntime,
  getToolFromAgentId,
  sanitizeTags,
  teamErrorStatus,
} from '../index.js';
import { normalizePath, toSQLDateTime } from '../lib/text-utils.js';
import {
  requireString,
  requireArray,
  sqlChanges,
  validateFileArray,
  validateTagsArray,
  withRateLimit,
  requireJson,
} from '../lib/validation.js';

// --- parseTeamPath ---

describe('parseTeamPath', () => {
  it('parses a valid team path with action', () => {
    const result = parseTeamPath('/teams/t_a7b3c9d2e1f04856/context');
    expect(result).toEqual({ teamId: 't_a7b3c9d2e1f04856', action: 'context' });
  });

  it('parses different valid actions', () => {
    expect(parseTeamPath('/teams/t_0000000000000000/join')).toEqual({
      teamId: 't_0000000000000000',
      action: 'join',
    });
    expect(parseTeamPath('/teams/t_ffffffffffffffff/heartbeat')).toEqual({
      teamId: 't_ffffffffffffffff',
      action: 'heartbeat',
    });
    expect(parseTeamPath('/teams/t_abcdef0123456789/memory')).toEqual({
      teamId: 't_abcdef0123456789',
      action: 'memory',
    });
  });

  it('returns null for missing /teams prefix', () => {
    expect(parseTeamPath('/team/t_a7b3c9d2e1f04856/context')).toBeNull();
  });

  it('returns null for wrong team ID format (too short)', () => {
    expect(parseTeamPath('/teams/t_a7b3c9d2/context')).toBeNull();
  });

  it('returns null for wrong team ID format (too long)', () => {
    expect(parseTeamPath('/teams/t_a7b3c9d2e1f04856aa/context')).toBeNull();
  });

  it('returns null for missing t_ prefix on team ID', () => {
    expect(parseTeamPath('/teams/a7b3c9d2e1f04856/context')).toBeNull();
  });

  it('returns null for uppercase hex in team ID', () => {
    expect(parseTeamPath('/teams/t_A7B3C9D2E1F04856/context')).toBeNull();
  });

  it('returns null for missing action', () => {
    expect(parseTeamPath('/teams/t_a7b3c9d2e1f04856')).toBeNull();
    expect(parseTeamPath('/teams/t_a7b3c9d2e1f04856/')).toBeNull();
  });

  it('returns null for action with uppercase letters', () => {
    expect(parseTeamPath('/teams/t_a7b3c9d2e1f04856/Context')).toBeNull();
  });

  it('returns null for extra path segments', () => {
    expect(parseTeamPath('/teams/t_a7b3c9d2e1f04856/context/extra')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTeamPath('')).toBeNull();
  });

  it('returns null for action with numbers', () => {
    expect(parseTeamPath('/teams/t_a7b3c9d2e1f04856/test123')).toBeNull();
  });
});

// --- getToolFromAgentId ---

describe('getToolFromAgentId', () => {
  it('extracts tool name from colon-separated agent ID', () => {
    expect(getToolFromAgentId('cursor:abc123')).toBe('cursor');
  });

  it('extracts tool for various tool prefixes', () => {
    expect(getToolFromAgentId('claude:session-xyz')).toBe('claude');
    expect(getToolFromAgentId('aider:12345')).toBe('aider');
    expect(getToolFromAgentId('windsurf:a1b2c3')).toBe('windsurf');
  });

  it('returns "unknown" for bare UUID without colon', () => {
    expect(getToolFromAgentId('550e8400-e29b-41d4-a716-446655440000')).toBe('unknown');
  });

  it('returns "unknown" for string with no colon', () => {
    expect(getToolFromAgentId('justanid')).toBe('unknown');
  });

  it('handles colon at start (returns empty string before colon)', () => {
    // idx = 0, which is not > 0
    expect(getToolFromAgentId(':abc123')).toBe('unknown');
  });

  it('handles multiple colons (takes only up to first)', () => {
    expect(getToolFromAgentId('tool:sub:value')).toBe('tool');
  });

  it('handles empty string', () => {
    expect(getToolFromAgentId('')).toBe('unknown');
  });
});

describe('getAgentRuntime', () => {
  it('prefers explicit runtime headers over agent id parsing', () => {
    const request = new Request('http://example.com', {
      headers: {
        'X-Agent-Id': 'cursor:abc123',
        'X-Agent-Host-Tool': 'vscode',
        'X-Agent-Surface': 'cline',
        'X-Agent-Transport': 'mcp',
        'X-Agent-Tier': 'connected',
      },
    });

    expect(getAgentRuntime(request, { id: 'user-1' })).toEqual({
      agentId: 'cursor:abc123',
      hostTool: 'vscode',
      agentSurface: 'cline',
      transport: 'mcp',
      tier: 'connected',
    });
  });

  it('falls back to the agent id prefix when runtime headers are absent', () => {
    const request = new Request('http://example.com', {
      headers: {
        'X-Agent-Id': 'windsurf:def456',
      },
    });

    expect(getAgentRuntime(request, { id: 'user-1' })).toMatchObject({
      agentId: 'windsurf:def456',
      hostTool: 'windsurf',
      agentSurface: null,
      transport: null,
      tier: null,
    });
  });
});

// --- sanitizeTags ---

describe('sanitizeTags', () => {
  it('returns cleaned tags from valid string array', () => {
    expect(sanitizeTags(['JavaScript', 'TypeScript'])).toEqual(['javascript', 'typescript']);
  });

  it('filters out non-string values', () => {
    expect(sanitizeTags([42, null, undefined, true, 'valid'])).toEqual(['valid']);
  });

  it('caps individual tag length at 50 characters', () => {
    const longTag = 'a'.repeat(100);
    const result = sanitizeTags([longTag]);
    expect(result[0]).toHaveLength(50);
  });

  it('lowercases all tags', () => {
    expect(sanitizeTags(['UPPER', 'MiXeD', 'lower'])).toEqual(['upper', 'mixed', 'lower']);
  });

  it('caps array length at 50', () => {
    const tags = Array.from({ length: 100 }, (_, i) => `tag${i}`);
    const result = sanitizeTags(tags);
    expect(result).toHaveLength(50);
  });

  it('returns empty array for non-array input', () => {
    expect(sanitizeTags(null)).toEqual([]);
    expect(sanitizeTags(undefined)).toEqual([]);
    expect(sanitizeTags('string')).toEqual([]);
    expect(sanitizeTags(42)).toEqual([]);
    expect(sanitizeTags({})).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(sanitizeTags([])).toEqual([]);
  });

  it('trims whitespace from tags', () => {
    expect(sanitizeTags(['  padded  ', ' left', 'right '])).toEqual(['padded', 'left', 'right']);
  });

  it('filters out tags that become empty after trimming', () => {
    expect(sanitizeTags(['   ', '', 'valid'])).toEqual(['valid']);
  });
});

// --- teamErrorStatus ---

describe('teamErrorStatus', () => {
  // Structured code path (preferred)
  it('returns 403 for NOT_MEMBER code', () => {
    expect(teamErrorStatus({ error: 'Not a member of this team', code: 'NOT_MEMBER' })).toBe(403);
  });

  it('returns 403 for NOT_OWNER code', () => {
    expect(teamErrorStatus({ error: 'Not your agent', code: 'NOT_OWNER' })).toBe(403);
  });

  it('returns 403 for FORBIDDEN code', () => {
    expect(teamErrorStatus({ error: 'Access denied', code: 'FORBIDDEN' })).toBe(403);
  });

  it('returns 404 for NOT_FOUND code', () => {
    expect(teamErrorStatus({ error: 'Memory not found', code: 'NOT_FOUND' })).toBe(404);
  });

  it('returns 409 for CONFLICT code', () => {
    expect(teamErrorStatus({ error: 'Handle already taken', code: 'CONFLICT' })).toBe(409);
  });

  it('returns 400 for VALIDATION code', () => {
    expect(teamErrorStatus({ error: 'Handle must be 3-20 characters', code: 'VALIDATION' })).toBe(
      400,
    );
  });

  it('returns 500 for INTERNAL code', () => {
    expect(teamErrorStatus({ error: 'Internal error', code: 'INTERNAL' })).toBe(500);
  });

  it('returns 400 for unknown codes', () => {
    expect(teamErrorStatus({ error: 'Something else', code: 'UNKNOWN_CODE' })).toBe(400);
  });

  it('returns 400 for objects without error code', () => {
    expect(teamErrorStatus({ error: 'Invalid input' })).toBe(400);
    expect(teamErrorStatus({ error: 'Something else' })).toBe(400);
  });

  it('returns 400 for null or undefined', () => {
    expect(teamErrorStatus(null)).toBe(400);
    expect(teamErrorStatus(undefined)).toBe(400);
  });

  it('returns correct status for structured error codes', () => {
    expect(teamErrorStatus({ error: 'Not a member of this team', code: 'NOT_MEMBER' })).toBe(403);
    expect(teamErrorStatus({ error: 'Not your agent', code: 'NOT_OWNER' })).toBe(403);
    expect(teamErrorStatus({ error: 'Agent ID already claimed', code: 'AGENT_CLAIMED' })).toBe(409);
    expect(teamErrorStatus({ error: 'Memory not found', code: 'NOT_FOUND' })).toBe(404);
  });
});

// --- normalizePath ---

describe('normalizePath', () => {
  it('strips leading ./', () => {
    expect(normalizePath('./src/a.js')).toBe('src/a.js');
  });

  it('collapses double slashes', () => {
    expect(normalizePath('src//a.js')).toBe('src/a.js');
  });

  it('collapses triple slashes', () => {
    expect(normalizePath('src///a.js')).toBe('src/a.js');
  });

  it('strips trailing slash', () => {
    expect(normalizePath('src/a.js/')).toBe('src/a.js');
  });

  it('handles combination of all normalizations', () => {
    expect(normalizePath('./src//lib///utils.js/')).toBe('src/lib/utils.js');
  });

  it('leaves already-clean paths unchanged', () => {
    expect(normalizePath('src/index.js')).toBe('src/index.js');
  });

  it('handles simple filename', () => {
    expect(normalizePath('file.txt')).toBe('file.txt');
  });

  it('handles deeply nested paths', () => {
    expect(normalizePath('./a/b/c/d/e.js')).toBe('a/b/c/d/e.js');
  });

  it('strips .. segments to prevent path traversal', () => {
    expect(normalizePath('../src/a.js')).toBe('src/a.js');
    expect(normalizePath('../../etc/passwd')).toBe('etc/passwd');
    expect(normalizePath('src/../lib/a.js')).toBe('src/lib/a.js');
  });
});

// --- requireString ---

describe('requireString', () => {
  it('returns trimmed string for valid input', () => {
    expect(requireString({ name: '  hello  ' }, 'name')).toBe('hello');
  });

  it('returns null for missing field', () => {
    expect(requireString({}, 'name')).toBeNull();
  });

  it('returns null for non-string field', () => {
    expect(requireString({ name: 42 }, 'name')).toBeNull();
    expect(requireString({ name: null }, 'name')).toBeNull();
    expect(requireString({ name: true }, 'name')).toBeNull();
    expect(requireString({ name: [] }, 'name')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(requireString({ name: '' }, 'name')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(requireString({ name: '   ' }, 'name')).toBeNull();
  });

  it('returns null when value exceeds maxLength', () => {
    expect(requireString({ name: 'a'.repeat(51) }, 'name', 50)).toBeNull();
  });

  it('returns string when within maxLength', () => {
    expect(requireString({ name: 'a'.repeat(50) }, 'name', 50)).toBe('a'.repeat(50));
  });

  it('works without maxLength parameter', () => {
    expect(requireString({ name: 'a'.repeat(10000) }, 'name')).toBe('a'.repeat(10000));
  });
});

// --- requireArray ---

describe('requireArray', () => {
  it('returns array for valid input', () => {
    expect(requireArray({ files: ['a.js', 'b.js'] }, 'files', 10)).toEqual(['a.js', 'b.js']);
  });

  it('returns null for missing field', () => {
    expect(requireArray({}, 'files', 10)).toBeNull();
  });

  it('returns null for non-array field', () => {
    expect(requireArray({ files: 'a.js' }, 'files', 10)).toBeNull();
    expect(requireArray({ files: null }, 'files', 10)).toBeNull();
    expect(requireArray({ files: 42 }, 'files', 10)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(requireArray({ files: [] }, 'files', 10)).toBeNull();
  });

  it('returns null when array exceeds maxItems', () => {
    expect(requireArray({ files: ['a', 'b', 'c'] }, 'files', 2)).toBeNull();
  });

  it('returns array when at maxItems', () => {
    expect(requireArray({ files: ['a', 'b'] }, 'files', 2)).toEqual(['a', 'b']);
  });
});

// --- sqlChanges ---

describe('sqlChanges', () => {
  it('returns the changes count from a mock SQL handle', () => {
    const mockSql = {
      exec: vi.fn(() => ({
        toArray: () => [{ c: 5 }],
      })),
    };
    expect(sqlChanges(mockSql)).toBe(5);
    expect(mockSql.exec).toHaveBeenCalledWith('SELECT changes() as c');
  });

  it('returns 0 when no rows changed', () => {
    const mockSql = {
      exec: vi.fn(() => ({
        toArray: () => [{ c: 0 }],
      })),
    };
    expect(sqlChanges(mockSql)).toBe(0);
  });
});

// --- normalizePath: extended edge cases ---

describe('normalizePath — edge cases', () => {
  it('returns empty string for empty input', () => {
    expect(normalizePath('')).toBe('');
  });

  it('does not fully resolve a lone dot (strips leading ./ only)', () => {
    // normalizePath strips leading "./" but a bare "." is not "./", so it remains.
    // This is acceptable — bare "." is not a realistic file path argument.
    expect(normalizePath('.')).toBe('.');
  });

  it('handles just a slash', () => {
    expect(normalizePath('/')).toBe('');
  });

  it('handles just ..', () => {
    expect(normalizePath('..')).toBe('');
  });

  it('handles multiple .. segments', () => {
    expect(normalizePath('../../..')).toBe('');
    expect(normalizePath('../../../etc/passwd')).toBe('etc/passwd');
  });

  it('handles very long paths', () => {
    const longPath = 'a/'.repeat(500) + 'file.js';
    const result = normalizePath(longPath);
    expect(result).not.toContain('//');
    expect(result.endsWith('file.js')).toBe(true);
  });

  it('handles paths with only slashes', () => {
    expect(normalizePath('///')).toBe('');
  });

  it('normalizes ./ and ../ combined', () => {
    expect(normalizePath('./../src/file.js')).toBe('src/file.js');
  });

  it('handles trailing slash on directory', () => {
    expect(normalizePath('src/lib/')).toBe('src/lib');
  });

  it('treats ./src/api.js and src/api.js as the same', () => {
    expect(normalizePath('./src/api.js')).toBe(normalizePath('src/api.js'));
  });

  it('collapses mixed path issues in one string', () => {
    // normalizePath strips leading ./, collapses //, removes .. segments, strips trailing /
    // But it does NOT remove mid-path "." segments — only ".." is filtered.
    // './..//src///./lib/../utils.js/' → strip ./ → '..//src///./lib/../utils.js/'
    // → collapse // → '../src/./lib/../utils.js/' → strip trailing / → '../src/./lib/../utils.js'
    // → remove .. segments → 'src/./lib/utils.js' → strip leading / → 'src/./lib/utils.js'
    expect(normalizePath('./..//src///./lib/../utils.js/')).toBe('src/./lib/utils.js');
  });
});

// --- toSQLDateTime ---

describe('toSQLDateTime', () => {
  it('returns a formatted datetime string', () => {
    const result = toSQLDateTime(new Date('2025-06-15T10:30:45.123Z'));
    expect(result).toBe('2025-06-15 10:30:45');
  });

  it('returns current time when no argument', () => {
    const result = toSQLDateTime();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('strips milliseconds', () => {
    const result = toSQLDateTime(new Date('2025-01-01T00:00:00.999Z'));
    expect(result).toBe('2025-01-01 00:00:00');
    expect(result).not.toContain('.');
  });
});

// --- validateFileArray ---

describe('validateFileArray', () => {
  it('returns null for valid file array', () => {
    expect(validateFileArray(['src/a.js', 'src/b.js'], 20)).toBeNull();
  });

  it('rejects non-array input', () => {
    expect(validateFileArray('src/a.js', 20)).toBe('files must be a non-empty array');
    expect(validateFileArray(null, 20)).toBe('files must be a non-empty array');
    expect(validateFileArray(42, 20)).toBe('files must be a non-empty array');
  });

  it('rejects empty array', () => {
    expect(validateFileArray([], 20)).toBe('files must be a non-empty array');
  });

  it('rejects too many files', () => {
    const files = Array.from({ length: 25 }, (_, i) => `file${i}.js`);
    expect(validateFileArray(files, 20)).toBe('too many files (max 20)');
  });

  it('rejects non-string entries', () => {
    expect(validateFileArray([42, 'valid.js'], 20)).toBe('invalid file path');
    expect(validateFileArray([null], 20)).toBe('invalid file path');
  });

  it('rejects file paths exceeding 500 chars', () => {
    const longPath = 'a'.repeat(501);
    expect(validateFileArray([longPath], 20)).toBe('invalid file path');
  });

  it('accepts file path at exactly 500 chars', () => {
    const exactPath = 'a'.repeat(500);
    expect(validateFileArray([exactPath], 20)).toBeNull();
  });

  it('accepts a single file', () => {
    expect(validateFileArray(['file.js'], 20)).toBeNull();
  });

  it('accepts files at exactly the max count', () => {
    const files = Array.from({ length: 20 }, (_, i) => `file${i}.js`);
    expect(validateFileArray(files, 20)).toBeNull();
  });
});

// --- validateTagsArray ---

describe('validateTagsArray', () => {
  it('returns empty array for null or undefined', () => {
    expect(validateTagsArray(null, 10)).toEqual({ tags: [] });
    expect(validateTagsArray(undefined, 10)).toEqual({ tags: [] });
  });

  it('returns error for non-array input', () => {
    expect(validateTagsArray('config', 10)).toEqual({ error: 'tags must be an array of strings' });
    expect(validateTagsArray(42, 10)).toEqual({ error: 'tags must be an array of strings' });
    expect(validateTagsArray({}, 10)).toEqual({ error: 'tags must be an array of strings' });
  });

  it('returns error when too many tags', () => {
    const tags = Array.from({ length: 15 }, (_, i) => `tag${i}`);
    expect(validateTagsArray(tags, 10)).toEqual({ error: 'max 10 tags' });
  });

  it('returns error for tags exceeding 50 chars', () => {
    expect(validateTagsArray(['a'.repeat(51)], 10)).toEqual({
      error: 'each tag must be a string of 50 chars or less',
    });
  });

  it('returns error for non-string tags', () => {
    expect(validateTagsArray([42], 10)).toEqual({
      error: 'each tag must be a string of 50 chars or less',
    });
  });

  it('lowercases and trims valid tags', () => {
    expect(validateTagsArray(['  Config  ', 'PATTERN'], 10)).toEqual({
      tags: ['config', 'pattern'],
    });
  });

  it('filters out tags that become empty after trimming', () => {
    expect(validateTagsArray(['  ', '', 'valid'], 10)).toEqual({ tags: ['valid'] });
  });

  it('accepts empty array', () => {
    expect(validateTagsArray([], 10)).toEqual({ tags: [] });
  });

  it('accepts tags at exactly the max count', () => {
    const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`);
    const result = validateTagsArray(tags, 10);
    expect(result.tags).toHaveLength(10);
  });
});

// --- requireJson ---

describe('requireJson', () => {
  it('returns null for body without parse error', () => {
    expect(requireJson({ key: 'value' })).toBeNull();
  });

  it('returns 400 response for body with parse error', () => {
    const result = requireJson({ _parseError: 'Invalid JSON body' });
    expect(result).not.toBeNull();
    expect(result.status).toBe(400);
  });
});

// --- withRateLimit ---

describe('withRateLimit', () => {
  it('returns 429 when rate limit reached', async () => {
    const mockDb = {
      checkRateLimit: async () => ({ allowed: false, count: 5 }),
      consumeRateLimit: async () => {},
    };
    const handler = async () => new Response('ok', { status: 200 });

    const response = await withRateLimit(mockDb, 'test-key', 5, 'Rate limit exceeded', handler);
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe('Rate limit exceeded');
  });

  it('runs handler and consumes limit on success', async () => {
    let consumed = false;
    const mockDb = {
      checkRateLimit: async () => ({ allowed: true, count: 2 }),
      consumeRateLimit: async () => {
        consumed = true;
      },
    };
    const handler = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });

    const response = await withRateLimit(mockDb, 'test-key', 5, 'limit', handler);
    expect(response.status).toBe(200);
    expect(consumed).toBe(true);
  });

  it('does not consume rate limit on handler failure (status >= 400)', async () => {
    let consumed = false;
    const mockDb = {
      checkRateLimit: async () => ({ allowed: true, count: 0 }),
      consumeRateLimit: async () => {
        consumed = true;
      },
    };
    const handler = async () =>
      new Response(JSON.stringify({ error: 'Bad input' }), { status: 400 });

    const response = await withRateLimit(mockDb, 'test-key', 5, 'limit', handler);
    expect(response.status).toBe(400);
    expect(consumed).toBe(false);
  });

  it('does not consume rate limit on 500 error', async () => {
    let consumed = false;
    const mockDb = {
      checkRateLimit: async () => ({ allowed: true, count: 0 }),
      consumeRateLimit: async () => {
        consumed = true;
      },
    };
    const handler = async () => new Response('Internal error', { status: 500 });

    const response = await withRateLimit(mockDb, 'test-key', 5, 'limit', handler);
    expect(response.status).toBe(500);
    expect(consumed).toBe(false);
  });

  it('different rate limit keys do not interfere', async () => {
    const counts = { 'key-a': 5, 'key-b': 0 };
    const mockDb = {
      checkRateLimit: async (key, max) => ({ allowed: counts[key] < max, count: counts[key] }),
      consumeRateLimit: async (key) => {
        counts[key]++;
      },
    };

    const handler = async () => new Response('ok', { status: 200 });

    // key-a is at limit
    const resA = await withRateLimit(mockDb, 'key-a', 5, 'limit A', handler);
    expect(resA.status).toBe(429);

    // key-b is not at limit
    const resB = await withRateLimit(mockDb, 'key-b', 5, 'limit B', handler);
    expect(resB.status).toBe(200);
  });

  it('does not invoke handler when rate limited', async () => {
    let handlerCalled = false;
    const mockDb = {
      checkRateLimit: async () => ({ allowed: false, count: 10 }),
      consumeRateLimit: async () => {},
    };
    const handler = async () => {
      handlerCalled = true;
      return new Response('ok', { status: 200 });
    };

    await withRateLimit(mockDb, 'test-key', 5, 'limit', handler);
    expect(handlerCalled).toBe(false);
  });
});
