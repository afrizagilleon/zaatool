import type {
  NotebookJson,
  NotebookAction,
  NotebookLayoutItem,
  NotebookOutput,
  NotebookParam,
  NotebookRuntime,
  NotebookStep,
} from '@zaa-tool/shared';

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
   * The cell's code at the moment it last ran *successfully*. Comparing it with the
   * current code is what makes staleness computable rather than guessed. Unset for a
   * failure, so a failed result is never treated as current.
   */
  ranSource?: string;
  /**
   * The code that ran, whether it succeeded or not — kept for display so a past
   * failure can show which version produced it. Never used for freshness.
   */
  recordedSource?: string;
}

/** The three parts of a cell that can be folded away independently. */
export type CellSection = 'note' | 'code' | 'output';

export interface NotebookState {
  id: string;
  name: string;
  runtime: NotebookRuntime;
  secrets: string[];
  /** Libraries the cells may import. The same sentence as `secrets`, about a different resource. */
  packages: string[];
  steps: NotebookStep[];

  isDirty: boolean;
  isSaving: boolean;
  isRunning: boolean;
  runId: string | null;
  runError: string | null;
  /** The cell (or parallel group) the run failed in, so the error can link to it. */
  runErrorCellId: string | null;
  cellRuns: Record<string, CellRunState>;

  createNotebook: (runtime: NotebookRuntime) => void;
  loadNotebook: (document: NotebookJson) => void;
  getDocument: () => NotebookJson;

  triggers: import('@zaa-tool/shared').NotebookTrigger[];

  /** The reuse contract: what a caller supplies, and what it gets back. */
  inputs: NotebookParam[];
  outputs: Array<string | NotebookOutput>;
  /** Where each output sits on the page. Empty means derived. */
  layout: NotebookLayoutItem[];
  /** Carried through load and save. No editor UI yet — dropping them would delete them. */
  actions: NotebookAction[];
  /**
   * Values for a test run from the editor. Never saved: they are how the author
   * exercises the contract, not part of what the notebook is.
   */
  testArgs: Record<string, string>;

  /**
   * Addressed by position, not by name: the name is the field being edited, so using
   * it as the identity makes every keystroke of a rename look like a different input.
   */
  addInput: () => void;
  updateInput: (index: number, patch: Partial<NotebookParam>) => void;
  removeInput: (index: number) => void;
  setOutputs: (outputs: Array<string | NotebookOutput>) => void;
  setLayout: (layout: NotebookLayoutItem[]) => void;
  setTestArg: (name: string, value: string) => void;

  addTrigger: (kind: 'cron' | 'webhook') => void;
  updateTrigger: (
    triggerId: string,
    patch: Partial<import('@zaa-tool/shared').NotebookTrigger>
  ) => void;
  removeTrigger: (triggerId: string) => void;

  setName: (name: string) => void;
  setRuntime: (runtime: NotebookRuntime) => void;
  setSecrets: (secrets: string[]) => void;
  setPackages: (packages: string[]) => void;

  addCell: (afterStepId?: string) => string;
  addCellToLane: (groupId: string, laneId: string) => string;
  updateCellNote: (cellId: string, note: string) => void;
  updateCellCode: (cellId: string, code: string) => void;
  removeCell: (cellId: string) => void;
  moveCell: (cellId: string, direction: -1 | 1) => void;

  addParallelGroup: (afterStepId?: string) => void;
  addGroupToLane: (groupId: string, laneId: string) => void;
  addLane: (groupId: string) => void;
  removeLane: (groupId: string, laneId: string) => void;
  setLaneLabel: (groupId: string, laneId: string, label: string) => void;
  removeGroup: (groupId: string) => void;

  toggleSection: (cellId: string, section: CellSection) => void;
  setAllSections: (section: CellSection, isCollapsed: boolean) => void;

  /** Id of the newest run known, so the editor can tell it is showing an older one. */
  latestRunId: string | null;
  /** When the currently shown run started, for the "viewing an older run" notice. */
  viewedRunStartedAt: string | null;

  /**
   * Rehydrates results from a recorded run, so opening a notebook is not blank.
   * `asLatest` marks this run as the newest known — true when restoring on open,
   * false when the reader picked an older run out of the history.
   */
  restoreRun: (run: import('@zaa-tool/shared').NotebookRunDetail, asLatest?: boolean) => void;

  setSaving: (isSaving: boolean) => void;
  markSaved: (id: string) => void;

  /** `onlyCellId` limits the reset to that cell, so a single-cell run leaves other results intact. */
  startRun: (runId: string, onlyCellId?: string) => void;
  markCellRunning: (cellId: string) => void;
  appendCellLog: (cellId: string, log: CellLog) => void;
  markCellDone: (cellId: string, output: Record<string, unknown>, written: string[], ms: number) => void;
  markCellError: (cellId: string, error: string, ms: number) => void;
  finishRun: (error?: string, cellId?: string) => void;
}
