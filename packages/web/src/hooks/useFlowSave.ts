import { useCallback, useEffect } from 'react';
import { flowsApi } from '../lib/flows-api';
import type { GraphJson } from '@zaa-tool/shared';

interface UseFlowSaveParams {
  flowId: string | undefined;
  flowName: string | undefined;
  getGraphJson: () => GraphJson;
  nodes: unknown[];
  edges: unknown[];
}

export function useFlowSave({ flowId, flowName, getGraphJson, nodes, edges }: UseFlowSaveParams) {
  const saveFlow = useCallback(async () => {
    try {
      const graph_json = getGraphJson();
      await flowsApi.save({ id: flowId, name: flowName, graph_json });
    } catch (err) {
      console.error('Failed to save flow:', err);
    }
  }, [getGraphJson, flowId, flowName]);

  // Debounced auto-save on node/edge changes
  useEffect(() => {
    const timeout = setTimeout(saveFlow, 5000);
    return () => clearTimeout(timeout);
  }, [nodes, edges, saveFlow]);

  // Ctrl+S / Cmd+S manual save
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
