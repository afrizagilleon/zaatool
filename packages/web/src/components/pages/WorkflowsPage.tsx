import { Plus } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useWorkflows, parseUtcDate } from '../../hooks/useWorkflows';
import { WorkflowsTable } from './workflows/WorkflowsTable';
import { WorkflowCreateDialog } from './workflows/WorkflowCreateDialog';
import { WorkflowDeleteDialog } from './workflows/WorkflowDeleteDialog';

export function WorkflowsPage() {
  const {
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
    handleCreateNew,
    openWorkflow,
    deleteWorkflow,
  } = useWorkflows();

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
            <div className="text-xs text-muted-foreground font-medium">{filtered.length} total</div>
          </div>
          <WorkflowsTable
            filtered={filtered}
            isLoading={isLoading}
            onOpen={openWorkflow}
            onDelete={setWorkflowToDelete}
            parseUtcDate={parseUtcDate}
          />
        </div>
      </div>

      <WorkflowCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        newName={newName}
        setNewName={setNewName}
        onCreate={handleCreateNew}
      />

      <WorkflowDeleteDialog
        workflowId={workflowToDelete}
        onCancel={() => setWorkflowToDelete(null)}
        onConfirm={deleteWorkflow}
      />
    </div>
  );
}
