import { describe, expect, it } from 'vitest';
import {
  isAgentAddressable,
  getAgentTargetLabel,
  getAgentIntent,
  getAgentOriginLabel,
  getAgentDisplayLabel,
  getIntentColor,
  getAgentMeta,
  getRecentResultSummary,
} from '../dashboard/agent-display.js';

// ── isAgentAddressable ─────────────────────────────────

describe('isAgentAddressable', () => {
  it('returns false for null/undefined', () => {
    expect(isAgentAddressable(null)).toBe(false);
    expect(isAgentAddressable(undefined)).toBe(false);
  });

  it('returns false when no agent_id', () => {
    expect(isAgentAddressable({ _managed: true, status: 'running' })).toBe(false);
  });

  it('returns true for running managed agent with agent_id', () => {
    expect(isAgentAddressable({ agent_id: 'a:b:c', _managed: true, status: 'running' })).toBe(true);
  });

  it('returns false for exited managed agent', () => {
    expect(isAgentAddressable({ agent_id: 'a:b:c', _managed: true, status: 'exited' })).toBe(false);
  });

  it('returns true for active connected agent', () => {
    expect(isAgentAddressable({ agent_id: 'a:b:c', _managed: false, status: 'active' })).toBe(true);
  });

  it('returns false for non-active connected agent', () => {
    expect(isAgentAddressable({ agent_id: 'a:b:c', _managed: false, status: 'idle' })).toBe(false);
  });
});

// ── getAgentTargetLabel ────────────────────────────────

describe('getAgentTargetLabel', () => {
  it('returns "agent" for null', () => {
    expect(getAgentTargetLabel(null)).toBe('agent');
  });

  it('returns handle and display combined', () => {
    expect(getAgentTargetLabel({ handle: 'alice', _display: 'Claude Code' })).toBe(
      'alice (Claude Code)',
    );
  });

  it('returns just handle when no display', () => {
    expect(getAgentTargetLabel({ handle: 'alice' })).toBe('alice');
  });

  it('returns just display when no handle', () => {
    expect(getAgentTargetLabel({ _display: 'Claude Code' })).toBe('Claude Code');
  });

  it('returns "agent" when nothing is set', () => {
    expect(getAgentTargetLabel({})).toBe('agent');
  });
});

// ── getAgentIntent ─────────────────────────────────────

describe('getAgentIntent', () => {
  it('returns null for null agent', () => {
    expect(getAgentIntent(null)).toBeNull();
  });

  it('returns outputPreview for dead managed agents', () => {
    expect(getAgentIntent({ _managed: true, _dead: true, outputPreview: 'Done!' })).toBe('Done!');
  });

  it('returns _summary when available', () => {
    expect(getAgentIntent({ _summary: 'Refactoring auth' })).toBe('Refactoring auth');
  });

  it('returns formatted files when no summary', () => {
    expect(getAgentIntent({ activity: { files: ['src/a.js'] } })).toBe('a.js');
  });

  it('returns task for managed agents with no other info', () => {
    expect(getAgentIntent({ _managed: true, task: 'Fix bug', activity: {} })).toBe('Fix bug');
  });

  it('returns "Idle" as last resort', () => {
    expect(getAgentIntent({ activity: {} })).toBe('Idle');
    expect(getAgentIntent({})).toBe('Idle');
  });

  it('prefers outputPreview over summary for dead managed agents', () => {
    expect(
      getAgentIntent({
        _managed: true,
        _dead: true,
        outputPreview: 'Exit output',
        _summary: 'Some summary',
      }),
    ).toBe('Exit output');
  });
});

// ── getAgentOriginLabel ────────────────────────────────

describe('getAgentOriginLabel', () => {
  it('returns null for null agent', () => {
    expect(getAgentOriginLabel(null)).toBeNull();
  });

  it('returns "started here" for managed + connected', () => {
    expect(getAgentOriginLabel({ _managed: true, _connected: true })).toBe('started here');
  });

  it('returns "starting here" for managed but not connected', () => {
    expect(getAgentOriginLabel({ _managed: true, _connected: false })).toBe('starting here');
  });

  it('returns "joined automatically" for non-managed', () => {
    expect(getAgentOriginLabel({ _managed: false })).toBe('joined automatically');
  });
});

// ── getAgentDisplayLabel ───────────────────────────────

