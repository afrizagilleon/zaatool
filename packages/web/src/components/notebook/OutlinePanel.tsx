import { useState } from 'react';
import { MagnifyingGlass, ListChecks, CaretUp, CaretDown } from '@phosphor-icons/react';
import type { NotebookStep } from '@zaa-tool/shared';
import { Input } from '../ui/input';
import { Button } from '../ui/button';

export interface OutlineEntry {
  cellId: string;
  laneId?: string;
  laneLabel?: string;
  title: string;
  code: string;
}

function extractOutline(steps: NotebookStep[], laneId?: string, laneLabel?: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const step of steps) {
    if (step.kind === 'parallel') {
      for (const branch of step.lanes ?? []) {
        entries.push(
          ...extractOutline(branch.steps, branch.id, branch.label || branch.id)
        );
      }
    } else {
      const noteFirstLine = (step.note ?? '')
        .split('\n')
        .map((l) => l.replace(/^#+\s*/, '').trim())
        .find((l) => l.length > 0) || `Cell ${step.id.slice(0, 8)}`;

      entries.push({
        cellId: step.id,
        laneId,
        laneLabel,
        title: noteFirstLine,
        code: step.code ?? '',
      });
    }
  }
  return entries;
}

export function OutlinePanel({
  steps,
  onFoldLane,
  onSelectCell,
}: {
  steps: NotebookStep[];
  onFoldLane?: (laneId: string, fold: boolean) => void;
  onSelectCell?: (cellId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [foldedLanes, setFoldedLanes] = useState<Record<string, boolean>>({});

  const entries = extractOutline(steps);
  const filtered = entries.filter((entry) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      entry.title.toLowerCase().includes(q) ||
      entry.code.toLowerCase().includes(q) ||
      entry.cellId.toLowerCase().includes(q) ||
      (entry.laneLabel && entry.laneLabel.toLowerCase().includes(q))
    );
  });

  const laneGroups = new Map<string, { label: string; entries: OutlineEntry[] }>();
  for (const entry of filtered) {
    if (entry.laneId) {
      const group = laneGroups.get(entry.laneId) || {
        label: entry.laneLabel || entry.laneId,
        entries: [],
      };
      group.entries.push(entry);
      laneGroups.set(entry.laneId, group);
    }
  }

  const toggleLaneFold = (laneId: string) => {
    const nextState = !foldedLanes[laneId];
    setFoldedLanes((prev) => ({ ...prev, [laneId]: nextState }));
    if (onFoldLane) {
      onFoldLane(laneId, nextState);
    }
  };

  return (
    <div className="w-80 space-y-3 p-3 text-xs" data-testid="outline-panel">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <ListChecks size={14} className="text-muted-foreground" />
        <span className="font-semibold">Notebook Outline</span>
        <span className="text-[10px] text-muted-foreground">({filtered.length} cells)</span>
      </div>

      <div className="relative">
        <MagnifyingGlass
          size={12}
          className="absolute left-2.5 top-2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cells or code…"
          className="h-7 pl-7 text-xs"
        />
      </div>

      {Array.from(laneGroups.entries()).length > 0 && (
        <div className="space-y-1.5 border-b border-border pb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Lanes ({laneGroups.size})
          </span>
          <div className="flex flex-wrap gap-1">
            {Array.from(laneGroups.entries()).map(([laneId, group]) => {
              const isFolded = Boolean(foldedLanes[laneId]);
              return (
                <Button
                  key={laneId}
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[10px]"
                  onClick={() => toggleLaneFold(laneId)}
                >
                  {isFolded ? <CaretDown size={10} /> : <CaretUp size={10} />}
                  Fold {group.label}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
        {filtered.length === 0 ? (
          <p className="py-2 text-center text-muted-foreground">No cells match search.</p>
        ) : (
          filtered.map((entry) => (
            <button
              key={entry.cellId}
              type="button"
              onClick={() => onSelectCell?.(entry.cellId)}
              className="w-full text-left rounded border border-border/50 p-1.5 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="truncate font-medium">{entry.title}</span>
                {entry.laneLabel && (
                  <span className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground">
                    {entry.laneLabel}
                  </span>
                )}
              </div>
              <span className="font-mono text-[9px] text-muted-foreground">{entry.cellId}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
