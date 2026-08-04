import { spawn } from "child_process";
import { buildSandboxEnv } from "./sandbox-env.js";
import { PY_RPC_PREFIX, type NotebookCaller } from "./notebook-call.js";
import type { FileWriter } from "./notebook-files.js";

export function runPythonNode(
  code: string,
  inputs: Record<string, unknown>,
  timeoutMs = 5000,
  onLog?: (level: string, msg: string) => void,
  secrets: Record<string, string> = {},
  inputsSchema: any[] = [],
  onCall?: NotebookCaller,
  onFile?: FileWriter
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
import json, sys, os, base64, traceback

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
        # absolute_path is left out on purpose: it exists so this object can read the
        # file, and it names a folder on the server. See code-wrappers.ts.
        return {
            "name": self.name,
            "path": self.path,
            "url": self.url
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

# Every protocol frame carries this prefix, so an unmarked line is user output and
# is reported as a log rather than corrupting this cell's result.
_ZAA = ${JSON.stringify(PY_RPC_PREFIX)}

def _zaa_send(frame):
    sys.stdout.write(_ZAA + json.dumps(frame, cls=CustomEncoder) + "\\n")
    sys.stdout.flush()

def _zaa_receive():
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError("the engine closed the connection")
    text = line.strip()
    if not text:
        return _zaa_receive()
    return json.loads(text)

class _Notebooks:
    def __init__(self):
        self._enabled = False
        self._last_id = 0
    def run(self, notebook, input=None):
        if not self._enabled:
            raise RuntimeError("Calling another notebook is not available here")
        if not isinstance(notebook, str) or not notebook.strip():
            raise RuntimeError("notebooks.run needs a notebook id or name")
        self._last_id += 1
        call_id = self._last_id
        _zaa_send({"type": "call", "id": call_id, "notebook": notebook, "input": input or {}})
        while True:
            frame = _zaa_receive()
            if frame.get("type") == "call:result" and frame.get("id") == call_id:
                if frame.get("ok"):
                    return frame.get("value")
                raise RuntimeError(frame.get("error") or "the call failed")

notebooks = _Notebooks()

class _Files:
    """files.write(name, data) - the same channel notebooks.run uses, for bytes.

    data may be str or bytes; bytes are sent as base64, which is what the engine
    expects for anything that is not text. The reply is a dict with path and url, ready
    to be returned as an output rendered as an image or a file.
    """
    def __init__(self):
        self._enabled = False
        self._last_id = 0
    def write(self, name, data, encoding=None):
        if not self._enabled:
            raise RuntimeError("Writing a file is not available here")
        if isinstance(data, (bytes, bytearray)):
            payload = base64.b64encode(bytes(data)).decode("ascii")
            sent = "base64"
        elif isinstance(data, str):
            payload = data
            sent = encoding or "utf8"
        else:
            raise RuntimeError("files.write needs a str or bytes")
        self._last_id += 1
        file_id = self._last_id
        _zaa_send({"type": "file:write", "id": file_id, "name": name, "data": payload, "encoding": sent})
        while True:
            frame = _zaa_receive()
            if frame.get("type") == "file:result" and frame.get("id") == file_id:
                if frame.get("ok"):
                    return frame.get("value")
                raise RuntimeError(frame.get("error") or "the write failed")

files = _Files()

payload = _zaa_receive()
inputs = payload.get("inputs", {})
inputs_schema = payload.get("inputsSchema", [])
notebooks._enabled = bool(payload.get("canCall"))
files._enabled = bool(payload.get("canWriteFile"))

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

try:
    result = main(wrapped_inputs)
    _zaa_send({"type": "done", "output": result})
except Exception as err:
    _zaa_send({"type": "error", "error": "".join(traceback.format_exception_only(type(err), err)).strip()})
`;

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, ["-c", wrapper], {
      env: { PYTHONIOENCODING: "utf-8", ...buildSandboxEnv(secrets) },
    });

    let stderr = "";
    let settled = false;
    let finalOutput: Record<string, unknown> | undefined;
    let finalError: string | undefined;

    const finish = (result: { output?: Record<string, unknown>; error?: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, logs, ms: Date.now() - startTime });
    };

    // Paused while a nested notebook runs — see the note in js-runner.
    let timer: NodeJS.Timeout | undefined;
    const startTimer = (): void => {
      timer = setTimeout(() => {
        proc.kill("SIGKILL");
        finish({ error: `Timeout after ${timeoutMs}ms` });
      }, timeoutMs);
    };
    const pauseTimer = (): void => clearTimeout(timer);
    startTimer();

    const send = (frame: unknown): void => {
      if (proc.stdin.writable) proc.stdin.write(JSON.stringify(frame) + "\n");
    };

    const handleFrame = (frame: any): void => {
      if (frame?.type === "done") {
        finalOutput = frame.output ?? undefined;
        return;
      }
      if (frame?.type === "error") {
        finalError = frame.error || "Python raised an error";
        return;
      }
      if (frame?.type === "call") {
        if (!onCall) {
          send({
            type: "call:result",
            id: frame.id,
            ok: false,
            error: "Calling another notebook is not available here",
          });
          return;
        }
        pauseTimer();
        void onCall({ notebook: frame.notebook, input: frame.input })
          .then((value) => ({ ok: true as const, value }))
          .catch((err: unknown) => ({
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          }))
          .then((outcome) => {
            if (settled) return;
            startTimer();
            send({ type: "call:result", id: frame.id, ...outcome });
          });
        return;
      }
      if (frame?.type === "file:write") {
        if (!onFile) {
          send({
            type: "file:result",
            id: frame.id,
            ok: false,
            error: "Writing a file is not available here",
          });
          return;
        }
        pauseTimer();
        void onFile({ name: frame.name, data: frame.data, encoding: frame.encoding })
          .then((value) => ({ ok: true as const, value }))
          .catch((err: unknown) => ({
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          }))
          .then((outcome) => {
            if (settled) return;
            startTimer();
            send({ type: "file:result", id: frame.id, ...outcome });
          });
      }
    };

    let stdoutBuffer = "";
    proc.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      let newline = stdoutBuffer.indexOf("\n");
      while (newline !== -1) {
        const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        newline = stdoutBuffer.indexOf("\n");

        if (line.startsWith(PY_RPC_PREFIX)) {
          try {
            handleFrame(JSON.parse(line.slice(PY_RPC_PREFIX.length)));
          } catch {
            finalError = `Malformed frame from Python: ${line}`;
          }
        } else if (line.trim() !== "") {
          logs.push({ level: "info", msg: line });
          onLog?.("info", line);
        }
      }
    });

    proc.stderr.on("data", (d) => {
      const msg = d.toString().trim();
      stderr += d.toString();
      logs.push({ level: "error", msg });
      onLog?.("error", msg);
    });

    // The child reads this as its first line and keeps stdin open for call replies.
    send({ inputs, inputsSchema, canCall: Boolean(onCall), canWriteFile: Boolean(onFile) });

    proc.on("error", (err) => finish({ error: err.message }));

    proc.on("close", (code) => {
      if (finalError) return finish({ error: finalError });
      if (finalOutput !== undefined) return finish({ output: finalOutput });
      if (code !== 0) return finish({ error: stderr.trim() || "Python process failed" });
      // Exited cleanly without a result frame: main returned nothing at all.
      finish({ output: undefined });
    });
  });
}
