import { useState } from 'react';
import {
  Robot,
  AppWindow,
  Clock,
  Globe,
  Package,
  Spinner,
  WarningCircle,
} from '@phosphor-icons/react';
import type { NotebookServing } from '@zaa-tool/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { notebooksApi } from '../../lib/notebooks-api';

/**
 * What this notebook is serving right now, and how to stop it.
 *
 * Deploying had no opposite. Once something was live the only ways out were deleting the
 * notebook — which takes the draft and the history with it — or editing it until it
 * broke. Neither is a decision anyone should have to make.
 *
 * Everything switched off is named before the button is pressed. "Take out of
 * production" is not frightening when you can see what production currently means; it is
 * frightening when you cannot.
 */

interface ProductionDialogProps {
  notebookId: string;
  serving: NotebookServing | undefined;
  deployedAt: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUndeployed: () => void;
}

function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

export function ProductionDialog({
  notebookId,
  serving,
  deployedAt,
  open,
  onOpenChange,
  onUndeployed,
}: ProductionDialogProps) {
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undeploy = async () => {
    setIsWorking(true);
    setError(null);
    try {
      await notebooksApi.undeploy(notebookId);
      onUndeployed();
      onOpenChange(false);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setIsWorking(false);
    }
  };

  const nothingServed =
    !serving?.toolName && !serving?.hasPage && (serving?.triggers.length ?? 0) === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">In production</DialogTitle>
          <DialogDescription className="text-xs">
            {deployedAt
              ? `Live since ${new Date(deployedAt).toLocaleString()}.`
              : 'Live.'}{' '}
            Taking it out stops all of this. The draft, its history and its versions stay.
          </DialogDescription>
        </DialogHeader>

        {nothingServed ? (
          <p className="text-xs text-muted-foreground">
            Nothing is currently served by it: no contract, so no tool and no page, and no
            enabled triggers. Taking it out of production changes nothing you can see.
          </p>
        ) : (
          <ul className="space-y-2 border border-border p-3">
            {serving?.toolName && (
              <Line icon={<Robot size={13} />}>
                Agents lose the tool <code className="font-mono">{serving.toolName}</code>.
                Anyone connected is told.
              </Line>
            )}
            {serving?.hasPage && (
              <Line icon={<AppWindow size={13} />}>Its page disappears from Apps.</Line>
            )}
            {/* Shown here because a change to `packages:` is a change to what production
                installs, and it is the one change least visible in a diff of the cells. */}
            {(serving?.packages.length ?? 0) > 0 && (
              <Line icon={<Package size={13} />}>
                It installs{' '}
                <code className="font-mono">{serving?.packages.join(', ')}</code> before its
                first cell.
              </Line>
            )}
            {serving?.triggers.map((trigger) => (
              <Line
                key={`${trigger.kind}-${trigger.label}`}
                icon={trigger.kind === 'cron' ? <Clock size={13} /> : <Globe size={13} />}
              >
                {trigger.kind === 'cron' ? 'Schedule' : 'Webhook'}{' '}
                <code className="font-mono">{trigger.label}</code> starts refusing with 409
                instead of running.
              </Line>
            ))}
          </ul>
        )}

        {error && (
          <p className="flex items-start gap-1.5 text-xs text-status-error">
            <WarningCircle size={13} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
            Leave it running
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-status-error/40 text-xs text-status-error hover:bg-status-error/10"
            disabled={isWorking}
            onClick={() => void undeploy()}
          >
            {isWorking && <Spinner size={12} className="mr-1.5 animate-spin" />}
            Take out of production
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
