import { MCP_TOOLS } from '../tools.js';
import { configureTool } from '../mcp-config.js';

interface ToolEntry {
  id: string;
  name: string;
  installCmd?: string | null | undefined;
  website?: string | undefined;
}

interface ToolActionResult {
  ok: boolean;
  message: string;
}

/**
 * Attempt to add a tool to the project. Handles MCP-configured tools,
 * install-command tools, and website-only tools.
 */
export function addToolToProject(tool: ToolEntry, projectRoot: string): ToolActionResult {
  const mcpTool = MCP_TOOLS.find((t) => t.id === tool.id);
  if (mcpTool) {
    const result = configureTool(projectRoot, tool.id);
    if (result.ok) {
      return { ok: true, message: `Added ${result.name}: ${result.detail}` };
    }
    return { ok: false, message: `Could not add ${result.name || tool.name}: ${result.error}` };
  }
  if (tool.installCmd) {
    return { ok: true, message: `${tool.name} — Install: ${tool.installCmd}  |  ${tool.website}` };
  }
  if (tool.website) {
    return { ok: true, message: `${tool.name} — Visit: ${tool.website}` };
  }
  return { ok: false, message: `${tool.name}: no configuration available` };
}
