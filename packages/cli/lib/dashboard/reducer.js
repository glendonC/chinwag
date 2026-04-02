// ── Action Types ───────────────────────────────────
export const NAVIGATE_TO_VIEW = 'NAVIGATE_TO_VIEW';
export const SET_SELECTED_IDX = 'SET_SELECTED_IDX';
export const SET_MAIN_FOCUS = 'SET_MAIN_FOCUS';
export const SET_HERO_INPUT = 'SET_HERO_INPUT';
export const SET_HERO_INPUT_ACTIVE = 'SET_HERO_INPUT_ACTIVE';
export const SET_FOCUSED_AGENT = 'SET_FOCUSED_AGENT';
export const SET_SHOW_DIAGNOSTICS = 'SET_SHOW_DIAGNOSTICS';
export const TOGGLE_DIAGNOSTICS = 'TOGGLE_DIAGNOSTICS';
export const SET_NOTICE = 'SET_NOTICE';
export const CLEAR_NOTICE = 'CLEAR_NOTICE';
export const CLAMP_SELECTION = 'CLAMP_SELECTION';
export const ENTER_AGENT_FOCUS = 'ENTER_AGENT_FOCUS';
export const EXIT_AGENT_FOCUS = 'EXIT_AGENT_FOCUS';

// ── Initial State ──────────────────────────────────

/** @returns {DashboardState} */
export function createInitialState() {
  return {
    view: 'home',
    selectedIdx: -1,
    mainFocus: 'input',
    heroInput: '',
    heroInputActive: false,
    focusedAgent: null,
    showDiagnostics: false,
    notice: null,
  };
}

// ── Action Creators ────────────────────────────────

/**
 * Navigate to a dashboard view.
 * @param {'home'|'sessions'|'memory'|'agent-focus'} view
 * @returns {{ type: typeof NAVIGATE_TO_VIEW, view: string }}
 */
export function navigateToView(view) {
  return { type: NAVIGATE_TO_VIEW, view };
}

/**
 * Set the selected index in the agent/memory list.
 * @param {number|((prev: number) => number)} idx
 * @returns {{ type: typeof SET_SELECTED_IDX, idx: number|Function }}
 */
export function setSelectedIdx(idx) {
  return { type: SET_SELECTED_IDX, idx };
}

/**
 * Set which pane has focus (input bar vs agent list).
 * @param {'input'|'agents'} focus
 * @returns {{ type: typeof SET_MAIN_FOCUS, focus: string }}
 */
export function setMainFocus(focus) {
  return { type: SET_MAIN_FOCUS, focus };
}

/**
 * Set the hero input text.
 * @param {string} text
 * @returns {{ type: typeof SET_HERO_INPUT, text: string }}
 */
export function setHeroInput(text) {
  return { type: SET_HERO_INPUT, text };
}

/**
 * Set whether the hero input is active.
 * @param {boolean} active
 * @returns {{ type: typeof SET_HERO_INPUT_ACTIVE, active: boolean }}
 */
export function setHeroInputActive(active) {
  return { type: SET_HERO_INPUT_ACTIVE, active };
}

/**
 * Set the currently focused agent (for agent-focus view).
 * @param {object|null} agent
 * @returns {{ type: typeof SET_FOCUSED_AGENT, agent: object|null }}
 */
export function setFocusedAgent(agent) {
  return { type: SET_FOCUSED_AGENT, agent };
}

/**
 * Set diagnostics panel visibility.
 * @param {boolean} show
 * @returns {{ type: typeof SET_SHOW_DIAGNOSTICS, show: boolean }}
 */
export function setShowDiagnostics(show) {
  return { type: SET_SHOW_DIAGNOSTICS, show };
}

/**
 * Toggle diagnostics panel visibility.
 * @returns {{ type: typeof TOGGLE_DIAGNOSTICS }}
 */
export function toggleDiagnostics() {
  return { type: TOGGLE_DIAGNOSTICS };
}

