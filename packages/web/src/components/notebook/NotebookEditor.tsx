import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, ArrowsSplit, ClockCounterClockwise, MapTrifold } from '@phosphor-icons/react';
import type { NotebookStep } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { useUiStore } from '../../store/uiStore';
import { useNotebookStore } from '../../store/notebookStore';
import { useNotebookRun } from '../../hooks/useNotebookRun';
import { useRunActivity } from '../../hooks/useRunActivity';
import { computeStaleCells } from '../../lib/notebook-staleness';
import * as tree from '../../lib/notebook-tree';
import { NotebookToolbar } from './NotebookToolbar';
import { PagePreview } from './PagePreview';
import { NotebookCell } from './NotebookCell';
import { ParallelGroup } from './ParallelGroup';
import { RunHistory } from './RunHistory';
import { DeployButton } from './DeployButton';
import { ExportButton } from './ExportButton';
import { AccessButton } from './AccessDialog';
import { RunErrorBanner } from './RunErrorBanner';
import { TriggerPanel } from './TriggerPanel';
import { ContractPanel } from './ContractPanel';
import { OutlinePanel } from './OutlinePanel';
import { notebooksApi } from '../../lib/notebooks-api';
import { cn } from '../../lib/utils';

interface NotebookEditorProps {
  onBack: () => void;
}

