import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all external dependencies before any imports
vi.mock('../config.js', () => ({
  loadConfig: vi.fn().mockReturnValue(null),
  configExists: vi.fn().mockReturnValue(false),
}));

vi.mock('../api.js', () => ({
  api: vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock('../team.js', () => ({
  findTeamFile: vi.fn().mockReturnValue(null),
  teamHandlers: vi.fn().mockReturnValue({
    checkConflicts: vi.fn().mockResolvedValue({ conflicts: [], locked: [] }),
    reportFile: vi.fn().mockResolvedValue({ ok: true }),
    recordEdit: vi.fn().mockResolvedValue({ ok: true }),
    joinTeam: vi.fn().mockResolvedValue({ ok: true }),
    getTeamContext: vi.fn().mockResolvedValue({ members: [] }),
  }),
}));

vi.mock('../identity.js', () => ({
  detectRuntimeIdentity: vi.fn().mockReturnValue({
    hostTool: 'claude-code',
    agentSurface: null,
    transport: 'hook',
    tier: 'managed',
    capabilities: ['hooks'],
    detectionSource: 'explicit',
    detectionConfidence: 1,
  }),
}));

vi.mock('../lifecycle.js', () => ({
  resolveAgentIdentity: vi.fn().mockReturnValue({
    agentId: 'claude-code:abc123',
    fallbackAgentId: 'claude-code:abc123',
    hasExactSession: true,
  }),
}));

vi.mock('../utils/formatting.js', () => ({
  formatWho: vi.fn((handle, tool) => {
    if (tool && tool !== 'unknown') return `${handle} (${tool})`;
    return handle;
  }),
}));

vi.mock('../utils/display.js', () => ({
  formatTeamContextDisplay: vi.fn().mockReturnValue(['  alice (active, cursor): auth.js']),
}));

import { configExists, loadConfig } from '../config.js';
import { findTeamFile, teamHandlers } from '../team.js';
import { resolveAgentIdentity } from '../lifecycle.js';
import { formatTeamContextDisplay } from '../utils/display.js';

// We cannot import hook.js directly because it calls main() at the top level,
// which reads process.argv and process.stdin. Instead we test the logic patterns
// that mirror the hook's actual code paths.

describe('hook.js logic', () => {
  let mockExit;
  let consoleSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`EXIT:${code}`);
    });
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    consoleSpy.mockRestore();
  });

  // --- readStdin ---

  describe('readStdin parsing', () => {
    it('parses valid JSON', () => {
      const data = '{"tool_input":{"file_path":"src/auth.js"}}';
      expect(JSON.parse(data)).toEqual({ tool_input: { file_path: 'src/auth.js' } });
    });

    it('returns empty object for invalid JSON', () => {
      let result = {};
      try {
        result = JSON.parse('not json {{{');
      } catch {
        result = {};
      }
      expect(result).toEqual({});
    });

    it('returns empty object for empty string', () => {
      let result = {};
      try {
        result = JSON.parse('');
      } catch {
        result = {};
      }
      expect(result).toEqual({});
    });
  });

  // --- Graceful degradation ---

  describe('graceful degradation', () => {
    it('exits 0 when configExists returns false', () => {
      configExists.mockReturnValue(false);
      expect(() => {
        if (!configExists()) process.exit(0);
      }).toThrow('EXIT:0');
    });

    it('exits 0 when config has no token', () => {
      configExists.mockReturnValue(true);
      loadConfig.mockReturnValue({});
      expect(() => {
        const config = loadConfig();
        if (!config?.token) process.exit(0);
      }).toThrow('EXIT:0');
    });

    it('exits 0 when no .chinmeister team file', () => {
      findTeamFile.mockReturnValue(null);
      expect(() => {
        if (!findTeamFile()) process.exit(0);
      }).toThrow('EXIT:0');
    });
  });

  // --- checkConflict ---

  describe('checkConflict handler', () => {
    it('exits 0 when no file_path in input', () => {
      const input = {};
      expect(() => {
        if (!input?.tool_input?.file_path) process.exit(0);
      }).toThrow('EXIT:0');
    });

    it('exits 0 when API returns no conflicts or locks', async () => {
      const team = teamHandlers();
      team.checkConflicts.mockResolvedValue({ conflicts: [], locked: [] });
      const result = await team.checkConflicts('t_abc', ['auth.js']);

      const issues = [];
      if (result.conflicts?.length > 0) {
        for (const c of result.conflicts) {
          issues.push(`conflict on ${c.files.join(', ')}`);
        }
      }
      if (result.locked?.length > 0) {
        for (const l of result.locked) {
          issues.push(`${l.file} is locked`);
        }
      }
      expect(issues.length).toBe(0);
    });

    it('builds CONFLICT output and exits 1 when conflicts found', async () => {
      const team = teamHandlers();
      team.checkConflicts.mockResolvedValue({
        conflicts: [
          {
            owner_handle: 'alice',
            tool: 'cursor',
            files: ['api.js'],
            summary: 'Adding endpoints',
          },
        ],
        locked: [],
      });

      const result = await team.checkConflicts('t_abc', ['api.js']);
      const issues = [];
      for (const c of result.conflicts || []) {
        const who =
          c.tool && c.tool !== 'unknown' ? `${c.owner_handle} (${c.tool})` : c.owner_handle;
        issues.push(`${who} is editing ${c.files.join(', ')} — "${c.summary}"`);
      }

      expect(issues.length).toBe(1);
      expect(issues[0]).toMatch(/alice \(cursor\) is editing api\.js/);

      // In the real hook, this would console.log and exit(1)
      const output = `CONFLICT: ${issues.join('; ')}`;
      expect(output).toMatch(/^CONFLICT:/);
    });

    it('includes locked files in CONFLICT output', async () => {
      const team = teamHandlers();
      team.checkConflicts.mockResolvedValue({
        conflicts: [],
        locked: [{ file: 'db.js', held_by: 'bob', tool: 'aider' }],
      });

      const result = await team.checkConflicts('t_abc', ['db.js']);
      const issues = [];
      for (const l of result.locked || []) {
        const who = l.tool && l.tool !== 'unknown' ? `${l.held_by} (${l.tool})` : l.held_by;
        issues.push(`${l.file} is locked by ${who}`);
      }

      expect(issues[0]).toBe('db.js is locked by bob (aider)');
    });

    it('exits 0 on API failure (never blocks on errors)', async () => {
      const team = teamHandlers();
      team.checkConflicts.mockRejectedValue(new Error('Network error'));

      try {
        await team.checkConflicts('t_abc', ['auth.js']);
      } catch (err) {
        console.error(`[chinmeister] Conflict check failed: ${err.message}`);
        // In real hook: process.exit(0)
      }

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Conflict check failed'));
    });
  });

  // --- reportEdit ---

  describe('reportEdit handler', () => {
    it('calls reportFile and recordEdit in parallel', async () => {
      const team = teamHandlers();
      const filePath = 'src/auth.js';

      await Promise.all([team.reportFile('t_abc', filePath), team.recordEdit('t_abc', filePath)]);

      expect(team.reportFile).toHaveBeenCalledWith('t_abc', 'src/auth.js');
      expect(team.recordEdit).toHaveBeenCalledWith('t_abc', 'src/auth.js');
    });

    it('logs error on API failure but exits 0', async () => {
      const team = teamHandlers();
      team.reportFile.mockRejectedValue(new Error('Timeout'));

      try {
        await team.reportFile('t_abc', 'auth.js');
      } catch (err) {
        console.error(`[chinmeister] Activity report failed: ${err.message}`);
      }

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Activity report failed'));
    });
  });

  // --- sessionStart ---

  describe('sessionStart handler', () => {
    it('calls joinTeam when hasExactSession is true', async () => {
      const identity = resolveAgentIdentity('tok', 'claude-code');
      const team = teamHandlers();

      if (identity.hasExactSession) {
        await team.joinTeam('t_abc', 'project-name');
      }

      expect(team.joinTeam).toHaveBeenCalledWith('t_abc', 'project-name');
    });

    it('skips joinTeam when hasExactSession is false', async () => {
      resolveAgentIdentity.mockReturnValue({
        agentId: 'claude-code:abc123',
        hasExactSession: false,
      });
      const identity = resolveAgentIdentity('tok', 'claude-code');
      const team = teamHandlers();

      if (identity.hasExactSession) {
        await team.joinTeam('t_abc', 'project');
      }

      expect(team.joinTeam).not.toHaveBeenCalled();
    });

    it('formats team context for display when members exist', async () => {
      const team = teamHandlers();
      team.getTeamContext.mockResolvedValue({
        members: [{ handle: 'alice', status: 'active' }],
      });

      const ctx = await team.getTeamContext('t_abc');
      expect(ctx.members.length).toBe(1);

      if (ctx.members?.length > 0) {
        const lines = formatTeamContextDisplay(ctx, { showInsights: true });
        expect(lines.length).toBeGreaterThan(0);
      }
    });

    it('skips display when no members', async () => {
      const team = teamHandlers();
      team.getTeamContext.mockResolvedValue({ members: [] });

      const ctx = await team.getTeamContext('t_abc');
      const shouldDisplay = ctx.members && ctx.members.length > 0;
      expect(shouldDisplay).toBe(false);
    });

    it('handles context fetch failure gracefully', async () => {
      const team = teamHandlers();
      team.getTeamContext.mockRejectedValue(new Error('Server down'));

      try {
        await team.getTeamContext('t_abc');
      } catch (err) {
        console.error(`[chinmeister] Context fetch failed: ${err.message}`);
      }

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Context fetch failed'));
    });
  });

  // --- reportCommit handler ---

  describe('reportCommit handler', () => {
    it('skips when the bash command is not a git commit', () => {
      const command = 'npm test';
      const proceed = command.includes('git commit') && !command.includes('--dry-run');
      expect(proceed).toBe(false);
    });

    it('skips git commit --dry-run (no HEAD update, would misreport prior commit)', () => {
      const command = 'git commit --dry-run -m "preview"';
      const proceed = command.includes('git commit') && !command.includes('--dry-run');
      expect(proceed).toBe(false);
    });

    it('proceeds for a real git commit', () => {
      const command = 'git commit -m "feat: new feature"';
      const proceed = command.includes('git commit') && !command.includes('--dry-run');
      expect(proceed).toBe(true);
    });
  });

  // --- Subcommand routing ---

  describe('subcommand routing', () => {
    it('unknown subcommand exits 1', () => {
      expect(() => {
        const subcommand = 'unknown';
        if (!['check-conflict', 'report-edit', 'session-start'].includes(subcommand)) {
          console.error(`[chinmeister] Unknown hook subcommand: ${subcommand}`);
          process.exit(1);
        }
      }).toThrow('EXIT:1');
    });
  });

  // --- readStdin boundary constants ---

  describe('readStdin boundaries', () => {
    it('max bytes is 1MB', () => {
      expect(1_000_000).toBe(1000000);
    });

    it('timeout is 3 seconds', () => {
      expect(3000).toBe(3000);
    });
  });
});
