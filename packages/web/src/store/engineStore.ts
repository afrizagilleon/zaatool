import { create } from 'zustand';
import type { GraphJson } from '@zaa-tool/shared';
import { useFlowStore } from './flowStore.js';
import { EngineClient } from '../lib/engine-client.js';
import { createLogEntry } from './engineTypes.js';
import type { EngineState } from './engineTypes.js';
import { handleWsMessage } from '../lib/wsEventHandler.js';

export type { LogEntry, NodeStatus } from './engineTypes.js';

export const useEngineStore = create<EngineState>((set, get) => ({
  logs: [],
  isRunning: false,
  wsConnected: false,
  nodeStatuses: {},
  activeHandles: {},
  runId: null,

  clearLogs: () => set({ logs: [] }),

  resetNodeStatuses: () => set({ nodeStatuses: {}, activeHandles: {} }),

  runFlow: async (graph: GraphJson, startNodeId?: string) => {
    const initialStatuses: Record<string, import('./engineTypes.js').NodeStatus> = {};
    graph.nodes.forEach((n) => {
      initialStatuses[n.id] = 'idle';
    });

    set({
      logs: [createLogEntry('system', startNodeId ? `Connecting to engine starting from ${startNodeId}…` : 'Connecting to engine…')],
      isRunning: true,
      nodeStatuses: initialStatuses,
      activeHandles: {},
      runId: null,
    });

    try {
      const ws = EngineClient.connectWebSocket(
        (event) => {
          try {
            const data = JSON.parse(event.data);
            handleWsMessage(data, set, get, ws);
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
            logs: [...state.logs, createLogEntry('system', 'WebSocket connection error')],
            isRunning: false,
            wsConnected: false,
          }));
        },
      );

      ws.onopen = async () => {
        set((state) => ({
          wsConnected: true,
          logs: [...state.logs, createLogEntry('system', 'Connected. Sending flow…')],
        }));

        try {
          const seedOutputs = useFlowStore.getState().getSeedOutputs();
          const { runId } = await EngineClient.runFlow(graph, startNodeId, seedOutputs);
          set({ runId });
          // Subscribe only after the id exists; anything the run already emitted
          // is replayed by the engine, so nothing is lost in that gap.
          EngineClient.subscribeToRun(ws, runId);
        } catch (e) {
          set((state) => ({
            logs: [...state.logs, createLogEntry('system', `Failed to submit flow: ${e}`)],
            isRunning: false,
          }));
          ws.close();
        }
      };
    } catch (e) {
      set((state) => ({
        logs: [...state.logs, createLogEntry('system', `Failed to connect: ${e}`)],
        isRunning: false,
      }));
    }
  },
}));
