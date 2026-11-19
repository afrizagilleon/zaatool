/**
 * What a cell is allowed to import.
 *
 * Measured before this existed, and the result was backwards from what anyone assumed:
 *
 *  - **Python cells had nothing.** No pandas, no requests, not even a way to ask. The
 *    runtime that people reach for *because* of its libraries had only the standard one.
 *  - **JavaScript cells had everything.** `require` resolved out of the engine's own
 *    `node_modules`, so a cell could `require('pg')` and hold a client to the database
 *    this application runs on — a thing no notebook has any business touching.
 *
 * So this narrows one side and opens the other, and it uses the shape that already exists
 * for exactly this problem. `secrets:` is the precedent: a notebook names what it needs,
 * the engine decides whether it may have it, and nothing arrives that was not asked for.
 * `packages:` is the same sentence about libraries.
 *
 * The two runtimes are not treated the same, because they are not the same risk. A Python
 * package is installed into a throwaway environment for that run. A JavaScript one is
 * loaded into a cell process that can read them, which is why that side is a fixed list and
 * `pnpm add` is not part of writing a notebook.
 *
 * The list and the requirement shape moved to `@zaa-tool/shared` so the editor can refuse
 * `pg` while it is being typed rather than after a deploy. The judging stayed here: this
 * is the side that actually loads the thing.
 */

import { ALLOWED_JS_PACKAGES, PYTHON_REQUIREMENT_SOURCE } from "@zaa-tool/shared";

export { ALLOWED_JS_PACKAGES };

const PYTHON_REQUIREMENT = new RegExp(PYTHON_REQUIREMENT_SOURCE);

export type Runtime = "node" | "python";

/** Reasons a `packages:` list cannot be honoured, in the words the author needs. */
export function packageProblems(runtime: Runtime, packages: string[] | undefined): string[] {
  if (!Array.isArray(packages) || packages.length === 0) return [];
  const issues: string[] = [];

  for (const entry of packages) {
    const name = String(entry ?? "").trim();
    if (name === "") {
      issues.push("`packages` has an empty entry");
      continue;
    }

    if (runtime === "python") {
      if (!PYTHON_REQUIREMENT.test(name)) {
        issues.push(
          `package ${JSON.stringify(name)} is not a plain requirement — a name, optionally with a version like \`pandas==2.2.0\``
        );
      }
      continue;
    }

    if (!(ALLOWED_JS_PACKAGES as readonly string[]).includes(name)) {
      issues.push(
        `package ${JSON.stringify(name)} is not available to JavaScript cells. ` +
          `The list is: ${ALLOWED_JS_PACKAGES.join(", ")}. Python cells may name any package on PyPI.`
      );
    }
  }

  return issues;
}

/** The bare package name, with any version marker taken off. */
export function packageName(requirement: string): string {
  return requirement.trim().split(/[[<>=!~]/)[0].trim();
}
