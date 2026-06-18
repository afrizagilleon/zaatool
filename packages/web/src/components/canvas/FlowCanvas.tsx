import { useRef, useCallback, useState, useEffect, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  useOnViewportChange,
  Panel,
} from '@xyflow/react';
import type { Connection, Edge, ColorMode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useFlowStore, generateNodeId } from '../../store/flowStore';
import { API_BASE_URL } from '../../lib/api';
import type { FlowNodeData } from '../../store/flowStore';
import { useUiStore } from '../../store/uiStore';
import { useEngineStore } from '../../store/engineStore';
import { useAutoLayout } from '../../hooks/useAutoLayout.js';
import { useNavbarActions } from '../../hooks/useNavbarActions.js';
import { Button } from '../ui/button';
import {
  Play,
  Spinner,
  Sidebar,
  Terminal,
  MagnifyingGlass
} from '@phosphor-icons/react';
import { cn } from '../../lib/utils';

import { CodeNode } from '../nodes/CodeNode';
import { IfNode } from '../nodes/IfNode';
import { LoopNode } from '../nodes/LoopNode';
import { UiInputNode } from '../nodes/UiInputNode';
import { UiTableNode } from '../nodes/UiTableNode';
import { UiChartNode } from '../nodes/UiChartNode';
import { UiTextNode } from '../nodes/UiTextNode';
import { UiImageNode } from '../nodes/UiImageNode';
import { FileNode } from '../nodes/FileNode';
import { TriggerStartNode } from '../nodes/TriggerStartNode';
import { TriggerCronNode } from '../nodes/TriggerCronNode';
import type { SchemaField } from '@zaa-tool/shared';

const nodeTypes = {
  code: CodeNode,
  if: IfNode,
  loop: LoopNode,
  'ui:input': UiInputNode,
  'ui:table': UiTableNode,
  'ui:chart': UiChartNode,
  'ui:text': UiTextNode,
  'ui:image': UiImageNode,
  file: FileNode,
  'trigger:start': TriggerStartNode,
  'trigger:cron': TriggerCronNode,
};

