import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  type Node,
} from '@xyflow/react';
// The map is the only thing left that draws with xyflow, so it owns the stylesheet.
// It used to arrive through the canvas, and went with it — leaving the zoom controls
// unpositioned and stretched across the top of the map.
import '@xyflow/react/dist/style.css';
import { ArrowClockwise, ArrowSquareOut, CaretLeft, MapTrifold } from '@phosphor-icons/react';
import type { NotebookJson, NotebookRunDetail } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { useNotebookMap } from '../../hooks/useNotebookMap';
import { useRunActivity } from '../../hooks/useRunActivity';
import { useRunCells } from '../../hooks/useRunCells';
import { notebooksApi } from '../../lib/notebooks-api';
import {
  buildMapGraph,
  buildNotebookGraph,
  type CellNodeData,
  type NotebookNodeData,
} from '../../lib/map-graph';
import { RunReplayPicker } from './RunReplayPicker';
import { CellResultPanel } from './CellResultPanel';
import { BandTitles, MapLegend, MapSearch, StandaloneToggle } from './MapControls';
import {
  MapCallOutNode,
  MapCellNode,
  MapNotebookNode,
  MapTriggerNode,
  MapUnresolvedNode,
} from './MapNodes';

/**
 * The system, as the notebooks describe it.
 *
 * This is what the node canvas became. The canvas was the source — you drew it and it
 * ran — so it could never be wrong and could never summarise. This is a projection:
 * nothing here is authored, every arrow is a `notebooks.run` somewhere in a cell, and
 * it costs nothing to keep true.
 *
 * Two altitudes, and you travel between them by clicking. The system is a graph because
 * notebooks call notebooks. Inside one, the drawing is a chain that forks at a parallel
 * group and joins again, because that is the only branching a notebook has.
 */

// Defined once, outside the component — xyflow remounts every node if this identity
// changes, which loses selection and viewport on each render.
const nodeTypes = {
  mapNotebook: MapNotebookNode,
  mapTrigger: MapTriggerNode,
  mapUnresolved: MapUnresolvedNode,
  mapCell: MapCellNode,
  mapCallOut: MapCallOutNode,
};

interface SystemMapProps {
  onOpenNotebook: (id: string) => void;
}

