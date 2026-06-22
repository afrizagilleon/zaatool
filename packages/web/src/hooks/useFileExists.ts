import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../lib/api.js';

/**
 * Checks whether a storage-relative path exists by listing its parent
 * directory, since storage listings are per-directory (not recursive).
 */
export function useFileExists(path: string | null | undefined): boolean {
  const [exists, setExists] = useState(true);

  useEffect(() => {
    if (!path) {
      setExists(true);
      return;
    }

    let cancelled = false;
    const lastSlash = path.lastIndexOf('/');
    const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : '';

    fetch(`${API_BASE_URL}/api/resources/files?dir=${encodeURIComponent(dir)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((items: { path: string }[]) => {
        if (!cancelled) setExists(items.some((f) => f.path === path));
      })
      .catch(() => {
        if (!cancelled) setExists(true);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return exists;
}
