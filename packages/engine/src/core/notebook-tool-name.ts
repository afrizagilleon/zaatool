import { trimChars } from "./linear-text.js";

/**
 * The identifier a notebook is known by to an agent.
 *
 * A pure naming rule, so it lives in `core/` rather than beside the MCP server: the
 * catalogue uses it to register tools, and the deploy screen uses it to tell you which
 * tool disappears if you take a notebook out of production. Both need the same answer,
 * and a service reaching into the MCP layer to get it would be the wrong direction.
 */

/** MCP tool names are identifiers, and a notebook's name is a title. */
export function toolNameFor(notebookName: string): string {
  const slug = trimChars(notebookName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"), "_").slice(0, 48);
  return slug ? `run_${slug}` : "";
}
