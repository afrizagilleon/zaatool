import { useState } from 'react';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import { ArrowUp, ArrowDown, Trash, Plus, TextT, Code } from '@phosphor-icons/react';
import type { CodeCell, MarkdownCell, NotebookRuntime } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { CellStatusDot } from './CellStatusDot';
import { CellOutput } from './CellOutput';
import type { CellRunState } from '../../store/notebookTypes';

interface NotebookCellProps {
  cell: CodeCell | MarkdownCell;
  index: number;
  runtime: NotebookRuntime;
  isDarkMode: boolean;
  run: CellRunState | undefined;
  isStale: boolean;
  onChange: (source: string) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onAddBelow: (kind: 'code' | 'markdown') => void;
}

export function NotebookCell({
  cell,
  index,
  runtime,
  isDarkMode,
  run,
  isStale,
  onChange,
  onRemove,
  onMove,
  onAddBelow,
}: NotebookCellProps) {
  const isMarkdown = cell.kind === 'markdown';
  const [isEditingMarkdown, setIsEditingMarkdown] = useState(false);

  const lineCount = cell.source.split('\n').length;
  const editorHeight = Math.min(Math.max(lineCount, 3), 24) * 19 + 16;

  return (
    <div
      className={cn(
        'group border border-border bg-card',
        run?.status === 'error' && 'border-status-error/50'
      )}
    >
      <div className="flex items-center gap-2 px-2 h-7 border-b border-border/60 bg-muted/30">
        <CellStatusDot
          status={run?.status ?? 'idle'}
          isStale={isStale}
          hasRun={run?.ranSource !== undefined || run?.status === 'error'}
        />
        <span className="text-[10px] font-mono text-muted-foreground/70 select-none">
          {isMarkdown ? 'md' : runtime === 'python' ? 'py' : 'js'} · {index + 1}
        </span>

        {isStale && run?.ranSource !== undefined && (
          <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-500">
            stale
          </span>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
      </div>

      {isMarkdown && !isEditingMarkdown ? (
        <div
          className={cn(
            'px-3 py-2 cursor-text min-h-[2rem]',
            'prose prose-sm dark:prose-invert max-w-none',
            // The editor is dense; pull typography's default rhythm in to match
            // the surrounding cell chrome.
            'prose-headings:mb-1.5 prose-headings:mt-1 prose-p:my-1.5 prose-p:leading-relaxed',
            'prose-pre:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5',
            'prose-code:font-mono prose-code:before:content-none prose-code:after:content-none'
          )}
          onDoubleClick={() => setIsEditingMarkdown(true)}
          title="Double-click to edit"
        >
          {cell.source.trim() ? (
            <ReactMarkdown>{cell.source}</ReactMarkdown>
          ) : (
            <span className="text-muted-foreground/50 text-[11px] italic">
              Empty markdown — double-click to write. This is also the context an AI assistant reads.
            </span>
          )}
        </div>
      ) : (
        <Editor
          height={`${editorHeight}px`}
          language={isMarkdown ? 'markdown' : runtime === 'python' ? 'python' : 'javascript'}
          theme={isDarkMode ? 'vs-dark' : 'light'}
          value={cell.source}
          onChange={(value) => onChange(value ?? '')}
          onMount={(editor) => {
            if (isMarkdown) editor.onDidBlurEditorText(() => setIsEditingMarkdown(false));
          }}
          options={{
            minimap: { enabled: false },
            lineNumbers: 'off',
            fontSize: 12,
            fontFamily: 'JetBrains Mono Variable, monospace',
            scrollBeyondLastLine: false,
            padding: { top: 8, bottom: 8 },
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            scrollbar: { vertical: 'auto', horizontalScrollbarSize: 8, verticalScrollbarSize: 8 },
            folding: false,
            wordWrap: 'on',
          }}
        />
      )}

      {!isMarkdown && <CellOutput run={run} isStale={isStale} />}

      <div className="flex items-center justify-center gap-1 h-0 group-hover:h-7 overflow-hidden transition-all border-t border-transparent group-hover:border-border/60">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-2 text-[10px] text-muted-foreground"
          onClick={() => onAddBelow('code')}
        >
          <Plus size={10} className="mr-1" />
          <Code size={10} className="mr-1" />
          Code
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-2 text-[10px] text-muted-foreground"
          onClick={() => onAddBelow('markdown')}
        >
          <Plus size={10} className="mr-1" />
          <TextT size={10} className="mr-1" />
          Markdown
        </Button>
      </div>
    </div>
  );
}
