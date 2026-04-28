// chinmeister add <tool> - write MCP config for a specific tool from the registry.
// Pure stdout output, no TUI.

import { MCP_TOOLS } from '../tools.js';
import { configureTool } from '../mcp-config.js';

export async function runAdd(toolArg?: string): Promise<void> {
  if (!toolArg) {
    console.log('');
    console.log('  Usage: npx chinmeister add <tool>');
    console.log('');
    printAvailable();
    return;
  }

  const tool = MCP_TOOLS.find((t) => t.id === toolArg);
  if (tool) {
    const result = configureTool(process.cwd(), toolArg);
    if (result.error) {
      console.log(`  Could not add ${toolArg}: ${result.error}`);
      process.exit(1);
    }
    console.log('');
    console.log(`  Added ${result.name}: ${result.detail}`);
    console.log('');
    return;
  }

  const match = MCP_TOOLS.find(
    (t) => t.id.includes(toolArg) || t.name.toLowerCase().includes(toolArg.toLowerCase()),
  );
  if (match) {
    console.log(`  Unknown tool "${toolArg}". Did you mean "${match.id}"?`);
  } else {
    console.log(`  Unknown tool "${toolArg}".`);
    console.log('');
    printAvailable();
  }
}

function printAvailable(): void {
  console.log('  Available tools:');
  const maxId = Math.max(...MCP_TOOLS.map((t) => t.id.length));
  for (const tool of MCP_TOOLS) {
    console.log(`    ${tool.id.padEnd(maxId + 2)}${tool.name}`);
  }
  console.log('');
}
