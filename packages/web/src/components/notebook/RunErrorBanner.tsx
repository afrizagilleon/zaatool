import { Warning } from '@phosphor-icons/react';

interface RunErrorBannerProps {
  error: string;
  /** Cell or parallel group the run failed in, if the engine reported one. */
  cellId: string | null;
  /** Human label for that step — "Cell 3", a lane name — rather than a raw id. */
  label: string | null;
  onJumpTo: (stepId: string) => void;
}

/**
 * The engine sends the failing step's id as its own field rather than splicing it
 * into the message, so the failure can be shown as something readable that jumps to
 * the step instead of a bare uuid the reader has to match up by hand.
 */
export function RunErrorBanner({ error, cellId, label, onJumpTo }: RunErrorBannerProps) {
  return (
    <div className="flex items-start gap-2 px-4 py-2 text-xs border-b border-status-error/40 bg-status-error/5 shrink-0">
      <Warning size={13} weight="fill" className="text-status-error shrink-0 mt-0.5" />

      {cellId && label && (
        <button
          type="button"
          onClick={() => onJumpTo(cellId)}
          className="shrink-0 px-1.5 font-semibold text-status-error underline decoration-dotted hover:decoration-solid"
          title="Jump to this step"
        >
          {label}
        </button>
      )}

      <span className="text-status-error break-words min-w-0">{error}</span>
    </div>
  );
}
