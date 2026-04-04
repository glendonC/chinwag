/**
 * Connected tools sub-screen for the Customize component.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { DetectedToolsList, RecommendationsList } from '../tool-display.jsx';
import type { IntegrationScanResult } from '@chinwag/shared/integration-doctor.js';
import type { CatalogToolLike } from '../utils/tool-catalog.js';

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
  recommendations: CatalogToolLike[];
  cols: number;
  message: FlashMessage | null;
}

export function ToolsScreen({
  detected,
  integrationSummary,
  recommendations,
  cols,
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

      {recommendations.length > 0 && (
        <>
          <Box marginBottom={1}>
            <Text bold>Recommended</Text>
          </Box>
          <RecommendationsList recommendations={recommendations} cols={cols} />
        </>
      )}

      {message && (
        <Box marginBottom={1}>
          <Text color={message.type === 'error' ? 'red' : 'green'}>{message.text}</Text>
        </Box>
      )}

      <Text>
        {recommendations.length > 0 && (
          <>
            <Text color="cyan" bold>
              [1-{recommendations.length}]
            </Text>
            <Text dimColor> add </Text>
          </>
        )}
        <Text dimColor>[esc] back</Text>
      </Text>
    </Box>
  );
}