function MapCanvas({ onOpenNotebook }: SystemMapProps) {
  const { map, isLoading, error, refresh, live } = useNotebookMap();
  const activity = useRunActivity(true);
  const { fitView } = useReactFlow();

  /** Which notebook is being looked inside; undefined means the system level. */
  const [inside, setInside] = useState<string | undefined>();
  const [document, setDocument] = useState<NotebookJson | null>(null);
  const [insideError, setInsideError] = useState<string | null>(null);
  /** Typed at the system level: dims everything that is not a match or next to one. */
  const [query, setQuery] = useState('');
  /**
   * Whether the notebooks joined to nothing are drawn.
   *
   * Off by default. Twenty-nine of thirty-three have no trigger, no caller and call
   * nobody, and drawing them among the four that matter is what made the map 4531px tall.
   */
  const [showStandalone, setShowStandalone] = useState(false);
  /** A past run laid over the drawing; undefined means live. */
  const [replayRunId, setReplayRunId] = useState<string | undefined>();
  const [replay, setReplay] = useState<NotebookRunDetail | null>(null);
  const [openCellId, setOpenCellId] = useState<string | undefined>();

  useEffect(() => {
    if (!inside) {
      setDocument(null);
      return;
    }
    let cancelled = false;
    setDocument(null);
    setInsideError(null);
    setReplayRunId(undefined);
    setOpenCellId(undefined);

    notebooksApi
      .getById(inside)
      .then((loaded) => !cancelled && setDocument(loaded))
      .catch((err: unknown) => !cancelled && setInsideError((err as Error).message));

    return () => {
      cancelled = true;
    };
  }, [inside]);

  const nameOf = useCallback(
    (notebookId: string) => map?.notebooks.find((entry) => entry.id === notebookId)?.name,
    [map]
  );

  const graph = useMemo(() => {
    if (inside && document) {
      return {
        ...buildNotebookGraph(
          document,
          (map?.calls ?? []).filter((call) => call.fromNotebookId === inside),
          nameOf
        ),
        standaloneCount: 0,
        bands: [],
      };
    }
    return map
      ? buildMapGraph(map, { showStandalone })
      : { nodes: [], edges: [], standaloneCount: 0, bands: [] };
  }, [map, inside, document, nameOf, showStandalone]);

  /**
   * What a search lights up: the matches, and whatever they are joined to.
   *
   * The neighbours are the point. "Where is the notebook that touches Xendit" is rarely
   * the whole question — the next one is always "and what sets it off", and a search that
   * dims the trigger firing the thing you searched for has answered half of it.
   *
   * Null when nothing is typed, which is different from "nothing matched": one means draw
   * everything normally, the other means draw everything dimmed, and a search with no
   * hits should look like a search with no hits.
   */
  const lit = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '' || !map) return null;

    const hits = new Set(
      map.notebooks
        .filter((notebook) => notebook.name.toLowerCase().includes(needle))
        .map((notebook) => `notebook-${notebook.id}`)
    );

    const withNeighbours = new Set(hits);
    for (const edge of graph.edges) {
      if (hits.has(edge.source)) withNeighbours.add(edge.target);
      if (hits.has(edge.target)) withNeighbours.add(edge.source);
    }
    return { hits, withNeighbours };
  }, [query, map, graph.edges]);

  // While you are looking inside a notebook that happens to be running, follow that run
  // properly: the watch channel says only that it is busy, but it hands over the run id,
  // and the per-run channel is allowed to say which cell.
  const liveRunId = inside && !replayRunId ? activity[inside]?.runId : undefined;
  const cellActivity = useRunCells(liveRunId);

  useEffect(() => {
    if (!inside || !replayRunId) {
      setReplay(null);
      return;
    }
    let cancelled = false;
    notebooksApi
      .getRun(inside, replayRunId)
      .then((loaded) => !cancelled && setReplay(loaded))
      .catch(() => !cancelled && setReplay(null));
    return () => {
      cancelled = true;
    };
  }, [inside, replayRunId]);

  /** Replay wins over live: you asked to look at a particular run. */
  const cellStatus = useMemo((): Record<string, 'running' | 'done' | 'error'> => {
    if (!replay) return cellActivity;
    const statuses: Record<string, 'running' | 'done' | 'error'> = {};
    for (const [cellId, result] of Object.entries(replay.cell_results ?? {})) {
      statuses[cellId] = result.error ? 'error' : 'done';
    }
    return statuses;
  }, [replay, cellActivity]);

  // Status is merged in afterwards rather than folded into the layout, so a run lighting
  // the map up never moves a box.
  const nodes = useMemo(
    () =>
      graph.nodes.map((node) => {
        if (node.type === 'mapNotebook') {
          const data = node.data as NotebookNodeData;
          const status = activity[data.notebook.id]?.status;
          const dimmed = lit ? !lit.withNeighbours.has(node.id) : false;
          return status === data.status && dimmed === data.dimmed
            ? node
            : { ...node, data: { ...data, status, dimmed } };
        }

        if (node.type === 'mapCell') {
          const data = node.data as CellNodeData;
          const cellId = node.id.slice('cell-'.length);
          const status = cellStatus[cellId];
          const ms = replay?.cell_results?.[cellId]?.ms;
          return status === data.status && ms === data.ms
            ? node
            : { ...node, data: { ...data, status, ms } };
        }

        // Triggers and unresolved calls dim with whatever they are attached to, so a
        // search never leaves a bright arrow pointing at a faded box.
        if (lit) {
          const dimmed = !lit.withNeighbours.has(node.id);
          return dimmed === node.data.dimmed ? node : { ...node, data: { ...node.data, dimmed } };
        }
        return node.data.dimmed ? { ...node, data: { ...node.data, dimmed: false } } : node;
      }),
    [graph.nodes, activity, cellStatus, replay, lit]
  );

  // Changing altitude replaces the whole layout, and the viewport has to follow or you
  // are left looking at empty space where the last one was. The first fit is the
  // `fitView` prop below; this handles every one after it, two frames later so the new
  // nodes have been laid out and measured.
  useEffect(() => {
    if (graph.nodes.length === 0) return;
    let cancelled = false;

    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!cancelled) void fitView({ padding: 0.15, duration: 200 });
      })
    );

    return () => {
      cancelled = true;
    };
  }, [graph.nodes, fitView]);

  const insideName = inside ? nameOf(inside) : undefined;

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.id.startsWith('notebook-')) {
        setInside(node.id.slice('notebook-'.length));
        return;
      }
      if (node.id.startsWith('trigger-')) {
        const trigger = map?.triggers.find((entry) => `trigger-${entry.id}` === node.id);
        if (trigger) setInside(trigger.notebookId);
        return;
      }
      if (node.id.startsWith('callout-')) {
        const target = (node.data as { notebookId?: string }).notebookId;
        if (target) setInside(target);
        return;
      }
      if (node.id.startsWith('cell-')) {
        setOpenCellId(replayRunId ? node.id.slice('cell-'.length) : undefined);
      }
    },
    [map, replayRunId]
  );

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.id.startsWith('notebook-')) onOpenNotebook(node.id.slice('notebook-'.length));
      else if (inside) onOpenNotebook(inside);
    },
    [inside, onOpenNotebook]
  );

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <span>Could not read the map: {error}</span>
        <Button size="sm" variant="outline" onClick={() => void refresh()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!isLoading && map && map.notebooks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8">
        <MapTrifold size={28} weight="duotone" className="text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">Nothing to map yet.</p>
        <p className="text-xs text-muted-foreground/70 max-w-sm">
          This draws itself from your notebooks — their triggers, their contracts, and the
          calls between them. Write one and it appears here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* A bar rather than a floating overlay: at the system level the leftmost trigger
          sits at the edge of the fitted viewport, and anything floating covers it. */}
      {/* Wraps rather than overflowing. FX3 fixed exactly this in the editor and FX6
          reintroduced it here: adding a search box and a toggle pushed "Hide the
          unconnected" off the right edge of a 375px screen, unreachable. */}
      <div className="min-h-9 shrink-0 border-b border-border bg-muted/20 flex flex-wrap items-center gap-1.5 px-2 py-1">
        <div className="flex items-center border border-border bg-background">
          <button
            type="button"
            onClick={() => setInside(undefined)}
            className={
              inside
                ? 'h-6 px-2.5 text-[11px] text-muted-foreground hover:text-foreground flex items-center'
                : 'h-6 px-2.5 text-[11px] bg-primary/15 text-primary font-medium flex items-center'
            }
          >
            {inside && <CaretLeft size={11} className="mr-1" weight="bold" />}
            System
          </button>
          {inside && (
            <span className="h-6 px-2.5 text-[11px] bg-primary/15 text-primary font-medium flex items-center border-l border-border max-w-[220px] truncate">
              {insideName ?? 'Notebook'}
            </span>
          )}
        </div>

        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => void refresh()}>
          <ArrowClockwise size={12} className="mr-1.5" />
          {/* The map redraws itself now, so this button is for the case where it cannot:
              the socket is down and Refresh is the only way left to be current. */}
          {isLoading ? 'Reading…' : live ? 'Refresh' : 'Not live — refresh'}
        </Button>

        {/* Only at the system level. Inside a notebook there are six cells, and a search
            box over six things is furniture. */}
        {!inside && (
          <>
            <MapSearch query={query} onQueryChange={setQuery} matches={lit?.hits.size ?? 0} />
            <StandaloneToggle
              count={graph.standaloneCount}
              showing={showStandalone}
              onChange={setShowStandalone}
            />
          </>
        )}

        {inside && (
          <RunReplayPicker
            notebookId={inside}
            value={replayRunId}
            onChange={(next) => {
              setReplayRunId(next);
              setOpenCellId(undefined);
            }}
            refreshKey={activity[inside]?.status}
          />
        )}

        {inside && (
          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => onOpenNotebook(inside)}>
            <ArrowSquareOut size={12} className="mr-1.5" />
            Open in editor
          </Button>
        )}

        {/* The hint is the first thing to go when the row is tight: it explains what a
            click does, and a click is discoverable without it. */}
        <span className="ml-auto hidden truncate text-[10px] text-muted-foreground/70 lg:inline">
          {inside
            ? insideError
              ? `Could not read it: ${insideError}`
              : replayRunId
                ? 'Showing a past run · click a cell to see what it did'
                : 'Click a call to follow it · double-click to edit'
            : 'Derived from your notebooks · click to look inside · double-click to edit'}
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative min-w-0">
          <ReactFlow
            nodes={nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            fitView
            // Capped, because fitting twenty-nine notebooks without a limit zooms until
            // every label is a grey smudge — a view that technically shows everything and
            // lets you read none of it.
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.2}
            nodesDraggable={false}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls showInteractive={false} />

            {/* Inside the viewport rather than over it, so the titles pan and zoom with
                the boxes they name. Fixed to the frame they would start lying the moment
                you scrolled. */}
            {!inside && (
              <ViewportPortal>
                <BandTitles bands={graph.bands} />
              </ViewportPortal>
            )}

            {/* Top right. Bottom left put it on top of the last band — a minimap that
                covers the thing it is a map of. */}
            {!inside && (
              <MiniMap
                pannable
                zoomable
                // Left at its own size. Forcing the container smaller than the SVG it
                // draws showed the empty top-left corner of a bigger picture — which
                // looks exactly like a minimap of an empty workspace, and I nearly
                // shipped it as one.
                nodeStrokeWidth={2}
                // Given explicitly: the boxes are styled by class, and a minimap reading
                // computed background off a bordered div drew thirty white rectangles on
                // white — a minimap of nothing.
                nodeColor={(node) =>
                  node.type === 'mapTrigger'
                    ? 'var(--color-primary)'
                    : node.type === 'mapUnresolved'
                      ? 'var(--color-status-error)'
                      : 'var(--color-muted-foreground)'
                }
                // Hidden on a phone: 200×150 of overview on a 375px screen costs more
                // room than the overview is worth.
                className="!right-3 !top-3 !bottom-auto !left-auto !m-0 hidden !border !border-border !bg-background/90 sm:!block"
              />
            )}
          </ReactFlow>

          {!inside && <MapLegend />}
        </div>

        {openCellId && (
          <CellResultPanel
            title={
              (graph.nodes.find((node) => node.id === `cell-${openCellId}`)?.data as CellNodeData)
                ?.label ?? openCellId
            }
            result={replay?.cell_results?.[openCellId]}
            onClose={() => setOpenCellId(undefined)}
          />
        )}
      </div>
    </div>
  );
}

export function SystemMap(props: SystemMapProps) {
  return (
    <ReactFlowProvider>
      <MapCanvas {...props} />
    </ReactFlowProvider>
  );
}
