import { defaultExecutorRegistry } from "./registry.js";
import { JsCodeExecutor } from "../executors/js.executor.js";
import { PythonCodeExecutor } from "../executors/python.executor.js";
import { UiInputExecutor } from "../executors/ui-input.executor.js";
import { FileExecutor } from "../executors/file.executor.js";
import { UiTableExecutor } from "../executors/ui-table.executor.js";
import { PassthroughExecutor } from "../executors/ui.executor.js";
import type { ExecutorRegistry, NodeExecutor, NodeExecutorContext, NodeExecutorResult } from "./types.js";

class DisabledExecutor implements NodeExecutor {
  constructor(private readonly reason: string) {}
  async execute(_ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    return { error: this.reason };
  }
}

export function registerDefaultExecutors(registry: ExecutorRegistry = defaultExecutorRegistry): void {
  registry.set("code:node", new JsCodeExecutor());
  registry.set("code:python", new PythonCodeExecutor());
  registry.set("if", new DisabledExecutor("If/Branch node is disabled. Use if/else inside a Code node instead."));
  registry.set("loop", new DisabledExecutor("Loop node is disabled. Use array.map() or Promise.all() inside a Code node instead."));
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
