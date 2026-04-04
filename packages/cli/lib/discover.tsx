import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { scanIntegrationHealth, summarizeIntegrationScan } from './mcp-config.js';
import { api } from './api.js';
import { addToolToProject } from './utils/tool-actions.js';
import { computeToolRecommendations } from './utils/tool-recommendations.js';
import { DetectedToolsList, RecommendationsList, CategoryBrowser } from './tool-display.jsx';
import type { ChinwagConfig } from './config.js';
import type { IntegrationScanResult } from '@chinwag/shared/integration-doctor.js';

const LOADING_TIMEOUT_MS = 15000;

interface CatalogToolLike {
  id: string;
  name: string;
  description: string;
  category?: string;
  mcpCompatible?: boolean;
  website?: string;
  installCmd?: string | null;
  featured?: boolean;
  verdict?: string;
  confidence?: string;
}

interface EvalEntry {
  id: string;
  name: string;
  tagline: string;
  category?: string;
  mcp_support?: boolean;
  metadata?: { website?: string; install_command?: string; featured?: boolean };
  verdict?: string;
  confidence?: string;
}

function evalToTool(e: EvalEntry): CatalogToolLike {
  const meta = e.metadata || {};
  return {
    id: e.id,
    name: e.name,
    description: e.tagline,
    category: e.category,
    mcpCompatible: !!e.mcp_support,
    website: meta.website,
    installCmd: meta.install_command,
    featured: !!meta.featured,
    verdict: e.verdict,
    confidence: e.confidence,
  };
}

interface DiscoverProps {
  config: ChinwagConfig | null;
  navigate: (to: string) => void;
}

