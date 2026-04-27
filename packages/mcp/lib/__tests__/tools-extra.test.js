// Coverage for the MCP tool handlers that the legacy tools.test.js doesn't
// reach: commits, outcome, telemetry, and the consolidation/formation/batch
// memory tools. Each handler follows the same shape — register, capture, call,
// assert team-method invocation and response shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../context.js', () => ({
  refreshContext: vi.fn().mockResolvedValue(null),
  teamPreamble: vi.fn().mockResolvedValue(''),
  offlinePrefix: vi.fn().mockReturnValue(''),
  getCachedContext: vi.fn().mockReturnValue(null),
  clearContextCache: vi.fn(),
}));

vi.mock('@chinmeister/shared/session-registry.js', () => ({
  setTerminalTitle: vi.fn(),
}));

import { teamPreamble } from '../context.js';
import { registerCommitsTool } from '../tools/commits.js';
import { registerOutcomeTool } from '../tools/outcome.js';
import { registerTelemetryTools } from '../tools/telemetry.js';
import { registerMemoryTools } from '../tools/memory.js';

function createToolCollector() {
  const tools = new Map();
  const addTool = (name, opts, handler) => tools.set(name, { opts, handler });
  return {
    addTool,
    tools,
    callTool: async (name, args = {}) => {
      const t = tools.get(name);
      if (!t) throw new Error(`Tool not registered: ${name}`);
      return t.handler(args);
    },
  };
}

function createMockTeam() {
  return {
    // commits
    recordCommits: vi.fn().mockResolvedValue({ recorded: 0 }),
    // outcome
    reportOutcome: vi.fn().mockResolvedValue({ ok: true }),
    // telemetry
    recordSessionTokens: vi.fn().mockResolvedValue({ ok: true }),
    recordEdit: vi.fn().mockResolvedValue({ ok: true }),
    recordToolCalls: vi.fn().mockResolvedValue({ ok: true }),
    // memory
    saveMemory: vi.fn().mockResolvedValue({ ok: true }),
    updateMemory: vi.fn().mockResolvedValue({ ok: true }),
    searchMemories: vi.fn().mockResolvedValue({ memories: [] }),
    deleteMemory: vi.fn().mockResolvedValue({ ok: true }),
    deleteMemoriesBatch: vi.fn().mockResolvedValue({ ok: true, deleted: 0 }),
    listConsolidationProposals: vi.fn().mockResolvedValue({ ok: true, proposals: [] }),
    applyConsolidationProposal: vi
      .fn()
      .mockResolvedValue({ ok: true, source_id: 's', target_id: 't' }),
    runFormationSweep: vi.fn().mockResolvedValue({ ok: true, processed: 0, skipped: 0 }),
    listFormationObservations: vi.fn().mockResolvedValue({ ok: true, observations: [] }),
    unmergeMemory: vi.fn().mockResolvedValue({ ok: true }),
  };
}

// =====================================================================
// commits.ts
// =====================================================================

describe('commits tool (unit)', () => {
  let collector, team, state;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createToolCollector();
    team = createMockTeam();
    state = { teamId: 't_c', sessionId: 'sess_c' };
    teamPreamble.mockResolvedValue('');
    registerCommitsTool(collector.addTool, { team, state });
  });

  it('registers chinmeister_report_commits', () => {
    expect(collector.tools.has('chinmeister_report_commits')).toBe(true);
  });

  it('records commits and returns the count plus short SHAs', async () => {
    team.recordCommits.mockResolvedValue({ recorded: 2 });
    const result = await collector.callTool('chinmeister_report_commits', {
      commits: [
        { sha: 'abcdef1234567', message: 'Initial' },
        { sha: '1234abcd5678efg', message: 'Follow-up' },
      ],
    });
    expect(team.recordCommits).toHaveBeenCalledWith(
      't_c',
      'sess_c',
      expect.arrayContaining([expect.objectContaining({ sha: 'abcdef1234567' })]),
    );
    expect(result.content[0].text).toMatch(/Recorded 2 commits: abcdef1, 1234abc/);
  });

  it('falls back to commits.length when API omits "recorded"', async () => {
    team.recordCommits.mockResolvedValue({});
    const result = await collector.callTool('chinmeister_report_commits', {
      commits: [{ sha: 'abcdef1' }],
    });
    expect(result.content[0].text).toMatch(/Recorded 1 commit:/);
  });

  it('returns a no-session message when sessionId is unset', async () => {
    state.sessionId = null;
    const result = await collector.callTool('chinmeister_report_commits', {
      commits: [{ sha: 'abcdef1' }],
    });
    expect(team.recordCommits).not.toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/No active session/);
  });
});

