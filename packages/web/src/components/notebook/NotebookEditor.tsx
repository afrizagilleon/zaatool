import { useCallback, useEffect, useMemo } from 'react';
import { Plus, StackSimple } from '@phosphor-icons/react';
import type { NotebookStep } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { useUiStore } from '../../store/uiStore';
import { useNotebookStore } from '../../store/notebookStore';
import { useNotebookRun } from '../../hooks/useNotebookRun';
import { computeStaleCells } from '../../lib/notebook-staleness';
import * as tree from '../../lib/notebook-tree';
import { NotebookToolbar } from './NotebookToolbar';
import { NotebookCell } from './NotebookCell';
import { ParallelGroup } from './ParallelGroup';

interface NotebookEditorProps {
  onBack: () => void;
}

export function NotebookEditor({ onBack }: NotebookEditorProps) {
  const isDarkMode = useUiStore((s) => s.isDarkMode);

  const name = useNotebookStore((s) => s.name);
  const runtime = useNotebookStore((s) => s.runtime);
  const secrets = useNotebookStore((s) => s.secrets);
  const steps = useNotebookStore((s) => s.steps);
  const cellRuns = useNotebookStore((s) => s.cellRuns);
  const isDirty = useNotebookStore((s) => s.isDirty);
  const isSaving = useNotebookStore((s) => s.isSaving);
  const isRunning = useNotebookStore((s) => s.isRunning);
  const runError = useNotebookStore((s) => s.runError);

  const setName = useNotebookStore((s) => s.setName);
  const setRuntime = useNotebookStore((s) => s.setRuntime);
  const setSecrets = useNotebookStore((s) => s.setSecrets);
  const addCell = useNotebookStore((s) => s.addCell);
  const updateCellNote = useNotebookStore((s) => s.updateCellNote);
  const updateCellCode = useNotebookStore((s) => s.updateCellCode);
  const removeCell = useNotebookStore((s) => s.removeCell);
  const moveCell = useNotebookStore((s) => s.moveCell);
  const toggleSection = useNotebookStore((s) => s.toggleSection);
  const setAllSections = useNotebookStore((s) => s.setAllSections);
  const addCellToLane = useNotebookStore((s) => s.addCellToLane);
  const addParallelGroup = useNotebookStore((s) => s.addParallelGroup);
  const addLane = useNotebookStore((s) => s.addLane);
  const removeLane = useNotebookStore((s) => s.removeLane);
  const setLaneLabel = useNotebookStore((s) => s.setLaneLabel);
  const removeGroup = useNotebookStore((s) => s.removeGroup);

  const { run, runAll, save } = useNotebookRun();

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
    (list: NotebookStep[]): React.ReactNode =>
      list.map((step, index) =>
        step.kind === 'parallel' ? (
          <ParallelGroup
            key={step.id}
            group={step}
            onAddLane={() => addLane(step.id)}
            onRemoveLane={(laneId) => removeLane(step.id, laneId)}
            onRenameLane={(laneId, label) => setLaneLabel(step.id, laneId, label)}
            onRemoveGroup={() => removeGroup(step.id)}
            onAddCell={(laneId) => addCellToLane(step.id, laneId)}
            renderLane={(lane) => <div className="space-y-2">{renderSteps(lane.steps)}</div>}
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
      isRunning,
      addCell,
      addCellToLane,
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
        isDirty={isDirty}
        isSaving={isSaving}
        isRunning={isRunning}
        staleCount={staleCount}
        allCollapsed={allCollapsed}
        onToggleAllSections={setAllSections}
        onNameChange={setName}
        onRuntimeChange={setRuntime}
        onSecretsChange={setSecrets}
        onSave={() => void save()}
        onRun={() => void runAll()}
        onBack={onBack}
      />

      {runError && (
        <div className="px-4 py-2 text-xs text-status-error border-b border-status-error/40 bg-status-error/5 shrink-0">
          {runError}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
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
            >
              <StackSimple size={11} className="mr-1.5" />
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
