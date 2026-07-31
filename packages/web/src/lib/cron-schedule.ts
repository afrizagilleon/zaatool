/**
 * Translation between a cron expression and the handful of shapes people actually
 * want: every N minutes, once a day, some days a week.
 *
 * Cron is the storage format because that is what the scheduler reads. It is a poor
 * *input* format — five positional fields with no labels — so the UI edits a schedule
 * and this module compiles it. Anything that does not fit the simple shapes round-trips
 * through `mode: 'cron'` untouched, so no expression is ever silently rewritten.
 *
 * Field order throughout: minute hour day-of-month month day-of-week.
 */

export type ScheduleMode = 'interval' | 'daily' | 'weekly' | 'cron';

export interface Schedule {
  mode: ScheduleMode;
  /** interval: run every `every` `unit`. */
  every: number;
  unit: 'minutes' | 'hours';
  /** daily/weekly: 'HH:MM', matching <input type="time">. */
  time: string;
  /** weekly: 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** cron: the raw expression, kept verbatim. */
  expression: string;
}

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Initials for the day picker. Two of them repeat, which is why `DAY_NAMES` exists. */
export const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export const DEFAULT_CRON = '0 9 * * *';

const DEFAULT_SCHEDULE: Schedule = {
  mode: 'daily',
  every: 5,
  unit: 'minutes',
  time: '09:00',
  days: [1],
  expression: DEFAULT_CRON,
};

const isNumeric = (field: string): boolean => /^\d+$/.test(field);

const toTime = (minute: string, hour: string): string =>
  `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

/**
 * Best-effort read of an expression into an editable schedule. Falls back to
 * `mode: 'cron'` rather than guessing, so an expression this module did not write
 * survives editing unchanged.
 */
export function parseCron(cron: string | undefined): Schedule {
  const raw = (cron ?? '').trim();
  if (!raw) return { ...DEFAULT_SCHEDULE };

  const asCustom: Schedule = { ...DEFAULT_SCHEDULE, mode: 'cron', expression: raw };

  const parts = raw.split(/\s+/);
  if (parts.length !== 5) return asCustom;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const isEveryDate = dayOfMonth === '*' && month === '*';
  if (!isEveryDate) return asCustom;

  // Every N minutes: */N * * * *
  if (minute.startsWith('*/') && hour === '*' && dayOfWeek === '*') {
    const every = Number(minute.slice(2));
    if (!Number.isInteger(every) || every < 1) return asCustom;
    return { ...DEFAULT_SCHEDULE, mode: 'interval', every, unit: 'minutes', expression: raw };
  }

  // Every N hours: 0 */N * * *
  if (minute === '0' && hour.startsWith('*/') && dayOfWeek === '*') {
    const every = Number(hour.slice(2));
    if (!Number.isInteger(every) || every < 1) return asCustom;
    return { ...DEFAULT_SCHEDULE, mode: 'interval', every, unit: 'hours', expression: raw };
  }

  if (!isNumeric(minute) || !isNumeric(hour)) return asCustom;
  const time = toTime(minute, hour);

  // Once a day: M H * * *
  if (dayOfWeek === '*') {
    return { ...DEFAULT_SCHEDULE, mode: 'daily', time, expression: raw };
  }

  // Certain days: M H * * 1,3,5
  const days = dayOfWeek.split(',').map(Number);
  const isValidDays =
    days.length > 0 && days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  if (!isValidDays) return asCustom;

  return { ...DEFAULT_SCHEDULE, mode: 'weekly', time, days, expression: raw };
}

/** The inverse of `parseCron` for the three simple modes; verbatim for `cron`. */
export function compileSchedule(schedule: Schedule): string {
  const [hour, minute] = schedule.time.split(':').map(Number);
  const safeHour = Number.isInteger(hour) ? hour : 9;
  const safeMinute = Number.isInteger(minute) ? minute : 0;

  switch (schedule.mode) {
    case 'interval': {
      const every = Math.max(1, Math.floor(schedule.every) || 1);
      return schedule.unit === 'minutes' ? `*/${every} * * * *` : `0 */${every} * * *`;
    }
    case 'daily':
      return `${safeMinute} ${safeHour} * * *`;
    case 'weekly': {
      // An empty selection would mean "never", which no one intends; treat it as daily.
      const days = [...schedule.days].sort((a, b) => a - b);
      return `${safeMinute} ${safeHour} * * ${days.length > 0 ? days.join(',') : '*'}`;
    }
    case 'cron':
      return schedule.expression.trim() || DEFAULT_CRON;
  }
}

const listDays = (days: number[]): string => {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return 'every day';
  if (sorted.length === 5 && sorted.join(',') === '1,2,3,4,5') return 'every weekday';
  if (sorted.length === 2 && sorted.join(',') === '0,6') return 'every weekend day';

  const names = sorted.map((day) => DAY_NAMES[day]).filter(Boolean);
  if (names.length === 0) return 'every day';
  if (names.length === 1) return `every ${names[0]}`;
  return `every ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/**
 * A plain-language summary, shown next to the controls so the saved expression is
 * never the only description of when this runs.
 */
export function describeCron(cron: string | undefined): string {
  const schedule = parseCron(cron);

  switch (schedule.mode) {
    case 'interval': {
      const plural = schedule.every === 1 ? '' : 's';
      const unit = schedule.unit === 'minutes' ? 'minute' : 'hour';
      return schedule.every === 1
        ? `Every ${unit}`
        : `Every ${schedule.every} ${unit}${plural}`;
    }
    case 'daily':
      return `Every day at ${schedule.time}`;
    case 'weekly':
      return `At ${schedule.time}, ${listDays(schedule.days)}`;
    case 'cron':
      return 'Custom schedule';
  }
}
