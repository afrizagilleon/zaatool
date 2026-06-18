import { NodeExecutor, NodeExecutorContext, NodeExecutorResult } from "../core/types.js";
import { runPythonNode } from "../core/python-runner.js";
import { secretsService } from "../services/secrets.service.js";
import { exec } from "child_process";
import { promisify } from "util";
import { truncateLog } from "../core/utils.js";

const execAsync = promisify(exec);

async function ensurePythonPackages(
  requirementsStr: string,
  pythonCmd: string,
  nodeId: string,
  ee: any
): Promise<void> {
  const packages = requirementsStr
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  for (const pkg of packages) {
    try {
      // Check if installed using "pip show"
      await execAsync(`"${pythonCmd}" -m pip show ${pkg}`);
    } catch {
      // Package not installed, install it
      ee?.emit("node:log", {
        type: "node:log",
        nodeId,
        level: "info",
        payload: `Installing required Python package: ${pkg}...`,
      });
      console.log(`Installing Python package: ${pkg}...`);
      try {
        await execAsync(`"${pythonCmd}" -m pip install ${pkg}`);
        ee?.emit("node:log", {
          type: "node:log",
          nodeId,
          level: "info",
          payload: `Successfully installed ${pkg}`,
        });
      } catch (err: any) {
        console.error(`Failed to install Python package ${pkg}:`, err);
        throw new Error(`Failed to install required Python package "${pkg}": ${err.message || err}`);
      }
    }
  }
}

export class PythonCodeExecutor implements NodeExecutor {
  async execute(context: NodeExecutorContext): Promise<NodeExecutorResult> {
    const { node, inputs } = context;
    const code = node.data.code ?? "";
    const timeout = (node.data.config?.timeout as number) ?? 5000;
    const requirementsStr = (node.data.config?.requirements as string) ?? "";
    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    try {
      if (requirementsStr.trim()) {
        await ensurePythonPackages(requirementsStr, pythonCmd, node.id, context.ee);
      }
    } catch (err: any) {
      return { error: err.message };
    }

    const rawSecrets = await secretsService.getRawSecrets();
    const result = await runPythonNode(code, inputs, timeout, (level, msg) => {
      context.ee?.emit("node:log", { type: "node:log", nodeId: node.id, level, payload: msg });
    }, rawSecrets, node.data.inputsSchema || []);

    result.logs.forEach((l) => console.log(`  [${l.level}] ${l.msg}`));

    if (result.error) {
      console.error(`  ❌ ERROR: ${result.error}`);
      return { error: result.error };
    }

    console.log(`  ✅ output (${result.ms}ms):`, truncateLog(result.output));
    return { output: result.output ?? {} };
  }
}
