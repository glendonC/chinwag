#!/usr/bin/env npx tsx
// Import seed tools into the tool directory from curated metadata.
// Constructs evaluation objects from the seed list + META entries
// and pushes them to the API via admin-import.
//
// Usage: npx tsx scripts/import-seed-tools.ts [--api URL] [--dry-run]

import { readFileSync } from 'fs';
import { SEED_TOOLS, type SeedTool } from '../packages/worker/src/lib/seed-tools.js';

function loadApiKey(): string {
  try {
    const vars = readFileSync('packages/worker/.dev.vars', 'utf8');
    const match = vars.match(/^ADMIN_KEY=(.+)$/m);
    if (match?.[1]?.trim()) return match[1].trim();
  } catch {
    // .dev.vars not found
  }
  throw new Error('No ADMIN_KEY in packages/worker/.dev.vars');
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const API_BASE = (() => {
  const idx = args.indexOf('--api');
  return idx >= 0 ? args[idx + 1] : 'https://chinwag-api.glendonchin.workers.dev';
})();
const ADMIN_KEY = DRY_RUN ? 'dummy' : loadApiKey();

// ── Curated metadata from research agents ──
// Key = tool name (must match SEED_TOOLS), value = metadata fields.

interface ToolMeta {
  tagline: string;
  mcp: boolean | null;
  cli: boolean | null;
  open_source: boolean | null;
  website?: string;
  github?: string;
}

const META: Record<string, ToolMeta> = {
  // ── IDEs ──
  Cursor: {
    tagline: 'AI-native code editor with inline completions, agent mode, and background agents',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://cursor.com',
  },
  Windsurf: {
    tagline: 'AI IDE with autonomous Cascade agent and deep codebase understanding',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://windsurf.com',
  },
  Zed: {
    tagline: 'High-performance open-source editor with composable AI and MCP support',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://zed.dev',
    github: 'https://github.com/zed-industries/zed',
  },
  Trae: {
    tagline: 'Free AI IDE by ByteDance with Builder Mode for full-project scaffolding',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://trae.ai',
  },
  Kiro: {
    tagline: 'AWS spec-driven agentic IDE that turns prompts into specs, then code and tests',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://kiro.dev',
  },
  PearAI: {
    tagline: 'Open-source VS Code fork with BYOK model access and creator mode',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://trypear.ai',
    github: 'https://github.com/trypear/pearai-app',
  },
  'Aide by CodeStory': {
    tagline: 'Open-source AI-native IDE for multi-file iteration with multiple model backends',
    mcp: false,
    cli: false,
    open_source: true,
    github: 'https://github.com/codestoryai/aide',
  },
  'Void Editor': {
    tagline: 'Open-source AI code editor with direct API connections and zero data retention',
    mcp: false,
    cli: false,
    open_source: true,
    github: 'https://github.com/voideditor/void',
  },
  'Google Antigravity IDE': {
    tagline: 'Agent-first IDE with multi-agent orchestration and Gemini models',
    mcp: true,
    cli: false,
    open_source: false,
  },
  Neovim: {
    tagline: 'Hyperextensible Vim-based text editor with Lua scripting and built-in LSP',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://neovim.io',
    github: 'https://github.com/neovim/neovim',
  },

  // ── Terminal Agents ──
  'Claude Code': {
    tagline: 'Anthropic terminal agent with 1M token context, hooks, and agent teams',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://claude.ai/code',
  },
  'OpenAI Codex CLI': {
    tagline: 'OpenAI terminal coding agent with cloud sandboxes and fast token streaming',
    mcp: true,
    cli: true,
    open_source: true,
    github: 'https://github.com/openai/codex',
  },
  Aider: {
    tagline: 'Open-source terminal pair programmer with diff-based editing workflow',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://aider.chat',
    github: 'https://github.com/Aider-AI/aider',
  },
  'Gemini CLI': {
    tagline: 'Google open-source terminal agent with Gemini models and MCP support',
    mcp: true,
    cli: true,
    open_source: true,
    github: 'https://github.com/google-gemini/gemini-cli',
  },
  'GitHub Copilot CLI': {
    tagline: 'GitHub terminal-native coding agent with agentic multi-step workflows',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://github.com/features/copilot',
  },
  OpenCode: {
    tagline: 'Open-source Go-based terminal agent with TUI and multi-session support',
    mcp: true,
    cli: true,
    open_source: true,
    github: 'https://github.com/opencode-ai/opencode',
  },
  'Goose by Block': {
    tagline: 'Open-source agent framework with 3000+ MCP server connections',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://block.github.io/goose',
    github: 'https://github.com/block/goose',
  },
  'Qwen Code': {
    tagline: 'Alibaba open-source terminal agent optimized for Qwen models with plan mode',
    mcp: true,
    cli: true,
    open_source: true,
  },
  'Amp by Sourcegraph': {
    tagline: 'Agentic coding tool with deep codebase understanding from Sourcegraph',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://ampcode.com',
  },
  Warp: {
    tagline: 'AI-powered terminal with autonomous agents and cloud agent platform',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://warp.dev',
  },

  // ── Code Completion ──
  'GitHub Copilot': {
    tagline: 'Most widely adopted AI code assistant with completions and agent mode',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://github.com/features/copilot',
  },
  Tabnine: {
    tagline: 'Privacy-first AI code completion with enterprise context engine',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://tabnine.com',
  },
  Codeium: {
    tagline: 'Free AI code completion engine supporting multiple languages and IDEs',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://codeium.com',
  },
  'Blackbox AI': {
    tagline: 'Multi-model code completion platform with 300+ model access and voice coding',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://blackbox.ai',
  },
  'Gemini Code Assist': {
    tagline: 'Google AI code assistant for VS Code, JetBrains, and Cloud Workstations',
    mcp: true,
    cli: false,
    open_source: false,
  },

  // ── IDE Extensions ──
  Cline: {
    tagline: 'Autonomous AI coding agent for VS Code with MCP Marketplace',
    mcp: true,
    cli: false,
    open_source: true,
    github: 'https://github.com/cline/cline',
  },
  Continue: {
    tagline: 'Open-source customizable AI assistant for VS Code and JetBrains',
    mcp: true,
    cli: false,
    open_source: true,
    website: 'https://continue.dev',
    github: 'https://github.com/continuedev/continue',
  },
  'Roo Code': {
    tagline: 'Multi-agent AI coding surface for VS Code with custom modes',
    mcp: true,
    cli: false,
    open_source: true,
    github: 'https://github.com/RooVetGit/Roo-Code',
  },
  'Kilo Code': {
    tagline: 'Open-source agentic engineering platform for VS Code with orchestration',
    mcp: true,
    cli: true,
    open_source: true,
    github: 'https://github.com/kilocode/kilocode',
  },
  'Amazon Q Developer': {
    tagline: 'AWS AI assistant for coding, debugging, and deployment',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://aws.amazon.com/q/developer',
  },
  'Augment Code': {
    tagline: 'AI coding agent with Context Engine indexing 500K+ files across repos',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://augmentcode.com',
  },
  'Sourcegraph Cody': {
    tagline: 'AI assistant with deep code search and navigation across entire codebases',
    mcp: true,
    cli: false,
    open_source: true,
    website: 'https://sourcegraph.com/cody',
    github: 'https://github.com/sourcegraph/cody',
  },
  'Refact.ai': {
    tagline: 'Open-source self-hosted AI code assistant with RAG-powered completions',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://refact.ai',
    github: 'https://github.com/smallcloudai/refact',
  },
  Qodo: {
    tagline: 'AI code integrity platform for test generation, review, and quality',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://qodo.ai',
  },

  // ── Autonomous Agents ──
  Devin: {
    tagline: 'Autonomous AI software engineer that takes tickets and ships PRs independently',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://devin.ai',
  },
  'GitHub Copilot Coding Agent': {
    tagline: 'Cloud agent that turns GitHub issues into PRs autonomously',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://github.com/features/copilot',
  },
  'Replit Agent': {
    tagline: 'Full-stack autonomous agent with built-in hosting, database, and auth',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://replit.com',
  },

  // ── Code Review ──
  CodeRabbit: {
    tagline: 'AI code review on PRs with 40+ built-in linters and static analysis',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://coderabbit.ai',
  },
  Graphite: {
    tagline: 'AI-first code review platform built around stacked PRs',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://graphite.dev',
  },
  Ellipsis: {
    tagline: 'AI code reviewer that auto-reviews every commit for bugs and anti-patterns',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://ellipsis.dev',
  },
  Greptile: {
    tagline: 'Codebase-aware AI code review with semantic code graph indexing',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://greptile.com',
  },
  Sourcery: {
    tagline: 'AI code reviewer and Python refactoring engine for 30+ languages',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://sourcery.ai',
  },
  Bito: {
    tagline: 'AI code review agent with codebase knowledge graph and cross-repo analysis',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://bito.ai',
  },
  'Korbit AI': {
    tagline: 'AI code review for GitHub, GitLab, Bitbucket with adaptive context',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://korbit.ai',
  },
  CodeScene: {
    tagline: 'Behavioral code analysis with AI code review and CodeHealth metric',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://codescene.com',
  },
  Codacy: {
    tagline: 'Code quality and security across 40+ languages with AI Reviewer',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://codacy.com',
  },

  // ── Testing ──
  Playwright: {
    tagline: 'Cross-browser testing framework with MCP server for AI agent control',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://playwright.dev',
    github: 'https://github.com/microsoft/playwright',
  },
  Cypress: {
    tagline: 'E2E and component testing framework with time-travel debugging',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://cypress.io',
    github: 'https://github.com/cypress-io/cypress',
  },
  Applitools: {
    tagline: 'Visual AI testing platform with computer vision that understands screen content',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://applitools.com',
  },
  'Percy by BrowserStack': {
    tagline: 'Visual regression testing with AI-powered false positive filtering',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://percy.io',
  },
  Chromatic: {
    tagline: 'Visual testing by the Storybook team with automatic snapshot testing',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://chromatic.com',
  },
  Meticulous: {
    tagline: 'AI test automation that captures and replays user sessions for regression detection',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://meticulous.ai',
  },
  'Stryker Mutator': {
    tagline: 'Mutation testing framework that tests your tests by introducing mutations',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://stryker-mutator.io',
    github: 'https://github.com/stryker-mutator/stryker-js',
  },
  Codecov: {
    tagline: 'Code coverage reporting with PR comments and coverage deltas',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://codecov.io',
  },
  Vitest: {
    tagline: 'Vite-native unit test framework with instant HMR and TypeScript support',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://vitest.dev',
    github: 'https://github.com/vitest-dev/vitest',
  },
  Jest: {
    tagline: 'Delightful JavaScript testing framework with instant feedback and zero config',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://jestjs.io',
    github: 'https://github.com/jestjs/jest',
  },
  pytest: {
    tagline: 'Python testing framework with fixtures, parametrize, and rich plugin ecosystem',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://pytest.org',
    github: 'https://github.com/pytest-dev/pytest',
  },
  Selenium: {
    tagline: 'Browser automation framework for web testing across all major browsers',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://selenium.dev',
    github: 'https://github.com/SeleniumHQ/selenium',
  },

  // ── Security ──
  Snyk: {
    tagline: 'Developer-first SCA, SAST, container, and IaC scanning with AI-powered fixes',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://snyk.io',
  },
  Semgrep: {
    tagline: 'Lightweight SAST with YAML-based custom rules, taint tracking, and AI assistant',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://semgrep.dev',
    github: 'https://github.com/semgrep/semgrep',
  },
  Socket: {
    tagline: 'Supply chain security detecting malicious packages before CVEs are published',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://socket.dev',
  },
  GitGuardian: {
    tagline: 'Secrets detection with 450+ specific detectors across repos and CI/CD',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://gitguardian.com',
  },
  Trivy: {
    tagline: 'Open-source all-in-one security scanner for containers, filesystems, and git repos',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://trivy.dev',
    github: 'https://github.com/aquasecurity/trivy',
  },
  'GitHub CodeQL': {
    tagline: 'Semantic code analysis engine with Copilot Autofix for vulnerability detection',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/github/codeql',
  },
  'Aikido Security': {
    tagline: 'All-in-one DevSec with SAST, IaC, secrets, dependency, and malware scanning',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://aikido.dev',
  },
  'OWASP ZAP': {
    tagline: 'Free open-source DAST for web application penetration testing',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://zaproxy.org',
    github: 'https://github.com/zaproxy/zaproxy',
  },
  'Burp Suite': {
    tagline: 'Industry-standard DAST for web application and API security testing',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://portswigger.net/burp',
  },
  Wiz: {
    tagline: 'Cloud security platform with agentless CSPM and AI pipeline security',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://wiz.io',
  },

  // ── Code Quality ──
  ESLint: {
    tagline: 'Standard JS/TS linter with 50M+ weekly downloads and MCP server',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://eslint.org',
    github: 'https://github.com/eslint/eslint',
  },
  Biome: {
    tagline: 'Rust-based unified linter and formatter replacing ESLint + Prettier',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://biomejs.dev',
    github: 'https://github.com/biomejs/biome',
  },
  Oxlint: {
    tagline: 'Rust-based JS/TS linter 50-100x faster than ESLint with 520+ rules',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/oxc-project/oxc',
  },
  SonarQube: {
    tagline: 'Continuous code inspection for bugs, code smells, and vulnerabilities',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://sonarqube.org',
  },
  DeepSource: {
    tagline: 'Detects 5000+ code quality issues with AI Autofix and autonomous agents',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://deepsource.com',
  },
  Trunk: {
    tagline: 'Universal code quality platform orchestrating 100+ linters with merge queue',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://trunk.io',
  },
  Prettier: {
    tagline: 'Opinionated code formatter supporting JS, TS, CSS, HTML, and more',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://prettier.io',
    github: 'https://github.com/prettier/prettier',
  },

  // ── Search APIs ──
  Exa: {
    tagline: 'Neural search API trained on link prediction for RAG and AI agents',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://exa.ai',
  },
  Tavily: {
    tagline: 'Citation-ready search API built for AI agents with LangChain integration',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://tavily.com',
  },
  'Perplexity API': {
    tagline: 'Answer generation with citations via Sonar models and 200B+ URL index',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://docs.perplexity.ai',
  },
  'Brave Search API': {
    tagline: 'Independent index, privacy-focused search API with highest agentic benchmark score',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://brave.com/search/api',
  },
  'Jina AI': {
    tagline: 'Search foundation suite with Reader API, Search API, embeddings, and reranker',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://jina.ai',
  },
  SerpAPI: {
    tagline: 'SERP scraping from 40+ engines with structured JSON output',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://serpapi.com',
  },
  Serper: {
    tagline: 'Budget Google SERP API with fast structured search results for agents',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://serper.dev',
  },
  'You.com API': {
    tagline: 'Web search optimized for RAG with 93% SimpleQA accuracy',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://you.com',
  },

  // ── Web Access ──
  Firecrawl: {
    tagline: 'Web data API converting any URL to clean markdown/JSON for AI',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://firecrawl.dev',
    github: 'https://github.com/mendableai/firecrawl',
  },
  Crawl4AI: {
    tagline: 'Open-source Python crawler for LLM-ready output with adaptive pattern learning',
    mcp: true,
    cli: true,
    open_source: true,
    github: 'https://github.com/unclecode/crawl4ai',
  },
  Browserbase: {
    tagline: 'Cloud headless browser infrastructure for AI agents at scale',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://browserbase.com',
  },
  Stagehand: {
    tagline: 'AI-native browser automation SDK with plain-English actions',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/browserbase/stagehand',
  },
  'Browser Use': {
    tagline: 'Open-source browser automation for AI agents with 78K+ GitHub stars',
    mcp: true,
    cli: true,
    open_source: true,
    github: 'https://github.com/browser-use/browser-use',
  },
  Apify: {
    tagline: 'Full scraping platform with 20K+ pre-built Actors for specific sites',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://apify.com',
  },
  Puppeteer: {
    tagline: 'Google Node.js headless Chrome/Chromium automation framework',
    mcp: true,
    cli: true,
    open_source: true,
    github: 'https://github.com/puppeteer/puppeteer',
  },
  Postman: {
    tagline: 'API development platform for building, testing, and documenting APIs',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://postman.com',
  },

  // ── AI Platforms ──
  'OpenAI API': {
    tagline: 'GPT-4o, GPT-4.1, o-series reasoning models with function calling and vision',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://platform.openai.com',
  },
  'Anthropic API': {
    tagline: 'Claude Opus/Sonnet/Haiku with extended thinking, tool use, and computer use',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://docs.anthropic.com',
  },
  'Google Gemini API': {
    tagline: 'Gemini 2.5 Pro/Flash with 1M+ token context and multimodal support',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://ai.google.dev',
  },
  Groq: {
    tagline: 'Ultra-fast inference via custom LPU hardware at 3K+ tokens/sec',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://groq.com',
  },
  'Together AI': {
    tagline: 'High-quality open-source model hosting with fine-tuning support',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://together.ai',
  },
  'Fireworks AI': {
    tagline: 'Fast inference for open-source models with function calling and JSON mode',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://fireworks.ai',
  },
  Cerebras: {
    tagline: 'Wafer-scale inference at 3K+ tokens/sec with free tier',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://cerebras.ai',
  },
  Replicate: {
    tagline: '50K+ open-source models via API with pay-per-second pricing',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://replicate.com',
  },
  OpenRouter: {
    tagline: 'Inference marketplace with 300+ models and unified OpenAI-compatible API',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://openrouter.ai',
  },
  LiteLLM: {
    tagline: 'Open-source proxy for 100+ LLM APIs in OpenAI format with cost tracking',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://litellm.ai',
    github: 'https://github.com/BerriAI/litellm',
  },
  Portkey: {
    tagline: 'AI gateway routing across 1600+ models with observability and guardrails',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://portkey.ai',
    github: 'https://github.com/Portkey-AI/gateway',
  },
  'Cloudflare Workers AI': {
    tagline: '50+ open-source models on Cloudflare edge with serverless GPU inference',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://developers.cloudflare.com/workers-ai',
  },
  'Amazon Bedrock': {
    tagline: 'Unified API for Anthropic, Meta, Mistral, Cohere, and Amazon Nova models',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://aws.amazon.com/bedrock',
  },
  'Hugging Face': {
    tagline: 'Serverless inference for 100K+ models with multi-provider routing',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://huggingface.co',
  },
  'Mistral API': {
    tagline: 'Mistral Large, Small, and Ministral models with strong open-weight options',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://mistral.ai',
  },
  Ollama: {
    tagline: 'Run open-source LLMs locally with a simple CLI and OpenAI-compatible API',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://ollama.com',
    github: 'https://github.com/ollama/ollama',
  },

  // ── Databases ──
  Supabase: {
    tagline: 'Postgres BaaS with pgvector, Edge Functions, and official MCP server',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://supabase.com',
    github: 'https://github.com/supabase/supabase',
  },
  Neon: {
    tagline: 'Serverless Postgres with pgvector, branch-based migrations, and 20-tool MCP server',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://neon.tech',
    github: 'https://github.com/neondatabase/neon',
  },
  Pinecone: {
    tagline: 'Fully managed serverless vector database for billions of vectors',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://pinecone.io',
  },
  Weaviate: {
    tagline: 'Open-source vector DB with knowledge graph capabilities and hybrid search',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://weaviate.io',
    github: 'https://github.com/weaviate/weaviate',
  },
  Qdrant: {
    tagline: 'Rust-based vector DB with best performance and metadata filtering',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://qdrant.tech',
    github: 'https://github.com/qdrant/qdrant',
  },
  Chroma: {
    tagline: 'Lightweight embedded vector DB for prototyping and small-scale AI',
    mcp: true,
    cli: false,
    open_source: true,
    website: 'https://trychroma.com',
    github: 'https://github.com/chroma-core/chroma',
  },
  Turbopuffer: {
    tagline: 'Serverless vector and BM25 hybrid search used by Cursor and Notion',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://turbopuffer.com',
  },
  Upstash: {
    tagline: 'Serverless Redis, Vector, and QStash with pay-per-request pricing',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://upstash.com',
  },
  Prisma: {
    tagline: 'TypeScript ORM with type-safety, automated migrations, and MCP server',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://prisma.io',
    github: 'https://github.com/prisma/prisma',
  },
  'Drizzle ORM': {
    tagline: 'Code-first TypeScript ORM with ~7KB bundle and edge-native design',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://orm.drizzle.team',
    github: 'https://github.com/drizzle-team/drizzle-orm',
  },
  PostgreSQL: {
    tagline: 'Advanced open-source relational database with extensibility and SQL compliance',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://postgresql.org',
    github: 'https://github.com/postgres/postgres',
  },
  Redis: {
    tagline: 'In-memory data store for caching, messaging, and real-time applications',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://redis.io',
    github: 'https://github.com/redis/redis',
  },
  MongoDB: {
    tagline: 'Document-oriented NoSQL database with flexible schemas and horizontal scaling',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://mongodb.com',
    github: 'https://github.com/mongodb/mongo',
  },

  // ── Runtimes ──
  Bun: {
    tagline: 'All-in-one JS/TS runtime, bundler, test runner, and package manager',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://bun.sh',
    github: 'https://github.com/oven-sh/bun',
  },
  Deno: {
    tagline: 'Secure-by-default runtime with built-in TypeScript and permissions model',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://deno.com',
    github: 'https://github.com/denoland/deno',
  },
  'Node.js': {
    tagline: 'The standard JavaScript runtime with native TypeScript support in v22+',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://nodejs.org',
    github: 'https://github.com/nodejs/node',
  },

  // ── Build Tools ──
  Vite: {
    tagline:
      'Lightning-fast frontend build tool with native ES modules and massive plugin ecosystem',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://vite.dev',
    github: 'https://github.com/vitejs/vite',
  },
  esbuild: {
    tagline: 'Go-based bundler/minifier 10-100x faster than Webpack',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/evanw/esbuild',
  },
  Rspack: {
    tagline: 'Rust-powered Webpack drop-in replacement with built-in TypeScript support',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://rspack.dev',
    github: 'https://github.com/web-infra-dev/rspack',
  },
  Turbopack: {
    tagline: 'Rust-based bundler by Vercel, default in Next.js 16',
    mcp: false,
    cli: false,
    open_source: true,
    github: 'https://github.com/vercel/turborepo',
  },
  Turborepo: {
    tagline: 'Monorepo build system by Vercel with remote caching and simple config',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://turbo.build',
    github: 'https://github.com/vercel/turborepo',
  },
  Nx: {
    tagline: 'Full-featured monorepo platform with distributed CI and code generation',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://nx.dev',
    github: 'https://github.com/nrwl/nx',
  },
  pnpm: {
    tagline: 'Fast, disk-efficient package manager with strict dependency resolution',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://pnpm.io',
    github: 'https://github.com/pnpm/pnpm',
  },
  mise: {
    tagline: 'Polyglot tool version manager replacing asdf, nvm, pyenv in one Rust binary',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://mise.jdx.dev',
    github: 'https://github.com/jdx/mise',
  },
  Webpack: {
    tagline:
      'Module bundler for JavaScript applications with extensive loader and plugin ecosystem',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://webpack.js.org',
    github: 'https://github.com/webpack/webpack',
  },
  Terraform: {
    tagline:
      'Infrastructure as Code tool for provisioning and managing cloud resources declaratively',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://terraform.io',
    github: 'https://github.com/hashicorp/terraform',
  },
  Kubernetes: {
    tagline: 'Container orchestration platform for automating deployment, scaling, and management',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://kubernetes.io',
    github: 'https://github.com/kubernetes/kubernetes',
  },

  // ── Deployment ──
  Vercel: {
    tagline: 'Platform for modern web apps with edge functions and preview deployments',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://vercel.com',
  },
  Netlify: {
    tagline: 'Static site and frontend app hosting with built-in edge functions',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://netlify.com',
  },
  'Cloudflare Pages': {
    tagline: "Global edge deployment on one of the world's largest CDN networks",
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://pages.cloudflare.com',
  },
  Railway: {
    tagline: 'Deploy apps with databases and predictable pricing in one platform',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://railway.app',
  },
  'Fly.io': {
    tagline: 'Global deployment as micro-VMs across regions with real server behavior',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://fly.io',
  },
  Render: {
    tagline: 'Modern Heroku replacement with managed databases and predictable pricing',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://render.com',
  },
  Docker: {
    tagline: 'The container standard with 40+ MCP tools for containers and Kubernetes',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://docker.com',
  },
  Coolify: {
    tagline: 'Open-source self-hosted alternative to Vercel/Netlify/Heroku',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://coolify.io',
    github: 'https://github.com/coollabsio/coolify',
  },

  // ── CI/CD ──
  'GitHub Actions': {
    tagline: 'Dominant CI/CD for GitHub repos with 20K+ integrations and ARM runners',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://github.com/features/actions',
  },
  'GitLab CI': {
    tagline: 'Built-in CI/CD in GitLab unified platform with no tool sprawl',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://docs.gitlab.com/ee/ci',
  },
  CircleCI: {
    tagline: 'CI/CD optimized for build speed and parallelism with 30K free credits/month',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://circleci.com',
  },
  Dagger: {
    tagline: 'Write CI pipelines in real code that runs identically locally and in CI',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://dagger.io',
    github: 'https://github.com/dagger/dagger',
  },
  Depot: {
    tagline: '40x faster Docker builds with persistent layer caching and CI runners',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://depot.dev',
  },

  // ── Terminals ──
  Ghostty: {
    tagline:
      'Zig-built terminal by Mitchell Hashimoto with native macOS experience and GPU acceleration',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://ghostty.org',
    github: 'https://github.com/ghostty-org/ghostty',
  },
  WezTerm: {
    tagline: 'GPU-accelerated cross-platform terminal and multiplexer with Lua scripting',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://wezfurlong.org/wezterm',
    github: 'https://github.com/wez/wezterm',
  },
  Alacritty: {
    tagline: 'The fastest terminal emulator with GPU rendering via OpenGL',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://alacritty.org',
    github: 'https://github.com/alacritty/alacritty',
  },
  Kitty: {
    tagline: 'GPU-based terminal with tiling, ligatures, and image display protocol',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://sw.kovidgoyal.net/kitty',
    github: 'https://github.com/kovidgoyal/kitty',
  },
  Zellij: {
    tagline: 'Modern Rust-based terminal multiplexer with mode-based UI and sensible defaults',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://zellij.dev',
    github: 'https://github.com/zellij-org/zellij',
  },
  tmux: {
    tagline: 'Standard terminal multiplexer for remote-first and SSH workflows',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/tmux/tmux',
  },
  iTerm2: {
    tagline: 'Feature-rich macOS terminal replacement with profiles, split panes, and hotkeys',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://iterm2.com',
    github: 'https://github.com/gnachman/iTerm2',
  },

  // ── CLI Utilities ──
  fzf: {
    tagline: 'General-purpose fuzzy finder for files, history, processes, and git commits',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/junegunn/fzf',
  },
  ripgrep: {
    tagline: '2-5x faster than grep with .gitignore support and parallelism',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/BurntSushi/ripgrep',
  },
  bat: {
    tagline: 'Cat replacement with syntax highlighting, line numbers, and git integration',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/sharkdp/bat',
  },
  eza: {
    tagline: 'Modern ls replacement with git status, tree view, and icons',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/eza-community/eza',
  },
  delta: {
    tagline: 'Beautiful git diff viewer with syntax highlighting and side-by-side mode',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/dandavison/delta',
  },
  starship: {
    tagline: 'Cross-shell prompt showing git branch, language versions, and cloud context',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://starship.rs',
    github: 'https://github.com/starship/starship',
  },
  zoxide: {
    tagline: 'Smarter cd that learns your habits and jumps to frequent directories',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/ajeetdsouza/zoxide',
  },
  fd: {
    tagline: 'Simple fast alternative to find that respects .gitignore',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/sharkdp/fd',
  },
  jq: {
    tagline: 'Lightweight command-line JSON processor for parsing and transforming data',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://jqlang.github.io/jq',
    github: 'https://github.com/jqlang/jq',
  },
  yazi: {
    tagline: 'Blazing fast terminal file manager with async I/O and image previews',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/sxyazi/yazi',
  },
  Nushell: {
    tagline: 'Structured-data shell where pipelines pass tables, not text',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://nushell.sh',
    github: 'https://github.com/nushell/nushell',
  },
  'fish shell': {
    tagline: 'User-friendly shell with auto-suggestions and syntax highlighting out of the box',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://fishshell.com',
    github: 'https://github.com/fish-shell/fish-shell',
  },
  Lazygit: {
    tagline: 'Terminal UI for git with visual staging, interactive rebase, and keyboard shortcuts',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/jesseduffield/lazygit',
  },
  btop: {
    tagline: 'Beautiful interactive process/system monitor replacing top/htop',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/aristocratos/btop',
  },
  'Oh My Zsh': {
    tagline: 'Framework for managing Zsh configuration with 300+ plugins and themes',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://ohmyz.sh',
    github: 'https://github.com/ohmyzsh/ohmyzsh',
  },

  // ── Version Control ──
  'GitHub CLI': {
    tagline: 'Official GitHub CLI for PRs, issues, Actions, and releases from terminal',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://cli.github.com',
    github: 'https://github.com/cli/cli',
  },
  GitButler: {
    tagline:
      'Next-gen Git client with virtual branches for working on multiple branches simultaneously',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://gitbutler.com',
    github: 'https://github.com/gitbutlerapp/gitbutler',
  },
  GitKraken: {
    tagline: 'Cross-platform Git GUI with branch visualization and merge conflict editor',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://gitkraken.com',
  },
  'Fork Git Client': {
    tagline: 'Fast native Git client for Mac/Windows that handles massive repos',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://git-fork.com',
  },

  // ── Voice ──
  WisprFlow: {
    tagline: 'AI dictation that learns your vocabulary with native IDE integrations',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://wisprflow.com',
  },
  Superwhisper: {
    tagline: 'Voice-to-text with custom AI modes per task running offline via whisper.cpp',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://superwhisper.com',
  },
  'Talon Voice': {
    tagline: 'Full hands-free computer control with custom voice commands for developers',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://talonvoice.com',
  },

  // ── Design-to-Code ──
  'v0 by Vercel': {
    tagline: 'AI design-to-code generating production-ready React/Next.js from prompts or Figma',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://v0.dev',
  },
  'Bolt.new': {
    tagline: 'Browser-based AI app builder using WebContainers for full-stack scaffolding',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://bolt.new',
    github: 'https://github.com/stackblitz/bolt.new',
  },
  Lovable: {
    tagline: 'Full-stack AI app builder with Supabase integration and one-click deployment',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://lovable.dev',
  },
  'Google Stitch': {
    tagline: 'Free AI UI design tool generating mobile and web interfaces in 7 frameworks',
    mcp: false,
    cli: false,
    open_source: false,
  },

  // ── Documentation ──
  Mintlify: {
    tagline: 'Git-native documentation platform that auto-generates MCP servers from docs',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://mintlify.com',
  },
  GitBook: {
    tagline: 'Documentation platform with bidirectional Git Sync and AI-native features',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://gitbook.com',
  },
  ReadMe: {
    tagline: 'Interactive developer hub with API reference, guides, and MCP server',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://readme.com',
  },
  Docusaurus: {
    tagline: 'Open-source docs framework by Meta powering React Native and Supabase docs',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://docusaurus.io',
    github: 'https://github.com/facebook/docusaurus',
  },
  Redocly: {
    tagline: 'API-first documentation and governance for OpenAPI, AsyncAPI, and GraphQL',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://redocly.com',
  },

  // ── Diagramming ──
  Excalidraw: {
    tagline: 'Collaborative whiteboarding with hand-drawn aesthetic and AI text-to-diagram',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://excalidraw.com',
    github: 'https://github.com/excalidraw/excalidraw',
  },
  tldraw: {
    tagline: 'Infinite canvas SDK with Make Real AI converting sketches to functional components',
    mcp: true,
    cli: false,
    open_source: true,
    website: 'https://tldraw.com',
    github: 'https://github.com/tldraw/tldraw',
  },
  Mermaid: {
    tagline: 'Markdown-inspired diagram syntax that renders in GitHub READMEs and docs',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://mermaid.js.org',
    github: 'https://github.com/mermaid-js/mermaid',
  },
  Eraser: {
    tagline: 'Hybrid drag-and-drop plus diagram-as-code tool with AI generation',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://eraser.io',
  },
  'D2 by Terrastruct': {
    tagline: 'Modern declarative diagram scripting language with simpler syntax than PlantUML',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://d2lang.com',
    github: 'https://github.com/terrastruct/d2',
  },
  'Draw.io': {
    tagline: 'Free open-source diagramming tool with MCP server and Claude Code skill',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://draw.io',
    github: 'https://github.com/jgraph/drawio',
  },

  // ── Knowledge ──
  Obsidian: {
    tagline: 'Local-first Markdown note-taking with graph view and 1000+ plugins',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://obsidian.md',
  },
  Notion: {
    tagline: 'All-in-one workspace with databases, AI assistant, and official MCP server',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://notion.so',
  },
  Raycast: {
    tagline: 'macOS productivity launcher with built-in AI, extensions, and MCP support',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://raycast.com',
  },
  'Pieces for Developers': {
    tagline: 'AI-powered context manager that saves and reuses code snippets across tools',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://pieces.app',
  },

  // ── Collaboration ──
  Slack: {
    tagline: 'Team messaging with 2600+ integrations and official MCP server',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://slack.com',
  },
  Linear: {
    tagline: 'Fast issue tracking for software teams with official MCP server',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://linear.app',
  },
  Jira: {
    tagline: 'Enterprise issue tracking by Atlassian with Rovo MCP server',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://atlassian.com/software/jira',
  },
  Discord: {
    tagline: 'Community-oriented team communication with voice channels',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://discord.com',
  },
  Loom: {
    tagline: 'Async video communication with AI transcription and automatic summaries',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://loom.com',
  },
  Tuple: {
    tagline: 'Remote pair programming app with 5K screen sharing and multi-cursor',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://tuple.app',
  },

  // ── Agent Frameworks ──
  LangChain: {
    tagline: 'Most widely adopted LLM framework with the largest integration ecosystem',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://langchain.com',
    github: 'https://github.com/langchain-ai/langchain',
  },
  LangGraph: {
    tagline: 'Stateful graph-based multi-agent orchestration by LangChain',
    mcp: false,
    cli: false,
    open_source: true,
    github: 'https://github.com/langchain-ai/langgraph',
  },
  CrewAI: {
    tagline: 'Role-based multi-agent collaboration framework with fastest adoption',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://crewai.com',
    github: 'https://github.com/crewAIInc/crewAI',
  },
  Mastra: {
    tagline: 'TypeScript-first agent framework, the recommended starting point for TS developers',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://mastra.ai',
    github: 'https://github.com/mastra-ai/mastra',
  },
  'OpenAI Agents SDK': {
    tagline: 'Production-grade agent toolkit with explicit handoff-based control flow',
    mcp: true,
    cli: false,
    open_source: true,
    github: 'https://github.com/openai/openai-agents-python',
  },
  'Claude Agent SDK': {
    tagline: 'Anthropic framework for agents that control a real computer environment',
    mcp: true,
    cli: true,
    open_source: true,
  },
  'Google ADK': {
    tagline: 'Code-first agent framework in four languages with multimodal Gemini capabilities',
    mcp: true,
    cli: true,
    open_source: true,
  },
  'Vercel AI SDK': {
    tagline: 'Leading TypeScript toolkit for AI apps with 20M+ monthly downloads',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://sdk.vercel.ai',
    github: 'https://github.com/vercel/ai',
  },
  LlamaIndex: {
    tagline: 'Best-in-class for RAG and data-connected agents with deep document support',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://llamaindex.ai',
    github: 'https://github.com/run-llama/llama_index',
  },
  'Pydantic AI': {
    tagline: 'Type-safe agent development bringing Pydantic validation to LLM workflows',
    mcp: false,
    cli: false,
    open_source: true,
    github: 'https://github.com/pydantic/pydantic-ai',
  },
  DSPy: {
    tagline: 'Stanford framework for programming language models instead of prompting them',
    mcp: false,
    cli: false,
    open_source: true,
    github: 'https://github.com/stanfordnlp/dspy',
  },
  Dify: {
    tagline: 'Open-source AI app platform with visual workflow builder and integrated RAG',
    mcp: true,
    cli: false,
    open_source: true,
    website: 'https://dify.ai',
    github: 'https://github.com/langgenius/dify',
  },
  n8n: {
    tagline:
      'Workflow automation with 150K+ GitHub stars and AI agent building via visual interfaces',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://n8n.io',
    github: 'https://github.com/n8n-io/n8n',
  },

  // ── Observability ──
  Langfuse: {
    tagline: 'Open-source LLM observability with tracing, prompt management, and evals',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://langfuse.com',
    github: 'https://github.com/langfuse/langfuse',
  },
  LangSmith: {
    tagline: 'LangChain observability platform with tracing, evaluation, and prompt versioning',
    mcp: false,
    cli: false,
    open_source: false,
    website: 'https://smith.langchain.com',
  },
  Helicone: {
    tagline: 'One-line proxy integration for LLM monitoring and request-level observability',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://helicone.ai',
    github: 'https://github.com/Helicone/helicone',
  },
  Braintrust: {
    tagline: 'LLM evaluation platform with CI/CD blocking and automated scorers',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://braintrust.dev',
  },
  'Arize Phoenix': {
    tagline: 'Open-source LLM observability built on OpenTelemetry with local Jupyter support',
    mcp: false,
    cli: true,
    open_source: true,
    github: 'https://github.com/Arize-ai/phoenix',
  },

  // ── Automation & Sandboxes ──
  E2B: {
    tagline: 'Open-source cloud sandboxes for AI code execution with 150ms startup',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://e2b.dev',
    github: 'https://github.com/e2b-dev/e2b',
  },
  Daytona: {
    tagline: 'Cloud development environments and AI code execution sandboxes with 27ms cold start',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://daytona.io',
    github: 'https://github.com/daytonaio/daytona',
  },
  'Trigger.dev': {
    tagline: 'Open-source background jobs and AI agent runtime for TypeScript',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://trigger.dev',
    github: 'https://github.com/triggerdotdev/trigger.dev',
  },
  Inngest: {
    tagline: 'Serverless workflow orchestration with step functions, sleep, and fan-out',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://inngest.com',
    github: 'https://github.com/inngest/inngest',
  },
  'Val Town': {
    tagline: 'Serverless JS/TS runtime for quick scripts with per-val SQLite and MCP server',
    mcp: true,
    cli: false,
    open_source: false,
    website: 'https://val.town',
  },

  // ── AI Memory ──
  Mem0: {
    tagline: 'Universal memory layer for AI agents with vector and graph storage',
    mcp: true,
    cli: true,
    open_source: true,
    website: 'https://mem0.ai',
    github: 'https://github.com/mem0ai/mem0',
  },
  Zep: {
    tagline: 'Temporal knowledge graph memory tracking how facts change over time',
    mcp: false,
    cli: false,
    open_source: true,
    website: 'https://getzep.com',
    github: 'https://github.com/getzep/zep',
  },
  Letta: {
    tagline: 'Memory-as-editable-state where agents actively manage their own memory blocks',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://letta.com',
    github: 'https://github.com/letta-ai/letta',
  },

  // ── MCP Ecosystem ──
  Composio: {
    tagline: 'Developer-first MCP gateway with 850+ pre-built integrations and unified auth',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://composio.dev',
  },
  Smithery: {
    tagline: 'Public registry with 2500+ community-built MCP servers for discovery',
    mcp: true,
    cli: true,
    open_source: false,
    website: 'https://smithery.ai',
  },

  // ── Code Generation ──
  Speakeasy: {
    tagline: 'SDK generation from OpenAPI specs with linting and multi-language support',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://speakeasy.com',
  },
  Stainless: {
    tagline: 'SDK generation platform powering OpenAI official SDKs',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://stainlessapi.com',
  },
  Fern: {
    tagline: 'API documentation and SDK generation from a single API definition',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://buildwithfern.com',
    github: 'https://github.com/fern-api/fern',
  },

  // ── Data Tools ──
  LlamaParse: {
    tagline: 'AI-native document parsing for PDFs, spreadsheets, and images to structured data',
    mcp: false,
    cli: true,
    open_source: false,
    website: 'https://llamaindex.ai',
  },
  Unstructured: {
    tagline: 'ETL for LLMs processing 50+ document sources into structured elements',
    mcp: false,
    cli: true,
    open_source: true,
    website: 'https://unstructured.io',
    github: 'https://github.com/Unstructured-IO/unstructured',
  },
};

// ── Build evaluation objects ──

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildEvaluation(tool: SeedTool) {
  const meta = META[tool.name];
  if (!meta) return null;

  const id = slugify(tool.name);
  const mcpSupport = meta.mcp === true ? 1 : meta.mcp === false ? 0 : null;
  const hasCli = meta.cli === true ? 1 : meta.cli === false ? 0 : null;
  const openSource = meta.open_source === true ? 1 : meta.open_source === false ? 0 : null;

  let verdict: string;
  let integrationTier: string;
  if (meta.mcp) {
    verdict = 'integrated';
    integrationTier = 'connected';
  } else if (meta.cli) {
    verdict = 'installable';
    integrationTier = 'installable';
  } else {
    verdict = 'listed';
    integrationTier = 'listed';
  }

  return {
    id,
    name: tool.name,
    tagline: meta.tagline,
    category: tool.category,
    mcp_support: mcpSupport,
    has_cli: hasCli,
    hooks_support: null,
    channel_support: null,
    process_detectable: hasCli,
    open_source: openSource,
    verdict,
    integration_tier: integrationTier,
    blocking_issues: [],
    metadata: {
      website: meta.website || null,
      github: meta.github || null,
      install_command: null,
      notable: null,
      favicon: null,
      image: null,
      search_results: [],
      ai_summary: null,
      strengths: null,
      integration_type: null,
      platform: null,
      pricing_tier: null,
      pricing_detail: null,
      github_stars: null,
      demo_url: null,
      brand_color: null,
      last_updated: null,
      founded_year: null,
      team_size: null,
      funding_status: null,
      update_frequency: null,
      user_count_estimate: null,
      notable_users: null,
      documentation_quality: null,
    },
    sources: [],
    in_registry: 0,
    evaluated_at: new Date().toISOString(),
    confidence: 'medium' as const,
    evaluated_by: 'chinwag',
    data_passes: {
      core: { completed_at: new Date().toISOString(), success: true },
    },
  };
}

// ── Main ──

async function main() {
  console.log('chinwag directory import');
  console.log(`  API: ${API_BASE}`);
  console.log(`  Seed tools: ${SEED_TOOLS.length}`);
  console.log(`  Metadata entries: ${Object.keys(META).length}`);
  console.log('');

  // Build evaluations
  const evaluations = [];
  const missing: string[] = [];

  for (const tool of SEED_TOOLS) {
    const ev = buildEvaluation(tool);
    if (ev) {
      evaluations.push(ev);
    } else {
      missing.push(tool.name);
    }
  }

  if (missing.length > 0) {
    console.warn(`  Missing metadata for ${missing.length} tools:`);
    for (const name of missing) console.warn(`    - ${name}`);
    console.log('');
  }

  console.log(`  Built ${evaluations.length} evaluations`);

  // Check existing to report overlap
  let existingIds = new Set<string>();
  try {
    const res = await fetch(`${API_BASE}/tools/directory?limit=200`);
    if (res.ok) {
      const data: any = await res.json();
      existingIds = new Set((data.evaluations || []).map((e: any) => e.id));
      const overlap = evaluations.filter((e) => existingIds.has(e.id));
      const newOnes = evaluations.filter((e) => !existingIds.has(e.id));
      console.log(`  Already in directory: ${overlap.length} (will be updated)`);
      console.log(`  New tools: ${newOnes.length}`);
    }
  } catch {
    // API not reachable — skip overlap check
  }

  console.log('');

  if (DRY_RUN) {
    console.log('Dry run — evaluations that would be imported:');
    for (const ev of evaluations) {
      const status = existingIds.has(ev.id) ? '(update)' : '(new)';
      console.log(`  ${ev.name} → ${ev.verdict} | ${ev.category} ${status}`);
    }
    console.log('\nRemove --dry-run to import.');
    return;
  }

  // Import in batches of 20 (50 hits body size limit)
  const BATCH = 20;
  let imported = 0;
  let errors = 0;

  for (let i = 0; i < evaluations.length; i += BATCH) {
    const batch = evaluations.slice(i, i + BATCH);
    console.log(
      `Importing batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(evaluations.length / BATCH)} (${batch.length} tools)...`,
    );

    try {
      const res = await fetch(`${API_BASE}/tools/admin-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_key: ADMIN_KEY, evaluations: batch }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`  Error: ${res.status} ${text}`);
        errors += batch.length;
      } else {
        const data: any = await res.json();
        console.log(`  Saved: ${data.saved}`);
        imported += data.saved || 0;
      }
    } catch (err) {
      console.error(`  Network error: ${(err as Error).message}`);
      errors += batch.length;
    }
  }

  console.log('');
  console.log('Done!');
  console.log(`  Imported: ${imported}`);
  console.log(`  Errors: ${errors}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Top up Exa credits at dashboard.exa.ai');
  console.log('  2. Run enrichment: POST /tools/batch-enrich { admin_key, limit: 50 }');
  console.log('  3. Run icon resolution: POST /tools/batch-resolve-icons { admin_key, limit: 50 }');
  console.log(
    '  4. Run color extraction: POST /tools/batch-extract-colors { admin_key, limit: 50 }',
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
