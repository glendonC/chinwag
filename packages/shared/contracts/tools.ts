/**
 * Tool catalog and directory evaluation types.
 */

export interface ToolCatalogEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  featured?: boolean;
  installCmd?: string | null;
  mcp_support?: boolean;
}

export interface ToolCatalogResponse {
  tools: ToolCatalogEntry[];
  categories: Record<string, string>;
}

export interface ToolDirectoryEvaluation {
  id: string;
  name: string;
  category: string;
  verdict: string;
  tagline?: string;
  integration_tier?: string;
  mcp_support?: boolean | string;
  metadata?: Record<string, unknown>;
}

export interface ToolDirectoryResponse {
  evaluations: ToolDirectoryEvaluation[];
  categories: Record<string, string>;
}
