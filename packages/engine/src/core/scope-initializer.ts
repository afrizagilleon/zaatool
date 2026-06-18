import type { GraphJson } from "@zaa-tool/shared";
import { storageService } from "../services/storage.service.js";
import { Scope } from "./scope.js";

export function initializeScopeFromGraph(graph: GraphJson, scope: Scope): void {
  // Pre-populate cached outputs from a previous run (checkpoint/resume)
  for (const node of graph.nodes) {
    if (node.data.outputs) {
      scope.set(node.id, node.data.outputs as Record<string, unknown>);
    }
  }

  // Pre-populate initial values for static/UI nodes so downstream nodes
  // can read them even if the static node hasn't "executed" yet in the toposort.
  for (const node of graph.nodes) {
    if (node.type === "ui:input") {
      scope.set(node.id, { values: node.data.values || {} });
    } else if (node.type === "file") {
      const filePath = node.data.inputs?.file as string | undefined;
      scope.set(node.id, {
        file: filePath
          ? {
              name: filePath.split("/").pop() || filePath,
              path: filePath,
              url: filePath,
              absolute_path: storageService.resolvePath("", filePath),
            }
          : null,
      });
    } else if (node.type === "ui:table") {
      scope.set(node.id, { selectedRow: node.data.selectedRow ?? null });
    }
  }
}
