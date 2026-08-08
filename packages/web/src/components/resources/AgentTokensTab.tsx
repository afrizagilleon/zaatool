import { useMemo, useState } from 'react';
import type { AgentTokenRecord } from '../../hooks/useAgentTokens';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Plus, MagnifyingGlass, Trash, Copy, Check, Warning } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';

interface AgentTokensTabProps {
  tokens: AgentTokenRecord[];
  error?: string | null;
  newlyIssuedToken?: string | null;
  onClearNewlyIssuedToken?: () => void;
  onIssue: (label: string, scope: 'author' | 'reader') => Promise<string | null>;
  onRevoke?: (id: string) => Promise<boolean>;
}

export function AgentTokensTab({
  tokens,
  error,
  newlyIssuedToken,
  onClearNewlyIssuedToken,
  onIssue,
  onRevoke,
}: AgentTokensTabProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<{ label: string; scope: 'author' | 'reader' }>({
    label: '',
    scope: 'author',
  });
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tokens;
    return tokens.filter((t) => t.label.toLowerCase().includes(needle));
  }, [tokens, query]);

  const handleIssue = async () => {
    if (!form.label.trim()) return;
    const token = await onIssue(form.label.trim(), form.scope);
    if (token) {
      setIsOpen(false);
      setForm({ label: '', scope: 'author' });
    }
  };

  const copyToken = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="py-6 space-y-4">
      {error && (
        <div
          className="p-3 rounded-md bg-destructive/10 text-destructive text-sm font-medium border border-destructive/20"
          data-testid="agent-tokens-error"
        >
          {error}
        </div>
      )}

      {newlyIssuedToken && (
        <div
          className="p-4 rounded-md bg-amber-500/10 border border-amber-500/30 space-y-2"
          data-testid="new-token-alert"
        >
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-xs uppercase tracking-wide">
            <Warning size={15} /> Save this token now! It will not be shown again.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs p-2 rounded bg-background border border-border overflow-x-auto select-all">
              {newlyIssuedToken}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyToken(newlyIssuedToken)}
              className="shrink-0 h-8 gap-1.5"
            >
              {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy Token'}
            </Button>
            {onClearNewlyIssuedToken && (
              <Button size="sm" variant="ghost" onClick={onClearNewlyIssuedToken} className="shrink-0 h-8 text-xs">
                Dismiss
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center gap-3">
        <p className="text-sm text-muted-foreground shrink-0">
          Issue and revoke API tokens for autonomous agents.
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
              placeholder="Search agent tokens…"
              className="h-8 w-52 pl-7 text-xs"
            />
          </div>
          <Button onClick={() => setIsOpen(true)} size="sm">
            <Plus className="mr-2" size={14} /> Issue Token
          </Button>
        </div>
      </div>

      <div className="border border-border/80 rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matches.map((token) => (
              <TableRow key={token.id}>
                <TableCell className="font-mono text-xs font-semibold">{token.label}</TableCell>
                <TableCell className="text-xs uppercase font-semibold text-muted-foreground">{token.scope}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(token.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {token.last_used_at ? new Date(token.last_used_at).toLocaleDateString() : 'Never'}
                </TableCell>
                <TableCell className="text-right">
                  {onRevoke && (
                    <Button
                      onClick={() => onRevoke(token.id)}
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                      title="Revoke token"
                    >
                      <Trash size={13} className="mr-1" /> Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {matches.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-xs text-muted-foreground">
                  {tokens.length === 0 ? 'No agent tokens issued yet.' : `No token matches “${query}”.`}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Issue Agent Token</DialogTitle>
            <DialogDescription>
              Create a revocable token for an agent harness or script.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase">Label / Name</label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Hermes Bot"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase">Scope</label>
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value as 'author' | 'reader' })}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="author">Author (Read, write, and run drafts)</option>
                <option value="reader">Reader (Read and run drafts)</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleIssue} disabled={!form.label.trim()}>
              Issue Token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
