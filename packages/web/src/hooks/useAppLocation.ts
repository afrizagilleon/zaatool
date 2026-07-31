import { useCallback, useEffect, useState } from 'react';
import { useUiStore } from '../store/uiStore.js';
import { formatLocation, parseLocation, toUiTab } from '../lib/app-location.js';

/**
 * Reads the app's location out of the URL and applies it.
 *
 * The hash is the single source of truth, and everything travels one way: a write to
 * the hash raises `hashchange`, which applies the new location to the store. An earlier
 * version mirrored store and URL with two effects and they raced — each undoing the
 * other's write depending on which ran first. One writer, one reader, no ordering to
 * reason about.
 *
 * Called once, at the root. The notebooks tab receives what it needs as props.
 */
export function useAppLocation() {
  const [notebookId, setNotebookId] = useState<string | undefined>(
    () => parseLocation(window.location.hash).notebookId
  );

  useEffect(() => {
    const apply = () => {
      const location = parseLocation(window.location.hash);
      const wanted = toUiTab(location.tab);
      if (useUiStore.getState().activeTab !== wanted) {
        useUiStore.getState().applyTabFromUrl(wanted);
      }
      setNotebookId(location.notebookId);
    };

    // An empty or malformed hash is replaced by the real one, so the address bar
    // always holds something worth copying.
    const canonical = formatLocation(parseLocation(window.location.hash));
    if (window.location.hash !== canonical) {
      window.location.hash = canonical;
    }

    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  const openNotebook = useCallback((id: string) => {
    window.location.hash = `#/notebooks/${id}`;
  }, []);

  const closeNotebook = useCallback(() => {
    window.location.hash = '#/notebooks';
  }, []);

  return { notebookId, openNotebook, closeNotebook };
}
