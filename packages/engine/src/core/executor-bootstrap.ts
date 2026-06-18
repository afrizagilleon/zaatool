import { defaultExecutorRegistry } from "./registry.js";
import { JsCodeExecutor } from "../executors/js.executor.js";
import { PythonCodeExecutor } from "../executors/python.executor.js";
import { IfExecutor } from "../executors/if.executor.js";
import { LoopExecutor } from "../executors/loop.executor.js";
import { UiInputExecutor } from "../executors/ui-input.executor.js";
import { FileExecutor } from "../executors/file.executor.js";
import { UiTableExecutor } from "../executors/ui-table.executor.js";
import { PassthroughExecutor } from "../executors/ui.executor.js";
import type { ExecutorRegistry } from "./types.js";

export function registerDefaultExecutors(registry: ExecutorRegistry = defaultExecutorRegistry): void {
  registry.set("code:node", new JsCodeExecutor());
  registry.set("code:python", new PythonCodeExecutor());
  registry.set("if", new IfExecutor());
  registry.set("loop", new LoopExecutor());
  registry.set("ui:input", new UiInputExecutor());
  registry.set("file", new FileExecutor());
  registry.set("ui:table", new UiTableExecutor());

  const passthrough = new PassthroughExecutor();
  registry.set("ui:text", passthrough);
  registry.set("ui:chart", passthrough);
  registry.set("ui:image", passthrough);
  registry.set("trigger:start", passthrough);
  registry.set("trigger:cron", passthrough);
}
