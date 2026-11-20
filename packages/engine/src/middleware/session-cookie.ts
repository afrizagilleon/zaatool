import type { Request, Response } from "express";
import { cookieSecure } from "../config.js";

/**
 * The browser's session, as a cookie the page's own JavaScript cannot read.
 *
 * The token used to live in `localStorage`, which meant any script that ever ran on the page
 * — an output rendered from a notebook, a dependency, a typo that became an injection — could
 * read it and walk away with the whole session. `HttpOnly` takes that away; the cost is that
 * a cookie is attached by the browser without being asked, which is what the CSRF check next
 * to this file exists to answer.
 *
 * The cookie holds the same JWT a `Bearer` caller would send, so there is one kind of session
 * and one place that decides whether it still counts.
 */
export const SESSION_COOKIE = "zaa_session";

/** As long as the token inside it lives. */
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** One cookie out of a raw `Cookie` header — used by the WebSocket upgrade, which has no `req.cookies`. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

export type Credential = { token: string; via: "bearer" | "cookie" };

/**
 * Where a request says who it is. A `Bearer` header wins over a cookie when both are
 * present: a script that went to the trouble of setting a header meant it, and an old
 * browser cookie sitting beside it should not override that.
 */
export function credentialOf(req: Request): Credential | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return { token: header.split(" ")[1], via: "bearer" };
  const cookie = readCookie(req.headers.cookie, SESSION_COOKIE);
  return cookie ? { token: cookie, via: "cookie" } : null;
}

/**
 * `SameSite=Lax` keeps the cookie off cross-site POSTs and subresource loads; `Secure` is
 * governed by {@link cookieSecure}, not by the request, because behind a proxy chain the
 * engine cannot tell whether the browser's connection was HTTPS.
 */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE_MS,
  });
}

/** Deleting a cookie only works if the attributes name the same cookie that was set. */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
  });
}
