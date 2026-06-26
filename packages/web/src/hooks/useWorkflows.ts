import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { flowsApi } from '../lib/flows-api';
import { useFlowStore } from '../store/flowStore';
import { useUiStore } from '../store/uiStore';
import type { GraphJson } from '@zaa-tool/shared';

export interface Workflow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export function parseUtcDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  if (dateStr.includes('Z') || dateStr.includes('+') || /-\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}

export function useWorkflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [workflowToDelete, setWorkflowToDelete] = useState<string | null>(null);

  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const loadFromJson = useFlowStore((s) => s.loadFromJson);

  const fetchWorkflows = async () => {
    setIsLoading(true);
    try {
      const data = await flowsApi.list();
      setWorkflows(data);
    } catch (err) {
      console.error('Failed to fetch workflows:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const openWorkflow = async (id: string) => {
    try {
      const data = await flowsApi.getById(id);
      const graph: GraphJson = {
        ...data.graph_json,
        id: data.id,
        name: data.name,
        dashboardPassword: data.dashboard_password || '',
        is_published: data.is_published,
        share_slug: data.share_slug,
      } as any;
      loadFromJson(graph);
      setActiveTab('editor');
    } catch (err) {
      console.error('Failed to open workflow:', err);
    }
  };

  const handleCreateNew = async () => {
    if (!newName.trim()) return;
    try {
      const newId = uuidv4();
      const emptyGraph: GraphJson = {
        version: '2.0',
        id: newId,
        name: newName.trim(),
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      };
      await flowsApi.save({ id: newId, name: newName.trim(), graph_json: emptyGraph });
      setIsCreateOpen(false);
      setNewName('');
      fetchWorkflows();
      openWorkflow(newId);
    } catch (err) {
      console.error('Failed to create workflow:', err);
    }
  };

  const deleteWorkflow = async () => {
    if (!workflowToDelete) return;
    try {
      await flowsApi.delete(workflowToDelete);
      setWorkflowToDelete(null);
      fetchWorkflows();
    } catch (err) {
      console.error('Failed to delete workflow:', err);
    }
  };

  const filtered = workflows.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()));

  return {
    filtered,
    isLoading,
    search,
    setSearch,
    isCreateOpen,
    setIsCreateOpen,
    newName,
    setNewName,
    workflowToDelete,
    setWorkflowToDelete,
    fetchWorkflows,
    handleCreateNew,
    openWorkflow,
    deleteWorkflow,
  };
}
