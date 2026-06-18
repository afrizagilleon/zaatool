import { useRef, useEffect } from 'react';
import { WS_BASE_URL } from '../../lib/api.js';

interface UseDashboardWebSocketParams {
  flowId: string;
  graphRef: React.MutableRefObject<any>;
  setExecutingNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setNodeData: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  setFormInputs: React.Dispatch<React.SetStateAction<Record<string, Record<string, any>>>>;
}

export function useDashboardWebSocket({
  flowId,
  graphRef,
  setExecutingNodes,
  setNodeData,
  setFormInputs,
}: UseDashboardWebSocketParams) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const connectWs = () => {
      const ws = new WebSocket(WS_BASE_URL);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { type, nodeId, output, error: nodeErr } = data;

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
          } else if (type === 'flow:done') {
            setExecutingNodes({});
          }
        } catch {
          // Silent JSON parsing error
        }
      };

      ws.onclose = () => {
        setTimeout(connectWs, 3000);
      };
    };

    connectWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);
}
