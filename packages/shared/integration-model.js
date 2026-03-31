import { MCP_TOOLS } from './tool-registry.js';

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

export function getHostIntegrationById(hostId) {
  return HOST_INTEGRATIONS.find((host) => host.id === hostId) || null;
}

export function buildHostIntegrationCatalogEntries() {
  return HOST_INTEGRATIONS.map((host) => ({
    id: host.id,
    name: host.name,
    ...host.catalog,
  }));
}

export function buildAgentSurfaceCatalogEntries() {
  return AGENT_SURFACES.map((surface) => ({
    id: surface.id,
    name: surface.name,
    supportedHosts: [...surface.supportedHosts],
    ...surface.catalog,
  }));
}
