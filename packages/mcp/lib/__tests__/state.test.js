import { describe, it, expect } from 'vitest';
import { createAgentState } from '../state.js';

describe('createAgentState (Proxy-based state guard)', () => {
  /** Helper: returns a realistic initial state matching McpState. */
  function makeInitial() {
    return {
      teamId: null,
      ws: null,
      sessionId: null,
      tty: null,
      modelReported: null,
      modelReportInflight: null,
      lastActivity: 0,
      heartbeatInterval: null,
      shuttingDown: false,
    };
  }

  // --- Setting valid keys ---

  it('allows setting teamId', () => {
    const state = createAgentState(makeInitial());
    state.teamId = 't_abc';
    expect(state.teamId).toBe('t_abc');
  });

  it('allows setting ws', () => {
    const state = createAgentState(makeInitial());
    const fakeWs = /** @type {any} */ ({});
    state.ws = fakeWs;
    expect(state.ws).toBe(fakeWs);
  });

  it('allows setting sessionId', () => {
    const state = createAgentState(makeInitial());
    state.sessionId = 'sess_123';
    expect(state.sessionId).toBe('sess_123');
  });

  it('allows setting tty', () => {
    const state = createAgentState(makeInitial());
    state.tty = '/dev/ttys001';
    expect(state.tty).toBe('/dev/ttys001');
  });

  it('allows setting modelReported', () => {
    const state = createAgentState(makeInitial());
    state.modelReported = 'claude-opus-4-20250514';
    expect(state.modelReported).toBe('claude-opus-4-20250514');
  });

  it('allows setting modelReportInflight', () => {
    const state = createAgentState(makeInitial());
    state.modelReportInflight = 'claude-opus-4-20250514';
    expect(state.modelReportInflight).toBe('claude-opus-4-20250514');
  });

  it('allows setting lastActivity', () => {
    const state = createAgentState(makeInitial());
    state.lastActivity = 1234567890;
    expect(state.lastActivity).toBe(1234567890);
  });

  it('allows setting heartbeatInterval', () => {
    const state = createAgentState(makeInitial());
    const id = setInterval(() => {}, 1000);
    state.heartbeatInterval = id;
    expect(state.heartbeatInterval).toBe(id);
    clearInterval(id);
  });

  it('allows setting shuttingDown', () => {
    const state = createAgentState(makeInitial());
    state.shuttingDown = true;
    expect(state.shuttingDown).toBe(true);
  });

  // --- Reading valid keys ---

  it('reads initial values correctly', () => {
    const initial = makeInitial();
    initial.teamId = 't_team1';
    initial.lastActivity = 999;
    const state = createAgentState(initial);

    expect(state.teamId).toBe('t_team1');
    expect(state.lastActivity).toBe(999);
    expect(state.ws).toBeNull();
    expect(state.shuttingDown).toBe(false);
  });

  // --- State preserves values after setting ---

  it('preserves values through multiple mutations', () => {
    const state = createAgentState(makeInitial());

    state.teamId = 't_first';
    state.sessionId = 'sess_1';
    state.shuttingDown = true;

    // Values should persist
    expect(state.teamId).toBe('t_first');
    expect(state.sessionId).toBe('sess_1');
    expect(state.shuttingDown).toBe(true);

    // Overwrite with new values
    state.teamId = 't_second';
    expect(state.teamId).toBe('t_second');
    // Other values remain
    expect(state.sessionId).toBe('sess_1');
  });

  it('allows overwriting a key with null', () => {
    const state = createAgentState(makeInitial());
    state.teamId = 't_abc';
    expect(state.teamId).toBe('t_abc');

    state.teamId = null;
    expect(state.teamId).toBeNull();
  });

  // --- Setting invalid keys throws ---

  it('throws when setting an undeclared property', () => {
    const state = createAgentState(makeInitial());
    expect(() => {
      /** @type {any} */ (state).bogusKey = 'value';
    }).toThrow('[chinwag] AgentState: unexpected property "bogusKey"');
  });

  it('throws for typo-like keys (temId instead of teamId)', () => {
    const state = createAgentState(makeInitial());
    expect(() => {
      /** @type {any} */ (state).temId = 't_abc';
    }).toThrow('unexpected property "temId"');
  });

  it('throws for numeric property names', () => {
    const state = createAgentState(makeInitial());
    expect(() => {
      /** @type {any} */ (state)[42] = 'value';
    }).toThrow('unexpected property "42"');
  });

  it('throw message includes the property name', () => {
    const state = createAgentState(makeInitial());
    try {
      /** @type {any} */ (state).xyzzy = true;
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.message).toContain('"xyzzy"');
      expect(err.message).toContain('Declare it in the createAgentState()');
    }
  });

  // --- Deletion is blocked ---

  it('throws when attempting to delete a property', () => {
    const state = createAgentState(makeInitial());
    expect(() => {
      delete (/** @type {any} */ (state).teamId);
    }).toThrow('[chinwag] AgentState: cannot delete property "teamId"');
  });

  it('throws when deleting an undeclared property', () => {
    const state = createAgentState(makeInitial());
    expect(() => {
      delete (/** @type {any} */ (state).nonexistent);
    }).toThrow('cannot delete property');
  });

  // --- Does not leak initial state ---

  it('does not share state between two instances', () => {
    const state1 = createAgentState(makeInitial());
    const state2 = createAgentState(makeInitial());

    state1.teamId = 't_one';
    state2.teamId = 't_two';

    expect(state1.teamId).toBe('t_one');
    expect(state2.teamId).toBe('t_two');
  });

  it('mutations do not affect the original initial object', () => {
    const initial = makeInitial();
    const state = createAgentState(initial);
    state.teamId = 't_mutated';

    expect(initial.teamId).toBeNull();
  });
});
