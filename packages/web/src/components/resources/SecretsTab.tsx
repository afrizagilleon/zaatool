import { useId, useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { MagnifyingGlass, Plus, Trash } from '@phosphor-icons/react';
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
  const fieldId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({ key: '', value: '', is_secret: true });
  const [query, setQuery] = useState('');

  // Matching on the key only — searching values would put secrets in the DOM as you type.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return secrets;
    return secrets.filter((secret) => secret.key.toLowerCase().includes(needle));
  }, [secrets, query]);

  const handleSave = async () => {
    const success = await onAdd(form);
    if (success) {
      setIsOpen(false);
      setForm({ key: '', value: '', is_secret: true });
    }
  };

  return (
    <div className="py-6">
      <div className="flex justify-between items-center gap-3 mb-4">
        <p className="text-sm text-muted-foreground shrink-0">
          Manage your API keys and environment variables securely. They are yours: a notebook you own
          runs with them, and so does its deployed version. An editor you invite runs the draft with their
          own secrets of the same names, never with yours.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass
              size={13}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name…"
              className="h-8 w-52 pl-7 text-xs"
            />
          </div>
          <Button onClick={() => setIsOpen(true)} size="sm">
            <Plus className="mr-2" size={14} /> Add Secret
          </Button>
        </div>
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
            {matches.map((secret) => (
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
            {matches.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-xs text-muted-foreground">
                  {secrets.length === 0
                    ? 'No secrets added yet.'
                    : `No secret matches “${query}”.`}
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
              <label htmlFor={`${fieldId}-key`} className="text-xs font-bold text-muted-foreground uppercase">Key Name</label>
              <Input
                id={`${fieldId}-key`}
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                placeholder="e.g. GEMINI_API_KEY"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-value`} className="text-xs font-bold text-muted-foreground uppercase">Value</label>
              <Input
                id={`${fieldId}-value`}
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
