import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { saveConfig } from './config.js';
import { initAccount } from './api.js';
import { getInkColor } from './colors.js';

export function Welcome({ onComplete }) {
  const [state, setState] = useState('loading');
  const [account, setAccount] = useState(null);
  const [error, setError] = useState(null);

  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    async function setup() {
      setState('loading');
      setError(null);
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
  }, [retryKey]);

  useInput((input, key) => {
    if (state === 'error' && input === 'r') {
      setRetryKey(k => k + 1);
      return;
    }

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
      <Box padding={1}>
        <Text color="cyan">Setting up your account...</Text>
      </Box>
    );
  }

  if (state === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>Could not connect to chinwag servers.</Text>
        <Text dimColor>{error}</Text>
        <Text>{''}</Text>
        <Text dimColor>Check your internet connection and try again.</Text>
        <Text>{''}</Text>
        <Text>
          <Text color="cyan" bold>[r]</Text>
          <Text dimColor> retry</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      <Box>
        <Box flexDirection="column" marginRight={2}>
          <Text><Text color="yellow"> ▄▀▄   ▄▀▄</Text></Text>
          <Text><Text color="yellow"> █</Text>  ▀▄▀  <Text color="yellow">█</Text></Text>
          <Text><Text color="yellow"> █</Text> ▀ ▄ ▀ <Text color="yellow">█</Text></Text>
          <Text>  <Text color="yellow">▀</Text>▄ ▼ ▄<Text color="yellow">▀</Text></Text>
          <Text>   <Text color="yellow">█</Text><Text color="white">▀▀▀</Text><Text color="yellow">█</Text></Text>
          <Text><Text color="yellow">   ██ ██</Text></Text>
          <Text><Text color="white">   ▀▀ ▀▀</Text></Text>
        </Box>
        <Box flexDirection="column">
          <Text color="cyan" bold>Welcome to chinwag</Text>
          <Text>{''}</Text>
          <Text>Your agents now share context,</Text>
          <Text>coordinate edits, and stay aware</Text>
          <Text>of each other automatically.</Text>
        </Box>
      </Box>

      <Box paddingTop={1}>
        <Text>
          <Text dimColor>You are </Text>
          <Text color={getInkColor(account.color)} bold>{account.handle}</Text>
        </Text>
      </Box>

      <Box paddingTop={1}>
        <Text>
          <Text color="cyan" bold>[enter]</Text>
          <Text dimColor> get started</Text>
        </Text>
      </Box>
    </Box>
  );
}