export function NotebookEditor({ onBack }: NotebookEditorProps) {
  const isDarkMode = useUiStore((s) => s.isDarkMode);

  const name = useNotebookStore((s) => s.name);
  const runtime = useNotebookStore((s) => s.runtime);
  const secrets = useNotebookStore((s) => s.secrets);
  const packages = useNotebookStore((s) => s.packages);
  const tags = useNotebookStore((s) => s.tags);
  const triggers = useNotebookStore((s) => s.triggers);
  const addTrigger = useNotebookStore((s) => s.addTrigger);
  const updateTrigger = useNotebookStore((s) => s.updateTrigger);
  const removeTrigger = useNotebookStore((s) => s.removeTrigger);
  const steps = useNotebookStore((s) => s.steps);
  const cellRuns = useNotebookStore((s) => s.cellRuns);
  const isDirty = useNotebookStore((s) => s.isDirty);
  const isSaving = useNotebookStore((s) => s.isSaving);
  const isRunning = useNotebookStore((s) => s.isRunning);
  const runError = useNotebookStore((s) => s.runError);
  const runErrorCellId = useNotebookStore((s) => s.runErrorCellId);
  const latestRunId = useNotebookStore((s) => s.latestRunId);
  const viewedRunStartedAt = useNotebookStore((s) => s.viewedRunStartedAt);

  const inputs = useNotebookStore((s) => s.inputs);
  const outputs = useNotebookStore((s) => s.outputs);
  const testArgs = useNotebookStore((s) => s.testArgs);
  const addInput = useNotebookStore((s) => s.addInput);
  const updateInput = useNotebookStore((s) => s.updateInput);
  const removeInput = useNotebookStore((s) => s.removeInput);
  const setOutputs = useNotebookStore((s) => s.setOutputs);
  const setTestArg = useNotebookStore((s) => s.setTestArg);

  const setName = useNotebookStore((s) => s.setName);
  const setRuntime = useNotebookStore((s) => s.setRuntime);
  const setSecrets = useNotebookStore((s) => s.setSecrets);
  const setPackages = useNotebookStore((s) => s.setPackages);
  const setTags = useNotebookStore((s) => s.setTags);
  const addCell = useNotebookStore((s) => s.addCell);
  const updateCellNote = useNotebookStore((s) => s.updateCellNote);
  const updateCellCode = useNotebookStore((s) => s.updateCellCode);
  const removeCell = useNotebookStore((s) => s.removeCell);
  const moveCell = useNotebookStore((s) => s.moveCell);
  const toggleSection = useNotebookStore((s) => s.toggleSection);
  const setAllSections = useNotebookStore((s) => s.setAllSections);
  const addCellToLane = useNotebookStore((s) => s.addCellToLane);
  const addParallelGroup = useNotebookStore((s) => s.addParallelGroup);
  const addGroupToLane = useNotebookStore((s) => s.addGroupToLane);
  const addLane = useNotebookStore((s) => s.addLane);
  const removeLane = useNotebookStore((s) => s.removeLane);
  const setLaneLabel = useNotebookStore((s) => s.setLaneLabel);
  const removeGroup = useNotebookStore((s) => s.removeGroup);

  const notebookId = useNotebookStore((s) => s.id);
  const runId = useNotebookStore((s) => s.runId);
  const restoreRun = useNotebookStore((s) => s.restoreRun);

  const { run, runAll, save } = useNotebookRun();
  // What this notebook is doing when it is not this browser doing it: a schedule firing,
  // an agent calling the deployed tool. Only used to know when the run history is out of
  // date, which is the one thing the editor could not previously find out.
  const elsewhere = useRunActivity(Boolean(notebookId))[notebookId];
  // Kept here rather than in the store: which half of the editor you are looking at is
  // a property of this screen, not of the notebook.
  const [isPreviewing, setIsPreviewing] = useState(false);

  /**
   * Scrolls to a step and flashes it. A cell in a lane that is not the visible one
   * has no element to scroll to, so this does nothing rather than guessing.
   */
  const jumpToStep = useCallback((stepId: string) => {
    const element = document.getElementById(`step-${stepId}`);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.classList.add('ring-2', 'ring-primary');
    window.setTimeout(() => element.classList.remove('ring-2', 'ring-primary'), 1200);
  }, []);

  const openRun = useCallback(
    async (id: string) => {
      const detail = await notebooksApi.getRun(notebookId, id).catch(() => null);
      if (detail) restoreRun(detail);
    },
    [notebookId, restoreRun]
  );

  const backToLatest = useCallback(async () => {
    const detail = await notebooksApi.getRun(notebookId, 'latest').catch(() => null);
    if (detail) restoreRun(detail, true);
  }, [notebookId, restoreRun]);

  // Ctrl/Cmd+S saves from anywhere in the editor, not only from inside a cell.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  const runAndAdvance = useCallback(
    (cellId: string) => {
      void run(cellId);
      // At the end of a list, carry on into a fresh cell — including at the end of
      // a lane, where a top-level-only check would have found nothing.
      const currentSteps = useNotebookStore.getState().steps;
      if (tree.isLastInList(currentSteps, cellId)) addCell(cellId);
    },
    [run, addCell]
  );

  const staleCells = useMemo(() => computeStaleCells(steps, cellRuns), [steps, cellRuns]);

  /**
   * Which cell writes which declared output, and where two of them write the same one.
   *
   * Read off `cellRuns[].written` — what a cell actually wrote when it last ran — rather
   * than guessed from the code, because the code cannot say what a branch will assign and
   * a guess here would be a badge that is confidently wrong. The cost is that nothing
   * shows until the notebook has run once, which is the honest state to be in.
   *
   * Two cells writing the same declared name is not an error — the later one wins, the
   * same rule the scope follows — but it is nearly always a surprise worth pointing at.
   */
  const writeMarkers = useMemo(() => {
    const declared = new Set(
      outputs.map((output) => (typeof output === 'string' ? output : output.name))
    );

    const byCell: Record<string, string[]> = {};
    const writerCount: Record<string, number> = {};

    for (const [cellId, cellRun] of Object.entries(cellRuns)) {
      const names = (cellRun.written ?? []).filter((name) => declared.has(name));
      if (names.length === 0) continue;
      byCell[cellId] = names;
      for (const name of names) writerCount[name] = (writerCount[name] ?? 0) + 1;
    }

    const contested = new Set(
      Object.entries(writerCount)
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
    );

    const duplicated = new Set(
      Object.entries(byCell)
        .filter(([, names]) => names.some((name) => contested.has(name)))
        .map(([cellId]) => cellId)
    );

    return { byCell, duplicated };
  }, [cellRuns, outputs]);

  /** Folds or unfolds every cell in one lane at once, for the outline panel. */
  const foldLane = useCallback(
    (laneId: string, fold: boolean) => {
      const findLane = (list: NotebookStep[]): NotebookStep[] | null => {
        for (const step of list) {
          if (step.kind !== 'parallel') continue;
          for (const lane of step.lanes) {
            if (lane.id === laneId) return lane.steps;
            const deeper = findLane(lane.steps);
            if (deeper) return deeper;
          }
        }
        return null;
      };

      const laneSteps = findLane(useNotebookStore.getState().steps);
      if (!laneSteps) return;
      for (const cell of tree.allCells(laneSteps)) {
        if (Boolean(cell.collapsed?.code) !== fold) toggleSection(cell.id, 'code');
      }
    },
    [toggleSection]
  );
  // Counts every cell at every depth: a top-level-only check could never report
  // "all collapsed" once the notebook contained a parallel group.
  const allCollapsed = useMemo(() => {
    const cells = tree.allCells(steps);
    const isEvery = (section: 'note' | 'code' | 'output') =>
      cells.length > 0 && cells.every((cell) => cell.collapsed?.[section]);
    return { note: isEvery('note'), code: isEvery('code'), output: isEvery('output') };
  }, [steps]);

  /**
   * Cells and parallel groups nest, so rendering recurses. Numbering is local to
   * each list — a cell inside a lane is "2" within that lane, not within the
   * notebook, because that is the order it actually runs in.
   */
  const renderSteps = useCallback(
    (list: NotebookStep[], depth = 0): React.ReactNode =>
      list.map((step, index) =>
        step.kind === 'parallel' ? (
          <ParallelGroup
            key={step.id}
            group={step}
            depth={depth}
            onAddLane={() => addLane(step.id)}
            onRemoveLane={(laneId) => removeLane(step.id, laneId)}
            onRenameLane={(laneId, label) => setLaneLabel(step.id, laneId, label)}
            onRemoveGroup={() => removeGroup(step.id)}
            onAddCell={(laneId) => addCellToLane(step.id, laneId)}
            onAddGroup={(laneId) => addGroupToLane(step.id, laneId)}
            renderLane={(lane) => (
              <div className="space-y-2">{renderSteps(lane.steps, depth + 1)}</div>
            )}
          />
        ) : (
          <NotebookCell
            key={step.id}
            cell={step}
            index={index}
            runtime={runtime}
            isDarkMode={isDarkMode}
            run={cellRuns[step.id]}
            isStale={Boolean(staleCells[step.id])}
            isBusy={isRunning}
            collapsed={step.collapsed ?? {}}
            writes={writeMarkers.byCell[step.id]}
            hasDuplicateWrites={writeMarkers.duplicated.has(step.id)}
            onToggleSection={(section) => toggleSection(step.id, section)}
            onNoteChange={(note) => updateCellNote(step.id, note)}
            onCodeChange={(code) => updateCellCode(step.id, code)}
            onRemove={() => removeCell(step.id)}
            onMove={(direction) => moveCell(step.id, direction)}
            onAddBelow={() => addCell(step.id)}
            onRun={() => void run(step.id)}
            onRunAndAdvance={() => runAndAdvance(step.id)}
            onSave={() => void save()}
          />
        )
      ),
    [
      runtime,
      isDarkMode,
      cellRuns,
      staleCells,
      writeMarkers,
      isRunning,
      addCell,
      addCellToLane,
      addGroupToLane,
      addLane,
      moveCell,
      removeCell,
      removeGroup,
      removeLane,
      run,
      runAndAdvance,
      save,
      setLaneLabel,
      toggleSection,
      updateCellCode,
      updateCellNote,
    ]
  );

  const isViewingOlderRun =
    runId !== null && latestRunId !== null && runId !== latestRunId && viewedRunStartedAt !== null;

  const staleCount = useMemo(
    () => Object.entries(staleCells).filter(([cellId, isStale]) => isStale && cellRuns[cellId]?.ranSource !== undefined).length,
    [staleCells, cellRuns]
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <NotebookToolbar
        name={name}
        runtime={runtime}
        secrets={secrets}
        packages={packages}
        tags={tags}
        isDirty={isDirty}
        isSaving={isSaving}
        isRunning={isRunning}
        staleCount={staleCount}
        deployButton={
          notebookId ? (
            <DeployButton
              notebookId={notebookId}
              // A save may have moved the draft on, so re-ask after every one.
              refreshKey={`${isDirty}-${isSaving}`}
              hasTriggers={triggers.some((trigger) => trigger.enabled !== false)}
              isDirty={isDirty}
            />
          ) : null
        }
        exportButton={notebookId ? <ExportButton notebookId={notebookId} name={name} /> : null}
        accessButton={notebookId ? <AccessButton notebookId={notebookId} notebookName={name} /> : null}
        mapButton={
          notebookId ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground"
              title="See this notebook drawn as it runs"
              // A link, not a mode: the map's second altitude was reachable only by
              // finding the right box among thirty-three and clicking it, and could not
              // be sent to anybody.
              onClick={() => {
                window.location.hash = `#/map/${notebookId}`;
              }}
            >
              <MapTrifold size={13} className="mr-1.5" weight="duotone" />
              Map
            </Button>
          ) : null
        }
        runHistory={
          <RunHistory
            notebookId={notebookId}
            activeRunId={runId}
            // A run that just finished should show up without reopening the panel —
            // including one this browser did not start. `isRunning` alone only knew about
            // the Run button, so a cron firing at 3am or an agent calling the tool left
            // the history showing yesterday until it was closed and reopened.
            refreshKey={`${isRunning}-${elsewhere?.status ?? ''}-${elsewhere?.runId ?? ''}`}
            onOpenRun={(id) => void openRun(id)}
          />
        }
        outlinePanel={
          <OutlinePanel
            steps={steps}
            onFoldLane={foldLane}
            // `NotebookCell` already anchors itself as `step-<id>` for the run-error
            // banner to jump to; the outline reuses that rather than adding a second
            // way to address the same element.
            onSelectCell={(cellId) => {
              document
                .getElementById(`step-${cellId}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          />
        }
        triggerCount={triggers.length}
        triggerPanel={
          <TriggerPanel
            triggers={triggers}
            isSaved={!isDirty}
            onAdd={addTrigger}
            onUpdate={updateTrigger}
            onRemove={removeTrigger}
          />
        }
        contractShape={{ inputs: inputs.length, outputs: outputs.length }}
        isPreviewing={isPreviewing}
        onTogglePreview={setIsPreviewing}
        contractPanel={
          <ContractPanel
            name={name}
            runtime={runtime}
            inputs={inputs}
            outputs={outputs}
            testArgs={testArgs}
            onAddInput={addInput}
            onUpdateInput={updateInput}
            onRemoveInput={removeInput}
            onOutputsChange={setOutputs}
            onTestArgChange={setTestArg}
          />
        }
        allCollapsed={allCollapsed}
        onToggleAllSections={setAllSections}
        onNameChange={setName}
        onRuntimeChange={setRuntime}
        onSecretsChange={setSecrets}
        onPackagesChange={setPackages}
        onTagsChange={setTags}
        onSave={() => void save()}
        onRun={() => void runAll()}
        onBack={onBack}
      />

      {/* Without this, output from a run three days ago would sit on screen with
          nothing to say so — which undoes the point of the freshness indicator. */}
      {isViewingOlderRun && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-[11px] border-b border-amber-500/40 bg-amber-500/5 shrink-0">
          <ClockCounterClockwise size={12} className="text-amber-500 shrink-0" />
          <span className="text-amber-500">
            Showing a run from {new Date(viewedRunStartedAt!).toLocaleString()} — not the most recent
          </span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-2 text-[10px] font-semibold text-amber-500 hover:text-amber-400"
            onClick={() => void backToLatest()}
          >
            Back to latest
          </Button>
        </div>
      )}

      {runError && (
        <RunErrorBanner
          error={runError}
          cellId={runErrorCellId}
          label={runErrorCellId ? tree.stepLabel(steps, runErrorCellId) : null}
          onJumpTo={jumpToStep}
        />
      )}

      {isPreviewing && <PagePreview onRun={() => void runAll()} isRunning={isRunning} />}

      <div className={cn('flex-1 overflow-auto p-4', isPreviewing && 'hidden')}>
        <div className="max-w-4xl mx-auto space-y-2">
          {renderSteps(steps)}

          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-[11px] text-muted-foreground"
              onClick={() => addCell()}
            >
              <Plus size={11} className="mr-1.5" />
              Add cell
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-[11px] text-muted-foreground"
              onClick={() => addParallelGroup()}
              title="Two or more lanes that start together and join before the next step"
            >
              <ArrowsSplit size={11} className="mr-1.5" />
              Add parallel group
            </Button>
          </div>

          <p className="text-center text-[10px] text-muted-foreground/50 pt-2">
            Cells share one scope. Publish with <code className="font-mono">return &#123; name: value &#125;</code>,
            read with <code className="font-mono">inputs.name</code>.
            <br />
            <span className="font-mono">Ctrl+Enter</span> run cell ·{' '}
            <span className="font-mono">Shift+Enter</span> run and move on ·{' '}
            <span className="font-mono">Ctrl+S</span> save. Run all saves first.
          </p>
        </div>
      </div>
    </div>
  );
}
