import { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  ArrowUp,
  ArrowDown,
  Trash,
  Plus,
  TextT,
  Play,
  Spinner,
  CaretRight,
  CaretDown,
} from '@phosphor-icons/react';
import type { NotebookCell as NotebookCellDef, NotebookRuntime } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { CellStatusDot } from './CellStatusDot';
import { CellOutput } from './CellOutput';
import { CellEditor } from './CellEditor';
import type { CellRunState, CellSection } from '../../store/notebookTypes';

interface NotebookCellProps {
  cell: NotebookCellDef;
  index: number;
  runtime: NotebookRuntime;
  isDarkMode: boolean;
  run: CellRunState | undefined;
  isStale: boolean;
  isBusy: boolean;
  collapsed: Partial<Record<CellSection, boolean>>;
  onToggleSection: (section: CellSection) => void;
  onNoteChange: (note: string) => void;
  onCodeChange: (code: string) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onAddBelow: () => void;
  onRun: () => void;
  onRunAndAdvance: () => void;
  onSave: () => void;
}

/**
 * Every section is laid out as [fold gutter][content], so the control is always
 * in the same place at the left edge — never floating over the content it folds.
 */
function Section({
  label,
  preview,
  isCollapsed,
  isLast,
  onToggle,
  children,
}: {
  label: string;
  preview: string;
  isCollapsed: boolean;
  isLast?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-stretch', !isLast && 'border-b border-border/40')}>
      <button
        type="button"
        onClick={onToggle}
        title={isCollapsed ? `Show ${label}` : `Hide ${label}`}
        className="shrink-0 w-5 flex justify-center pt-1.5 text-muted-foreground/40 hover:text-foreground hover:bg-muted/40 transition-colors"
      >
        {isCollapsed ? <CaretRight size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />}
      </button>

      {isCollapsed ? (
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-2 px-1 py-1 text-left hover:bg-muted/40 transition-colors"
        >
          <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground shrink-0">
            {label}
          </span>
          <span className="text-[10px] text-muted-foreground/50 truncate font-mono">{preview}</span>
        </button>
      ) : (
        <div className="flex-1 min-w-0">{children}</div>
      )}
    </div>
  );
}

function firstLine(text: string, fallback: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim().length > 0);
  return line ? line.trim().slice(0, 90) : fallback;
}

export function NotebookCell({
  cell,
  index,
  runtime,
  isDarkMode,
  run,
  isStale,
  isBusy,
  collapsed,
  onToggleSection,
  onNoteChange,
  onCodeChange,
  onRemove,
  onMove,
  onAddBelow,
  onRun,
  onRunAndAdvance,
  onSave,
}: NotebookCellProps) {
  const note = cell.note ?? '';
  const code = cell.code ?? '';
  const hasCode = code.trim().length > 0;
  const hasNote = note.trim().length > 0;

  const [isEditingNote, setIsEditingNote] = useState(false);
  const [showNote, setShowNote] = useState(hasNote);

  const isRunning = run?.status === 'running';
  const hasOutput =
    Boolean(run) && (run!.logs.length > 0 || run!.error !== undefined || run!.output !== undefined);

  const startNote = useCallback(() => {
    setShowNote(true);
    setIsEditingNote(true);
  }, []);

  return (
    <div
      className={cn(
        'group border border-border bg-card',
        run?.status === 'error' && 'border-status-error/50',
        isRunning && 'border-status-running/50'
      )}
    >
      <div className="flex items-center gap-2 px-2 h-7 border-b border-border/60 bg-muted/30">
        <CellStatusDot
          status={run?.status ?? 'idle'}
          isStale={isStale}
          hasRun={run?.ranSource !== undefined || run?.status === 'error'}
        />
        <span className="text-[10px] font-mono text-muted-foreground/70 select-none">{index + 1}</span>

        {isStale && run?.ranSource !== undefined && (
          <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-500">stale</span>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {!showNote && (
            <Button variant="ghost" size="icon" className="w-5 h-5" title="Add a note" onClick={startNote}>
              <TextT size={11} />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="w-5 h-5" title="Move up" onClick={() => onMove(-1)}>
            <ArrowUp size={11} />
          </Button>
          <Button variant="ghost" size="icon" className="w-5 h-5" title="Move down" onClick={() => onMove(1)}>
            <ArrowDown size={11} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-5 h-5 text-red-400 hover:text-red-300"
            title="Delete cell"
            onClick={onRemove}
          >
            <Trash size={11} />
          </Button>
        </div>

        {hasCode && (
          <Button
            variant="ghost"
            size="icon"
            className="w-5 h-5 text-primary"
            title="Run this cell (Ctrl+Enter)"
            onClick={onRun}
            disabled={isBusy}
          >
            {isRunning ? <Spinner size={11} className="animate-spin" /> : <Play size={11} weight="fill" />}
          </Button>
        )}
      </div>

      {showNote && (
        <Section
          label="note"
          preview={firstLine(note, 'empty')}
          isCollapsed={Boolean(collapsed.note)}
          onToggle={() => onToggleSection('note')}
        >
          {isEditingNote ? (
            <CellEditor
              value={note}
              language="markdown"
              isDarkMode={isDarkMode}
              autoFocus
              placeholder="What is this step for? Markdown. This is also the spec an AI assistant reads for the code below."
              onChange={onNoteChange}
              onRun={onRun}
              onRunAndAdvance={onRunAndAdvance}
              onSave={onSave}
              onBlur={() => {
                setIsEditingNote(false);
                if (note.trim().length === 0) setShowNote(false);
              }}
            />
          ) : (
            <div
              className="px-2 py-1.5 cursor-text prose prose-sm dark:prose-invert max-w-none"
              onClick={() => setIsEditingNote(true)}
              title="Click to edit the note"
            >
              {hasNote ? (
                <ReactMarkdown>{note}</ReactMarkdown>
              ) : (
                <span className="text-[11px] italic text-muted-foreground/50">
                  Empty note — click to write.
                </span>
              )}
            </div>
          )}
        </Section>
      )}

      <Section
        label={runtime === 'python' ? 'python' : 'javascript'}
        preview={firstLine(code, 'empty')}
        isCollapsed={Boolean(collapsed.code)}
        isLast={!hasOutput}
        onToggle={() => onToggleSection('code')}
      >
        <CellEditor
          value={code}
          language={runtime === 'python' ? 'python' : 'javascript'}
          isDarkMode={isDarkMode}
          placeholder="return { name: value };   //  read earlier cells with inputs.name"
          onChange={onCodeChange}
          onRun={onRun}
          onRunAndAdvance={onRunAndAdvance}
          onSave={onSave}
        />
      </Section>

      {hasOutput && (
        <Section
          label="output"
          preview={
            run?.error ? run.error.slice(0, 90) : Object.keys(run?.output ?? {}).join(', ') || 'no value'
          }
          isCollapsed={Boolean(collapsed.output)}
          isLast
          onToggle={() => onToggleSection('output')}
        >
          <CellOutput run={run} isStale={isStale} />
        </Section>
      )}

      <div className="flex items-center justify-center h-0 group-hover:h-6 overflow-hidden transition-all border-t border-transparent group-hover:border-border/60">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-2 text-[10px] text-muted-foreground"
          onClick={onAddBelow}
        >
          <Plus size={10} className="mr-1" />
          Add cell below
        </Button>
      </div>
    </div>
  );
}
