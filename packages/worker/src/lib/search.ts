// Exa API client for tool evaluation pipeline.
// Two capabilities:
//   1. Deep Search + outputSchema + grounding — evaluates a single tool
//   2. Research — discovers new tools (async, for monthly scans)

import type { Env } from '../types.js';

const EXA_SEARCH_URL = 'https://api.exa.ai/search';
const EXA_RESEARCH_URL = 'https://api.exa.ai/research/v1';
const TIMEOUT = 60_000;

function headers(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-api-key': apiKey };
}

interface SearchResult {
  title: string;
  url: string;
  favicon: string | null;
  image: string | null;
}

interface DeepSearchSuccess {
  output: unknown;
  grounding: unknown[];
  results: SearchResult[];
}

interface SearchError {
  error: string;
}

type DeepSearchResult = DeepSearchSuccess | SearchError;

/**
 * Evaluate a single tool using Exa Deep Search with structured output.
 * Returns { output, grounding } or { error }.
 */
export async function deepSearchEvaluate(
  toolName: string,
  outputSchema: Record<string, unknown>,
  env: Env,
  customSystemPrompt?: string,
): Promise<DeepSearchResult> {
  const apiKey = env.EXA_API_KEY;
  if (!apiKey) return { error: 'EXA_API_KEY not configured' };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);

    const defaultPrompt = `You are evaluating "${toolName}" for compatibility with chinwag, an MCP-based coordination layer for AI dev tools. MCP (Model Context Protocol) is a JSON-RPC protocol — a tool "supports MCP" if it can connect to MCP servers via config files like .mcp.json. Be precise: if you cannot find evidence of a capability, use null, never guess.`;

    const res = await fetch(EXA_SEARCH_URL, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({
        query: `${toolName} AI developer tool — what is it, does it support MCP (Model Context Protocol), CLI installation, open source, hooks support`,
        type: 'deep',
        numResults: 10,
        outputSchema,
        systemPrompt: customSystemPrompt || defaultPrompt,
        contents: { text: true },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: `Exa API error ${res.status}: ${text.slice(0, 200)}` };
    }

    const data: any = await res.json();
    return {
      output: data.output?.content || null,
      grounding: data.output?.grounding || [],
      results: (data.results || []).map((r: any) => ({
        title: r.title,
        url: r.url,
        favicon: r.favicon || null,
        image: r.image || null,
      })),
    };
  } catch (err) {
    const e = err as Error & { name: string };
    return { error: e.name === 'AbortError' ? 'Exa search timed out' : e.message };
  }
}

/**
 * Find a product demo video for a tool — any platform, not restricted to one host.
 * Searches for official demos, walkthroughs, and product tours across the web.
 */
export async function findDemoVideo(toolName: string, env: Env): Promise<string | null> {
  const apiKey = env.EXA_API_KEY;
  if (!apiKey) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(EXA_SEARCH_URL, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({
        query: `${toolName} product demo video walkthrough how it works`,
        type: 'neural',
        numResults: 5,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) return null;

    const data: any = await res.json();
    const results = data.results || [];

    // Video-hosting signals — any URL containing these is likely a playable video
    const videoSignals = [
      'youtube.com/watch',
      'youtu.be/',
      'vimeo.com/',
      'loom.com/share',
      'twitter.com/i/status',
      'x.com/i/status',
      '/demo',
      '/walkthrough',
      '/tour',
      '.mp4',
      '.webm',
    ];

    const toolLower = toolName.toLowerCase().split(/\s+/)[0];

    // First pass: find a video URL that references the tool by name
    for (const r of results) {
      if (!r.url) continue;
      const urlLower = r.url.toLowerCase();
      const titleLower = (r.title || '').toLowerCase();
      const isVideo = videoSignals.some((s) => urlLower.includes(s));
      const mentionsTool = titleLower.includes(toolLower) || urlLower.includes(toolLower);
      if (isVideo && mentionsTool) return r.url;
    }

    // Second pass: any video URL from results
    for (const r of results) {
      if (!r.url) continue;
      const urlLower = r.url.toLowerCase();
      if (videoSignals.some((s) => urlLower.includes(s))) return r.url;
    }

    return null;
  } catch {
    return null;
  }
}

interface ResearchSuccess {
  researchId: string;
  status: string;
}

type ResearchStartResult = ResearchSuccess | SearchError;

/**
 * Start an async research task for tool discovery.
 * Returns { researchId } or { error }.
 */
export async function startResearch(
  instructions: string,
  env: Env,
  model = 'exa-research',
): Promise<ResearchStartResult> {
  const apiKey = env.EXA_API_KEY;
  if (!apiKey) return { error: 'EXA_API_KEY not configured' };

  try {
    const res = await fetch(EXA_RESEARCH_URL, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({ instructions, model }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: `Exa Research error ${res.status}: ${text.slice(0, 200)}` };
    }

    const data: any = await res.json();
    return { researchId: data.researchId, status: data.status };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Poll a research task for completion.
 * Returns the full research result or current status.
 */
export async function pollResearch(
  researchId: string,
  env: Env,
): Promise<Record<string, unknown> | SearchError> {
  const apiKey = env.EXA_API_KEY;
  if (!apiKey) return { error: 'EXA_API_KEY not configured' };

  try {
    const res = await fetch(`${EXA_RESEARCH_URL}/${researchId}`, {
      method: 'GET',
      headers: headers(apiKey),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: `Exa poll error ${res.status}: ${text.slice(0, 200)}` };
    }

    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    return { error: (err as Error).message };
  }
}
