import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { api } from './api.js';
import { getInkColor } from './colors.js';

export function Inbox({ config, user, navigate }) {
  const [state, setState] = useState('loading');
  const [data, setData] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const result = await api(config).get('/notes/inbox');
        setData(result);

        if (result.locked) {
          setState('locked');
        } else if (result.waiting) {
          setState('waiting');
        } else {
          setState('ready');
        }
      } catch (err) {
        setData({ message: err.message });
        setState('error');
      }
    }
    load();
  }, []);

  useInput(() => {
    if (state !== 'loading') {
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

  if (state === 'locked') {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
        <Text>Write your daily note first — you'll get a random</Text>
        <Text>dev's note in return.</Text>
        <Text>{''}</Text>
        <Text dimColor>Press any key to go back.</Text>
      </Box>
    );
  }

  if (state === 'waiting') {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
        <Text>Your note is posted! As more devs write today,</Text>
        <Text>you'll get one back.</Text>
        <Text>{''}</Text>
        <Text dimColor>Press any key to go back.</Text>
      </Box>
    );
  }

  if (state === 'error') {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
        <Text color="red">Error: {data?.message}</Text>
        <Text>{''}</Text>
        <Text dimColor>Press any key to go back.</Text>
      </Box>
    );
  }

  const { from, note } = data;
  const timeAgo = getTimeAgo(note.created_at);

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
      <Text bold>Your daily note exchange</Text>
      <Text dimColor>You shared a note — here's one back from another dev.</Text>
      <Text>{''}</Text>
      <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
        <Box>
          <Text color={getInkColor(from.color)} bold>{from.handle}</Text>
          <Text dimColor> · {timeAgo}</Text>
        </Box>
        {from.status && <Text dimColor>— {from.status}</Text>}
        <Text>{''}</Text>
        <Text>{note.message}</Text>
      </Box>
      <Text>{''}</Text>
      <Text dimColor>Press any key to go back.</Text>
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
