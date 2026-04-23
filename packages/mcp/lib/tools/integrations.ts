// chinmeister_scan_integrations and chinmeister_configure_integration tool handlers.

import * as z from 'zod/v4';
import { formatIntegrationScanResults } from '@chinmeister/shared/integration-doctor.js';
import { getErrorMessage } from '../utils/responses.js';
import { INTEGRATION_ID_MAX_LENGTH } from '../constants.js';
import type { AddToolFn, ToolDeps } from './types.js';

const scanIntegrationsSchema = z.object({
  only_detected: z
    .boolean()
    .optional()
    .describe('If true, only include integrations detected in this repo or environment'),
});
type ScanIntegrationsArgs = z.infer<typeof scanIntegrationsSchema>;

const configureIntegrationSchema = z.object({
  host_id: z
    .string()
    .max(INTEGRATION_ID_MAX_LENGTH)
    .describe('Host integration id, e.g. cursor, claude-code, windsurf, vscode'),
  surface_id: z
    .string()
    .max(INTEGRATION_ID_MAX_LENGTH)
    .optional()
    .describe('Optional agent surface id for future host-specific integrations'),
});
type ConfigureIntegrationArgs = z.infer<typeof configureIntegrationSchema>;

export function registerIntegrationTools(
  addTool: AddToolFn,
  { integrationDoctor }: Pick<ToolDeps, 'integrationDoctor'>,
): void {
  if (!integrationDoctor) return;

  addTool(
    'chinmeister_scan_integrations',
    {
      description:
        'Inspect local Chinmeister integration health for supported hosts in this repo. Use this to see which tools are detected, configured, missing setup, or need repair before asking the user to debug settings manually.',
      inputSchema: scanIntegrationsSchema,
    },
    async (args) => {
      const { only_detected } = args as ScanIntegrationsArgs;
      try {
        const results = integrationDoctor.scanHostIntegrations(process.cwd());
        return {
          content: [
            {
              type: 'text' as const,
              text: formatIntegrationScanResults(results, { onlyDetected: Boolean(only_detected) }),
            },
          ],
        };
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        return {
          content: [{ type: 'text' as const, text: `Failed to scan integrations: ${message}` }],
          isError: true,
        };
      }
    },
  );

  addTool(
    'chinmeister_configure_integration',
    {
      description:
        'Configure Chinmeister for a supported host tool in the current repo by writing the required MCP config and related local setup files. Use chinmeister_scan_integrations first so you know what needs repair.',
      inputSchema: configureIntegrationSchema,
    },
    async (args) => {
      const { host_id, surface_id } = args as ConfigureIntegrationArgs;
      try {
        const result = integrationDoctor.configureHostIntegration(process.cwd(), host_id, {
          surfaceId: surface_id,
        });
        if (result.error) {
          return { content: [{ type: 'text' as const, text: result.error }], isError: true };
        }

        const scan = integrationDoctor
          .scanHostIntegrations(process.cwd())
          .find((item) => item.id === host_id);

        const lines = [`Configured ${result.name}: ${result.detail}`];
        if (scan) {
          lines.push(`Status: ${scan.status}`);
          if (scan.issues?.length) {
            for (const issue of scan.issues) {
              lines.push(`Issue: ${issue}`);
            }
          }
        }
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        return {
          content: [{ type: 'text' as const, text: `Failed to configure integration: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
