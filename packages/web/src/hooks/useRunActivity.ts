import { useEffect, useRef, useState } from 'react';
import type { RunActivityEvent, RunWatchMessage } from '@zaa-tool/shared';
import { WS_BASE_URL } from '../lib/api.js';

/** How long a finished notebook keeps its colour before fading back to idle. */
const SETTLE_MS = 4000;

export type NotebookActivity = 'running' | 'done' | 'error';

/**
 * What is running right now, anywhere.
 *
 * The map cannot use the ordinary per-run subscription, because that needs a run id the
 * client got from starting the run. The runs worth watching here are the ones nobody in
 * this browser started: a cron at 3am, an agent working over MCP. So the socket asks to
 * watch, and the engine sends lifecycle only.
 */
export function useRunActivity(enabled: boolean): Record<string, NotebookActivity> {
  const [activity, setActivity] = useState<Record<string, NotebookActivity>>({});
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled) return;

    const socket = new WebSocket(WS_BASE_URL);
    const clearLater = (flowId: string) => {
      const existing = timers.current.get(flowId);
      if (existing) window.clearTimeout(existing);
      timers.current.set(
        flowId,
        window.setTimeout(() => {
          setActivity((current) => {
            const { [flowId]: _removed, ...rest } = current;
            return rest;
          });
          timers.current.delete(flowId);
        }, SETTLE_MS)
      );
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
        const existing = timers.current.get(parsed.flowId);
        if (existing) {
          window.clearTimeout(existing);
          timers.current.delete(parsed.flowId);
        }
        setActivity((current) =>
          current[parsed.flowId] === 'running' ? current : { ...current, [parsed.flowId]: 'running' }
        );
        return;
      }

      const settled: NotebookActivity = parsed.status === 'success' ? 'done' : 'error';
      setActivity((current) => ({ ...current, [parsed.flowId]: settled }));
      clearLater(parsed.flowId);
    };

    const pending = timers.current;
    return () => {
      socket.close();
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, [enabled]);

  return activity;
}
