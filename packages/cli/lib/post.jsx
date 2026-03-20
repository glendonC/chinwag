import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { api } from './api.js';

export function Post({ config, navigate, refreshUser }) {
  const [input, setInput] = useState('');
  const [state, setState] = useState('loading');
  const [error, setError] = useState(null);
  const [existingNote, setExistingNote] = useState(null);

  const charCount = input.length;
  const overLimit = charCount > 280;

  useEffect(() => {
    async function checkExisting() {
      try {
        const result = await api(config).get('/notes/today?limit=50');
        const mine = result.notes.find(n => n.handle === config.handle);
        if (mine) {
          setExistingNote(mine.message);
          setState('already');
          return;
        }
      } catch {}
      setState('writing');
    }
    checkExisting();
  }, []);

  async function submit() {
    if (!input.trim() || overLimit) return;

    setState('posting');
    try {
      await api(config).post('/notes', { message: input.trim() });
      await refreshUser();
      setState('done');
    } catch (err) {
      if (err.message?.includes('Already posted')) {
        setState('already');
      } else {
        setError(err.message);
        setState('error');
      }
    }
  }

  useInput((ch, key) => {
    if (state === 'done' || state === 'already' || state === 'error') {
      navigate('home');
      return;
    }
    if (key.escape && state === 'writing') {
      navigate('home');
    }
  });

  if (state === 'loading') {
    return (
      <Box padding={1} borderStyle="round" borderColor="gray">
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  if (state === 'done') {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
        <Text color="green">✓ Posted! It's on the feed for everyone to see.</Text>
        <Text dimColor>Check your inbox — a note from another dev is waiting.</Text>
        <Text>{''}</Text>
        <Text dimColor>Press any key to go back.</Text>
      </Box>
    );
  }

  if (state === 'already') {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
        <Text bold>Your note for today</Text>
        <Text>{''}</Text>
        {existingNote ? (
          <Text>{existingNote}</Text>
        ) : (
          <Text dimColor>You've already posted today.</Text>
        )}
        <Text>{''}</Text>
        <Text dimColor>Come back tomorrow for a new one.</Text>
        <Text>{''}</Text>
        <Text dimColor>Press any key to go back.</Text>
      </Box>
    );
  }

  if (state === 'error') {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
        <Text color="red">Error: {error}</Text>
        <Text>{''}</Text>
        <Text dimColor>Press any key to go back.</Text>
      </Box>
    );
  }

  if (state === 'posting') {
    return (
      <Box padding={1} borderStyle="round" borderColor="gray">
        <Text dimColor>Posting...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
      <Text bold>Write your daily note</Text>
      <Text dimColor>Everyone on chinwag will see this — and you'll get a</Text>
      <Text dimColor>random dev's note in return.</Text>
      <Text>{''}</Text>
      <Box>
        <Text color="cyan">{'> '}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder="Type your note..."
        />
      </Box>
      <Text>{''}</Text>
      <Box justifyContent="space-between">
        <Text dimColor>[enter] Post  ·  [esc] Cancel</Text>
        <Text color={overLimit ? 'red' : 'gray'}>{charCount}/280</Text>
      </Box>
    </Box>
  );
}
