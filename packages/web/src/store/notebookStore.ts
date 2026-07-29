import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { CodeCell, MarkdownCell, NotebookJson, NotebookStep } from '@zaa-tool/shared';
import type { CellRunState, NotebookState } from './notebookTypes.js';

const NOTEBOOK_VERSION = '1.0';

function emptyRun(): CellRunState {
  return { status: 'idle', logs: [] };
}

/** Top-level cells are the editable surface; parallel groups arrive in M3. */
function topLevelIndexOf(steps: NotebookStep[], cellId: string): number {
  return steps.findIndex((step) => step.id === cellId);
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  id: '',
  name: 'Untitled Notebook',
  runtime: 'node',
  secrets: [],
  steps: [],

  isDirty: false,
  isSaving: false,
  isRunning: false,
  runId: null,
  runError: null,
  cellRuns: {},

  createNotebook: (runtime) => {
    const firstCell: CodeCell = { id: uuidv4(), kind: 'code', source: '' };
    set({
      id: uuidv4(),
      name: 'Untitled Notebook',
      runtime,
      secrets: [],
      steps: [firstCell],
      isDirty: true,
      isRunning: false,
      runId: null,
      runError: null,
      cellRuns: {},
    });
  },

  loadNotebook: (document) => {
    set({
      id: document.id,
      name: document.name,
      runtime: document.runtime,
      secrets: document.secrets ?? [],
      steps: document.steps ?? [],
      isDirty: false,
      isRunning: false,
      runId: null,
      runError: null,
      // Outputs are never part of the document — a freshly opened notebook has
      // no results until it runs.
      cellRuns: {},
    });
  },

  getDocument: (): NotebookJson => {
    const { id, name, runtime, secrets, steps } = get();
    return { version: NOTEBOOK_VERSION, id, name, runtime, secrets, steps };
  },

  setName: (name) => set({ name, isDirty: true }),
  setRuntime: (runtime) => set({ runtime, isDirty: true }),
  setSecrets: (secrets) => set({ secrets, isDirty: true }),

  addCell: (kind, afterCellId) => {
    const steps = [...get().steps];
    const cell: CodeCell | MarkdownCell =
      kind === 'code'
        ? { id: uuidv4(), kind: 'code', source: '' }
        : { id: uuidv4(), kind: 'markdown', source: '' };

    const at = afterCellId ? topLevelIndexOf(steps, afterCellId) : -1;
    if (at >= 0) steps.splice(at + 1, 0, cell);
    else steps.push(cell);

    set({ steps, isDirty: true });
  },

  updateCellSource: (cellId, source) => {
    set({
      steps: get().steps.map((step) =>
        step.id === cellId && step.kind !== 'parallel' ? { ...step, source } : step
      ),
      isDirty: true,
    });
  },

  removeCell: (cellId) => {
    const cellRuns = { ...get().cellRuns };
    delete cellRuns[cellId];
    set({ steps: get().steps.filter((step) => step.id !== cellId), cellRuns, isDirty: true });
  },

  moveCell: (cellId, direction) => {
    const steps = [...get().steps];
    const from = topLevelIndexOf(steps, cellId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= steps.length) return;
    [steps[from], steps[to]] = [steps[to], steps[from]];
    set({ steps, isDirty: true });
  },

  setSaving: (isSaving) => set({ isSaving }),
  markSaved: (id) => set({ id, isDirty: false, isSaving: false }),

  startRun: (runId) => {
    // Clear previous results so nothing on screen can be mistaken for this run.
    set({
      runId,
      isRunning: true,
      runError: null,
      cellRuns: Object.fromEntries(
        Object.entries(get().cellRuns).map(([cellId, run]) => [
          cellId,
          { ...emptyRun(), ranSource: run.ranSource },
        ])
      ),
    });
  },

  markCellRunning: (cellId) => {
    set({
      cellRuns: { ...get().cellRuns, [cellId]: { ...emptyRun(), status: 'running' } },
    });
  },

  appendCellLog: (cellId, log) => {
    const current = get().cellRuns[cellId] ?? emptyRun();
    set({
      cellRuns: { ...get().cellRuns, [cellId]: { ...current, logs: [...current.logs, log] } },
    });
  },

  markCellDone: (cellId, output, written, ms) => {
    const current = get().cellRuns[cellId] ?? emptyRun();
    const step = get().steps.find((s) => s.id === cellId);
    const source = step && step.kind !== 'parallel' ? step.source : undefined;
    set({
      cellRuns: {
        ...get().cellRuns,
        [cellId]: { ...current, status: 'done', output, written, ms, error: undefined, ranSource: source },
      },
    });
  },

  markCellError: (cellId, error, ms) => {
    const current = get().cellRuns[cellId] ?? emptyRun();
    set({
      cellRuns: {
        ...get().cellRuns,
        // A failed cell has no trustworthy result, so it keeps no ranSource.
        [cellId]: { ...current, status: 'error', error, ms, ranSource: undefined },
      },
    });
  },

  finishRun: (error) => set({ isRunning: false, runError: error ?? null }),
}));
