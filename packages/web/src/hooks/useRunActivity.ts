import { useEffect, useRef, useState } from 'react';
import type { RunActivityEvent, RunWatchMessage } from '@zaa-tool/shared';
import { WS_BASE_URL } from '../lib/api.js';

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
 */
export function useRunActivity(enabled: boolean): Record<string, NotebookActivityState> {
  const [activity, setActivity] = useState<Record<string, NotebookActivityState>>({});
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled) return;

    const socket = new WebSocket(WS_BASE_URL);
    const pending = timers.current;

    const forget = (flowId: string) => {
      const existing = pending.get(flowId);
      if (existing) {
        window.clearTimeout(existing);
        pending.delete(flowId);
      }
    };

    socket.onopen = () => {
      const message: RunWatchMessage = { action: 'watch' };
      socket.send(JSON.stringify(message));
    };

    socket.onmessage = (event) => {
      let parsed: RunActivityEvent;
      try {
        parsed = JSON.parse(event.data as string) as RunActivityEvent;
      } catch {
        return;
      }
      if (parsed.type !== 'run:activity' || !parsed.flowId) return;

      if (parsed.status === 'running') {
        forget(parsed.flowId);
        setActivity((current) =>
          current[parsed.flowId]?.status === 'running' && current[parsed.flowId]?.runId === parsed.runId
            ? current
            : { ...current, [parsed.flowId]: { status: 'running', runId: parsed.runId } }
        );
        return;
      }

      const settled: NotebookActivity = parsed.status === 'success' ? 'done' : 'error';
      setActivity((current) => ({
        ...current,
        [parsed.flowId]: { status: settled, runId: parsed.runId },
      }));

      forget(parsed.flowId);
      pending.set(
        parsed.flowId,
        window.setTimeout(() => {
          setActivity((current) => {
            const { [parsed.flowId]: _removed, ...rest } = current;
            return rest;
          });
          pending.delete(parsed.flowId);
        }, SETTLE_MS)
      );
    };

    return () => {
      socket.close();
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, [enabled]);

  return activity;
}
