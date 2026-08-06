import { useEffect, useState } from 'react';
import {
  Plus,
  Notebook as NotebookIcon,
  MagnifyingGlass,
  ArrowSquareIn,
  TrashSimple,
  X,
} from '@phosphor-icons/react';
import type { NotebookRuntime, NotebookSummary } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { notebooksApi } from '../../lib/notebooks-api';

interface NotebookListProps {
  onOpen: (id: string) => void;
  onCreate: (runtime: NotebookRuntime) => void;
}

/**
 * Every notebook, and the two things you can do to one from here.
 *
 * Deleting used to be a bin icon on each row, held at `opacity-0` until the row was
 * hovered. That is not a hidden control — **an invisible element is still a tappable
 * one** — and a phone has no hover, so the button was permanently invisible and
 * permanently live. It also called `notebooksApi.delete` immediately: no confirmation, no
 * undo, nothing to read afterwards. A notebook was deleted by a thumb landing near the
 * right-hand edge of a row.
 *
 * So deleting is now something you enter rather than something you can brush against:
 * press **Select**, tick what should go, confirm a dialog that names them. Two deliberate
 * acts and a sentence in between. The rest of the time there is no destructive control on
 * the screen at all.
 */
export function NotebookList({ onOpen, onCreate }: NotebookListProps) {
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /** Null when not selecting. A set — empty — is how selecting starts. */
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const removeSelected = async () => {
    if (!selected || selected.size === 0) return;
    setIsDeleting(true);
    try {
      // Sequential rather than parallel: if the fourth one is refused, the first three
      // are already gone and the list has to show what actually happened.
      for (const id of selected) await notebooksApi.delete(id);
      setError(null);
      setSelected(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsDeleting(false);
      setConfirming(false);
      await refresh();
    }
  };

  /**
   * Imports a notebook from the text form.
   *
   * Always as a new notebook. The file carries the id it had wherever it came from, and
   * a colleague's export landing on top of whatever holds that id here would be a very
   * quiet way to lose work.
   */
  const importFile = async (file: File) => {
    try {
      const saved = await notebooksApi.saveText(await file.text(), true);
      await refresh();
      onOpen(saved.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const needle = query.trim().toLowerCase();
  const found = needle
    ? notebooks.filter((notebook) => notebook.name.toLowerCase().includes(needle))
    : notebooks;

  const selecting = selected !== null;

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chosen = notebooks.filter((notebook) => selected?.has(notebook.id));

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        {/* Wraps rather than overflowing. At 375px these four controls measured 435px
            wide and the last of them could not be reached at all. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-bold uppercase tracking-widest text-foreground">Notebooks</h1>
          <div className="flex-1" />

          {selecting ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs"
                onClick={() => setSelected(null)}
              >
                <X size={12} className="mr-1.5" />
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 px-2.5 text-xs"
                disabled={(selected?.size ?? 0) === 0}
                onClick={() => setConfirming(true)}
              >
                <TrashSimple size={12} className="mr-1.5" />
                Delete {selected?.size ?? 0}
              </Button>
            </>
          ) : (
            <>
              {notebooks.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs text-muted-foreground"
                  onClick={() => setSelected(new Set())}
                >
                  Select
                </Button>
              )}

              {/* The text form is what agents already read and write, so importing one is
                  opening a file rather than a format anyone had to invent.

                  `ArrowSquareIn` rather than an up arrow: up and down mean opposite things
                  depending on whether you are thinking about the file or the app, which is
                  why these two read as swapped. In and out have no such axis. */}
              <label
                className="inline-flex h-7 cursor-pointer items-center gap-1.5 border border-border px-2.5 text-xs hover:bg-muted"
                title="Open a notebook exported as .md"
              >
                <ArrowSquareIn size={12} />
                Import
                <input
                  type="file"
                  accept=".md,text/markdown"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void importFile(file);
                  }}
                />
              </label>
              <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => onCreate('node')}>
                <Plus size={12} className="mr-1.5" />
                JavaScript
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 px-2.5 text-xs"
                onClick={() => onCreate('python')}
              >
                <Plus size={12} className="mr-1.5" />
                Python
              </Button>
            </>
          )}
        </div>

        {/* Workflows has had one of these all along; notebooks are the artifact that
            actually multiplies, so it needed one more. */}
        {notebooks.length > 0 && (
          <div className="relative mb-3">
            <MagnifyingGlass
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${notebooks.length} notebooks`}
              className="h-8 pl-8 text-xs"
            />
          </div>
        )}

        {error && (
          <div className="mb-3 px-3 py-2 text-xs text-status-error border border-status-error/40">{error}</div>
        )}

        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}

        {!isLoading && notebooks.length > 0 && found.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nothing matches “{query}”.
          </p>
        )}

        {!isLoading && notebooks.length === 0 && !error && (
          <div className="border border-dashed border-border p-8 text-center">
            <NotebookIcon size={22} className="mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              No notebooks yet. Create one to start writing steps.
            </p>
          </div>
        )}

        <div className="space-y-1">
          {found.map((notebook) => (
            <div
              key={notebook.id}
              // 44px tall, which is the smallest target a thumb hits reliably.
              className="flex min-h-11 items-center gap-3 border border-border px-3 py-2 hover:border-primary/50 cursor-pointer"
              onClick={() => (selecting ? toggle(notebook.id) : onOpen(notebook.id))}
            >
              {selecting ? (
                <Checkbox
                  checked={selected?.has(notebook.id) ?? false}
                  // The row handles it. A second handler here would toggle twice.
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={() => toggle(notebook.id)}
                  className="shrink-0"
                />
              ) : (
                <NotebookIcon size={14} className="shrink-0 text-muted-foreground" />
              )}

              {/* Name above, time below. On one line the name was the only thing that
                  could give way, so it was cut to `zz-uji-berka…` while a timestamp
                  nobody was reading kept its full width. */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-foreground">{notebook.name}</div>
                <div className="text-[10px] text-muted-foreground/60">
                  {new Date(notebook.updated_at).toLocaleString()}
                </div>
              </div>

              <span className="shrink-0 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {notebook.runtime === 'python' ? 'py' : 'js'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Names them. "Delete 3 notebooks?" is a number; the names are what tells you
          whether the third one is the thing you spent yesterday on. */}
      <Dialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete {chosen.length} {chosen.length === 1 ? 'notebook' : 'notebooks'}?
            </DialogTitle>
            <DialogDescription>
              This cannot be undone. Runs and deployments belonging to them go too.
            </DialogDescription>
          </DialogHeader>

          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {chosen.map((notebook) => (
              <li key={notebook.id} className="truncate font-mono text-xs text-foreground">
                {notebook.name}
              </li>
            ))}
          </ul>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={isDeleting} onClick={removeSelected}>
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
