import { useEffect, useState } from 'react';
import { Play, Spinner } from '@phosphor-icons/react';
import type { NotebookPageAction, NotebookParam } from '@zaa-tool/shared';
import { Button } from '../../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { InputField } from './InputField';
import { initialValues, toArgs } from '../../../lib/app-inputs';


/**
 * The form of the notebook a button calls, shown where the button is.
 *
 * Nothing here is designed. The target already declares its inputs, and its own page
 * renders exactly this form from exactly this declaration — the only new idea is *when*
 * it appears. Before, a button that needed an answer had nowhere to ask, so the field had
 * to be added to the calling page instead, where it sat above Run forever among inputs
 * that had nothing to do with it.
 *
 * Same `InputField` as the page, the shared page and the editor's preview. A dialog that
 * rendered its own approximation of a form would be a second form to keep in step.
 */
interface ActionDialogProps {
  /** Where an attached file goes — only a target with a `file` input needs it. */
  notebookId?: string;
  shareToken?: string;
  action: NotebookPageAction | null;
  /**
   * The calling page's current values. A field the target and the page both name is
   * filled in from here — the answer is already on screen, and asking again for something
   * the reader can see is how a form starts feeling like paperwork.
   */
  pageValues: Record<string, string>;
  onCancel: () => void;
  onSubmit: (args: Record<string, unknown>) => Promise<void>;
}

/** Page values first, then the input's own default for anything the page does not name. */
function startingValues(asks: NotebookParam[], pageValues: Record<string, string>) {
  const own = initialValues(asks);
  const values: Record<string, string> = {};
  for (const input of asks) {
    values[input.name] = pageValues[input.name] ?? own[input.name] ?? '';
  }
  return values;
}

export function ActionDialog({ action, pageValues, notebookId, shareToken, onCancel, onSubmit }: ActionDialogProps) {
  const asks = action?.asks ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [isRunning, setIsRunning] = useState(false);

  // Reset per opening: yesterday's answer is not a sensible default for today's run.
  useEffect(() => {
    if (action) setValues(startingValues(action.asks ?? [], pageValues));
  }, [action, pageValues]);

  const submit = async () => {
    setIsRunning(true);
    try {
      await onSubmit(toArgs(asks, values));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Dialog open={action !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">{action?.label}</DialogTitle>
          <DialogDescription className="text-xs">
            Runs <span className="font-mono">{action?.notebook}</span>. What it asks for is
            what it declares.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {asks.map((input) => (
            <InputField
              key={input.name}
              input={input}
              value={values[input.name] ?? ''}
              onChange={(next) => setValues((current) => ({ ...current, [input.name]: next }))}
              notebookId={notebookId}
              shareToken={shareToken}
            />
          ))}
        </form>

        <DialogFooter>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" className="h-8 text-xs" disabled={isRunning} onClick={() => void submit()}>
            {isRunning ? (
              <Spinner size={13} className="mr-1.5 animate-spin" />
            ) : (
              <Play size={13} weight="fill" className="mr-1.5" />
            )}
            {action?.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
