import { useState } from 'react';
import {
  ArrowClockwise,
  ArrowSquareOut,
  CheckCircle,
  Play,
  Spinner,
  WarningCircle,
} from '@phosphor-icons/react';
import type { NotebookAction } from '@zaa-tool/shared';
import { Button } from '../../ui/button';

/**
 * The buttons a notebook declared.
 *
 * Three verbs, each of which already existed: run this again, run something else, go
 * there. A button is a shorter path to something, never a new capability — which is what
 * keeps a page from growing into a form builder with an event model.
 *
 * `run` reports and does not display. The other notebook says whether it worked, in one
 * line that clears itself; its outputs stay on its own page, where they are labelled.
 */

type ActionState =
  | { kind: 'idle' }
  | { kind: 'running'; index: number }
  | { kind: 'done'; index: number; message: string; failed: boolean };

interface PageActionsProps {
  actions: NotebookAction[];
  /** Runs the page's own notebook again with whatever is in the form now. */
  onRerun: () => void;
  /**
   * Presses a `run` button, by its position in the list. Absent on a shared page, where
   * the server has already removed every `run` action — so this renders nothing extra
   * rather than a button that would fail.
   */
  onRun?: (index: number) => Promise<{ notebook: string; status: string; errors?: string[] }>;
  disabled?: boolean;
}

export function PageActions({ actions, onRerun, onRun, disabled }: PageActionsProps) {
  const [state, setState] = useState<ActionState>({ kind: 'idle' });

  if (actions.length === 0) return null;

  const press = async (action: NotebookAction, index: number) => {
    if (action.do === 'rerun') return onRerun();

    if (action.do === 'link') {
      // `noopener` on every one: a page can be shared, and the target should never get a
      // handle on the window it came from.
      window.open(action.url, '_blank', 'noopener,noreferrer');
      return;
    }

    if (!onRun) return;
    setState({ kind: 'running', index });
    try {
      const result = await onRun(index);
      const failed = result.status !== 'success';
      setState({
        kind: 'done',
        index,
        failed,
        message: failed
          ? (result.errors?.[0] ?? `${result.notebook} failed.`)
          : `${result.notebook} ran.`,
      });
    } catch (err) {
      setState({ kind: 'done', index, failed: true, message: (err as Error).message });
    }
    window.setTimeout(() => setState({ kind: 'idle' }), 6000);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      {actions.map((action, index) => {
        const isRunning = state.kind === 'running' && state.index === index;
        return (
          <Button
            key={`${action.do}-${action.label}-${index}`}
            variant="outline"
            size="sm"
            // `max-w-full` plus a truncating label: a button is `whitespace-nowrap`, so
            // "Verify open.er-api.com" on a phone used to run 44px past the edge of its
            // own row and get clipped. Labels are written by an agent and can be any
            // length, so the button has to survive one rather than assume it is short.
            className="h-8 max-w-full min-w-0 shrink px-3 text-xs"
            disabled={disabled || isRunning}
            onClick={() => void press(action, index)}
            title={
              action.do === 'link'
                ? `${action.label} — ${action.url}`
                : action.do === 'run'
                  ? `${action.label} — runs ${action.notebook}`
                  : `${action.label} — runs this page again`
            }
          >
            {isRunning ? (
              <Spinner size={13} className="mr-1.5 shrink-0 animate-spin" />
            ) : action.do === 'rerun' ? (
              <ArrowClockwise size={13} className="mr-1.5 shrink-0" />
            ) : action.do === 'link' ? (
              <ArrowSquareOut size={13} className="mr-1.5 shrink-0" />
            ) : (
              <Play size={13} weight="fill" className="mr-1.5 shrink-0" />
            )}
            <span className="truncate">{action.label}</span>
          </Button>
        );
      })}

      {state.kind === 'done' && (
        // `basis-full` puts it on its own line inside this block rather than stretching
        // the row it sits in, so nothing beside it moves when a button reports back.
        <span
          className={
            state.failed
              ? 'flex basis-full items-center gap-1.5 text-xs text-status-error'
              : 'flex basis-full items-center gap-1.5 text-xs text-muted-foreground'
          }
        >
          {state.failed ? (
            <WarningCircle size={13} weight="fill" />
          ) : (
            <CheckCircle size={13} weight="fill" />
          )}
          {state.message}
        </span>
      )}
    </div>
  );
}
