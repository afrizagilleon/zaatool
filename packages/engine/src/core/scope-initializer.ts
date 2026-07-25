import type { GraphJson, SeedOutputs } from "@zaa-tool/shared";
import { storageService } from "../services/storage.service.js";
import { Scope } from "./scope.js";

export function initializeScopeFromGraph(
  graph: GraphJson,
  scope: Scope,
  seedOutputs?: SeedOutputs
): void {
  // Seed outputs supplied explicitly by the caller for this one run (the editor
  // re-running part of a graph). Never sourced from the stored graph — a run
  // must not serve outputs left behind by a previous, unrelated session.
  if (seedOutputs) {
    for (const [nodeId, outputs] of Object.entries(seedOutputs)) {
      if (outputs && typeof outputs === "object") {
        scope.set(nodeId, outputs);
      }
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
