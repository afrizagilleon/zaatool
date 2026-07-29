import { useMemo } from 'react';
import { Plus, Code, TextT, StackSimple } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { useUiStore } from '../../store/uiStore';
import { useNotebookStore } from '../../store/notebookStore';
import { useNotebookRun } from '../../hooks/useNotebookRun';
import { computeStaleCells } from '../../lib/notebook-staleness';
import { NotebookToolbar } from './NotebookToolbar';
import { NotebookCell } from './NotebookCell';

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
  const updateCellSource = useNotebookStore((s) => s.updateCellSource);
  const removeCell = useNotebookStore((s) => s.removeCell);
  const moveCell = useNotebookStore((s) => s.moveCell);

  const { runAll, save } = useNotebookRun();

  const staleCells = useMemo(() => computeStaleCells(steps, cellRuns), [steps, cellRuns]);
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
          {steps.map((step, index) =>
            step.kind === 'parallel' ? (
              <div key={step.id} className="border border-dashed border-border p-3 bg-muted/20">
                <div className="flex items-center gap-2 mb-2">
                  <StackSimple size={13} className="text-muted-foreground" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Parallel · {step.lanes.length} lanes
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  This group runs and is preserved on save, but editing it lands in a later milestone.
                </p>
              </div>
            ) : (
              <NotebookCell
                key={step.id}
                cell={step}
                index={index}
                runtime={runtime}
                isDarkMode={isDarkMode}
                run={cellRuns[step.id]}
                isStale={Boolean(staleCells[step.id])}
                onChange={(source) => updateCellSource(step.id, source)}
                onRemove={() => removeCell(step.id)}
                onMove={(direction) => moveCell(step.id, direction)}
                onAddBelow={(kind) => addCell(kind, step.id)}
              />
            )
          )}

          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-[11px] text-muted-foreground"
              onClick={() => addCell('code')}
            >
              <Plus size={11} className="mr-1" />
              <Code size={11} className="mr-1.5" />
              Code cell
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-[11px] text-muted-foreground"
              onClick={() => addCell('markdown')}
            >
              <Plus size={11} className="mr-1" />
              <TextT size={11} className="mr-1.5" />
              Markdown cell
            </Button>
          </div>

          <p className="text-center text-[10px] text-muted-foreground/50 pt-2">
            Cells share one scope. Publish with <code className="font-mono">return &#123; name: value &#125;</code>,
            read with <code className="font-mono">inputs.name</code>. Running saves first.
          </p>
        </div>
      </div>
    </div>
  );
}
