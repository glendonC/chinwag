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
// Imported dynamically from catalog to avoid drift. Fallback to 'other' for unknowns.
import { CATEGORY_NAMES } from '../catalog.js';
const VALID_CATEGORIES = [...Object.keys(CATEGORY_NAMES), 'other'];

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

interface EvaluationMetadata {
  website: string | null;
  github: string | null;
  install_command: string | null;
  notable: string | null;
  favicon: string | null;
  image: string | null;
  search_results: SearchResult[];
  // Enrichment fields (populated by second Exa pass)
  ai_summary: string | null;
  strengths: string[] | null;
  integration_type: string | null;
  platform: string[] | null;
  pricing_tier: string | null;
  pricing_detail: string | null;
  github_stars: number | null;
  demo_url: string | null;
  last_updated: string | null;
  // Credibility fields (populated by third Exa pass)
  founded_year: number | null;
  team_size: string | null;
  funding_status: string | null;
  update_frequency: string | null;
  user_count_estimate: string | null;
  notable_users: string | null;
  documentation_quality: string | null;
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
  metadata: EvaluationMetadata;
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
      enum: VALID_CATEGORIES,
      description: `Tool category: ${Object.entries(CATEGORY_NAMES)
        .map(([k, v]) => `${k} (${v})`)
        .join(', ')}, or other`,
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

// Second-pass enrichment schema — product details, pricing, strengths.
// Runs as a separate Exa Deep Search call because outputSchema is capped at 10 fields.
const ENRICHMENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    ai_summary: {
      type: ['string', 'null'],
      description:
        'Two-sentence functional description of what this tool does and how developers use it. Not marketing copy — focus on what it actually does.',
    },
    strengths: {
      type: ['string', 'null'],
      description:
        'Up to 3 key differentiators separated by semicolons. Each under 40 characters. Example: "Best multi-file editing; Fastest autocomplete; Free and open source"',
    },
    integration_type: {
      type: ['string', 'null'],
      enum: ['cli', 'extension', 'app', 'web', null],
      description:
        'How users primarily interact: cli (terminal command), extension (IDE plugin), app (standalone application), web (browser-based)',
    },
    platforms: {
      type: ['string', 'null'],
      description:
        'Comma-separated platforms: mac, windows, linux, web. Example: "mac, windows, linux"',
    },
    pricing_tier: {
      type: ['string', 'null'],
      enum: ['free', 'freemium', 'paid', 'enterprise', null],
      description:
        'free (completely free/OSS), freemium (free tier + paid), paid (requires payment), enterprise (custom/sales)',
    },
    pricing_detail: {
      type: ['string', 'null'],
      description:
        'Short pricing summary, max 60 chars. Example: "Free / $20 Pro / $40 Team" or "Open source, free forever"',
    },
    github_stars: {
      type: ['number', 'null'],
      description: 'Approximate number of GitHub stars if open source, else null',
    },
    demo_url: {
      type: ['string', 'null'],
      description:
        'URL to an official product demo video (YouTube, Vimeo, or direct video link). null if none found.',
    },
  },
  required: [],
};

// Third-pass credibility schema — sustainability, team, funding, maintenance signals.
// These feed the Signal Score on the frontend for transparent, data-driven ranking.
const CREDIBILITY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    founded_year: {
      type: ['number', 'null'],
      description: 'Year the tool was first released or the company was founded. null if unknown.',
    },
    team_size: {
      type: ['string', 'null'],
      enum: ['solo', 'small', 'medium', 'large', 'enterprise', null],
      description:
        'Team size: solo (1 person), small (2-10), medium (11-50), large (51-200), enterprise (200+). null if unknown.',
    },
    funding_status: {
      type: ['string', 'null'],
      enum: ['bootstrapped', 'seed', 'series_a_plus', 'public', 'acquired', null],
      description:
        'Funding stage: bootstrapped (self-funded/OSS), seed (angel/seed round), series_a_plus (Series A or later), public (publicly traded), acquired. null if unknown.',
    },
    update_frequency: {
      type: ['string', 'null'],
      enum: ['daily', 'weekly', 'monthly', 'stale', null],
      description:
        'How often the tool is updated based on GitHub commits or release notes. daily = commits most days, weekly = at least weekly, monthly = roughly monthly, stale = no update in 6+ months.',
    },
    user_count_estimate: {
      type: ['string', 'null'],
      description:
        'Approximate user count if publicly known, e.g. "500k+ users" or "2M+ downloads". null if unknown.',
    },
    notable_users: {
      type: ['string', 'null'],
      description:
        'Semicolon-separated list of notable companies or organizations using this tool. Example: "Google;Netflix;Stripe". null if unknown.',
    },
    documentation_quality: {
      type: ['string', 'null'],
      enum: ['comprehensive', 'good', 'minimal', 'none', null],
      description:
        'Quality of documentation: comprehensive (full docs site with guides, API reference, examples), good (decent docs), minimal (README only), none. null if unknown.',
    },
  },
  required: [],
};

/**
 * Run credibility pass — gathers sustainability and team signals.
 * Returns credibility fields to merge into metadata, or null on failure.
 */
