// Shared helpers for writing MCP config files and detecting tools.
// Used by both `chinwag init` and `chinwag add`.

import {
  commandExists,
  configureHostIntegration,
  detectHostIntegrations,
  scanHostIntegrations,
  summarizeIntegrationScan,
  writeHooksConfig as writeHostHooksConfig,
  writeMcpConfig as writeHostMcpConfig,
} from '../../shared/integration-doctor.js';

export { commandExists };

export function detectTools(cwd) {
  return detectHostIntegrations(cwd);
}

export function scanIntegrationHealth(cwd) {
  return scanHostIntegrations(cwd);
}

export { summarizeIntegrationScan };

export function writeMcpConfig(cwd, relativePath, { channel = false, toolId = null } = {}) {
  return writeHostMcpConfig(cwd, relativePath, { channel, hostId: toolId });
}

export function writeHooksConfig(cwd) {
  return writeHostHooksConfig(cwd, { hostId: 'claude-code' });
}

export function configureTool(cwd, toolId) {
  const result = configureHostIntegration(cwd, toolId);
  if (result?.error?.startsWith('Unknown host integration:')) {
    return { error: result.error.replace('Unknown host integration:', 'Unknown MCP tool:') };
  }
  return result;
}