describe('getAgentDisplayLabel', () => {
  it('returns "agent" for null', () => {
    expect(getAgentDisplayLabel(null)).toBe('agent');
  });

  it('returns _display as base label', () => {
    expect(getAgentDisplayLabel({ _display: 'Claude Code' })).toBe('Claude Code');
  });

  it('falls back to toolName', () => {
    expect(getAgentDisplayLabel({ toolName: 'Cursor' })).toBe('Cursor');
  });

  it('falls back to tool', () => {
    expect(getAgentDisplayLabel({ tool: 'aider' })).toBe('aider');
  });

  it('falls back to "agent"', () => {
    expect(getAgentDisplayLabel({})).toBe('agent');
  });

  it('adds index when allAgents contains duplicates', () => {
    const agents = [
      { agent_id: 'a', _display: 'Claude Code' },
      { agent_id: 'b', _display: 'Claude Code' },
      { agent_id: 'c', _display: 'Cursor' },
    ];
    // First occurrence gets no suffix
    expect(getAgentDisplayLabel(agents[0], null, agents)).toBe('Claude Code');
    // Second occurrence gets #2
    expect(getAgentDisplayLabel(agents[1], null, agents)).toBe('Claude Code #2');
    // Unique name gets no suffix
    expect(getAgentDisplayLabel(agents[2], null, agents)).toBe('Cursor');
  });
});

// ── getIntentColor ─────────────────────────────────────

describe('getIntentColor', () => {
  it('returns gray for null', () => {
    expect(getIntentColor(null)).toBe('gray');
  });

  it('returns yellow for idle', () => {
    expect(getIntentColor('Idle')).toBe('yellow');
    expect(getIntentColor('idle')).toBe('yellow');
  });

  it('returns red for errors/failures', () => {
    expect(getIntentColor('error: crash')).toBe('red');
    expect(getIntentColor('Task failed')).toBe('red');
    expect(getIntentColor('Blocked on review')).toBe('red');
    expect(getIntentColor('File conflict detected')).toBe('red');
  });

  it('returns cyan for normal activity', () => {
    expect(getIntentColor('Refactoring auth')).toBe('cyan');
    expect(getIntentColor('src/app.js')).toBe('cyan');
  });
});

// ── getAgentMeta ───────────────────────────────────────

describe('getAgentMeta', () => {
  it('returns null for null agent', () => {
    expect(getAgentMeta(null)).toBeNull();
  });

  it('includes origin label', () => {
    const meta = getAgentMeta({ _managed: true, _connected: true });
    expect(meta).toContain('started here');
  });

  it('includes formatted files', () => {
    const meta = getAgentMeta({ _managed: false, activity: { files: ['src/app.js'] } });
    expect(meta).toContain('app.js');
  });

  it('includes update timestamp', () => {
    const meta = getAgentMeta({ _managed: false, minutes_since_update: 5 });
    expect(meta).toContain('updated 5m ago');
  });

  it('excludes zero minutes_since_update', () => {
    const meta = getAgentMeta({ _managed: false, minutes_since_update: 0 });
    expect(meta).not.toContain('updated');
  });

  it('joins parts with centered dot separator', () => {
    const meta = getAgentMeta({
      _managed: false,
      activity: { files: ['x.js'] },
      minutes_since_update: 2,
    });
    expect(meta).toContain(' \u00b7 ');
  });
});

// ── getRecentResultSummary ─────────────────────────────

describe('getRecentResultSummary', () => {
  it('returns tool state detail for failed agents with tool state', () => {
    expect(getRecentResultSummary({ _failed: true }, { detail: 'Auth expired' })).toBe(
      'Auth expired',
    );
  });

  it('returns outputPreview when available', () => {
    expect(getRecentResultSummary({ outputPreview: 'Done: 5 files changed' }, null)).toBe(
      'Done: 5 files changed',
    );
  });

  it('returns task when available', () => {
    expect(getRecentResultSummary({ task: 'Fix login' }, null)).toBe('Fix login');
  });

  it('returns "Task failed" for failed agents with no detail', () => {
    expect(getRecentResultSummary({ _failed: true }, null)).toBe('Task failed');
  });

  it('returns "Task completed" for non-failed agents with no detail', () => {
    expect(getRecentResultSummary({}, null)).toBe('Task completed');
  });
});
