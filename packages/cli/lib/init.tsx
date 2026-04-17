import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { saveConfig } from './config.js';
import type { ChinwagConfig } from './config.js';
import { initAccount } from './api.js';
import { getInkColor } from './colors.js';
import { classifyInitError } from './utils/errors.js';
import { formatError } from '@chinwag/shared';

interface AccountResult {
  token: string;
  refresh_token: string;
  handle: string;
  color: string;
}

interface AccountError {
  message: string;
  status?: number | undefined;
}

interface UserInfo {
  handle: string;
  color: string;
}

interface WelcomeProps {
  onComplete: (config: ChinwagConfig, user: UserInfo) => void;
}

export function Welcome({ onComplete }: WelcomeProps): React.ReactNode {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [account, setAccount] = useState<AccountResult | null>(null);
  const [error, setError] = useState<AccountError | null>(null);

  const [retryKey, setRetryKey] = useState(0);
  const [logoStep, setLogoStep] = useState(0);

  useEffect(() => {
    async function setup(): Promise<void> {
      setState('loading');
      setError(null);
      try {
        const result = (await initAccount()) as AccountResult;
        const config: ChinwagConfig = {
          token: result.token,
          refresh_token: result.refresh_token,
          handle: result.handle,
          color: result.color,
        };
        saveConfig(config);
        setAccount(result);
        setState('ready');
      } catch (err: unknown) {
        setError({
          message: formatError(err),
          status: (err as { status?: number }).status,
        });
        setState('error');
      }
    }
    setup();
  }, [retryKey]);

  useEffect(() => {
    if (state !== 'ready') return;
    const t1 = setTimeout(() => setLogoStep(1), 150);
    const t2 = setTimeout(() => setLogoStep(2), 300);
    const t3 = setTimeout(() => setLogoStep(3), 450);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [state]);

  useInput((input: string, key) => {
    if (state === 'error' && input === 'r') {
      setRetryKey((k) => k + 1);
      return;
    }

    if (state !== 'ready') return;

    if (key.return) {
      const config: ChinwagConfig = {
        token: account!.token,
        refresh_token: account!.refresh_token,
        handle: account!.handle,
        color: account!.color,
      };
      onComplete(config, { handle: account!.handle, color: account!.color });
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
    const { title, hint } = classifyInitError(error!);
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>
          {title}
        </Text>
        <Text dimColor>{hint}</Text>
        <Text>{''}</Text>
        <Text>
          <Text color="cyan" bold>
            [r]
          </Text>
          <Text dimColor> retry</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      <Box>
        <Box flexDirection="column" marginRight={2}>
          <Text color="green">{logoStep >= 3 ? '    ██████████████' : '                  '}</Text>
          <Text color="blueBright">
            {logoStep >= 2 ? '  ██████████████  ' : '                  '}
          </Text>
          <Text color="magentaBright">
            {logoStep >= 1 ? '██████████████    ' : '                  '}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color="cyan" bold>
            Welcome to chinwag
          </Text>
          <Text>{''}</Text>
          <Text>Your agents now share context,</Text>
          <Text>coordinate edits, and stay aware</Text>
          <Text>of each other automatically.</Text>
        </Box>
      </Box>

      <Box paddingTop={1}>
        <Text>
          <Text dimColor>You are </Text>
          <Text color={getInkColor(account!.color)} bold>
            {account!.handle}
          </Text>
        </Text>
      </Box>

      <Box paddingTop={1}>
        <Text>
          <Text color="cyan" bold>
            [enter]
          </Text>
          <Text dimColor> get started</Text>
        </Text>
      </Box>
    </Box>
  );
}
