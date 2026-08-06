/**
 * Where the engine is.
 *
 * **One origin, always.** The deployed build already worked this way — nginx serves the
 * bundle and proxies the engine's paths, so every request is same-origin and the base is
 * empty. Development did not: it named `http://localhost:4000` outright, and `localhost`
 * on a phone is the phone. That is the whole of `failed to fetch` when you opened the app
 * from your LAN address, and it is why nothing after the login screen could be reached.
 *
 * The fix is not a cleverer way to guess the engine's address. It is to stop having two
 * origins in development at all: Vite proxies `/api`, `/hooks`, `/mcp`, `/storage` and
 * `/ws` through to the engine, exactly the list nginx proxies. So dev and production now
 * differ in one thing — who is doing the proxying — and the browser sees the same shape in
 * both. A phone, a laptop, a tablet and a tunnel all work without being told anything.
 *
 * `VITE_API_URL` remains for the deployment nobody has yet: the bundle on one host and the
 * engine on another. Setting it opts back into two origins, and into CORS.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? '';

/**
 * The run-event stream.
 *
 * On its own path rather than the server root. It was the root, which meant nginx had no
 * `location` matching it — the deployed build served `index.html` to a socket upgrade and
 * the stream could never connect. A path is also what makes it proxyable in development,
 * since the root belongs to the app.
 */
const WS_PATH = '/ws';

function sameOriginWebSocket(): string {
  if (typeof window === 'undefined') return '';
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}${WS_PATH}`;
}

export const WS_BASE_URL: string = import.meta.env.VITE_WS_URL ?? sameOriginWebSocket();

/**
 * A URL someone is going to paste somewhere else.
 *
 * Everything above is a path the browser resolves against the page it is on, which is
 * correct for fetching and useless for copying: a webhook URL reading `/hooks/abc` cannot
 * be given to the service that is meant to call it. This turns one into an address.
 */
export function absoluteUrl(path: string): string {
  if (API_BASE_URL) return `${API_BASE_URL}${path}`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

/**
 * Why a request never reached the engine.
 *
 * `fetch` rejects with `TypeError: Failed to fetch` for every network-level failure and
 * says nothing about which one — wrong host, engine down, blocked by the browser, refused
 * by CORS. That message on a phone told you nothing, and it was the last thing the app
 * ever said to you. This names the address that was tried and the two things it is
 * actually likely to be.
 */
export function describeRequestFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  // The one failure `fetch` reports as a rejection rather than a response. Everything
  // else reaching here already carries the engine's own words and should keep them.
  const reachedNobody = err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message);
  if (!reachedNobody) return message;

  const where = API_BASE_URL || (typeof window === 'undefined' ? 'the server' : window.location.origin);
  return `Could not reach the engine at ${where}. It may not be running, or this device cannot get to it.`;
}