// =====================================================================
// outcome.ts
// =====================================================================

describe('outcome tool (unit)', () => {
  let collector, team, state;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createToolCollector();
    team = createMockTeam();
    state = { teamId: 't_o' };
    teamPreamble.mockResolvedValue('');
    registerOutcomeTool(collector.addTool, { team, state });
  });

  it('registers chinmeister_report_outcome', () => {
    expect(collector.tools.has('chinmeister_report_outcome')).toBe(true);
  });

  it('reports outcome with summary', async () => {
    const result = await collector.callTool('chinmeister_report_outcome', {
      outcome: 'completed',
      summary: 'Wrapped the task',
    });
    expect(team.reportOutcome).toHaveBeenCalledWith('t_o', 'completed', 'Wrapped the task');
    expect(result.content[0].text).toMatch(/Session outcome recorded: completed/);
    expect(result.content[0].text).toMatch(/Wrapped the task/);
  });

  it('reports outcome without a summary, passing null', async () => {
    const result = await collector.callTool('chinmeister_report_outcome', { outcome: 'abandoned' });
    expect(team.reportOutcome).toHaveBeenCalledWith('t_o', 'abandoned', null);
    expect(result.content[0].text).toMatch(/Session outcome recorded: abandoned$/);
  });
});

// =====================================================================
// telemetry.ts
// =====================================================================

describe('telemetry tools (unit)', () => {
  let collector, team, state;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createToolCollector();
    team = createMockTeam();
    state = { teamId: 't_t', sessionId: 'sess_t' };
    teamPreamble.mockResolvedValue('');
    registerTelemetryTools(collector.addTool, { team, state });
  });

  it('registers all three telemetry tools', () => {
    expect(collector.tools.has('chinmeister_record_tokens')).toBe(true);
    expect(collector.tools.has('chinmeister_record_edit')).toBe(true);
    expect(collector.tools.has('chinmeister_record_tool_call')).toBe(true);
  });

  describe('chinmeister_record_tokens', () => {
    it('records tokens and reports the in/out totals', async () => {
      const result = await collector.callTool('chinmeister_record_tokens', {
        input_tokens: 12_000,
        output_tokens: 1_400,
        cache_read_tokens: 8_000,
        cache_creation_tokens: 200,
      });
      expect(team.recordSessionTokens).toHaveBeenCalledWith('t_t', 'sess_t', {
        input_tokens: 12_000,
        output_tokens: 1_400,
        cache_read_tokens: 8_000,
        cache_creation_tokens: 200,
      });
      expect(result.content[0].text).toMatch(/Token usage recorded: 12000 in, 1400 out/);
    });

    it('defaults cache fields to 0 when omitted', async () => {
      await collector.callTool('chinmeister_record_tokens', {
        input_tokens: 10,
        output_tokens: 1,
      });
      expect(team.recordSessionTokens).toHaveBeenCalledWith('t_t', 'sess_t', {
        input_tokens: 10,
        output_tokens: 1,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      });
    });

    it('returns no-session message without recording when sessionId is unset', async () => {
      state.sessionId = null;
      const result = await collector.callTool('chinmeister_record_tokens', {
        input_tokens: 1,
        output_tokens: 1,
      });
      expect(team.recordSessionTokens).not.toHaveBeenCalled();
      expect(result.content[0].text).toMatch(/No active session/);
    });
  });

  describe('chinmeister_record_edit', () => {
    it('records the edit with line counts', async () => {
      const result = await collector.callTool('chinmeister_record_edit', {
        file: 'src/foo.ts',
        lines_added: 12,
        lines_removed: 3,
      });
      expect(team.recordEdit).toHaveBeenCalledWith('t_t', 'src/foo.ts', 12, 3);
      expect(result.content[0].text).toMatch(/Edit recorded: src\/foo\.ts \(\+12 \/ -3\)/);
    });

    it('omits the lines suffix when both are zero or missing', async () => {
      const result = await collector.callTool('chinmeister_record_edit', { file: 'src/bar.ts' });
      expect(team.recordEdit).toHaveBeenCalledWith('t_t', 'src/bar.ts', 0, 0);
      expect(result.content[0].text).toBe('Edit recorded: src/bar.ts.');
    });
  });

  describe('chinmeister_record_tool_call', () => {
    it('records a successful tool call', async () => {
      const result = await collector.callTool('chinmeister_record_tool_call', {
        tool_name: 'Read',
        success: true,
        duration_ms: 12,
      });
      expect(team.recordToolCalls).toHaveBeenCalledWith(
        't_t',
        'sess_t',
        expect.arrayContaining([
          expect.objectContaining({ tool: 'Read', is_error: false, duration_ms: 12 }),
        ]),
      );
      expect(result.content[0].text).toMatch(/Tool call recorded: Read succeeded/);
    });

    it('records a failed tool call and truncates the error preview', async () => {
      const longError = 'x'.repeat(500);
      const result = await collector.callTool('chinmeister_record_tool_call', {
        tool_name: 'Bash',
        success: false,
        error: longError,
      });
      const callArgs = team.recordToolCalls.mock.calls[0]?.[2]?.[0] ?? {};
      expect(callArgs.is_error).toBe(true);
      expect(callArgs.error_preview?.length).toBe(200);
      expect(result.content[0].text).toMatch(/Tool call recorded: Bash failed/);
    });

    it('returns no-session message when sessionId is unset', async () => {
      state.sessionId = null;
      const result = await collector.callTool('chinmeister_record_tool_call', {
        tool_name: 'Read',
        success: true,
      });
      expect(team.recordToolCalls).not.toHaveBeenCalled();
      expect(result.content[0].text).toMatch(/No active session/);
    });
  });
});

