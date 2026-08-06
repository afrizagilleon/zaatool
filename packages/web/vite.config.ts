import fs from "node:fs";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The engine, reachable from wherever the app is opened.
 *
 * Two settings carry the whole of "it works on my phone":
 *
 *  - **`host: true`** binds the dev server to every interface. Without it `pnpm dev`
 *    listens on `localhost` only and your LAN address answers nothing.
 *  - **`proxy`** puts the engine behind the same origin as the app, which is what the
 *    deployed build has always had. Before this, the bundle named `http://localhost:4000`
 *    outright — and from a phone, `localhost` is the phone. That was `failed to fetch`.
 *
 * The proxied list is the same list `nginx.conf` proxies, deliberately: a path that works
 * in development and not in production, or the reverse, is a bug that only appears after
 * deploying. `/ws` carries the run-event stream and needs `ws: true` to be upgraded rather
 * than fetched.
 *
 * `ENGINE_ORIGIN` is here for the case where the engine runs somewhere other than this
 * machine — a container, a second laptop — and is the only knob any of this has.
 */
const ENGINE_ORIGIN = process.env.ENGINE_ORIGIN ?? "http://localhost:4000";

const toEngine = { target: ENGINE_ORIGIN, changeOrigin: true };

/**
 * HTTPS in development, when a certificate has been supplied.
 *
 * One feature needs it and only one: recording. `getUserMedia` is refused outside a
 * secure context, and `http://192.168.1.7` is not one — so the record button cannot work
 * over a LAN address no matter how well the networking behaves. Everything else on this
 * list works over plain HTTP, which is why this is opt-in rather than the default: paying
 * a certificate's setup cost to read a notebook would be a poor trade.
 *
 * No certificate tooling is bundled deliberately. A plugin that downloads a binary on
 * first run is a supply-chain decision, and it is not one a build config should make on
 * someone's behalf. Point `HTTPS_KEY` and `HTTPS_CERT` at whatever produced them —
 * `mkcert`, a company CA, a tunnel's cert — and this uses it. `DEVELOPMENT.md` has the
 * mkcert commands, including the part everyone forgets: the phone has to trust the CA too.
 *
 * Since the engine is proxied through this server, one certificate covers both.
 */
function devHttps() {
  const key = process.env.HTTPS_KEY;
  const cert = process.env.HTTPS_CERT;
  if (!key || !cert) return undefined;

  for (const [name, file] of [["HTTPS_KEY", key], ["HTTPS_CERT", cert]]) {
    if (!fs.existsSync(file)) {
      // Louder than falling back to HTTP: asking for HTTPS and silently not getting it is
      // how someone spends an afternoon on a record button that was never going to work.
      throw new Error(`${name} points at ${file}, which does not exist.`);
    }
  }

  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'process.env': {},
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    https: devHttps(),
    proxy: {
      "/api": toEngine,
      "/hooks": toEngine,
      "/mcp": toEngine,
      "/storage": toEngine,
      "/ws": { ...toEngine, ws: true },
    },
  },
});
