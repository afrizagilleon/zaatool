import { activeSandboxConfig } from "../config.js";
import { createCellHost, type CellHost } from "../core/cell-workspace.js";
import { sandboxUidFor } from "./sandbox-uid.service.js";

/**
 * A notebook that has no owner, while cells change uid. There is no uid to run it as, and
 * running it as root or as somebody else's would defeat the point, so it does not run.
 */
export class NotebookWithoutOwnerError extends Error {
  constructor() {
    super(
      "This notebook has no owner, so there is no sandbox user to run its cells as. " +
        "Give it one with transfer-owner (see DEPLOY.md)."
    );
    this.name = "NotebookWithoutOwnerError";
  }
}

/**
 * Everything a notebook's cells need from the machine they run on: the owner's uid and
 * home when cells change uid, a plain temp folder when they do not.
 *
 * Every cell of a notebook runs as its *owner*, whoever pressed Run: the editor's code
 * already holds the owner's secrets, so the owner is the one domain of trust.
 *
 * `grants` are the storage paths this run's chain may copy into a cell's folder; the set is
 * read live, so a file granted after the host was made (one a cell has just written) counts.
 */
export async function cellHostForOwner(ownerId: string | null, grants: Set<string>): Promise<CellHost> {
  const config = activeSandboxConfig();
  if (!config) return createCellHost({ ownerKey: ownerId ?? "none", grants });
  if (ownerId === null) throw new NotebookWithoutOwnerError();
  return createCellHost({ sandbox: { config, uid: await sandboxUidFor(ownerId, config) }, grants });
}
