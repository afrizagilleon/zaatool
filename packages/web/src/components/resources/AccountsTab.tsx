import { useMemo, useState } from 'react';
import type { AccountUser, Role } from '@zaa-tool/shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Plus, MagnifyingGlass, UserCheck, UserMinus } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { useAuthStore } from '../../store/authStore';

interface AccountsTabProps {
  accounts: AccountUser[];
  error?: string | null;
  onCreate: (form: { username: string; email?: string; passwordPlain: string; role: Role }) => Promise<boolean>;
  onSetActive?: (id: string, active: boolean) => Promise<boolean>;
}

export function AccountsTab({ accounts, error, onCreate, onSetActive }: AccountsTabProps) {
  const currentUser = useAuthStore((s) => s.user);
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<{ username: string; email: string; passwordPlain: string; role: Role }>({
    username: '',
    email: '',
    passwordPlain: '',
    role: 'viewer',
  });
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter(
      (a) => a.username.toLowerCase().includes(needle) || (a.email && a.email.toLowerCase().includes(needle))
    );
  }, [accounts, query]);

  const handleSave = async () => {
    const success = await onCreate({
      username: form.username,
      email: form.email || undefined,
      passwordPlain: form.passwordPlain,
      role: form.role,
    });
    if (success) {
      setIsOpen(false);
      setForm({ username: '', email: '', passwordPlain: '', role: 'viewer' });
    }
  };

  return (
    <div className="py-6">
      {error && (
        <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm font-medium border border-destructive/20" data-testid="accounts-error">
          {error}
        </div>
      )}

      <div className="flex justify-between items-center gap-3 mb-4">
        <p className="text-sm text-muted-foreground shrink-0">
          Manage system users, grant roles, and deactivate accounts.
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
              placeholder="Search users…"
              className="h-8 w-52 pl-7 text-xs"
            />
          </div>
          <Button onClick={() => setIsOpen(true)} size="sm">
            <Plus className="mr-2" size={14} /> Add Account
          </Button>
        </div>
      </div>

      <div className="border border-border/80 rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[120px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matches.map((account) => {
              const isSelf = currentUser?.id === account.id;
              return (
                <TableRow key={account.id}>
                  <TableCell className="font-mono text-xs font-semibold">{account.username}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{account.email || '—'}</TableCell>
                  <TableCell className="text-xs capitalize font-medium">{account.role}</TableCell>
                  <TableCell className="text-xs">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                        account.active
                          ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                          : 'bg-muted text-muted-foreground border border-border'
                      }`}
                    >
                      {account.active ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {!isSelf && onSetActive && (
                      <Button
                        onClick={() => onSetActive(account.id, !account.active)}
                        variant="ghost"
                        size="sm"
                        className={`h-7 px-2 text-xs font-medium transition-colors ${
                          account.active
                            ? 'hover:bg-destructive/10 hover:text-destructive text-muted-foreground'
                            : 'hover:bg-emerald-500/10 hover:text-emerald-500 text-muted-foreground'
                        }`}
                      >
                        {account.active ? (
                          <>
                            <UserMinus size={13} className="mr-1" /> Deactivate
                          </>
                        ) : (
                          <>
                            <UserCheck size={13} className="mr-1" /> Activate
                          </>
                        )}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {matches.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-xs text-muted-foreground">
                  {accounts.length === 0 ? 'No accounts added yet.' : `No account matches “${query}”.`}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Account</DialogTitle>
            <DialogDescription>Create a new user account with initial role and credentials.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase">Username</label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="e.g. johndoe"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase">Email (Optional)</label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="john@example.com"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase">Password</label>
              <Input
                type="password"
                value={form.passwordPlain}
                onChange={(e) => setForm({ ...form, passwordPlain: e.target.value })}
                placeholder="At least 8 characters"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="viewer">Viewer (Run apps)</option>
                <option value="creator">Creator (Full access)</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!form.username || form.passwordPlain.length < 8}>
              Create Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
