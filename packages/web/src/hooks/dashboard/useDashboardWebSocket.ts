import { useRef, useEffect, useCallback } from 'react';
import type { RunSubscribeMessage } from '@zaa-tool/shared';
import { WS_BASE_URL } from '../../lib/api.js';

interface UseDashboardWebSocketParams {
  graphRef: React.MutableRefObject<any>;
  setExecutingNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setNodeData: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  setFormInputs: React.Dispatch<React.SetStateAction<Record<string, Record<string, any>>>>;
}

const RECONNECT_DELAY_MS = 3000;

/**
 * Streams the results of runs this dashboard started.
 *
 * A dashboard can have several runs in flight at once (a form submit, a table
 * selection, a file upload), so it tracks a set of run ids and subscribes to
 * each. Runs started by anyone else — including other visitors of the same
 * dashboard — are never delivered here.
 */
export function useDashboardWebSocket({
  graphRef,
  setExecutingNodes,
  setNodeData,
  setFormInputs,
}: UseDashboardWebSocketParams) {
  const wsRef = useRef<WebSocket | null>(null);
  const activeRunIdsRef = useRef<Set<string>>(new Set());

  const sendSubscribe = useCallback((runId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const message: RunSubscribeMessage = { action: 'subscribe', runId };
    ws.send(JSON.stringify(message));
  }, []);

  /** Called by the dashboard actions with the run id returned by each trigger. */
  const subscribeToRun = useCallback(
    (runId: string) => {
      activeRunIdsRef.current.add(runId);
      sendSubscribe(runId);
    },
    [sendSubscribe],
  );

  useEffect(() => {
    let disposed = false;

    const connectWs = () => {
      if (disposed) return;

      const ws = new WebSocket(WS_BASE_URL);
      wsRef.current = ws;

      // A reconnect drops the server-side subscriptions, so re-register every
      // run that hasn't reported back yet.
      ws.onopen = () => {
        for (const runId of activeRunIdsRef.current) sendSubscribe(runId);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { type, runId, nodeId, output, error: nodeErr } = data;

          if (!runId || !activeRunIdsRef.current.has(runId)) return;

          if (type === 'node:start' && nodeId) {
            setExecutingNodes((prev) => ({ ...prev, [nodeId]: true }));
          } else if (type === 'node:done' && nodeId) {
            setExecutingNodes((prev) => ({ ...prev, [nodeId]: false }));
            if (output) {
              setNodeData((prev) => {
                const current = prev[nodeId] || {};
                let nextNodeData: Record<string, any> = {
                  ...prev,
                  [nodeId]: { ...current, outputs: output },
                };

                if (graphRef.current?.edges) {
                  const outgoingEdges = graphRef.current.edges.filter((e: any) => e.source === nodeId);
                  for (const edge of outgoingEdges) {
                    const targetNodeId = edge.target;
                    const targetNodeData = nextNodeData[targetNodeId] || {};
                    const currentInputs = targetNodeData.inputs || {};
                    const nextInputs = {
                      ...currentInputs,
                      [edge.targetHandle]: output[edge.sourceHandle],
                    };
                    nextNodeData = {
                      ...nextNodeData,
                      [targetNodeId]: { ...targetNodeData, inputs: nextInputs },
                    };

                    if (targetNodeData.type === 'ui:input' && edge.targetHandle.startsWith('value_')) {
                      const fieldId = edge.targetHandle.replace('value_', '');
                      setFormInputs((prevForm) => ({
                        ...prevForm,
                        [targetNodeId]: {
                          ...(prevForm[targetNodeId] || {}),
                          [fieldId]: output[edge.sourceHandle],
                        },
                      }));
                    }
                  }
                }

                return nextNodeData;
              });

              if (output.values) {
                setFormInputs((prev) => ({
                  ...prev,
                  [nodeId]: { ...(prev[nodeId] || {}), ...output.values },
                }));
              }
            }
          } else if (type === 'node:error' && nodeId) {
            setExecutingNodes((prev) => ({ ...prev, [nodeId]: false }));
            console.error(`Node ${nodeId} execution error:`, nodeErr);
          } else if (type === 'flow:done' || type === 'flow:error') {
            activeRunIdsRef.current.delete(runId);
            setExecutingNodes({});
          }
        } catch {
          // Silent JSON parsing error
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setTimeout(connectWs, RECONNECT_DELAY_MS);
      };
    };

    connectWs();

    return () => {
      disposed = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [graphRef, sendSubscribe, setExecutingNodes, setNodeData, setFormInputs]);

  return { subscribeToRun };
}
