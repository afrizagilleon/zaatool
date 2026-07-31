import { useState } from 'react';
import { Lightning, Plus, Trash, Copy, Check, Clock, Globe } from '@phosphor-icons/react';
import type { NotebookTrigger } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { cn } from '../../lib/utils';
import { API_BASE_URL } from '../../lib/api';
import { ScheduleEditor } from '../schedule/ScheduleEditor';
import { SecretPicker } from '../resources/SecretPicker';

interface TriggerPanelProps {
  triggers: NotebookTrigger[];
  isSaved: boolean;
  onAdd: (kind: 'cron' | 'webhook') => void;
  onUpdate: (triggerId: string, patch: Partial<NotebookTrigger>) => void;
  onRemove: (triggerId: string) => void;
}

function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <code className="flex-1 min-w-0 truncate px-1.5 py-1 bg-muted text-[10px] font-mono text-foreground/80">
        {url}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="w-6 h-6 shrink-0"
        title="Copy URL"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={11} className="text-status-done" /> : <Copy size={11} />}
      </Button>
    </div>
  );
}

/**
 * Triggers are notebook-level, so they are edited here rather than as a cell.
 *
 * Nothing takes effect until the notebook is saved: the trigger index is rebuilt from
 * the document on save, so an unsaved trigger will not fire. The panel says so rather
 * than letting the reader guess.
 */
export function TriggerPanel({ triggers, isSaved, onAdd, onUpdate, onRemove }: TriggerPanelProps) {
  return (
    <div className="w-96 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Lightning size={13} className="text-muted-foreground" />
        <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
          Triggers
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] text-muted-foreground"
          onClick={() => onAdd('cron')}
        >
          <Plus size={10} className="mr-1" />
          Cron
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] text-muted-foreground"
          onClick={() => onAdd('webhook')}
        >
          <Plus size={10} className="mr-1" />
          Webhook
        </Button>
      </div>

      {triggers.length === 0 && (
        <p className="text-[10px] text-muted-foreground leading-normal">
          No triggers. This notebook only runs when you run it. Add a cron trigger to run it
          on a schedule, or a webhook to run it from an HTTP request.
        </p>
      )}

      {triggers.length > 0 && !isSaved && (
        <p className="text-[10px] text-amber-500 leading-normal">
          Save the notebook for these to take effect — triggers are read from the saved document.
        </p>
      )}

      <div className="space-y-2">
        {triggers.map((trigger) => (
          <div
            key={trigger.id}
            className={cn(
              'border border-border p-2 space-y-1.5',
              trigger.enabled === false && 'opacity-50'
            )}
          >
            <div className="flex items-center gap-2">
              {trigger.kind === 'cron' ? (
                <Clock size={12} className="text-muted-foreground shrink-0" />
              ) : (
                <Globe size={12} className="text-muted-foreground shrink-0" />
              )}
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {trigger.kind}
              </span>
              <div className="flex-1" />
              <Switch
                checked={trigger.enabled !== false}
                onCheckedChange={(checked) => onUpdate(trigger.id, { enabled: checked })}
                title={trigger.enabled === false ? 'Disabled' : 'Enabled'}
              />
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6 text-red-400 hover:text-red-300"
                title="Remove trigger"
                onClick={() => onRemove(trigger.id)}
              >
                <Trash size={11} />
              </Button>
            </div>

            {trigger.kind === 'cron' ? (
              <ScheduleEditor
                value={trigger.cron}
                onChange={(cron) => onUpdate(trigger.id, { cron })}
              />
            ) : (
              <>
                <CopyableUrl url={`${API_BASE_URL}/hooks/${trigger.slug}`} />

                <SecretPicker
                  value={trigger.secretKey}
                  onChange={(secretKey) => onUpdate(trigger.id, { secretKey })}
                  missingConsequence="This webhook rejects every request until that is fixed."
                />

                <p className="text-[9px] text-muted-foreground/60 leading-normal">
                  Anyone with this URL can run the notebook. Choosing a secret also requires{' '}
                  <span className="font-mono">X-Webhook-Secret</span> to carry that secret&apos;s{' '}
                  <strong>value</strong> — not its name. The request body arrives as{' '}
                  <span className="font-mono">inputs.trigger.body</span>.
                </p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
