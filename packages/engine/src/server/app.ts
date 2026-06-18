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
import { authMiddleware } from "../middleware/auth.middleware.js";
import { runFlow } from "../core/flow-runner.js";
import type { GraphJson } from "@zaa-tool/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(onFlowEvent: (data: Record<string, unknown>) => void) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Apply Auth Middleware to protect API routes (except public/health/auth routes)
  app.use("/api", authMiddleware);

  // Mounting sub-routers
  app.use("/api/auth", authRouter);
  app.use("/api/resources/skills", skillsRouter);
  app.use("/api/resources/secrets", secretsRouter);
  app.use("/api/resources", storageRouter); // Handles /files, /folders
  app.use("/storage", express.static(STORAGE_DIR));
  app.use("/api/resources/flows", flowsController.getSummary); // Summary route
  
  app.use("/api/flows", flowsRouter); // Detailed flows routes
  app.use("/api/triggers", triggersRouter);
  app.use("/api/ai", aiRouter);

  // Health check
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // List fixture graphs
  app.get("/api/graphs", (_req, res) => {
    try {
      const fixturesDir = path.resolve(__dirname, "../fixtures");
      const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
      const graphs = files.map((f) => {
        const content = JSON.parse(readFileSync(path.join(fixturesDir, f), "utf-8"));
        return { filename: f, name: content.name ?? f, nodeCount: content.nodes?.length ?? 0 };
      });
      res.json(graphs);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to read fixtures", detail: err.message });
    }
  });

  // Public flow fetch (bypassed in authMiddleware)
  app.get("/api/flows/:id/public", async (req, res) => {
    try {
      const flow = await flowsService.getById(req.params.id);
      if (!flow) {
        return res.status(404).json({ error: "Flow not found" });
      }
      res.json({
        id: flow.id,
        name: flow.name,
        graph_json: typeof flow.graph_json === "string" ? JSON.parse(flow.graph_json) : flow.graph_json,
        dashboard_layout: flow.dashboard_layout ? (typeof flow.dashboard_layout === "string" ? JSON.parse(flow.dashboard_layout) : flow.dashboard_layout) : { items: [] }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Public flow trigger execution (bypassed in authMiddleware)
  app.post("/api/flows/:id/trigger", async (req, res) => {
    try {
      const { startNodeId, inputs } = req.body;
      const flow = await flowsService.getById(req.params.id);
      if (!flow) {
        return res.status(404).json({ error: "Flow not found" });
      }

      const graph: GraphJson = typeof flow.graph_json === "string" ? JSON.parse(flow.graph_json) : flow.graph_json;

      if (!graph || !graph.nodes) {
        return res.status(400).json({ error: "Invalid graph: missing nodes" });
      }

      // Merge inputs into startNodeId node.data if applicable
      if (startNodeId) {
        const node = graph.nodes.find((n) => n.id === startNodeId);
        if (node) {
          if (node.type === "ui:input") {
            node.data = {
              ...node.data,
              values: {
                ...(node.data.values || {}),
                ...(inputs || {}),
              },
            };
          } else if (node.type === "ui:table") {
            node.data = {
              ...node.data,
              selectedRow: inputs?.selectedRow !== undefined ? inputs.selectedRow : (node.data.selectedRow || null),
            };
          } else if (node.type === "file") {
            node.data = {
              ...node.data,
              inputs: {
                ...(node.data.inputs || {}),
                file: inputs?.file !== undefined ? inputs.file : (node.data.inputs?.file || null),
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

      // Start async flow execution
      runFlow(graph, ee, startNodeId).catch((err) => {
        console.error("Flow execution error from trigger:", err);
        onFlowEvent({ type: "flow:error", error: err.message });
      });

      res.status(200).json({ status: "started" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Flow execution (admin only, protected by authMiddleware)
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

    // Forward flow-runner events to the websocket broadcaster callback
    const events = ["node:start", "node:log", "node:done", "node:error", "flow:done"] as const;
    for (const event of events) {
      ee.on(event, (data: Record<string, unknown>) => onFlowEvent(data));
    }

    // Start async flow execution
    runFlow(graph, ee, startNodeId).catch((err) => {
      console.error("Flow execution error:", err);
      onFlowEvent({ type: "flow:error", error: err.message });
    });

    res.status(200).json({ status: "started" });
  });

  return app;
}
