// Canonical machine-facing tool registry lives in shared code so CLI, MCP,
// and worker discovery stay in sync.
export { MCP_TOOLS, getMcpToolById } from '@chinmeister/shared/tool-registry.js';
