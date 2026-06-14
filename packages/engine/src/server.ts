import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFlow } from "./runner/flow-runner.js";
import type { GraphJson } from "@zaa-tool/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startServer(port = 4000) {
    const app = express();
    app.use(cors());
    app.use(express.json());

    // ── Health ────────────────────────────────────────────
    app.get("/api/health", (_req, res) => {
        res.status(200).json({ status: "ok" });
    });

    // ── List fixture graphs (for testing) ────────────────
    app.get("/api/graphs", (_req, res) => {
        try {
            const fixturesDir = path.join(__dirname, "fixtures");
            const files = readdirSync(fixturesDir).filter(f => f.endsWith(".json"));
            const graphs = files.map(f => {
                const content = JSON.parse(readFileSync(path.join(fixturesDir, f), "utf-8"));
                return { filename: f, name: content.name ?? f, nodeCount: content.nodes?.length ?? 0 };
            });
            res.json(graphs);
        } catch (err: any) {
            res.status(500).json({ error: "Failed to read fixtures", detail: err.message });
        }
    });

    // ── Create HTTP server ───────────────────────────────
    let server: ReturnType<typeof app.listen>;
    try {
        server = app.listen(port, () => {
            console.log(`✅ Server listening on http://localhost:${port}`);
        });
    } catch (err: any) {
        console.error(`❌ Failed to start HTTP server on port ${port}:`, err.message);
        process.exit(1);
    }

    server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
            console.error(`❌ Port ${port} is already in use. Please choose a different port.`);
        } else {
            console.error(`❌ HTTP server error:`, err.message);
        }
        process.exit(1);
    });

    // ── WebSocket server ─────────────────────────────────
    const wss = new WebSocketServer({ server });

    wss.on("error", (err) => {
        console.error("❌ WebSocket server error:", err.message);
    });

    wss.on("connection", (ws) => {
        console.log("🔌 WebSocket client connected");
        ws.on("close", () => console.log("🔌 WebSocket client disconnected"));
        ws.on("error", (err) => console.error("WebSocket client error:", err.message));
    });

    /**
     * Broadcast an event to all connected WebSocket clients.
     * Events from flow-runner already include a `type` field (e.g. "node:start", "node:done"),
     * so we forward them as-is: { type: string, ...rest }
     */
    const broadcast = (data: Record<string, unknown>) => {
        const msg = JSON.stringify(data);
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(msg);
            }
        });
    };

    // ── Run a graph ──────────────────────────────────────
    app.post("/api/run", (req, res) => {
        const graph: GraphJson = req.body;

        if (!graph || !graph.nodes) {
            return res.status(400).json({ error: "Invalid graph: missing nodes" });
        }

        const ee = new EventEmitter();

        // Forward all flow-runner events directly to WebSocket clients.
        // Each event object already contains { type: "node:start"|"node:done"|…, ...payload }.
        const events = ["node:start", "node:log", "node:done", "node:error", "flow:done"] as const;
        for (const event of events) {
            ee.on(event, (data: Record<string, unknown>) => broadcast(data));
        }

        // Start async execution — don't await, respond immediately
        runFlow(graph, ee).catch((err) => {
            console.error("Flow execution error:", err);
            broadcast({ type: "flow:error", error: err.message });
        });

        res.status(200).json({ status: "started" });
    });

    return { app, server, wss };
}
