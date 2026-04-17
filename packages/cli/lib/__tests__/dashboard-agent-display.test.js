import { describe, it, expect } from 'vitest';
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

describe('isAgentAddressable', () => {
  it('returns false for null/undefined', () => {
    expect(isAgentAddressable(null)).toBe(false);
    expect(isAgentAddressable(undefined)).toBe(false);
  });

  it('returns false for agent without agent_id', () => {
    expect(isAgentAddressable({ status: 'active' })).toBe(false);
  });

  it('returns true for managed running agent', () => {
    expect(isAgentAddressable({ agent_id: 'a1', _managed: true, status: 'running' })).toBe(true);
  });

  it('returns false for managed non-running agent', () => {
    expect(isAgentAddressable({ agent_id: 'a1', _managed: true, status: 'exited' })).toBe(false);
  });

  it('returns true for non-managed active agent', () => {
    expect(isAgentAddressable({ agent_id: 'a1', status: 'active' })).toBe(true);
  });

  it('returns false for non-managed idle agent', () => {
    expect(isAgentAddressable({ agent_id: 'a1', status: 'idle' })).toBe(false);
  });
});

describe('getAgentTargetLabel', () => {
  it('returns "agent" for null', () => {
    expect(getAgentTargetLabel(null)).toBe('agent');
  });

  it('returns combined handle and display name', () => {
    expect(getAgentTargetLabel({ handle: 'alice', _display: 'Claude Code' })).toBe(
      'alice (Claude Code)',
    );
  });

  it('falls back to handle alone', () => {
    expect(getAgentTargetLabel({ handle: 'alice' })).toBe('alice');
  });

  it('falls back to display name alone', () => {
    expect(getAgentTargetLabel({ _display: 'Claude Code' })).toBe('Claude Code');
  });
});

describe('getAgentIntent', () => {
  it('returns null for null agent', () => {
    expect(getAgentIntent(null)).toBeNull();
  });

  it('returns output preview for dead managed agent', () => {
    expect(getAgentIntent({ _managed: true, _dead: true, outputPreview: 'Done refactoring' })).toBe(
      'Done refactoring',
    );
  });

  it('returns summary when available', () => {
    expect(getAgentIntent({ _summary: 'Refactoring auth' })).toBe('Refactoring auth');
  });

  it('returns formatted files when no summary', () => {
    expect(getAgentIntent({ activity: { files: ['src/a.js'] } })).toBe('a.js');
  });

  it('returns task for managed agent with no other info', () => {
    expect(getAgentIntent({ _managed: true, task: 'Fix the login bug' })).toBe('Fix the login bug');
  });

  it('returns Idle as last resort', () => {
    expect(getAgentIntent({})).toBe('Idle');
  });
});

describe('getAgentOriginLabel', () => {
  it('returns null for null agent', () => {
    expect(getAgentOriginLabel(null)).toBeNull();
  });

  it('returns "started here" for managed+connected', () => {
    expect(getAgentOriginLabel({ _managed: true, _connected: true })).toBe('started here');
  });

  it('returns "starting here" for managed but not yet connected', () => {
    expect(getAgentOriginLabel({ _managed: true, _connected: false })).toBe('starting here');
  });

  it('returns "joined automatically" for non-managed', () => {
    expect(getAgentOriginLabel({ _managed: false })).toBe('joined automatically');
  });
});

describe('getAgentDisplayLabel', () => {
  it('returns "agent" for null', () => {
    expect(getAgentDisplayLabel(null)).toBe('agent');
  });

  it('returns display name as base label', () => {
    expect(getAgentDisplayLabel({ _display: 'Claude Code' })).toBe('Claude Code');
  });

  it('falls through to toolName, then tool', () => {
    expect(getAgentDisplayLabel({ toolName: 'Cursor' })).toBe('Cursor');
    expect(getAgentDisplayLabel({ tool: 'aider' })).toBe('aider');
  });

  it('appends index when multiple agents share a name', () => {
    const agents = [
      { agent_id: 'a1', _display: 'Claude Code' },
      { agent_id: 'a2', _display: 'Claude Code' },
    ];
    expect(getAgentDisplayLabel(agents[0], new Map(), agents)).toBe('Claude Code');
    expect(getAgentDisplayLabel(agents[1], new Map(), agents)).toBe('Claude Code #2');
  });

  it('does not append index for single agent', () => {
    const agents = [{ agent_id: 'a1', _display: 'Claude Code' }];
    expect(getAgentDisplayLabel(agents[0], new Map(), agents)).toBe('Claude Code');
  });
});

describe('getIntentColor', () => {
  it('returns gray for null/empty intent', () => {
    expect(getIntentColor(null)).toBe('gray');
    expect(getIntentColor('')).toBe('gray');
  });

  it('returns yellow for idle-like intents', () => {
    expect(getIntentColor('Idle')).toBe('yellow');
    expect(getIntentColor('idle')).toBe('yellow');
  });

  it('returns red for error/failure intents', () => {
    expect(getIntentColor('error occurred')).toBe('red');
    expect(getIntentColor('Task failed')).toBe('red');
    expect(getIntentColor('blocked on input')).toBe('red');
    expect(getIntentColor('merge conflict')).toBe('red');
  });

  it('returns cyan for normal activity', () => {
    expect(getIntentColor('Refactoring auth flow')).toBe('cyan');
  });
});

describe('getAgentMeta', () => {
  it('returns null for null agent', () => {
    expect(getAgentMeta(null)).toBeNull();
  });

  it('includes origin label', () => {
    const meta = getAgentMeta({ _managed: true, _connected: true });
    expect(meta).toContain('started here');
  });

  it('includes files when present', () => {
    const meta = getAgentMeta({
      _managed: false,
      activity: { files: ['src/auth.js'] },
    });
    expect(meta).toContain('auth.js');
  });

  it('includes update age when available', () => {
    const meta = getAgentMeta({ _managed: false, minutes_since_update: 5 });
    expect(meta).toContain('updated 5m ago');
  });

  it('joins parts with middle dot separator', () => {
    const meta = getAgentMeta({
      _managed: false,
      activity: { files: ['src/a.js'] },
      minutes_since_update: 3,
    });
    expect(meta).toContain('\u00b7');
  });
});

describe('getRecentResultSummary', () => {
  it('returns tool state detail for failed agent with detail', () => {
    expect(getRecentResultSummary({ _failed: true }, { detail: 'Auth expired' })).toBe(
      'Auth expired',
    );
  });

  it('returns output preview when available', () => {
    expect(getRecentResultSummary({ outputPreview: 'Refactored 3 files' }, null)).toBe(
      'Refactored 3 files',
    );
  });

  it('returns task when available', () => {
    expect(getRecentResultSummary({ task: 'Fix login bug' }, null)).toBe('Fix login bug');
  });

  it('returns generic failure message for failed agent', () => {
    expect(getRecentResultSummary({ _failed: true }, null)).toBe('Task failed');
  });

  it('returns generic completion message otherwise', () => {
    expect(getRecentResultSummary({}, null)).toBe('Task completed');
  });
});
