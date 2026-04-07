import { createStore, useStore } from 'zustand';
import { api } from '../api.js';
import { authActions } from './auth.js';

export interface ToolDirectoryEvaluation {
  id: string;
  name: string;
  category?: string;
  verdict?: string;
  tagline?: string;
  integration_tier?: string;
  mcp_support?: boolean | string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CatalogItem {
  id: string;
  name: string;
  category?: string;
  description: string;
  featured: boolean;
  installCmd: string | null;
  mcp_support?: boolean | string;
  [key: string]: unknown;
}

interface ToolDirectoryResponse {
  evaluations?: ToolDirectoryEvaluation[];
  categories?: Record<string, string>;
}

/** Map a directory evaluation to the catalog display shape used by ToolsView. */
function evaluationToCatalogItem(ev: ToolDirectoryEvaluation): CatalogItem {
  return {
    id: ev.id,
    name: ev.name,
    category: ev.category,
    description: ev.tagline || '',
    featured: ev.integration_tier === 'connected',
    installCmd: (ev.metadata?.install_command as string | null) || null,
    mcp_support: ev.mcp_support,
  };
}

interface ToolCatalogState {
  catalog: CatalogItem[];
  categories: Record<string, string>;
  evaluations: ToolDirectoryEvaluation[];
  loading: boolean;
  error: Error | null;
  /** Token that produced the current cache — invalidates on auth change */
  _cachedForToken: string | null;
  /** In-flight promise deduplication */
  _inflight: Promise<void> | null;
}

const toolCatalogStore = createStore<ToolCatalogState>(() => ({
  catalog: [],
  categories: {},
  evaluations: [],
  loading: true,
  error: null,
  /** Token that produced the current cache — invalidates on auth change */
  _cachedForToken: null,
  /** In-flight promise deduplication */
  _inflight: null,
}));

/**
 * Fetch the tool catalog, deduplicating concurrent requests.
 * Skips if the cache was already populated for the current token.
 */
async function fetchCatalog(token: string): Promise<void> {
  const state = toolCatalogStore.getState();

  // Cache is valid for this token — nothing to do
  if (state._cachedForToken === token && state.catalog.length > 0) return;

  // Token changed — invalidate stale cache immediately
  if (state._cachedForToken !== null && state._cachedForToken !== token) {
    toolCatalogStore.setState({
      catalog: [],
      categories: {},
      evaluations: [],
      loading: true,
      error: null,
      _cachedForToken: null,
      _inflight: null,
    });
  }

  // Deduplicate concurrent fetches
  if (toolCatalogStore.getState()._inflight) {
    try {
      await toolCatalogStore.getState()._inflight;
    } catch {
      /* error already set in store */
    }
    return;
  }

  const cacheBust = `_t=${Math.floor(Date.now() / 60000)}`; // refreshes every minute
  const request = api<ToolDirectoryResponse>(
    'GET',
    `/tools/directory?limit=200&${cacheBust}`,
    null,
    token,
  )
    .then((data) => {
      const evaluations = data.evaluations || [];
      const categories = data.categories || {};
      const catalog = evaluations.map(evaluationToCatalogItem);
      toolCatalogStore.setState({
        catalog,
        categories,
        evaluations,
        loading: false,
        error: null,
        _cachedForToken: token,
        _inflight: null,
      });
    })
    .catch((error: Error) => {
      toolCatalogStore.setState({
        catalog: [],
        categories: {},
        evaluations: [],
        loading: false,
        error,
        _cachedForToken: null,
        _inflight: null,
      });
    });

  toolCatalogStore.setState({ _inflight: request });
  await request;
}

/** Reset all catalog state (call on logout to prevent stale data on re-login). */
function resetCatalogState(): void {
  toolCatalogStore.setState({
    catalog: [],
    categories: {},
    evaluations: [],
    loading: true,
    error: null,
    _cachedForToken: null,
    _inflight: null,
  });
}

// Invalidate cache when auth changes
authActions.subscribe((state, prev) => {
  if (state.token !== prev?.token) {
    resetCatalogState();
  }
});

/** React hook — use inside components */
export function useToolCatalogStore<T>(selector: (state: ToolCatalogState) => T): T {
  return useStore(toolCatalogStore, selector);
}

/** Direct access — use outside components and in tests */
export const toolCatalogActions = {
  getState: (): ToolCatalogState => toolCatalogStore.getState(),
  fetchCatalog,
  resetCatalogState,
  subscribe: toolCatalogStore.subscribe,
};
