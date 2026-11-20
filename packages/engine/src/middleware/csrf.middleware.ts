import type { Request, Response, NextFunction } from "express";
import { readCookie, SESSION_COOKIE } from "./session-cookie.js";

/** The header a page must add to anything that changes data. Its value is not checked beyond being `1`. */
export const CSRF_HEADER = "x-zaatool-request";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Keeps another website from acting as the person who is signed in here.
 *
 * A cookie is attached by the browser to every request to this origin, including the ones a
 * page on some other site makes by submitting a form or calling `fetch`. A header is not: a
 * custom header cannot be set on a cross-site request without a CORS preflight, and in
 * production CORS allows this origin only. So a request that changes data and carries only
 * a cookie must also carry this header, and a forged one cannot.
 *
 * Applies to requests that would be authenticated *by the cookie*. A request with a
 * `Bearer` header is not using the cookie — a script set that header on purpose — so it is
 * not asked for this one, which is what keeps `curl` and the MCP clients working unchanged.
 *
 * Login and register are the exception that has no cookie yet: without the check, another
 * site could sign a visitor in to an account of the attacker's choosing ("login CSRF") and
 * read what they then did. They need the header whoever is asking.
 *
 * Mounted on `/api` only. `/hooks`, `/mcp` and `/api/shared` answer to their own tokens and
 * never read the session cookie.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  const entersASession = req.path === "/auth/login" || req.path === "/auth/register";

  if (!entersASession) {
    if (req.headers.authorization?.startsWith("Bearer ")) return next();
    // No cookie either: nothing here for a forged request to ride on, and the auth guard
    // will answer 401 on its own.
    if (!readCookie(req.headers.cookie, SESSION_COOKIE)) return next();
  }

  if (req.headers[CSRF_HEADER] === "1") return next();

  res.status(403).json({ error: "Missing X-Zaatool-Request header." });
}
