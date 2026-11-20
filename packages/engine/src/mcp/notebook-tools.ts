import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { notebooksService, type NotebookRecord } from "../services/notebooks.service.js";
import { notebookRunsService } from "../services/notebook-runs.service.js";
import { notebookAccessService } from "../services/notebook-access.service.js";
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
import { renderOutline, renderCell, findCell } from "../core/notebook-outline.js";
import { renderDiff } from "../core/notebook-diff.js";
import {
  SETUP_KEYS,
  applySetupEdit,
  layoutProblems,
  parseSetupValue,
  renderSetup,
  SetupEditError,
} from "../core/notebook-setup.js";
import { applyCellEdit, CellEditError, type CellEdit } from "../core/notebook-edit.js";
import { pythonSyntaxProblem, stripCodeFence } from "../core/cell-code.js";
import { outputNames } from "../core/notebook-outputs.js";
import { abridge, wasAbridged } from "./abridge.js";
import type { NotebookPlan } from "../core/notebook-compiler.js";
import type { RunEventSink } from "../core/run-emitter.js";
import type { AgentScope } from "../services/agent-tokens.service.js";
import type { NotebookJson, NotebookStep } from "@zaa-tool/shared";

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
  /**
   * The account the token belongs to. The tools act as this person: they list, read, run and
   * write what this person could in the browser, and the access module is asked on their
   * behalf for every notebook they touch.
   */
  userId: string;
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
  // Their messages are the whole explanation, and already name what would break.
  if (err instanceof CellEditError || err instanceof SetupEditError) return refuse(err.message);
  return refuse((err as Error).message ?? String(err));
}

/**
 * The one gate every write goes through.
 *
 * `notebook_write` used to parse and compile while `notebook_edit_cell` saved directly,
 * and that difference is how a cell containing a markdown fence got stored, passed the
 * compiler and was reported as a success. So a document built by *any* tool is written
 * out and read back through the same parser a hand-written one goes through, then
 * compiled — and only then saved.
 *
 * The round trip is not ceremony. It is what applies the front-matter rules: a `packages`
 * list a JavaScript cell may not have, an action pointing at nothing, an `accept` on
 * something that is not a file. None of that lives in the compiler.
 */
function judgeDocument(
  edited: NotebookJson,
  previous: NotebookJson
): { document: NotebookJson } | { error: ToolReply } {
  let reparsed: NotebookJson;
  try {
    reparsed = fromMarkdown(toMarkdown(edited), { id: edited.id, previous });
  } catch (err: unknown) {
    return { error: explain(err) };
  }

  try {
    compileNotebook(reparsed);
  } catch (err: unknown) {
    const issues = err instanceof NotebookCompileError ? err.issues : [(err as Error).message];
    return {
      error: refuse(
        ["Nothing was changed — that does not compile:", ...issues.map((issue) => `  - ${issue}`)].join("\n")
      ),
    };
  }

  return { document: reparsed };
}

/**
 * Whether this rewrite could have been a smaller call, and which one.
 *
 * Named at the moment it happens rather than in a description, because an agent that has
 * a working call does not go back and read the description. The saving is real: a
 * twenty-cell notebook is thousands of tokens to send back, and nineteen of those cells
 * were reproduced from memory to change the twentieth.
 */
function cheaperThanRewrite(before: NotebookJson, after: NotebookJson): string | null {
  // Compared on the text itself. An earlier version compared the outline — what each cell
  // reads and writes — and so could not see a cell whose body changed while its shape did
  // not, which is most edits.
  const was = cellTexts(before);
  const now = cellTexts(after);

  const changedCells = [...now.entries()].filter(([id, text]) => was.get(id) !== text);
  if (changedCells.length === 0 && was.size !== now.size) return null;

  const changedKeys = SETUP_KEYS.filter(
    (key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)
  );

  if (changedCells.length === 0 && changedKeys.length === 1) {
    return `Next time: only \`${changedKeys[0]}\` changed, so \`notebook_edit_setup(notebook, key: "${changedKeys[0]}", value: …)\` would have done this without sending a single cell.`;
  }

  if (changedCells.length === 1 && changedKeys.length === 0) {
    return `Next time: only one cell changed, so \`notebook_edit_cell(notebook, action: "replace", cell: "${changedCells[0][0]}", code: …)\` would have done this without resending the rest.`;
  }

  return null;
}

