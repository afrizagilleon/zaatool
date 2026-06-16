import { useState, useEffect } from 'react';
import { useFlowStore } from '../../../store/flowStore';
import { Input } from '../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Switch } from '../../ui/switch';
import { Label } from '../../ui/label';
import { cn } from '../../../lib/utils';

export function TriggerCronProperties({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore(s => s.nodes);
  const updateNodeData = useFlowStore(s => s.updateNodeData);

  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  // Read config values from data
  const cronExpression = node.data.cronExpression || '*/5 * * * *';
  const enabled = node.data.enabled !== false;

  // Local UI state
  const [scheduleMode, setScheduleMode] = useState<'interval' | 'daily' | 'weekly' | 'cron'>('interval');
  const [intervalVal, setIntervalVal] = useState<number>(5);
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours'>('minutes');
  const [dailyTime, setDailyTime] = useState<string>('09:00');
  const [weeklyDays, setWeeklyDays] = useState<number[]>([1]); // Default Monday
  const [weeklyTime, setWeeklyTime] = useState<string>('09:00');
  const [rawCron, setRawCron] = useState<string>('*/5 * * * *');

  const DAYS = [
    { label: 'S', value: 0, fullName: 'Sunday' },
    { label: 'M', value: 1, fullName: 'Monday' },
    { label: 'T', value: 2, fullName: 'Tuesday' },
    { label: 'W', value: 3, fullName: 'Wednesday' },
    { label: 'T', value: 4, fullName: 'Thursday' },
    { label: 'F', value: 5, fullName: 'Friday' },
    { label: 'S', value: 6, fullName: 'Saturday' },
  ];

  // Try parsing initial cronExpression into visual state on mount
  useEffect(() => {
    if (!cronExpression) return;
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length !== 5) {
      setScheduleMode('cron');
      setRawCron(cronExpression);
      return;
    }

    const [min, hour, dom, mon, dow] = parts;

    // Check interval minutes: */X * * * *
    if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
      setScheduleMode('interval');
      setIntervalVal(parseInt(min.slice(2), 10) || 5);
      setIntervalUnit('minutes');
      return;
    }

    // Check interval hours: 0 */X * * *
    if (min === '0' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
      setScheduleMode('interval');
      setIntervalVal(parseInt(hour.slice(2), 10) || 1);
      setIntervalUnit('hours');
      return;
    }

    // Check daily: M H * * *
    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
      setScheduleMode('daily');
      setDailyTime(`${hour.padStart(2, '0')}:${min.padStart(2, '0')}`);
      return;
    }

    // Check weekly: M H * * DOW
    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow !== '*') {
      setScheduleMode('weekly');
      setWeeklyTime(`${hour.padStart(2, '0')}:${min.padStart(2, '0')}`);
      const days = dow.split(',').map(Number).filter((n: number) => !isNaN(n));
      setWeeklyDays(days.length > 0 ? days : [1]);
      return;
    }

    // Fallback to raw cron
    setScheduleMode('cron');
    setRawCron(cronExpression);
  }, [nodeId]); // Trigger when switching nodes

  // Compile local state to cron pattern and update node
  const saveSchedule = (
    mode: 'interval' | 'daily' | 'weekly' | 'cron',
    state: {
      intervalVal: number;
      intervalUnit: 'minutes' | 'hours';
      dailyTime: string;
      weeklyDays: number[];
      weeklyTime: string;
      rawCron: string;
      enabled: boolean;
    }
  ) => {
    let compiled = '*/5 * * * *';

    if (mode === 'interval') {
      const val = state.intervalVal || 5;
      compiled = state.intervalUnit === 'minutes' ? `*/${val} * * * *` : `0 */${val} * * *`;
    } else if (mode === 'daily') {
      const [h, m] = state.dailyTime.split(':').map(Number);
      compiled = `${m} ${h} * * *`;
    } else if (mode === 'weekly') {
      const [h, m] = state.weeklyTime.split(':').map(Number);
      const daysStr = state.weeklyDays.sort().join(',');
      compiled = `${m} ${h} * * ${daysStr || '*'}`;
    } else if (mode === 'cron') {
      compiled = state.rawCron || '*/5 * * * *';
    }

    updateNodeData(nodeId, {
      cronExpression: compiled,
      enabled: state.enabled,
    });
  };

  const handleModeChange = (mode: any) => {
    setScheduleMode(mode);
    saveSchedule(mode, {
      intervalVal,
      intervalUnit,
      dailyTime,
      weeklyDays,
      weeklyTime,
      rawCron,
      enabled,
    });
  };

  const handleEnabledChange = (val: boolean) => {
    saveSchedule(scheduleMode, {
      intervalVal,
      intervalUnit,
      dailyTime,
      weeklyDays,
      weeklyTime,
      rawCron,
      enabled: val,
    });
  };

  const toggleDay = (day: number) => {
    let nextDays = [...weeklyDays];
    if (nextDays.includes(day)) {
      if (nextDays.length > 1) {
        nextDays = nextDays.filter(d => d !== day);
      }
    } else {
      nextDays.push(day);
    }
    setWeeklyDays(nextDays);
    saveSchedule(scheduleMode, {
      intervalVal,
      intervalUnit,
      dailyTime,
      weeklyDays: nextDays,
      weeklyTime,
      rawCron,
      enabled,
    });
  };

  return (
    <div className="space-y-5">
      {/* Active status */}
      <div className="flex items-center justify-between border-b border-border/50 pb-3">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="cron-enabled-switch" className="text-xs font-semibold">Enable Schedule</Label>
          <span className="text-[10px] text-muted-foreground">Toggle automated background execution</span>
        </div>
        <Switch
          id="cron-enabled-switch"
          checked={enabled}
          onCheckedChange={handleEnabledChange}
          className="cursor-pointer"
        />
      </div>

      {/* Schedule Mode Selector */}
      <div className="space-y-1.5">
        <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Schedule Mode</Label>
        <Select value={scheduleMode} onValueChange={handleModeChange}>
          <SelectTrigger className="h-8 text-xs bg-background">
            <SelectValue placeholder="Select schedule mode..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="interval" className="text-xs">Interval (Every X mins/hours)</SelectItem>
            <SelectItem value="daily" className="text-xs">Daily (Once per day)</SelectItem>
            <SelectItem value="weekly" className="text-xs">Weekly (On specific days)</SelectItem>
            <SelectItem value="cron" className="text-xs">Advanced (Cron Pattern)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Mode Specific Settings */}
      {scheduleMode === 'interval' && (
        <div className="space-y-3 p-3 bg-muted/20 border border-border/60 rounded-lg animate-in fade-in duration-200">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Interval Settings</Label>
          <div className="flex gap-2">
            <div className="w-1/2 space-y-1">
              <Label className="text-[10px] text-muted-foreground">Every</Label>
              <Input
                type="number"
                min={1}
                value={intervalVal}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10) || 1;
                  setIntervalVal(val);
                  saveSchedule('interval', {
                    intervalVal: val,
                    intervalUnit,
                    dailyTime,
                    weeklyDays,
                    weeklyTime,
                    rawCron,
                    enabled,
                  });
                }}
                className="h-8 text-xs bg-background"
              />
            </div>
            <div className="w-1/2 space-y-1">
              <Label className="text-[10px] text-muted-foreground">Unit</Label>
              <Select
                value={intervalUnit}
                onValueChange={(unit: any) => {
                  setIntervalUnit(unit);
                  saveSchedule('interval', {
                    intervalVal,
                    intervalUnit: unit,
                    dailyTime,
                    weeklyDays,
                    weeklyTime,
                    rawCron,
                    enabled,
                  });
                }}
              >
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes" className="text-xs">Minutes</SelectItem>
                  <SelectItem value="hours" className="text-xs">Hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {scheduleMode === 'daily' && (
        <div className="space-y-3 p-3 bg-muted/20 border border-border/60 rounded-lg animate-in fade-in duration-200">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Daily Settings</Label>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Execution Time</Label>
            <Input
              type="time"
              value={dailyTime}
              onChange={(e) => {
                const val = e.target.value || '09:00';
                setDailyTime(val);
                saveSchedule('daily', {
                  intervalVal,
                  intervalUnit,
                  dailyTime: val,
                  weeklyDays,
                  weeklyTime,
                  rawCron,
                  enabled,
                });
              }}
              className="h-8 text-xs bg-background"
            />
          </div>
        </div>
      )}

      {scheduleMode === 'weekly' && (
        <div className="space-y-3.5 p-3 bg-muted/20 border border-border/60 rounded-lg animate-in fade-in duration-200">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Weekly Settings</Label>
          
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Active Days</Label>
            <div className="flex justify-between gap-1">
              {DAYS.map((day) => {
                const active = weeklyDays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    className={cn(
                      "w-7 h-7 rounded-full text-[10px] font-bold flex items-center justify-center border transition-all cursor-pointer",
                      active
                        ? "bg-primary border-primary text-primary-foreground scale-105 shadow-sm"
                        : "bg-background border-border text-muted-foreground hover:bg-muted"
                    )}
                    title={day.fullName}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Execution Time</Label>
            <Input
              type="time"
              value={weeklyTime}
              onChange={(e) => {
                const val = e.target.value || '09:00';
                setWeeklyTime(val);
                saveSchedule('weekly', {
                  intervalVal,
                  intervalUnit,
                  dailyTime,
                  weeklyDays,
                  weeklyTime: val,
                  rawCron,
                  enabled,
                });
              }}
              className="h-8 text-xs bg-background"
            />
          </div>
        </div>
      )}

      {scheduleMode === 'cron' && (
        <div className="space-y-3 p-3 bg-muted/20 border border-border/60 rounded-lg animate-in fade-in duration-200">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Cron Settings</Label>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Cron Expression</Label>
            <Input
              type="text"
              value={rawCron}
              onChange={(e) => {
                const val = e.target.value || '*/5 * * * *';
                setRawCron(val);
                saveSchedule('cron', {
                  intervalVal,
                  intervalUnit,
                  dailyTime,
                  weeklyDays,
                  weeklyTime,
                  rawCron: val,
                  enabled,
                });
              }}
              className="h-8 text-xs bg-background font-mono"
              placeholder="*/5 * * * *"
            />
            <span className="text-[8px] text-muted-foreground/80 block mt-1 font-mono leading-tight">
              Format: min hour dom month dow (e.g. */10 * * * *)
            </span>
          </div>
        </div>
      )}

      {/* Generated Cron display */}
      <div className="p-3 bg-muted/40 rounded-lg border border-border/40 text-center">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">Generated Cron Expression</span>
        <span className="text-xs font-mono font-bold text-foreground bg-background px-2 py-0.5 rounded border border-border/60 shadow-sm inline-block">
          {cronExpression}
        </span>
      </div>
    </div>
  );
}
