import { useState, useRef, useEffect } from 'react';
import { API_BASE_URL } from '../../lib/api.js';

export function useDashboardFlow(flowId: string) {
  const [flowName, setFlowName] = useState('Workflow Dashboard');
  const [nodes, setNodes] = useState<any[]>([]);
  const [nodeData, setNodeData] = useState<Record<string, any>>({});
  const [layout, setLayout] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [dashboardPassword, setDashboardPassword] = useState('');
  const [formInputs, setFormInputs] = useState<Record<string, Record<string, any>>>({});
  const graphRef = useRef<any>(null);

  useEffect(() => {
    const fetchFlow = async () => {
      try {
        const savedPassword = sessionStorage.getItem(`dashboard_password_${flowId}`);
        const headers: Record<string, string> = {};
        if (savedPassword) {
          headers['X-Dashboard-Password'] = savedPassword;
        }

        const res = await fetch(`${API_BASE_URL}/api/flows/${flowId}/public`, { headers });
        if (res.status === 401 || res.status === 403) {
          sessionStorage.removeItem(`dashboard_password_${flowId}`);
          setIsLocked(true);
          const metaRes = await fetch(`${API_BASE_URL}/api/flows/${flowId}/public`);
          if (metaRes.ok) {
            const metaData = await metaRes.json();
            setFlowName(metaData.name);
          }
          setIsLoading(false);
          return;
        }

        if (!res.ok) {
          throw new Error('Failed to load published workflow');
        }
        const data = await res.json();
        setFlowName(data.name);

        if (data.isPasswordProtected) {
          setIsLocked(true);
          return;
        }

        if (savedPassword) {
          setDashboardPassword(savedPassword);
        }

        const graph = data.graph_json || { nodes: [], edges: [] };
        graphRef.current = graph;
        const uiNodes = graph.nodes.filter((n: any) =>
          ['ui:input', 'ui:text', 'ui:table', 'ui:chart', 'ui:image', 'file'].includes(n.type) &&
          n.data?.showInDashboard !== false
        );
        setNodes(uiNodes);

        const initialData: Record<string, any> = {};
        const initialFormInputs: Record<string, Record<string, any>> = {};

        uiNodes.forEach((n: any) => {
          let inputs = n.data?.inputs || {};
          let outputs = n.data?.outputs || {};

          if (n.type === 'file') {
            const config = n.data?.config || {};
            const isChangeable = config.changeable !== false;
            if (isChangeable) {
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
              ...(n.data?.outputs?.values || {}),
            };
          }
        });
        setNodeData(initialData);
        setFormInputs(initialFormInputs);

        const savedLayout = data.dashboard_layout || { items: [] };
        const layoutItems = uiNodes.map((n: any) => {
          const item = savedLayout.items?.find((l: any) => l.i === n.id);
          const base = item || { i: n.id, x: 0, y: 0, w: 6, h: 4 };
          return { ...base, isDraggable: false, isResizable: false };
        });
        setLayout(layoutItems);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFlow();
  }, [flowId]);

  return {
    flowName,
    nodes,
    nodeData,
    layout,
    isLoading,
    error,
    isLocked,
    dashboardPassword,
    graphRef,
    formInputs,
    setFlowName,
    setIsLocked,
    setDashboardPassword,
    setNodes,
    setNodeData,
    setLayout,
    setFormInputs,
    setIsLoading,
    setError,
  };
}
