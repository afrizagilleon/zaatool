/**
 * Where the engine is.
 *
 * Three cases, and only two of them need a variable:
 *
 *  - **Development** — two dev servers on two ports, so the engine is named outright.
 *  - **Deployed behind one domain** — nginx serves this bundle and proxies `/api`,
 *    `/hooks`, `/mcp`, `/storage` and `/a` to the engine. The engine is *here*, so the
 *    base is empty and every request is same-origin. That is also what makes a share link
 *    work: `https://your-domain/a/<token>` is one host rather than two.
 *  - **Somewhere else entirely** — set `VITE_API_URL` at build time.
 *
 * The WebSocket follows the page rather than being configured separately. A deployment
 * where the socket lives somewhere other than the API is a deployment nobody has, and one
 * more variable to get wrong.
 */
const DEV_ENGINE = 'http://localhost:4000';

function sameOriginWebSocket(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
}

export const API_BASE_URL: string =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? DEV_ENGINE : '');

export const WS_BASE_URL: string =
  import.meta.env.VITE_WS_URL ??
  (import.meta.env.DEV ? 'ws://localhost:4000' : sameOriginWebSocket());
