import { describe, it, expect, vi } from 'vitest';

// Mock cloudflare:workers so DO class imports resolve outside the Workers runtime
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

import { parseTeamPath, getAgentRuntime, getToolFromAgentId, sanitizeTags, teamErrorStatus } from '../index.js';
import { normalizePath } from '../lib/text-utils.js';

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
      tool: 'vscode',
      host_tool: 'vscode',
      hostTool: 'vscode',
      agent_surface: 'cline',
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
      tool: 'windsurf',
      host_tool: 'windsurf',
      hostTool: 'windsurf',
      agent_surface: null,
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
  it('returns 403 for "Not a member of this team"', () => {
    expect(teamErrorStatus('Not a member of this team')).toBe(403);
  });

  it('returns 403 for messages containing "Not a member"', () => {
    expect(teamErrorStatus('Not a member')).toBe(403);
    expect(teamErrorStatus('Error: Not a member of the team')).toBe(403);
  });

  it('returns 400 for other error messages', () => {
    expect(teamErrorStatus('Invalid input')).toBe(400);
    expect(teamErrorStatus('Category must be one of: gotcha, pattern')).toBe(400);
    expect(teamErrorStatus('Memory not found')).toBe(400);
  });

  it('returns 400 for null or undefined', () => {
    expect(teamErrorStatus(null)).toBe(400);
    expect(teamErrorStatus(undefined)).toBe(400);
  });

  it('returns 400 for empty string', () => {
    expect(teamErrorStatus('')).toBe(400);
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

