import { MCP_TOOLS } from './tool-registry.js';

/**
 * @typedef {Object} HostIntegrationRuntime
 * @property {string} hostId - Same as the parent tool's id
 * @property {string} defaultTransport - Default transport protocol
 */

/**
 * @typedef {Object} HostIntegration
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {import('./tool-registry.js').ToolDetect} detect
 * @property {import('./tool-registry.js').ToolProcessDetection} processDetection
 * @property {string} mcpConfig
 * @property {boolean} [hooks]
 * @property {boolean} [channel]
 * @property {import('./tool-registry.js').ToolSpawnConfig} [spawn]
 * @property {import('./tool-registry.js').ToolAvailabilityCheck} [availabilityCheck]
 * @property {import('./tool-registry.js').ToolFailurePattern[]} [failurePatterns]
 * @property {import('./tool-registry.js').ToolCatalog} catalog
 * @property {'host'} kind
 * @property {'managed'|'connected'} tier
 * @property {string[]} capabilities
 * @property {string} displayGroup
 * @property {HostIntegrationRuntime} runtime
 */

/**
 * @typedef {Object} AgentSurface
 * @property {string} id - Surface identifier
 * @property {string} name - Display name
 * @property {'surface'} kind
 * @property {string[]} supportedHosts - Host IDs this surface works with
 * @property {string[]} capabilities
 * @property {Object} catalog
 * @property {string} catalog.description
 * @property {string} catalog.category
 * @property {string} catalog.website
 * @property {boolean} [catalog.mcpCompatible]
 */

/**
 * @typedef {Object} CatalogEntry
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} category
 * @property {string} [website]
 * @property {string} [installCmd]
 * @property {boolean} [mcpCompatible]
 * @property {boolean} [mcpConfigurable]
 * @property {boolean} [featured]
 */

const HOST_OVERRIDES = {
  'claude-code': {
    tier: 'managed',
    capabilities: ['mcp', 'hooks', 'channel', 'managed-process'],
    displayGroup: 'host',
  },
  'cursor': {
    tier: 'connected',
    capabilities: ['mcp'],
    displayGroup: 'host',
  },
  'windsurf': {
    tier: 'connected',
    capabilities: ['mcp'],
    displayGroup: 'host',
  },
  'vscode': {
    tier: 'connected',
    capabilities: ['mcp'],
    displayGroup: 'host',
  },
  'jetbrains': {
    tier: 'connected',
    capabilities: ['mcp'],
    displayGroup: 'host',
  },
  'codex': {
    tier: 'managed',
    capabilities: ['mcp', 'managed-process'],
    displayGroup: 'host',
  },
  'aider': {
    tier: 'managed',
    capabilities: ['mcp', 'managed-process'],
    displayGroup: 'host',
  },
  'amazon-q': {
    tier: 'connected',
    capabilities: ['mcp'],
    displayGroup: 'host',
  },
};

function unique(list = []) {
  return [...new Set(list.filter(Boolean))];
}

/** @type {HostIntegration[]} */
export const HOST_INTEGRATIONS = MCP_TOOLS.map((tool) => {
  const override = HOST_OVERRIDES[tool.id] || {};
  const inferredCapabilities = unique([
    'mcp',
    tool.hooks ? 'hooks' : null,
    tool.channel ? 'channel' : null,
    tool.spawn ? 'managed-process' : null,
  ]);

  return {
    ...tool,
    kind: 'host',
    tier: override.tier || (tool.spawn ? 'managed' : 'connected'),
    capabilities: override.capabilities || inferredCapabilities,
    displayGroup: override.displayGroup || 'host',
    runtime: {
      hostId: tool.id,
      defaultTransport: 'mcp',
    },
  };
});

/** @type {AgentSurface[]} */
export const AGENT_SURFACES = [
  {
    id: 'cline',
    name: 'Cline',
    kind: 'surface',
    supportedHosts: ['vscode', 'cursor'],
    capabilities: ['mcp'],
    catalog: {
      description: 'Autonomous AI coding agent for VS Code and Cursor',
      category: 'coding-agent',
      website: 'https://cline.bot',
      mcpCompatible: true,
    },
  },
  {
    id: 'continue',
    name: 'Continue',
    kind: 'surface',
    supportedHosts: ['vscode', 'jetbrains'],
    capabilities: ['mcp'],
    catalog: {
      description: 'Open-source AI code assistant for VS Code and JetBrains',
      category: 'coding-agent',
      website: 'https://continue.dev',
      mcpCompatible: true,
    },
  },
  {
    id: 'roo-code',
    name: 'Roo Code',
    kind: 'surface',
    supportedHosts: ['vscode'],
    capabilities: ['mcp'],
    catalog: {
      description: 'Multi-agent AI coding surface for VS Code, forked from Cline',
      category: 'coding-agent',
      website: 'https://roocode.com',
      mcpCompatible: true,
    },
  },
];

/**
 * @param {string} hostId
 * @returns {HostIntegration|undefined}
 */
export function getHostIntegrationById(hostId) {
  return HOST_INTEGRATIONS.find((host) => host.id === hostId) || null;
}

/**
 * @returns {CatalogEntry[]}
 */
export function buildHostIntegrationCatalogEntries() {
  return HOST_INTEGRATIONS.map((host) => ({
    id: host.id,
    name: host.name,
    ...host.catalog,
  }));
}

/**
 * @returns {CatalogEntry[]}
 */
export function buildAgentSurfaceCatalogEntries() {
  return AGENT_SURFACES.map((surface) => ({
    id: surface.id,
    name: surface.name,
    supportedHosts: [...surface.supportedHosts],
    ...surface.catalog,
  }));
}
