import { loadConfig, saveConfig } from './config.js';

function normalizeScopeId(scopeId) {
  const value = String(scopeId || '').trim();
  return value || null;
}

function normalizeToolId(toolId) {
  const value = String(toolId || '').trim();
  return value || null;
}

export function getLauncherPreference(config, scopeId) {
  const normalizedScopeId = normalizeScopeId(scopeId);
  if (!normalizedScopeId) return null;

  return config?.launcherPreferences?.managedToolByScope?.[normalizedScopeId] || null;
}

export function setLauncherPreference(config, scopeId, toolId) {
  const normalizedScopeId = normalizeScopeId(scopeId);
  const normalizedToolId = normalizeToolId(toolId);
  if (!normalizedScopeId || !normalizedToolId) return config;

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

export function getSavedLauncherPreference(scopeId) {
  const config = loadConfig();
  return getLauncherPreference(config, scopeId);
}

export function saveLauncherPreference(scopeId, toolId) {
  const config = loadConfig();
  if (!config) return false;

  const nextConfig = setLauncherPreference(config, scopeId, toolId);
  saveConfig(nextConfig);
  return true;
}

export function resolvePreferredManagedTool(tools = [], preferredToolId = null) {
  if (!tools.length) return null;

  const normalizedToolId = normalizeToolId(preferredToolId);
  if (normalizedToolId) {
    const preferredTool = tools.find((tool) => tool.id === normalizedToolId);
    if (preferredTool) return preferredTool;
  }

  if (tools.length === 1) return tools[0];
  return null;
}