// =====================================================================
// memory.ts — consolidation, formation, batch, unmerge
// =====================================================================

describe('memory tools (consolidation/formation)', () => {
  let collector, team, state;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createToolCollector();
    team = createMockTeam();
    state = { teamId: 't_m' };
    teamPreamble.mockResolvedValue('');
    registerMemoryTools(collector.addTool, { team, state });
  });

  describe('chinmeister_delete_memories_batch', () => {
    it('errors when no filter provided', async () => {
      const result = await collector.callTool('chinmeister_delete_memories_batch', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Provide at least one of/);
      expect(team.deleteMemoriesBatch).not.toHaveBeenCalled();
    });

    it('deletes by ids and reports the count', async () => {
      team.deleteMemoriesBatch.mockResolvedValue({ ok: true, deleted: 3 });
      const result = await collector.callTool('chinmeister_delete_memories_batch', {
        ids: ['a', 'b', 'c'],
      });
      expect(team.deleteMemoriesBatch).toHaveBeenCalledWith('t_m', { ids: ['a', 'b', 'c'] });
      expect(result.content[0].text).toMatch(/Deleted 3 memories/);
    });

    it('passes tags and before through to the API', async () => {
      team.deleteMemoriesBatch.mockResolvedValue({ ok: true, deleted: 1 });
      await collector.callTool('chinmeister_delete_memories_batch', {
        tags: ['stale'],
        before: '2026-01-01',
      });
      expect(team.deleteMemoriesBatch).toHaveBeenCalledWith('t_m', {
        tags: ['stale'],
        before: '2026-01-01',
      });
    });

    it('surfaces API errors with isError', async () => {
      team.deleteMemoriesBatch.mockResolvedValue({ ok: false, error: 'rate limited' });
      const result = await collector.callTool('chinmeister_delete_memories_batch', {
        ids: ['a'],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Batch delete failed: rate limited/);
    });
  });

  describe('chinmeister_review_consolidation_proposals', () => {
    it('returns the empty-state message when no proposals', async () => {
      const result = await collector.callTool('chinmeister_review_consolidation_proposals', {});
      expect(result.content[0].text).toMatch(/No pending consolidation proposals/);
    });

    it('formats proposals with cosine and jaccard scores', async () => {
      team.listConsolidationProposals.mockResolvedValue({
        ok: true,
        proposals: [
          {
            id: 'p1',
            cosine: 0.92,
            jaccard: 0.81,
            source_id: 's1',
            target_id: 't1',
            source_text: 'source body',
            target_text: 'target body',
          },
        ],
      });
      const result = await collector.callTool('chinmeister_review_consolidation_proposals', {});
      expect(result.content[0].text).toMatch(/\[p1\] cosine 92\.0% \/ jaccard 81\.0%/);
      expect(result.content[0].text).toMatch(/source \(s1\): source body/);
      expect(result.content[0].text).toMatch(/target \(t1\): target body/);
    });

    it('surfaces API errors', async () => {
      team.listConsolidationProposals.mockResolvedValue({ ok: false, error: 'boom' });
      const result = await collector.callTool('chinmeister_review_consolidation_proposals', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Failed to load proposals: boom/);
    });
  });

  describe('chinmeister_apply_consolidation', () => {
    it('reports the merged ids on success', async () => {
      team.applyConsolidationProposal.mockResolvedValue({
        ok: true,
        source_id: 's1',
        target_id: 't1',
      });
      const result = await collector.callTool('chinmeister_apply_consolidation', {
        proposal_id: 'p1',
      });
      expect(team.applyConsolidationProposal).toHaveBeenCalledWith('t_m', 'p1');
      expect(result.content[0].text).toMatch(/Merged s1 into t1/);
    });

    it('surfaces API errors', async () => {
      team.applyConsolidationProposal.mockResolvedValue({ ok: false, error: 'gone' });
      const result = await collector.callTool('chinmeister_apply_consolidation', {
        proposal_id: 'p1',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Failed to apply proposal: gone/);
    });
  });

  describe('chinmeister_run_formation_sweep', () => {
    it('reports processed and skipped counts', async () => {
      team.runFormationSweep.mockResolvedValue({ ok: true, processed: 4, skipped: 1 });
      const result = await collector.callTool('chinmeister_run_formation_sweep', {});
      expect(result.content[0].text).toMatch(/Formation sweep: 4 processed, 1 skipped/);
    });

    it('defaults processed/skipped to 0 when missing', async () => {
      team.runFormationSweep.mockResolvedValue({ ok: true });
      const result = await collector.callTool('chinmeister_run_formation_sweep', {});
      expect(result.content[0].text).toMatch(/Formation sweep: 0 processed, 0 skipped/);
    });

    it('surfaces API errors', async () => {
      team.runFormationSweep.mockResolvedValue({ ok: false, error: 'timeout' });
      const result = await collector.callTool('chinmeister_run_formation_sweep', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Formation sweep failed: timeout/);
    });
  });

  describe('chinmeister_review_formation_observations', () => {
    it('returns the empty-state message when no observations', async () => {
      const result = await collector.callTool('chinmeister_review_formation_observations', {});
      expect(result.content[0].text).toMatch(/No formation observations/);
    });

    it('mentions the recommendation filter in the empty message', async () => {
      const result = await collector.callTool('chinmeister_review_formation_observations', {
        recommendation: 'merge',
      });
      expect(result.content[0].text).toMatch(/No formation observations matching merge/);
    });

    it('formats observations with confidence and reason', async () => {
      team.listFormationObservations.mockResolvedValue({
        ok: true,
        observations: [
          {
            memory_id: 'm1',
            target_id: 'm2',
            recommendation: 'merge',
            confidence: 0.83,
            llm_reason: 'duplicate of m2',
          },
          {
            memory_id: 'm3',
            recommendation: 'keep',
          },
        ],
      });
      const result = await collector.callTool('chinmeister_review_formation_observations', {
        recommendation: 'merge',
        limit: 10,
      });
      expect(team.listFormationObservations).toHaveBeenCalledWith('t_m', {
        recommendation: 'merge',
        limit: 10,
      });
      expect(result.content[0].text).toMatch(
        /\[merge \(conf 0\.83\)\] memory m1 -> m2 — duplicate/,
      );
      expect(result.content[0].text).toMatch(/\[keep\] memory m3/);
    });

    it('surfaces API errors', async () => {
      team.listFormationObservations.mockResolvedValue({ ok: false, error: 'down' });
      const result = await collector.callTool('chinmeister_review_formation_observations', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Failed to load observations: down/);
    });
  });

  describe('chinmeister_unmerge_memory', () => {
    it('confirms the restore', async () => {
      const result = await collector.callTool('chinmeister_unmerge_memory', {
        memory_id: 'mem_42',
      });
      expect(team.unmergeMemory).toHaveBeenCalledWith('t_m', 'mem_42');
      expect(result.content[0].text).toMatch(/Memory mem_42 restored/);
    });

    it('surfaces API errors', async () => {
      team.unmergeMemory.mockResolvedValue({ ok: false, error: 'not merged' });
      const result = await collector.callTool('chinmeister_unmerge_memory', {
        memory_id: 'mem_42',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Failed to unmerge mem_42: not merged/);
    });
  });
});
