import { useRef, useCallback, useEffect, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  useOnViewportChange,
} from '@xyflow/react';
import type { Connection, Edge, ColorMode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useFlowStore, generateNodeId } from '../../store/flowStore';
import { useUiStore } from '../../store/uiStore';
import { useEngineStore } from '../../store/engineStore';
import { useAutoLayout } from '../../hooks/useAutoLayout.js';
import { useNavbarActions } from '../../hooks/useNavbarActions.js';
import type { SchemaField } from '@zaa-tool/shared';

import { nodeTypes, defaultNodeData } from './canvasConfig';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasSearch } from './CanvasSearch';
import { CanvasRunButton } from './CanvasRunButton';
import { useFlowSave } from '../../hooks/useFlowSave';

export function FlowCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const onConnectStore = useFlowStore((s) => s.onConnect);
  const addNode = useFlowStore((s) => s.addNode);
  const setActiveNodeId = useFlowStore((s) => s.setActiveNodeId);

  const isDarkMode = useUiStore((s) => s.isDarkMode);
  const setCodePanelOpen = useUiStore((s) => s.setCodePanelOpen);
  const isNodePaletteOpen = useUiStore((s) => s.isNodePaletteOpen);
  const toggleNodePalette = useUiStore((s) => s.toggleNodePalette);
  const isConsolePanelOpen = useUiStore((s) => s.isConsolePanelOpen);
  const toggleConsolePanel = useUiStore((s) => s.toggleConsolePanel);
  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const setLayoutDirection = useUiStore((s) => s.setLayoutDirection);

  const isRunning = useEngineStore((s) => s.isRunning);
  const autoLayout = useAutoLayout();
  const { run } = useNavbarActions();

  const { screenToFlowPosition, setViewport, setCenter } = useReactFlow();
  const setStoreViewport = useFlowStore((s) => s.setViewport);
  const flowId = useFlowStore((s) => s.id);
  const flowName = useFlowStore((s) => s.name);
  const getGraphJson = useFlowStore((s) => s.getGraphJson);

  useFlowSave({ flowId, flowName, getGraphJson, nodes, edges });

  // Viewport restore race condition fix
  const isViewportRestored = useRef(false);

  useOnViewportChange({
    onChange: (viewport) => {
      if (isViewportRestored.current) {
        setStoreViewport(viewport);
      }
    },
  });

  // Restore Viewport on Mount with delay
  useEffect(() => {
    isViewportRestored.current = false;
    const storeViewport = useFlowStore.getState().viewport;
    const timer = setTimeout(() => {
      if (storeViewport) {
        setViewport(storeViewport);
      }
      isViewportRestored.current = true;
    }, 100);
    return () => clearTimeout(timer);
  }, [setViewport, flowId]);

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const { source, target, sourceHandle, targetHandle } = connection;
    if (!source || !target || !sourceHandle || !targetHandle) return false;
    if (source === target) return false;

    const state = useFlowStore.getState();
    const sourceNode = state.nodes.find((n) => n.id === source);
    const targetNode = state.nodes.find((n) => n.id === target);

    if (!sourceNode || !targetNode) return false;

    const outField = sourceNode.data.outputsSchema?.find((f: SchemaField) => f.name === sourceHandle);
    const inField = targetNode.data.inputsSchema?.find((f: SchemaField) => f.name === targetHandle);

    if (!outField || !inField) return false;

    const isCompatibleType = (a: string, b: string) => {
      if (a === b) return true;
      if (a === 'object' || b === 'object' || a === 'any' || b === 'any') return true;
      const stringTypes = ['string', 'file', 'image'];
      if (stringTypes.includes(a) && stringTypes.includes(b)) return true;
      return false;
    };

    return isCompatibleType(outField.type, inField.type);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const rawData = event.dataTransfer.getData('application/reactflow');
      if (!rawData) return;

      let type: string;
      let runtime: string | undefined;
      let label: string | undefined;

      try {
        const parsed = JSON.parse(rawData);
        type = parsed.type;
        runtime = parsed.runtime;
        label = parsed.label;
      } catch {
        type = rawData;
      }

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      const dataKey = `${type}:${runtime ?? ''}`;
      const dataFactory = defaultNodeData[dataKey] ?? defaultNodeData[`${type}:`];

      if (!dataFactory) return;

      const nodeData = dataFactory();
      if (label) nodeData.label = label;

      addNode({ id: generateNodeId(), type, position, data: nodeData });
    },
    [addNode, screenToFlowPosition],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => {
      setActiveNodeId(node.id);
      setCodePanelOpen(true);
    },
    [setActiveNodeId, setCodePanelOpen],
  );

  const handlePaneClick = useCallback(() => {
    setActiveNodeId(null);
  }, [setActiveNodeId]);

  const colorMode: ColorMode = isDarkMode ? 'dark' : 'light';

  return (
    <div id="flow-canvas-wrapper" className="flex-1 h-full" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectStore}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        colorMode={colorMode}
        defaultViewport={useFlowStore.getState().viewport}
        minZoom={0.05}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{ type: 'smoothstep', animated: false }}
        proOptions={{ hideAttribution: true }}
      >
        <CanvasToolbar
          isNodePaletteOpen={isNodePaletteOpen}
          toggleNodePalette={toggleNodePalette}
          layoutDirection={layoutDirection}
          setLayoutDirection={setLayoutDirection}
          autoLayout={autoLayout}
          isConsolePanelOpen={isConsolePanelOpen}
          toggleConsolePanel={toggleConsolePanel}
        />

        <CanvasSearch
          nodes={nodes}
          setActiveNodeId={setActiveNodeId}
          setCodePanelOpen={setCodePanelOpen}
          setCenter={setCenter}
        />

        <CanvasRunButton isRunning={isRunning} onRun={run} />

        <Background
          variant={BackgroundVariant.Dots}
          gap={40}
          size={2.5}
          className="!bg-canvas-bg"
          color="var(--canvas-dot)"
        />
        <Controls showInteractive={false} position="bottom-left" className="!m-3" />
        <MiniMap
          position="bottom-right"
          className="!m-3"
          pannable
          zoomable
          maskColor={isDarkMode ? 'rgba(0,0,0,0.7)' : 'rgba(200,200,215,0.4)'}
          nodeColor={(node) => {
            switch (node.type) {
              case 'if':
                return 'var(--node-if)';
              case 'loop':
                return 'var(--node-loop)';
              default:
                return node.data?.runtime === 'python' ? 'var(--node-code-py)' : 'var(--node-code)';
            }
          }}
        />
      </ReactFlow>
    </div>
  );
}
