/**
 * Connected tools sub-screen for the Customize component.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { DetectedToolsList } from '../tool-display.jsx';
import type { IntegrationScanResult } from '@chinmeister/shared/integration-doctor.js';

interface FlashMessage {
  type: string;
  text: string;
}

interface IntegrationSummary {
  text: string;
  tone: string;
}

interface ToolsScreenProps {
  detected: IntegrationScanResult[];
  integrationSummary: IntegrationSummary | null;
  message: FlashMessage | null;
}

export function ToolsScreen({
  detected,
  integrationSummary,
  message,
}: ToolsScreenProps): React.ReactNode {
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Connected tools</Text>
        <Text dimColor> ({detected.length} detected)</Text>
      </Box>

      <DetectedToolsList
        detected={detected}
        integrationSummary={detected.length > 0 ? integrationSummary : null}
      />

      {detected.length === 0 && (
        <Box marginBottom={1}>
          <Text dimColor>Run </Text>
          <Text color="cyan">npx chinmeister add &lt;tool&gt;</Text>
          <Text dimColor> to connect a tool.</Text>
        </Box>
      )}

      {message && (
        <Box marginBottom={1}>
          <Text color={message.type === 'error' ? 'red' : 'green'}>{message.text}</Text>
        </Box>
      )}

      <Text dimColor>[esc] back</Text>
    </Box>
  );
}
