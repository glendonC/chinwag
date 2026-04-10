// chinwag add <tool> — add a specific tool's MCP config.
// Pure stdout output, no TUI. Same pattern as init-command.ts.
// Fetches the full tool catalog from the API for discovery.

import { MCP_TOOLS } from '../tools.js';
import { configureTool } from '../mcp-config.js';
import { configExists, loadConfig } from '../config.js';
import { api } from '../api.js';
import { evalToTool } from '../utils/tool-catalog.js';
import type { CatalogToolLike } from '../utils/tool-catalog.js';
import type {
  ToolDirectoryResponse,
  ToolCatalogResponse,
} from '@chinwag/shared/contracts/tools.js';
import { formatError, createLogger } from '@chinwag/shared';

const log = createLogger('add');

interface CatalogResult {
  tools: CatalogToolLike[];
  categories: Record<string, string>;
}

export async function runAdd(toolArg?: string): Promise<void> {
  if (!toolArg || toolArg === '--list') {
    await printList();
    return;
  }

  const cwd = process.cwd();

  // Check if it's an MCP-configurable tool
  const mcpTool = MCP_TOOLS.find((t) => t.id === toolArg);
  if (mcpTool) {
    const result = configureTool(cwd, toolArg);
    if (result.error) {
      console.log(`  Could not add ${toolArg}: ${result.error}`);
      process.exit(1);
    }
    console.log('');
    console.log(`  Added ${result.name}: ${result.detail}`);
    console.log('');
    return;
  }

  // Fetch catalog from API for non-MCP tools
  const catalog = await fetchCatalog();
  if (!catalog) return;

  const catalogTool = catalog.tools.find((t) => t.id === toolArg);
  if (catalogTool) {
    console.log('');
    console.log(`  ${catalogTool.name} — ${catalogTool.description}`);
    if (catalogTool.verdict) {
      const conf = catalogTool.confidence ? ` (${catalogTool.confidence} confidence)` : '';
      console.log(`  Verdict: ${catalogTool.verdict}${conf}`);
    }
    if (!catalogTool.mcpCompatible) {
      console.log('  This tool does not support MCP, so chinwag cannot auto-configure it.');
    }
    if (catalogTool.installCmd) {
      console.log(`  Install: ${catalogTool.installCmd}`);
    }
    if (catalogTool.website) {
      console.log(`  Website: ${catalogTool.website}`);
    }
    console.log('');
    return;
  }

  // Not found — suggest closest match
  const match = catalog.tools.find(
    (t) => t.id.includes(toolArg) || t.name.toLowerCase().includes(toolArg.toLowerCase()),
  );
  if (match) {
    console.log(`  Unknown tool "${toolArg}". Did you mean "${match.id}"?`);
  } else {
    console.log(
      `  Unknown tool "${toolArg}". Run \`npx chinwag add --list\` to see available tools.`,
    );
  }
}

async function fetchCatalog(): Promise<CatalogResult | null> {
  const config = configExists() ? loadConfig() : null;
  try {
    const result = await api(config).get<ToolDirectoryResponse>('/tools/directory?limit=200');
    return {
      tools: (result.evaluations || []).map(evalToTool),
      categories: result.categories || {},
    };
  } catch (err: unknown) {
    log.error(formatError(err));
    // Fallback to old catalog endpoint if directory isn't deployed yet
    try {
      const fallback = await api(config).get<ToolCatalogResponse>('/tools/catalog');
      return { tools: fallback.tools || [], categories: fallback.categories || {} };
    } catch (err2: unknown) {
      log.error('Fallback catalog fetch failed: ' + formatError(err2));
      console.log('  Could not load tool catalog.');
      return null;
    }
  }
}

async function printList(): Promise<void> {
  const catalog = await fetchCatalog();
  if (!catalog) return;

  console.log('');
  console.log('  Available tools:');
  console.log('');

  // Group by category
  const groups: Record<string, CatalogToolLike[]> = {};
  for (const tool of catalog.tools) {
    const cat = tool.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(tool);
  }

  for (const [cat, tools] of Object.entries(groups)) {
    console.log(`  ${catalog.categories[cat] || cat}:`);
    for (const tool of tools) {
      const mcp = tool.mcpCompatible ? ' [MCP]' : '';
      const configurable = tool.mcpConfigurable ? ' *' : '';
      console.log(`    ${tool.id.padEnd(18)} ${tool.description}${mcp}${configurable}`);
    }
    console.log('');
  }

  console.log('  * = chinwag auto-configures MCP for this tool');
  console.log('');
}