/** Each cell's note and code as one string, keyed by id — the thing an edit changes. */
function cellTexts(document: NotebookJson): Map<string, string> {
  const texts = new Map<string, string>();
  const walk = (steps: NotebookStep[] | undefined): void => {
    for (const step of steps ?? []) {
      if (step.kind === "parallel") {
        for (const lane of step.lanes ?? []) walk(lane.steps);
        continue;
      }
      texts.set(step.id, `${step.note ?? ""}\u0000${step.code ?? ""}`);
    }
  };
  walk(document.steps);
  return texts;
}

/** The first `count` lines, with a marker when there is more. */
function firstLines(code: string, count: number): string[] {
  const lines = code.split("\n");
  return lines.length <= count ? lines : [...lines.slice(0, count), `… ${lines.length - count} more line(s)`];
}

/**
 * The code that ended up in the document, for the cell this edit touched.
 *
 * An insert or an append has a new id nobody has seen yet, so it is found by position:
 * whichever cell is not one that was there before. Cheap, and it is only for a reply.
 */
function storedCodeOf(document: NotebookJson, cell: string | undefined, action: string): string {
  const cells: { id: string; code?: string }[] = [];
  const walk = (steps: NotebookStep[] | undefined): void => {
    for (const step of steps ?? []) {
      if (step.kind === "parallel") {
        for (const lane of step.lanes ?? []) walk(lane.steps);
        continue;
      }
      cells.push(step);
    }
  };
  walk(document.steps);

  if (action === "replace") return cells.find((one) => one.id === cell)?.code ?? "";
  if (action === "append") return cells[cells.length - 1]?.code ?? "";

  const anchor = cells.findIndex((one) => one.id === cell);
  if (anchor === -1) return "";
  const inserted = action === "insert_before" ? cells[anchor - 1] : cells[anchor + 1];
  return inserted?.code ?? "";
}

/**
 * A notebook by name or id, among the ones `userId` may open.
 *
 * Everything an agent does to a notebook starts here, and a notebook outside the set is "no
 * notebook matches" — word for word what a name that does not exist gets, so an agent cannot
 * use the difference to find what else is on the installation.
 */
async function resolveNotebook(
  reference: string,
  userId: string
): Promise<{ record: NotebookRecord } | { error: ToolReply }> {
  const found = await notebooksService.findByIdOrName(
    reference.trim(),
    await notebookAccessService.editableIds(userId)
  );
  if (found === null) return { error: refuse(`No notebook matches "${reference}".`) };
  if (found === "ambiguous") {
    return {
      error: refuse(`More than one notebook is named "${reference}" — use its id instead.`),
    };
  }
  return { record: found };
}

