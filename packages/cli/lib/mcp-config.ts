// Shared helpers for writing MCP config files and detecting tools.
// Used by both `chinmeister init` and `chinmeister add`.

import {
  commandExists,
  configureHostIntegration,
  detectHostIntegrations,
  scanHostIntegrations,
  summarizeIntegrationScan,
  writeHooksConfig as writeHostHooksConfig,
  writeMcpConfig as writeHostMcpConfig,
} from '@chinmeister/shared/integration-doctor.js';
import type {
  ConfigureResult,
  IntegrationScanResult,
  WriteResult,
} from '@chinmeister/shared/integration-doctor.js';
import type { HostIntegration } from '@chinmeister/shared/integration-model.js';

export { commandExists };

export function detectTools(cwd: string): HostIntegration[] {
  return detectHostIntegrations(cwd);
}

export function scanIntegrationHealth(cwd: string): IntegrationScanResult[] {
  return scanHostIntegrations(cwd);
}

export { summarizeIntegrationScan };

export function writeMcpConfig(
  cwd: string,
  relativePath: string,
  { channel = false, toolId = null }: { channel?: boolean; toolId?: string | null } = {},
): WriteResult {
  return writeHostMcpConfig(cwd, relativePath, { channel, hostId: toolId });
}

export function writeHooksConfig(cwd: string): WriteResult {
  return writeHostHooksConfig(cwd, { hostId: 'claude-code' });
}

export function configureTool(cwd: string, toolId: string): ConfigureResult {
  const result = configureHostIntegration(cwd, toolId);
  if (result?.error?.startsWith('Unknown host integration:')) {
    return { error: result.error.replace('Unknown host integration:', 'Unknown MCP tool:') };
  }
  return result;
}
