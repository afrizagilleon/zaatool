import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { bodyParserRefusal, INTERNAL_ERROR_MESSAGE, maskUrl } from "../core/http-errors.js";
import { currentContext, withContext } from "../core/request-context.js";
import { logger } from "../core/logger.js";

/**
 * One `http.request` line per finished request: what was asked, what was answered, how long
 * it took. Mounted right after `requestContext`, so it runs inside the context and — because
 * the line is written when the response *finishes* — reads the actor the guards established
 * on the way, not the anonymous one the request started with.
 *
 * The path is logged with its credential segments masked (see `maskUrl`): `/hooks/<slug>` and
 * `/api/shared/<token>` are bearer secrets. The health probe is logged at debug, because a
 * load balancer asking every few seconds would otherwise be most of the log.
 */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  // Captured now: by `finish`, a router may have rewritten `req.url`.
  const target = req.originalUrl ?? req.url;

  // `finish` is emitted from a socket callback, where AsyncLocalStorage may no longer hold
  // this request's store. The store object itself is kept (the guards mutate it in place,
  // so reading it now sees the actor they set) and re-entered when the line is written.
  const context = currentContext();

  let written = false;
  const done = (aborted: boolean) => {
    if (written) return;
    written = true;
    withContext({ ...context }, () => write(aborted));
  };
  const write = (aborted: boolean) => {
    const path = maskUrl(target);
    const fields = {
      event: "http.request",
      method: req.method,
      path,
      status: res.statusCode,
      duration_ms: Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100,
      bytes: Number(res.getHeader("content-length")) || undefined,
      ...(aborted ? { aborted: true } : {}),
    };
    // Static on purpose: the path is a field, so nothing a caller chose lands in `msg`.
    const message = "HTTP request.";
    if (path === "/api/health") logger.debug(message, fields);
    else if (res.statusCode >= 500) logger.error(message, fields);
    else if (res.statusCode >= 400) logger.warn(message, fields);
    else logger.info(message, fields);
  };

  res.on("finish", () => done(false));
  // The client went away before the answer was complete; still a request worth a line.
  res.on("close", () => done(!res.writableFinished));
  next();
}

/**
 * The last middleware. Without it Express answers an error nobody handled with an HTML page
 * that includes the stack trace outside production, and whatever the error's message was in
 * the status line. This answers with JSON instead, always, and logs the real error.
 *
 * Four arguments are what make Express treat it as an error handler.
 */
export const finalErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    // Half an answer has gone out; all that is left is to end the connection.
    logger.error("Error after the response had started.", { event: "http.unhandled_error", err });
    return next(err);
  }
  const requestId = currentContext()?.requestId;
  const refusal = bodyParserRefusal(err);
  if (refusal) {
    logger.warn("Request body refused.", {
      event: "http.body_refused",
      status: refusal.status,
      // Not the error itself: the parser quotes the body it could not read.
      reason: (err as { type?: string }).type,
    });
    res.status(refusal.status).json({ error: refusal.error, requestId });
    return;
  }
  logger.error("Unhandled error in a request.", { event: "http.unhandled_error", err });
  res.status(500).json({ error: INTERNAL_ERROR_MESSAGE, requestId });
};
