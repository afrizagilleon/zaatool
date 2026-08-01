import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Node,
} from '@xyflow/react';
import { ArrowClockwise, ArrowSquareOut, CaretLeft, MapTrifold } from '@phosphor-icons/react';
import type { NotebookJson } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { useNotebookMap } from '../../hooks/useNotebookMap';
import { useRunActivity } from '../../hooks/useRunActivity';
import { notebooksApi } from '../../lib/notebooks-api';
import { buildMapGraph, buildNotebookGraph, type NotebookNodeData } from '../../lib/map-graph';
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
  const { map, isLoading, error, refresh } = useNotebookMap();
  const activity = useRunActivity(true);
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  /** Which notebook is being looked inside; undefined means the system level. */
  const [inside, setInside] = useState<string | undefined>();
  const [document, setDocument] = useState<NotebookJson | null>(null);
  const [insideError, setInsideError] = useState<string | null>(null);

  useEffect(() => {
    if (!inside) {
      setDocument(null);
      return;
    }
    let cancelled = false;
    setDocument(null);
    setInsideError(null);

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
      return buildNotebookGraph(
        document,
        (map?.calls ?? []).filter((call) => call.fromNotebookId === inside),
        nameOf
      );
    }
    return map ? buildMapGraph(map) : { nodes: [], edges: [] };
  }, [map, inside, document, nameOf]);

  // Status is merged in afterwards rather than folded into the layout, so a run lighting
  // the map up never moves a box.
  const nodes = useMemo(
    () =>
      graph.nodes.map((node) => {
        if (node.type !== 'mapNotebook') return node;
        const data = node.data as NotebookNodeData;
        const status = activity[data.notebook.id];
        return status === data.status ? node : { ...node, data: { ...data, status } };
      }),
    [graph.nodes, activity]
  );

  // A new layout needs a new viewport; without this, drilling in leaves you looking at
  // empty space where the system used to be. It waits for `nodesInitialized` because
  // fitting before the nodes have been measured fits to the wrong box, and a tall
  // notebook ends up running off both ends of the screen.
  useEffect(() => {
    if (!nodesInitialized || graph.nodes.length === 0) return;
    void fitView({ padding: 0.15, duration: 200 });
  }, [nodesInitialized, graph.nodes, fitView]);

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
      }
    },
    [map]
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
      <div className="h-9 shrink-0 border-b border-border bg-muted/20 flex items-center gap-1.5 px-2">
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
          {isLoading ? 'Reading…' : 'Refresh'}
        </Button>

        {inside && (
          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => onOpenNotebook(inside)}>
            <ArrowSquareOut size={12} className="mr-1.5" />
            Open in editor
          </Button>
        )}

        <span className="ml-auto text-[10px] text-muted-foreground/70 truncate">
          {inside
            ? insideError
              ? `Could not read it: ${insideError}`
              : 'Click a call to follow it · double-click to edit'
            : 'Derived from your notebooks · click to look inside · double-click to edit'}
        </span>
      </div>

      <div className="flex-1 relative min-h-0">
      <ReactFlow
        nodes={nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
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
