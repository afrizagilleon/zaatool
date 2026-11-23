import { useEffect, useRef } from 'react';
import { useNotebookStore } from '../store/notebookStore.js';
import { watchCatalog } from '../lib/watch-socket.js';
import { decideRemoteSave, describeSaver } from '../lib/remote-save.js';

/**
 * Lets the open editor learn about a save made elsewhere without waiting for its own save
 * to be refused. Nothing unsaved: the copy is refreshed and a notice says so. Unsaved
 * edits: a banner warns, and the person chooses when to reload.
 */
export function useRemoteSaveWatch(enabled: boolean, reload: () => Promise<void>) {
  const latestReload = useRef(reload);
  useEffect(() => {
    latestReload.current = reload;
  });

  useEffect(() => {
    if (!enabled) return;
    return watchCatalog((event) => {
      const store = useNotebookStore.getState();
      const action = decideRemoteSave(store, event);
      if (action === 'ignore') return;
      const by = describeSaver(event.by);

      if (action === 'warn') {
        store.setRemoteChange({ revision: event.revision as number, by });
        return;
      }
      void latestReload
        .current()
        .then(() => useNotebookStore.getState().setRemoteNotice(`Updated: saved by ${by} just now.`))
        // A failed refresh is not worth an error of its own: the next save would be
        // refused with the real reason, and the banner path is still open.
        .catch(() => store.setRemoteChange({ revision: event.revision as number, by }));
    });
  }, [enabled]);
}
