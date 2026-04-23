/**
 * Shared presentation component for detected-integration lists.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { IntegrationScanResult } from '@chinmeister/shared/integration-doctor.js';

interface IntegrationSummary {
  text: string;
  tone: string;
}

interface DetectedToolsListProps {
  detected: IntegrationScanResult[];
  integrationSummary: IntegrationSummary | null;
}

export function DetectedToolsList({
  detected,
  integrationSummary,
}: DetectedToolsListProps): React.ReactNode {
  if (detected.length === 0) {
    return (
      <Box marginBottom={1}>
        <Text dimColor>No tools detected. Run `npx chinmeister init` first.</Text>
      </Box>
    );
  }

  const maxName = Math.max(...detected.map((t) => t.name.length));

  return (
    <>
      <Box flexDirection="column" marginBottom={1}>
        {detected.map((tool) => {
          let detail = (tool as IntegrationScanResult & { mcpConfig?: string }).mcpConfig || '';
          if ((tool as IntegrationScanResult & { hooks?: boolean }).hooks) detail += ' + hooks';
          if ((tool as IntegrationScanResult & { channel?: boolean }).channel)
            detail += ' + channel';
          const statusColor =
            tool.status === 'ready'
              ? 'green'
              : tool.status === 'needs_repair'
                ? 'yellow'
                : tool.status === 'needs_setup'
                  ? 'yellow'
                  : 'gray';
          const statusText = tool.status.replace(/_/g, ' ');
          return (
            <Box key={tool.id} flexDirection="column">
              <Text>
                <Text color={tool.status === 'ready' ? 'green' : 'yellow'}>{'● '}</Text>
                <Text>{tool.name.padEnd(maxName + 1)}</Text>
                <Text dimColor>{detail}</Text>
                <Text dimColor> </Text>
                <Text color={statusColor}>{statusText}</Text>
              </Text>
              {tool.issues?.[0] && <Text dimColor> {tool.issues[0]}</Text>}
            </Box>
          );
        })}
      </Box>
      {integrationSummary && (
        <Box marginBottom={1}>
          <Text
            color={
              integrationSummary.tone === 'success'
                ? 'green'
                : integrationSummary.tone === 'warning'
                  ? 'yellow'
                  : 'cyan'
            }
          >
            {integrationSummary.text}
          </Text>
        </Box>
      )}
    </>
  );
}
