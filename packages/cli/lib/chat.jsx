import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { getInkColor } from './colors.js';

const WS_URL = process.env.CHINWAG_WS_URL || 'wss://chinwag-api.glendonchin.workers.dev/ws/chat';

export function Chat({ config, user, navigate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [roomCount, setRoomCount] = useState(0);
  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef(null);
  const intentionalCloseRef = useRef(false);

  useEffect(() => {
    connect();
    return () => {
      intentionalCloseRef.current = true;
      clearTimeout(retryTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  function connect(shuffle = false) {
    const url = new URL(WS_URL);
    if (shuffle) url.searchParams.set('shuffle', '1');

    const ws = new WebSocket(url.toString(), {
      headers: { 'Authorization': `Bearer ${config.token}` },
    });

    ws.addEventListener('open', () => {
      setConnected(true);
      retryRef.current = 0; // Reset backoff on successful connection
    });

    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'history') {
        setMessages(data.messages || []);
        setRoomCount(data.roomCount || 0);
        return;
      }

      if (data.type === 'system') {
        setMessages(prev => [...prev.slice(-49), {
          type: 'system',
          content: data.content,
          timestamp: new Date().toISOString(),
        }]);
        return;
      }

      if (data.type === 'join' || data.type === 'leave') {
        setRoomCount(data.roomCount || 0);
        setMessages(prev => [...prev.slice(-49), {
          type: 'system',
          content: `${data.handle} ${data.type === 'join' ? 'joined' : 'left'}`,
          timestamp: new Date().toISOString(),
        }]);
        return;
      }

      if (data.type === 'message') {
        setMessages(prev => [...prev.slice(-49), data]);
      }
    });

    ws.addEventListener('close', () => {
      setConnected(false);
      if (!intentionalCloseRef.current) {
        scheduleReconnect();
      }
    });

    ws.addEventListener('error', () => {
      setConnected(false);
    });

    wsRef.current = ws;
  }

  function scheduleReconnect() {
    // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
    const delay = Math.min(1000 * Math.pow(2, retryRef.current), 15000);
    retryRef.current++;
    retryTimerRef.current = setTimeout(() => {
      if (!intentionalCloseRef.current) {
        connect();
      }
    }, delay);
  }

  function send() {
    const msg = input.trim();
    if (!msg || !wsRef.current) return;
    if (msg.length > 280) return;

    wsRef.current.send(JSON.stringify({ type: 'message', content: msg }));
    setInput('');
  }

  function shuffle() {
    intentionalCloseRef.current = true;
    clearTimeout(retryTimerRef.current);
    if (wsRef.current) {
      wsRef.current.close();
    }
    setMessages([]);
    setConnected(false);
    intentionalCloseRef.current = false;
    connect(true);
  }

  useInput((ch, key) => {
    if (key.escape) {
      navigate('home');
      return;
    }
    if (ch === 'n' && !input) {
      shuffle();
    }
  });

  const visibleMessages = messages.slice(-15);

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
      <Box justifyContent="space-between">
        <Text bold>Chat</Text>
        <Text dimColor>{roomCount} dev{roomCount !== 1 ? 's' : ''} here</Text>
      </Box>
      {!connected && <Text color="red">Reconnecting...</Text>}
      <Text>{''}</Text>

      <Box flexDirection="column" minHeight={10}>
        {visibleMessages.map((msg, i) => {
          if (msg.type === 'system') {
            return (
              <Text key={i} dimColor>  — {msg.content}</Text>
            );
          }
          return (
            <Box key={i}>
              <Text color={getInkColor(msg.color)} bold>{msg.handle}</Text>
              <Text>: {msg.content}</Text>
            </Box>
          );
        })}
        {visibleMessages.length === 0 && (
          <Text dimColor>No messages yet. Say something!</Text>
        )}
      </Box>

      <Text>{''}</Text>
      <Box>
        <Text color={getInkColor(user?.color || 'white')}>{user?.handle || '?'}{'> '}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={send}
          placeholder="Type a message..."
        />
      </Box>
      <Text dimColor>[enter] Send  ·  [n] Shuffle  ·  [esc] Leave</Text>
    </Box>
  );
}
