import { useState, useRef, useEffect } from 'react';
import { flowsApi } from '../../lib/flows-api.js';
import type { NodeDef } from '@zaa-tool/shared';

const UI_NODE_TYPES = ['ui:input', 'ui:text', 'ui:table', 'ui:chart', 'ui:image', 'file'];

function buildInitialNodeData(uiNodes: NodeDef[]) {
  const initialData: Record<string, unknown> = {};
  const initialFormInputs: Record<string, Record<string, unknown>> = {};

  for (const n of uiNodes) {
    let inputs = (n.data?.inputs || {}) as Record<string, unknown>;
    let outputs = (n.data?.outputs || {}) as Record<string, unknown>;

    if (n.type === 'file') {
      const config = (n.data?.config || {}) as Record<string, unknown>;
      if (config.changeable !== false) {
        inputs = { ...inputs, file: null };
        outputs = { ...outputs, file: null };
      }
    }

    initialData[n.id] = {
      inputs,
      outputs,
      values: n.data?.values || {},
      type: n.type,
      label: n.data?.label || n.type,
      tableConfig: n.data?.tableConfig || {},
      chartConfig: n.data?.chartConfig || {},
      config: n.data?.config || {},
      selectedRow: n.data?.selectedRow || null,
    };

    if (n.type === 'ui:input') {
      initialFormInputs[n.id] = {
        ...(n.data?.values || {}),
        ...((n.data?.outputs as Record<string, unknown>)?.values as Record<string, unknown> || {}),
      };
    }
  }

  return { initialData, initialFormInputs };
}

export function useDashboardFlow(flowId: string) {
  const [flowName, setFlowName] = useState('Workflow Dashboard');
  const [nodes, setNodes] = useState<NodeDef[]>([]);
  const [nodeData, setNodeData] = useState<Record<string, unknown>>({});
  const [layout, setLayout] = useState<unknown[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [dashboardPassword, setDashboardPassword] = useState('');
  const [formInputs, setFormInputs] = useState<Record<string, Record<string, unknown>>>({});
  const graphRef = useRef<unknown>(null);

  useEffect(() => {
    const fetchFlow = async () => {
      try {
        const savedPassword = sessionStorage.getItem(`dashboard_password_${flowId}`) ?? undefined;

        const data = await flowsApi.getPublic(flowId, savedPassword).catch(async (err: Error) => {
          if (err.message.includes('403')) {
            throw new Error('This dashboard has not been published yet.');
          }
          if (err.message.includes('401')) {
            sessionStorage.removeItem(`dashboard_password_${flowId}`);
            setIsLocked(true);
            const meta = await flowsApi.getPublic(flowId);
            setFlowName(meta.name);
            setIsLoading(false);
            return null;
          }
          throw err;
        });

        if (!data) return;

        setFlowName(data.name);

        if (data.isPasswordProtected) {
          setIsLocked(true);
          return;
        }

        if (savedPassword) setDashboardPassword(savedPassword);

        const graph = data.graph_json || { nodes: [], edges: [] };
        graphRef.current = graph;

        const uiNodes = (graph.nodes || []).filter(
          (n: NodeDef) => UI_NODE_TYPES.includes(n.type) && n.data?.showInDashboard !== false
        );
        setNodes(uiNodes);

        const { initialData, initialFormInputs } = buildInitialNodeData(uiNodes);
        setNodeData(initialData);
        setFormInputs(initialFormInputs);

        const savedLayout = data.dashboard_layout || { items: [] };
        setLayout(
          uiNodes.map((n: NodeDef) => {
            const item = savedLayout.items?.find((l: { i: string }) => l.i === n.id);
            return { ...(item || { i: n.id, x: 0, y: 0, w: 6, h: 4 }), isDraggable: false, isResizable: false };
          })
        );
      } catch (err: unknown) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFlow();
  }, [flowId]);

  return {
    flowName, nodes, nodeData, layout, isLoading, error,
    isLocked, dashboardPassword, graphRef, formInputs,
    setFlowName, setIsLocked, setDashboardPassword,
    setNodes, setNodeData, setLayout, setFormInputs, setIsLoading, setError,
  };
}
