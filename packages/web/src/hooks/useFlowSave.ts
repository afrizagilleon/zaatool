import { useCallback, useEffect } from 'react';
import { API_BASE_URL } from '../lib/api';

interface UseFlowSaveParams {
  flowId: string | undefined;
  flowName: string | undefined;
  getGraphJson: () => unknown;
  nodes: unknown[];
  edges: unknown[];
}

export function useFlowSave({ flowId, flowName, getGraphJson, nodes, edges }: UseFlowSaveParams) {
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
    }, 5000);
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

  return { saveFlow };
}
