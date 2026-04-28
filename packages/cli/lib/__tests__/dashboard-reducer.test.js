import { describe, expect, it } from 'vitest';
import {
  // Action types
  NAVIGATE_TO_VIEW,
  SET_SELECTED_IDX,
  SET_MAIN_FOCUS,
  SET_HERO_INPUT,
  SET_HERO_INPUT_ACTIVE,
  SET_FOCUSED_AGENT,
  SET_SHOW_DIAGNOSTICS,
  TOGGLE_DIAGNOSTICS,
  SET_NOTICE,
  CLEAR_NOTICE,
  CLAMP_SELECTION,
  ENTER_AGENT_FOCUS,
  EXIT_AGENT_FOCUS,
  // Action creators
  navigateToView,
  setSelectedIdx,
  setMainFocus,
  setHeroInput,
  setHeroInputActive,
  setFocusedAgent,
  setShowDiagnostics,
  toggleDiagnostics,
  setNotice,
  clearNotice,
  clampSelection,
  enterAgentFocus,
  exitAgentFocus,
  // Reducer + initial state
  createInitialState,
  dashboardReducer,
} from '../dashboard/reducer.js';

// ── Action Creator Tests ────────────────────────────

describe('action creators', () => {
  it('navigateToView returns correct type and view', () => {
    expect(navigateToView('sessions')).toEqual({ type: NAVIGATE_TO_VIEW, view: 'sessions' });
    expect(navigateToView('memory')).toEqual({ type: NAVIGATE_TO_VIEW, view: 'memory' });
  });

  it('setSelectedIdx returns correct type with value', () => {
    expect(setSelectedIdx(3)).toEqual({ type: SET_SELECTED_IDX, idx: 3 });
  });

  it('setSelectedIdx supports functional updaters', () => {
    const action = setSelectedIdx((prev) => prev + 1);
    expect(action.type).toBe(SET_SELECTED_IDX);
    expect(typeof action.idx).toBe('function');
    expect(action.idx(5)).toBe(6);
  });

  it('setMainFocus returns correct type and focus', () => {
    expect(setMainFocus('agents')).toEqual({ type: SET_MAIN_FOCUS, focus: 'agents' });
    expect(setMainFocus('input')).toEqual({ type: SET_MAIN_FOCUS, focus: 'input' });
  });

  it('setHeroInput returns correct type and text', () => {
    expect(setHeroInput('hello')).toEqual({ type: SET_HERO_INPUT, text: 'hello' });
  });

  it('setHeroInputActive returns correct type and active flag', () => {
    expect(setHeroInputActive(true)).toEqual({ type: SET_HERO_INPUT_ACTIVE, active: true });
    expect(setHeroInputActive(false)).toEqual({ type: SET_HERO_INPUT_ACTIVE, active: false });
  });

  it('setFocusedAgent returns correct type and agent', () => {
    const agent = { id: 1, tool: 'claude-code' };
    expect(setFocusedAgent(agent)).toEqual({ type: SET_FOCUSED_AGENT, agent });
    expect(setFocusedAgent(null)).toEqual({ type: SET_FOCUSED_AGENT, agent: null });
  });

  it('setShowDiagnostics returns correct type and show flag', () => {
    expect(setShowDiagnostics(true)).toEqual({ type: SET_SHOW_DIAGNOSTICS, show: true });
    expect(setShowDiagnostics(false)).toEqual({ type: SET_SHOW_DIAGNOSTICS, show: false });
  });

  it('toggleDiagnostics returns correct type', () => {
    expect(toggleDiagnostics()).toEqual({ type: TOGGLE_DIAGNOSTICS });
  });

  it('setNotice returns correct type, text, and tone', () => {
    expect(setNotice('hello', 'success')).toEqual({
      type: SET_NOTICE,
      text: 'hello',
      tone: 'success',
    });
    expect(setNotice('info msg')).toEqual({ type: SET_NOTICE, text: 'info msg', tone: 'info' });
  });

  it('clearNotice returns correct type with optional matchText', () => {
    expect(clearNotice()).toEqual({ type: CLEAR_NOTICE, matchText: null });
    expect(clearNotice('specific')).toEqual({ type: CLEAR_NOTICE, matchText: 'specific' });
  });

  it('clampSelection returns correct type and listLength', () => {
    expect(clampSelection(5)).toEqual({ type: CLAMP_SELECTION, listLength: 5 });
    expect(clampSelection(0)).toEqual({ type: CLAMP_SELECTION, listLength: 0 });
  });

  it('enterAgentFocus returns correct type and agent', () => {
    const agent = { id: 1, _display: 'Claude Code' };
    expect(enterAgentFocus(agent)).toEqual({ type: ENTER_AGENT_FOCUS, agent });
  });

  it('exitAgentFocus returns correct type', () => {
    expect(exitAgentFocus()).toEqual({ type: EXIT_AGENT_FOCUS });
  });
});

