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
import { fromMarkdown, toMarkdown, mentionsKey, NotebookTextError } from "../core/notebook-text.js";
import { requestApproval } from "./approval.js";
import { buildNotebookMap, renderNotebookMap } from "../core/notebook-map.js";
import { outputNames } from "../core/notebook-outputs.js";
import { abridge, wasAbridged } from "./abridge.js";
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
  /**
   * What to record as the author of anything this connection writes — the label on the
   * token it authenticated with, so "claude code" and "hermes" are told apart in a
   * notebook's history.
   */
  writer: string;
}

/**
 * Where a person would go to look at this.
 *
 * An agent cannot deploy, so every write ends with someone being asked to. Handing over
 * a link rather than an id is the difference between a request and an errand.
 */
const editorUrl = (notebookId: string): string =>
  `${process.env.WEB_BASE_URL ?? "http://localhost:5173"}/#/notebooks/${notebookId}`;

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
  const outputs = outputNames(document.outputs).join(", ");
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

  const selectedCells = only ? { [only]: cells[only] ?? null } : cells;

  // Shortened deliberately. What you need to decide the next step is the shape and the
  // size; the rows themselves are the notebook's answer to whoever opens its page, and
  // sending them here spends your context on data you just caused to exist.
  const outputs = abridge(outcome.outputs);
  const shortened =
    wasAbridged(outcome.outputs, outputs) || wasAbridged(selectedCells, abridge(selectedCells));

  return {
    runId,
    status: outcome.status,
    ms: outcome.ms,
    ...(outcome.errors.length > 0 ? { errors: outcome.errors } : {}),
    ...(Object.keys(outcome.outputs).length > 0 ? { outputs } : {}),
    cells: abridge(selectedCells),
    ...(shortened
      ? {
          note: "Large values are abridged: `summary` gives the true size, `first` a sample. The full result is on the notebook's page, and a caller receives it in full.",
        }
      : {}),
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
        "Every notebook, with its contract and its triggers. Start here before writing anything: it tells you what already exists so you can call it instead of writing it again.",
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
    "system_map",
    {
      title: "Map the whole workspace",
      description:
        "How the notebooks fit together: what triggers each one, which ones call which, and what contract each exposes. Read this before changing a notebook — it is how you find out who depends on it. Call edges are read out of the code, so a call whose target is computed at run time is reported as such rather than hidden.",
      inputSchema: {},
    },
    async () => reply(renderNotebookMap(buildNotebookMap(await notebooksService.getAllDocuments())))
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
        "One run in full: per cell, the code that actually ran, its output, its logs and its error. This is how you debug a failure you did not witness — a cron that failed at 3am left this behind. Large values are abridged to their size and a sample, so a run over a lot of data is still readable here.",
      inputSchema: {
        run: z.string().describe("A run id, or a notebook name/id to take its latest run."),
      },
    },
    async ({ run }) => {
      const direct = await notebookRunsService.getById(run.trim());
      if (direct) return asJson(abridge(direct));

      const resolved = await resolveNotebook(run);
      if ("error" in resolved) {
        return refuse(`No run and no notebook matches "${run}".`);
      }
      const latest = await notebookRunsService.getLatestForNotebook(resolved.record.id);
      return latest ? asJson(abridge(latest)) : reply(`"${resolved.record.name}" has never run.`);
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
          "BEFORE WRITING: call `system_map` and check whether a deployed notebook already does this. Reuse beats rewriting, and a workspace fills up with near-duplicates fast.",
          "NEVER write a notebook for one particular value. A notebook that answers \"convert 23.3 USD\" is a notebook that will be wrong tomorrow — declare `amount` as an input and answer every version of the question.",
          "",
          "WHEN AN INPUT HAS A FIXED SET OF VALUES, declare `options` instead of describing them in prose. The page renders a dropdown, the tool schema becomes an enum, and a wrong value is refused before the run starts — none of which happens if the list only exists in a sentence. Add `multiple: true` to accept several. Write `default` in the field, never as \"Default: …\" inside `description`.",
          "For an input someone might type a sentence into — a note, a reason, a prompt — add `multiline: true`. It is still a `string`; only the box changes.",
          "",
          "  inputs:",
          "    - name: direction",
          "      type: string",
          "      options: [usd_to_idr, idr_to_usd]",
          "      default: usd_to_idr",
          "",
          "OUTPUTS DECIDE HOW THE PAGE LOOKS. An output is a bare name, or a mapping that also says how to show it — `render` is one of auto, text, markdown, table, chart, bar, line, area, pie, image, file, json:",
          "",
          "  outputs:",
          "    - total",
          "    - name: months",
          "      render: table",
          "    - name: profit",
          "      render: chart",
          "      x: month",
          "",
          "`auto` is the default and reads the value's shape: an array of objects is already a table, a string with newlines is markdown, a data: URI is an image. So return rows and you get a table for free; `render` is for overruling the guess, usually to ask for a chart.",
          "The four chart forms are four questions, not four skins: `bar` = which is bigger, `line` = how it changed over time, `area` = how a total filled up, `pie` = what share of a whole. A pie reads one measure and needs 6 rows or fewer — group first, or it is drawn as bars.",
          "ONE OUTPUT PER CELL. The page reveals each output the moment its cell finishes, so a cell that returns six of them makes all six wait for the slowest thing in it. Split the work; later cells read earlier values through `inputs`, so nothing is computed twice. Outputs that do not need each other belong in parallel lanes.",
          "NEVER draw a chart or a table out of text. No ASCII bars, no box-drawing characters, no pipe-and-dash tables — the page renders real ones from the data. Return the rows.",
          "",
          "BUTTONS: a page always has Run. `actions` adds others — `rerun` (run this again), `run` (run another deployed notebook, reporting only whether it worked), `link` (go to a URL). Three kinds, and no more.",
          "A `run` button asks for whatever its target declares and the button does not fix, so NEVER add an input to this notebook just to feed a button — declare it on the notebook that reads it.",
          "",
          "  actions:",
          "    - label: Email the report",
          "      do: run",
          "      notebook: send-report",
          "",
          "Read the `zaa://conventions` resource for the full format, the renderer rules and a complete worked example.",
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
          "",
          "YOU DO NOT HAVE TO REPRODUCE `layout` OR `actions`. Leave them out entirely and the stored ones are kept — they are arranged by a person in the browser, and a rewrite that forgets them would delete their work. Write them only when you mean to change them; `actions: []` clears every button. Everything else you omit *is* removed, so keep writing `inputs`, `outputs`, `secrets` and `triggers` in full.",
          "Saving changes the draft. Triggers run the version a person deployed, so nothing you write here reaches production on its own, and it does not become a callable tool until then either.",
        ].join("\n"),
      inputSchema: {
        text: z.string().describe("The whole notebook in its text form."),
        notebook: z
          .string()
          .optional()
          .describe("Name or id of an existing notebook to update, when the text has no `id`."),
      },
    },
    async ({ text, notebook }) => {
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

      const saved = await notebooksService.save(document, deps.writer);

      const lines = [
        `${existing ? "Updated" : "Created"} **${saved.name}** \`${saved.id}\``,
        `Contract: ${contractLine(document)}`,
      ];
      for (const trigger of triggerLines(document)) lines.push(`Trigger: ${trigger}`);

      // Said out loud, because a silent carry-over is the same shape of surprise as a
      // silent delete — and because an agent that sees this once stops trying to
      // reproduce a twelve-column grid it has no way to get right.
      const kept: string[] = [];
      if (before?.layout?.length && !mentionsKey(text, "layout")) {
        kept.push(`the ${before.layout.length}-tile arrangement`);
      }
      if (before?.actions?.length && !mentionsKey(text, "actions")) {
        kept.push(`${before.actions.length} button(s)`);
      }
      if (kept.length > 0) {
        lines.push(`Kept from the stored version: ${kept.join(" and ")} — you did not mention them.`);
      }

      // What an agent most needs to know after writing: this is not live. Triggers run
      // the deployed version, and deploying is a person's decision.
      const deployState = await notebooksService.getDeployState(saved.id);
      if (deployState?.isDeployed) {
        lines.push(
          `Deployed: ${deployState.deployedAt} by ${deployState.deployedBy}` +
            (deployState.hasUndeployedChanges
              ? " — your change is in the draft and is NOT what triggers run yet."
              : "")
        );
      } else {
        lines.push(
          "Not deployed — its triggers will not fire and it is not callable as a tool until someone deploys it."
        );
      }

      // A person has to deploy this, and telling them where it is costs one line.
      lines.push(`Open it at ${editorUrl(saved.id)} to review and deploy.`);

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
