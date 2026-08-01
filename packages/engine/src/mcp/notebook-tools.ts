import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { notebooksService, type NotebookRecord } from "../services/notebooks.service.js";
import { notebookRunsService } from "../services/notebook-runs.service.js";
import { secretsService } from "../services/secrets.service.js";
import {
  notebookExecutionService,
  CellNotFoundError,
  NotebookNotFoundError,
  TooManyRunsError,
} from "../services/notebook-execution.service.js";
import { compileNotebook, NotebookCompileError } from "../core/notebook-compiler.js";
import { ContractError } from "../core/notebook-contract.js";
import { fromMarkdown, toMarkdown, NotebookTextError } from "../core/notebook-text.js";
import { outwardChanges, requestApproval } from "./approval.js";
import type { NotebookPlan } from "../core/notebook-compiler.js";
import type { RunEventSink } from "../core/run-emitter.js";
import type { AgentScope } from "../services/agent-tokens.service.js";
import type { NotebookJson } from "@zaa-tool/shared";

/**
 * The agent's side of zaatool.
 *
 * A second door onto the same services the HTTP controllers use, so an agent and the
 * browser act on one system: the same run gate, the same event hub, the same history.
 * That is the point of putting this inside the engine rather than in a sidecar — when
 * an agent runs a cell, you watch it happen in the editor.
 *
 * Everything here speaks the notebook's text form. An agent reads markdown, edits
 * markdown, writes markdown back; JSON never crosses the boundary.
 *
 * Deliberately absent, and not by oversight:
 *   - no tool returns a secret's *value*, only its name
 *   - no tool deploys anything, because deciding what production runs is yours
 */

export interface McpToolDeps {
  publishRunEvent: RunEventSink;
}

/** Long enough for a real API call chain, short enough that a hung run answers. */
const DEFAULT_RUN_TIMEOUT_SECONDS = 120;
const MAX_RUN_TIMEOUT_SECONDS = 600;

type ToolReply = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const reply = (text: string): ToolReply => ({ content: [{ type: "text", text }] });
const refuse = (text: string): ToolReply => ({ content: [{ type: "text", text }], isError: true });
const asJson = (value: unknown): ToolReply => reply(JSON.stringify(value, null, 2));

/**
 * Turns whatever went wrong into something an agent can act on.
 *
 * Compile and contract failures carry a list of issues, and that list is the useful
 * part — collapsing it into one sentence throws away the specific thing to fix.
 */
function explain(err: unknown): ToolReply {
  if (err instanceof NotebookTextError || err instanceof NotebookCompileError || err instanceof ContractError) {
    return refuse(`${err.name}:\n${err.issues.map((issue) => `  - ${issue}`).join("\n")}`);
  }
  if (err instanceof TooManyRunsError) {
    return refuse(`${err.message} Other runs are already using the engine's slots.`);
  }
  return refuse((err as Error).message ?? String(err));
}

async function resolveNotebook(
  reference: string
): Promise<{ record: NotebookRecord } | { error: ToolReply }> {
  const found = await notebooksService.findByIdOrName(reference.trim());
  if (found === null) return { error: refuse(`No notebook matches "${reference}".`) };
  if (found === "ambiguous") {
    return {
      error: refuse(`More than one notebook is named "${reference}" — use its id instead.`),
    };
  }
  return { record: found };
}

/** Runnable cells in execution order, which is the order a person counts them in. */
function runnableCells(plan: NotebookPlan): string[] {
  const ids: string[] = [];
  const walk = (steps: NotebookPlan["steps"]): void => {
    for (const step of steps) {
      if (step.kind === "code") ids.push(step.cellId);
      else for (const lane of step.lanes) walk(lane.steps);
    }
  };
  walk(plan.steps);
  return ids;
}

/**
 * Accepts a cell id or a 1-based position.
 *
 * Positions exist because that is how the notebook reads on screen and how an agent
 * refers to it a moment after writing it — "run cell 2" should not require looking up
 * a uuid it has no reason to remember.
 */
function resolveCell(plan: NotebookPlan, reference: string): string | null {
  const ids = runnableCells(plan);
  const trimmed = reference.trim();
  if (ids.includes(trimmed)) return trimmed;

  const position = Number(trimmed);
  if (Number.isInteger(position) && position >= 1 && position <= ids.length) {
    return ids[position - 1];
  }
  return null;
}

function contractLine(document: NotebookJson): string {
  const inputs = (document.inputs ?? [])
    .map((input) => `${input.name}: ${input.type}${input.required ? "!" : ""}`)
    .join(", ");
  const outputs = (document.outputs ?? []).join(", ");
  if (!inputs && !outputs) return "no contract — cannot be called by another notebook";
  return `(${inputs || "no inputs"}) → {${outputs || "nothing"}}`;
}

