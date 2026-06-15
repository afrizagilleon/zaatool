import { create } from 'zustand';
import type { GraphJson } from '@zaa-tool/shared';
import { useFlowStore } from './flowStore.js';
import { EngineClient } from '../lib/engine-client.js';
import { API_BASE_URL } from '../lib/api.js';

export interface LogEntry {
  id: string;
  timestamp: number;
  type: 'node:start' | 'node:log' | 'node:done' | 'node:error' | 'flow:done' | 'system';
  nodeId?: string;
  message: string;
  duration?: number;
  payload?: unknown;
}

export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

interface EngineState {
  logs: LogEntry[];
  isRunning: boolean;
  wsConnected: boolean;
  nodeStatuses: Record<string, NodeStatus>;
  activeHandles: Record<string, string[]>;

  clearLogs: () => void;
  runFlow: (graph: GraphJson, startNodeId?: string) => void;
  resetNodeStatuses: () => void;
}

let logIdCounter = 0;
const createLogEntry = (
  type: LogEntry['type'],
  message: string,
  nodeId?: string,
  extra?: Partial<LogEntry>,
): LogEntry => ({
  id: `log_${Date.now()}_${logIdCounter++}`,
  timestamp: Date.now(),
  type,
  nodeId,
  message,
  ...extra,
});

export const useEngineStore = create<EngineState>((set, get) => ({
  logs: [],
  isRunning: false,
  wsConnected: false,
  nodeStatuses: {},
  activeHandles: {},

  clearLogs: () => set({ logs: [] }),

  resetNodeStatuses: () => set({ nodeStatuses: {}, activeHandles: {} }),

  runFlow: async (graph: GraphJson, startNodeId?: string) => {
    const initialStatuses: Record<string, NodeStatus> = {};
    graph.nodes.forEach((n) => {
      initialStatuses[n.id] = 'idle';
    });

    set({
      logs: [createLogEntry('system', startNodeId ? `Connecting to engine starting from ${startNodeId}…` : 'Connecting to engine…')],
      isRunning: true,
      nodeStatuses: initialStatuses,
      activeHandles: {},
    });

    try {
      const ws = EngineClient.connectWebSocket(
        (event) => {
          try {
            const data = JSON.parse(event.data);
            const eventType: string = data.event || data.type || 'system';
            const nodeId: string | undefined = data.nodeId;

            switch (eventType) {
              case 'node:start': {
                set((state) => ({
                  logs: [
                    ...state.logs,
                    createLogEntry('node:start', `Node "${nodeId}" started`, nodeId),
                  ],
                  nodeStatuses: { ...state.nodeStatuses, ...(nodeId ? { [nodeId]: 'running' as const } : {}) },
                }));
                break;
              }

              case 'node:log': {
                const payload = data.payload ?? data.data ?? data.message ?? data.msg ?? '';
                const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
                set((state) => ({
                  logs: [
                    ...state.logs,
                    createLogEntry('node:log', msg, nodeId, { payload }),
                  ],
                }));
                break;
              }

              case 'node:done': {
                const duration = data.duration ?? data.elapsed;
                const nodeOutput = data.output ?? {};

                // Propagate outputs to downstream inputs
                if (nodeId) {
                  const flowStore = useFlowStore.getState();
                  flowStore.updateNodeData(nodeId, { outputs: nodeOutput });

                  const outgoingEdges = flowStore.edges.filter((e) => e.source === nodeId);
                  for (const edge of outgoingEdges) {
                    const targetNode = flowStore.nodes.find((n) => n.id === edge.target);
                    if (targetNode && edge.targetHandle && edge.sourceHandle) {
                      const currentInputs = targetNode.data.inputs || {};
                      const nextInputs = {
                        ...currentInputs,
                        [edge.targetHandle]: nodeOutput[edge.sourceHandle],
                      };
                      flowStore.updateNodeData(edge.target, { inputs: nextInputs });
                    }
                  }
                }

                set((state) => ({
                  logs: [
                    ...state.logs,
                    createLogEntry(
                      'node:done',
                      `Node "${nodeId}" completed${duration != null ? ` in ${duration}ms` : ''}`,
                      nodeId,
                      { duration },
                    ),
                  ],
                  nodeStatuses: { ...state.nodeStatuses, ...(nodeId ? { [nodeId]: 'done' as const } : {}) },
                  activeHandles: {
                    ...state.activeHandles,
                    ...(nodeId && (data.activeHandle || data.activeHandles)
                      ? { [nodeId]: [].concat(data.activeHandle || data.activeHandles) }
                      : {})
                  },
                }));
                if (nodeId && data.inferredOutputsSchema) {
                  updateNodeSchema(nodeId, data.inferredOutputsSchema);
                }
                break;
              }

              case 'node:error': {
                const errMsg = data.error ?? data.message ?? 'Unknown error';
                set((state) => ({
                  logs: [
                    ...state.logs,
                    createLogEntry('node:error', `Error in "${nodeId}": ${errMsg}`, nodeId),
                  ],
                  nodeStatuses: { ...state.nodeStatuses, ...(nodeId ? { [nodeId]: 'error' as const } : {}) },
                }));
                break;
              }

              case 'flow:done': {
                const totalDuration = data.duration ?? data.elapsed;
                set((state) => ({
                  logs: [
                    ...state.logs,
                    createLogEntry(
                      'flow:done',
                      `Flow completed${totalDuration != null ? ` in ${totalDuration}ms` : ''}`,
                      undefined,
                      { duration: totalDuration },
                    ),
                  ],
                  isRunning: false,
                }));
                ws.close();
                break;
              }

              default: {
                set((state) => ({
                  logs: [
                    ...state.logs,
                    createLogEntry('system', JSON.stringify(data)),
                  ],
                }));
              }
            }
          } catch {
            set((state) => ({
              logs: [...state.logs, createLogEntry('system', event.data)],
            }));
          }
        },
        () => {
          const state = get();
          if (state.isRunning) {
            set((s) => ({
              logs: [...s.logs, createLogEntry('system', 'Connection closed')],
              isRunning: false,
              wsConnected: false,
            }));
          } else {
            set({ wsConnected: false });
          }
        },
        () => {
          set((state) => ({
            logs: [
              ...state.logs,
              createLogEntry('system', 'WebSocket connection error'),
            ],
            isRunning: false,
            wsConnected: false,
          }));
        }
      );

      ws.onopen = async () => {
        set((state) => ({
          wsConnected: true,
          logs: [
            ...state.logs,
            createLogEntry('system', 'Connected. Sending flow…'),
          ],
        }));

        try {
          const response = await fetch(`${API_BASE_URL}/api/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph, startNodeId }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        } catch (e) {
          set((state) => ({
            logs: [
              ...state.logs,
              createLogEntry('system', `Failed to submit flow: ${e}`),
            ],
            isRunning: false,
          }));
          ws.close();
        }
      };
    } catch (e) {
      set((state) => ({
        logs: [
          ...state.logs,
          createLogEntry('system', `Failed to connect: ${e}`),
        ],
        isRunning: false,
      }));
    }
  },
}));

function updateNodeSchema(nodeId: string, inferredOutputsSchema: any) {
  useFlowStore.getState().updateNodeData(nodeId, { inferredOutputsSchema });
}
