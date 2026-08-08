import { useCallback, useEffect, useState } from 'react';
import { Copy, Check, Trash, Lock, Spinner, WarningCircle } from '@phosphor-icons/react';
import type { NotebookShare } from '@zaa-tool/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { notebooksApi } from '../../lib/notebooks-api';

/**
 * Handing a page to someone who has no account here.
 *
 * The link is the credential, so it is shown once, at the moment it is made, and never
 * again — it is hashed at rest, and a link nobody kept has to be revoked and reissued.
 * Saying that plainly beats letting someone discover it when they come back for it.
 *
 * A password is optional and separate on purpose: the link is the part you can forward
 * by accident, the password is the part you say out loud.
 */

function shareUrl(token: string): string {
  return `${window.location.origin}/a/${token}`;
}

export function ShareDialog({
  notebookId,
  notebookName,
  open,
  onOpenChange,
}: {
  notebookId: string;
  notebookName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [shares, setShares] = useState<NotebookShare[]>([]);
  const [password, setPassword] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setShares(await notebooksApi.shares(notebookId));
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, [notebookId]);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      // The one-time token must not still be on screen the next time this opens.
      setFresh(null);
      setPassword('');
      setError(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    notebooksApi
      .shares(notebookId)
      .then((data) => {
        if (!cancelled) setShares(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, notebookId]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const share = await notebooksApi.createShare(notebookId, password || undefined);
      setFresh(share.token ?? null);
      setPassword('');
      await refresh();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (shareId: string) => {
    try {
      await notebooksApi.revokeShare(notebookId, shareId);
      await refresh();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Share “{notebookName}”</DialogTitle>
          <DialogDescription className="text-xs">
            Anyone with the link can run the deployed version and see its results. They
            cannot read or change the notebook.
          </DialogDescription>
        </DialogHeader>

        {fresh && (
          <div className="space-y-1.5 border border-status-done/40 bg-status-done/5 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Copy it now — it is not shown again
            </p>
            <div className="flex items-center gap-1">
              <code className="min-w-0 flex-1 truncate bg-muted px-2 py-1 font-mono text-[11px]">
                {shareUrl(fresh)}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                title="Copy"
                onClick={() => {
                  void navigator.clipboard.writeText(shareUrl(fresh)).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? <Check size={12} className="text-status-done" /> : <Copy size={12} />}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Password (optional)
            </span>
            <Input
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Leave empty for link-only"
              className="h-8 text-xs"
            />
          </label>
          <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={() => void create()}>
            {busy && <Spinner size={12} className="mr-1.5 animate-spin" />}
            Create link
          </Button>
        </div>

        {error && (
          <p className="flex items-start gap-1.5 text-xs text-status-error">
            <WarningCircle size={13} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        {shares.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Active links
            </p>
            {shares.map((share) => (
              <div
                key={share.id}
                className="flex items-center gap-2 border border-border px-2 py-1.5 text-[11px]"
              >
                {share.hasPassword && (
                  <span className="shrink-0 text-muted-foreground" title="Password set">
                    <Lock size={11} />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {new Date(share.createdAt).toLocaleString()}
                  {share.createdBy && ` · ${share.createdBy}`}
                </span>
                <span className="shrink-0 text-muted-foreground/70">
                  {share.runCount === 0
                    ? 'never used'
                    : `${share.runCount} run${share.runCount === 1 ? '' : 's'}`}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-status-error"
                  title="Revoke this link"
                  onClick={() => void revoke(share.id)}
                >
                  <Trash size={11} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
