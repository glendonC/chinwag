import { describe, expect, it } from 'vitest';
import { wsReducer, WS_ACTIONS, WS_INITIAL_STATE } from '../chat.jsx';

// ── Initial State ───────────────────────────────────

describe('WS_INITIAL_STATE', () => {
  it('has expected default values', () => {
    expect(WS_INITIAL_STATE).toEqual({
      status: 'disconnected',
      retryCount: 0,
      error: null,
      intentionalClose: false,
    });
  });
});

// ── Reducer Tests ───────────────────────────────────

describe('wsReducer', () => {
  function state(overrides = {}) {
    return { ...WS_INITIAL_STATE, ...overrides };
  }

  // ── CONNECTING ────────────────────────────────────

  describe('CONNECTING', () => {
    it('sets status to connecting and clears error', () => {
      const result = wsReducer(state({ status: 'error', error: 'Connection error' }), {
        type: WS_ACTIONS.CONNECTING,
      });
      expect(result.status).toBe('connecting');
      expect(result.error).toBeNull();
    });

    it('preserves retryCount and intentionalClose', () => {
      const result = wsReducer(state({ retryCount: 3, intentionalClose: false }), {
        type: WS_ACTIONS.CONNECTING,
      });
      expect(result.retryCount).toBe(3);
      expect(result.intentionalClose).toBe(false);
    });
  });

  // ── CONNECTED ─────────────────────────────────────

  describe('CONNECTED', () => {
    it('sets status to connected and resets retryCount', () => {
      const result = wsReducer(state({ status: 'connecting', retryCount: 5 }), {
        type: WS_ACTIONS.CONNECTED,
      });
      expect(result.status).toBe('connected');
      expect(result.retryCount).toBe(0);
    });

    it('clears error and intentionalClose', () => {
      const result = wsReducer(state({ error: 'some error', intentionalClose: true }), {
        type: WS_ACTIONS.CONNECTED,
      });
      expect(result.error).toBeNull();
      expect(result.intentionalClose).toBe(false);
    });
  });

  // ── DISCONNECTED ──────────────────────────────────

  describe('DISCONNECTED', () => {
    it('sets status to disconnected and increments retryCount', () => {
      const result = wsReducer(state({ status: 'connected', retryCount: 0 }), {
        type: WS_ACTIONS.DISCONNECTED,
      });
      expect(result.status).toBe('disconnected');
      expect(result.retryCount).toBe(1);
    });

    it('increments retryCount from existing value', () => {
      const result = wsReducer(state({ retryCount: 3 }), { type: WS_ACTIONS.DISCONNECTED });
      expect(result.retryCount).toBe(4);
    });

    it('returns same state when intentionalClose is true', () => {
      const s = state({ status: 'connected', intentionalClose: true, retryCount: 0 });
      const result = wsReducer(s, { type: WS_ACTIONS.DISCONNECTED });
      expect(result).toBe(s);
    });
  });

  // ── ERROR ─────────────────────────────────────────

  describe('ERROR', () => {
    it('sets status to error with error message', () => {
      const result = wsReducer(state({ status: 'connecting' }), {
        type: WS_ACTIONS.ERROR,
        error: 'Connection error',
      });
      expect(result.status).toBe('error');
      expect(result.error).toBe('Connection error');
    });

    it('preserves retryCount', () => {
      const result = wsReducer(state({ retryCount: 2 }), { type: WS_ACTIONS.ERROR, error: 'fail' });
      expect(result.retryCount).toBe(2);
    });
  });

  // ── CLOSED ────────────────────────────────────────

  describe('CLOSED', () => {
    it('sets status to closed and intentionalClose to true', () => {
      const result = wsReducer(state({ status: 'connected' }), { type: WS_ACTIONS.CLOSED });
      expect(result.status).toBe('closed');
      expect(result.intentionalClose).toBe(true);
    });

    it('prevents subsequent DISCONNECTED from changing state', () => {
      const closed = wsReducer(state(), { type: WS_ACTIONS.CLOSED });
      const afterDisconnect = wsReducer(closed, { type: WS_ACTIONS.DISCONNECTED });
      expect(afterDisconnect).toBe(closed);
      expect(afterDisconnect.retryCount).toBe(0);
    });
  });

  // ── CLEAR_ERROR ───────────────────────────────────

  describe('CLEAR_ERROR', () => {
    it('clears error while preserving other state', () => {
      const result = wsReducer(
        state({ status: 'error', error: 'Connection error', retryCount: 2 }),
        { type: WS_ACTIONS.CLEAR_ERROR },
      );
      expect(result.error).toBeNull();
      expect(result.status).toBe('error');
      expect(result.retryCount).toBe(2);
    });
  });

  // ── Unknown action ────────────────────────────────

  describe('unknown action', () => {
    it('returns the same state for unknown action types', () => {
      const s = state();
      const result = wsReducer(s, { type: 'UNKNOWN' });
      expect(result).toBe(s);
    });
  });

  // ── State transition sequences ────────────────────

  describe('transition sequences', () => {
    it('models a connect -> disconnect -> reconnect cycle', () => {
      let s = state();
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTING });
      expect(s.status).toBe('connecting');

      s = wsReducer(s, { type: WS_ACTIONS.CONNECTED });
      expect(s.status).toBe('connected');
      expect(s.retryCount).toBe(0);

      s = wsReducer(s, { type: WS_ACTIONS.DISCONNECTED });
      expect(s.status).toBe('disconnected');
      expect(s.retryCount).toBe(1);

      s = wsReducer(s, { type: WS_ACTIONS.CONNECTING });
      expect(s.status).toBe('connecting');

      s = wsReducer(s, { type: WS_ACTIONS.CONNECTED });
      expect(s.status).toBe('connected');
      expect(s.retryCount).toBe(0);
    });

    it('models an intentional close (shuffle) preventing reconnect', () => {
      let s = state();
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTING });
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTED });

      // User triggers shuffle -> CLOSED
      s = wsReducer(s, { type: WS_ACTIONS.CLOSED });
      expect(s.intentionalClose).toBe(true);

      // WebSocket fires close event -> DISCONNECTED
      const afterDisconnect = wsReducer(s, { type: WS_ACTIONS.DISCONNECTED });
      expect(afterDisconnect).toBe(s); // no change
      expect(afterDisconnect.retryCount).toBe(0);

      // New connection starts (shuffle reconnect)
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTING });
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTED });
      expect(s.intentionalClose).toBe(false);
      expect(s.retryCount).toBe(0);
    });

    it('models multiple failed reconnect attempts', () => {
      let s = state();
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTING });
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTED });

      // Connection drops
      s = wsReducer(s, { type: WS_ACTIONS.DISCONNECTED });
      expect(s.retryCount).toBe(1);

      // First reconnect attempt fails
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTING });
      s = wsReducer(s, { type: WS_ACTIONS.ERROR, error: 'Connection error' });
      s = wsReducer(s, { type: WS_ACTIONS.DISCONNECTED });
      expect(s.retryCount).toBe(2);

      // Second reconnect attempt fails
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTING });
      s = wsReducer(s, { type: WS_ACTIONS.DISCONNECTED });
      expect(s.retryCount).toBe(3);

      // Third attempt succeeds
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTING });
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTED });
      expect(s.retryCount).toBe(0);
    });

    it('models unmount cleanup (CLOSED then close event)', () => {
      let s = state();
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTING });
      s = wsReducer(s, { type: WS_ACTIONS.CONNECTED });

      // Unmount dispatches CLOSED
      s = wsReducer(s, { type: WS_ACTIONS.CLOSED });
      expect(s.status).toBe('closed');
      expect(s.intentionalClose).toBe(true);

      // WebSocket close event fires after unmount
      const afterClose = wsReducer(s, { type: WS_ACTIONS.DISCONNECTED });
      expect(afterClose).toBe(s); // intentionalClose prevents state change
    });
  });
});
