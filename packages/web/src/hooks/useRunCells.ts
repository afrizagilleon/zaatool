import { useEffect, useState } from 'react';
import { authenticateSocket, connectRunSocket, subscribeToRun } from '../lib/run-socket.js';

export type CellActivity = 'running' | 'done' | 'error';

/**
 * Which cells of one run are busy, finished or broken.
 *
 * Uses the ordinary per-run channel — the one authorised by holding the run id — so
 * unlike the workspace-wide watch it is allowed to carry cell identity. The map gets
 * the id from `useRunActivity`, which is how a run this browser never started can still
 * be followed cell by cell.
 *
 * The hub replays a run's events to a late subscriber, so joining halfway through still
 * shows the cells that have already finished.
 */
export function useRunCells(runId: string | undefined): Record<string, CellActivity> {
  const [cells, setCells] = useState<Record<string, CellActivity>>({});

  useEffect(() => {
    setCells({});
    if (!runId) return;

    const socket = connectRunSocket(
      (message) => {
        let event: { type?: string; cellId?: string };
        try {
          event = JSON.parse(message.data as string);
        } catch {
          return;
        }
        if (typeof event.cellId !== 'string') return;

        const status: CellActivity | null =
          event.type === 'cell:start'
            ? 'running'
            : event.type === 'cell:done'
              ? 'done'
              : event.type === 'cell:error'
                ? 'error'
                : null;
        if (!status) return;

        const cellId = event.cellId;
        setCells((current) => (current[cellId] === status ? current : { ...current, [cellId]: status }));
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
  }, [runId]);

  return cells;
}
