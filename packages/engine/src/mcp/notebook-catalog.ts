import { EventEmitter } from "node:events";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { notebooksService } from "../services/notebooks.service.js";
import { notebookExecutionService } from "../services/notebook-execution.service.js";
import { ContractError } from "../core/notebook-contract.js";
import type { RunEventSink } from "../core/run-emitter.js";
import type { NotebookJson, NotebookParam } from "@zaa-tool/shared";
import { optionValues } from "../core/notebook-contract.js";
import { outputNames } from "../core/notebook-outputs.js";

/**
 * Deployed notebooks, offered to an agent as tools it can simply call.
 *
 * This is the point the rest of the work was building towards. An agent writes a
 * notebook, you deploy it, and from then on the agent has a new permanent capability —
 * one you can read, run and revoke, because it is a notebook and not a black box grown
 * inside a model.
 *
 * Two rules keep it honest:
 *
 *   - **Only deployed versions.** A tool is a capability you can rely on; a draft is
 *     someone's work in progress. An agent that wants to try its own new notebook still
 *     has `notebook_run`.
 *   - **Only notebooks with a contract.** Without declared inputs and outputs there is
 *     no schema to publish and no way to say what comes back, and a tool nobody can
 *     describe is a tool nobody should call.
 */

/**
 * Fired when the set of tools would have changed.
 *
 * Sessions are long-lived — Hermes may hold one for days — so a notebook deployed this
 * afternoon has to reach a connection opened this morning. MCP has a notification for
 * exactly this; all that is needed is something to fire it.
 */
export const catalogChanges = new EventEmitter();
// One listener per open session, and there is no useful ceiling on those.
catalogChanges.setMaxListeners(0);
export const notifyCatalogChanged = (): void => {
  catalogChanges.emit("changed");
};

/** MCP tool names are identifiers, and a notebook's name is a title. */
export function toolNameFor(notebookName: string): string {
  const slug = notebookName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug ? `run_${slug}` : "";
}

function schemaFor(param: NotebookParam): z.ZodTypeAny {
  const permitted = optionValues(param);

  // A declared set of values belongs in the schema, not only in the prose. An agent
  // choosing between "usd_to_idr" and something it invented is the failure this
  // prevents, and it prevents it before a run starts rather than after.
  const base = permitted.length
    ? // `z.union` needs two members, and a one-value list is a fixed value, not a choice.
      permitted.length === 1
      ? z.literal(permitted[0])
      : z.union(
          permitted.map((value: string | number) => z.literal(value)) as unknown as [
            z.ZodTypeAny,
            z.ZodTypeAny,
            ...z.ZodTypeAny[],
          ]
        )
    : param.type === "number"
      ? z.number()
      : param.type === "boolean"
        ? z.boolean()
        : param.type === "json"
          ? z.unknown()
          : z.string();

  const shaped = param.multiple && permitted.length ? z.array(base) : base;
  const described = param.description ? shaped.describe(param.description) : shaped;
  return param.required && param.default === undefined ? described : described.optional();
}

/**
 * What the agent reads to decide whether this is the tool it wants.
 *
 * Taken from the notebook's own prose, because that is the point of writing notes: the
 * first line of the first note is the closest thing a notebook has to a summary, and it
 * was written for a human, which is exactly the audience that needs it.
 */
function describe(document: NotebookJson): string {
  const firstNote = (() => {
    for (const step of document.steps ?? []) {
      if (step.kind === "cell" && step.note?.trim()) {
        return step.note
          .split("\n")
          .map((line) => line.replace(/^#+\s*/, "").trim())
          .find((line) => line.length > 0);
      }
    }
    return undefined;
  })();

  const outputs = outputNames(document.outputs).join(", ");

  // Spelling the permitted values out here as well as in the schema is deliberate: a
  // model shortlists tools by reading descriptions, and a tool whose one argument is a
  // fixed choice is only obviously the right tool once you can see the choices.
  const inputs = (document.inputs ?? []).map((input) => {
    const permitted = optionValues(input);
    if (permitted.length === 0) return input.name;
    const list = permitted.map((value) => JSON.stringify(value)).join(" | ");
    return `${input.name} (${input.multiple ? `list of ${list}` : list})`;
  });

  // The arguments are in the schema, but a model choosing between tools reads the
  // sentence first — and "takes no arguments" is the fact that decides whether this
  // tool can answer the question at all.
  const takes = inputs.length > 0 ? `Takes: ${inputs.join(", ")}.` : "Takes no arguments.";

  return [
    firstNote ?? `Runs the "${document.name}" notebook.`,
    takes,
    outputs ? `Returns: ${outputs}.` : "Returns nothing.",
    "A deployed notebook in this workspace — read it with notebook_read to see exactly what it does.",
  ].join(" ");
}

export interface CatalogDeps {
  publishRunEvent: RunEventSink;
}

/**
 * Registers one tool per deployed notebook that declares a contract.
 *
 * Returns how many were registered, which is only used for logging — the caller cannot
 * do anything useful with a partial catalogue.
 */
export async function registerDeployedNotebooks(
  server: McpServer,
  deps: CatalogDeps
): Promise<number> {
  const summaries = await notebooksService.getSummary();

  // Gathered before anything is registered, because a duplicate name has to disqualify
  // *both* notebooks. Skipping the second one would leave the first published, which is
  // the silent coin toss this is meant to avoid.
  const candidates: { id: string; document: NotebookJson; toolName: string }[] = [];
  for (const summary of summaries) {
    const document = await notebooksService.getDeployedDocument(summary.id);
    if (!document) continue;

    const hasContract = (document.inputs?.length ?? 0) > 0 || (document.outputs?.length ?? 0) > 0;
    if (!hasContract) continue;

    const toolName = toolNameFor(document.name);
    if (toolName) candidates.push({ id: summary.id, document, toolName });
  }

  const occurrences = new Map<string, number>();
  for (const candidate of candidates) {
    occurrences.set(candidate.toolName, (occurrences.get(candidate.toolName) ?? 0) + 1);
  }

  let registered = 0;

  for (const { id: notebookId, document, toolName: name } of candidates) {
    if ((occurrences.get(name) ?? 0) > 1) continue;

    const inputSchema: Record<string, z.ZodTypeAny> = {};
    for (const param of document.inputs ?? []) {
      if (param?.name) inputSchema[param.name] = schemaFor(param);
    }

    server.registerTool(
      name,
      { title: document.name, description: describe(document), inputSchema },
      async (args: Record<string, unknown>) => {
        try {
          const started = await notebookExecutionService.start(notebookId, deps.publishRunEvent, {
            args,
            triggerSource: "tool",
          });
          const result = await started.completed;

          if (result.status === "failed") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `"${document.name}" failed: ${result.errors[0] ?? "unknown error"}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [{ type: "text" as const, text: JSON.stringify(result.outputs, null, 2) }],
          };
        } catch (err: unknown) {
          // A contract failure is the agent's mistake and it can fix it, so the issues
          // matter more than the sentence wrapping them.
          const text =
            err instanceof ContractError
              ? `"${document.name}" refused the arguments:\n${err.issues.map((issue) => `  - ${issue}`).join("\n")}`
              : (err as Error).message;
          return { content: [{ type: "text" as const, text }], isError: true };
        }
      }
    );

    registered += 1;
  }

  return registered;
}
