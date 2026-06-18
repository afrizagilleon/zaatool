import { useState } from 'react';
import { API_BASE_URL } from '../../lib/api.js';

interface UseDashboardActionsParams {
  flowId: string;
  dashboardPassword: string;
  flowName: string;
  nodeData: Record<string, any>;
  formInputs: Record<string, Record<string, any>>;
  graphRef: React.MutableRefObject<any>;
  setFlowName: React.Dispatch<React.SetStateAction<string>>;
  setIsLocked: React.Dispatch<React.SetStateAction<boolean>>;
  setDashboardPassword: React.Dispatch<React.SetStateAction<string>>;
  setNodes: React.Dispatch<React.SetStateAction<any[]>>;
  setNodeData: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  setLayout: React.Dispatch<React.SetStateAction<any[]>>;
  setFormInputs: React.Dispatch<React.SetStateAction<Record<string, Record<string, any>>>>;
  setExecutingNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

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
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (dashboardPassword) {
        headers['X-Dashboard-Password'] = dashboardPassword;
      }

      const res = await fetch(`${API_BASE_URL}/api/flows/${flowId}/trigger`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ startNodeId: nodeId, inputs: formInputs[nodeId] || {} }),
      });

      if (!res.ok) {
        throw new Error('Failed to run workflow trigger');
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput) return;
    setIsUnlocking(true);
    setLockError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/flows/${flowId}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to verify password');
      }

      setDashboardPassword(passwordInput);
      sessionStorage.setItem(`dashboard_password_${flowId}`, passwordInput);
      setFlowName(flowName || data.name || 'Workflow Dashboard');

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
      setIsLocked(false);
    } catch (err: any) {
      setLockError(err.message);
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleTableSelect = async (nodeId: string, row: any) => {
    setNodeData((prev) => {
      const current = prev[nodeId] || {};
      return { ...prev, [nodeId]: { ...current, selectedRow: row } };
    });

    setExecutingNodes((prev) => ({ ...prev, [nodeId]: true }));
    try {
      const res = await fetch(`${API_BASE_URL}/api/flows/${flowId}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startNodeId: nodeId, inputs: { selectedRow: row } }),
      });

      if (!res.ok) {
        throw new Error('Failed to run workflow trigger');
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleInputChange = (nodeId: string, fieldKey: string, val: any) => {
    setFormInputs((prev) => ({
      ...prev,
      [nodeId]: { ...(prev[nodeId] || {}), [fieldKey]: val },
    }));
  };

  const handleFileUpload = async (nodeId: string, file: File) => {
    setUploadingNodes((prev) => ({ ...prev, [nodeId]: true }));
    const formData = new FormData();
    formData.append('file', file);

    const config = nodeData[nodeId]?.config || {};
    const folder = config.folder || '';
    const queryParams = folder ? `?dir=${encodeURIComponent(folder)}` : '';

    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/files${queryParams}`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const uploaded = await res.json();
        setNodeData((prev) => ({
          ...prev,
          [nodeId]: { ...prev[nodeId], outputs: { file: uploaded } },
        }));

        setExecutingNodes((prev) => ({ ...prev, [nodeId]: true }));
        await fetch(`${API_BASE_URL}/api/flows/${flowId}/trigger`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startNodeId: nodeId, inputs: { file: uploaded.path } }),
        });
      }
    } catch (err) {
      console.error('Failed to upload file:', err);
    } finally {
      setUploadingNodes((prev) => ({ ...prev, [nodeId]: false }));
    }
  };

  return {
    passwordInput,
    lockError,
    isUnlocking,
    showPassword,
    uploadingNodes,
    setPasswordInput,
    setShowPassword,
    handleFormSubmit,
    handleUnlock,
    handleTableSelect,
    handleInputChange,
    handleFileUpload,
  };
}
