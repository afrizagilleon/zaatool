import { useCallback, useEffect, useState } from 'react';
import type { NotebookMap } from '@zaa-tool/shared';
import { notebooksApi } from '../lib/notebooks-api.js';
import { useCatalogRefresh } from './useCatalogRefresh.js';

/**
 * Fetches the derived map.
 *
 * There is nothing to cache and nothing to invalidate: the engine computes it from the
 * documents on every request, so refetching is the only correctness story it needs.
 *
 * Which is exactly why it had to learn when to refetch. The map is the screen most likely
 * to be watched while somebody else works — an agent writing notebooks over MCP is the
 * case it was drawn for — and a picture of the system that does not include what was
 * built five minutes ago is a picture of a system that no longer exists.
 */
export function useNotebookMap() {
  const [map, setMap] = useState<NotebookMap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async ({ quietly = false } = {}) => {
    if (!quietly) setIsLoading(true);
    try {
      setMap(await notebooksApi.map());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (!quietly) setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(), [load]);

  useEffect(() => {
    void load();
  }, [load]);

  // Quietly: a redraw is disruptive enough without the whole canvas blanking first.
  const live = useCatalogRefresh(() => void load({ quietly: true }));

  return { map, isLoading, error, refresh, live };
}
