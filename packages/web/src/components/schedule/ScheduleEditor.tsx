import { useEffect, useRef, useState } from 'react';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../../lib/utils';
import {
  DAY_INITIALS,
  DAY_NAMES,
  compileSchedule,
  describeCron,
  parseCron,
  type Schedule,
  type ScheduleMode,
} from '../../lib/cron-schedule';
import { useCronTimezone } from '../../lib/cron-timezone';

interface ScheduleEditorProps {
  /** The cron expression being edited. */
  value: string;
  onChange: (cron: string) => void;
}

const MODES: { id: ScheduleMode; label: string }[] = [
  { id: 'interval', label: 'Every few minutes or hours' },
  { id: 'daily', label: 'Once a day' },
  { id: 'weekly', label: 'Certain days of the week' },
  { id: 'cron', label: 'Custom cron expression' },
];

/**
 * Edits a cron expression as a schedule rather than as five positional fields.
 *
 * Shared by the notebook trigger panel and the canvas cron node so both speak the same
 * language; the cron string stays the only thing either one stores.
 */
export function ScheduleEditor({ value, onChange }: ScheduleEditorProps) {
  const [schedule, setSchedule] = useState<Schedule>(() => parseCron(value));
  const zone = useCronTimezone();

  /**
   * What we last handed to `onChange`. An expression arriving from outside (a different
   * trigger selected, a document loaded) is re-parsed; our own echo is ignored, so the
   * controls do not jump while they are being used.
   */
  const emitted = useRef(value);

  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setSchedule(parseCron(value));
    }
  }, [value]);

  const apply = (patch: Partial<Schedule>) => {
    const next = { ...schedule, ...patch };
    setSchedule(next);
    const cron = compileSchedule(next);
    emitted.current = cron;
    onChange(cron);
  };

  const changeMode = (mode: ScheduleMode) => {
    // Switching to custom hands over the expression currently in force, so the raw
    // field starts from what was already scheduled rather than from a default.
    apply(mode === 'cron' ? { mode, expression: compileSchedule(schedule) } : { mode });
  };

  const toggleDay = (day: number) => {
    const isOn = schedule.days.includes(day);
    // Zero days would mean the trigger never fires, which nobody is asking for.
    if (isOn && schedule.days.length === 1) return;
    apply({ days: isOn ? schedule.days.filter((d) => d !== day) : [...schedule.days, day] });
  };

  return (
    <div className="space-y-2">
      <Select value={schedule.mode} onValueChange={(mode) => changeMode(mode as ScheduleMode)}>
        <SelectTrigger className="h-7 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODES.map((mode) => (
            <SelectItem key={mode.id} value={mode.id} className="text-xs">
              {mode.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {schedule.mode === 'interval' && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground shrink-0">Every</span>
          <Input
            type="number"
            min={1}
            value={schedule.every}
            onChange={(e) => apply({ every: Math.max(1, Number(e.target.value) || 1) })}
            className="h-7 w-16 text-xs"
          />
          <Select
            value={schedule.unit}
            onValueChange={(unit) => apply({ unit: unit as Schedule['unit'] })}
          >
            <SelectTrigger className="h-7 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes" className="text-xs">minutes</SelectItem>
              <SelectItem value="hours" className="text-xs">hours</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {schedule.mode === 'daily' && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground shrink-0">At</span>
          <Input
            type="time"
            value={schedule.time}
            onChange={(e) => apply({ time: e.target.value || '09:00' })}
            className="h-7 w-28 text-xs"
          />
        </div>
      )}

      {schedule.mode === 'weekly' && (
        <div className="space-y-1.5">
          <div className="flex gap-1">
            {DAY_INITIALS.map((initial, day) => {
              const isOn = schedule.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  title={DAY_NAMES[day]}
                  aria-pressed={isOn}
                  className={cn(
                    'flex-1 h-7 text-[10px] font-bold border transition-colors',
                    isOn
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-background border-border text-muted-foreground hover:bg-muted'
                  )}
                >
                  {initial}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground shrink-0">At</span>
            <Input
              type="time"
              value={schedule.time}
              onChange={(e) => apply({ time: e.target.value || '09:00' })}
              className="h-7 w-28 text-xs"
            />
          </div>
        </div>
      )}

      {schedule.mode === 'cron' && (
        <>
          <Input
            value={schedule.expression}
            onChange={(e) => apply({ expression: e.target.value })}
            placeholder="0 9 * * *"
            className="h-7 text-xs font-mono"
          />
          <p className="text-[9px] text-muted-foreground/60">
            minute hour day-of-month month day-of-week
          </p>
        </>
      )}

      {/* The summary is the answer to "when does this actually run", which the five
          fields above only imply. The expression follows it because that is what gets
          saved, and hiding it would make a hand-written cron unverifiable. */}
      <p className="flex items-baseline gap-1.5 text-[10px] text-muted-foreground">
        <span className="text-foreground/80">{describeCron(compileSchedule(schedule))}</span>
        {zone && <span className="text-[10px] text-muted-foreground">({zone})</span>}
        <span className="font-mono text-[9px] text-muted-foreground/60">
          {compileSchedule(schedule)}
        </span>
      </p>
    </div>
  );
}