/** Default schemas for each node type when dropped */
const defaultNodeData: Record<string, () => FlowNodeData> = {
  'code:node': () => ({
    label: 'Code (JS)',
    runtime: 'node',
    code: '// Write your JavaScript here\nreturn { output1: input1 };',
    inputsSchema: [{ name: 'input1', type: 'string' }],
    outputsSchema: [{ name: 'output1', type: 'string' }],
  }),
  'code:python': () => ({
    label: 'Code (Python)',
    runtime: 'python',
    code: '# Write your Python here\nreturn {"output1": input1}',
    inputsSchema: [{ name: 'input1', type: 'string' }],
    outputsSchema: [{ name: 'output1', type: 'string' }],
  }),
  'if:': () => ({
    label: 'If / Branch',
    code: '// Return true or false\nreturn input1 === true;',
    inputsSchema: [{ name: 'condition', type: 'boolean' }],
    outputsSchema: [
      { name: 'true', type: 'boolean' },
      { name: 'false', type: 'boolean' },
    ],
  }),
  'loop:': () => ({
    label: 'Loop',
    inputsSchema: [{ name: 'list', type: 'array' }],
    outputsSchema: [
      { name: 'element', type: 'object' },
      { name: 'body', type: 'object' },
      { name: 'completed', type: 'object' },
    ],
  }),
  'ui:input:': () => ({
    label: 'Input Form',
    uiSchema: { fields: [], layout: { columns: 1, triggerOn: 'submit' } },
    inputsSchema: [],
    outputsSchema: [{ name: 'values', type: 'object' }],
  }),
  'ui:table:': () => ({
    label: 'Data Table',
    tableConfig: { columns: [] },
    inputsSchema: [{ name: 'data', type: 'table' }],
    outputsSchema: [{ name: 'selectedRow', type: 'object' }],
  }),
  'ui:chart:': () => ({
    label: 'Chart Display',
    chartConfig: { type: 'bar', xAxisKey: '', yAxisKeys: [], colors: ['#3b82f6'], jsonConfig: '' },
    inputsSchema: [{ name: 'data', type: 'table' }],
    outputsSchema: [],
  }),
  'ui:text:': () => ({
    label: 'Text Display',
    inputsSchema: [
      { name: 'value', type: 'string' },
      { name: 'format', type: 'string' }
    ],
    outputsSchema: [],
  }),
  'ui:image:': () => ({
    label: 'Image',
    inputsSchema: [{ name: 'src', type: 'image' }],
    outputsSchema: [],
  }),
  'file:': () => ({
    label: 'File Input',
    inputsSchema: [],
    outputsSchema: [{ name: 'file', type: 'string' }],
  }),
  'trigger:start:': () => ({
    label: 'Start Trigger',
    inputsSchema: [],
    outputsSchema: [{ name: 'trigger', type: 'any' }],
  }),
  'trigger:cron:': () => ({
    label: 'Cron Trigger',
    inputsSchema: [],
    outputsSchema: [{ name: 'trigger', type: 'any' }],
    cronExpression: '*/5 * * * *',
    enabled: true,
  }),
};

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

  // Search node states
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const filtered = nodes.filter(n => {
      const label = n.data?.label || '';
      const id = n.id || '';
      const type = n.type || '';
      return label.toLowerCase().includes(query.toLowerCase()) ||
             id.toLowerCase().includes(query.toLowerCase()) ||
             type.toLowerCase().includes(query.toLowerCase());
    });
    setSearchResults(filtered);
  };

  const handleResultClick = (node: any) => {
    setSearchQuery('');
    setSearchResults([]);
    setActiveNodeId(node.id);
    setCodePanelOpen(true);
    setCenter(node.position.x + 100, node.position.y + 50, { zoom: 1.2, duration: 800 });
  };

  // Viewport restore race condition fix
  const isViewportRestored = useRef(false);

  // Sync viewport changes back to store
  useOnViewportChange({
    onChange: (viewport) => {
      if (isViewportRestored.current) {
        setStoreViewport(viewport);
      }
    },
  });

  // Handle Ctrl+S and AutoSave logic
  const saveFlow = useCallback(async () => {
    try {
      const graphJson = getGraphJson();
      const res = await fetch(`${API_BASE_URL}/api/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: flowId,
          name: flowName,
          graph_json: graphJson,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      console.log('Saved flow successfully');
    } catch (err) {
      console.error(err);
    }
  }, [getGraphJson, flowId, flowName]);

  // Debounced auto-save
  useEffect(() => {
    const timeout = setTimeout(() => {
      saveFlow();
    }, 5000); // Auto-save after 5 seconds of inactivity
    return () => clearTimeout(timeout);
  }, [nodes, edges, saveFlow]);

  // Ctrl+S Manual Save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFlow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveFlow]);

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

    const outField = sourceNode.data.outputsSchema?.find(
      (f: SchemaField) => f.name === sourceHandle,
    );
    const inField = targetNode.data.inputsSchema?.find(
      (f: SchemaField) => f.name === targetHandle,
    );

    if (!outField || !inField) return false;

    // Check if types are compatible
    const isCompatibleType = (a: string, b: string) => {
      if (a === b) return true;
      if (a === 'object' || b === 'object' || a === 'any' || b === 'any') return true;
      
      // string, file, and image are compatible with each other since they all carry paths/strings
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

 const position = screenToFlowPosition({
 x: event.clientX,
 y: event.clientY,
 });

 const dataKey = `${type}:${runtime ?? ''}`;
 const dataFactory = defaultNodeData[dataKey] ?? defaultNodeData[`${type}:`];

 if (!dataFactory) return;

 const nodeData = dataFactory();
 if (label) nodeData.label = label;

 const newNode = {
 id: generateNodeId(),
 type,
 position,
 data: nodeData,
 };

 addNode(newNode);
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
  <div
    id="flow-canvas-wrapper"
    className="flex-1 h-full"
    ref={reactFlowWrapper}
  >
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
    defaultEdgeOptions={{
      type: 'smoothstep',
      animated: false,
    }}
    proOptions={{ hideAttribution: true }}
  >
    {/* Floating Control Panels */}
    <Panel position="top-left" className="flex items-center gap-1.5 bg-background/80 backdrop-blur-sm border border-border p-1.5 rounded-md shadow-md z-50">
      {!isNodePaletteOpen && (
        <Button
          onClick={toggleNodePalette}
          variant="ghost"
          size="icon"
          className="w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-accent"
          title="Open Node Palette"
        >
          <Sidebar size={15} weight="duotone" />
        </Button>
      )}
      <div className="flex items-center bg-muted/40 p-0.5 rounded-sm">
        <Button
          onClick={() => {
            setLayoutDirection('TB');
            autoLayout('TB');
          }}
          variant="ghost"
          className={cn(
            'h-6 px-2 text-[10px] font-semibold rounded-sm',
            layoutDirection === 'TB' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted/50'
          )}
          title="Auto layout (Vertical)"
        >
          V
        </Button>
        <Button
          onClick={() => {
            setLayoutDirection('LR');
            autoLayout('LR');
          }}
          variant="ghost"
          className={cn(
            'h-6 px-2 text-[10px] font-semibold rounded-sm',
            layoutDirection === 'LR' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted/50'
          )}
          title="Auto layout (Horizontal)"
        >
          H
        </Button>
      </div>
      <Button
        onClick={toggleConsolePanel}
        variant="ghost"
        size="icon"
        className={cn(
          'w-7 h-7 text-muted-foreground hover:bg-accent',
          isConsolePanelOpen ? 'bg-accent text-foreground' : 'text-muted-foreground'
        )}
        title="Toggle Console"
      >
        <Terminal size={15} weight="duotone" />
      </Button>
    </Panel>

    <Panel position="top-center" className="w-[260px] relative z-50">
      <div className="flex flex-col bg-background/90 backdrop-blur-sm border border-border p-1 rounded-md shadow-md">
        <div className="relative flex items-center">
          <MagnifyingGlass size={13} className="absolute left-2.5 text-muted-foreground/60" />
          <input
            type="text"
            placeholder="Search nodes by name/ID..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full bg-transparent h-7 pl-8 pr-2 text-xs outline-none text-foreground"
          />
        </div>
        {searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-popover text-popover-foreground border border-border rounded-md shadow-lg max-h-48 overflow-y-auto z-[60] py-1">
            {searchResults.map((n) => (
              <button
                key={n.id}
                onClick={() => handleResultClick(n)}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground flex flex-col gap-0.5 border-b border-border/40 last:border-0 cursor-pointer"
              >
                <span className="font-semibold truncate">{n.data?.label || 'Untitled Node'}</span>
                <span className="text-[10px] text-muted-foreground truncate">{n.id} • {n.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Panel>

    <Panel position="top-right" className="z-50">
      <Button
        onClick={run}
        disabled={isRunning}
        variant="default"
        className={cn(
          'h-8 px-3 text-xs font-semibold shadow-md',
          isRunning
            ? 'bg-emerald-500/15 text-emerald-400 opacity-100 cursor-wait'
            : 'bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20'
        )}
      >
        {isRunning ? (
          <>
            <Spinner size={13} className="animate-spin mr-1.5" />
            Running...
          </>
        ) : (
          <>
            <Play size={13} weight="fill" className="mr-1.5" />
            Run All Nodes
          </>
        )}
      </Button>
    </Panel>

    <Background
      variant={BackgroundVariant.Dots}
      gap={40}
      size={2.5}
      className="!bg-canvas-bg"
      color="var(--canvas-dot)"
    />
    <Controls
      showInteractive={false}
      position="bottom-left"
      className="!m-3"
    />
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
            return node.data?.runtime === 'python'
              ? 'var(--node-code-py)'
              : 'var(--node-code)';
        }
      }}
    />
  </ReactFlow>
  </div>
  );
}
