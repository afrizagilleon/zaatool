import type { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth.service.js";
import { storageLinkValid } from "../core/storage-links.js";
import { safeSubPath } from "../core/storage-paths.js";
import { STORAGE_DIR } from "../services/storage.service.js";
import { notebookAccessService } from "../services/notebook-access.service.js";

/**
 * The gate in front of `express.static`.
 *
 * Two ways through, because two different things need to get in:
 *
 *  - **A signed link**, which is what a page puts in `src` and what a shared page hands to
 *    someone with no account. It names one file and stops working on its own.
 *  - **A bearer token**, for code that can set a header — the file browser fetching a text
 *    file to preview it, a script pulling something down. It is checked against the account
 *    as `/api` checks it: a switched-off account or an ended session is not let in just
 *    because the signature on the token is still good. It opens everything except the
 *    folders of notebooks its account cannot edit; a signed link is the way to hand those out.
 *
 * There is deliberately no third way, and in particular no session in the query string: a
 * link that carries a whole session is a link that grants everything if it is forwarded,
 * which is the opposite of what a shared page needs.
 */
export async function storageAccess(req: Request, res: Response, next: NextFunction) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(req.path);
  } catch {
    return res.status(400).json({ error: "Bad path" });
  }

  const relative = safeSubPath(decoded, STORAGE_DIR);
  // Not 403: a caller probing outside storage learns nothing about what is there.
  if (relative === null || relative === "") {
    return res.status(404).json({ error: "Not found" });
  }

  if (storageLinkValid(relative, req.query.exp, req.query.sig)) {
    return next();
  }

  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const session = await authService.authenticate(header.slice(7));
      if (session.status === "ok") {
        // A session reaches every folder except the two that belong to a notebook it cannot edit.
        // Not 403: the folder is named after the notebook's id, so a refusal would confirm it.
        const hidden = await notebookAccessService.hiddenFromStorage(session.user.id);
        if (hidden(relative)) return res.status(404).json({ error: "Not found" });
        return next();
      }
    } catch (err) {
      return next(err);
    }
  }

  res.status(401).json({
    error: "This file needs a signed link or a session. Links from a listing expire; ask for it again.",
  });
}
