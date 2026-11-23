import express from "express";
import cors from "cors";

import { skillsRouter } from "../routes/skills.route.js";
import { secretsRouter } from "../routes/secrets.route.js";
import { storageRouter } from "../routes/storage.route.js";
import { STORAGE_DIR } from "../services/storage.service.js";
import { createNotebooksRouter } from "../routes/notebooks.route.js";
import { createHooksRouter } from "../routes/hooks.route.js";
import { createMcpRouter, agentTokenOf } from "../routes/mcp.route.js";
import { agentTokensService } from "../services/agent-tokens.service.js";
import { createShareRouter } from "../routes/share.route.js";
import { authRouter } from "../routes/auth.route.js";
import { agentTokensRouter } from "../routes/agent-tokens.route.js";
import { auditRouter } from "../routes/audit.route.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { csrfGuard } from "../middleware/csrf.middleware.js";

import { storageAccess } from "../middleware/storage-access.js";
import { storageHeaders } from "../middleware/storage-headers.js";
import { trustProxy, jsonBodyLimit, notebookJsonBodyLimit, declaredCorsOrigins } from "../config.js";
import type { RunEventSink } from "../core/run-emitter.js";
import { requestContext } from "../core/request-context.js";

/** When this process came up. Restarts are the thing you are usually checking for. */
const STARTED_AT = new Date().toISOString();

/**
 * Which origins a browser may call this engine from.
 *
 * It was `cors()` with no argument, which reflects whatever origin asks — every route
 * guarded by a session, and the door held open for any page on the internet to try one.
 * After M18 put a lock on the routes that was the odd one out.
 *
 * The intended shape is that there is no cross-origin request at all: the app and the
 * engine share an origin, nginx in production and the Vite proxy in development, so a
 * browser never sends `Origin` and CORS never comes up. What remains is the deployment
 * where the bundle really is served from somewhere else, and that one has to say so —
 * `CORS_ORIGINS=https://app.example.com,https://staging.example.com`.
 *
 * Unset outside production stays permissive, because a phone reaching a laptop over a LAN
 * address nobody can predict is the normal case while building and refusing it would make
 * every first attempt fail. Unset *in* production allows same-origin only, which is what a
 * correct deployment already is.
 */
export function corsPolicy(): cors.CorsOptions {
  const declared = declaredCorsOrigins();

  if (declared.length > 0) return { origin: declared, credentials: true };
  if (process.env.NODE_ENV === "production") return { origin: false };
  return { origin: true, credentials: true };
}

export function createApp(publishRunEvent: RunEventSink) {
  const app = express();
  // Behind nginx / the Vite proxy every request arrives from the proxy; see trustProxy().
  app.set("trust proxy", trustProxy());
  // First, so every later handler — and every log line and audit event it writes — runs
  // inside a context that knows the request id, the client address and, once a guard has
  // established it, the actor.
  app.use(requestContext);
  app.use(cors(corsPolicy()));

  // Small by default: /hooks, /mcp and /api/shared are parsed before anyone has proved who
  // they are. Only /api/notebooks (behind a session; whole documents, run args with
  // tables) gets a larger limit, mounted first so it wins (a parsed body is not re-parsed).
  const smallJson = express.json({ limit: jsonBodyLimit() });
  const notebookJson = express.json({ limit: notebookJsonBodyLimit() });

  // Mounted before the auth guard: a webhook's slug is its credential, so these
  // are reachable without a session. They live outside /api for that reason.
  app.use("/hooks", smallJson, createHooksRouter(publishRunEvent));

  // Agents authenticate with their own revocable token rather than a browser session,
  // so this sits outside /api and guards itself.
  //
  // An agent writing a whole notebook sends as much as the editor does, so a request that
  // carries a live agent token is parsed with the notebook limit (K-27). Everyone else gets
  // the small one: the token is checked before the body is read, so the larger allowance
  // costs a stranger nothing. The router still authenticates every request on its own.
  const mcpJson: express.RequestHandler = async (req, res, next) => {
    try {
      const token = agentTokenOf(req);
      const live = token ? await agentTokensService.verify(token) : null;
      return (live ? notebookJson : smallJson)(req, res, next);
    } catch (err) {
      next(err);
    }
  };
  app.use("/mcp", mcpJson, createMcpRouter(publishRunEvent));

  // A shared page's token is its credential, the same bargain as a webhook slug, so
  // these are reachable without a session and guard themselves.
  app.use("/api/shared", smallJson, createShareRouter(publishRunEvent));

  // Before the auth guard, so a forged request is refused for what it is rather than
  // after it has been identified.
  app.use("/api", csrfGuard);
  app.use("/api", authMiddleware);
  app.use("/api/notebooks", notebookJson);
  app.use("/api", smallJson);

  app.use("/api/auth", authRouter);
  app.use("/api/agent-tokens", agentTokensRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/resources/skills", skillsRouter);

  app.use("/api/resources/secrets", secretsRouter);
  app.use("/api/resources", storageRouter);

  // Outside /api because a browser asks for these in `src` and `href`, where no header can
  // be attached — so the permission is in the link instead. `storageAccess` is what makes
  // that a permission rather than a URL anyone can type.
  app.use("/storage", storageHeaders, storageAccess, express.static(STORAGE_DIR));

  /**
   * Reachable without a session, like `/api/health`, and carrying the same amount of
   * information: which build this is. Not a secret, and being able to answer "is the
   * thing running what I deployed" without shelling into the machine is most of what
   * makes an update safe to do at all.
   */
  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      version: process.env.BUILD_VERSION || "dev",
      commit: process.env.BUILD_COMMIT || "unknown",
      startedAt: STARTED_AT,
    });
  });

  app.use("/api/notebooks", createNotebooksRouter(publishRunEvent));

  return app;
}