async function runCredibilityPass(
  toolName: string,
  env: Env,
): Promise<Partial<EvaluationMetadata> | null> {
  const result = await deepSearchEvaluate(
    toolName,
    CREDIBILITY_SCHEMA,
    env,
    `You are researching "${toolName}" to understand how established, sustainable, and well-maintained it is. Focus on factual data: when it was founded, who built it, how it's funded, how actively maintained it is, and who uses it. Use null for anything you cannot verify.`,
  );

  if ('error' in result || !result.output) return null;
  const out = result.output as Record<string, unknown>;

  return {
    founded_year: typeof out.founded_year === 'number' ? out.founded_year : null,
    team_size: typeof out.team_size === 'string' ? out.team_size : null,
    funding_status: typeof out.funding_status === 'string' ? out.funding_status : null,
    update_frequency: typeof out.update_frequency === 'string' ? out.update_frequency : null,
    user_count_estimate:
      typeof out.user_count_estimate === 'string' ? out.user_count_estimate : null,
    notable_users: typeof out.notable_users === 'string' ? out.notable_users : null,
    documentation_quality:
      typeof out.documentation_quality === 'string' ? out.documentation_quality : null,
  };
}

/**
 * Run enrichment pass — fetches product details, pricing, strengths.
 * Returns enrichment fields to merge into metadata, or null on failure.
 */
async function runEnrichment(
  toolName: string,
  env: Env,
): Promise<Partial<EvaluationMetadata> | null> {
  const result = await deepSearchEvaluate(
    toolName,
    ENRICHMENT_SCHEMA,
    env,
    `You are researching "${toolName}" to help developers understand what it does, how much it costs, and what makes it stand out. Focus on factual product details from the official website. If you cannot find pricing or a demo video, use null.`,
  );

  if ('error' in result || !result.output) return null;

  const out = result.output as Record<string, unknown>;

  // Parse strengths from semicolon-separated string to array
  let strengths: string[] | null = null;
  if (typeof out.strengths === 'string' && out.strengths.trim()) {
    strengths = out.strengths
      .split(/;\s*/)
      .filter((s) => s.length > 0)
      .slice(0, 3);
  }

  // Parse platforms from comma-separated string to array
  let platform: string[] | null = null;
  if (typeof out.platforms === 'string' && out.platforms.trim()) {
    platform = out.platforms
      .split(/,\s*/)
      .filter((p) => p.length > 0)
      .map((p) => p.toLowerCase());
  }

  return {
    ai_summary: typeof out.ai_summary === 'string' ? out.ai_summary : null,
    strengths,
    integration_type: typeof out.integration_type === 'string' ? out.integration_type : null,
    platform,
    pricing_tier: typeof out.pricing_tier === 'string' ? out.pricing_tier : null,
    pricing_detail: typeof out.pricing_detail === 'string' ? out.pricing_detail : null,
    github_stars: typeof out.github_stars === 'number' ? out.github_stars : null,
    demo_url: typeof out.demo_url === 'string' ? out.demo_url : null,
  };
}

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
      favicon: searchResults.find((r) => r.favicon)?.favicon || null,
      image: searchResults.find((r) => r.image)?.image || null,
      search_results: searchResults.slice(0, 10),
      // Enrichment fields — populated by second pass, null until then
      ai_summary: null,
      strengths: null,
      integration_type: null,
      platform: null,
      pricing_tier: null,
      pricing_detail: null,
      github_stars: null,
      demo_url: null,
      last_updated: null,
      // Credibility fields — populated by third pass, null until then
      founded_year: null,
      team_size: null,
      funding_status: null,
      update_frequency: null,
      user_count_estimate: null,
      notable_users: null,
      documentation_quality: null,
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
    // Pass 1: Core evaluation — name, category, MCP, CLI, website, etc.
    const result = await deepSearchEvaluate(input, EVALUATION_SCHEMA, env);

    if ('error' in result) return { error: result.error };
    if (!result.output) return { error: 'Exa returned no output' };
    if (!(result.output as any).name) return { error: 'Exa output missing tool name' };

    const evaluation = toEvaluation(result.output, result.grounding, result.results || []);

    // Pass 2: Enrichment — strengths, pricing, platforms, demo, ai_summary
    const enrichment = await runEnrichment(evaluation.name, env);
    if (enrichment) {
      Object.assign(evaluation.metadata, enrichment);
    }

    // Pass 3: Credibility — team, funding, maintenance, sustainability signals
    const credibility = await runCredibilityPass(evaluation.name, env);
    if (credibility) {
      Object.assign(evaluation.metadata, credibility);
    }

    return { ok: true, evaluation };
  } catch (err) {
    return { error: (err as Error).message || 'Evaluation failed' };
  }
}

/**
 * Enrich an existing evaluation with product details.
 * Used for backfilling — only runs the enrichment pass, returns merged metadata.
 */
export async function enrichExistingTool(
  toolName: string,
  existingMetadata: Record<string, unknown>,
  env: Env,
): Promise<{ ok: true; metadata: Record<string, unknown> } | { error: string }> {
  const enrichment = await runEnrichment(toolName, env);
  if (!enrichment) return { error: 'Enrichment failed — no data returned' };
  return { ok: true, metadata: { ...existingMetadata, ...enrichment } };
}

/**
 * Add credibility signals to an existing evaluation.
 * Used for backfilling — only runs the credibility pass, returns merged metadata.
 */
export async function enrichCredibility(
  toolName: string,
  existingMetadata: Record<string, unknown>,
  env: Env,
): Promise<{ ok: true; metadata: Record<string, unknown> } | { error: string }> {
  const credibility = await runCredibilityPass(toolName, env);
  if (!credibility) return { error: 'Credibility pass failed — no data returned' };
  return { ok: true, metadata: { ...existingMetadata, ...credibility } };
}
