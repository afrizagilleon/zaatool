import express from "express";
import cors from "cors";

import { skillsRouter } from "../routes/skills.route.js";
import { secretsRouter } from "../routes/secrets.route.js";
import { storageRouter } from "../routes/storage.route.js";
import { STORAGE_DIR } from "../services/storage.service.js";
import { createNotebooksRouter } from "../routes/notebooks.route.js";
import { createHooksRouter } from "../routes/hooks.route.js";
import { createMcpRouter } from "../routes/mcp.route.js";
import { createShareRouter } from "../routes/share.route.js";
import { authRouter } from "../routes/auth.route.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { storageAccess } from "../middleware/storage-access.js";
import type { RunEventSink } from "../core/run-emitter.js";

export function createApp(publishRunEvent: RunEventSink) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // Mounted before the auth guard: a webhook's slug is its credential, so these
  // are reachable without a session. They live outside /api for that reason.
  app.use("/hooks", createHooksRouter(publishRunEvent));

  // Agents authenticate with their own revocable token rather than a browser session,
  // so this sits outside /api and guards itself.
  app.use("/mcp", createMcpRouter(publishRunEvent));

  // A shared page's token is its credential, the same bargain as a webhook slug, so
  // these are reachable without a session and guard themselves.
  app.use("/api/shared", createShareRouter(publishRunEvent));

  app.use("/api", authMiddleware);

  app.use("/api/auth", authRouter);
  app.use("/api/resources/skills", skillsRouter);
  app.use("/api/resources/secrets", secretsRouter);
  app.use("/api/resources", storageRouter);

  // Outside /api because a browser asks for these in `src` and `href`, where no header can
  // be attached — so the permission is in the link instead. `storageAccess` is what makes
  // that a permission rather than a URL anyone can type.
  app.use("/storage", storageAccess, express.static(STORAGE_DIR));

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/api/notebooks", createNotebooksRouter(publishRunEvent));

  return app;
}
