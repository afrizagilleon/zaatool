import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { Actor } from "./actor.js";

/**
 * What is known about the request (or run, or job) the current code is serving.
 *
 * Carried with AsyncLocalStorage so a log line or audit event written ten calls deep names
 * the same request id and actor as the route that started it, without threading them
 * through every signature. Code outside any request (boot, the scheduler) runs in a context
 * it opens itself with {@link withContext}.
 */
export interface RequestContext {
  /** Correlates every log line and audit event of one request. Echoed as `X-Request-Id`. */
  requestId: string;
  actor?: Actor;
  /** The client address as Express resolved it under `trust proxy`. */
  ip?: string;
  userAgent?: string;
  /** Set when the work belongs to a run, so its log lines can be found by run id. */
  runId?: string;
  notebookId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The context in force, or undefined outside any. */
export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Runs `fn` in a new context, inheriting nothing but what `fields` gives. */
export function withContext<T>(fields: Partial<RequestContext>, fn: () => T): T {
  return storage.run({ requestId: fields.requestId ?? newRequestId(), ...fields }, fn);
}

/**
 * Names the actor of the request in progress. Called by whichever guard established who
 * is asking (session, agent token, webhook, share link). Mutates the current store, so
 * everything already running inside this request sees it from now on.
 */
export function setActor(actor: Actor): void {
  const store = storage.getStore();
  if (store) store.actor = actor;
}

/** Adds run/notebook ids to the current context. */
export function setRunContext(runId: string | undefined, notebookId: string | undefined): void {
  const store = storage.getStore();
  if (!store) return;
  if (runId) store.runId = runId;
  if (notebookId) store.notebookId = notebookId;
}

export function newRequestId(): string {
  return randomUUID();
}

/**
 * A request id offered by a trusted proxy is kept so the engine's lines join nginx's; any
 * other shape is replaced, because the value lands in logs and a header we send back.
 */
const ACCEPTABLE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** First middleware of the app: opens the context every later handler runs inside. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const offered = req.headers["x-request-id"];
  const requestId =
    typeof offered === "string" && ACCEPTABLE_ID.test(offered) ? offered : newRequestId();
  res.setHeader("X-Request-Id", requestId);
  const userAgent = req.headers["user-agent"];
  storage.run(
    {
      requestId,
      actor: { type: "anonymous" },
      ip: req.ip,
      userAgent: typeof userAgent === "string" ? userAgent.slice(0, 512) : undefined,
    },
    () => next()
  );
}
