import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { NotebookJson } from '@zaa-tool/shared';
import * as tree from '../lib/notebook-tree.js';
import type { CellRunState, NotebookState } from './notebookTypes.js';

const NOTEBOOK_VERSION = '1.0';

function emptyRun(): CellRunState {
  return { status: 'idle', logs: [] };
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
    const firstCell = tree.newCell();
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

  addCell: (afterStepId) => {
    const cell = tree.newCell();
    const steps = get().steps;
    set({
      steps: afterStepId ? tree.insertAfter(steps, afterStepId, cell) : [...steps, cell],
      isDirty: true,
    });
    return cell.id;
  },

  addCellToLane: (groupId, laneId) => {
    const cell = tree.newCell();
    set({ steps: tree.appendToLane(get().steps, groupId, laneId, cell), isDirty: true });
    return cell.id;
  },

  updateCellNote: (cellId, note) => {
    set({ steps: tree.mapCell(get().steps, cellId, (cell) => ({ ...cell, note })), isDirty: true });
  },

  updateCellCode: (cellId, code) => {
    set({ steps: tree.mapCell(get().steps, cellId, (cell) => ({ ...cell, code })), isDirty: true });
  },

  removeCell: (cellId) => {
    const cellRuns = { ...get().cellRuns };
    delete cellRuns[cellId];
    set({ steps: tree.removeStep(get().steps, cellId), cellRuns, isDirty: true });
  },

  moveCell: (cellId, direction) => {
    set({ steps: tree.moveStep(get().steps, cellId, direction), isDirty: true });
  },

  addParallelGroup: (afterStepId) => {
    const group = tree.newParallelGroup();
    const steps = get().steps;
    set({
      steps: afterStepId ? tree.insertAfter(steps, afterStepId, group) : [...steps, group],
      isDirty: true,
    });
  },

  addLane: (groupId) => set({ steps: tree.addLane(get().steps, groupId), isDirty: true }),

  removeLane: (groupId, laneId) =>
    set({ steps: tree.removeLane(get().steps, groupId, laneId), isDirty: true }),

  setLaneLabel: (groupId, laneId, label) =>
    set({ steps: tree.setLaneLabel(get().steps, groupId, laneId, label), isDirty: true }),

  removeGroup: (groupId) => set({ steps: tree.removeStep(get().steps, groupId), isDirty: true }),

  // Folding lives on the cell itself, so how a notebook is arranged survives
  // being closed and reopened.
  toggleSection: (cellId, section) => {
    set({
      steps: tree.mapCell(get().steps, cellId, (cell) => ({
        ...cell,
        collapsed: { ...cell.collapsed, [section]: !cell.collapsed?.[section] },
      })),
      isDirty: true,
    });
  },

  setAllSections: (section, isCollapsed) => {
    set({
      steps: tree.mapAllCells(get().steps, (cell) => ({
        ...cell,
        collapsed: { ...cell.collapsed, [section]: isCollapsed },
      })),
      isDirty: true,
    });
  },

  /**
   * Loads a recorded run's results back into the editor.
   *
   * `source` is what the run stored as the code it executed, and it becomes
   * `ranSource` — so a restored run is checked against the notebook's current code
   * and shows up amber where it no longer matches, rather than looking trustworthy.
   */
  restoreRun: (run) => {
    const cellRuns: Record<string, CellRunState> = {};

    for (const [cellId, result] of Object.entries(run.cell_results ?? {})) {
      cellRuns[cellId] = {
        status: result.error ? 'error' : 'done',
        logs: result.logs ?? [],
        output: result.output,
        written: result.written,
        error: result.error,
        ms: result.ms,
        ranSource: result.error ? undefined : result.source,
      };
    }

    set({ cellRuns, runId: run.id, isRunning: false, runError: run.error ?? null });
  },

  setSaving: (isSaving) => set({ isSaving }),
  markSaved: (id) => set({ id, isDirty: false, isSaving: false }),

  startRun: (runId, onlyCellId) => {
    // Clear results this run will replace, so nothing on screen can be mistaken
    // for output of the run in progress. A single-cell run touches only its own.
    const cleared = Object.fromEntries(
      Object.entries(get().cellRuns)
        .filter(([cellId]) => !onlyCellId || cellId === onlyCellId)
        .map(([cellId, run]) => [cellId, { ...emptyRun(), ranSource: run.ranSource }])
    );

    set({
      runId,
      isRunning: true,
      runError: null,
      cellRuns: onlyCellId ? { ...get().cellRuns, ...cleared } : cleared,
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
    // Must search the whole tree: a top-level-only lookup left cells inside lanes
    // with no ranSource, which staleness reads as "never ran" — so every cell after
    // a parallel group stayed stale no matter how often it ran.
    const source = tree.findCell(get().steps, cellId)?.code;
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
