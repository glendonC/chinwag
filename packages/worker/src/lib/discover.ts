// Tool discovery pipeline — finds new AI developer tools via Exa search.
//
// Queries are GENERATED from the category registry, not hardcoded.
// Each category produces a focused search query. Cross-category sweeps
// are added dynamically. The system scales as categories are added —
// no manual query maintenance needed.

import type { Env } from '../types.js';
import { CATEGORY_NAMES } from '../catalog.js';

const EXA_SEARCH_URL = 'https://api.exa.ai/search';
const TIMEOUT = 30_000;

function headers(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-api-key': apiKey };
}

// Category → query template mapping. Each category gets ONE focused query.
// Adding a category to CATEGORY_NAMES automatically adds a discovery query.
// Queries are written for Exa's neural search — natural language, not keyword stuffing.
const CATEGORY_QUERY_TEMPLATES: Record<string, string> = {
  'coding-agent': 'AI pair programming agent that writes code in your repo',
  ide: 'AI-native code editor or IDE with built-in AI features',
  voice: 'voice-to-code dictation tool for programmers',
  review: 'AI-powered code review tool for pull requests',
  terminal: 'AI-powered terminal or shell assistant for developers',
  docs: 'AI tool that generates or maintains code documentation',
  testing: 'AI tool that generates unit tests and integration tests for code',
  security: 'AI-powered code security scanner for vulnerabilities',
  'design-to-code': 'AI tool that converts designs or prompts into frontend code',
  refactoring: 'AI tool for automated code refactoring and codemod migration',
  debugging: 'standalone AI debugging tool that diagnoses code errors',
};

// Default template for categories without a custom query
const DEFAULT_QUERY_TEMPLATE = 'AI {category} tool for software developers';

/**
 * Generate discovery queries from the category registry.
 * Categories drive queries — adding a category automatically
 * generates a new discovery query. No manual list to maintain.
 */
function buildQueries(): string[] {
  const year = new Date().getFullYear();
  const queries: string[] = [];

  // Cross-category sweeps (always included, year is dynamic)
  queries.push(`best AI developer tools list ${year}`);
  queries.push(`AI developer tools startup new launch ${year}`);
  queries.push(`MCP model context protocol server developer tool`);

  // Per-category queries — driven by CATEGORY_NAMES + template overrides
  const allCategories = new Set([
    ...Object.keys(CATEGORY_NAMES),
    ...Object.keys(CATEGORY_QUERY_TEMPLATES),
  ]);

  for (const cat of allCategories) {
    const template = CATEGORY_QUERY_TEMPLATES[cat];
    if (template) {
      queries.push(template);
    } else {
      // Dynamic fallback for categories without custom templates
      const label = CATEGORY_NAMES[cat] || cat.replace(/-/g, ' ');
      queries.push(DEFAULT_QUERY_TEMPLATE.replace('{category}', label));
    }
  }

  // IDE extension sub-query (extensions are distinct from IDEs)
  queries.push('AI extension copilot alternative VS Code JetBrains');

  return queries;
}

/**
 * Check if a URL is an aggregator/list site rather than an individual tool page.
 * Uses URL pattern detection instead of a hardcoded domain blocklist.
 */
function isAggregatorUrl(url: string): boolean {
  const lower = url.toLowerCase();

  // Known aggregator domains (stable, high-confidence)
  const aggregatorPatterns = [
    // Comparison/review sites
    'alternativeto.com',
    'g2.com',
    'capterra.com',
    'slant.co',
    'stackshare.io',
    // Social/news (not tool pages)
    'reddit.com',
    'news.ycombinator.com',
    // Media/video (not tool pages)
    'youtube.com',
    'twitter.com',
    'x.com',
    'wikipedia.org',
  ];
  if (aggregatorPatterns.some((p) => lower.includes(p))) return true;

  // URL path patterns that signal aggregation, not an individual tool
  const aggregatorPaths = [
    '/best-',
    '/top-',
    '/compare/',
    '/alternatives/',
    '/vs/',
    '/comparison/',
    '/reviews/',
    '/topics/',
    '/collections/',
    '/awesome-',
  ];
  if (aggregatorPaths.some((p) => lower.includes(p))) return true;

  // Blog/content platforms where the tool isn't the domain owner
  const blogPlatforms = [
    'medium.com/',
    'dev.to/',
    'hackernoon.com/',
    'techcrunch.com/',
    'producthunt.com/',
  ];
  if (blogPlatforms.some((p) => lower.includes(p))) return true;

  return false;
}

interface DiscoveredTool {
  name: string;
  url: string;
  source_query: string;
}

interface DiscoveryResult {
  discovered: DiscoveredTool[];
  new_tools: string[];
  queries_run: number;
  queries_used: string[];
  total_results: number;
  errors: string[];
}

/**
 * Run discovery queries to find AI developer tools we don't know about yet.
 * Returns deduplicated list of tool names/URLs not in our existing evaluations.
 */
export async function discoverTools(existingIds: string[], env: Env): Promise<DiscoveryResult> {
  const apiKey = env.EXA_API_KEY;
  if (!apiKey) {
    return {
      discovered: [],
      new_tools: [],
      queries_run: 0,
      queries_used: [],
      total_results: 0,
      errors: ['EXA_API_KEY not configured'],
    };
  }

  const queries = buildQueries();
  const existingSet = new Set(existingIds.map((id) => id.toLowerCase()));
  const seen = new Map<string, DiscoveredTool>(); // domain → tool
  const errors: string[] = [];
  let totalResults = 0;

  for (const query of queries) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT);

      const res = await fetch(EXA_SEARCH_URL, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify({
          query,
          type: 'neural',
          numResults: 10,
          contents: { text: { maxCharacters: 500 } },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        errors.push(`"${query.slice(0, 50)}…" → ${res.status}: ${text.slice(0, 100)}`);
        continue;
      }

      const data: any = await res.json();
      const results = data.results || [];
      totalResults += results.length;

      for (const r of results) {
        if (!r.url || !r.title) continue;
        if (isAggregatorUrl(r.url)) continue;

        // Extract domain for dedup
        let domain: string;
        try {
          const hostname = new URL(r.url).hostname.replace(/^www\./, '');
          // Normalize to base domain (drop subdomains like docs., blog., etc.)
          const parts = hostname.split('.');
          domain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;
        } catch {
          continue;
        }

        // Extract tool name — titles typically follow "ToolName - Description"
        const name = r.title
          .split(/\s*[-–—:|]\s*/)[0]
          .replace(/\s*(AI|Tool|App|IDE|Editor|Platform|by\s.*)$/i, '')
          .trim();

        if (!name || name.length < 2 || name.length > 60) continue;
        // Skip names that are clearly article titles, not tool names
        if (/^(best|top|how|why|what|the|\d+)/i.test(name)) continue;

        // Generate slug for dedup against existing evaluations
        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');

        if (existingSet.has(slug)) continue;

        // Dedup by domain — first discovery wins
        if (!seen.has(domain)) {
          seen.set(domain, { name, url: r.url, source_query: query });
        }
      }
    } catch (err) {
      const e = err as Error & { name: string };
      errors.push(`"${query.slice(0, 50)}…" → ${e.name === 'AbortError' ? 'timeout' : e.message}`);
    }
  }

  const discovered = Array.from(seen.values());

  return {
    discovered,
    new_tools: discovered.map((d) => d.name),
    queries_run: queries.length,
    queries_used: queries,
    total_results: totalResults,
    errors,
  };
}
