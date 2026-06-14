import { spawn } from "child_process";

export function runPythonNode(
    code: string,
    inputs: Record<string, unknown>,
    timeoutMs = 5000,
    onLog?: (level: string, msg: string) => void
): Promise<{ output?: Record<string, unknown>; logs: any[]; error?: string; ms: number }> {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const logs: any[] = [];

        // wrapper: wrap user's code in def main(inputs), call it, and print output
        const wrapper = `
import json, sys

inputs = json.loads(sys.stdin.read())

${code}

result = main(inputs)
print(json.dumps(result))
`;

        const proc = spawn("python3", ["-c", wrapper]);

        // send inputs via stdin
        proc.stdin.write(JSON.stringify(inputs));
        proc.stdin.end();

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (d) => (stdout += d.toString()));
        proc.stderr.on("data", (d) => {
            const msg = d.toString().trim();
            stderr += d.toString();
            logs.push({ level: "error", msg });
            onLog?.("error", msg);
        });

        const timer = setTimeout(() => {
            proc.kill("SIGKILL");
            resolve({ error: `Timeout after ${timeoutMs}ms`, logs, ms: Date.now() - startTime });
        }, timeoutMs);

        proc.on("close", (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                resolve({ error: stderr || "Python process failed", logs, ms: Date.now() - startTime });
            } else {
                try {
                    const output = JSON.parse(stdout.trim());
                    resolve({ output, logs, ms: Date.now() - startTime });
                } catch {
                    resolve({ error: `Output is not valid JSON: ${stdout}`, logs, ms: Date.now() - startTime });
                }
            }
        });
    });
}