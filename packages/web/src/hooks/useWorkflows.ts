import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { API_BASE_URL } from '../lib/api';
import { useFlowStore } from '../store/flowStore';
import { useUiStore } from '../store/uiStore';

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
      const res = await fetch(`${API_BASE_URL}/api/flows`);
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data);
      }
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
      const res = await fetch(`${API_BASE_URL}/api/flows/${id}`);
      if (res.ok) {
        const data = await res.json();
        let parsed = data.graph_json;
        if (typeof parsed === 'string') {
          parsed = JSON.parse(parsed);
        }
        if (!parsed) {
          parsed = { nodes: [], edges: [] };
        }

        // Ensure ID and Name are overridden from the top-level table if needed
        parsed.id = data.id;
        parsed.name = data.name;

        loadFromJson(parsed);
        setActiveTab('editor');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateNew = async () => {
    if (!newName.trim()) return;

    try {
      const newId = uuidv4();
      const emptyGraph = {
        id: newId,
        name: newName.trim(),
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const res = await fetch(`${API_BASE_URL}/api/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          name: newName.trim(),
          graph_json: emptyGraph,
        }),
      });

      if (res.ok) {
        setIsCreateOpen(false);
        setNewName('');
        fetchWorkflows();
        openWorkflow(newId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteWorkflow = async () => {
    if (!workflowToDelete) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/flows/${workflowToDelete}`, { method: 'DELETE' });
      if (res.ok) {
        setWorkflowToDelete(null);
        fetchWorkflows();
      }
    } catch (err) {
      console.error(err);
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
