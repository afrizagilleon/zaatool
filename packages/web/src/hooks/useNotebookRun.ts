import { useCallback, useEffect, useRef } from 'react';
import { useNotebookStore } from '../store/notebookStore.js';
import { notebooksApi } from '../lib/notebooks-api.js';
import { connectRunSocket, subscribeToRun } from '../lib/run-socket.js';
import { scopeBefore } from '../lib/notebook-scope-replay.js';

/**
 * Saves the notebook, starts a run, and streams its result back into the store.
 *
 * Saving first is deliberate: the engine executes the stored document, so
 * running without saving would show results for code that is no longer on
 * screen — the exact confusion the fresh/stale indicator exists to prevent.
 */
export function useNotebookRun() {
  const wsRef = useRef<WebSocket | null>(null);
  const runIdRef = useRef<string | null>(null);
  /** Guards the window between the click and the run id arriving. */
  const startingRef = useRef(false);

  const closeSocket = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    runIdRef.current = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }, []);

  useEffect(() => closeSocket, [closeSocket]);

  const save = useCallback(async (): Promise<string> => {
    const store = useNotebookStore.getState();
    store.setSaving(true);
    try {
      const { id } = await notebooksApi.save(store.getDocument());
      store.markSaved(id);
      return id;
    } catch (err) {
      store.setSaving(false);
      throw err;
    }
  }, []);

  /** Runs the whole notebook, or just `cellId` seeded with the scope above it. */
  const run = useCallback(async (cellId?: string) => {
    const store = useNotebookStore.getState();
    if (store.isRunning || startingRef.current) return;
    startingRef.current = true;

    closeSocket();

    let notebookId: string;
    try {
      notebookId = await save();
    } catch (err) {
      startingRef.current = false;
      store.finishRun(`Failed to save: ${(err as Error).message}`);
      return;
    }

    const ws = connectRunSocket(
      (event) => {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        // A socket outlives the run it was opened for; ignore anything else.
        if (data.runId !== runIdRef.current) return;

        const state = useNotebookStore.getState();
        const cellId = data.cellId as string | undefined;

        switch (data.type) {
          case 'cell:start':
            if (cellId) state.markCellRunning(cellId);
            break;
          case 'cell:log':
            if (cellId) {
              state.appendCellLog(cellId, {
                level: String(data.level ?? 'info'),
                msg: String(data.payload ?? ''),
              });
            }
            break;
          case 'cell:done':
            if (cellId) {
              state.markCellDone(
                cellId,
                (data.output ?? {}) as Record<string, unknown>,
                (data.written ?? []) as string[],
                Number(data.ms ?? 0)
              );
            }
            break;
          case 'cell:error':
            if (cellId) state.markCellError(cellId, String(data.error ?? 'Unknown error'), Number(data.ms ?? 0));
            break;
          case 'run:done':
            startingRef.current = false;
            state.finishRun();
            closeSocket();
            break;
          case 'run:error':
            startingRef.current = false;
            state.finishRun(
              String(data.error ?? 'Run failed'),
              typeof data.cellId === 'string' ? data.cellId : undefined
            );
            closeSocket();
            break;
        }
      },
      () => {
        startingRef.current = false;
        if (useNotebookStore.getState().isRunning) {
          useNotebookStore.getState().finishRun('Connection to the engine closed');
        }
      },
      () => {
        startingRef.current = false;
        useNotebookStore.getState().finishRun('WebSocket connection error');
      }
    );

    wsRef.current = ws;

    ws.onopen = async () => {
      try {
        const current = useNotebookStore.getState();
        const { runId } = await notebooksApi.run(notebookId, {
          cellId,
          // Running one cell replays the scope the cells above produced, so no
          // live kernel is needed to pick up mid-notebook.
          input: cellId ? scopeBefore(current.steps, current.cellRuns, cellId) : undefined,
          // Declared inputs are bound by the engine, so the editor sends what the
          // author typed and lets the contract judge it — same path a caller takes.
          args: current.inputs.length > 0 ? current.testArgs : undefined,
        });
        runIdRef.current = runId;
        useNotebookStore.getState().startRun(runId, cellId);
        // Events emitted before this point are replayed by the engine.
        subscribeToRun(ws, runId);
      } catch (err) {
        startingRef.current = false;
        useNotebookStore.getState().finishRun((err as Error).message);
        closeSocket();
      }
    };
  }, [closeSocket, save]);

  const runAll = useCallback(() => run(), [run]);

  return { run, runAll, save };
}
