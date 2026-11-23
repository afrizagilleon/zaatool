import { useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import { Button } from '../ui/button';

interface SaveConflictBannerProps {
  message: string;
  /** Opens what is stored now, discarding this copy. */
  onReload: () => Promise<void>;
  /** Saves this copy over what is stored, losing the other person's changes. */
  onOverwrite: () => Promise<void>;
}

/**
 * Shown when a save was refused because somebody else saved the notebook first.
 *
 * Both ways out are a choice the person makes with the facts in front of them. Nothing is
 * saved until they do, so the editor can never replace someone's work without being told.
 */
export function SaveConflictBanner({ message, onReload, onOverwrite }: SaveConflictBannerProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (err: unknown) {
      setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-2 px-4 py-2 text-xs border-b border-status-error/40 bg-status-error/5 shrink-0"
    >
      <Warning size={13} weight="fill" className="text-status-error shrink-0 mt-0.5" />
      <span className="text-status-error break-words min-w-0 flex-1">
        {message} Your edits are still here and have not been saved.
        {failure ? ` ${failure}` : ''}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-[11px]"
        disabled={busy}
        onClick={() => void act(onReload)}
      >
        Reload theirs
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-[11px]"
        disabled={busy}
        onClick={() => void act(onOverwrite)}
      >
        Save mine anyway
      </Button>
    </div>
  );
}
