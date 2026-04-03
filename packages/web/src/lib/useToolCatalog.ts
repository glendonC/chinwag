import { useEffect } from 'react';
import {
  useToolCatalogStore,
  toolCatalogActions,
  type CatalogItem,
  type ToolDirectoryEvaluation,
} from './stores/toolCatalog.js';

interface UseToolCatalogReturn {
  catalog: CatalogItem[];
  categories: Record<string, string>;
  evaluations: ToolDirectoryEvaluation[];
  loading: boolean;
  error: Error | null;
}

export function useToolCatalog(token: string | null): UseToolCatalogReturn {
  const catalog = useToolCatalogStore((s) => s.catalog);
  const categories = useToolCatalogStore((s) => s.categories);
  const evaluations = useToolCatalogStore((s) => s.evaluations);
  const loading = useToolCatalogStore((s) => s.loading);
  const error = useToolCatalogStore((s) => s.error);

  useEffect(() => {
    if (token) {
      toolCatalogActions.fetchCatalog(token);
    }
  }, [token]);

  return { catalog, categories, evaluations, loading, error };
}
