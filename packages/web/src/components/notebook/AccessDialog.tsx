import { useCallback, useEffect, useState } from 'react';
import { Users, Plus, X, Spinner, WarningCircle } from '@phosphor-icons/react';
import type { NotebookAccessSettings } from '@zaa-tool/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { notebooksApi } from '../../lib/notebooks-api';

/**
 * Who a notebook is shared with.
 *
 * A notebook has one owner. The owner and the editors they invite can open it, change it,
 * deploy it and run it; everybody else is told it does not exist. The *app* — the deployed
 * page — is a separate question with a separate answer: it is used by everybody, or by the
 * people named here, and those people never see the source and only see their own runs.
 *
 * Asked for when the dialog opens rather than when the editor does, and only the owner is
 * answered. An editor who clicks it is told whose it is to change, which is the fact they
 * were missing; nothing is requested on their behalf at load time.
 */

/** A list of usernames being edited: names to add and remove before anything is sent. */
function NameList({
  label,
  names,
  placeholder,
  onChange,
}: {
  label: string;
  names: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    if (!names.includes(name)) onChange([...names, name]);
    setDraft('');
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      {names.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">Nobody yet.</p>
      ) : (
        <ul className="space-y-1">
          {names.map((name) => (
            <li
              key={name}
              className="flex items-center gap-2 border border-border px-2 py-1 text-xs"
            >
              <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground"
                title={`Remove ${name}`}
                aria-label={`Remove ${name}`}
                onClick={() => onChange(names.filter((entry) => entry !== name))}
              >
                <X size={11} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-8 flex-1 text-xs"
        />
        <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={add}>
          <Plus size={12} className="mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
}

export function AccessDialog({
  notebookId,
  notebookName,
  open,
  onOpenChange,
}: {
  notebookId: string;
  notebookName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [settings, setSettings] = useState<NotebookAccessSettings | null>(null);
  const [editors, setEditors] = useState<string[]>([]);
  const [appUsers, setAppUsers] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<'all' | 'selected'>('all');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const show = useCallback((next: NotebookAccessSettings) => {
    setSettings(next);
    setEditors(next.editors.map((entry) => entry.username));
    setAppUsers(next.appUsers.map((entry) => entry.username));
    setVisibility(next.appVisibility);
  }, []);

  // Forgotten each time it opens, so a refusal or a half-typed list from the last time is
  // not what greets the next person. Done while rendering, as the share dialog does, rather
  // than in the effect below, where it would be a state change cascading from an effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSettings(null);
      setError(null);
      setSaved(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    notebooksApi
      .access(notebookId)
      .then((next) => {
        if (!cancelled) show(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, notebookId, show]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      show(
        await notebooksApi.setAccess(notebookId, {
          editors,
          appVisibility: visibility,
          appUsers,
        })
      );
      setSaved(true);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Access to “{notebookName}”</DialogTitle>
          <DialogDescription className="text-xs">
            Editors can open, change, deploy and run this notebook. When an editor runs the draft
            it uses their own secrets, never yours; the deployed version, once someone deploys it,
            runs with yours. Inviting an editor means trusting them with what this notebook can reach.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-status-error">
            <WarningCircle size={13} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        {settings === null && !error && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner size={12} className="animate-spin" />
            Loading…
          </p>
        )}

        {settings !== null && (
          <div className="space-y-5">
            <p className="text-xs">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Owner{' '}
              </span>
              <span className="font-mono">{settings.owner?.username ?? 'nobody'}</span>
            </p>

            <NameList
              label="Editors"
              names={editors}
              placeholder="Username of a creator"
              onChange={setEditors}
            />

            <fieldset className="space-y-1.5">
              <legend className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Who can use the app
              </legend>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="app-visibility"
                  checked={visibility === 'all'}
                  onChange={() => setVisibility('all')}
                />
                Everyone with an account
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="app-visibility"
                  checked={visibility === 'selected'}
                  onChange={() => setVisibility('selected')}
                />
                Only selected people
              </label>
              <p className="text-[11px] text-muted-foreground/80">
                People who use the app never see its source, and only see the runs they
                started. Owner and editors can always use it.
              </p>
            </fieldset>

            {visibility === 'selected' && (
              <NameList
                label="People who can use the app"
                names={appUsers}
                placeholder="Username"
                onChange={setAppUsers}
              />
            )}

            <div className="flex items-center justify-end gap-2">
              {saved && <span className="text-xs text-status-done">Saved.</span>}
              <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={() => void save()}>
                {busy && <Spinner size={12} className="mr-1.5 animate-spin" />}
                Save access
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The toolbar's button for it. */
export function AccessButton({
  notebookId,
  notebookName,
}: {
  notebookId: string;
  notebookName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
        onClick={() => setIsOpen(true)}
        title="Who can open, change and use this notebook"
      >
        <Users size={12} className="mr-1" />
        Access
      </Button>
      <AccessDialog
        notebookId={notebookId}
        notebookName={notebookName}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </>
  );
}
