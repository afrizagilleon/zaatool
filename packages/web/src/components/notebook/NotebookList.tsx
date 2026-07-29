import { useEffect, useState } from 'react';
import { Plus, Trash, Notebook as NotebookIcon } from '@phosphor-icons/react';
import type { NotebookRuntime, NotebookSummary } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { notebooksApi } from '../../lib/notebooks-api';

interface NotebookListProps {
  onOpen: (id: string) => void;
  onCreate: (runtime: NotebookRuntime) => void;
}

export function NotebookList({ onOpen, onCreate }: NotebookListProps) {
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = async () => {
    setIsLoading(true);
    try {
      setNotebooks(await notebooksApi.list());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const remove = async (id: string) => {
    try {
      await notebooksApi.delete(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-sm font-bold uppercase tracking-widest text-foreground">Notebooks</h1>
          <div className="flex-1" />
          <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => onCreate('node')}>
            <Plus size={12} className="mr-1.5" />
            JavaScript
          </Button>
          <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={() => onCreate('python')}>
            <Plus size={12} className="mr-1.5" />
            Python
          </Button>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 text-xs text-status-error border border-status-error/40">{error}</div>
        )}

        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}

        {!isLoading && notebooks.length === 0 && !error && (
          <div className="border border-dashed border-border p-8 text-center">
            <NotebookIcon size={22} className="mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              No notebooks yet. Create one to start writing steps.
            </p>
          </div>
        )}

        <div className="space-y-1">
          {notebooks.map((notebook) => (
            <div
              key={notebook.id}
              className="group flex items-center gap-3 px-3 py-2 border border-border hover:border-primary/50 cursor-pointer"
              onClick={() => onOpen(notebook.id)}
            >
              <NotebookIcon size={14} className="text-muted-foreground shrink-0" />
              <span className="text-xs font-semibold text-foreground truncate">{notebook.name}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-muted text-muted-foreground">
                {notebook.runtime === 'python' ? 'py' : 'js'}
              </span>
              <div className="flex-1" />
              <span className="text-[10px] text-muted-foreground/60">
                {new Date(notebook.updated_at).toLocaleString()}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6 text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100"
                title="Delete notebook"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(notebook.id);
                }}
              >
                <Trash size={12} />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
