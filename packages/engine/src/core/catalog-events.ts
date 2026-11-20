import { EventEmitter } from "node:events";
import type { CatalogChange } from "@zaa-tool/shared";

/**
 * Says that the set of notebooks moved. Knows nothing about who cares.
 *
 * It lived in `mcp/notebook-catalog.ts`, because an agent session was the only listener:
 * MCP has a notification for "your tools changed" and something had to fire it. A browser
 * needs the same fact for a different reason, and a browser importing from `mcp/` would be
 * a layering it should not have. So the announcement moved down here, where the two
 * listeners are equals, and the MCP catalogue keeps its own import path.
 *
 * Emitting is deliberately *not* exported to the call sites that write. The old shape had
 * `notifyCatalogChanged()` sprinkled through controllers and MCP tools — present on
 * deploy, undeploy and delete, and missing on every save, which is the change that happens
 * most. Announcing is now something `notebooksService` does as part of writing, so a new
 * write path cannot be added without it. This is rule 5.8 in a different coat: a fact that
 * every layer needs is not a thing each layer remembers.
 */

export interface CatalogChangeNotice {
  change: CatalogChange;
  notebookId: string;
  /**
   * Who may be told, as account ids, when that cannot be looked up afterwards — a delete,
   * or an undeploy that took the page away from the people who used it. `null` is
   * everybody; absent means "whoever can reach the notebook now".
   */
  audience?: string[] | null;
}

const changes = new EventEmitter();
// One listener per open agent session and one per watching browser. No useful ceiling.
changes.setMaxListeners(0);

export function notifyCatalogChanged(notice: CatalogChangeNotice): void {
  changes.emit("changed", notice);
}

/** Returns the unsubscribe handle, so a listener cannot be left behind by mistake. */
export function onCatalogChanged(listener: (notice: CatalogChangeNotice) => void): () => void {
  changes.on("changed", listener);
  return () => {
    changes.off("changed", listener);
  };
}
