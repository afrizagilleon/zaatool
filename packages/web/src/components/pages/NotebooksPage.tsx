import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotebookRuntime } from '@zaa-tool/shared';
import { useNotebookStore } from '../../store/notebookStore';
import { notebooksApi } from '../../lib/notebooks-api';
import { NotebookList } from '../notebook/NotebookList';
import { NotebookEditor } from '../notebook/NotebookEditor';

interface NotebooksPageProps {
  /** From the URL: the notebook to have open, if any. */
  notebookId?: string;
  onOpenNotebook: (id: string) => void;
  onCloseNotebook: () => void;
}

export function NotebooksPage({
  notebookId,
  onOpenNotebook,
  onCloseNotebook,
}: NotebooksPageProps) {
  /** A notebook created here has no id in the URL until it is first saved. */
  const [isDrafting, setIsDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createNotebook = useNotebookStore((s) => s.createNotebook);
  const loadNotebook = useNotebookStore((s) => s.loadNotebook);
  const restoreRun = useNotebookStore((s) => s.restoreRun);
  const loadedId = useNotebookStore((s) => s.id);

  const load = useCallback(
    async (id: string) => {
      try {
        loadNotebook(await notebooksApi.getById(id));
        setError(null);

        // Results come from the last recorded run, never from the document. A
        // notebook that has never run simply opens without output.
        const latest = await notebooksApi.getRun(id, 'latest').catch(() => null);
        if (latest) restoreRun(latest, true);
      } catch (err) {
        setError((err as Error).message);
        onCloseNotebook();
      }
    },
    [loadNotebook, restoreRun, onCloseNotebook]
  );

  /**
   * The URL is what says which notebook is open, so a pasted link and a click on the
   * list arrive the same way. Guarded against reloading what is already in the store,
   * which would throw away unsaved edits on every re-render.
   */
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!notebookId || notebookId === loadedId || requested.current === notebookId) return;
    requested.current = notebookId;
    void load(notebookId);
  }, [notebookId, loadedId, load]);

  /**
   * A draft reaches the URL only once it has been saved. Before that its id exists
   * on this screen alone, and a link to it would promise a notebook the server has
   * never heard of.
   */
  const isDirty = useNotebookStore((s) => s.isDirty);
  if (isDrafting && loadedId && !isDirty) {
    setIsDrafting(false);
  }

  const prevIsDrafting = useRef(isDrafting);
  useEffect(() => {
    if (prevIsDrafting.current && !isDrafting && loadedId) {
      onOpenNotebook(loadedId);
    }
    prevIsDrafting.current = isDrafting;
  }, [isDrafting, loadedId, onOpenNotebook]);

  const create = (runtime: NotebookRuntime) => {
    createNotebook(runtime);
    setIsDrafting(true);
  };

  const close = () => {
    setIsDrafting(false);
    requested.current = null;
    onCloseNotebook();
  };

  if (notebookId || isDrafting) {
    return <NotebookEditor onBack={close} />;
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {error && (
        <div className="px-4 py-2 text-xs text-status-error border-b border-status-error/40">{error}</div>
      )}
      <NotebookList onOpen={onOpenNotebook} onCreate={create} />
    </div>
  );
}
