/**
 * Shared types and helpers for the tool catalog / directory API.
 *
 * Used by both the Discover screen and the Customize screen's tools sub-view.
 */

export interface CatalogToolLike {
  id: string;
  name: string;
  description: string;
  category?: string | undefined;
  mcpCompatible?: boolean | undefined;
  mcpConfigurable?: boolean | undefined;
  website?: string | undefined;
  installCmd?: string | null | undefined;
  featured?: boolean | undefined;
  verdict?: string | undefined;
  confidence?: string | undefined;
}

export interface EvalEntry {
  id: string;
  name: string;
  tagline?: string | undefined;
  category?: string | undefined;
  mcp_support?: boolean | string | undefined;
  metadata?: Record<string, unknown> | undefined;
  verdict?: string | undefined;
  confidence?: string | undefined;
}

export function evalToTool(e: EvalEntry): CatalogToolLike {
  const meta = (e.metadata || {}) as {
    website?: string;
    install_command?: string;
    featured?: boolean;
  };
  return {
    id: e.id,
    name: e.name,
    description: e.tagline || '',
    category: e.category,
    mcpCompatible: !!e.mcp_support,
    website: meta.website,
    installCmd: meta.install_command,
    featured: !!meta.featured,
    verdict: e.verdict,
    confidence: e.confidence,
  };
}
