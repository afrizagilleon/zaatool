import { useFlowStore } from '../store/flowStore.js';
import { createLogEntry } from '../store/engineTypes.js';
import type { LogEntry } from '../store/engineTypes.js';

export function handleWsMessage(data: any, set: any, get: any, ws: WebSocket): void {
  const eventType: string = data.event || data.type || 'system';
  const nodeId: string | undefined = data.nodeId;

  switch (eventType) {
    case 'node:start': {
      set((state: any) => ({
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
      set((state: any) => ({
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

      set((state: any) => ({
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
            ? { [nodeId]: ([] as string[]).concat(data.activeHandle || data.activeHandles) }
            : {}),
        },
      }));

      if (nodeId && data.inferredOutputsSchema) {
        useFlowStore.getState().updateNodeData(nodeId, { inferredOutputsSchema: data.inferredOutputsSchema });
      }
      break;
    }

    case 'node:error': {
      const errMsg = data.error ?? data.message ?? 'Unknown error';
      set((state: any) => ({
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
      set((state: any) => ({
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
      set((state: any) => ({
        logs: [
          ...state.logs,
          createLogEntry('system', JSON.stringify(data)),
        ],
      }));
    }
  }
}
