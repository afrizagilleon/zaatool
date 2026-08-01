import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { skillsRouter } from "../routes/skills.route.js";
import { secretsRouter } from "../routes/secrets.route.js";
import { storageRouter } from "../routes/storage.route.js";
import { STORAGE_DIR } from "../services/storage.service.js";
import { flowsRouter } from "../routes/flows.route.js";
import { createNotebooksRouter } from "../routes/notebooks.route.js";
import { createHooksRouter } from "../routes/hooks.route.js";
import { createMcpRouter } from "../routes/mcp.route.js";
import { authRouter } from "../routes/auth.route.js";
import { triggersRouter } from "../routes/triggers.route.js";
import { flowsController } from "../controllers/flows.controller.js";
import { flowsService } from "../services/flows.service.js";
import {
  dashboardAccessService,
  DashboardAccessError,
} from "../services/dashboard-access.service.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { runFlow } from "../core/flow-runner.js";
import { createRunEmitter, type RunEventSink } from "../core/run-emitter.js";
import type { GraphJson, SeedOutputs } from "@zaa-tool/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Maps an access denial to its own status; anything else is an unexpected 500. */
function respondWithError(res: express.Response, err: unknown) {
  if (err instanceof DashboardAccessError) {
    return res.status(err.status).json({ error: err.message });
  }
  return res.status(500).json({ error: (err as Error).message });
}

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

  app.use("/api", authMiddleware);

  app.use("/api/auth", authRouter);
  app.use("/api/resources/skills", skillsRouter);
  app.use("/api/resources/secrets", secretsRouter);
  app.use("/api/resources", storageRouter);
  app.use("/storage", express.static(STORAGE_DIR));
  app.use("/api/resources/flows", flowsController.getSummary);

  app.use("/api/flows", flowsRouter);
  app.use("/api/notebooks", createNotebooksRouter(publishRunEvent));
  app.use("/api/triggers", triggersRouter);

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/api/graphs", (_req, res) => {
    try {
      const fixturesDir = path.resolve(__dirname, "../fixtures");
      const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
      const graphs = files.map((f) => {
        const content = JSON.parse(readFileSync(path.join(fixturesDir, f), "utf-8"));
        return { filename: f, name: content.name ?? f, nodeCount: content.nodes?.length ?? 0 };
      });
      res.json(graphs);
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to read fixtures", detail: (err as Error).message });
    }
  });

  // Public flow fetch (bypasses authMiddleware)
  app.get("/api/flows/:id/public", async (req, res) => {
    try {
      const flow = await flowsService.getBySlugOrId(req.params.id);
      if (!flow) return res.status(404).json({ error: "Flow not found" });

      const password = req.headers["x-dashboard-password"] || req.query.password;

      // Announcing that a password is needed is not an attempt, so it must not
      // count against the lockout budget.
      if (dashboardAccessService.isPasswordProtected(flow) && !password) {
        return res.json({ id: flow.id, name: flow.name, isPasswordProtected: true });
      }

      await dashboardAccessService.assertAccess(flow, String(password ?? ""));

      const { graph_json, dashboard_layout } = flowsService.parseFlow(flow);
      res.json({ id: flow.id, name: flow.name, graph_json, dashboard_layout });
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  });

  // Verify dashboard password
  app.post("/api/flows/:id/verify-password", async (req, res) => {
    try {
      const { password } = req.body;
      const flow = await flowsService.getBySlugOrId(req.params.id);
      if (!flow) return res.status(404).json({ error: "Flow not found" });

      await dashboardAccessService.assertAccess(flow, password);

      const { graph_json, dashboard_layout } = flowsService.parseFlow(flow);
      res.json({ success: true, graph_json, dashboard_layout });
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  });

  // Public flow trigger execution (bypasses authMiddleware)
  app.post("/api/flows/:id/trigger", async (req, res) => {
    try {
      const { startNodeId, inputs } = req.body;
      const flow = await flowsService.getBySlugOrId(req.params.id);
      if (!flow) return res.status(404).json({ error: "Flow not found" });

      await dashboardAccessService.assertAccess(flow, String(req.headers["x-dashboard-password"] ?? ""));

      const { graph_json: graph } = flowsService.parseFlow(flow);

      if (!graph || !graph.nodes) {
        return res.status(400).json({ error: "Invalid graph: missing nodes" });
      }

      if (startNodeId) {
        const node = graph.nodes.find((n) => n.id === startNodeId);
        if (node) {
          if (node.type === "ui:input") {
            node.data = { ...node.data, values: { ...(node.data.values || {}), ...(inputs || {}) } };
          } else if (node.type === "ui:table") {
            node.data = {
              ...node.data,
              selectedRow: inputs?.selectedRow !== undefined ? inputs.selectedRow : (node.data.selectedRow ?? null),
            };
          } else if (node.type === "file") {
            node.data = {
              ...node.data,
              inputs: {
                ...(node.data.inputs || {}),
                file: inputs?.file !== undefined ? inputs.file : (node.data.inputs?.file ?? null),
              },
            };
          }
        }
      }

      const runId = randomUUID();
      const ee = createRunEmitter({ runId, flowId: flow.id }, publishRunEvent);

      // No seedOutputs: a published dashboard run always computes from the
      // graph and this request's inputs, never from stored design-time output.
      runFlow(graph, ee, startNodeId).catch((err: unknown) => {
        ee.emit("flow:error", { type: "flow:error", error: (err as Error).message });
      });

      res.status(200).json({ status: "started", runId });
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  });

  // Admin flow execution (protected by authMiddleware)
  app.post("/api/run", (req, res) => {
    let graph: GraphJson;
    let startNodeId: string | undefined;
    let seedOutputs: SeedOutputs | undefined;

    if (req.body.graph && req.body.graph.nodes) {
      graph = req.body.graph;
      startNodeId = req.body.startNodeId;
      seedOutputs = req.body.seedOutputs;
    } else {
      graph = req.body;
    }

    if (!graph || !graph.nodes) {
      return res.status(400).json({ error: "Invalid graph: missing nodes" });
    }

    const runId = randomUUID();
    const ee = createRunEmitter({ runId, flowId: graph.id ?? "unsaved" }, publishRunEvent);

    // The editor may seed the outputs it already has so a partial re-run does
    // not have to re-execute everything upstream. Those values come from the
    // caller's own session, not from the database.
    runFlow(graph, ee, startNodeId, undefined, { seedOutputs }).catch((err: unknown) => {
      console.error("Flow execution error:", err);
      ee.emit("flow:error", { type: "flow:error", error: (err as Error).message });
    });

    res.status(200).json({ status: "started", runId });
  });

  return app;
}
