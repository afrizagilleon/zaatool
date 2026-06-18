import { useState } from 'react';
import { flowsApi } from '../../lib/flows-api.js';
import { API_BASE_URL } from '../../lib/api.js';
import type { NodeDef, DashboardLayout } from '@zaa-tool/shared';

interface UseDashboardActionsParams {
  flowId: string;
  dashboardPassword: string;
  flowName: string;
  nodeData: Record<string, unknown>;
  formInputs: Record<string, Record<string, unknown>>;
  graphRef: React.MutableRefObject<unknown>;
  setFlowName: React.Dispatch<React.SetStateAction<string>>;
  setIsLocked: React.Dispatch<React.SetStateAction<boolean>>;
  setDashboardPassword: React.Dispatch<React.SetStateAction<string>>;
  setNodes: React.Dispatch<React.SetStateAction<NodeDef[]>>;
  setNodeData: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  setLayout: React.Dispatch<React.SetStateAction<unknown[]>>;
  setFormInputs: React.Dispatch<React.SetStateAction<Record<string, Record<string, unknown>>>>;
  setExecutingNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

const UI_NODE_TYPES = ['ui:input', 'ui:text', 'ui:table', 'ui:chart', 'ui:image', 'file'];

export function useDashboardActions({
  flowId,
  dashboardPassword,
  flowName,
  nodeData,
  formInputs,
  graphRef,
  setFlowName,
  setIsLocked,
  setDashboardPassword,
  setNodes,
  setNodeData,
  setLayout,
  setFormInputs,
  setExecutingNodes,
}: UseDashboardActionsParams) {
  const [passwordInput, setPasswordInput] = useState('');
  const [lockError, setLockError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [uploadingNodes, setUploadingNodes] = useState<Record<string, boolean>>({});

  const handleFormSubmit = async (nodeId: string) => {
    setExecutingNodes((prev) => ({ ...prev, [nodeId]: true }));
    try {
      await flowsApi.trigger(flowId, { startNodeId: nodeId, inputs: formInputs[nodeId] || {} }, dashboardPassword || undefined);
    } catch (err) {
      console.error('Failed to trigger flow:', err);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput) return;
    setIsUnlocking(true);
    setLockError(null);

    try {
      const data = await flowsApi.verifyPassword(flowId, passwordInput);
      setDashboardPassword(passwordInput);
      sessionStorage.setItem(`dashboard_password_${flowId}`, passwordInput);
      setFlowName(flowName || 'Workflow Dashboard');

      const graph = data.graph_json || { nodes: [], edges: [] };
      graphRef.current = graph;

      const uiNodes = (graph.nodes || []).filter(
        (n: NodeDef) => UI_NODE_TYPES.includes(n.type) && n.data?.showInDashboard !== false
      );
      setNodes(uiNodes);

      const initialData: Record<string, unknown> = {};
      const initialFormInputs: Record<string, Record<string, unknown>> = {};
      for (const n of uiNodes) {
        let inputs = (n.data?.inputs || {}) as Record<string, unknown>;
        let outputs = (n.data?.outputs || {}) as Record<string, unknown>;
        if (n.type === 'file' && (n.data?.config as Record<string, unknown>)?.changeable !== false) {
          inputs = { ...inputs, file: null };
          outputs = { ...outputs, file: null };
        }
        initialData[n.id] = {
          inputs, outputs, values: n.data?.values || {},
          type: n.type, label: n.data?.label || n.type,
          tableConfig: n.data?.tableConfig || {}, chartConfig: n.data?.chartConfig || {},
          config: n.data?.config || {}, selectedRow: n.data?.selectedRow || null,
        };
        if (n.type === 'ui:input') {
          initialFormInputs[n.id] = { ...(n.data?.values || {}), ...((n.data?.outputs as Record<string, unknown>)?.values as Record<string, unknown> || {}) };
        }
      }
      setNodeData(initialData);
      setFormInputs(initialFormInputs);

      const savedLayout = (data.dashboard_layout as DashboardLayout) || { items: [] };
      setLayout(
        uiNodes.map((n: NodeDef) => {
          const item = savedLayout.items?.find((l) => l.i === n.id);
          return { ...(item || { i: n.id, x: 0, y: 0, w: 6, h: 4 }), isDraggable: false, isResizable: false };
        })
      );
      setIsLocked(false);
    } catch (err: unknown) {
      setLockError((err as Error).message);
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleTableSelect = async (nodeId: string, row: unknown) => {
    setNodeData((prev) => ({ ...prev, [nodeId]: { ...(prev[nodeId] as Record<string, unknown> || {}), selectedRow: row } }));
    setExecutingNodes((prev) => ({ ...prev, [nodeId]: true }));
    try {
      await flowsApi.trigger(flowId, { startNodeId: nodeId, inputs: { selectedRow: row } }, dashboardPassword || undefined);
    } catch (err) {
      console.error('Failed to trigger table select:', err);
    }
  };

  const handleInputChange = (nodeId: string, fieldKey: string, val: unknown) => {
    setFormInputs((prev) => ({ ...prev, [nodeId]: { ...(prev[nodeId] || {}), [fieldKey]: val } }));
  };

  const handleFileUpload = async (nodeId: string, file: File) => {
    setUploadingNodes((prev) => ({ ...prev, [nodeId]: true }));
    const formData = new FormData();
    formData.append('file', file);

    const config = (nodeData[nodeId] as Record<string, unknown>)?.config as Record<string, unknown> || {};
    const folder = config.folder || '';
    const queryParams = folder ? `?dir=${encodeURIComponent(String(folder))}` : '';

    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/files${queryParams}`, { method: 'POST', body: formData });
      if (res.ok) {
        const uploaded = await res.json();
        setNodeData((prev) => ({ ...prev, [nodeId]: { ...(prev[nodeId] as Record<string, unknown>), outputs: { file: uploaded } } }));
        setExecutingNodes((prev) => ({ ...prev, [nodeId]: true }));
        await flowsApi.trigger(flowId, { startNodeId: nodeId, inputs: { file: uploaded.path } }, dashboardPassword || undefined);
      }
    } catch (err) {
      console.error('Failed to upload file:', err);
    } finally {
      setUploadingNodes((prev) => ({ ...prev, [nodeId]: false }));
    }
  };

  return {
    passwordInput, lockError, isUnlocking, showPassword, uploadingNodes,
    setPasswordInput, setShowPassword,
    handleFormSubmit, handleUnlock, handleTableSelect, handleInputChange, handleFileUpload,
  };
}
