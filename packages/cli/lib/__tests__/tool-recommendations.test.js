import { describe, it, expect } from 'vitest';
import { computeToolRecommendations } from '../utils/tool-recommendations.js';

/**
 * Helper to create a mock IntegrationScanResult.
 */
function makeScanResult(overrides = {}) {
  return {
    id: 'tool-1',
    name: 'Tool 1',
    tier: 'connected',
    capabilities: [],
    detected: false,
    status: 'not_detected',
    configPath: '',
    mcpConfigured: false,
    hooksConfigured: false,
    issues: [],
    ...overrides,
  };
}

/**
 * Helper to create a mock ToolCatalogEntry.
 */
function makeCatalogEntry(overrides = {}) {
  return {
    id: 'tool-1',
    name: 'Tool 1',
    category: 'testing',
    description: 'A tool',
    featured: false,
    installCmd: null,
    mcp_support: false,
    ...overrides,
  };
}

describe('computeToolRecommendations', () => {
  it('returns empty arrays when catalog and integrations are empty', () => {
    const result = computeToolRecommendations([], []);
    expect(result.detected).toEqual([]);
    expect(result.detectedIds.size).toBe(0);
    expect(result.detectedCategories.size).toBe(0);
    expect(result.complementary).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  it('identifies detected integrations', () => {
    const statuses = [
      makeScanResult({ id: 'cursor', detected: true }),
      makeScanResult({ id: 'windsurf', detected: false }),
    ];
    const catalog = [];
    const result = computeToolRecommendations(catalog, statuses);
    expect(result.detected).toHaveLength(1);
    expect(result.detected[0].id).toBe('cursor');
    expect(result.detectedIds.has('cursor')).toBe(true);
    expect(result.detectedIds.has('windsurf')).toBe(false);
  });

  it('computes detected categories from catalog', () => {
    const statuses = [makeScanResult({ id: 'cursor', detected: true })];
    const catalog = [
      makeCatalogEntry({ id: 'cursor', category: 'editor' }),
      makeCatalogEntry({ id: 'eslint', category: 'linting' }),
    ];
    const result = computeToolRecommendations(catalog, statuses);
    expect(result.detectedCategories.has('editor')).toBe(true);
    expect(result.detectedCategories.has('linting')).toBe(false);
  });

  it('recommends tools from uncovered categories', () => {
    const statuses = [makeScanResult({ id: 'cursor', detected: true })];
    const catalog = [
      makeCatalogEntry({ id: 'cursor', category: 'editor' }),
      makeCatalogEntry({ id: 'eslint', category: 'linting' }),
      makeCatalogEntry({ id: 'prettier', category: 'formatting' }),
    ];
    const result = computeToolRecommendations(catalog, statuses);
    // eslint and prettier are from uncovered categories
    expect(result.complementary).toHaveLength(2);
    expect(result.recommendations.map((r) => r.id)).toEqual(['eslint', 'prettier']);
  });

  it('excludes already detected tools from recommendations', () => {
    const statuses = [
      makeScanResult({ id: 'cursor', detected: true }),
      makeScanResult({ id: 'eslint', detected: true }),
    ];
    const catalog = [
      makeCatalogEntry({ id: 'cursor', category: 'editor' }),
      makeCatalogEntry({ id: 'eslint', category: 'linting' }),
      makeCatalogEntry({ id: 'biome', category: 'linting' }),
      makeCatalogEntry({ id: 'prettier', category: 'formatting' }),
    ];
    const result = computeToolRecommendations(catalog, statuses);
    // biome is same category as detected eslint, so not complementary
    // prettier is uncovered category
    expect(result.complementary).toHaveLength(1);
    expect(result.complementary[0].id).toBe('prettier');
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].id).toBe('prettier');
  });

  it('falls back to featured tools when all categories are covered', () => {
    const statuses = [
      makeScanResult({ id: 'cursor', detected: true }),
      makeScanResult({ id: 'eslint', detected: true }),
    ];
    const catalog = [
      makeCatalogEntry({ id: 'cursor', category: 'editor' }),
      makeCatalogEntry({ id: 'eslint', category: 'linting' }),
      makeCatalogEntry({ id: 'vscode', category: 'editor', featured: true }),
      makeCatalogEntry({ id: 'biome', category: 'linting', featured: true }),
    ];
    const result = computeToolRecommendations(catalog, statuses);
    // All non-detected tools are in already-covered categories
    expect(result.complementary).toHaveLength(0);
    // Falls back to featured, excluding detected
    expect(result.recommendations.map((r) => r.id)).toEqual(['vscode', 'biome']);
  });

  it('limits recommendations to 9 entries', () => {
    const statuses = [];
    const catalog = Array.from({ length: 15 }, (_, i) =>
      makeCatalogEntry({
        id: `tool-${i}`,
        name: `Tool ${i}`,
        category: `cat-${i}`,
      }),
    );
    const result = computeToolRecommendations(catalog, statuses);
    expect(result.recommendations).toHaveLength(9);
  });

  it('limits featured fallback to 9 entries', () => {
    const statuses = [makeScanResult({ id: 'detected-tool', detected: true })];
    const catalog = [
      makeCatalogEntry({ id: 'detected-tool', category: 'cat-0' }),
      ...Array.from({ length: 12 }, (_, i) =>
        makeCatalogEntry({
          id: `tool-${i}`,
          name: `Tool ${i}`,
          category: 'cat-0', // same category as detected, so not complementary
          featured: true,
        }),
      ),
    ];
    const result = computeToolRecommendations(catalog, statuses);
    expect(result.complementary).toHaveLength(0);
    expect(result.recommendations).toHaveLength(9);
  });

  it('handles tools with empty/missing category', () => {
    const statuses = [makeScanResult({ id: 'cursor', detected: true })];
    const catalog = [
      makeCatalogEntry({ id: 'cursor', category: 'editor' }),
      makeCatalogEntry({ id: 'mystery', category: '' }),
    ];
    const result = computeToolRecommendations(catalog, statuses);
    // Empty string category: detectedCategories has 'editor', not ''
    // So '' is not in detectedCategories, but category is falsy
    // The filter is: !detectedIds.has(t.id) && t.category && !detectedCategories.has(t.category)
    // t.category is '' which is falsy, so it's excluded from complementary
    expect(result.complementary).toHaveLength(0);
  });

  it('returns correct structure shape', () => {
    const statuses = [makeScanResult({ id: 'a', detected: true })];
    const catalog = [makeCatalogEntry({ id: 'a', category: 'x' })];
    const result = computeToolRecommendations(catalog, statuses);
    expect(result).toHaveProperty('detected');
    expect(result).toHaveProperty('detectedIds');
    expect(result).toHaveProperty('detectedCategories');
    expect(result).toHaveProperty('complementary');
    expect(result).toHaveProperty('recommendations');
    expect(result.detectedIds).toBeInstanceOf(Set);
    expect(result.detectedCategories).toBeInstanceOf(Set);
  });

  it('does not recommend detected tools even if they are featured', () => {
    const statuses = [makeScanResult({ id: 'cursor', detected: true })];
    const catalog = [
      makeCatalogEntry({ id: 'cursor', category: 'editor', featured: true }),
      makeCatalogEntry({ id: 'vscode', category: 'editor', featured: true }),
    ];
    const result = computeToolRecommendations(catalog, statuses);
    // complementary empty (same category)
    // featured fallback excludes detected cursor
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].id).toBe('vscode');
  });
});
