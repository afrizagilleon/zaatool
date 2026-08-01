import { useEffect, useState } from 'react';
import { RocketLaunch, Spinner, CheckCircle, WarningCircle, Question } from '@phosphor-icons/react';
import type { NotebookJson, NotebookRunDetail } from '@zaa-tool/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { notebooksApi } from '../../lib/notebooks-api';
import { diffNotebooks, type CellChange, type NotebookDiff } from '../../lib/notebook-diff';
import { cn } from '../../lib/utils';

/**
 * What deploying would change, with the evidence.
 *
 * The gate is only worth having if the decision behind it is informed, and "the draft
 * differs" is not information. So this answers the two questions actually asked before
 * putting something live: what will behave differently, and did it work when it ran.
 *
 * Evidence comes from the latest run, which is the honest source — not a claim by
 * whoever wrote the cell.
 */

interface DeployReviewDialogProps {
  notebookId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeployed: () => void;
}

const KIND_STYLES: Record<CellChange['kind'], string> = {
  added: 'text-status-done border-status-done/40',
  changed: 'text-amber-500 border-amber-500/40',
  removed: 'text-status-error border-status-error/40',
};

function Evidence({ result }: { result: NotebookRunDetail['cell_results'][string] | undefined }) {
  if (!result) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
        <Question size={11} weight="duotone" /> never run
      </span>
    );
  }
  if (result.error) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-status-error" title={result.error}>
        <WarningCircle size={11} weight="fill" /> failed when it ran
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-status-done">
      <CheckCircle size={11} weight="fill" /> ran clean
    </span>
  );
}

export function DeployReviewDialog({
  notebookId,
  open,
  onOpenChange,
  onDeployed,
}: DeployReviewDialogProps) {
  const [diff, setDiff] = useState<NotebookDiff | null>(null);
  const [run, setRun] = useState<NotebookRunDetail | null>(null);
  const [firstDeploy, setFirstDeploy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDiff(null);
    setError(null);
    setFirstDeploy(false);

    void (async () => {
      try {
        const draft: NotebookJson = await notebooksApi.getById(notebookId);
        const deployed = await notebooksApi.deployedDocument(notebookId).catch(() => null);

        if (cancelled) return;
        if (!deployed) {
          setFirstDeploy(true);
          setDiff(null);
        } else {
          setDiff(diffNotebooks(deployed, draft));
        }

        const latest = await notebooksApi.getRun(notebookId, 'latest').catch(() => null);
        if (!cancelled) setRun(latest);
      } catch (err: unknown) {
        if (!cancelled) setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, notebookId]);

  const deploy = async () => {
    setIsDeploying(true);
    try {
      await notebooksApi.deploy(notebookId);
      onDeployed();
      onOpenChange(false);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] w-[92vw] h-[80vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b border-border bg-muted/20 shrink-0">
          <DialogTitle className="text-sm font-bold">Deploy this notebook?</DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground/80">
            Its triggers will run this version until you deploy again.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && <div className="text-xs text-status-error">{error}</div>}

          {firstDeploy && (
            <div className="text-xs text-muted-foreground">
              Nothing is deployed yet, so this is the whole notebook going live for the
              first time.
            </div>
          )}

          {diff?.isEmpty && (
            <div className="text-xs text-muted-foreground">
              The draft matches what is already deployed.
            </div>
          )}

          {diff && diff.settings.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
                Settings
              </h3>
              {diff.settings.map((change) => (
                <div key={change.what} className="text-[11px] border border-border px-3 py-2">
                  <div className="font-semibold mb-1">{change.what}</div>
                  <div className="font-mono text-[10px] text-status-error line-through opacity-70">
                    {change.before}
                  </div>
                  <div className="font-mono text-[10px] text-status-done">{change.after}</div>
                </div>
              ))}
            </section>
          )}

          {diff && diff.cells.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
                Cells ({diff.cells.length})
              </h3>
              {diff.cells.map((change) => (
                <div key={change.cellId} className={cn('border px-3 py-2', KIND_STYLES[change.kind])}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[9px] uppercase tracking-widest font-bold">
                      {change.kind}
                    </span>
                    <span className="text-[11px] text-foreground truncate flex-1" title={change.label}>
                      {change.label}
                    </span>
                    {change.author && (
                      <span className="text-[10px] text-muted-foreground/70 shrink-0">
                        {change.author.by}
                      </span>
                    )}
                    {change.kind !== 'removed' && (
                      <Evidence result={run?.cell_results?.[change.cellId]} />
                    )}
                  </div>

                  {change.before !== undefined && (
                    <pre className="whitespace-pre-wrap font-mono text-[10px] bg-status-error/5 px-2 py-1 opacity-70 overflow-x-auto">
                      {change.before || '(empty)'}
                    </pre>
                  )}
                  {change.after !== undefined && (
                    <pre className="whitespace-pre-wrap font-mono text-[10px] bg-status-done/5 px-2 py-1 overflow-x-auto">
                      {change.after || '(empty)'}
                    </pre>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground/70 flex-1">
            Evidence comes from the most recent run, not from whoever wrote the cell.
          </span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={deploy} disabled={isDeploying}>
            {isDeploying ? (
              <Spinner size={13} className="animate-spin mr-1.5" />
            ) : (
              <RocketLaunch size={13} className="mr-1.5" />
            )}
            Deploy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
