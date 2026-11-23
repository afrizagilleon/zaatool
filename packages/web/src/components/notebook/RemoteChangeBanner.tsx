import { useState } from 'react';
import { Info, Warning } from '@phosphor-icons/react';
import { Button } from '../ui/button';

interface RemoteChangeBannerProps {
  /** Set when there are unsaved edits that a reload would discard. */
  change: { revision: number; by: string } | null;
  /** Set when the copy was refreshed on its own. */
  notice: string | null;
  onReload: () => Promise<void>;
  onDismissNotice: () => void;
}

/**
 * Tells the open editor that the notebook was saved somewhere else.
 *
 * Non-blocking by design — nothing is refused yet, and the person's edits are untouched.
 * Styled like the save-conflict banner it leads up to, in amber rather than red because it
 * is a warning, not a failure.
 */
export function RemoteChangeBanner({ change, notice, onReload, onDismissNotice }: RemoteChangeBannerProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (change) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-start gap-2 px-4 py-2 text-xs border-b border-amber-500/40 bg-amber-500/5 shrink-0"
      >
        <Warning size={13} weight="fill" className="text-amber-500 shrink-0 mt-0.5" />
        <span className="text-amber-500 break-words min-w-0 flex-1">
          This notebook was changed elsewhere (revision {change.revision}, by {change.by}). Reload to see it, or keep
          editing — saving will ask you to resolve the conflict.
          {failure ? ` ${failure}` : ''}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[11px]"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setFailure(null);
            onReload()
              .catch((err: unknown) => setFailure((err as Error).message))
              .finally(() => setBusy(false));
          }}
        >
          Reload
        </Button>
      </div>
    );
  }

  if (notice) {
    return (
      <div role="status" className="flex items-center gap-2 px-4 py-1.5 text-[11px] border-b border-border bg-muted/40 shrink-0">
        <Info size={12} className="text-muted-foreground shrink-0" />
        <span className="text-muted-foreground flex-1">{notice}</span>
        <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" onClick={onDismissNotice}>
          Dismiss
        </Button>
      </div>
    );
  }
  return null;
}
