import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Plus, Trash } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';

interface Secret {
  id: string;
  key: string;
  value: string;
  is_secret: boolean;
  created_at: string;
}

interface SecretsTabProps {
  secrets: Secret[];
  onAdd: (form: { key: string; value: string; is_secret: boolean }) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

export function SecretsTab({ secrets, onAdd, onDelete }: SecretsTabProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({ key: '', value: '', is_secret: true });

  const handleSave = async () => {
    const success = await onAdd(form);
    if (success) {
      setIsOpen(false);
      setForm({ key: '', value: '', is_secret: true });
    }
  };

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">Manage your API keys and environment variables securely.</p>
        <Button onClick={() => setIsOpen(true)} size="sm">
          <Plus className="mr-2" size={14} /> Add Secret
        </Button>
      </div>

      <div className="border border-border/80">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead>Key / Name</TableHead>
              <TableHead>Value</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {secrets.map((secret) => (
              <TableRow key={secret.id}>
                <TableCell className="font-mono text-xs font-semibold">{secret.key}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{secret.value}</TableCell>
                <TableCell className="text-right">
                  <Button
                    onClick={() => onDelete(secret.id)}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                  >
                    <Trash size={14} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {secrets.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-xs text-muted-foreground">
                  No secrets added yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Secret</DialogTitle>
            <DialogDescription>
              Create a new environment variable or API key credentials.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase">Key Name</label>
              <Input
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                placeholder="e.g. GEMINI_API_KEY"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase">Value</label>
              <Input
                type="password"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                placeholder="Enter secret value..."
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="is_secret"
                checked={form.is_secret}
                onChange={(e) => setForm({ ...form, is_secret: e.target.checked })}
                className="rounded border-border text-primary focus:ring-primary h-4 w-4"
              />
              <label htmlFor="is_secret" className="text-xs font-semibold select-none cursor-pointer">
                Mask value (is secret key)
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!form.key || !form.value}>
              Save Secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
