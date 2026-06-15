import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { EventEmitter } from "node:events";

import { skillsRouter } from "../routes/skills.route.js";
import { secretsRouter } from "../routes/secrets.route.js";
import { storageRouter } from "../routes/storage.route.js";
import { flowsRouter } from "../routes/flows.route.js";
import { aiRouter } from "../routes/ai.route.js";
import { flowsController } from "../controllers/flows.controller.js";
import { runFlow } from "../core/flow-runner.js";
import type { GraphJson } from "@zaa-tool/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(onFlowEvent: (data: Record<string, unknown>) => void) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Mounting sub-routers
  app.use("/api/resources/skills", skillsRouter);
  app.use("/api/resources/secrets", secretsRouter);
  app.use("/api/resources", storageRouter); // Handles /files, /folders
  app.use("/api/resources/flows", flowsController.getSummary); // Summary route
  
  app.use("/api/flows", flowsRouter); // Detailed flows routes
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

  // Flow execution
  app.post("/api/run", (req, res) => {
    const graph: GraphJson = req.body;

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
    runFlow(graph, ee).catch((err) => {
      console.error("Flow execution error:", err);
      onFlowEvent({ type: "flow:error", error: err.message });
    });

    res.status(200).json({ status: "started" });
  });

  return app;
}
