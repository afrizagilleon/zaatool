import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { GraphJson } from "@zaa-tool/shared";
import { runFlow } from "./runner/flow-runner.js";
import { startServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function executeFixture(filename: string) {
    console.log(`\n========================================`);
    console.log(`🚀 RUNNING FIXTURE: ${filename}`);
    console.log(`========================================`);
    const graphPath = path.join(__dirname, "fixtures", filename);
    const graph = JSON.parse(readFileSync(graphPath, "utf-8")) as GraphJson;
    await runFlow(graph);
}

async function main() {
    if (process.argv.includes("--serve")) {
        startServer();
    } else {
        // await executeFixture("js-python-flow.json");
        // await executeFixture("if-flow.json");
        await executeFixture("loop-flow.json");
    }
}

main().catch(console.error);