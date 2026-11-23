import type { Response } from "express";
import { logger } from "./logger.js";
import { currentContext } from "./request-context.js";

/**
 * What a client is told when the engine itself failed.
 *
 * Nothing about the failure: a driver's `getaddrinfo ENOTFOUND postgres`, a constraint name
 * or a pg encoding error each describe the deployment to whoever asked. The detail goes to
 * the log, and the `requestId` in the body is the handle that finds it there.
 */
export const INTERNAL_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** Logs an unexpected failure and answers 500 with the one generic body. */
export function internalError(res: Response, err: unknown, event: string, fields: Record<string, unknown> = {}): void {
  logger.error("Request failed.", { event, err, ...fields });
  if (res.headersSent) return;
  res.status(500).json({ error: INTERNAL_ERROR_MESSAGE, requestId: currentContext()?.requestId });
}

/**
 * A refusal Express's body parser raised before any handler ran: a body that is too large,
 * not JSON, or in an encoding it will not read. The caller's mistake, so a 4xx with a short
 * sentence — `err.message` is never forwarded, because the parser quotes the offending input.
 */
export function bodyParserRefusal(err: unknown): { status: number; error: string } | null {
  const e = err as { type?: unknown; status?: unknown; statusCode?: unknown } | null;
  if (!e || typeof e.type !== "string") return null;
  const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : 400;
  if (status < 400 || status >= 500) return null;
  if (e.type === "entity.too.large") return { status: 413, error: "The request body is too large." };
  if (e.type === "entity.parse.failed") return { status: 400, error: "The request body is not valid JSON." };
  if (e.type.startsWith("encoding.") || e.type.startsWith("charset.") || e.type.startsWith("request.")) {
    return { status: 400, error: "The request body could not be read." };
  }
  return { status, error: "The request could not be processed." };
}

/** Query parameters that carry a credential and are dropped from anything logged. */
const SECRET_QUERY = /^(sig|token|signature|code|key|secret|access_token|api_key)$/i;

/**
 * A request target safe to write down: the credential segment of `/hooks/<slug>`,
 * `/api/shared/<token>` and `/a/<token>` replaced, and credential query parameters removed.
 * The slug is the webhook's whole authentication and the token is the share link's, so a
 * log that kept them would be a list of working keys.
 */
export function maskUrl(target: string): string {
  const q = target.indexOf("?");
  const rawPath = q === -1 ? target : target.slice(0, q);
  const rawQuery = q === -1 ? "" : target.slice(q + 1);

  const path = rawPath
    .replace(/^(\/hooks\/)[^/?#]+/, "$1[slug]")
    .replace(/^(\/api\/shared\/)[^/?#]+/, "$1[token]")
    .replace(/^(\/a\/)[^/?#]+/, "$1[token]");

  const kept = rawQuery
    .split("&")
    .filter((pair) => pair !== "" && !SECRET_QUERY.test(decodeSafe(pair.split("=")[0] ?? "")));
  return kept.length > 0 ? `${path}?${kept.join("&")}` : path;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
