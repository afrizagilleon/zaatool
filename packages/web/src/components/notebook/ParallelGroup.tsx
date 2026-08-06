import { useEffect, useState } from 'react';
import {
  ArrowsMerge,
  ArrowsSplit,
  CaretLeft,
  CaretRight,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react';
import type { NotebookLane, ParallelStep } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface ParallelGroupProps {
  group: ParallelStep;
  /** 0 at the top level, 1 inside a lane, and so on. Drives the nesting cues. */
  depth: number;
  onAddLane: () => void;
  onRemoveLane: (laneId: string) => void;
  onRenameLane: (laneId: string, label: string) => void;
  onRemoveGroup: () => void;
  onAddCell: (laneId: string) => void;
  onAddGroup: (laneId: string) => void;
  renderLane: (lane: NotebookLane) => React.ReactNode;
}

/**
 * Lanes run at the same time, so only one is shown at a time and the arrows step
 * between them — a notebook stays a single readable column instead of fanning out.
 *
 * Two things the code cannot say, so the drawing has to. First, the group **forks and
 * joins**: a bar above the lanes and a bar below them, because "merge at the end" was
 * a sentence in a header that nobody had reason to believe. Second, a group inside a
 * lane is *inside* it — nesting used to render flat, two identical bars stacked, which
 * made a structure agents write freely look impossible to build by hand.
 */
export function ParallelGroup({
  group,
  depth,
  onAddLane,
  onRemoveLane,
  onRenameLane,
  onRemoveGroup,
  onAddCell,
  onAddGroup,
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

  const laneName = activeLane.label || `Lane ${activeIndex + 1}`;
  const isNested = depth > 0;

  return (
    <div
      id={`step-${group.id}`}
      className={cn(
        'border border-border',
        // A nested group sits on a darker ground than the lane holding it, so two
        // levels read as two levels rather than as two siblings.
        isNested ? 'bg-muted/45' : 'bg-muted/20'
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 px-2 h-8 border-b border-border bg-muted/40 sm:gap-2">
        <ArrowsSplit size={13} className="text-muted-foreground shrink-0" />
        <span className="hidden shrink-0 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground sm:inline">
          Parallel
        </span>
        {isNested && (
          <span
            className="px-1 text-[9px] font-semibold uppercase tracking-wider text-primary/80 bg-primary/10 shrink-0"
            title="This group is inside a lane of the group above it"
          >
            nested
          </span>
        )}

        <div className="flex min-w-0 shrink items-center gap-0.5">
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
              className="min-w-0 max-w-[6rem] truncate px-1.5 text-[11px] font-semibold text-foreground hover:underline sm:max-w-[10rem]"
              title="Click to rename this lane"
            >
              {laneName}
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
                index === activeIndex
                  ? 'bg-primary'
                  : 'bg-muted-foreground/30 hover:bg-muted-foreground/60'
              )}
            />
          ))}
        </div>

        {/* `truncate` alone does not shrink inside a flex row — the default `min-width:
            auto` keeps it at its full sentence width, which is what pushed every button
            after it past the right edge. `min-w-0` is what makes the ellipsis work, and
            below `lg` the sentence is gone entirely: it is an explanation, and there is
            no room to explain anything on a phone. */}
        <span className="hidden min-w-0 truncate text-[9px] text-muted-foreground/60 lg:inline">
          {group.lanes.length} lanes start together · each reads the scope as it is now, and
          writes privately
        </span>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] text-muted-foreground shrink-0"
          title="Add a lane to this group"
          onClick={onAddLane}
        >
          <Plus size={10} />
          <span className="ml-1 hidden sm:inline">Lane</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="w-5 h-5 text-muted-foreground shrink-0"
          title={group.lanes.length <= 1 ? 'Remove group' : `Remove ${laneName}`}
          onClick={() => onRemoveLane(activeLane.id)}
        >
          <X size={11} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="w-5 h-5 text-destructive shrink-0"
          title="Remove the whole group"
          onClick={onRemoveGroup}
        >
          <Trash size={11} />
        </Button>
      </div>

      <div className="p-2">
        {/* The rail is the lane's extent. A group nested inside draws its own, so how
            deep something sits is countable rather than inferred. */}
        <div className="border-l-2 border-primary/25 pl-2 space-y-2">
          {renderLane(activeLane)}

          <div className="flex items-center justify-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-2 text-[10px] text-muted-foreground"
              onClick={() => onAddCell(activeLane.id)}
            >
              <Plus size={10} className="mr-1" />
              Cell in {laneName}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-2 text-[10px] text-muted-foreground"
              title={`Fork ${laneName} again — lanes inside this lane`}
              onClick={() => onAddGroup(activeLane.id)}
            >
              <ArrowsSplit size={10} className="mr-1" />
              Lanes in {laneName}
            </Button>
          </div>
        </div>
      </div>

      {/* The join. Without it, "merge at the end" was a claim in a tooltip with nothing
          on screen to back it — and the first person to read it doubted it. */}
      <div className="flex items-center gap-1.5 px-2 h-6 border-t border-border bg-muted/40">
        <ArrowsMerge size={12} className="text-muted-foreground shrink-0" />
        <span className="text-[9px] text-muted-foreground/70 truncate">
          all {group.lanes.length} lanes finish here, and what each one wrote merges into
          scope — the next step waits for the slowest
        </span>
      </div>
    </div>
  );
}
