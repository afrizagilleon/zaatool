import { useMemo, useRef } from 'react';
import { ResponsiveGridLayout, useContainerWidth, type Layout } from 'react-grid-layout';
import type { NotebookLayoutItem, NotebookOutput } from '@zaa-tool/shared';
import { cn } from '../../../lib/utils';
import { GRID_MARGIN_Y, ROW_HEIGHT } from '../../../lib/tile-metrics';
import { derivedLayout } from '../../../lib/page-layout';
// Restored after a lint pass dropped it. v2 positions and sizes a tile inline, so
// losing this does not visibly break the grid — which is exactly why it went unnoticed.
// What it still carries is the placeholder shown while a tile is being dragged, the
// resize-handle art, and the movement transitions. Measured with and without: identical
// geometry, no drop shadow under the tile you are dragging.
import 'react-grid-layout/css/styles.css';

/**
 * The outputs of a page, arranged.
 *
 * Absent an arrangement one is derived — a full-width tile per output, in declaration
 * order — which is right for most notebooks and is why it is the default rather than a
 * step everyone has to take. Dragging is only offered where the notebook can be saved,
 * so a deployed page is read-only by construction.
 *
 * Nothing here can clip. Every tile is a header plus a body that scrolls inside itself,
 * so a tile too short for its table shows less of the table rather than cutting it off
 * at the card's edge. That was the failure mode worth designing against.
 *
 * One column below 768px, twelve above, and the order you arranged is preserved when it
 * collapses — a layout made on a wide screen is never forced onto a narrow one.
 */

const COLUMNS = { lg: 12, sm: 1 } as const;
const BREAKPOINTS = { lg: 768, sm: 0 } as const;

interface PageGridProps {
  outputs: NotebookOutput[];
  layout: NotebookLayoutItem[] | undefined;
  /** Undefined means read-only: no dragging, no resizing. */
  onLayoutChange?: (layout: NotebookLayoutItem[]) => void;
  renderTile: (output: NotebookOutput) => React.ReactNode;
}

export function PageGrid({ outputs, layout, onLayoutChange, renderTile }: PageGridProps) {
  const editable = Boolean(onLayoutChange);
  // v2 does not measure itself; the hook it ships for the purpose does.
  const { width, containerRef } = useContainerWidth();

  /**
   * Arrangements are authored at the wide breakpoint and only saved there.
   *
   * At `sm` there is one column, so every tile is necessarily `w: 1` — writing that back
   * would record "one twelfth wide" and shrink the desktop layout to a sliver the next
   * time it was opened. Narrow screens get a derived single column instead, and never
   * change what was stored.
   */
  const breakpoint = useRef<string>('lg');

  // A stored arrangement only covers what it covers: an output added since is placed
  // underneath rather than dropped, so a new output is never invisible.
  const placed = useMemo(() => {
    const stored = new Map((layout ?? []).map((item) => [item.i, item]));
    const fallback = derivedLayout(outputs);
    let currentY = Math.max(0, ...(layout ?? []).map((item) => item.y + item.h));

    const result: NotebookLayoutItem[] = [];
    for (let index = 0; index < outputs.length; index++) {
      const output = outputs[index];
      const found = stored.get(output.name);
      if (found) {
        result.push(found);
      } else {
        const item = { ...fallback[index], y: currentY };
        currentY += item.h;
        result.push(item);
      }
    }
    return result;
  }, [outputs, layout]);

  return (
    <div ref={containerRef}>
    <ResponsiveGridLayout
      width={width}
      // v2 still renders the resize handle when resizing is off, so a deployed page
      // would show a grip that does nothing. Hidden rather than left to be discovered.
      className={cn('-mx-2', editable ? 'select-none' : 'page-grid-readonly')}
      layouts={{
        lg: placed as Layout,
        sm: placed.map((item, index) => ({ ...item, x: 0, y: index, w: 1 })) as Layout,
      }}
      breakpoints={BREAKPOINTS}
      cols={COLUMNS}
      rowHeight={ROW_HEIGHT}
      margin={[12, GRID_MARGIN_Y]}
      containerPadding={[8, 0]}
      // v2 groups these rather than taking isDraggable/draggableHandle separately.
      dragConfig={{ enabled: editable, handle: '.tile-handle' }}
      // Both bottom corners: a tile pushed to the right edge cannot be reached from
      // the left one alone.
      resizeConfig={{ enabled: editable, handles: ['se', 'sw'] }}
      onBreakpointChange={(next: string) => {
        breakpoint.current = next;
      }}
      onLayoutChange={(next: Layout) => {
        if (!onLayoutChange || breakpoint.current !== 'lg') return;
        onLayoutChange(next.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })));
      }}
    >
      {outputs.map((output) => (
        <div key={output.name} className="flex min-h-0 flex-col border border-border bg-card">
          {renderTile(output)}
        </div>
      ))}
    </ResponsiveGridLayout>
    </div>
  );
}
