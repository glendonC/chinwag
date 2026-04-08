import {
  buildAgentSurfaceCatalogEntries,
  buildHostIntegrationCatalogEntries,
} from '@chinwag/shared/integration-model.js';

// Tool Catalog -- discovery surface for the full AI dev tool catalog.
// MCP-configurable tools are derived from the shared canonical registry so
// runtime integration and discovery cannot drift apart.
//
// Discovery-only tools live in the evaluation DB, populated via admin import
// scripts (scripts/import-seed-tools.ts, scripts/merge-enrichment.ts).
// New tools are added via community submissions or periodic agent research sweeps.

export const TOOL_CATALOG = [
  ...buildHostIntegrationCatalogEntries(),
  ...buildAgentSurfaceCatalogEntries(),
];

// 13 browse categories — derived from 6-agent research + 3-agent challenge process.
//
// Architecture: categories (primary, one per tool) + tags (secondary, multiple per tool).
// Tags live in evaluation metadata as string[]. When a tag accumulates 8+ tools,
// it can be promoted to a full category without restructuring.
//
// Mental model mapping (6 developer super-buckets → 14 browse categories):
//   Write Code   → editors, coding-agents
//   Verify Code  → code-quality, security, testing
//   Build AI     → ai-models, ai-frameworks
//   Get Data     → data-search, databases
//   Ship Code    → infrastructure
//   Work Locally → terminal-cli
//   Create & Collaborate → documentation, collaboration
export const CATEGORY_NAMES: Record<string, string> = {
  editors: 'Editors',
  'coding-agents': 'Coding Agents',
  'code-quality': 'Code Quality',
  security: 'Security',
  testing: 'Testing',
  'ai-models': 'AI Models',
  'ai-frameworks': 'AI Frameworks',
  'data-search': 'Data & Search',
  databases: 'Databases',
  infrastructure: 'Infrastructure',
  'terminal-cli': 'Terminal & CLI',
  documentation: 'Documentation',
  collaboration: 'Collaboration',
};