/**
 * Set a flash notification.
 * @param {string} text
 * @param {'info'|'success'|'warning'|'error'} tone
 * @returns {{ type: typeof SET_NOTICE, text: string, tone: string }}
 */
export function setNotice(text, tone = 'info') {
  return { type: SET_NOTICE, text, tone };
}

/**
 * Clear the flash notification (optionally only if it matches a specific text).
 * @param {string|null} [matchText] - Only clear if the current notice matches this text.
 * @returns {{ type: typeof CLEAR_NOTICE, matchText?: string }}
 */
export function clearNotice(matchText = null) {
  return { type: CLEAR_NOTICE, matchText };
}

/**
 * Clamp the selected index to the list bounds. Resets focus if the list is empty.
 * @param {number} listLength
 * @returns {{ type: typeof CLAMP_SELECTION, listLength: number }}
 */
export function clampSelection(listLength) {
  return { type: CLAMP_SELECTION, listLength };
}

/**
 * Enter agent focus view for a specific agent.
 * @param {object} agent
 * @returns {{ type: typeof ENTER_AGENT_FOCUS, agent: object }}
 */
export function enterAgentFocus(agent) {
  return { type: ENTER_AGENT_FOCUS, agent };
}

/**
 * Exit agent focus view and return to home.
 * @returns {{ type: typeof EXIT_AGENT_FOCUS }}
 */
export function exitAgentFocus() {
  return { type: EXIT_AGENT_FOCUS };
}

// ── Reducer ────────────────────────────────────────

/**
 * @typedef {ReturnType<typeof createInitialState>} DashboardState
 */

/**
 * Dashboard state reducer.
 * @param {DashboardState} state
 * @param {object} action
 * @returns {DashboardState}
 */
export function dashboardReducer(state, action) {
  switch (action.type) {
    case NAVIGATE_TO_VIEW: {
      const validViews = new Set(['home', 'sessions', 'memory', 'agent-focus']);
      if (!validViews.has(action.view)) return state;
      return { ...state, view: action.view };
    }

    case SET_SELECTED_IDX: {
      const idx = typeof action.idx === 'function' ? action.idx(state.selectedIdx) : action.idx;
      return { ...state, selectedIdx: idx };
    }

    case SET_MAIN_FOCUS:
      return { ...state, mainFocus: action.focus };

    case SET_HERO_INPUT:
      return { ...state, heroInput: action.text };

    case SET_HERO_INPUT_ACTIVE:
      return { ...state, heroInputActive: action.active };

    case SET_FOCUSED_AGENT:
      return { ...state, focusedAgent: action.agent };

    case SET_SHOW_DIAGNOSTICS:
      return { ...state, showDiagnostics: action.show };

    case TOGGLE_DIAGNOSTICS:
      return { ...state, showDiagnostics: !state.showDiagnostics };

    case SET_NOTICE:
      return { ...state, notice: { text: action.text, tone: action.tone } };

    case CLEAR_NOTICE:
      if (action.matchText && state.notice?.text !== action.matchText) return state;
      return { ...state, notice: null };

    case CLAMP_SELECTION: {
      if (action.listLength === 0) {
        const updates = {};
        if (state.selectedIdx !== -1) updates.selectedIdx = -1;
        if (state.mainFocus === 'agents') updates.mainFocus = 'input';
        return Object.keys(updates).length > 0 ? { ...state, ...updates } : state;
      }
      if (state.selectedIdx >= action.listLength) {
        return { ...state, selectedIdx: action.listLength - 1 };
      }
      return state;
    }

    case ENTER_AGENT_FOCUS:
      return {
        ...state,
        focusedAgent: action.agent,
        view: 'agent-focus',
        showDiagnostics: false,
      };

    case EXIT_AGENT_FOCUS:
      return {
        ...state,
        view: 'home',
        focusedAgent: null,
        showDiagnostics: false,
      };

    default:
      return state;
  }
}
