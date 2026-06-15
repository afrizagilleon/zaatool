import { useState, useCallback } from 'react';
import { useEngineStore } from '../store/engineStore.js';
import { useFlowStore } from '../store/flowStore.js';
import { API_BASE_URL } from '../lib/api.js';

export function useNavbarActions() {
  const isRunning = useEngineStore((s) => s.isRunning);
  const runFlow = useEngineStore((s) => s.runFlow);
  const getGraphJson = useFlowStore((s) => s.getGraphJson);
  const loadFromJson = useFlowStore((s) => s.loadFromJson);

  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleRun = useCallback(() => {
    if (isRunning) return;
    const graph = getGraphJson();
    runFlow(graph);
  }, [isRunning, getGraphJson, runFlow]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const graph = getGraphJson();
      const res = await fetch(`${API_BASE_URL}/api/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: graph.id,
          name: graph.name,
          graph_json: graph,
          dashboard_layout: (graph as any).dashboardLayout,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
    } catch (e) {
      console.error(e);
      alert('Failed to save flow to database.');
    } finally {
      setIsSaving(false);
    }
  }, [getGraphJson]);

  const handleLoad = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/flows`);
      if (!res.ok) throw new Error('Failed to load');
      const flows = await res.json();
      if (flows.length > 0) {
        const latestFlow = flows[0];
        const parsedGraph =
          typeof latestFlow.graph_json === 'string'
            ? JSON.parse(latestFlow.graph_json)
            : latestFlow.graph_json;
        loadFromJson(parsedGraph);
      }
    } catch (e) {
      console.error(e);
      // Fails silently on first run if DB empty
    } finally {
      setIsLoading(false);
    }
  }, [loadFromJson]);

  return {
    isSaving,
    isLoading,
    run: handleRun,
    save: handleSave,
    load: handleLoad,
  };
}
