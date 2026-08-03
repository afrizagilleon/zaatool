import { useCallback, useEffect, useState } from 'react';
import { useUiStore } from '../store/uiStore.js';
import { formatLocation, parseLocation } from '../lib/app-location.js';

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

      // An empty, malformed or retired hash is replaced by the real one, so the address
      // bar always holds something worth copying. Done on every change and not only on
      // mount, because `#/workflows` is still typed and pasted — it points at a section
      // that no longer exists, and leaving it in the bar while showing Apps means the
      // URL and the screen disagree. Rewriting raises `hashchange`, which lands here
      // again and finds nothing left to change.
      const canonical = formatLocation(location);
      if (window.location.hash !== canonical) {
        window.location.hash = canonical;
        return;
      }

      if (useUiStore.getState().activeTab !== location.tab) {
        useUiStore.getState().applyTabFromUrl(location.tab);
      }
      setNotebookId(location.notebookId);
    };

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
