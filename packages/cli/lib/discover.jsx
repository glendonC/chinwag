import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { MCP_TOOLS } from './tools.js';
import { configureTool, scanIntegrationHealth, summarizeIntegrationScan } from './mcp-config.js';
import { api } from './api.js';

const MAX_RECOMMENDATIONS = 9;
const LOADING_TIMEOUT_MS = 15000;

function evalToTool(e) {
  const meta = e.metadata || {};
  return {
    id: e.id, name: e.name, description: e.tagline,
    category: e.category, mcpCompatible: !!e.mcp_support,
    website: meta.website, installCmd: meta.install_command,
    featured: !!meta.featured, verdict: e.verdict, confidence: e.confidence,
  };
}

export function Discover({ config, navigate }) {
  const { stdout } = useStdout();
  const cols = stdout?.columns || 80;
  const [integrationStatuses, setIntegrationStatuses] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [categories, setCategories] = useState({});
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const messageTimer = useRef(null);
  const loadingTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    refreshIntegrations();

    // Fetch catalog from API (single source of truth)
    async function fetchCatalog() {
      try {
        const result = await api(config).get('/tools/directory?limit=200');
        if (cancelled) return;
        setCatalog((result.evaluations || []).map(evalToTool));
        setCategories(result.categories || {});
      } catch {
        // Fallback to old catalog endpoint if directory isn't deployed yet
        try {
          const fallback = await api(config).get('/tools/catalog');
          if (cancelled) return;
          setCatalog(fallback.tools || []);
          setCategories(fallback.categories || {});
        } catch (err) {
          if (cancelled) return;
          setMessage(`Could not fetch tool catalog: ${err.message}`);
        }
      }
      if (cancelled) return;
      setLoading(false);
      if (loadingTimer.current) { clearTimeout(loadingTimer.current); loadingTimer.current = null; }
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
  }, []);

  function refreshIntegrations() {
    setIntegrationStatuses(scanIntegrationHealth(process.cwd()));
  }

  useEffect(() => {
    return () => { if (messageTimer.current) clearTimeout(messageTimer.current); };
  }, []);

  const detected = integrationStatuses.filter((item) => item.detected);
  const detectedIds = new Set(detected.map(t => t.id));
  const integrationSummary = summarizeIntegrationScan(integrationStatuses, { onlyDetected: true });

  // Smart recommendations: suggest tools from categories the user DOESN'T already cover.
  // If you have 4 coding agents, recommend code review/terminal/docs tools instead.
  const detectedCategories = new Set(
    catalog.filter(t => detectedIds.has(t.id)).map(t => t.category)
  );
  const complementary = catalog.filter(t =>
    !detectedIds.has(t.id) && t.category && !detectedCategories.has(t.category)
  );
  // Fall back to featured from any category if no complementary tools found
  const recommendations = (complementary.length > 0 ? complementary : catalog.filter(t => !detectedIds.has(t.id) && t.featured))
    .slice(0, MAX_RECOMMENDATIONS);

  // Group catalog by category — skip detected tools AND categories the user already covers
  const categoryGroups = {};
  for (const tool of catalog) {
    if (detectedIds.has(tool.id)) continue;
    const cat = tool.category || 'other';
    if (detectedCategories.has(cat)) continue; // don't show categories you already have tools in
    if (!categoryGroups[cat]) categoryGroups[cat] = [];
    categoryGroups[cat].push(tool);
  }

  const categoryKeys = Object.keys(categoryGroups);

  function showMessage(text) {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage(text);
    const duration = Math.max(3000, text.length * 40);
    messageTimer.current = setTimeout(() => setMessage(null), duration);
  }

  useInput((ch, key) => {
    if (key.escape) {
      // Layered escape: close category first, then exit screen
      if (selectedCategory) { setSelectedCategory(null); return; }
      navigate('dashboard'); return;
    }
    if (ch === 'b') { navigate('dashboard'); return; }
    if (ch === 'q') { navigate('quit'); return; }

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

  function addTool(tool) {
    const mcpTool = MCP_TOOLS.find(t => t.id === tool.id);
    if (mcpTool) {
      const result = configureTool(process.cwd(), tool.id);
      if (result.ok) {
        showMessage(`Added ${result.name}: ${result.detail}`);
        refreshIntegrations();
      } else {
        showMessage(`Could not add ${tool.name}: ${result.error}`);
      }
    } else if (tool.installCmd) {
      showMessage(`${tool.name} — Install: ${tool.installCmd}  |  ${tool.website}`);
    } else if (tool.website) {
      showMessage(`${tool.name} — Visit: ${tool.website}`);
    }
  }

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
        <Text bold color="cyan">Your tools</Text>
        <Text dimColor> ({detected.length} detected)</Text>
      </Box>

      {detected.length === 0 ? (
        <Box marginBottom={1} paddingLeft={1}>
          <Text dimColor>No tools detected. Run `npx chinwag init` first, or `npx chinwag add {'<tool>'}` to add one.</Text>
        </Box>
      ) : (() => {
        const maxName = Math.max(...detected.map(t => t.name.length));
        return (
          <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
            {detected.map(tool => {
              let detail = tool.mcpConfig;
              if (tool.hooks) detail += ' + hooks';
              if (tool.channel) detail += ' + channel';
              const statusColor = tool.status === 'ready' ? 'green'
                : tool.status === 'needs_repair' ? 'yellow'
                : tool.status === 'needs_setup' ? 'yellow'
                : 'gray';
              const statusText = tool.status.replace(/_/g, ' ');
              return (
                <Box key={tool.id} flexDirection="column">
                  <Text>
                    <Text color={tool.status === 'ready' ? 'green' : 'yellow'}>●</Text>
                    <Text> {tool.name.padEnd(maxName + 1)}</Text>
                    <Text dimColor>{detail}</Text>
                    <Text dimColor>  </Text>
                    <Text color={statusColor}>{statusText}</Text>
                  </Text>
                  {tool.issues?.[0] && (
                    <Text dimColor>    {tool.issues[0]}</Text>
                  )}
                </Box>
              );
            })}
          </Box>
        );
      })()}

      {detected.length > 0 && (
        <Box marginBottom={1} paddingLeft={1}>
          <Text color={integrationSummary.tone === 'success' ? 'green' : integrationSummary.tone === 'warning' ? 'yellow' : 'cyan'}>
            {integrationSummary.text}
          </Text>
        </Box>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (() => {
        const maxName = Math.max(...recommendations.map(t => t.name.length));
        return (
          <>
            <Box marginBottom={1}>
              <Text bold color="cyan">Recommended</Text>
            </Box>
            <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
              {(() => {
                const descAvail = cols - 3 - 4 - (maxName + 1) - 6; // padding, [N], name, [MCP] tag
                return recommendations.map((tool, i) => {
                  const desc = descAvail > 10 && tool.description.length > descAvail
                    ? tool.description.slice(0, descAvail - 1) + '…'
                    : tool.description;
                  const verdictColor = (tool.verdict === 'integrated' || tool.verdict === 'compatible') ? 'green'
                    : (tool.verdict === 'installable' || tool.verdict === 'partial') ? 'yellow' : undefined;
                  return (
                    <Text key={tool.id}>
                      <Text color="cyan" bold>[{i + 1}]</Text>
                      <Text> {tool.name.padEnd(maxName + 1)}</Text>
                      <Text dimColor>{desc}</Text>
                      {tool.mcpCompatible && <Text color="green"> [MCP]</Text>}
                      {tool.verdict && <Text color={verdictColor} dimColor={!verdictColor}> [{tool.verdict}]</Text>}
                    </Text>
                  );
                });
              })()}
            </Box>
          </>
        );
      })()}

      {/* Browse by category — single-name navigator, never wraps */}
      {categoryKeys.length > 0 && (
        <>
          <Box marginBottom={1}>
            <Text bold color="cyan">Browse</Text>
            {selectedCategory ? (
              <Text dimColor>  ← </Text>
            ) : (
              <Text dimColor>  </Text>
            )}
            {selectedCategory ? (
              <Text bold>{categories[selectedCategory] || selectedCategory}</Text>
            ) : (
              <Text dimColor>press ← → to browse categories</Text>
            )}
            {selectedCategory && categoryKeys.indexOf(selectedCategory) < categoryKeys.length - 1 ? (
              <Text dimColor> →</Text>
            ) : selectedCategory ? (
              <Text dimColor>  </Text>
            ) : null}
            {selectedCategory && (
              <Text dimColor>  ({categoryKeys.indexOf(selectedCategory) + 1}/{categoryKeys.length})</Text>
            )}
          </Box>
        </>
      )}

      {selectedCategory && categoryGroups[selectedCategory] && (() => {
        const tools = categoryGroups[selectedCategory];
        const maxName = Math.max(...tools.map(t => t.name.length));
        // Truncate descriptions to fit terminal width
        const descAvail = cols - 4 - 2 - (maxName + 1) - 6; // padding, bullet, name, [MCP] tag
        return (
          <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
            {tools.map(tool => {
              const desc = descAvail > 10 && tool.description.length > descAvail
                ? tool.description.slice(0, descAvail - 1) + '…'
                : tool.description;
              const verdictColor = (tool.verdict === 'integrated' || tool.verdict === 'compatible') ? 'green'
                : (tool.verdict === 'installable' || tool.verdict === 'partial') ? 'yellow' : undefined;
              return (
                <Text key={tool.id}>
                  <Text dimColor>○</Text>
                  <Text> {tool.name.padEnd(maxName + 1)}</Text>
                  <Text dimColor>{desc}</Text>
                  {tool.mcpCompatible && <Text color="green"> [MCP]</Text>}
                  {tool.verdict && <Text color={verdictColor} dimColor={!verdictColor}> [{tool.verdict}]</Text>}
                </Text>
              );
            })}
          </Box>
        );
      })()}

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
            <><Text color="cyan" bold>[1-{recommendations.length}]</Text><Text dimColor> add  </Text></>
          )}
          <Text color="cyan" bold>[esc]</Text><Text dimColor> back  </Text>
          <Text color="cyan" bold>[b]</Text><Text dimColor> dashboard  </Text>
          <Text color="cyan" bold>[q]</Text><Text dimColor> quit</Text>
        </Text>
      </Box>
    </Box>
  );
}
