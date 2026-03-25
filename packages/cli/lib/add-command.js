// chinwag add <tool> — add a specific tool's MCP config.
// Pure stdout output, no TUI. Same pattern as init-command.js.
// Fetches the full tool catalog from the API for discovery.

import { MCP_TOOLS } from './tools.js';
import { configureTool } from './mcp-config.js';
import { configExists, loadConfig } from './config.js';
import { api } from './api.js';

export async function runAdd(toolArg) {
  if (!toolArg || toolArg === '--list') {
    await printList();
    return;
  }

  const cwd = process.cwd();

  // Check if it's an MCP-configurable tool
  const mcpTool = MCP_TOOLS.find(t => t.id === toolArg);
  if (mcpTool) {
    const result = configureTool(cwd, toolArg);
    if (result.error) {
      console.log(`  error: ${result.error}`);
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

  const catalogTool = catalog.tools.find(t => t.id === toolArg);
  if (catalogTool) {
    console.log('');
    console.log(`  ${catalogTool.name} — ${catalogTool.description}`);
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
  const match = catalog.tools.find(t =>
    t.id.includes(toolArg) || t.name.toLowerCase().includes(toolArg.toLowerCase())
  );
  if (match) {
    console.log(`  Unknown tool "${toolArg}". Did you mean "${match.id}"?`);
  } else {
    console.log(`  Unknown tool "${toolArg}". Run \`npx chinwag add --list\` to see available tools.`);
  }
}

async function fetchCatalog() {
  try {
    const config = configExists() ? loadConfig() : null;
    return await api(config).get('/tools/catalog');
  } catch (err) {
    console.log(`  Could not fetch tool catalog: ${err.message}`);
    return null;
  }
}

async function printList() {
  const catalog = await fetchCatalog();
  if (!catalog) return;

  console.log('');
  console.log('  Available tools:');
  console.log('');

  // Group by category
  const groups = {};
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
