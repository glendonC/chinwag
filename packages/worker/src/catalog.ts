import {
  buildAgentSurfaceCatalogEntries,
  buildHostIntegrationCatalogEntries,
} from '@chinwag/shared/integration-model.js';

// Tool Catalog -- discovery surface for the full AI dev tool catalog.
// MCP-configurable tools are derived from the shared canonical registry so
// runtime integration and discovery cannot drift apart.
//
// Discovery-only tools (Goose, Warp, CodeRabbit, etc.) are NOT hardcoded here.
// They live in the evaluation DB, seeded via the Exa Deep Search pipeline on
// first deploy and refreshable via POST /tools/batch-evaluate.
// See seed-evaluations.ts for the seed list.

export const TOOL_CATALOG = [
  ...buildHostIntegrationCatalogEntries(),
  ...buildAgentSurfaceCatalogEntries(),
];

export const CATEGORY_NAMES: Record<string, string> = {
  'coding-agent': 'Coding agents',
  ide: 'IDEs',
  voice: 'Voice-to-code',
  review: 'Code review',
  terminal: 'Terminal tools',
  docs: 'Documentation',
};
