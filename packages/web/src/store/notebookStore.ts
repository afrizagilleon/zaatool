import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { normaliseTags, type NotebookJson, type NotebookTrigger } from '@zaa-tool/shared';
import * as tree from '../lib/notebook-tree.js';
import type { CellRunState, NotebookState } from './notebookTypes.js';

const NOTEBOOK_VERSION = '1.0';

function emptyRun(): CellRunState {
  return { status: 'idle', logs: [] };
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  id: '',
  revision: null,
  saveConflict: null,
  name: 'Untitled Notebook',
  runtime: 'node',
  secrets: [],
  packages: [],
  tags: [],
  triggers: [],
  inputs: [],
  outputs: [],
  layout: [],
  actions: [],
  testArgs: {},
  steps: [],

  isDirty: false,
  isSaving: false,
  isRunning: false,
  runId: null,
  runError: null,
  runErrorCellId: null,
  cellRuns: {},
  latestRunId: null,
  viewedRunStartedAt: null,

  createNotebook: (runtime) => {
    const firstCell = tree.newCell();
    set({
      id: uuidv4(),
      revision: null,
      saveConflict: null,
      name: 'Untitled Notebook',
      runtime,
      secrets: [],
      packages: [],
      tags: [],
      triggers: [],
      inputs: [],
      outputs: [],
      layout: [],
      actions: [],
      testArgs: {},
      steps: [firstCell],
      isDirty: true,
      isRunning: false,
      runId: null,
      runError: null,
      runErrorCellId: null,
      cellRuns: {},
      latestRunId: null,
      viewedRunStartedAt: null,
    });
  },

  loadNotebook: (document) => {
    set({
      id: document.id,
      revision: document.revision ?? null,
      saveConflict: null,
      name: document.name,
      runtime: document.runtime,
      secrets: document.secrets ?? [],
      packages: document.packages ?? [],
      tags: document.tags ?? [],
      triggers: document.triggers ?? [],
      inputs: document.inputs ?? [],
      outputs: document.outputs ?? [],
      layout: document.layout ?? [],
      // Held rather than edited: there is no UI for buttons yet, and a store that drops
      // what it does not render would delete them the next time anyone pressed Save.
      actions: document.actions ?? [],
      testArgs: {},
      steps: document.steps ?? [],
      isDirty: false,
      isRunning: false,
      runId: null,
      runError: null,
      runErrorCellId: null,
      latestRunId: null,
      viewedRunStartedAt: null,
      // Outputs are never part of the document — a freshly opened notebook has
      // no results until it runs.
      cellRuns: {},
    });
  },

  getDocument: (): NotebookJson => {
    const { id, revision, name, runtime, secrets, packages, tags, triggers, inputs, outputs, layout, actions, steps } =
      get();
    return {
      version: NOTEBOOK_VERSION, id, name, runtime, secrets, triggers, inputs, outputs, steps,
      // What this copy was read at, so the engine can tell it from one somebody has since replaced.
      ...(revision !== null ? { revision } : {}),
      // Omitted when nobody arranged it, so a notebook nobody laid out stays free of it.
      ...(layout.length > 0 ? { layout } : {}),
      ...(actions.length > 0 ? { actions } : {}),
      // Held even before there was a panel for it. Until this line existed, opening a
      // notebook that declared `packages: [pandas]` and pressing Save deleted the
      // declaration — the store dropped what it did not render, and the next run lost
      // its libraries with nothing anywhere saying why.
      ...(packages.length > 0 ? { packages } : {}),
      // Same reason as `packages`: a field the store forgets is a field Save deletes.
      ...(tags.length > 0 ? { tags } : {}),
    };
  },

  /**
   * A new input is unnamed, and the name is its identity everywhere else — so the
   * placeholder is a real name the author then edits, not an empty string that
   * would collide with the next unnamed one.
   */
  addInput: () => {
    const { inputs } = get();
    const taken = new Set(inputs.map((input) => input.name));
    let name = 'input';
    for (let index = 2; taken.has(name); index += 1) name = `input${index}`;

    set({ inputs: [...inputs, { name, type: 'string' }], isDirty: true });
  },

  updateInput: (index, patch) => {
    set({
      inputs: get().inputs.map((input, at) => (at === index ? { ...input, ...patch } : input)),
      isDirty: true,
    });
  },

  removeInput: (index) => {
    set({ inputs: get().inputs.filter((_, at) => at !== index), isDirty: true });
  },

  setOutputs: (outputs) => set({ outputs, isDirty: true }),
  setLayout: (layout) => set({ layout, isDirty: true }),

  // Test values are authoring scratch, not document state — no dirty flag.
  setTestArg: (name, value) => set({ testArgs: { ...get().testArgs, [name]: value } }),

  addTrigger: (kind) => {
    // The slug is the credential for a webhook, so it is generated rather than named.
    const trigger: NotebookTrigger =
      kind === 'cron'
        ? { id: uuidv4(), kind: 'cron', cron: '0 * * * *', enabled: true }
        : { id: uuidv4(), kind: 'webhook', slug: uuidv4(), enabled: true };

    set({ triggers: [...get().triggers, trigger], isDirty: true });
  },

  updateTrigger: (triggerId, patch) => {
    set({
      triggers: get().triggers.map((trigger) =>
        trigger.id === triggerId ? ({ ...trigger, ...patch } as NotebookTrigger) : trigger
      ),
      isDirty: true,
    });
  },

  removeTrigger: (triggerId) => {
    set({ triggers: get().triggers.filter((trigger) => trigger.id !== triggerId), isDirty: true });
  },

  setName: (name) => set({ name, isDirty: true }),
  setRuntime: (runtime) => set({ runtime, isDirty: true }),
  setSecrets: (secrets) => set({ secrets, isDirty: true }),
  setPackages: (packages) => set({ packages, isDirty: true }),
  // Normalised on the way in, so the store never holds two spellings of one tag.
  setTags: (tags) => set({ tags: normaliseTags(tags), isDirty: true }),

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

  /** A parallel group inside a lane — the nesting the compiler always accepted. */
  addGroupToLane: (groupId, laneId) => {
    const group = tree.newParallelGroup();
    set({ steps: tree.appendToLane(get().steps, groupId, laneId, group), isDirty: true });
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
  restoreRun: (run, asLatest = false) => {
    const cellRuns: Record<string, CellRunState> = {};

    for (const [cellId, result] of Object.entries(run.cell_results ?? {})) {
      cellRuns[cellId] = {
        status: result.error ? 'error' : 'done',
        logs: result.logs ?? [],
        output: result.output,
        written: result.written,
        error: result.error,
        ms: result.ms,
        // A failure keeps the code it ran for display, but never for freshness.
        ranSource: result.error ? undefined : result.source,
        recordedSource: result.source,
      };
    }

    // A recorded run keeps the failing cell's error on that cell, so the banner
    // links to it by finding the one that errored.
    const failedCellId = Object.entries(run.cell_results ?? {}).find(([, r]) => r.error)?.[0];

    set({
      cellRuns,
      runId: run.id,
      ...(asLatest ? { latestRunId: run.id } : {}),
      viewedRunStartedAt: run.started_at,
      isRunning: false,
      runError: run.error ?? null,
      runErrorCellId: failedCellId ?? null,
    });
  },

  setSaving: (isSaving) => set({ isSaving }),
  markSaved: (id, revision) =>
    set({ id, isDirty: false, isSaving: false, saveConflict: null, ...(revision !== undefined ? { revision } : {}) }),

  setSaveConflict: (message, currentRevision) =>
    set({ saveConflict: { message, currentRevision }, isSaving: false }),

  overwriteAfterConflict: () => {
    const conflict = get().saveConflict;
    set({
      saveConflict: null,
      ...(conflict?.currentRevision != null ? { revision: conflict.currentRevision } : {}),
    });
  },

  startRun: (runId, onlyCellId) => {
    // Clear results this run will replace, so nothing on screen can be mistaken
    // for output of the run in progress.
    const cleared = Object.fromEntries(
      Object.entries(get().cellRuns)
        .filter(([cellId]) => !onlyCellId || cellId === onlyCellId)
        .map(([cellId, run]) => [cellId, { ...emptyRun(), ranSource: run.ranSource }])
    );

    const cellRuns = onlyCellId ? { ...get().cellRuns, ...cleared } : cleared;

    if (onlyCellId) {
      // Re-running one cell changes what everything downstream was computed from,
      // so those results can no longer be called current. Dropping their ranSource
      // is what turns them amber until they are re-run.
      for (const downstreamId of tree.cellsAfter(get().steps, onlyCellId)) {
        const run = cellRuns[downstreamId];
        if (run) cellRuns[downstreamId] = { ...run, ranSource: undefined };
      }
    }

    // A run just started is by definition the newest one.
    set({
      runId,
      latestRunId: runId,
      viewedRunStartedAt: null,
      isRunning: true,
      runError: null,
      runErrorCellId: null,
      cellRuns,
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
        [cellId]: {
          ...current,
          status: 'done',
          output,
          written,
          ms,
          error: undefined,
          ranSource: source,
          recordedSource: source,
        },
      },
    });
  },

  markCellError: (cellId, error, ms) => {
    const current = get().cellRuns[cellId] ?? emptyRun();
    // Running saves first, so the code on screen is the code that just failed.
    const recordedSource = tree.findCell(get().steps, cellId)?.code;
    set({
      cellRuns: {
        ...get().cellRuns,
        // A failed cell has no trustworthy result, so it keeps no ranSource — but the
        // code it ran is kept so the failure can be traced later.
        [cellId]: { ...current, status: 'error', error, ms, ranSource: undefined, recordedSource },
      },
    });
  },

  finishRun: (error, cellId) =>
    set({ isRunning: false, runError: error ?? null, runErrorCellId: cellId ?? null }),
}));
