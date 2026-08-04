import { Request, Response } from "express";
import { notebooksService } from "../services/notebooks.service.js";
import { notebookFilesService } from "../services/notebook-files.service.js";
import { buildNotebookMap } from "../core/notebook-map.js";
import { outputSpecs } from "../core/notebook-outputs.js";
import { actionSpecs } from "../core/notebook-actions.js";
import { notebookSharesService } from "../services/notebook-shares.service.js";
import { notifyCatalogChanged } from "../mcp/notebook-catalog.js";
import { notebookRunsService } from "../services/notebook-runs.service.js";
import {
  notebookExecutionService,
  NotebookNotFoundError,
  CellNotFoundError,
  NotebookNotDeployedError,
  TooManyRunsError,
} from "../services/notebook-execution.service.js";
import { NotebookCompileError } from "../core/notebook-compiler.js";
import { ContractError } from "../core/notebook-contract.js";
import type { RunEventSink } from "../core/run-emitter.js";
import type {
  NotebookAction,
  NotebookJson,
  NotebookPage,
  NotebookPageAction,
} from "@zaa-tool/shared";

/**
 * Every note in the notebook, in the order they are written.
 *
 * A notebook whose cells are all prose is a document; this is that document. Cells with
 * no note contribute nothing rather than a gap — the code is not the reading.
 */
function notesOf(document: NotebookJson): string[] {
  const notes: string[] = [];
  for (const step of document.steps ?? []) {
    if (step.kind === "cell" && step.note?.trim()) notes.push(step.note.trim());
  }
  return notes;
}

