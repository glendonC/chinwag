import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { saveConfig } from './config.js';
import { initAccount } from './api.js';
import { getInkColor } from './colors.js';

export function Welcome({ onComplete }) {
  const [state, setState] = useState('loading');
  const [account, setAccount] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function setup() {
      try {
        const result = await initAccount();
        const config = {
          token: result.token,
          handle: result.handle,
          color: result.color,
        };
        saveConfig(config);
        setAccount(result);
        setState('ready');
      } catch (err) {
        setError(err.message || 'Failed to connect to server');
        setState('error');
      }
    }
    setup();
  }, []);

  useInput((input, key) => {
    if (state !== 'ready') return;

    if (key.return) {
      const config = {
        token: account.token,
        handle: account.handle,
        color: account.color,
      };
      onComplete(config, { handle: account.handle, color: account.color });
    }
  });

  if (state === 'loading') {
    return (
      <Box padding={1} borderStyle="round" borderColor="gray">
        <Text dimColor>Setting up your account...</Text>
      </Box>
    );
  }

  if (state === 'error') {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
        <Text color="red">Could not connect to chinwag servers.</Text>
        <Text dimColor>{error}</Text>
        <Text>{''}</Text>
        <Text dimColor>Check your internet connection and try again.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
      <Text bold>Welcome to chinwag</Text>
      <Text dimColor>The developer community in your terminal.</Text>
      <Text>{''}</Text>
      <Text>Write a daily note. Get a stranger's back.</Text>
      <Text>Browse what others are building.</Text>
      <Text>Drop into live chat.</Text>
      <Text>{''}</Text>
      <Text>You're <Text color={getInkColor(account.color)} bold>{account.handle}</Text></Text>
      <Text>{''}</Text>
      <Text dimColor>[enter] Jump in</Text>
    </Box>
  );
}
