import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotebookOutput } from '@zaa-tool/shared';
import { authenticateSocket, connectRunSocket, subscribeToRun } from '../lib/run-socket.js';
import { notebooksApi } from '../lib/notebooks-api';

/**
 * A page that fills in as its notebook runs.
 *
 * A run used to be one request that returned everything at the end, so a notebook whose
 * fifth cell was slow showed a spinner and nothing else — even though its first cell had
 * produced a table twenty seconds earlier. Every cell already announces what it wrote
 * (`cell:done` carries `written`), so each output can appear the moment the cell that
 * produced it finishes.
 *
 * Two consequences beyond speed, and both are about honesty:
 *
 *  - **A failure no longer empties the page.** Outputs that were produced stay readable;
 *    only the ones that were not are marked failed.
 *  - **Re-running does not blank anything.** The previous values stay on screen, dimmed,
 *    until their replacements arrive — no skeleton flash and no jumping layout.
 */

/**
 * `stale` is the one that earns its place: it means "there is a value on screen, but it
 * belongs to the previous run". Without it a re-run shows old numbers that look current,
 * which is worse than showing nothing.
 */
export type OutputStatus = 'idle' | 'waiting' | 'stale' | 'running' | 'ready' | 'failed';

export interface PageRunState {
  /** Per declared output name. */
  status: Record<string, OutputStatus>;
  values: Record<string, unknown>;
  isRunning: boolean;
  /** Set when the run itself could not start — a contract refusal, say. */
  error: string | null;
  /** True while a re-run is replacing values that are still on screen. */
  isStale: boolean;
}

interface CellEvent {
  type?: string;
  cellId?: string;
  written?: string[];
  output?: Record<string, unknown>;
  error?: string;
  status?: string;
}

export function usePageRun(notebookId: string, outputs: NotebookOutput[]) {
  const names = outputs.map((output) => output.name);

  const [runId, setRunId] = useState<string | null>(null);
  const [state, setState] = useState<PageRunState>({
    status: {},
    values: {},
    isRunning: false,
    error: null,
    isStale: false,
  });

  /**
   * Which cell wrote which output last time.
   *
   * Only a hint — it is what lets an output say "working on it" the moment its cell
   * starts, rather than staying blank until the cell finishes. On the first run there is
   * nothing to go on, so outputs simply wait, which is honest too.
   */
  const writersRef = useRef<Record<string, string[]>>({});
  /** Names a cell has written since this run started, so the rest can be nulled at the end. */
  const freshRef = useRef<Set<string>>(new Set());

  const start = useCallback(
    async (args: Record<string, unknown>) => {
      setState((current) => ({
        ...current,
        error: null,
        isRunning: true,
        // Keep whatever is on screen; mark it as belonging to the previous run.
        isStale: Object.keys(current.values).length > 0,
        status: Object.fromEntries(
          names.map((name) => [name, current.values[name] !== undefined ? 'stale' : 'waiting'])
        ),
      }));

      freshRef.current = new Set();

      try {
        const started = await notebooksApi.runDeployed(notebookId, args);
        setRunId(started.runId);
      } catch (err: unknown) {
        setState((current) => ({
          ...current,
          isRunning: false,
          isStale: false,
          error: (err as Error).message,
          status: Object.fromEntries(names.map((name) => [name, 'idle' as OutputStatus])),
        }));
      }
    },
    [notebookId, names.join(',')] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (!runId) return;

    const socket = connectRunSocket(
      (message) => {
        let event: CellEvent;
        try {
          event = JSON.parse(message.data as string) as CellEvent;
        } catch {
          return;
        }

        setState((current) => {
          const status = { ...current.status };
          const values = { ...current.values };

          if (event.type === 'cell:start' && event.cellId) {
            for (const name of writersRef.current[event.cellId] ?? []) {
              if (names.includes(name)) status[name] = 'running';
            }
            return { ...current, status, values };
          }

          if (event.type === 'cell:done' && event.cellId) {
            writersRef.current[event.cellId] = event.written ?? [];
            for (const name of event.written ?? []) {
              if (!names.includes(name)) continue;
              freshRef.current.add(name);
              status[name] = 'ready';
              values[name] = event.output?.[name];
            }
            return { ...current, status, values };
          }

          if (event.type === 'cell:error' && event.cellId) {
            for (const name of writersRef.current[event.cellId] ?? []) {
              if (names.includes(name)) status[name] = 'failed';
            }
            return { ...current, status, values, error: event.error ?? current.error };
          }

          if (event.type === 'run:done' || event.type === 'run:error') {
            // A declared name no cell ever wrote comes back as null from the contract,
            // and the page should say the same rather than wait for it forever.
            for (const name of names) {
              if (freshRef.current.has(name)) continue;

              if (event.type === 'run:error') {
                status[name] = 'failed';
                continue;
              }
              // No cell wrote it this time, so the contract hands back null — and a
              // value left over from the previous run would be a quiet lie.
              status[name] = 'ready';
              values[name] = null;
            }
            return {
              ...current,
              status,
              values,
              isRunning: false,
              isStale: false,
              error: event.type === 'run:error' ? (event.error ?? 'The run failed.') : current.error,
            };
          }

          return current;
        });
      },
      () => {},
      () => {}
    );

    socket.onopen = () => {
      authenticateSocket(socket);
      subscribeToRun(socket, runId);
    };

    return () => {
      socket.onclose = null;
      socket.close();
    };
    // `names` is stable for a given page; joining keeps the effect from resubscribing
    // on every render.
  }, [runId, names.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, start };
}
