import { useFlowStore } from '../../../store/flowStore';
import { Switch } from '../../ui/switch';
import { Label } from '../../ui/label';
import { ScheduleEditor } from '../../schedule/ScheduleEditor';
import { DEFAULT_CRON } from '../../../lib/cron-schedule';

export function TriggerCronProperties({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore(s => s.nodes);
  const updateNodeData = useFlowStore(s => s.updateNodeData);

  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const cronExpression = (node.data.cronExpression as string) || DEFAULT_CRON;
  const enabled = node.data.enabled !== false;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-border/50 pb-3">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="cron-enabled-switch" className="text-xs font-semibold">Enable Schedule</Label>
          <span className="text-[10px] text-muted-foreground">Toggle automated background execution</span>
        </div>
        <Switch
          id="cron-enabled-switch"
          checked={enabled}
          onCheckedChange={(val) => updateNodeData(nodeId, { enabled: val })}
          className="cursor-pointer"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Schedule
        </Label>
        {/* Shared with the notebook trigger panel, so a schedule reads the same wherever
            it is edited and cron parsing lives in exactly one place. */}
        <ScheduleEditor
          value={cronExpression}
          onChange={(cron) => updateNodeData(nodeId, { cronExpression: cron })}
        />
      </div>
    </div>
  );
}
