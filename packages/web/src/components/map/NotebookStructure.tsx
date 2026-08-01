import { useEffect, useState } from 'react';
import type { NotebookJson, NotebookMapCall, NotebookStep } from '@zaa-tool/shared';
import { ArrowSquareOut, X, ArrowRight } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { notebooksApi } from '../../lib/notebooks-api';
import { cn } from '../../lib/utils';

/**
 * One notebook's shape, beside the map.
 *
 * Drawn as a stack rather than a graph, because a notebook *is* a stack: linear by
 * default, with parallelism only as structured lanes. Rendering it as free-form nodes
 * would suggest a freedom the model does not have — which is exactly the confusion the
 * canvas caused.
 */

interface NotebookStructureProps {
  notebookId: string;
  calls: NotebookMapCall[];
  notebookNames: Map<string, string>;
  onOpen: () => void;
  onClose: () => void;
}

function firstLine(note: string | undefined): string | null {
  const line = note?.split('\n').find((candidate) => candidate.trim());
  return line ? line.replace(/^#+\s*/, '').trim() : null;
}

function Steps({
  steps,
  callsByCell,
  depth = 0,
}: {
  steps: NotebookStep[];
  callsByCell: Map<string, NotebookMapCall[]>;
  depth?: number;
}) {
  return (
    <div className="space-y-1.5">
      {steps.map((step) => {
        if (step.kind === 'parallel') {
          return (
            <div key={step.id} className="border border-dashed border-primary/40 p-2 space-y-1.5">
              <div className="text-[9px] uppercase tracking-widest text-primary/70">
                parallel · {step.lanes.length} lane{step.lanes.length === 1 ? '' : 's'}
              </div>
              <div className="flex gap-2 items-start overflow-x-auto">
                {step.lanes.map((lane) => (
                  <div key={lane.id} className="flex-1 min-w-[140px] space-y-1.5">
                    <div className="text-[10px] font-medium text-muted-foreground truncate">
                      {lane.label || 'lane'}
                    </div>
                    <Steps steps={lane.steps} callsByCell={callsByCell} depth={depth + 1} />
                  </div>
                ))}
              </div>
            </div>
          );
        }

        const heading = firstLine(step.note);
        const outgoing = callsByCell.get(step.id) ?? [];
        const hasCode = Boolean(step.code?.trim());

        return (
          <div
            key={step.id}
            className={cn(
              'border border-border bg-node-bg px-2.5 py-1.5',
              !hasCode && 'border-dashed opacity-70'
            )}
          >
            <div className="text-[11px] truncate" title={heading ?? step.id}>
              {heading ?? (hasCode ? 'code' : 'note')}
            </div>
            {outgoing.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {outgoing.map((call, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground"
                  >
                    <ArrowRight size={10} weight="bold" className="text-primary/70 shrink-0" />
                    <span className="font-mono truncate">{call.reference}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function NotebookStructure({
  notebookId,
  calls,
  notebookNames,
  onOpen,
  onClose,
}: NotebookStructureProps) {
  const [document, setDocument] = useState<NotebookJson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDocument(null);
    setError(null);

    notebooksApi
      .getById(notebookId)
      .then((loaded) => {
        if (!cancelled) setDocument(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });

    return () => {
      cancelled = true;
    };
  }, [notebookId]);

  const callsByCell = new Map<string, NotebookMapCall[]>();
  for (const call of calls) {
    const resolvedName = call.toNotebookId ? notebookNames.get(call.toNotebookId) : undefined;
    const shown: NotebookMapCall = { ...call, reference: resolvedName ?? call.reference };
    callsByCell.set(call.fromCellId, [...(callsByCell.get(call.fromCellId) ?? []), shown]);
  }

  return (
    <aside className="w-[320px] shrink-0 border-l border-border bg-background flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border bg-muted/20 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
            Structure
          </div>
          <div className="text-sm font-bold truncate">{document?.name ?? 'Loading…'}</div>
        </div>
        <Button size="icon" variant="ghost" className="w-6 h-6 shrink-0" onClick={onClose} title="Close">
          <X size={13} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {error && <div className="text-xs text-status-error">{error}</div>}

        {document && (
          <>
            {(document.inputs?.length || document.outputs?.length) && (
              <div className="space-y-1">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
                  Contract
                </div>
                <div className="font-mono text-[10px] text-muted-foreground break-words">
                  ({document.inputs?.map((input) => `${input.name}: ${input.type}`).join(', ') || 'no inputs'}
                  ) → {'{'}
                  {document.outputs?.join(', ') || 'nothing'}
                  {'}'}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
                Steps
              </div>
              <Steps steps={document.steps} callsByCell={callsByCell} />
            </div>
          </>
        )}
      </div>

      <div className="p-3 border-t border-border">
        <Button size="sm" className="w-full h-7 text-[11px]" onClick={onOpen}>
          <ArrowSquareOut size={12} className="mr-1.5" />
          Open in editor
        </Button>
      </div>
    </aside>
  );
}
