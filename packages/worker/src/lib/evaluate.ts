// Tool evaluation pipeline — powered by Exa Deep Search.
//
// Uses Exa's structured output + grounding for per-field citations.
// No Workers AI needed. No prompt engineering. No hallucinated URLs.
// Every claim is backed by a page Exa actually crawled.

import type { Env } from '../types.js';
import { deepSearchEvaluate } from './search.js';

// Verdicts describe integration depth, not quality. Every tool belongs in the directory.
// - integrated: chinwag coordinates with it (MCP support)
// - installable: chinwag can help set it up (has CLI/install command)
// - listed: chinwag tells you about it (discovery, no direct integration yet)
const VALID_CATEGORIES = ['ide', 'coding-agent', 'terminal', 'review', 'voice', 'docs', 'other'];

type Verdict = 'integrated' | 'installable' | 'listed';
type Tier = 'managed' | 'connected' | 'installable' | 'listed';
type Confidence = 'high' | 'medium' | 'low';

interface GroundingEntry {
  field: string;
  confidence: string;
  citations: Array<{ url: string; title: string }>;
}

interface EvaluationSource {
  claim: string;
  citations: Array<{ url: string; title: string }>;
  confidence: string;
}

interface SearchResult {
  title: string;
  url: string;
  favicon: string | null;
  image: string | null;
}

interface Evaluation {
  id: string;
  name: string;
  tagline: string | null;
  category: string;
  mcp_support: number | null;
  has_cli: number | null;
  hooks_support: number | null;
  channel_support: number | null;
  process_detectable: number | null;
  open_source: number | null;
  verdict: Verdict;
  integration_tier: Tier;
  blocking_issues: string[];
  metadata: {
    website: string | null;
    github: string | null;
    install_command: string | null;
    notable: string | null;
    favicon: string | null;
    image: string | null;
    search_results: SearchResult[];
  };
  sources: EvaluationSource[];
  in_registry: number;
  evaluated_at: string;
  confidence: Confidence;
  evaluated_by: string;
}

// JSON Schema (draft-07) sent to Exa's outputSchema parameter.
// Exa fills this in from crawled pages and provides per-field grounding.
// Exa Deep Search limits outputSchema to 10 properties.
// We ask for the 10 most important fields, then derive the rest.
const EVALUATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Official product name' },
    tagline: { type: 'string', description: 'One-line description from their website' },
    category: {
      type: 'string',
      enum: ['ide', 'coding-agent', 'terminal', 'review', 'voice', 'docs', 'other'],
      description:
        'ide (full IDE like Cursor, VS Code), coding-agent (AI agent like Claude Code, Aider), terminal (Warp), review (CodeRabbit), voice, docs, other',
    },
    mcp_support: {
      type: ['boolean', 'null'],
      description:
        'Does this tool support MCP (Model Context Protocol)? true ONLY if docs explicitly mention MCP servers, .mcp.json, or model context protocol. null if not mentioned.',
    },
    has_cli: {
      type: ['boolean', 'null'],
      description: 'Does this tool have a CLI binary you can run from a terminal? null if unknown.',
    },
    open_source: {
      type: ['boolean', 'null'],
      description: 'Is this tool open source (GitHub/GitLab repo available)? null if unknown.',
    },
    website: { type: ['string', 'null'], description: 'Official website URL' },
    github: {
      type: ['string', 'null'],
      description: 'GitHub/GitLab repository URL if open source, else null',
    },
    install_command: {
      type: ['string', 'null'],
      description: 'Primary install command (brew install, npm i -g, etc.) or null',
    },
    notable: {
      type: ['string', 'null'],
      description:
        'One sentence: what makes this tool unique and how it relates to AI-assisted development',
    },
  },
  required: ['name', 'category'],
};

