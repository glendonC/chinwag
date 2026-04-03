// chinwag_scan_integrations and chinwag_configure_integration tool handlers.

import * as z from 'zod/v4';
import { formatIntegrationScanResults } from '../../../shared/integration-doctor.js';
import type { AddToolFn, ToolDeps } from './types.js';

export function registerIntegrationTools(
  addTool: AddToolFn,
  { integrationDoctor }: Pick<ToolDeps, 'integrationDoctor'>,
): void {
  if (!integrationDoctor) return;

  addTool(
    'chinwag_scan_integrations',
    {
      description:
        'Inspect local Chinwag integration health for supported hosts in this repo. Use this to see which tools are detected, configured, missing setup, or need repair before asking the user to debug settings manually.',
      inputSchema: z.object({
        only_detected: z
          .boolean()
          .optional()
          .describe('If true, only include integrations detected in this repo or environment'),
      }),
    },
    async ({ only_detected }: { only_detected?: boolean }) => {
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
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Failed to scan integrations: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  addTool(
    'chinwag_configure_integration',
    {
      description:
        'Configure Chinwag for a supported host tool in the current repo by writing the required MCP config and related local setup files. Use chinwag_scan_integrations first so you know what needs repair.',
      inputSchema: z.object({
        host_id: z
          .string()
          .max(50)
          .describe('Host integration id, e.g. cursor, claude-code, windsurf, vscode'),
        surface_id: z
          .string()
          .max(50)
          .optional()
          .describe('Optional agent surface id for future host-specific integrations'),
      }),
    },
    async ({ host_id, surface_id }: { host_id: string; surface_id?: string }) => {
      try {
        const result = integrationDoctor.configureHostIntegration(process.cwd(), host_id, {
          surfaceId: surface_id,
        });
        if (result.error) {
          return { content: [{ type: 'text' as const, text: result.error }], isError: true };
        }

        const scan = integrationDoctor
          .scanHostIntegrations(process.cwd())
          .find((item: any) => item.id === host_id);

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
      } catch (err: any) {
        return {
          content: [
            { type: 'text' as const, text: `Failed to configure integration: ${err.message}` },
          ],
          isError: true,
        };
      }
    },
  );
}
