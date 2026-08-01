import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Node,
} from '@xyflow/react';
import { ArrowClockwise, MapTrifold } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { useNotebookMap } from '../../hooks/useNotebookMap';
import { useRunActivity } from '../../hooks/useRunActivity';
import { buildMapGraph, type NotebookNodeData } from '../../lib/map-graph';
import { MapNotebookNode, MapTriggerNode, MapUnresolvedNode } from './MapNodes';
import { NotebookStructure } from './NotebookStructure';

/**
 * The system, as the notebooks describe it.
 *
 * This is what the node canvas became. The canvas was the source — you drew it and it
 * ran — so it could never be wrong and could never summarise. This is a projection:
 * nothing here is authored, every arrow is a `notebooks.run` somewhere in a cell, and
 * it costs nothing to keep true.
 *
 * Doubling as a navigator is the part that makes it worth opening: pick a notebook to
 * see its shape, or go straight to editing it.
 */

// Defined once, outside the component — xyflow remounts every node if this identity
// changes, which loses selection on each render.
const nodeTypes = {
  mapNotebook: MapNotebookNode,
  mapTrigger: MapTriggerNode,
  mapUnresolved: MapUnresolvedNode,
};

interface SystemMapProps {
  onOpenNotebook: (id: string) => void;
  selectedNotebookId?: string;
  onSelectNotebook: (id: string | undefined) => void;
}

function MapCanvas({ onOpenNotebook, selectedNotebookId, onSelectNotebook }: SystemMapProps) {
  const { map, isLoading, error, refresh } = useNotebookMap();

  const activity = useRunActivity(true);
  const graph = useMemo(() => (map ? buildMapGraph(map) : { nodes: [], edges: [] }), [map]);

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

  const selected = useMemo(
    () => map?.notebooks.find((notebook) => notebook.id === selectedNotebookId),
    [map, selectedNotebookId]
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
    <div className="flex-1 flex min-w-0">
      <div className="flex-1 relative min-w-0">
        <ReactFlow
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_event, node: Node) => {
            const id = node.id.startsWith('notebook-') ? node.id.slice('notebook-'.length) : undefined;
            onSelectNotebook(id);
          }}
          onNodeDoubleClick={(_event, node: Node) => {
            if (node.id.startsWith('notebook-')) onOpenNotebook(node.id.slice('notebook-'.length));
          }}
          onPaneClick={() => onSelectNotebook(undefined)}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>

        <div className="absolute top-3 left-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px] bg-background/90 backdrop-blur"
            onClick={() => void refresh()}
          >
            <ArrowClockwise size={12} className="mr-1.5" />
            {isLoading ? 'Reading…' : 'Refresh'}
          </Button>
          <span className="text-[10px] text-muted-foreground/70">
            Derived from your notebooks · double-click to edit
          </span>
        </div>
      </div>

      {selected && (
        <NotebookStructure
          notebookId={selected.id}
          calls={(map?.calls ?? []).filter((call) => call.fromNotebookId === selected.id)}
          notebookNames={
            new Map((map?.notebooks ?? []).map((notebook) => [notebook.id, notebook.name]))
          }
          onOpen={() => onOpenNotebook(selected.id)}
          onClose={() => onSelectNotebook(undefined)}
        />
      )}
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

export type { NotebookNodeData };
