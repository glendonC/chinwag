import React from 'react';
import { Box, Text } from 'ink';
import { HintRow } from './ui.jsx';
import { MIN_WIDTH, SPINNER } from './utils.js';

interface DashboardGuardsProps {
  cols: number;
  error: string | null;
  context: unknown;
  connState: string;
  connDetail: string | null;
  spinnerFrame: number;
}

/**
 * Renders guard states for the dashboard: narrow terminal, error, or
 * loading/connecting. Returns null when no guard applies (normal render).
 */
export function DashboardGuards({
  cols,
  error,
  context,
  connState,
  connDetail,
  spinnerFrame,
}: DashboardGuardsProps): React.ReactNode {
  if (cols < MIN_WIDTH) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>
          Terminal too narrow ({cols} cols). Widen to at least {MIN_WIDTH}.
        </Text>
        <Text>{''}</Text>
        <Text>
          <Text color="cyan" bold>
            [q]
          </Text>
          <Text dimColor> quit</Text>
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Text color="red" bold>
          {error}
        </Text>
        <Text>{''}</Text>
        <Text dimColor>
          {error.includes('chinmeister init')
            ? 'Set up this project first, then relaunch.'
            : error.includes('expired')
              ? 'Your auth token is no longer valid.'
              : 'Check the issue above and try again.'}
        </Text>
        <HintRow
          hints={[
            ...(error.includes('expired') || error.includes('.chinmeister')
              ? []
              : [{ commandKey: 'r', label: 'retry', color: 'cyan' }]),
            { commandKey: 'q', label: 'quit', color: 'gray' },
          ]}
        />
      </Box>
    );
  }

  if (!context) {
    const isAutoRetrying = connState === 'connecting' || connState === 'reconnecting';
    const spin = SPINNER[spinnerFrame];
    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {isAutoRetrying ? (
          <Text>
            <Text color="cyan">{spin} </Text>
            <Text color="cyan">
              {connState === 'connecting' ? 'Connecting to team' : connDetail || 'Reconnecting'}
            </Text>
          </Text>
        ) : (
          <Box flexDirection="column">
            <Text color="red">{connDetail || 'Cannot reach server.'}</Text>
            <Text>{''}</Text>
            <HintRow
              hints={[
                { commandKey: 'r', label: 'retry now', color: 'cyan' },
                { commandKey: 'q', label: 'quit', color: 'gray' },
              ]}
            />
          </Box>
        )}
      </Box>
    );
  }

  return null;
}
