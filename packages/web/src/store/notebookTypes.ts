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
   * The cell's code at the moment it last ran successfully. Comparing it with
   * the current code is what makes staleness computable rather than guessed.
   */
  ranSource?: string;
}

/** The three parts of a cell that can be folded away independently. */
export type CellSection = 'note' | 'code' | 'output';

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

  addCell: (afterStepId?: string) => string;
  addCellToLane: (groupId: string, laneId: string) => string;
  updateCellNote: (cellId: string, note: string) => void;
  updateCellCode: (cellId: string, code: string) => void;
  removeCell: (cellId: string) => void;
  moveCell: (cellId: string, direction: -1 | 1) => void;

  addParallelGroup: (afterStepId?: string) => void;
  addLane: (groupId: string) => void;
  removeLane: (groupId: string, laneId: string) => void;
  setLaneLabel: (groupId: string, laneId: string, label: string) => void;
  removeGroup: (groupId: string) => void;

  toggleSection: (cellId: string, section: CellSection) => void;
  setAllSections: (section: CellSection, isCollapsed: boolean) => void;

  setSaving: (isSaving: boolean) => void;
  markSaved: (id: string) => void;

  /** `onlyCellId` limits the reset to that cell, so a single-cell run leaves other results intact. */
  startRun: (runId: string, onlyCellId?: string) => void;
  markCellRunning: (cellId: string) => void;
  appendCellLog: (cellId: string, log: CellLog) => void;
  markCellDone: (cellId: string, output: Record<string, unknown>, written: string[], ms: number) => void;
  markCellError: (cellId: string, error: string, ms: number) => void;
  finishRun: (error?: string) => void;
}
