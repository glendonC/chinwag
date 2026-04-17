import React, { useState, useEffect, useRef, useReducer, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { getInkColor } from './colors.js';
import type { ChinwagConfig } from './config.js';
import { getRuntimeTargets } from './api.js';
import { formatError, createLogger } from '@chinwag/shared';
import {
  ERROR_DISPLAY_MS,
  MAX_RECONNECT_DELAY_MS,
  RECONNECT_BASE_MS,
} from './constants/timings.js';

const log = createLogger('chat');

// ── Constants ───────────────────────────────────────
const CHAT_HISTORY_LIMIT = 50;
const VISIBLE_MESSAGE_COUNT = 15;
const MAX_MESSAGE_LENGTH = 280;

// ── WebSocket state machine ─────────────────────────
export const WS_ACTIONS = {
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  ERROR: 'ERROR',
  CLOSED: 'CLOSED',
  CLEAR_ERROR: 'CLEAR_ERROR',
} as const;

interface WsState {
  status: string;
  retryCount: number;
  error: string | null;
  intentionalClose: boolean;
}

type WsAction =
  | { type: typeof WS_ACTIONS.CONNECTING }
  | { type: typeof WS_ACTIONS.CONNECTED }
  | { type: typeof WS_ACTIONS.DISCONNECTED }
  | { type: typeof WS_ACTIONS.ERROR; error: string }
  | { type: typeof WS_ACTIONS.CLOSED }
  | { type: typeof WS_ACTIONS.CLEAR_ERROR };

export const WS_INITIAL_STATE: WsState = {
  status: 'disconnected',
  retryCount: 0,
  error: null,
  intentionalClose: false,
};

export function wsReducer(state: WsState, action: WsAction): WsState {
  switch (action.type) {
    case WS_ACTIONS.CONNECTING:
      // Reset intentionalClose so reconnect logic fires if this connection attempt fails.
      // Critical for shuffle(): CLOSED sets intentionalClose=true, then connect(true) dispatches
      // CONNECTING — without this reset, a subsequent DISCONNECTED would be ignored.
      return { ...state, status: 'connecting', error: null, intentionalClose: false };
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

interface ChatMessage {
  type: string;
  content?: string | undefined;
  handle?: string | undefined;
  color?: string | undefined;
  timestamp?: string | undefined;
}

/** @internal Exported for testing. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** @internal Exported for testing. */
export function toChatMessage(v: unknown): ChatMessage | null {
  if (!isRecord(v)) return null;
  if (typeof v.type !== 'string') return null;
  return {
    type: v.type,
    content: typeof v.content === 'string' ? v.content : undefined,
    handle: typeof v.handle === 'string' ? v.handle : undefined,
    color: typeof v.color === 'string' ? v.color : undefined,
    timestamp: typeof v.timestamp === 'string' ? v.timestamp : undefined,
  };
}

/** @internal Exported for testing. */
export function toChatMessages(v: unknown): ChatMessage[] {
  if (!Array.isArray(v)) return [];
  const result: ChatMessage[] = [];
  for (const item of v) {
    const msg = toChatMessage(item);
    if (msg) result.push(msg);
  }
  return result;
}

interface ChatUser {
  handle?: string;
  color?: string;
}

interface ChatProps {
  config: ChinwagConfig | null;
  user: ChatUser | null;
  navigate: (to: string) => void;
}

export function Chat({ config, user, navigate }: ChatProps): React.ReactNode {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [roomCount, setRoomCount] = useState(0);
  const [displayError, setDisplayError] = useState('');

  const [wsState, dispatch] = useReducer(wsReducer, WS_INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReconnectTimer = useCallback((): void => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearErrorTimer = useCallback((): void => {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(
    function connect(shuffle = false): void {
      dispatch({ type: WS_ACTIONS.CONNECTING });

      const url = new URL(getRuntimeTargets().chatWsUrl);
      if (shuffle) url.searchParams.set('shuffle', '1');

      // Node.js native WebSocket accepts { headers } as second arg (per WHATWG spec extension),
      // but @types/node only types the second arg as `string | string[]` (protocol list).
      // Cast is safe: Node ≥22 handles this at runtime; the type gap is a @types/node omission.
      const ws = new WebSocket(url.toString(), {
        headers: { Authorization: `Bearer ${config!.token}` },
      } as unknown as string);

      ws.addEventListener('open', () => {
        dispatch({ type: WS_ACTIONS.CONNECTED });
      });

      ws.addEventListener('message', (event: MessageEvent) => {
        let data: unknown;
        try {
          data = JSON.parse(event.data as string);
        } catch (err: unknown) {
          log.error(formatError(err));
          return;
        }

        if (!isRecord(data)) return;

        if (data.type === 'history') {
          setMessages(toChatMessages(data.messages));
          setRoomCount(typeof data.roomCount === 'number' ? data.roomCount : 0);
          return;
        }

        if (data.type === 'system') {
          setMessages((prev) => [
            ...prev.slice(-(CHAT_HISTORY_LIMIT - 1)),
            {
              type: 'system',
              content: typeof data.content === 'string' ? data.content : '',
              timestamp: new Date().toISOString(),
            },
          ]);
          return;
        }

        if (data.type === 'join' || data.type === 'leave') {
          setRoomCount(typeof data.roomCount === 'number' ? data.roomCount : 0);
          const handle = typeof data.handle === 'string' ? data.handle : 'unknown';
          setMessages((prev) => [
            ...prev.slice(-(CHAT_HISTORY_LIMIT - 1)),
            {
              type: 'system',
              content: `${handle} ${data.type === 'join' ? 'joined' : 'left'}`,
              timestamp: new Date().toISOString(),
            },
          ]);
          return;
        }

        if (data.type === 'message') {
          const msg = toChatMessage(data);
          if (msg) {
            setMessages((prev) => [...prev.slice(-(CHAT_HISTORY_LIMIT - 1)), msg]);
          }
        }
      });

      ws.addEventListener('close', () => {
        dispatch({ type: WS_ACTIONS.DISCONNECTED });
      });

      ws.addEventListener('error', () => {
        dispatch({ type: WS_ACTIONS.ERROR, error: 'Connection error' });
      });

      wsRef.current = ws;
    },
    [config],
  );

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
  }, [wsState.status, wsState.retryCount, wsState.intentionalClose, clearReconnectTimer, connect]);

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
  }, [connect, clearReconnectTimer, clearErrorTimer]);

  function showError(message: string): void {
    setDisplayError(message);
    clearErrorTimer();
    errorTimerRef.current = setTimeout(() => setDisplayError(''), ERROR_DISPLAY_MS);
  }

  function send(): void {
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

  function shuffle(): void {
    dispatch({ type: WS_ACTIONS.CLOSED });
    clearReconnectTimer();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setMessages([]);
    connect(true);
  }

  useInput((ch: string, key) => {
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
              <Text color={getInkColor(msg.color || 'white')} bold>
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
