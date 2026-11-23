import { currentContext } from "./request-context.js";
import { actorFields } from "./actor.js";

/**
 * The engine's operational log: one JSON object per line on stdout (stderr for errors).
 *
 * This is the stream for operators — what the engine did and what went wrong. It is not
 * the audit trail (who changed what, kept in the database, see `audit.service.ts`) and it is
 * never a cell's output (that belongs to the run that produced it).
 *
 * Every line carries `ts` (UTC, ISO 8601), `level`, `service`, `event` and `msg`, plus the
 * request id, actor, run and notebook from the context it was written in. Values under
 * keys that name credentials are replaced before the line is written, and a database
 * error's `detail` (which quotes the failing row, secret values included) is dropped.
 * Because every value is JSON-encoded, a newline or terminal escape inside a user-chosen
 * name cannot forge a second line.
 *
 * `LOG_LEVEL` (debug|info|warn|error, default info) filters; `LOG_FORMAT=pretty` prints a
 * readable line instead of JSON for local development.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are never written, at any depth. Matched case-insensitively. */
const SECRET_KEY =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|credential|private[-_]?key|setup[-_]?code|signature|^sig$|slug/i;

const MAX_STRING = 4000;
const MAX_DEPTH = 6;

function threshold(): number {
  const wanted = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return ORDER[wanted] ?? ORDER.info;
}

/** An Error as fields, without what would leak: pg's `detail`/`where` quote row values. */
export function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: clip(String(err)) };
  const e = err as Error & { code?: unknown; constraint?: unknown; table?: unknown };
  const out: Record<string, unknown> = { name: e.name, message: clip(e.message) };
  if (typeof e.code === "string") out.code = e.code;
  if (typeof e.constraint === "string") out.constraint = e.constraint;
  if (typeof e.table === "string") out.table = e.table;
  if (e.stack) out.stack = clip(e.stack);
  return out;
}

function clip(value: string): string {
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[${value.length - MAX_STRING} more]` : value;
}

/** Copies `value` with credential-named keys replaced and errors serialised. */
export function scrub(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return serializeError(value);
  if (typeof value === "string") return clip(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    // `tokenId`, `share_id`, `triggerId` name a row, not a credential, and are what makes a
    // line traceable; only the value-bearing keys are withheld.
    const isIdentifier = /(?:^|[_.-])id$|[a-z]Id$/.test(key);
    out[key] =
      !isIdentifier && SECRET_KEY.test(key) && v !== undefined && v !== null ? "[redacted]" : scrub(v, depth + 1);
  }
  return out;
}

export interface LogFields {
  /** A stable, dotted name for what happened: `server.listening`, `scheduler.tick_failed`. */
  event?: string;
  err?: unknown;
  [key: string]: unknown;
}

function write(level: LogLevel, msg: string, fields: LogFields = {}): void {
  if (ORDER[level] < threshold()) return;
  const context = currentContext();
  const { err, event, ...rest } = fields;
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    service: "zaatool-engine",
    event: event ?? "log",
    msg: clip(msg),
    ...(context?.requestId ? { request_id: context.requestId } : {}),
    ...(context?.runId ? { run_id: context.runId } : {}),
    ...(context?.notebookId ? { notebook_id: context.notebookId } : {}),
    ...actorFields(context?.actor),
    ...(scrub(rest) as Record<string, unknown>),
    ...(err !== undefined ? { error: serializeError(err) } : {}),
  };
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(`${format(line)}\n`);
}

function format(line: Record<string, unknown>): string {
  if (process.env.LOG_FORMAT !== "pretty") return JSON.stringify(line);
  const { ts, level, msg, event, ...rest } = line;
  const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  // JSON-encoding the message as well keeps the pretty form injection-proof too.
  return `${String(ts)} ${String(level).toUpperCase().padEnd(5)} ${String(event)} ${JSON.stringify(msg)}${extra}`;
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