export function Discover({ config, navigate }: DiscoverProps): React.ReactNode {
  const { stdout } = useStdout();
  const cols = stdout?.columns || 80;
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationScanResult[]>(() =>
    scanIntegrationHealth(process.cwd()),
  );
  const [catalog, setCatalog] = useState<CatalogToolLike[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Fetch catalog from API (single source of truth)
    async function fetchCatalog(): Promise<void> {
      try {
        const result = (await api(config).get('/tools/directory?limit=200')) as {
          evaluations?: EvalEntry[];
          categories?: Record<string, string>;
        };
        if (cancelled) return;
        setCatalog((result.evaluations || []).map(evalToTool));
        setCategories(result.categories || {});
      } catch (err: unknown) {
        console.error('[chinwag]', (err as Error)?.message || err);
        // Fallback to old catalog endpoint if directory isn't deployed yet
        try {
          const fallback = (await api(config).get('/tools/catalog')) as {
            tools?: CatalogToolLike[];
            categories?: Record<string, string>;
          };
          if (cancelled) return;
          setCatalog(fallback.tools || []);
          setCategories(fallback.categories || {});
        } catch (err2: unknown) {
          if (cancelled) return;
          setMessage(`Could not fetch tool catalog: ${(err2 as Error).message}`);
        }
      }
      if (cancelled) return;
      setLoading(false);
      if (loadingTimer.current) {
        clearTimeout(loadingTimer.current);
        loadingTimer.current = null;
      }
    }

    loadingTimer.current = setTimeout(() => {
      if (cancelled) return;
      setLoadingTimedOut(true);
      setLoading(false);
    }, LOADING_TIMEOUT_MS);

    fetchCatalog();

    return () => {
      cancelled = true;
      if (loadingTimer.current) clearTimeout(loadingTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function refreshIntegrations(): void {
    setIntegrationStatuses(scanIntegrationHealth(process.cwd()));
  }

  useEffect(() => {
    return () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, []);

  const { detected, detectedIds, detectedCategories, recommendations } = computeToolRecommendations(
    catalog as import('@chinwag/shared/contracts.js').ToolCatalogEntry[],
    integrationStatuses,
  );
  const integrationSummary = summarizeIntegrationScan(integrationStatuses, { onlyDetected: true });

  // Group catalog by category -- skip detected tools AND categories the user already covers
  const categoryGroups: Record<string, CatalogToolLike[]> = {};
  for (const tool of catalog) {
    if (detectedIds.has(tool.id)) continue;
    const cat = tool.category || 'other';
    if (detectedCategories.has(cat)) continue;
    if (!categoryGroups[cat]) categoryGroups[cat] = [];
    categoryGroups[cat].push(tool);
  }

  const categoryKeys = Object.keys(categoryGroups);

  function showMessage(text: string): void {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage(text);
    const duration = Math.max(3000, text.length * 40);
    messageTimer.current = setTimeout(() => setMessage(null), duration);
  }

  function addTool(tool: CatalogToolLike): void {
    const result = addToolToProject(tool, process.cwd());
    showMessage(result.message);
    if (result.ok) refreshIntegrations();
  }

  useInput((ch: string, key) => {
    if (key.escape) {
      // Layered escape: close category first, then exit screen
      if (selectedCategory) {
        setSelectedCategory(null);
        return;
      }
      navigate('dashboard');
      return;
    }
    if (ch === 'b') {
      navigate('dashboard');
      return;
    }
    if (ch === 'q') {
      navigate('quit');
      return;
    }

    // Number keys to quick-add recommendations
    const num = parseInt(ch, 10);
    if (num >= 1 && num <= recommendations.length) {
      addTool(recommendations[num - 1]);
      return;
    }

    // Category navigation
    if (key.leftArrow || key.rightArrow) {
      if (!selectedCategory) {
        setSelectedCategory(categoryKeys[0] || null);
      } else {
        const idx = categoryKeys.indexOf(selectedCategory);
        if (key.rightArrow && idx < categoryKeys.length - 1) {
          setSelectedCategory(categoryKeys[idx + 1]);
        } else if (key.leftArrow && idx > 0) {
          setSelectedCategory(categoryKeys[idx - 1]);
        }
      }
    }
  });

  if (loading) {
    return (
      <Box padding={1}>
        <Text color="cyan">Loading tool catalog...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      {loadingTimedOut && (
        <Box marginBottom={1}>
          <Text color="yellow">Could not load catalog. Showing detected tools only.</Text>
        </Box>
      )}

      {/* Your tools */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Your tools
        </Text>
        <Text dimColor> ({detected.length} detected)</Text>
      </Box>

      {detected.length === 0 ? (
        <Box marginBottom={1} paddingLeft={1}>
          <Text dimColor>
            No tools detected. Run `npx chinwag init` first, or `npx chinwag add {'<tool>'}` to add
            one.
          </Text>
        </Box>
      ) : (
        <Box paddingLeft={1}>
          <DetectedToolsList
            detected={detected}
            integrationSummary={detected.length > 0 ? integrationSummary : null}
          />
        </Box>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <>
          <Box marginBottom={1}>
            <Text bold color="cyan">
              Recommended
            </Text>
          </Box>
          <Box paddingLeft={1}>
            <RecommendationsList recommendations={recommendations} cols={cols} showVerdict={true} />
          </Box>
        </>
      )}

      {/* Browse by category */}
      <CategoryBrowser
        categoryKeys={categoryKeys}
        selectedCategory={selectedCategory}
        categories={categories}
        categoryGroups={categoryGroups}
        cols={cols}
      />

      {/* Message */}
      {message && (
        <Box paddingLeft={1} marginBottom={1}>
          <Text color="yellow">{message}</Text>
        </Box>
      )}

      {/* Navigation */}
      <Box paddingLeft={1}>
        <Text>
          {recommendations.length > 0 && (
            <>
              <Text color="cyan" bold>
                [1-{recommendations.length}]
              </Text>
              <Text dimColor> add </Text>
            </>
          )}
          <Text color="cyan" bold>
            [esc]
          </Text>
          <Text dimColor> back </Text>
          <Text color="cyan" bold>
            [b]
          </Text>
          <Text dimColor> dashboard </Text>
          <Text color="cyan" bold>
            [q]
          </Text>
          <Text dimColor> quit</Text>
        </Text>
      </Box>
    </Box>
  );
}