function verifyEtag(
  record: NotebookRecord,
  expected_updated_at?: string
): ToolReply | null {
  if (!expected_updated_at) return null;
  const currentIso = new Date(record.updated_at).toISOString();
  let expectedIso: string;
  try {
    expectedIso = new Date(expected_updated_at).toISOString();
  } catch {
    expectedIso = expected_updated_at;
  }
  if (
    currentIso !== expectedIso &&
    new Date(record.updated_at).getTime() !== new Date(expected_updated_at).getTime()
  ) {
    return refuse(
      `Notebook "${record.name}" was modified at ${currentIso}. Expected updated_at "${expected_updated_at}" does not match. Write refused.`
    );
  }
  return null;
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
      const summaries = await notebooksService.getSummary(
        await notebookAccessService.editableIds(deps.userId)
      );
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
        [
          "How the notebooks fit together: what triggers each one, which ones call which, and what contract each exposes. Read this before changing a notebook — it is how you find out who depends on it.",
          "",
          "Grouped by how each notebook is reached. **On its own** is what a schedule or a webhook starts; **called by others** is what exists to be reused, which is where to look before writing anything new; **neither** is a draft or something a person opens by hand.",
          "",
          "`about` narrows it to the notebooks whose name, contract or trigger mentions a word. On a workspace with fifty notebooks, reading all of them to find the two that touch invoices is the expensive habit this avoids.",
          "",
          "Call edges are read out of the code, so a call whose target is computed at run time is reported as such rather than hidden.",
        ].join("\n"),
      inputSchema: {
        about: z
          .string()
          .optional()
          .describe("Only notebooks mentioning this word in their name, contract or triggers."),
      },
    },
    async ({ about }) =>
      reply(
        renderNotebookMap(
          buildNotebookMap(
            await notebooksService.getAllDocuments(await notebookAccessService.editableIds(deps.userId))
          ),
          { about, grouped: true }
        )
      )
  );

  server.registerTool(
    "notebook_read",
    {
      title: "Read a notebook",
      description:
        [
          "The notebook, whole or in outline.",
          "",
          "`part: outline` is one line per cell — its id, what it reads off `inputs`, and what it writes back — and no code at all. Start here on anything you did not just write. A twenty-cell notebook is thousands of tokens in full and a few hundred in outline, and the question you usually have is which cell to touch.",
          "Then read the full text only if you need the code, and change it with `notebook_edit_cell` rather than sending the whole document back.",
          "",
          "`part: cell` with `cell: <id or position>` is **one cell's code**, plus the names that are in scope where it sits and the names it must keep writing. That last part matters: reading one cell tells you its code and nothing about what surrounds it, so without it you would be guessing at `inputs.…` and having the edit refused.",
          "",
          "`part: setup` is the front matter alone — inputs, outputs, layout, triggers, secrets, packages, actions — with the layout drawn as a grid rather than dumped as coordinates. Change any of it with `notebook_edit_setup`. **Moving a tile does not need the code.**",
          "",
          "`part: full` is the whole text form. Edit it and send it back with `notebook_write` only when you are rewriting the notebook rather than changing part of it.",
        ].join("\n"),
      inputSchema: {
        notebook: z.string().describe("The notebook's name or id."),
        part: z
          .enum(["full", "outline", "cell", "setup"])
          .optional()
          .describe(
            "`outline` (the default) one line per cell, no code; `cell` one cell with its scope; `setup` front matter only; `full` the whole text."
          ),
        cell: z
          .string()
          .optional()
          .describe("Required for `part: cell` — the cell id, or its 1-based position."),
      },
    },
    async ({ notebook, part, cell }) => {
      const resolved = await resolveNotebook(notebook, deps.userId);
      if ("error" in resolved) return resolved.error;
      const document = notebooksService.parseDocument(resolved.record);
      const updatedAt = new Date(resolved.record.updated_at).toISOString();

      const requestedPart = part ?? "outline";

      if (requestedPart === "outline") return reply(`${renderOutline(document)}\n\nupdated_at: ${updatedAt}`);
      if (requestedPart === "setup") return reply(`${renderSetup(document)}\n\nupdated_at: ${updatedAt}`);

      if (requestedPart === "cell") {
        if (!cell) return refuse("`part: cell` needs `cell` — an id, or a 1-based position.");
        const rendered = renderCell(document, cell);
        if (!rendered) {
          return refuse(
            `No cell "${cell}" in **${document.name}**. Read the outline to see the ids.`
          );
        }
        return reply(`${rendered}\n\nupdated_at: ${updatedAt}`);
      }

      const fullMd = toMarkdown(document);
      const fullWithEtag = fullMd.replace(/^---\n/, `---\nupdated_at: "${updatedAt}"\n`);
      return reply(fullWithEtag);
    }
  );

  server.registerTool(
    "notebook_diff",
    {
      title: "What differs between the draft and production",
      description:
        "Which cells and which declarations changed since this notebook was last deployed. Read it before asking someone to deploy, and before 'fixing production' — the draft you are editing may already contain half of what you are about to add.",
      inputSchema: { notebook: z.string().describe("The notebook's name or id.") },
    },
    async ({ notebook }) => {
      const resolved = await resolveNotebook(notebook, deps.userId);
      if ("error" in resolved) return resolved.error;

      const draft = notebooksService.parseDocument(resolved.record);
      const deployed = await notebooksService.getDeployedDocument(resolved.record.id);
      if (!deployed) {
        return reply(
          `**${draft.name}** has never been deployed, so everything in it is a draft.`
        );
      }
      return reply(renderDiff(deployed, draft));
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
      const resolved = await resolveNotebook(notebook, deps.userId);
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
      // A run id answers only if this person could read that run in the browser: every run
      // of a notebook they work on, and for a page they merely use, their own.
      const direct = await notebookRunsService.getById(run.trim());
      if (direct && (await notebookAccessService.canSeeRun(deps.userId, direct))) {
        return asJson(abridge(direct));
      }

      const resolved = await resolveNotebook(run, deps.userId);
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
      const rows = (await secretsService.getAll(deps.userId)) as { key: string; is_secret: boolean }[];
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
      const resolved = await resolveNotebook(notebook, deps.userId);
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
          startedBy: deps.userId,
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
      const resolved = await resolveNotebook(notebook, deps.userId);
      if ("error" in resolved) return resolved.error;

      try {
        const started = await notebookExecutionService.start(resolved.record.id, deps.publishRunEvent, {
          args,
          triggerSource: "manual",
          startedBy: deps.userId,
        });
        return await awaitRun(started, timeoutSeconds);
      } catch (err: unknown) {
        return explain(err);
      }
    }
  );

  if (scope !== "author") return;

  server.registerTool(
    "notebook_edit_setup",
    {
      title: "Change one thing a notebook declares",
      description:
        [
          "Replaces one key of the front matter — `inputs`, `outputs`, `layout`, `triggers`, `secrets`, `packages`, `actions`, `name`, `runtime` — and touches no cell at all.",
          "",
          "USE THIS INSTEAD OF `notebook_write` FOR ANYTHING DECLARED. Adding an input, moving a tile, or changing a schedule used to mean sending the whole document back, which meant reproducing every cell from memory. Cells came back subtly different that way, and arrangements disappeared.",
          "",
          "`value` is JSON. A list replaces the whole list, and `[]` clears it:",
          "",
          '  key: "inputs", value: \'[{"name":"pair","type":"string","default":"USD_IDR"}]\'',
          '  key: "layout", value: \'[{"i":"total","x":0,"y":0,"w":6,"h":4}]\'',
          '  key: "actions", value: \'[]\'   ← removes every button',
          "",
          "Read `notebook_read part: setup` first — it draws the layout as a grid, which is the only readable form of it. The result is judged by the same parser `notebook_write` uses, so a bad declaration is refused here and **nothing is saved**.",
        ].join("\n"),
      inputSchema: {
        notebook: z.string().describe("The notebook's name or id."),
        key: z.enum(SETUP_KEYS).describe("Which declaration to replace."),
        value: z.string().describe("The new value, as JSON. A list replaces the whole list."),
        expected_updated_at: z
          .string()
          .optional()
          .describe("If provided, edit is refused if notebook was modified since this timestamp."),
      },
    },
    async ({ notebook, key, value, expected_updated_at }) => {
      const resolved = await resolveNotebook(notebook, deps.userId);
      if ("error" in resolved) return resolved.error;

      const etagError = verifyEtag(resolved.record, expected_updated_at);
      if (etagError) return etagError;

      const document = notebooksService.parseDocument(resolved.record);
      let edited: NotebookJson;
      try {
        const parsed = parseSetupValue(key, value);
        if (key === "layout") {
          const issues = layoutProblems(parsed);
          if (issues.length > 0) return refuse(issues.map((issue) => `  - ${issue}`).join("\n"));
        }
        edited = applySetupEdit(document, key, parsed);
      } catch (err: unknown) {
        return explain(err);
      }

      const judged = judgeDocument(edited, document);
      if ("error" in judged) return judged.error;

      const saved = await notebooksService.save(judged.document, deps.writer, deps.userId);


      return reply(
        [
          `\`${key}\` replaced on **${saved.name}** \`${saved.id}\`. No cell was touched.`,
          "",
          renderSetup(judged.document),
        ].join("\n")
      );
    }
  );

  server.registerTool(
    "notebook_edit_cell",
    {
      title: "Change one cell",
      description:
        [
          "Replaces, inserts, appends or deletes a single cell, leaving every other cell exactly as it is.",
          "",
          "USE THIS INSTEAD OF `notebook_write` WHENEVER YOU ARE CHANGING PART OF A NOTEBOOK. Rewriting the whole document to alter one cell means reproducing every other cell from memory, and what gets lost that way is real: arrangements, buttons, and cells whose code came back subtly different from what was stored.",
          "",
          "Get the cell from `notebook_read` with `part: outline`, then read just that one with `part: cell` — it comes with the names in scope there, which is what you would otherwise be guessing at.",
          "",
          "SEND `code` AS CODE, not as a markdown block. A fence around the whole thing is unwrapped for you, but nothing else is guessed at: the code has to parse, and an edit that does not is refused with the parser's reason and **nothing is saved**. The reply shows the first lines as they were actually stored, so you can see what arrived.",
          "",
          "  code: \"const rate = await fetch(url).then(r => r.json());\\nreturn { rate };\"",
          "",
          "It refuses an edit that would leave a later cell reading a name nothing writes any more — deleting the cell that produces `rows` while a cell below still reads `inputs.rows` is refused here rather than failing halfway through a run at 3am.",
          "",
          "`dry_run: true` answers with what the edit would do and saves nothing. Use it when you are unsure rather than editing and undoing.",
          "",
          "Like `notebook_write`, this changes the draft. Nothing reaches production until a person deploys it.",
        ].join("\n"),
      inputSchema: {
        notebook: z.string().describe("The notebook's name or id."),
        action: z
          .enum(["replace", "insert_before", "insert_after", "append", "delete", "add_lane", "remove_lane"])
          .describe("What to do. `append` puts a new cell at the end and needs no `cell`."),
        cell: z
          .string()
          .optional()
          .describe("The cell id, or its 1-based position. Required for everything except `append`."),
        code: z.string().optional().describe("The cell's code. Required except for `delete`, `add_lane`, `remove_lane`."),
        note: z
          .string()
          .optional()
          .describe("The prose above the code. On `replace`, leaving it out keeps what is there."),
        label: z.string().optional().describe("Optional label for `add_lane`."),
        force: z.boolean().optional().describe("Required to remove a non-empty lane for `remove_lane`."),
        expected_updated_at: z
          .string()
          .optional()
          .describe("If provided, edit is refused if notebook was modified since this timestamp."),
        dry_run: z
          .boolean()
          .optional()
          .describe("Report what would happen and save nothing."),
      },
    },
    async ({ notebook, action, cell, code, note, dry_run, label, force, expected_updated_at }) => {
      const resolved = await resolveNotebook(notebook, deps.userId);
      if ("error" in resolved) return resolved.error;

      const etagError = verifyEtag(resolved.record, expected_updated_at);
      if (etagError) return etagError;

      if (action !== "append" && !cell) {
        return refuse(`\`${action}\` needs a \`cell\`. Read the outline to see them.`);
      }
      // `replace` is the one that may carry only a note: changing the prose above a cell
      // is a real edit, and demanding the code back for it would mean resending code
      // nobody meant to touch. Everything that creates a cell needs one.
      if (action === "replace" && code === undefined && note === undefined) {
        return refuse("`replace` needs `code`, `note`, or both.");
      }
      if ((action === "insert_before" || action === "insert_after" || action === "append") && code === undefined) {
        return refuse(`\`${action}\` needs \`code\`.`);
      }

      const document = notebooksService.parseDocument(resolved.record);

      // A position is accepted here for the same reason `notebook_run_cell` accepts one:
      // two tools that address the same thing two different ways is a trap to be found
      // rather than a rule to be read.
      const targetCell = cell ? findCell(document, cell) : undefined;
      if (cell && !targetCell) {
        return refuse(`No cell "${cell}" in **${document.name}**. Read the outline to see the ids.`);
      }

      let edited: NotebookJson;
      try {
        edited = applyCellEdit(document, { action, cell: targetCell, code, note, label, force } as CellEdit);
      } catch (err: unknown) {
        return explain(err);
      }

      // Python's syntax needs Python, so it cannot happen inside `applyCellEdit`, which is
      // synchronous. Same refusal, same "nothing is saved".
      if (document.runtime === "python" && code !== undefined) {
        const problem = await pythonSyntaxProblem(stripCodeFence(code));
        if (problem) return refuse(problem);
      }

      // Judged before it is stored, not after. Saving first and reporting the compile
      // afterwards is how a broken cell ended up in a notebook with "Compiles." printed
      // underneath it — the message was about a document that had already been written.
      const judged = judgeDocument(edited, document);
      if ("error" in judged) return judged.error;
      edited = judged.document;

      if (dry_run) {
        return reply(
          [
            `Nothing was saved. This is what \`${action}\` would do to **${document.name}**:`,
            "",
            renderOutline(edited),
          ].join("\n")
        );
      }

      const saved = await notebooksService.save(edited, deps.writer, deps.userId);

      const lines = [
        `${action} on **${saved.name}** \`${saved.id}\``,
        "",
        renderOutline(edited),
      ];

      // The code as it was actually stored, so a fence that was unwrapped is visible
      // rather than a silent difference between what was sent and what is there.
      if (action !== "delete" && code !== undefined) {
        const stored = firstLines(storedCodeOf(edited, cell, action), 3);
        lines.push("", "Stored:", ...stored.map((line) => `  ${line}`));
      }

      const deployState = await notebooksService.getDeployState(saved.id);
      if (deployState?.isDeployed && deployState.hasUndeployedChanges) {
        lines.push("", "This is the draft. Triggers still run the deployed version.");
      }

      return reply(lines.join("\n"));
    }
  );

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
        expected_updated_at: z
          .string()
          .optional()
          .describe("If provided, write is refused if notebook was modified since this timestamp."),
      },
    },
    async ({ text, notebook, expected_updated_at }) => {
      let fallbackId: string | undefined;
      if (notebook) {
        const resolved = await resolveNotebook(notebook, deps.userId);
        if ("error" in resolved) return resolved.error;
        const etagError = verifyEtag(resolved.record, expected_updated_at);
        if (etagError) return etagError;
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
      // An id that is somebody else's is "no such notebook", as it is over REST: writing to
      // it would overwrite their work, and refusing differently would confirm it is there.
      if (existing && !(await notebookAccessService.canEdit(deps.userId, existing.id))) {
        return refuse(`No notebook matches "${document.id}".`);
      }
      if (existing) {
        const etagError = verifyEtag(existing, expected_updated_at);
        if (etagError) return etagError;
      }
      const before = existing ? notebooksService.parseDocument(existing) : null;
      if (before) document = fromMarkdown(text, { id: fallbackId, previous: before });

      const saved = await notebooksService.save(document, deps.writer, deps.userId);

      const lines = [
        `${existing ? "Updated" : "Created"} **${saved.name}** \`${saved.id}\``,
        `Contract: ${contractLine(document)}`,
      ];
      for (const trigger of triggerLines(document)) lines.push(`Trigger: ${trigger}`);

      /**
       * The nudge.
       *
       * A rewrite that changed one cell, or nothing but front matter, is the habit this
       * whole set of tools exists to replace — and an agent will not read the description
       * again once it has a working call. Being told at the moment it happens, with the
       * arguments it should have used, is the only version of this that lands.
       */
      if (before) {
        const smaller = cheaperThanRewrite(before, document);
        if (smaller) lines.push("", smaller);
      }

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
      const resolved = await resolveNotebook(notebook, deps.userId);
      if ("error" in resolved) return resolved.error;

      // An editor may change the notebook but not end it: that is the owner's alone.
      if (!(await notebookAccessService.isOwner(deps.userId, resolved.record.id))) {
        return refuse(`Only the owner can delete "${resolved.record.name}".`);
      }

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
