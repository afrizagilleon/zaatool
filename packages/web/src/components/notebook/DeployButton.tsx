import { useCallback, useEffect, useState } from 'react';
import { RocketLaunch, CheckCircle } from '@phosphor-icons/react';
import type { NotebookDeployState } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { notebooksApi } from '../../lib/notebooks-api';
import { DeployReviewDialog } from './DeployReviewDialog';
import { ProductionDialog } from './ProductionDialog';
import { cn } from '../../lib/utils';

/**
 * The line between what you are editing and what runs unattended.
 *
 * Deploying used to be meaningless here because saving *was* publishing: editing a
 * notebook at 2pm changed what its webhook did at 2:01. This button is what makes the
 * draft safe to work in, so it says plainly which of the two states you are in.
 */
interface DeployButtonProps {
  notebookId: string;
  /** Changing this refetches — after a save the draft may have moved on. */
  refreshKey: unknown;
  hasTriggers: boolean;
  /** Unsaved edits on screen. Deploying would pin the saved document, not this one. */
  isDirty: boolean;
}

function summary(state: NotebookDeployState | null, hasTriggers: boolean): string {
  if (!state) return '';
  if (!state.isDeployed) {
    return hasTriggers
      ? 'Not deployed — its triggers will not fire until you do'
      : 'Not deployed';
  }
  if (state.hasUndeployedChanges) {
    return `Deployed ${new Date(state.deployedAt ?? '').toLocaleString()} · your draft has changes`;
  }
  return `Deployed ${new Date(state.deployedAt ?? '').toLocaleString()}`;
}

export function DeployButton({ notebookId, refreshKey, hasTriggers, isDirty }: DeployButtonProps) {
  const [state, setState] = useState<NotebookDeployState | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);

  const refresh = useCallback(async () => {
    if (!notebookId) return;
    try {
      setState(await notebooksApi.deployState(notebookId));
    } catch {
      setState(null);
    }
  }, [notebookId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  if (!notebookId) return null;

  const needsDeploy = !state?.isDeployed || state.hasUndeployedChanges;
  // Deploy pins whatever is *saved*, so offering it with edits still on screen would
  // quietly ship the previous version and look like it had shipped this one.
  const blockedByUnsaved = isDirty;
  // Only worth shouting about when something is actually waiting to go live.
  const isUrgent = hasTriggers && needsDeploy;

  return (
    <>
    <Button
      variant={isUrgent ? 'outline' : 'ghost'}
      size="sm"
      className={cn(
        'h-7 px-2.5 text-xs',
        isUrgent
          ? 'border-amber-500/40 text-amber-600 dark:text-amber-500 hover:bg-amber-500/10'
          : 'text-muted-foreground hover:text-foreground'
      )}
      title={
        blockedByUnsaved
          ? 'Save before deploying'
          : needsDeploy
            ? summary(state, hasTriggers)
            : `${summary(state, hasTriggers)} — click to see what it serves`
      }
      // Once deployed and unchanged there is nothing to deploy, but there is still
      // something to answer: what is this running, and how do I stop it.
      disabled={needsDeploy && blockedByUnsaved}
      onClick={() => (needsDeploy ? setIsReviewing(true) : setIsInspecting(true))}
    >
      {needsDeploy ? (
        <RocketLaunch size={13} className="mr-1.5" />
      ) : (
        <CheckCircle size={13} weight="fill" className="mr-1.5 text-status-done" />
      )}
      {needsDeploy ? 'Deploy' : 'Deployed'}
    </Button>

    {/* Deploying goes through the review rather than straight from the button: the gate
        is only worth having if the decision behind it is informed. */}
    <DeployReviewDialog
      notebookId={notebookId}
      open={isReviewing}
      onOpenChange={setIsReviewing}
      onDeployed={() => void refresh()}
    />

    <ProductionDialog
      notebookId={notebookId}
      serving={state?.serving}
      deployedAt={state?.deployedAt ?? null}
      open={isInspecting}
      onOpenChange={setIsInspecting}
      onUndeployed={() => void refresh()}
    />
    </>
  );
}
