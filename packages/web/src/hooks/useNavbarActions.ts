import { useState, useCallback } from 'react';
import { useEngineStore } from '../store/engineStore.js';
import { useFlowStore } from '../store/flowStore.js';
import { flowsApi } from '../lib/flows-api.js';

export function useNavbarActions() {
  const isRunning = useEngineStore((s) => s.isRunning);
  const runFlow = useEngineStore((s) => s.runFlow);
  const getGraphJson = useFlowStore((s) => s.getGraphJson);
  const loadFromJson = useFlowStore((s) => s.loadFromJson);
  const dashboardPassword = useFlowStore((s) => s.dashboardPassword);

  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleRun = useCallback(() => {
    if (isRunning) return;
    runFlow(getGraphJson());
  }, [isRunning, getGraphJson, runFlow]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const graph = getGraphJson();
      await flowsApi.save({
        id: graph.id,
        name: graph.name,
        graph_json: graph,
        dashboard_layout: graph.dashboardLayout,
        dashboard_password: dashboardPassword,
      });
    } catch (e) {
      console.error(e);
      alert('Failed to save flow to database.');
    } finally {
      setIsSaving(false);
    }
  }, [getGraphJson, dashboardPassword]);

  const handleLoad = useCallback(async () => {
    setIsLoading(true);
    try {
      const flows = await flowsApi.list();
      if (flows.length > 0) {
        const detail = await flowsApi.getById(flows[0].id);
        const graph = {
          ...detail.graph_json,
          id: detail.id,
          name: detail.name,
          dashboardPassword: detail.dashboard_password || '',
        };
        loadFromJson(graph);
      }
    } catch (e) {
      console.error(e);
      // Fails silently on first run if DB is empty
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
