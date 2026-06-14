import { useRef, useCallback, type DragEvent } from 'react';
import {
 ReactFlow,
 Background,
 Controls,
 MiniMap,
 BackgroundVariant,
 useReactFlow,
} from '@xyflow/react';
import type { Connection, Edge, ColorMode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useFlowStore, generateNodeId } from '../../store/flowStore';
import type { FlowNodeData } from '../../store/flowStore';
import { useUiStore } from '../../store/uiStore';
import { CodeNode } from '../nodes/CodeNode';
import { IfNode } from '../nodes/IfNode';
import { LoopNode } from '../nodes/LoopNode';
import type { SchemaField } from '@zaa-tool/shared';

const nodeTypes = {
 code: CodeNode,
 if: IfNode,
 loop: LoopNode,
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

 const { screenToFlowPosition } = useReactFlow();

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

 // Allow same types, or allow 'object' to connect to anything
 return outField.type === inField.type || outField.type === 'object' || inField.type === 'object';
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
 fitView
 snapToGrid
 snapGrid={[16, 16]}
 defaultEdgeOptions={{
 type: 'smoothstep',
 animated: false,
 }}
 proOptions={{ hideAttribution: true }}
 >
 <Background
 variant={BackgroundVariant.Dots}
 gap={20}
 size={1}
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
