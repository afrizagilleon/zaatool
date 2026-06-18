import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { EventEmitter } from "node:events";

import { skillsRouter } from "../routes/skills.route.js";
import { secretsRouter } from "../routes/secrets.route.js";
import { storageRouter } from "../routes/storage.route.js";
import { STORAGE_DIR } from "../services/storage.service.js";
import { flowsRouter } from "../routes/flows.route.js";
import { aiRouter } from "../routes/ai.route.js";
import { authRouter } from "../routes/auth.route.js";
import { triggersRouter } from "../routes/triggers.route.js";
import { flowsController } from "../controllers/flows.controller.js";
import { flowsService } from "../services/flows.service.js";
import { dashboardPasswordService } from "../services/dashboard-password.service.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { runFlow } from "../core/flow-runner.js";
import type { GraphJson } from "@zaa-tool/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const failedAttempts = new Map<string, { count: number; lockUntil: number }>();

function checkRateLimit(flowId: string): { locked: boolean } {
  const info = failedAttempts.get(flowId);
  if (info && info.lockUntil > Date.now()) return { locked: true };
  return { locked: false };
}

function recordFailedAttempt(flowId: string): boolean {
  const info = failedAttempts.get(flowId);
  const count = (info?.count || 0) + 1;
  if (count >= 5) {
    failedAttempts.set(flowId, { count: 0, lockUntil: Date.now() + 5 * 60 * 1000 });
    return true; // now locked
  }
  failedAttempts.set(flowId, { count, lockUntil: 0 });
  return false;
}

export function createApp(onFlowEvent: (data: Record<string, unknown>) => void) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use("/api", authMiddleware);

  app.use("/api/auth", authRouter);
  app.use("/api/resources/skills", skillsRouter);
  app.use("/api/resources/secrets", secretsRouter);
  app.use("/api/resources", storageRouter);
  app.use("/storage", express.static(STORAGE_DIR));
  app.use("/api/resources/flows", flowsController.getSummary);

  app.use("/api/flows", flowsRouter);
  app.use("/api/triggers", triggersRouter);
  app.use("/api/ai", aiRouter);

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
      const flow = await flowsService.getById(req.params.id);
      if (!flow) return res.status(404).json({ error: "Flow not found" });

      if (flow.dashboard_password_hash) {
        const password = req.headers["x-dashboard-password"] || req.query.password;
        if (!password) {
          return res.json({ id: flow.id, name: flow.name, isPasswordProtected: true });
        }

        if (checkRateLimit(flow.id).locked) {
          return res.status(429).json({ error: "Too many failed attempts. Locked for 5 minutes." });
        }

        const isMatch = await dashboardPasswordService.verifyPassword(
          String(password),
          flow.dashboard_password_hash
        );
        if (!isMatch) {
          const nowLocked = recordFailedAttempt(flow.id);
          return nowLocked
            ? res.status(429).json({ error: "Too many failed attempts. Locked for 5 minutes." })
            : res.status(401).json({ error: "Incorrect password" });
        }
        failedAttempts.delete(flow.id);
      }

      const { graph_json, dashboard_layout } = flowsService.parseFlow(flow);
      res.json({ id: flow.id, name: flow.name, graph_json, dashboard_layout });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Verify dashboard password
  app.post("/api/flows/:id/verify-password", async (req, res) => {
    try {
      const { password } = req.body;
      const flow = await flowsService.getById(req.params.id);
      if (!flow) return res.status(404).json({ error: "Flow not found" });

      const { graph_json, dashboard_layout } = flowsService.parseFlow(flow);

      if (!flow.dashboard_password_hash) {
        return res.json({ success: true, graph_json, dashboard_layout });
      }

      if (checkRateLimit(flow.id).locked) {
        return res.status(429).json({ error: "Too many failed attempts. Locked for 5 minutes." });
      }

      const isMatch = await dashboardPasswordService.verifyPassword(
        String(password || ""),
        flow.dashboard_password_hash
      );
      if (!isMatch) {
        const nowLocked = recordFailedAttempt(flow.id);
        return nowLocked
          ? res.status(429).json({ error: "Too many failed attempts. Locked for 5 minutes." })
          : res.status(401).json({ error: "Incorrect password" });
      }

      failedAttempts.delete(flow.id);
      res.json({ success: true, graph_json, dashboard_layout });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Public flow trigger execution (bypasses authMiddleware)
  app.post("/api/flows/:id/trigger", async (req, res) => {
    try {
      const { startNodeId, inputs } = req.body;
      const flow = await flowsService.getById(req.params.id);
      if (!flow) return res.status(404).json({ error: "Flow not found" });

      if (flow.dashboard_password_hash) {
        const password = req.headers["x-dashboard-password"];
        const isMatch = await dashboardPasswordService.verifyPassword(
          String(password || ""),
          flow.dashboard_password_hash
        );
        if (!isMatch) return res.status(401).json({ error: "Unauthorized: Invalid dashboard password" });
      }

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

      const ee = new EventEmitter();
      const events = ["node:start", "node:log", "node:done", "node:error", "flow:done"] as const;
      for (const event of events) {
        ee.on(event, (data: Record<string, unknown>) => onFlowEvent(data));
      }

      runFlow(graph, ee, startNodeId).catch((err: unknown) => {
        onFlowEvent({ type: "flow:error", error: (err as Error).message });
      });

      res.status(200).json({ status: "started" });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Admin flow execution (protected by authMiddleware)
  app.post("/api/run", (req, res) => {
    let graph: GraphJson;
    let startNodeId: string | undefined;

    if (req.body.graph && req.body.graph.nodes) {
      graph = req.body.graph;
      startNodeId = req.body.startNodeId;
    } else {
      graph = req.body;
    }

    if (!graph || !graph.nodes) {
      return res.status(400).json({ error: "Invalid graph: missing nodes" });
    }

    const ee = new EventEmitter();
    const events = ["node:start", "node:log", "node:done", "node:error", "flow:done"] as const;
    for (const event of events) {
      ee.on(event, (data: Record<string, unknown>) => onFlowEvent(data));
    }

    runFlow(graph, ee, startNodeId).catch((err: unknown) => {
      console.error("Flow execution error:", err);
      onFlowEvent({ type: "flow:error", error: (err as Error).message });
    });

    res.status(200).json({ status: "started" });
  });

  return app;
}
