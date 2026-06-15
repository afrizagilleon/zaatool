import { WebSocket } from "ws";
import fs from "fs";

const ws = new WebSocket("ws://localhost:4000");

ws.on("open", async () => {
    console.log("Connected to WS");

    const graph = JSON.parse(fs.readFileSync("src/fixtures/js-python-flow.json", "utf-8"));
    const res = await fetch("http://localhost:4000/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(graph)
    });
    console.log("Run triggered:", await res.json());
});

ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    console.log("WS Event:", msg.type, msg.nodeId || "");
    if (msg.type === "flow:done") {
        ws.close();
        process.exit(0);
    }
});
