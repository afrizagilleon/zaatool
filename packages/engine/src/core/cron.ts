/**
 * Five-field cron: one parser for validating an expression at deploy and for matching it
 * on a tick, so the two can never disagree about what a string means.
 *
 * Fields: minute hour day-of-month month day-of-week. Each field is `*`, a number, a range
 * `a-b`, a step (star, slash, n; or a-b, slash, n), or a comma list of those. Names (`MON`, `JAN`) and the
 * `?`, `L`, `W`, `#` extensions are refused rather than half-understood.
 *
 * Every expression is read in one time zone for the whole engine (`CRON_TZ`), via `Intl`.
 */

export class CronSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronSyntaxError";
  }
}

interface FieldSpec {
  name: string;
  min: number;
  max: number;
}

const FIELDS: FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  // 7 is accepted as a second spelling of Sunday and folded onto 0 after parsing.
  { name: "day-of-week", min: 0, max: 7 },
];

export interface ParsedCron {
  minute: ReadonlySet<number>;
  hour: ReadonlySet<number>;
  dayOfMonth: ReadonlySet<number>;
  month: ReadonlySet<number>;
  /** 0-6, Sunday = 0. A 7 in the source is already folded in. */
  dayOfWeek: ReadonlySet<number>;
  /** Whether the field was written as a bare `*`; decides the day-matching rule. */
  dayOfMonthAny: boolean;
  dayOfWeekAny: boolean;
}

function parseNumber(text: string, spec: FieldSpec): number {
  if (!/^\d+$/.test(text)) {
    throw new CronSyntaxError(`${spec.name}: "${text}" is not a number`);
  }
  const value = Number(text);
  if (value < spec.min || value > spec.max) {
    throw new CronSyntaxError(`${spec.name}: ${value} is outside ${spec.min}-${spec.max}`);
  }
  return value;
}

function parseField(source: string, spec: FieldSpec): Set<number> {
  const values = new Set<number>();
  for (const item of source.split(",")) {
    if (item === "") throw new CronSyntaxError(`${spec.name}: empty entry in "${source}"`);
    const [range, stepText, extra] = item.split("/");
    if (extra !== undefined) throw new CronSyntaxError(`${spec.name}: "${item}" has two steps`);

    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1) {
        throw new CronSyntaxError(`${spec.name}: step "${stepText}" must be a whole number of 1 or more`);
      }
      step = Number(stepText);
    }

    let start: number;
    let end: number;
    if (range === "*") {
      start = spec.min;
      end = spec.max;
    } else if (range.includes("-")) {
      const [from, to, more] = range.split("-");
      if (more !== undefined) throw new CronSyntaxError(`${spec.name}: "${range}" is not a range`);
      start = parseNumber(from, spec);
      end = parseNumber(to, spec);
      if (start > end) throw new CronSyntaxError(`${spec.name}: range ${range} runs backwards`);
    } else {
      if (stepText !== undefined) {
        throw new CronSyntaxError(`${spec.name}: a step needs "*" or a range, not "${range}"`);
      }
      start = end = parseNumber(range, spec);
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return values;
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronSyntaxError(
      `expected 5 fields (minute hour day-of-month month day-of-week), got ${expression.trim() === "" ? 0 : parts.length}`
    );
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.map((part, i) => parseField(part, FIELDS[i]));
  if (dayOfWeek.delete(7)) dayOfWeek.add(0);
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    dayOfMonthAny: parts[2] === "*",
    dayOfWeekAny: parts[4] === "*",
  };
}

/** The reason an expression is unusable, or null when it is fine. */
export function cronProblem(expression: string): string | null {
  try {
    parseCron(expression);
    return null;
  } catch (err) {
    if (err instanceof CronSyntaxError) return err.message;
    throw err;
  }
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

interface ZonedParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

/** The wall-clock reading of an instant in `zone`. */
export function zonedParts(date: Date, zone: string): ZonedParts {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(zone, formatter);
  }
  const read: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) read[part.type] = part.value;
  return {
    minute: Number(read.minute),
    hour: Number(read.hour) % 24,
    dayOfMonth: Number(read.day),
    month: Number(read.month),
    dayOfWeek: WEEKDAYS[read.weekday],
  };
}

/** Whether the minute containing `date` matches, read as wall-clock time in `zone`. */
export function matchCron(expression: string, date: Date, zone: string): boolean {
  let cron: ParsedCron;
  try {
    cron = parseCron(expression);
  } catch {
    return false;
  }
  const at = zonedParts(date, zone);
  if (!cron.minute.has(at.minute) || !cron.hour.has(at.hour) || !cron.month.has(at.month)) return false;

  const domHit = cron.dayOfMonth.has(at.dayOfMonth);
  const dowHit = cron.dayOfWeek.has(at.dayOfWeek);
  // Standard cron: when both day fields are restricted a day matches if either does.
  if (!cron.dayOfMonthAny && !cron.dayOfWeekAny) return domHit || dowHit;
  return domHit && dowHit;
}