/** A notebook's own first sentence, which is the best description anyone will write. */
function firstNoteOf(document: NotebookJson): string {
  for (const step of document.steps ?? []) {
    if (step.kind === "cell" && step.note?.trim()) {
      const line = step.note
        .split("\n")
        .map((text) => text.replace(/^#+\s*/, "").trim())
        .find((text) => text.length > 0);
      if (line) return line;
    }
  }
  return "";
}

/**
 * What pressing a `run` button will still need answering.
 *
 * The target already declares its inputs, so nothing here is new — it is the same form
 * its own page renders, carried to the button that calls it. Whatever `args` fixes is
 * left out, because a value the button decided is not a question.
 *
 * Undeployed or missing targets contribute nothing rather than failing the page: the
 * button will say so when pressed, and one broken action should not blank an app list.
 */
async function withQuestions(actions: NotebookAction[]): Promise<NotebookPageAction[]> {
  const asked: NotebookPageAction[] = [];

  for (const action of actions) {
    if (action.do !== "run" || !action.notebook) {
      asked.push(action);
      continue;
    }

    const target = await notebooksService.findByIdOrName(action.notebook);
    if (target === null || target === "ambiguous") {
      asked.push(action);
      continue;
    }

    const document = await notebooksService.getDeployedDocument(target.id);
    const fixed = new Set(Object.keys(action.args ?? {}));
    const asks = (document?.inputs ?? []).filter((input) => !fixed.has(input.name));

    asked.push(asks.length > 0 ? { ...action, asks } : action);
  }

  return asked;
}

function respondWithError(res: Response, err: unknown) {
  if (err instanceof NotebookNotFoundError || err instanceof CellNotFoundError) {
    return res.status(404).json({ error: err.message });
  }
  // The arguments were wrong, not the notebook — the caller can fix this one.
  if (err instanceof ContractError) {
    return res.status(400).json({ error: err.message, issues: err.issues });
  }
  if (err instanceof NotebookCompileError) {
    return res.status(400).json({ error: err.message, issues: err.issues });
  }
  if (err instanceof TooManyRunsError) {
    return res.status(429).json({ error: err.message });
  }
  // Not a bad request and not a missing one: the notebook exists, but nobody has said
  // this version may run unattended.
  if (err instanceof NotebookNotDeployedError) {
    return res.status(409).json({ error: err.message });
  }
  return res.status(500).json({ error: (err as Error).message });
}

export class NotebooksController {
  constructor(private readonly publishRunEvent: RunEventSink) {}

  list = async (_req: Request, res: Response) => {
    try {
      res.json(await notebooksService.getSummary());
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /** The system map. Computed on request — there is nothing stored to go stale. */
  map = async (_req: Request, res: Response) => {
    try {
      res.json(buildNotebookMap(await notebooksService.getAllDocuments()));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /**
   * Every deployed notebook, as a page.
   *
   * A page shows what its notebook has. Outputs if it has them; if it has none, its cell
   * notes *are* the page — which is what makes a notebook of nothing but prose a thing you
   * can deploy and send someone a link to. It used to be dropped from this list entirely,
   * so the only way to read a written notebook was to open the editor.
   *
   * A notebook with neither notes nor a contract is still nothing to render, and still
   * skipped: there is already a Run button in the editor.
   */
  pages = async (_req: Request, res: Response) => {
    try {
      const pages: NotebookPage[] = [];

      for (const summary of await notebooksService.getSummary()) {
        const document = await notebooksService.getDeployedDocument(summary.id);
        if (!document) continue;

        const hasContract =
          (document.inputs?.length ?? 0) > 0 || (document.outputs?.length ?? 0) > 0;
        // Only when there is nothing else to show, or every existing page would suddenly
        // grow a wall of the author's working notes above its results.
        const notes = hasContract ? [] : notesOf(document);
        if (!hasContract && notes.length === 0) continue;

        pages.push({
          notes,
          id: summary.id,
          name: document.name,
          description: firstNoteOf(document),
          inputs: document.inputs ?? [],
          // Normalised here rather than in the browser: a page has to decide how to show
          // each value, and it should not also have to know there are two ways to write
          // an output down.
          outputs: outputSpecs(document.outputs),
          // Only tiles for names the contract still declares. An output removed since
          // the arrangement was made leaves no orphan behind.
          layout: (document.layout ?? []).filter((item) =>
            outputSpecs(document.outputs).some((output) => output.name === item.i)
          ),
          actions: await withQuestions(actionSpecs(document.actions)),
        });
      }

      res.json(pages);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  getById = async (req: Request, res: Response) => {
    try {
      const record = await notebooksService.getById(String(req.params.id));
      if (!record) return res.status(404).json({ error: "Notebook not found" });
      res.json(notebooksService.parseDocument(record));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  save = async (req: Request, res: Response) => {
    try {
      if (!req.body || !Array.isArray(req.body.steps)) {
        return res.status(400).json({ error: "Invalid notebook: missing steps" });
      }
      const user = (req as Request & { user?: { username?: string } }).user;
      res.json(await notebooksService.save(req.body, user?.username ?? "unknown"));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /** What production is running, and whether the draft has moved on since. */
  deployState = async (req: Request, res: Response) => {
    try {
      const state = await notebooksService.getDeployState(String(req.params.id));
      if (!state) return res.status(404).json({ error: "Notebook not found" });
      res.json(state);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /** The version production is running, so the editor can show what has changed. */
  deployedDocument = async (req: Request, res: Response) => {
    try {
      const document = await notebooksService.getDeployedDocument(String(req.params.id));
      if (!document) return res.status(404).json({ error: "Nothing deployed" });
      res.json(document);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  deploy = async (req: Request, res: Response) => {
    try {
      // Named on the version, because "who decided this may run unattended" is the
      // question a deploy record exists to answer.
      const user = (req as Request & { user?: { username?: string } }).user;
      const result = await notebooksService.deploy(
        String(req.params.id),
        user?.username ?? "unknown"
      );
      if (!result) return res.status(404).json({ error: "Notebook not found" });

      // Deploying may have added or changed a tool, and an agent connected an hour ago
      // should not have to reconnect to find out.
      notifyCatalogChanged();
      res.json(result);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /**
   * Takes a notebook out of production.
   *
   * Separate from deleting: the draft, the history and the versions all survive. What
   * stops is everything that was running unattended — the agent tool, the page, and the
   * triggers, which start answering 409 rather than failing silently.
   */
  undeploy = async (req: Request, res: Response) => {
    try {
      const result = await notebooksService.undeploy(String(req.params.id));
      if (!result) return res.status(404).json({ error: "Notebook not found" });

      // An agent holding a session must not keep offering a tool that no longer runs.
      notifyCatalogChanged();
      res.json(result);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /**
   * Presses a `run` button on a page.
   *
   * Resolved from the *deployed* document, by index into the actions it declares — the
   * browser names a position, never a notebook. That is what stops a page from being a
   * way to run anything you can name: if it is not on the button, it cannot be pressed.
   *
   * Fire and forget by design. The reply says whether the other notebook succeeded, and
   * nothing it returned: a page showing two notebooks' values at once has no way to say
   * which came from where, and that ambiguity is worse than the missing feature.
   */
  runAction = async (req: Request, res: Response) => {
    try {
      const document = await notebooksService.getDeployedDocument(String(req.params.id));
      if (!document) return res.status(409).json({ error: "This page is not deployed." });

      const index = Number(req.params.index);
      const action = actionSpecs(document.actions)[index];
      if (!action) return res.status(404).json({ error: "No such action on this page." });
      if (action.do !== "run" || !action.notebook) {
        return res.status(400).json({ error: `"${action.label}" is not a run action.` });
      }

      const target = await notebooksService.findByIdOrName(action.notebook);
      if (target === null) {
        return res.status(404).json({ error: `"${action.notebook}" does not exist.` });
      }
      if (target === "ambiguous") {
        return res
          .status(409)
          .json({ error: `More than one notebook is named "${action.notebook}".` });
      }

      // Only what the target actually declares is passed on, so a page cannot smuggle
      // fields into another notebook's arguments. What the button fixes wins over what
      // the person typed — that is what "fixed arguments" means.
      const deployedTarget = await notebooksService.getDeployedDocument(target.id);
      if (!deployedTarget) {
        return res.status(409).json({ error: `"${target.name}" is not deployed.` });
      }
      const declared = new Set((deployedTarget.inputs ?? []).map((input) => input.name));
      const passed = Object.fromEntries(
        Object.entries((req.body?.args ?? {}) as Record<string, unknown>).filter(([name]) =>
          declared.has(name)
        )
      );

      const started = await notebookExecutionService.start(target.id, this.publishRunEvent, {
        args: { ...passed, ...(action.args ?? {}) },
        triggerSource: "page",
      });

      const outcome = await started.completed;
      res.json({
        runId: started.runId,
        notebook: target.name,
        status: outcome.status,
        ms: outcome.ms,
        ...(outcome.errors.length > 0 ? { errors: outcome.errors } : {}),
      });
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /** Links that let someone without an account use this notebook's page. */
  listShares = async (req: Request, res: Response) => {
    try {
      res.json(await notebookSharesService.listByNotebook(String(req.params.id)));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  createShare = async (req: Request, res: Response) => {
    try {
      const notebook = await notebooksService.getById(String(req.params.id));
      if (!notebook) return res.status(404).json({ error: "Notebook not found" });

      // A link to something not in production would 409 for whoever you sent it to,
      // which looks like a broken link rather than a decision you had not made yet.
      const deployed = await notebooksService.getDeployedDocument(String(req.params.id));
      if (!deployed) {
        return res.status(409).json({ error: "Deploy it before sharing it." });
      }

      const user = (req as Request & { user?: { username?: string } }).user;
      res.json(
        await notebookSharesService.create(
          String(req.params.id),
          user?.username ?? "unknown",
          typeof req.body?.password === "string" ? req.body.password : undefined
        )
      );
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  revokeShare = async (req: Request, res: Response) => {
    try {
      res.json(await notebookSharesService.revoke(String(req.params.shareId)));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  remove = async (req: Request, res: Response) => {
    try {
      const result = await notebooksService.delete(String(req.params.id));
      notifyCatalogChanged();
      res.json(result);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /**
   * Keeps a file a page is about to hand to a run, and answers with the descriptor.
   *
   * Two steps rather than one multipart run request, and the reason is the contract: a
   * run takes named arguments, and mixing files into that would mean a second way to
   * supply an argument. Here the file becomes an ordinary value first, and the run that
   * follows is the same run any other caller starts.
   */
  upload = async (req: Request, res: Response) => {
    try {
      const file = (req as Request & { file?: { originalname: string; buffer: Buffer } }).file;
      if (!file) return res.status(400).json({ error: "No file provided" });

      const notebook = await notebooksService.findByIdOrName(String(req.params.id));
      if (notebook === null) return res.status(404).json({ error: "Notebook not found" });
      if (notebook === "ambiguous") {
        return res.status(400).json({ error: "More than one notebook goes by that name" });
      }

      res.json(notebookFilesService.keepUpload(notebook.id, file.originalname, file.buffer, "page"));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  listRuns = async (req: Request, res: Response) => {
    try {
      res.json(await notebookRunsService.listByNotebook(String(req.params.id)));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  clearRuns = async (req: Request, res: Response) => {
    try {
      res.json(await notebookRunsService.deleteByNotebook(String(req.params.id)));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /** `latest` resolves the most recent run, which is what the editor restores on open. */
  getRun = async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const run =
        runId === "latest"
          ? await notebookRunsService.getLatestForNotebook(String(req.params.id))
          : await notebookRunsService.getById(runId);

      if (!run) return res.status(404).json({ error: "Run not found" });
      res.json(run);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  run = async (req: Request, res: Response) => {
    try {
      // A page runs the deployed version; the editor runs the draft. Both come back with
      // a run id straight away and follow the same socket — a page that waited for the
      // whole run could not show the table its first cell had already produced while a
      // later one was still working.
      const isPage = req.body?.mode === "deployed";

      const started = await notebookExecutionService.start(
        String(req.params.id),
        this.publishRunEvent,
        {
          input: req.body?.input,
          args: req.body?.args,
          cellId: req.body?.cellId,
          ...(isPage ? { triggerSource: "page" as const } : {}),
        }
      );

      // Nothing awaits `completed` here, but it must not go unhandled: a failing run
      // would otherwise reject a promise nobody is holding.
      void started.completed.catch(() => {});

      res.status(200).json({ status: "started", runId: started.runId });
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };
}
