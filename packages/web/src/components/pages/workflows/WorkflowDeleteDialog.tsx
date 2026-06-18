import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../../ui/dialog';
import { Button } from '../../ui/button';

interface WorkflowDeleteDialogProps {
  workflowId: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function WorkflowDeleteDialog({ workflowId, onCancel, onConfirm }: WorkflowDeleteDialogProps) {
  return (
    <Dialog open={!!workflowId} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Workflow</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this workflow? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
