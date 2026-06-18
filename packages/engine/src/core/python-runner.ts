import { spawn } from "child_process";

export function runPythonNode(
  code: string,
  inputs: Record<string, unknown>,
  timeoutMs = 5000,
  onLog?: (level: string, msg: string) => void,
  secrets: Record<string, string> = {},
  inputsSchema: any[] = []
): Promise<{ output?: Record<string, unknown>; logs: any[]; error?: string; ms: number }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const logs: any[] = [];

    // wrapper: wrap user's code in def main(inputs), call it, and print output if def main is not defined
    let finalCode = code;
    if (!code.includes("def main(")) {
      const indented = code
        .split("\n")
        .map((line) => "    " + line)
        .join("\n");
      finalCode = `def main(inputs):\n${indented}`;
    }

    const wrapper = `
import json, sys, os, base64

class Table:
    def __init__(self, rows):
        self.rows = rows if isinstance(rows, list) else []
    def get_rows(self):
        return self.rows
    def get_row(self, index):
        if 0 <= index < len(self.rows):
            return self.rows[index]
        return None
    def get_headers(self):
        if not self.rows:
            return []
        return list(self.rows[0].keys())
    def get_column(self, column_key):
        return [row.get(column_key) for row in self.rows]
    def get_cell(self, row_index, column_key):
        row = self.get_row(row_index)
        return row.get(column_key) if row else None
    def filter(self, callback):
        return Table([row for row in self.rows if callback(row)])
    def map(self, callback):
        return [callback(row, idx) for idx, row in enumerate(self.rows)]
    def count(self):
        return len(self.rows)
    def to_json(self):
        return self.rows

class FileObject:
    def __init__(self, file_data):
        if not isinstance(file_data, dict):
            file_data = {}
        self.name = file_data.get("name", "")
        self.path = file_data.get("path", "")
        self.url = file_data.get("url", "")
        self.absolute_path = file_data.get("absolute_path", "")
    def read_as_text(self):
        if not self.absolute_path or not os.path.exists(self.absolute_path):
            return ""
        with open(self.absolute_path, "r", encoding="utf-8") as f:
            return f.read()
    def read_as_base64(self):
        if not self.absolute_path or not os.path.exists(self.absolute_path):
            return ""
        with open(self.absolute_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")
    def exists(self):
        return bool(self.absolute_path) and os.path.exists(self.absolute_path)
    def to_json(self):
        return {
            "name": self.name,
            "path": self.path,
            "url": self.url,
            "absolute_path": self.absolute_path
        }

class ImageObject(FileObject):
    def __init__(self, image_data):
        if isinstance(image_data, str):
            super().__init__({
                "path": image_data,
                "url": image_data,
                "name": os.path.basename(image_data)
            })
        else:
            super().__init__(image_data)
    def to_data_uri(self, mime_type="image/jpeg"):
        base_64 = self.read_as_base64()
        if not base_64:
            return ""
        return f"data:{mime_type};base64,{base_64}"

class CustomEncoder(json.JSONEncoder):
    def default(self, obj):
        if hasattr(obj, "to_json") and callable(obj.to_json):
            return obj.to_json()
        return super().default(obj)

# Read inputs and inputsSchema from stdin
payload = json.loads(sys.stdin.read())
inputs = payload.get("inputs", {})
inputs_schema = payload.get("inputsSchema", [])

# Wrap inputs based on schema
wrapped_inputs = {}
for k, v in inputs.items():
    wrapped_inputs[k] = v

for field in inputs_schema:
    key = field.get("name")
    val = inputs.get(key)
    if val is not None:
        field_type = field.get("type")
        if field_type == "table":
            wrapped_inputs[key] = Table(val)
        elif field_type == "file":
            wrapped_inputs[key] = FileObject(val)
        elif field_type == "image":
            wrapped_inputs[key] = ImageObject(val)

${finalCode}

result = main(wrapped_inputs)
print(json.dumps(result, cls=CustomEncoder))
`;

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, ["-c", wrapper], {
      env: {
        ...process.env,
        ...secrets,
      },
    });

    // send inputs via stdin
    proc.stdin.write(JSON.stringify({ inputs, inputsSchema }));
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
