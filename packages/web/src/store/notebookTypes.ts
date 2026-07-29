import type { NotebookJson, NotebookRuntime, NotebookStep } from '@zaa-tool/shared';

export type CellStatus = 'idle' | 'running' | 'done' | 'error';

export interface CellLog {
  level: string;
  msg: string;
}

export interface CellRunState {
  status: CellStatus;
  output?: Record<string, unknown>;
  /** Names this cell published into the notebook scope. */
  written?: string[];
  logs: CellLog[];
  error?: string;
  ms?: number;
  /**
   * The cell's source at the moment it last ran successfully. Comparing it with
   * the current source is what makes staleness computable rather than guessed.
   */
  ranSource?: string;
}

export interface NotebookState {
  id: string;
  name: string;
  runtime: NotebookRuntime;
  secrets: string[];
  steps: NotebookStep[];

  isDirty: boolean;
  isSaving: boolean;
  isRunning: boolean;
  runId: string | null;
  runError: string | null;
  cellRuns: Record<string, CellRunState>;

  createNotebook: (runtime: NotebookRuntime) => void;
  loadNotebook: (document: NotebookJson) => void;
  getDocument: () => NotebookJson;

  setName: (name: string) => void;
  setRuntime: (runtime: NotebookRuntime) => void;
  setSecrets: (secrets: string[]) => void;

  addCell: (kind: 'code' | 'markdown', afterCellId?: string) => void;
  updateCellSource: (cellId: string, source: string) => void;
  removeCell: (cellId: string) => void;
  moveCell: (cellId: string, direction: -1 | 1) => void;

  setSaving: (isSaving: boolean) => void;
  markSaved: (id: string) => void;

  startRun: (runId: string) => void;
  markCellRunning: (cellId: string) => void;
  appendCellLog: (cellId: string, log: CellLog) => void;
  markCellDone: (cellId: string, output: Record<string, unknown>, written: string[], ms: number) => void;
  markCellError: (cellId: string, error: string, ms: number) => void;
  finishRun: (error?: string) => void;
}
