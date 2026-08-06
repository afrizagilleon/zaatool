import { useEffect, useRef, useState } from 'react';
import { watchRunActivity } from '../lib/watch-socket.js';

/** How long a finished notebook keeps its colour before fading back to idle. */
const SETTLE_MS = 4000;

export type NotebookActivity = 'running' | 'done' | 'error';

export interface NotebookActivityState {
  status: NotebookActivity;
  /**
   * The run behind it.
   *
   * Carried so a view that is *already looking* at this notebook can open the ordinary
   * per-run subscription and see individual cells. That channel is authorised by
   * holding the run id, which is exactly what this hands over.
   */
  runId: string;
}

/**
 * What is running right now, anywhere.
 *
 * The map cannot use the ordinary per-run subscription, because that needs a run id the
 * client got from starting the run. The runs worth watching here are the ones nobody in
 * this browser started: a cron at 3am, an agent working over MCP. So the socket asks to
 * watch, and the engine sends lifecycle only.
 *
 * The connection is not this hook's any more. It used to open its own, which was fine
 * while the map was the only thing watching and stopped being fine the moment the lists
 * wanted the same channel — see `watch-socket.ts`, which also survives losing it.
 */
export function useRunActivity(enabled: boolean): Record<string, NotebookActivityState> {
  const [activity, setActivity] = useState<Record<string, NotebookActivityState>>({});
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled) return;

    const pending = timers.current;

    const forget = (notebookId: string) => {
      const existing = pending.get(notebookId);
      if (existing) {
        window.clearTimeout(existing);
        pending.delete(notebookId);
      }
    };

    const stopWatching = watchRunActivity((parsed) => {
      if (parsed.status === 'running') {
        forget(parsed.notebookId);
        setActivity((current) =>
          current[parsed.notebookId]?.status === 'running' && current[parsed.notebookId]?.runId === parsed.runId
            ? current
            : { ...current, [parsed.notebookId]: { status: 'running', runId: parsed.runId } }
        );
        return;
      }

      const settled: NotebookActivity = parsed.status === 'success' ? 'done' : 'error';
      setActivity((current) => ({
        ...current,
        [parsed.notebookId]: { status: settled, runId: parsed.runId },
      }));

      forget(parsed.notebookId);
      pending.set(
        parsed.notebookId,
        window.setTimeout(() => {
          setActivity((current) => {
            const { [parsed.notebookId]: _removed, ...rest } = current;
            return rest;
          });
          pending.delete(parsed.notebookId);
        }, SETTLE_MS)
      );
    });

    return () => {
      stopWatching();
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, [enabled]);

  return activity;
}
