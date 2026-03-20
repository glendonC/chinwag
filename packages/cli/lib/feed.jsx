import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { api } from './api.js';
import { getInkColor } from './colors.js';

export function Feed({ config, navigate }) {
  const [notes, setNotes] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scrollIdx, setScrollIdx] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes(nextCursor = null) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (nextCursor) params.set('cursor', nextCursor);

      const result = await api(config).get(`/notes/today?${params}`);
      if (nextCursor) {
        setNotes(prev => [...prev, ...result.notes]);
      } else {
        setNotes(result.notes);
      }
      setCursor(result.cursor);
      setHasMore(!!result.cursor);
    } catch {}
    setLoading(false);
  }

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      navigate('home');
      return;
    }

    if (key.upArrow) {
      setScrollIdx(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setScrollIdx(prev => {
        const next = prev + 1;
        if (next >= notes.length - 3 && hasMore && !loading) {
          loadNotes(cursor);
        }
        return Math.min(notes.length - 1, next);
      });
    }
  });

  if (loading && notes.length === 0) {
    return (
      <Box padding={1} borderStyle="round" borderColor="gray">
        <Text dimColor>Loading feed...</Text>
      </Box>
    );
  }

  if (notes.length === 0) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
        <Text>No notes today yet. Be the first!</Text>
        <Text>{''}</Text>
        <Text dimColor>[esc] Back</Text>
      </Box>
    );
  }

  const windowSize = 8;
  const start = Math.max(0, scrollIdx - Math.floor(windowSize / 2));
  const visible = notes.slice(start, start + windowSize);

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
      <Box justifyContent="space-between">
        <Text bold>Today's feed</Text>
        <Text dimColor>{notes.length} note{notes.length !== 1 ? 's' : ''}</Text>
      </Box>
      <Text>{''}</Text>

      {visible.map((note, i) => {
        const isSelected = start + i === scrollIdx;
        const timeAgo = getTimeAgo(note.created_at);

        return (
          <Box key={note.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text>{isSelected ? '▸' : ' '} </Text>
              <Text color={getInkColor(note.color)} bold>{note.handle}</Text>
              <Text dimColor> · {timeAgo}</Text>
            </Box>
            <Text>  {note.message}</Text>
          </Box>
        );
      })}

      {hasMore && <Text dimColor>  ↓ Scroll for more</Text>}
      <Text>{''}</Text>
      <Text dimColor>[↑↓] Scroll  ·  [esc] Back</Text>
    </Box>
  );
}

function getTimeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