function triggerLines(document: NotebookJson): string[] {
  return (document.triggers ?? []).map((trigger) => {
    const state = trigger.enabled === false ? "disabled" : "enabled";
    return trigger.kind === "cron"
      ? `cron \`${trigger.cron}\` (${state})`
      : `webhook POST /hooks/${trigger.slug} (${state}${trigger.secretKey ? `, needs secret ${trigger.secretKey}` : ""})`;
  });
}

/** The shape every run tool answers with, built from the stored record. */
async function describeRun(
  runId: string,
  outcome: { status: string; errors: string[]; ms: number; outputs: Record<string, unknown> },
  only?: string
): Promise<Record<string, unknown>> {
  const detail = await notebookRunsService.getById(runId);
  const cells = detail?.cell_results ?? {};

  return {
    runId,
    status: outcome.status,
    ms: outcome.ms,
    ...(outcome.errors.length > 0 ? { errors: outcome.errors } : {}),
    ...(Object.keys(outcome.outputs).length > 0 ? { outputs: outcome.outputs } : {}),
    cells: only ? { [only]: cells[only] ?? null } : cells,
  };
}

export function registerNotebookTools(server: McpServer, deps: McpToolDeps, scope: AgentScope): void {
  const timeoutArg = z
    .number()
    .int()
    .min(1)
    .max(MAX_RUN_TIMEOUT_SECONDS)
    .optional()
    .describe(`How long to wait for the run, in seconds (default ${DEFAULT_RUN_TIMEOUT_SECONDS}).`);

  /** Waits for the run, or hands back the id if it outlives the caller's patience. */
  async function awaitRun(
    started: { runId: string; completed: Promise<{ status: string; errors: string[]; ms: number; outputs: Record<string, unknown> }> },
    seconds: number | undefined,
    only?: string
  ): Promise<ToolReply> {
    const limit = (seconds ?? DEFAULT_RUN_TIMEOUT_SECONDS) * 1000;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = Symbol("timeout");

    const outcome = await Promise.race([
      started.completed,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), limit);
      }),
    ]);
    if (timer) clearTimeout(timer);

    if (outcome === timedOut) {
      return reply(
        JSON.stringify(
          {
            runId: started.runId,
            status: "still running",
            note: `Gave up waiting after ${limit / 1000}s. The run continues — read it later with run_inspect.`,
          },
          null,
          2
        )
      );
    }

    return asJson(await describeRun(started.runId, outcome, only));
  }

  // ── reading ─────────────────────────────────────────────────────────────────

  server.registerTool(
    "notebook_list",
    {
      title: "List notebooks",
      description:
        "Every notebook, with its contract and its triggers. Start here: it tells you what already exists so you can call it instead of writing it again.",
      inputSchema: {},
    },
    async () => {
      const summaries = await notebooksService.getSummary();
      if (summaries.length === 0) return reply("No notebooks yet.");

      const lines: string[] = [];
      for (const summary of summaries) {
        const record = await notebooksService.getById(summary.id);
        const document = record ? notebooksService.parseDocument(record) : null;
        lines.push(`- **${summary.name}** \`${summary.id}\` · ${summary.runtime}`);
        if (document) {
          lines.push(`    ${contractLine(document)}`);
          for (const trigger of triggerLines(document)) lines.push(`    ${trigger}`);
        }
      }
      return reply(lines.join("\n"));
    }
  );

  server.registerTool(
    "notebook_read",
    {
      title: "Read a notebook",
      description:
        "The whole notebook in its text form: front matter for the contract, secrets and triggers, then one section per cell. Edit this text and send it back with notebook_write.",
      inputSchema: {
        notebook: z.string().describe("The notebook's name or id."),
      },
    },
    async ({ notebook }) => {
      const resolved = await resolveNotebook(notebook);
      if ("error" in resolved) return resolved.error;
      return reply(toMarkdown(notebooksService.parseDocument(resolved.record)));
    }
  );

  server.registerTool(
    "run_list",
    {
      title: "List a notebook's runs",
      description: "Recent runs, newest first — when each ran, what set it off, and whether it failed.",
      inputSchema: {
        notebook: z.string().describe("The notebook's name or id."),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ notebook, limit }) => {
      const resolved = await resolveNotebook(notebook);
      if ("error" in resolved) return resolved.error;
      return asJson(await notebookRunsService.listByNotebook(resolved.record.id, limit ?? 10));
    }
  );

  server.registerTool(
    "run_inspect",
    {
      title: "Inspect a run",
      description:
        "One run in full: per cell, the code that actually ran, its output, its logs and its error. This is how you debug a failure you did not witness — a cron that failed at 3am left this behind.",
      inputSchema: {
        run: z.string().describe("A run id, or a notebook name/id to take its latest run."),
      },
    },
    async ({ run }) => {
      const direct = await notebookRunsService.getById(run.trim());
      if (direct) return asJson(direct);

      const resolved = await resolveNotebook(run);
      if ("error" in resolved) {
        return refuse(`No run and no notebook matches "${run}".`);
      }
      const latest = await notebookRunsService.getLatestForNotebook(resolved.record.id);
      return latest ? asJson(latest) : reply(`"${resolved.record.name}" has never run.`);
    }
  );

  server.registerTool(
    "secret_list_names",
    {
      title: "List secret names",
      description:
        "The names of stored secrets — never their values. Reference a secret by name in a notebook's `secrets:` list; the engine resolves it at run time so no credential is written into a document.",
      inputSchema: {},
    },
    async () => {
      const rows = (await secretsService.getAll()) as { key: string; is_secret: boolean }[];
      if (rows.length === 0) return reply("No secrets stored.");
      return reply(
        rows.map((row) => `- ${row.key}${row.is_secret ? "" : " (plain variable, not hidden)"}`).join("\n")
      );
    }
  );

  // ── running ─────────────────────────────────────────────────────────────────

  server.registerTool(
    "notebook_run_cell",
    {
      title: "Run one cell",
      description:
        "Runs a single cell and returns what it produced. This is the tool to lean on: run a cell, look at the real shape of the data, then write the next cell against what is actually there instead of what the documentation claims. A single cell starts from an empty scope, so pass anything it depends on as `input` — the cell reads those values as `inputs.<name>`.",
      inputSchema: {
        notebook: z.string().describe("The notebook's name or id."),
        cell: z.string().describe("A cell id, or its 1-based position in the notebook."),
        input: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Values seeded into scope before the cell runs, standing in for earlier cells."),
        timeoutSeconds: timeoutArg,
      },
    },
    async ({ notebook, cell, input, timeoutSeconds }) => {
      const resolved = await resolveNotebook(notebook);
      if ("error" in resolved) return resolved.error;

      try {
        const document = notebooksService.parseDocument(resolved.record);
        const plan = compileNotebook(document);
        const cellId = resolveCell(plan, cell);
        if (!cellId) {
          const ids = runnableCells(plan);
          return refuse(
            `"${cell}" is not a cell in "${resolved.record.name}". It has ${ids.length} runnable cell(s): ${ids
              .map((id, index) => `${index + 1}=${id}`)
              .join(", ")}`
          );
        }

        const started = await notebookExecutionService.start(resolved.record.id, deps.publishRunEvent, {
          cellId,
          input,
          triggerSource: "cell",
        });
        return await awaitRun(started, timeoutSeconds, cellId);
      } catch (err: unknown) {
        if (err instanceof CellNotFoundError || err instanceof NotebookNotFoundError) {
          return refuse(err.message);
        }
        return explain(err);
      }
    }
  );

  server.registerTool(
    "notebook_run",
    {
      title: "Run a whole notebook",
      description:
        "Runs every cell in order and returns the declared outputs along with each cell's result. Arguments are checked against the notebook's declared inputs before anything starts, so a bad argument is refused rather than half-executed.",
      inputSchema: {
        notebook: z.string().describe("The notebook's name or id."),
        args: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Arguments for the notebook's declared inputs."),
        timeoutSeconds: timeoutArg,
      },
    },
    async ({ notebook, args, timeoutSeconds }) => {
      const resolved = await resolveNotebook(notebook);
      if ("error" in resolved) return resolved.error;

      try {
        const started = await notebookExecutionService.start(resolved.record.id, deps.publishRunEvent, {
          args,
          triggerSource: "manual",
        });
        return await awaitRun(started, timeoutSeconds);
      } catch (err: unknown) {
        return explain(err);
      }
    }
  );

  if (scope !== "author") return;

  // ── writing ─────────────────────────────────────────────────────────────────

  server.registerTool(
    "notebook_write",
    {
      title: "Create or update a notebook",
      description:
        [
          "Saves a notebook from its text form. Front matter carries `name`, `runtime` (node or python), `secrets`, `inputs`, `outputs` and `triggers`; the body is cells.",
          "",
          "Minimal example — prose, then one code block, is read as a single cell:",
          "",
          "---",
          "name: hello",
          "runtime: node",
          "---",
          "",
          "Say hello.",
          "",
          "```js",
          "return { greeting: 'hi' };",
          "```",
          "",
          "For several cells, mark each with `<!-- zaa:cell -->`, put its code after `<!-- zaa:code -->`, and group concurrent work with `<!-- zaa:parallel -->` / `<!-- zaa:lane label=... -->` / `<!-- zaa:end -->`.",
          "",
          "How cells pass values: whatever a cell returns is merged into a shared scope by name, and every later cell reads it off `inputs` — `inputs.total` in JavaScript, `inputs[\"total\"]` in Python. A bare `total` is not in scope and will not resolve.",
          "Secrets named in `secrets:` arrive as environment variables, never as literals in the document.",
          "To reuse another notebook, call `await notebooks.run('its-name', { arg: 1 })` from a cell; you get back only that notebook's declared outputs.",
          "",
          "Read first and keep the ids you were given: run history and freshness are keyed by cell id, so dropping them starts the record over.",
        ].join("\n"),
      inputSchema: {
        text: z.string().describe("The whole notebook in its text form."),
        notebook: z
          .string()
          .optional()
          .describe("Name or id of an existing notebook to update, when the text has no `id`."),
        approveOutwardChange: z
          .boolean()
          .optional()
          .describe(
            "Set only when the person you are working for has agreed to a change that alters what runs unattended — a new or changed cron or webhook, or edits to a notebook that is already live."
          ),
      },
    },
    async ({ text, notebook, approveOutwardChange }) => {
      let fallbackId: string | undefined;
      if (notebook) {
        const resolved = await resolveNotebook(notebook);
        if ("error" in resolved) return resolved.error;
        fallbackId = resolved.record.id;
      }

      // Read once to find out which notebook this is, then again knowing what it is
      // replacing — that second pass is what keeps an existing webhook slug alive.
      let document: NotebookJson;
      try {
        document = fromMarkdown(text, { id: fallbackId });
      } catch (err: unknown) {
        return explain(err);
      }

      const existing = await notebooksService.getById(document.id);
      const before = existing ? notebooksService.parseDocument(existing) : null;
      if (before) document = fromMarkdown(text, { id: fallbackId, previous: before });

      // Until a notebook can be deployed, saving *is* publishing: whatever is stored is
      // what the next webhook call and the next cron tick will run. So a change that
      // reaches outside the editor is put to a person before it lands.
      const outward = outwardChanges(before, document);
      if (outward.length > 0) {
        const approval = await requestApproval(server, {
          summary: `Save "${document.name}"?`,
          consequence: `This ${outward.join(", and ")}.`,
          fallbackGiven: approveOutwardChange === true,
          fallbackHint: "Ask the person you are working for, then call again with approveOutwardChange: true.",
        });
        if (!approval.approved) {
          return refuse(`Not saved. ${approval.reason}`);
        }
      }

      const saved = await notebooksService.save(document);

      const lines = [
        `${existing ? "Updated" : "Created"} **${saved.name}** \`${saved.id}\``,
        `Contract: ${contractLine(document)}`,
      ];
      for (const trigger of triggerLines(document)) lines.push(`Trigger: ${trigger}`);

      // Saved either way, then compiled — a half-written notebook is a normal state to
      // be in mid-task, but the agent should learn what is wrong now rather than at the
      // next run.
      try {
        const plan = compileNotebook(document);
        const ids = runnableCells(plan);
        lines.push(
          "",
          `Compiles. ${ids.length} runnable cell(s):`,
          ...ids.map((id, index) => `  ${index + 1}. ${id}`)
        );
      } catch (err: unknown) {
        const issues = err instanceof NotebookCompileError ? err.issues : [(err as Error).message];
        lines.push("", "Saved, but it does not compile yet:", ...issues.map((issue) => `  - ${issue}`));
      }

      return reply(lines.join("\n"));
    }
  );

  server.registerTool(
    "notebook_delete",
    {
      title: "Delete a notebook",
      description:
        "Removes a notebook, its triggers and its run history. Irreversible, so it asks first — and where the client cannot ask a person, it requires the notebook's exact name as `confirmName`.",
      inputSchema: {
        notebook: z.string().describe("The notebook's name or id."),
        confirmName: z
          .string()
          .optional()
          .describe("The notebook's exact name, typed again. Needed when the client cannot show a prompt."),
      },
    },
    async ({ notebook, confirmName }) => {
      const resolved = await resolveNotebook(notebook);
      if ("error" in resolved) return resolved.error;

      const approval = await requestApproval(server, {
        summary: `Delete "${resolved.record.name}"?`,
        consequence: "The notebook, its triggers and its whole run history go, and cannot be recovered.",
        fallbackGiven: confirmName === resolved.record.name,
        fallbackHint: `Call again with confirmName: "${resolved.record.name}" if that is really what you want.`,
      });
      if (!approval.approved) {
        return refuse(`Not deleted. ${approval.reason}`);
      }

      await notebookRunsService.deleteByNotebook(resolved.record.id);
      await notebooksService.delete(resolved.record.id);
      return reply(`Deleted "${resolved.record.name}".`);
    }
  );
}