// ── Initial State Tests ─────────────────────────────

describe('createInitialState', () => {
  it('returns the default state', () => {
    const state = createInitialState();
    expect(state).toEqual({
      view: 'home',
      selectedIdx: -1,
      mainFocus: 'input',
      heroInput: '',
      heroInputActive: false,
      focusedAgent: null,
      showDiagnostics: false,
      notice: null,
    });
  });

  it('returns a new object each time', () => {
    const a = createInitialState();
    const b = createInitialState();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ── Reducer Tests ───────────────────────────────────

describe('dashboardReducer', () => {
  function defaultState(overrides = {}) {
    return { ...createInitialState(), ...overrides };
  }

  // ── NAVIGATE_TO_VIEW ───────────────────────────────

  describe('NAVIGATE_TO_VIEW', () => {
    it('navigates to a valid view', () => {
      const state = defaultState();
      expect(dashboardReducer(state, navigateToView('sessions')).view).toBe('sessions');
      expect(dashboardReducer(state, navigateToView('memory')).view).toBe('memory');
      expect(dashboardReducer(state, navigateToView('agent-focus')).view).toBe('agent-focus');
      expect(dashboardReducer(state, navigateToView('home')).view).toBe('home');
    });

    it('ignores invalid view names', () => {
      const state = defaultState({ view: 'home' });
      const result = dashboardReducer(state, navigateToView('invalid-view'));
      expect(result).toBe(state); // same reference - no change
    });
  });

  // ── SET_SELECTED_IDX ───────────────────────────────

  describe('SET_SELECTED_IDX', () => {
    it('sets a numeric index', () => {
      const state = defaultState();
      expect(dashboardReducer(state, setSelectedIdx(3)).selectedIdx).toBe(3);
    });

    it('supports functional updater', () => {
      const state = defaultState({ selectedIdx: 2 });
      const result = dashboardReducer(
        state,
        setSelectedIdx((prev) => prev + 1),
      );
      expect(result.selectedIdx).toBe(3);
    });

    it('handles negative index', () => {
      const state = defaultState({ selectedIdx: 5 });
      expect(dashboardReducer(state, setSelectedIdx(-1)).selectedIdx).toBe(-1);
    });
  });

  // ── SET_MAIN_FOCUS ─────────────────────────────────

  describe('SET_MAIN_FOCUS', () => {
    it('sets focus to agents', () => {
      const state = defaultState();
      expect(dashboardReducer(state, setMainFocus('agents')).mainFocus).toBe('agents');
    });

    it('sets focus to input', () => {
      const state = defaultState({ mainFocus: 'agents' });
      expect(dashboardReducer(state, setMainFocus('input')).mainFocus).toBe('input');
    });
  });

  // ── SET_HERO_INPUT ─────────────────────────────────

  describe('SET_HERO_INPUT', () => {
    it('sets hero input text', () => {
      const state = defaultState();
      expect(dashboardReducer(state, setHeroInput('search query')).heroInput).toBe('search query');
    });

    it('can clear hero input', () => {
      const state = defaultState({ heroInput: 'text' });
      expect(dashboardReducer(state, setHeroInput('')).heroInput).toBe('');
    });
  });

  // ── SET_HERO_INPUT_ACTIVE ──────────────────────────

  describe('SET_HERO_INPUT_ACTIVE', () => {
    it('activates hero input', () => {
      const state = defaultState();
      expect(dashboardReducer(state, setHeroInputActive(true)).heroInputActive).toBe(true);
    });
  });

  // ── SET_FOCUSED_AGENT ──────────────────────────────

  describe('SET_FOCUSED_AGENT', () => {
    it('sets focused agent', () => {
      const agent = { id: 1, tool: 'cursor' };
      const state = defaultState();
      expect(dashboardReducer(state, setFocusedAgent(agent)).focusedAgent).toBe(agent);
    });

    it('clears focused agent', () => {
      const state = defaultState({ focusedAgent: { id: 1 } });
      expect(dashboardReducer(state, setFocusedAgent(null)).focusedAgent).toBeNull();
    });
  });

  // ── SET_SHOW_DIAGNOSTICS / TOGGLE ──────────────────

  describe('SET_SHOW_DIAGNOSTICS', () => {
    it('sets diagnostics visibility', () => {
      expect(dashboardReducer(defaultState(), setShowDiagnostics(true)).showDiagnostics).toBe(true);
      expect(
        dashboardReducer(defaultState({ showDiagnostics: true }), setShowDiagnostics(false))
          .showDiagnostics,
      ).toBe(false);
    });
  });

  describe('TOGGLE_DIAGNOSTICS', () => {
    it('toggles diagnostics from false to true', () => {
      const state = defaultState({ showDiagnostics: false });
      expect(dashboardReducer(state, toggleDiagnostics()).showDiagnostics).toBe(true);
    });

    it('toggles diagnostics from true to false', () => {
      const state = defaultState({ showDiagnostics: true });
      expect(dashboardReducer(state, toggleDiagnostics()).showDiagnostics).toBe(false);
    });
  });

  // ── SET_NOTICE / CLEAR_NOTICE ──────────────────────

  describe('SET_NOTICE', () => {
    it('sets a notice', () => {
      const state = defaultState();
      const result = dashboardReducer(state, setNotice('hello', 'success'));
      expect(result.notice).toEqual({ text: 'hello', tone: 'success' });
    });
  });

  describe('CLEAR_NOTICE', () => {
    it('clears notice unconditionally when no matchText', () => {
      const state = defaultState({ notice: { text: 'test', tone: 'info' } });
      expect(dashboardReducer(state, clearNotice()).notice).toBeNull();
    });

    it('clears notice when matchText matches', () => {
      const state = defaultState({ notice: { text: 'specific', tone: 'info' } });
      expect(dashboardReducer(state, clearNotice('specific')).notice).toBeNull();
    });

    it('does not clear notice when matchText does not match', () => {
      const state = defaultState({ notice: { text: 'different', tone: 'info' } });
      const result = dashboardReducer(state, clearNotice('specific'));
      expect(result).toBe(state); // same reference
      expect(result.notice).toEqual({ text: 'different', tone: 'info' });
    });

    it('handles clearing when no notice exists', () => {
      const state = defaultState({ notice: null });
      const result = dashboardReducer(state, clearNotice());
      expect(result.notice).toBeNull();
    });
  });

  // ── CLAMP_SELECTION ────────────────────────────────

  describe('CLAMP_SELECTION', () => {
    it('resets to -1 and input focus when list is empty', () => {
      const state = defaultState({ selectedIdx: 3, mainFocus: 'agents' });
      const result = dashboardReducer(state, clampSelection(0));
      expect(result.selectedIdx).toBe(-1);
      expect(result.mainFocus).toBe('input');
    });

    it('does nothing when list is empty and already at defaults', () => {
      const state = defaultState({ selectedIdx: -1, mainFocus: 'input' });
      const result = dashboardReducer(state, clampSelection(0));
      expect(result).toBe(state); // same reference - no update
    });

    it('clamps index when it exceeds list length', () => {
      const state = defaultState({ selectedIdx: 10 });
      const result = dashboardReducer(state, clampSelection(5));
      expect(result.selectedIdx).toBe(4);
    });

    it('does not change index when within bounds', () => {
      const state = defaultState({ selectedIdx: 2 });
      const result = dashboardReducer(state, clampSelection(5));
      expect(result).toBe(state); // same reference - no update
    });

    it('does not change index of -1 when list is non-empty', () => {
      const state = defaultState({ selectedIdx: -1 });
      const result = dashboardReducer(state, clampSelection(3));
      expect(result).toBe(state);
    });
  });

  // ── ENTER_AGENT_FOCUS / EXIT_AGENT_FOCUS ───────────

  describe('ENTER_AGENT_FOCUS', () => {
    it('sets agent, view, and resets diagnostics', () => {
      const agent = { id: 1, _display: 'Claude Code' };
      const state = defaultState({ showDiagnostics: true, view: 'home' });
      const result = dashboardReducer(state, enterAgentFocus(agent));
      expect(result.focusedAgent).toBe(agent);
      expect(result.view).toBe('agent-focus');
      expect(result.showDiagnostics).toBe(false);
    });
  });

  describe('EXIT_AGENT_FOCUS', () => {
    it('returns to home, clears agent and diagnostics', () => {
      const state = defaultState({
        view: 'agent-focus',
        focusedAgent: { id: 1 },
        showDiagnostics: true,
      });
      const result = dashboardReducer(state, exitAgentFocus());
      expect(result.view).toBe('home');
      expect(result.focusedAgent).toBeNull();
      expect(result.showDiagnostics).toBe(false);
    });
  });

  // ── Unknown action ─────────────────────────────────

  describe('unknown action', () => {
    it('returns the same state reference for unknown action types', () => {
      const state = defaultState();
      const result = dashboardReducer(state, { type: 'DOES_NOT_EXIST' });
      expect(result).toBe(state);
    });
  });
});
