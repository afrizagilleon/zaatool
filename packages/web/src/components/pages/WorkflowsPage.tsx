import { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Plus, Trash, Play, Clock, PencilSimple } from '@phosphor-icons/react';
import { API_BASE_URL } from '../../lib/api';
import { useFlowStore } from '../../store/flowStore';
import { useUiStore } from '../../store/uiStore';
import { formatDistanceToNow } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

interface Workflow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export function WorkflowsPage() {
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

  const handleCreateNew = async () => {
    if (!newName.trim()) return;

    try {
      const newId = uuidv4();
      const emptyGraph = {
        id: newId,
        name: newName.trim(),
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
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

  const parseUtcDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    if (dateStr.includes('Z') || dateStr.includes('+') || /-\d{2}:\d{2}$/.test(dateStr)) {
      return new Date(dateStr);
    }
    return new Date(dateStr.replace(' ', 'T') + 'Z');
  };

  return (
    <div className="flex-1 overflow-auto bg-muted/10 flex flex-col items-center">
      <div className="w-full max-w-5xl py-12 px-6 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-heading tracking-tight">Workflows</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage and execute your saved automations.</p>
          </div>
          <Button onClick={() => setIsCreateOpen(true)} className="shadow-md h-9 px-4 font-bold">
            <Plus className="mr-2" weight="bold" /> New Workflow
          </Button>
        </div>

        <div className="bg-background border border-border shadow-sm">
          <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between">
            <Input 
              placeholder="Search workflows..." 
              className="max-w-xs h-8 bg-background" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="text-xs text-muted-foreground font-medium">
              {filtered.length} total
            </div>
          </div>
          
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[300px]">Name</TableHead>
                <TableHead>Last Edited</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                    Loading workflows...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                    No workflows found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((w) => (
                  <TableRow key={w.id} className="group transition-colors cursor-pointer" onClick={() => openWorkflow(w.id)}>
                    <TableCell className="font-semibold text-[13px]">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-primary/10 text-primary flex items-center justify-center">
                          <Play size={12} weight="fill" />
                        </div>
                        {w.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} />
                        {formatDistanceToNow(parseUtcDate(w.updated_at), { addSuffix: true })}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {parseUtcDate(w.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        <Button variant="outline" size="icon-sm" onClick={() => openWorkflow(w.id)}>
                          <PencilSimple size={14} />
                        </Button>
                        <Button variant="outline" size="icon-sm" onClick={() => setWorkflowToDelete(w.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10 border-transparent hover:border-destructive/20">
                          <Trash size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Workflow</DialogTitle>
            <DialogDescription>Enter a name for your new automation workflow.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input 
              placeholder="e.g. Daily Data Scraper"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateNew();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateNew} disabled={!newName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!workflowToDelete} onOpenChange={(open) => !open && setWorkflowToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Workflow</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this workflow? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setWorkflowToDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteWorkflow}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