function generateId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Derive verdict (integration depth) and tier from Exa's structured output.
// Every tool belongs — the question is how deeply chinwag integrates with it.
function deriveVerdict(output: any): { verdict: Verdict; tier: Tier } {
  if (output.mcp_support === true) {
    if (output.hooks_support === true) return { verdict: 'integrated', tier: 'managed' };
    return { verdict: 'integrated', tier: 'connected' };
  }
  if (output.has_cli === true || output.install_command) {
    return { verdict: 'installable', tier: 'installable' };
  }
  return { verdict: 'listed', tier: 'listed' };
}

// Derive overall confidence from Exa's per-field grounding
function deriveConfidence(grounding: unknown[]): Confidence {
  if (!grounding || grounding.length === 0) return 'low';
  const entries = grounding as GroundingEntry[];
  const confidences = entries.map((g) => g.confidence).filter(Boolean);
  const highCount = confidences.filter((c) => c === 'high').length;
  const medCount = confidences.filter((c) => c === 'medium').length;
  if (highCount >= 3) return 'high';
  if (highCount >= 1 || medCount >= 2) return 'medium';
  return 'low';
}

// Map Exa grounding to our sources format
function mapGrounding(grounding: unknown[]): EvaluationSource[] {
  if (!grounding || !Array.isArray(grounding)) return [];
  return (grounding as GroundingEntry[]).map((g) => ({
    claim: g.field,
    citations: (g.citations || []).map((c) => ({ url: c.url, title: c.title })),
    confidence: g.confidence || 'low',
  }));
}

// Convert Exa output + grounding into our evaluation schema
function toBool(val: unknown): number | null {
  if (val == null) return null;
  return val ? 1 : 0;
}

function toEvaluation(
  output: any,
  grounding: unknown[],
  searchResults: SearchResult[],
): Evaluation {
  const { verdict, tier } = deriveVerdict(output);
  const confidence = deriveConfidence(grounding);

  const blocking: string[] = [];
  if (output.mcp_support === false)
    blocking.push('No MCP support — coordination not available yet');
  if (output.has_cli === false && !output.install_command)
    blocking.push('No CLI — manual install required');

  return {
    id: generateId(output.name),
    name: output.name,
    tagline: output.tagline || null,
    category: VALID_CATEGORIES.includes(output.category) ? output.category : 'other',
    mcp_support: toBool(output.mcp_support),
    has_cli: toBool(output.has_cli),
    hooks_support: null, // Not in Exa schema — derived from registry if known
    channel_support: null, // Not in Exa schema — derived from registry if known
    process_detectable: toBool(output.has_cli), // CLI implies process detectable
    open_source: toBool(output.open_source),
    verdict,
    integration_tier: tier,
    blocking_issues: blocking,
    metadata: {
      website: output.website || null,
      github: output.github || null,
      install_command: output.install_command || null,
      notable: output.notable || null,
      // Favicon from the first search result (typically the official site)
      favicon: searchResults.find((r) => r.favicon)?.favicon || null,
      image: searchResults.find((r) => r.image)?.image || null,
      search_results: searchResults.slice(0, 10),
    },
    sources: mapGrounding(grounding),
    in_registry: 0,
    evaluated_at: new Date().toISOString(),
    confidence,
    evaluated_by: 'exa:deep-search',
  };
}

export async function evaluateTool(
  nameOrUrl: string,
  env: Env,
): Promise<{ ok: true; evaluation: Evaluation } | { error: string }> {
  if (!nameOrUrl || typeof nameOrUrl !== 'string' || !nameOrUrl.trim()) {
    return { error: 'Tool name or URL is required' };
  }

  const input = nameOrUrl.trim();

  try {
    const result = await deepSearchEvaluate(input, EVALUATION_SCHEMA, env);

    if ('error' in result) return { error: result.error };
    if (!result.output) return { error: 'Exa returned no output' };
    if (!(result.output as any).name) return { error: 'Exa output missing tool name' };

    const evaluation = toEvaluation(result.output, result.grounding, result.results || []);
    return { ok: true, evaluation };
  } catch (err) {
    return { error: (err as Error).message || 'Evaluation failed' };
  }
}
