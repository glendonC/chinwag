import { join } from 'node:path';
import { HOST_INTEGRATIONS } from './integration-model.js';
import { detectHost } from './integration-detector.js';
import {
  readJson,
  hasMatchingMcpEntry,
  hasMatchingHookConfig,
} from './integration-config-writer.js';

// Re-export detection logic
export { commandExists, detectHostIntegrations } from './integration-detector.js';

// Re-export config-writing logic
export {
  buildChinwagCliArgs,
  buildChinwagHookCommand,
  writeMcpConfig,
  writeHooksConfig,
  writeCursorHooksConfig,
  writeWindsurfHooksConfig,
  configureHostIntegration,
  type WriteResult,
  type ConfigureResult,
} from './integration-config-writer.js';

export interface IntegrationScanResult {
  id: string;
  name: string;
  tier: 'managed' | 'connected';
  capabilities: string[];
  detected: boolean;
  status: 'ready' | 'needs_setup' | 'needs_repair' | 'not_detected';
  configPath: string;
  mcpConfigured: boolean;
  hooksConfigured: boolean;
  issues: string[];
  repairable: boolean;
}

export interface IntegrationScanSummary {
  text: string;
  tone: 'info' | 'success' | 'warning';
}

export function formatIntegrationScanResults(
  scanResults: IntegrationScanResult[],
  { onlyDetected = false }: { onlyDetected?: boolean } = {},
): string {
  const rows = onlyDetected ? scanResults.filter((item) => item.detected) : scanResults;
  if (rows.length === 0) return 'No supported integrations detected in this repo.';

  const lines = ['Integrations:'];
  for (const item of rows) {
    const summary = `${item.name} [${item.tier}] — ${item.status}`;
    const capabilityText = item.capabilities.length ? ` (${item.capabilities.join(', ')})` : '';
    lines.push(`- ${summary}${capabilityText}`);
    if (item.detected) lines.push(`  config: ${item.configPath}`);
    for (const issue of item.issues) {
      lines.push(`  issue: ${issue}`);
    }
  }
  return lines.join('\n');
}

export function summarizeIntegrationScan(
  scanResults: IntegrationScanResult[],
  { onlyDetected = true }: { onlyDetected?: boolean } = {},
): IntegrationScanSummary {
  const rows = onlyDetected ? scanResults.filter((item) => item.detected) : scanResults;
  if (rows.length === 0) return { text: 'No supported integrations detected.', tone: 'info' };

  const ready = rows.filter((item) => item.status === 'ready').length;
  const problematic = rows.filter((item) => item.status !== 'ready').length;
  if (problematic === 0) {
    return {
      text: `${ready} integration${ready === 1 ? '' : 's'} ready.`,
      tone: 'success',
    };
  }

  return {
    text: `${ready} ready · ${problematic} need attention.`,
    tone: 'warning',
  };
}

export function scanHostIntegrations(cwd: string): IntegrationScanResult[] {
  return HOST_INTEGRATIONS.map((host) => {
    const detected = detectHost(cwd, host);
    const mcpPath = join(cwd, host.mcpConfig);
    const mcpConfig = readJson(mcpPath);
    const mcpConfigured = hasMatchingMcpEntry(mcpConfig, host.id, {
      channel: Boolean(host.channel),
      sharedRoot: host.mcpConfig === '.mcp.json' || host.mcpConfig === 'mcp.json',
    });

    const hooksPath = join(cwd, '.claude', 'settings.json');
    const hooksConfig = host.hooks ? readJson(hooksPath) : null;
    const hooksConfigured = host.hooks ? hasMatchingHookConfig(hooksConfig) : true;

    const issues: string[] = [];
    if (detected && !mcpConfigured) issues.push(`Missing or outdated config at ${host.mcpConfig}`);
    if (detected && host.hooks && !hooksConfigured) issues.push('Hooks are missing or outdated');

    let status: IntegrationScanResult['status'] = 'not_detected';
    if (detected) {
      status =
        issues.length === 0
          ? 'ready'
          : mcpConfigured || (host.hooks && hooksConfigured)
            ? 'needs_repair'
            : 'needs_setup';
    }

    return {
      id: host.id,
      name: host.name,
      tier: host.tier,
      capabilities: [...host.capabilities],
      detected,
      status,
      configPath: host.mcpConfig,
      mcpConfigured,
      hooksConfigured,
      issues,
      repairable: detected,
    };
  });
}
