import { loadConfig, saveConfig } from './config.js';
import type { ChinmeisterConfig } from './config.js';

interface LauncherConfig extends ChinmeisterConfig {
  launcherPreferences?: {
    managedToolByScope?: Record<string, string>;
  };
}

export interface ToolWithId {
  id: string;
  [key: string]: unknown;
}

function normalizeScopeId(scopeId: string | null | undefined): string | null {
  const value = String(scopeId || '').trim();
  return value || null;
}

function normalizeToolId(toolId: string | null | undefined): string | null {
  const value = String(toolId || '').trim();
  return value || null;
}

export function getLauncherPreference(
  config: LauncherConfig | null,
  scopeId: string | null | undefined,
): string | null {
  const normalizedScopeId = normalizeScopeId(scopeId);
  if (!normalizedScopeId) return null;

  return config?.launcherPreferences?.managedToolByScope?.[normalizedScopeId] || null;
}

export function setLauncherPreference(
  config: LauncherConfig | null,
  scopeId: string | null | undefined,
  toolId: string | null | undefined,
): LauncherConfig {
  const normalizedScopeId = normalizeScopeId(scopeId);
  const normalizedToolId = normalizeToolId(toolId);
  if (!normalizedScopeId || !normalizedToolId) return config || {};

  return {
    ...(config || {}),
    launcherPreferences: {
      ...(config?.launcherPreferences || {}),
      managedToolByScope: {
        ...(config?.launcherPreferences?.managedToolByScope || {}),
        [normalizedScopeId]: normalizedToolId,
      },
    },
  };
}

export function getSavedLauncherPreference(scopeId: string): string | null {
  const config = loadConfig() as LauncherConfig | null;
  return getLauncherPreference(config, scopeId);
}

export function saveLauncherPreference(scopeId: string, toolId: string): boolean {
  const config = loadConfig() as LauncherConfig | null;
  if (!config) return false;

  const nextConfig = setLauncherPreference(config, scopeId, toolId);
  saveConfig(nextConfig);
  return true;
}

export function resolvePreferredManagedTool(
  tools: ToolWithId[] = [],
  preferredToolId: string | null = null,
): ToolWithId | null {
  if (!tools.length) return null;

  const normalizedToolId = normalizeToolId(preferredToolId);
  if (normalizedToolId) {
    const preferredTool = tools.find((tool) => tool.id === normalizedToolId);
    if (preferredTool) return preferredTool;
  }

  if (tools.length === 1) return tools[0] ?? null;
  return null;
}
