import { useEffect, useState } from 'react';
import { CaretLeft, CaretRight, Plus, Trash, StackSimple, X } from '@phosphor-icons/react';
import type { NotebookLane, ParallelStep } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface ParallelGroupProps {
  group: ParallelStep;
  onAddLane: () => void;
  onRemoveLane: (laneId: string) => void;
  onRenameLane: (laneId: string, label: string) => void;
  onRemoveGroup: () => void;
  onAddCell: (laneId: string) => void;
  renderLane: (lane: NotebookLane) => React.ReactNode;
}

/**
 * Lanes run at the same time, so only one is shown at a time and the arrows step
 * between them — a notebook stays a single readable column instead of fanning out.
 *
 * The bar is deliberately explicit about the contract: lanes read the shared scope,
 * write privately, and merge at the join. That rule is invisible in the code itself,
 * so the UI has to carry it.
 */
export function ParallelGroup({
  group,
  onAddLane,
  onRemoveLane,
  onRenameLane,
  onRemoveGroup,
  onAddCell,
  renderLane,
}: ParallelGroupProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [renamingLaneId, setRenamingLaneId] = useState<string | null>(null);

  // Removing a lane can leave the index past the end.
  useEffect(() => {
    if (activeIndex > group.lanes.length - 1) setActiveIndex(Math.max(0, group.lanes.length - 1));
  }, [group.lanes.length, activeIndex]);

  const activeLane = group.lanes[Math.min(activeIndex, group.lanes.length - 1)];
  if (!activeLane) return null;

  const step = (delta: number) => {
    const next = activeIndex + delta;
    if (next < 0 || next >= group.lanes.length) return;
    setActiveIndex(next);
  };

  return (
    <div className="border border-border bg-muted/20">
      <div className="flex items-center gap-2 px-2 h-8 border-b border-border bg-muted/40">
        <StackSimple size={13} className="text-muted-foreground shrink-0" />
        <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground shrink-0">
          Parallel
        </span>

        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="w-5 h-5"
            title="Previous lane"
            onClick={() => step(-1)}
            disabled={activeIndex === 0}
          >
            <CaretLeft size={11} weight="bold" />
          </Button>

          {renamingLaneId === activeLane.id ? (
            <input
              value={activeLane.label ?? ''}
              onChange={(e) => onRenameLane(activeLane.id, e.target.value)}
              onBlur={() => setRenamingLaneId(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') setRenamingLaneId(null);
              }}
              className="h-5 w-28 px-1 text-[11px] font-semibold bg-background border border-border outline-none"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => setRenamingLaneId(activeLane.id)}
              className="px-1.5 text-[11px] font-semibold text-foreground hover:underline max-w-[10rem] truncate"
              title="Click to rename this lane"
            >
              {activeLane.label || `Lane ${activeIndex + 1}`}
            </button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="w-5 h-5"
            title="Next lane"
            onClick={() => step(1)}
            disabled={activeIndex >= group.lanes.length - 1}
          >
            <CaretRight size={11} weight="bold" />
          </Button>
        </div>

        {/* Dots make the lane count visible without listing every lane. */}
        <div className="flex items-center gap-1 shrink-0">
          {group.lanes.map((lane, index) => (
            <button
              key={lane.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              title={lane.label || `Lane ${index + 1}`}
              className={cn(
                'w-1.5 h-1.5 transition-colors',
                index === activeIndex ? 'bg-primary' : 'bg-muted-foreground/30 hover:bg-muted-foreground/60'
              )}
            />
          ))}
        </div>

        <span className="text-[9px] text-muted-foreground/60 truncate">
          lanes run together · read shared scope, write privately, merge at the end
        </span>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] text-muted-foreground shrink-0"
          title="Add a lane"
          onClick={onAddLane}
        >
          <Plus size={10} className="mr-1" />
          Lane
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="w-5 h-5 text-muted-foreground shrink-0"
          title={group.lanes.length <= 1 ? 'Remove group' : 'Remove this lane'}
          onClick={() => onRemoveLane(activeLane.id)}
        >
          <X size={11} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="w-5 h-5 text-red-400 hover:text-red-300 shrink-0"
          title="Remove the whole group"
          onClick={onRemoveGroup}
        >
          <Trash size={11} />
        </Button>
      </div>

      <div className="p-2 space-y-2">
        {renderLane(activeLane)}

        <div className="flex items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-2 text-[10px] text-muted-foreground"
            onClick={() => onAddCell(activeLane.id)}
          >
            <Plus size={10} className="mr-1" />
            Add cell to {activeLane.label || `lane ${activeIndex + 1}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
