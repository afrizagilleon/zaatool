import { useCallback, useEffect, useState } from 'react';
import type { NotebookMap } from '@zaa-tool/shared';
import { notebooksApi } from '../lib/notebooks-api.js';

/**
 * Fetches the derived map.
 *
 * There is nothing to cache and nothing to invalidate: the engine computes it from the
 * documents on every request, so refetching is the only correctness story it needs.
 */
export function useNotebookMap() {
  const [map, setMap] = useState<NotebookMap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setMap(await notebooksApi.map());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { map, isLoading, error, refresh };
}
