import type { IncomingMessage } from "node:http";
import { declaredCorsOrigins, isProduction } from "../config.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether a browser on this origin may open the run-event socket.
 *
 * A WebSocket is not covered by CORS: a page on any site can open one to this host, and the
 * browser will attach the session cookie to the upgrade. Without a check here, a page the
 * visitor happened to open elsewhere could connect as them and read what they are watching
 * (cross-site WebSocket hijacking). The browser always states which page is asking, in
 * `Origin`, so that is what is compared.
 *
 * Accepted:
 *
 *  - **No `Origin` at all.** Browsers always send one; a script, `curl`, or the MCP and
 *    agent clients do not, and they never carry the cookie either.
 *  - **The same origin as this request's host.** Behind nginx the `Host` header is the
 *    public name. Behind the Vite dev proxy it is rewritten to the engine's, so the
 *    original is read from `X-Forwarded-Host` as well. A browser cannot set that header on
 *    a socket, so a hostile page cannot use it to vouch for itself.
 *  - **Anything in `CORS_ORIGINS`**, the same list that decides which origins may call the
 *    API.
 *  - **Any local address, outside production, when `CORS_ORIGINS` is not set.** That is the
 *    development setup (`http://localhost:5173`), and it mirrors how permissive the API's
 *    CORS is in that same case. In production, or once `CORS_ORIGINS` names anything, it is
 *    off.
 */
export function wsOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const hosts = [req.headers.host, String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim()];
  if (hosts.some((host) => host && host.toLowerCase() === parsed.host.toLowerCase())) return true;

  const declared = declaredCorsOrigins();
  if (declared.includes(parsed.origin)) return true;

  if (declared.length === 0 && !isProduction() && LOOPBACK_HOSTS.has(parsed.hostname)) return true;

  return false;
}
