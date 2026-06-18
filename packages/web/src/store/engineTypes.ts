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

export interface EngineState {
  logs: LogEntry[];
  isRunning: boolean;
  wsConnected: boolean;
  nodeStatuses: Record<string, NodeStatus>;
  activeHandles: Record<string, string[]>;

  clearLogs: () => void;
  runFlow: (graph: import('@zaa-tool/shared').GraphJson, startNodeId?: string) => void;
  resetNodeStatuses: () => void;
}

let logIdCounter = 0;

export const createLogEntry = (
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
