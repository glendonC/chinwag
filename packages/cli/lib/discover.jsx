import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { MCP_TOOLS } from './tools.js';
import { detectTools, configureTool } from './mcp-config.js';
import { api } from './api.js';

const MAX_RECOMMENDATIONS = 9;

export function Discover({ config, navigate }) {
  const [detected, setDetected] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [categories, setCategories] = useState({});
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const messageTimer = useRef(null);

  useEffect(() => {
    setDetected(detectTools(process.cwd()));

    // Fetch catalog from API (single source of truth)
    async function fetchCatalog() {
      try {
        const result = await api(config).get('/tools/catalog');
        setCatalog(result.tools || []);
        setCategories(result.categories || {});
      } catch (err) {
        // Fallback: show just detected tools if API is unreachable
        setMessage(`Could not fetch tool catalog: ${err.message}`);
      }
      setLoading(false);
    }
    fetchCatalog();
  }, []);

  useEffect(() => {
    return () => { if (messageTimer.current) clearTimeout(messageTimer.current); };
  }, []);

  const detectedIds = new Set(detected.map(t => t.id));

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
        setDetected(detectTools(process.cwd()));
      } else {
        showMessage(`Error: ${result.error}`);
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
      {/* Your tools */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Your tools</Text>
        <Text dimColor> ({detected.length} configured)</Text>
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
              return (
                <Text key={tool.id}>
                  <Text color="green">●</Text>
                  <Text> {tool.name.padEnd(maxName + 1)}</Text>
                  <Text dimColor>{detail}</Text>
                </Text>
              );
            })}
          </Box>
        );
      })()}

      {/* Recommendations */}
      {recommendations.length > 0 && (() => {
        const maxName = Math.max(...recommendations.map(t => t.name.length));
        return (
          <>
            <Box marginBottom={1}>
              <Text bold color="cyan">Recommended</Text>
            </Box>
            <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
              {recommendations.map((tool, i) => (
                <Text key={tool.id}>
                  <Text color="cyan" bold>[{i + 1}]</Text>
                  <Text> {tool.name.padEnd(maxName + 1)}</Text>
                  <Text dimColor>{tool.description}</Text>
                  {tool.mcpCompatible && <Text color="green"> [MCP]</Text>}
                </Text>
              ))}
            </Box>
          </>
        );
      })()}

      {/* Browse by category */}
      {categoryKeys.length > 0 && (
        <>
          <Box marginBottom={1}>
            <Text bold color="cyan">Browse</Text>
            <Text dimColor> (← → to navigate categories)</Text>
          </Box>
          <Box paddingLeft={1} marginBottom={1}>
            {categoryKeys.map(cat => (
              <Text key={cat}>
                {selectedCategory === cat ? (
                  <Text color="cyan" bold>[{categories[cat] || cat}]</Text>
                ) : (
                  <Text dimColor> {categories[cat] || cat} </Text>
                )}
                <Text> </Text>
              </Text>
            ))}
          </Box>
        </>
      )}

      {selectedCategory && categoryGroups[selectedCategory] && (() => {
        const tools = categoryGroups[selectedCategory];
        const maxName = Math.max(...tools.map(t => t.name.length));
        return (
          <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
            {tools.map(tool => (
              <Text key={tool.id}>
                <Text dimColor>○</Text>
                <Text> {tool.name.padEnd(maxName + 1)}</Text>
                <Text dimColor>{tool.description}</Text>
                {tool.mcpCompatible && <Text color="green"> [MCP]</Text>}
              </Text>
            ))}
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
