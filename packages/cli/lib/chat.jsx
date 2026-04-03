import React, { useState, useEffect, useRef, useReducer, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { getInkColor } from './colors.js';

const WS_URL = process.env.CHINWAG_WS_URL || 'wss://chinwag-api.glendonchin.workers.dev/ws/chat';

// ── Constants ───────────────────────────────────────
const CHAT_HISTORY_LIMIT = 50;
const VISIBLE_MESSAGE_COUNT = 15;
const MAX_MESSAGE_LENGTH = 280;
const ERROR_DISPLAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 15000;
const RECONNECT_BASE_MS = 1000;

// ── WebSocket state machine ─────────────────────────
export const WS_ACTIONS = {
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  ERROR: 'ERROR',
  CLOSED: 'CLOSED',
  CLEAR_ERROR: 'CLEAR_ERROR',
};

export const WS_INITIAL_STATE = {
  status: 'disconnected',
  retryCount: 0,
  error: null,
  intentionalClose: false,
};

export function wsReducer(state, action) {
  switch (action.type) {
    case WS_ACTIONS.CONNECTING:
      return { ...state, status: 'connecting', error: null };
    case WS_ACTIONS.CONNECTED:
      return { ...state, status: 'connected', retryCount: 0, error: null, intentionalClose: false };
    case WS_ACTIONS.DISCONNECTED:
      return state.intentionalClose
        ? state
        : { ...state, status: 'disconnected', retryCount: state.retryCount + 1 };
    case WS_ACTIONS.ERROR:
      return { ...state, status: 'error', error: action.error };
    case WS_ACTIONS.CLOSED:
      return { ...state, status: 'closed', intentionalClose: true };
    case WS_ACTIONS.CLEAR_ERROR:
      return { ...state, error: null };
    default:
      return state;
  }
}

export function Chat({ config, user, navigate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [roomCount, setRoomCount] = useState(0);
  const [displayError, setDisplayError] = useState('');

  const [wsState, dispatch] = useReducer(wsReducer, WS_INITIAL_STATE);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const errorTimerRef = useRef(null);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearErrorTimer = useCallback(() => {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, []);

  function connect(shuffle = false) {
    dispatch({ type: WS_ACTIONS.CONNECTING });

    const url = new URL(WS_URL);
    if (shuffle) url.searchParams.set('shuffle', '1');

    const ws = new WebSocket(url.toString(), {
      headers: { Authorization: `Bearer ${config.token}` },
    });

    ws.addEventListener('open', () => {
      dispatch({ type: WS_ACTIONS.CONNECTED });
    });

    ws.addEventListener('message', (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (err) {
        console.error('[chinwag]', err?.message || err);
        return;
      }

      if (data.type === 'history') {
        setMessages(data.messages || []);
        setRoomCount(data.roomCount || 0);
        return;
      }

      if (data.type === 'system') {
        setMessages((prev) => [
          ...prev.slice(-(CHAT_HISTORY_LIMIT - 1)),
          {
            type: 'system',
            content: data.content,
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      if (data.type === 'join' || data.type === 'leave') {
        setRoomCount(data.roomCount || 0);
        setMessages((prev) => [
          ...prev.slice(-(CHAT_HISTORY_LIMIT - 1)),
          {
            type: 'system',
            content: `${data.handle} ${data.type === 'join' ? 'joined' : 'left'}`,
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      if (data.type === 'message') {
        setMessages((prev) => [...prev.slice(-(CHAT_HISTORY_LIMIT - 1)), data]);
      }
    });

    ws.addEventListener('close', () => {
      dispatch({ type: WS_ACTIONS.DISCONNECTED });
    });

    ws.addEventListener('error', () => {
      dispatch({ type: WS_ACTIONS.ERROR, error: 'Connection error' });
    });

    wsRef.current = ws;
  }

  // Schedule reconnect when state transitions to disconnected with retryCount > 0
  useEffect(() => {
    if (wsState.status !== 'disconnected' || wsState.retryCount === 0 || wsState.intentionalClose) {
      return;
    }
    // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
    // retryCount was already incremented by the DISCONNECTED action
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, wsState.retryCount - 1),
      MAX_RECONNECT_DELAY_MS,
    );
    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      connect();
    }, delay);
    return clearReconnectTimer;
  }, [wsState.status, wsState.retryCount, wsState.intentionalClose]);

  useEffect(() => {
    connect();
    return () => {
      dispatch({ type: WS_ACTIONS.CLOSED });
      clearReconnectTimer();
      clearErrorTimer();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  function showError(message) {
    setDisplayError(message);
    clearErrorTimer();
    errorTimerRef.current = setTimeout(() => setDisplayError(''), ERROR_DISPLAY_MS);
  }

  function send() {
    const msg = input.trim();
    if (!msg) return;
    if (!wsRef.current || wsState.status !== 'connected') {
      showError('Disconnected. Reconnecting...');
      return;
    }
    if (msg.length > MAX_MESSAGE_LENGTH) {
      showError(`Message too long (max ${MAX_MESSAGE_LENGTH} chars)`);
      return;
    }

    wsRef.current.send(JSON.stringify({ type: 'message', content: msg }));
    setInput('');
  }

  function shuffle() {
    dispatch({ type: WS_ACTIONS.CLOSED });
    clearReconnectTimer();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setMessages([]);
    connect(true);
  }

  useInput((ch, key) => {
    if (key.escape) {
      navigate('dashboard');
      return;
    }
    if (ch === 'n' && !input) {
      shuffle();
    }
  });

  if (!config?.token)
    return <Text color="red">Not signed in. Run chinwag init to get started.</Text>;

  const visibleMessages = messages.slice(-VISIBLE_MESSAGE_COUNT);

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
      <Box justifyContent="space-between">
        <Text bold>Global Chat</Text>
        <Text dimColor>{roomCount <= 1 ? 'just you here' : `${roomCount} devs here`}</Text>
      </Box>
      {wsState.status !== 'connected' &&
        wsState.status !== 'connecting' &&
        wsState.status !== 'closed' && <Text color="red">Reconnecting...</Text>}
      <Text>{''}</Text>

      <Box flexDirection="column" minHeight={10}>
        {visibleMessages.map((msg, i) => {
          if (msg.type === 'system') {
            return (
              <Text key={i} dimColor>
                {' '}
                — {msg.content}
              </Text>
            );
          }
          return (
            <Box key={i}>
              <Text color={getInkColor(msg.color)} bold>
                {msg.handle}
              </Text>
              <Text>: {msg.content}</Text>
            </Box>
          );
        })}
        {visibleMessages.length === 0 && <Text dimColor>No messages yet. Say something!</Text>}
      </Box>

      <Text>{''}</Text>
      {displayError ? <Text color="red">{displayError}</Text> : null}
      <Box>
        <Text color={getInkColor(user?.color || 'white')}>
          {user?.handle || '?'}
          {'> '}
        </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={send}
          placeholder="Type a message..."
        />
      </Box>
      <Text dimColor>[enter] send · [n] shuffle · [esc] back</Text>
    </Box>
  );
}
