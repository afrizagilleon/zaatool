import { useState } from 'react';
import type { NotebookRuntime } from '@zaa-tool/shared';
import { useNotebookStore } from '../../store/notebookStore';
import { notebooksApi } from '../../lib/notebooks-api';
import { NotebookList } from '../notebook/NotebookList';
import { NotebookEditor } from '../notebook/NotebookEditor';

export function NotebooksPage() {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createNotebook = useNotebookStore((s) => s.createNotebook);
  const loadNotebook = useNotebookStore((s) => s.loadNotebook);
  const restoreRun = useNotebookStore((s) => s.restoreRun);

  const open = async (id: string) => {
    try {
      loadNotebook(await notebooksApi.getById(id));
      setError(null);
      setIsEditing(true);

      // Results come from the last recorded run, never from the document. A
      // notebook that has never run simply opens without output.
      const latest = await notebooksApi.getRun(id, 'latest').catch(() => null);
      if (latest) restoreRun(latest);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const create = (runtime: NotebookRuntime) => {
    createNotebook(runtime);
    setIsEditing(true);
  };

  if (isEditing) {
    return <NotebookEditor onBack={() => setIsEditing(false)} />;
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {error && (
        <div className="px-4 py-2 text-xs text-status-error border-b border-status-error/40">{error}</div>
      )}
      <NotebookList onOpen={open} onCreate={create} />
    </div>
  );
}
