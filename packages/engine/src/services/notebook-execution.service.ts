import { randomUUID } from "node:crypto";
import { maxNestedCalls, maxNestedConcurrency, maxRunMs } from "../config.js";
import { abortMessage } from "../core/run-abort.js";
import { FanOut, Slot } from "../core/nested-fanout.js";
import { compileNotebook, selectPlanCell } from "../core/notebook-compiler.js";
import { RunGate } from "../core/run-gate.js";
import { runNotebook, type NotebookRunResult } from "../core/notebook-runner.js";
import { notebookFilesService } from "./notebook-files.service.js";
import { bindInputs } from "../core/notebook-contract.js";
import { createRunEmitter, type RunEventSink } from "../core/run-emitter.js";
import { notebooksService } from "./notebooks.service.js";
import { notebookRunsService } from "./notebook-runs.service.js";
import { NotebookRunRecorder } from "./notebook-run-recorder.js";
import { secretsService } from "./secrets.service.js";
import { notebookAccessService } from "./notebook-access.service.js";
import type { NotebookCallRequest, NotebookCaller } from "../core/notebook-call.js";
import type { NotebookPlan } from "../core/notebook-compiler.js";
import type { NotebookJson, NotebookRunTrigger } from "@zaa-tool/shared";

export class NotebookNotFoundError extends Error {
  constructor(id: string) {
    super(`Notebook "${id}" not found`);
    this.name = "NotebookNotFoundError";
  }
}

export class CellNotFoundError extends Error {
  constructor(cellId: string) {
    super(`Cell "${cellId}" has no runnable code`);
    this.name = "CellNotFoundError";
  }
}

export class NotebookNotDeployedError extends Error {
  constructor(name: string) {
    super(
      `Notebook "${name}" has not been deployed. Triggers run the deployed version, ` +
        `so nothing fires until someone deploys it.`
    );
    this.name = "NotebookNotDeployedError";
  }
}

export class TooManyRunsError extends Error {
  constructor() {
    super("Too many runs in progress. Try again shortly.");
    this.name = "TooManyRunsError";
  }
}

/** Shared by every entry point — the editor, webhooks and the scheduler alike. */
const MAX_CONCURRENT_RUNS = 4;
const MAX_QUEUED_RUNS = 20;
/** Where a cron run is finally refused: past the webhook bound, but not unbounded. */
const MAX_QUEUED_SCHEDULED_RUNS = MAX_QUEUED_RUNS * 5;
const runGate = new RunGate(MAX_CONCURRENT_RUNS, MAX_QUEUED_RUNS, MAX_QUEUED_SCHEDULED_RUNS);

/**
 * How deep `notebooks.run` may nest.
 *
 * A cycle is caught exactly by the call stack, so this is not the cycle guard — it
 * bounds legitimate-looking chains that are really a design gone wrong, and keeps a
 * runaway from holding a worker per level.
 */
const MAX_CALL_DEPTH = 5;

export interface StartRunOptions {
  /** Values seeded into scope before the first cell runs. */
  input?: Record<string, unknown>;
  /**
   * Arguments for the notebook's declared inputs. Validated and coerced against the
   * contract, unlike `input`, which seeds scope verbatim.
   */
  args?: Record<string, unknown>;
  /** Run only this cell; the caller supplies the scope it needs via `input`. */
  cellId?: string;
  /** Recorded on the run so a failure can be traced to what set it off. */
  triggerSource?: NotebookRunTrigger;
  /**
   * The account on whose behalf this runs, when there is one. Recorded on the run — it is
   * what lets somebody who only uses a page read their own runs and no one else's — and
   * inherited by every notebook the run calls.
   */
  startedBy?: string;
}

export interface StartedRun {
  runId: string;
  /**
   * The names this notebook promises to hand back.
   *
   * Reported so a caller can decide whether waiting for the run is worth anything —
   * a notebook that declares no outputs has nothing to return, and waiting for it would
   * only make the caller slower.
   */
  declaredOutputs: string[];
  /**
   * Resolves when the run is over, with its outcome. Never rejects: a cell failure is
   * a `failed` status, and an unexpected throw is reported the same way, so a caller
   * that only wants the id can ignore this without risking an unhandled rejection.
   */
  completed: Promise<NotebookRunResult>;
}

/** Every cell's source, keyed by id, so the recorded run knows what it ran. */
function sourcesOf(plan: NotebookPlan): Record<string, string> {
  const sources: Record<string, string> = {};
  const walk = (steps: NotebookPlan["steps"]): void => {
    for (const step of steps) {
      if (step.kind === "code") sources[step.cellId] = step.source;
      else for (const lane of step.lanes) walk(lane.steps);
    }
  };
  walk(plan.steps);
  return sources;
}

/** Everything a nested call needs to know about the chain above it. */
interface CallContext {
  stack: string[];
  names: string[];
  log: (level: string, msg: string) => void;
  publish: RunEventSink;
  /** The run that asked for this one, so the callee's history explains itself. */
  parentRunId: string;
  /** Who the root run is for, so a callee's history is as readable to them as the caller's. */
  startedBy?: string;
  /**
   * Whether this whole run is production.
   *
   * Decided once, by what started it, and carried down the chain: a run is either
   * the deployed system or your drafts, never a mixture. Testing a caller by hand
   * exercises the callee you are editing; the 3am cron exercises the one you
   * deployed.
   */
  useDeployed: boolean;
  /** The root run's signal: its deadline and a cancel reach every run in the chain. */
  signal: AbortSignal;
  /** Bounds the nested calls this whole root run makes. */
  fan: FanOut;
  /** The calling run's place in `fan`, lent out while it waits on this call. Absent for a root run. */
  parentSlot?: Slot;
}

/**
 * Starts notebook runs.
 *
 * Compiling and secret resolution happen before the run id is handed back, so a
 * malformed notebook fails the request outright instead of starting a run that
 * dies immediately. Execution itself is detached — progress arrives as events.
 */
export class NotebookExecutionService {
  /**
   * Root runs that have started and not yet settled, by run id, so a cancel can reach the
   * signal their cells listen to. Only roots are here: a nested run belongs to the run that
   * started it and is stopped with it.
   */
  private readonly activeRuns = new Map<string, AbortController>();

  /**
   * Stops a running root run: every cell in its chain is terminated and the run ends
   * `failed` with "Cancelled by <who>". False when no such run is active here — it already
   * finished, or it is not a root run.
   */
  cancel(runId: string, who: string): boolean {
    const controller = this.activeRuns.get(runId);
    if (!controller || controller.signal.aborted) return false;
    controller.abort(new Error(`Cancelled by ${who}`));
    return true;
  }

  /**
   * The bounded entry to a nested call: counts it against the run's total, waits for one of
   * its few places, and gives the place back (and takes the caller's back) when it is over.
   * The gate is not involved — see `runCallee`.
   */
  private async callNotebook(
    request: NotebookCallRequest,
    context: CallContext
  ): Promise<Record<string, unknown>> {
    context.fan.admit();
    const { parentSlot } = context;
    // The caller is parked on this call, so it stops counting as executing until it returns.
    parentSlot?.yieldSlot();
    const slot = new Slot(context.fan);
    try {
      await slot.acquire(context.signal);
      return await this.runCallee(request, context, slot);
    } finally {
      slot.release();
      await parentSlot?.resume();
    }
  }

  /**
   * Runs a notebook on behalf of a cell in another notebook.
   *
   * Deliberately does *not* take a gate slot. The caller already holds one and is
   * blocked waiting for this, so charging the callee too would let four nested runs
   * fill the gate and wait on themselves forever. The gate bounds how many runs start
   * from outside; how many nested calls one run makes, and how many execute at once, is
   * bounded by its `FanOut` (see `callNotebook`); depth is bounded separately.
   *
   * The callee gets its own secrets, never the caller's — reuse must not become a way
   * to borrow credentials a notebook never declared.
   */
  private async runCallee(
    request: NotebookCallRequest,
    context: CallContext,
    slot: Slot
  ): Promise<Record<string, unknown>> {
    // A stopped run starts nothing more, and leaves no history row for what never began.
    if (context.signal.aborted) throw new Error(abortMessage(context.signal));

    const reference = String(request.notebook ?? "").trim();

    // Only among what the *caller's owner* could use as an app (or, in a draft run, open).
    // A notebook is not a way to reach what its author could not: a callee outside this set
    // is "not found", the same as one that does not exist, so a call cannot be used to find
    // out which notebooks somebody else has. A caller with no owner may call nothing.
    const callerId = context.stack[context.stack.length - 1];
    const callerOwner = await notebookAccessService.ownerOf(callerId);
    const among = callerOwner === null ? [] : await notebookAccessService.callableIds(callerOwner);

    // A production run looks the callee up among the names of what is *deployed*; a draft
    // run among the drafts. Resolving production against the draft `name` column made a
    // rename in the editor break a deployed caller before anyone deployed anything.
    let found: { id: string };
    let document: NotebookJson;

    if (context.useDeployed) {
      const deployed = await notebooksService.findDeployedByIdOrName(reference, among);
      if (deployed === null) throw new NotebookNotFoundError(reference);
      if (deployed === "ambiguous") {
        throw new Error(
          `More than one notebook is named "${reference}" — call it by id instead`
        );
      }
      if (deployed === "undeployed") {
        const record = await notebooksService.getById(reference);
        throw new NotebookNotDeployedError(record?.name ?? reference);
      }
      found = deployed;
      document = deployed.document;
    } else {
      const draft = await notebooksService.findByIdOrName(reference, among);
      if (draft === null) throw new NotebookNotFoundError(reference);
      if (draft === "ambiguous") {
        throw new Error(
          `More than one notebook is named "${reference}" — call it by id instead`
        );
      }
      found = draft;
      document = notebooksService.parseDocument(draft);
    }

    const chain = [...context.names, document.name];

    if (context.stack.includes(found.id)) {
      throw new Error(`Notebook call cycle: ${chain.join(" → ")}`);
    }
    if (context.stack.length >= MAX_CALL_DEPTH) {
      throw new Error(
        `Notebook calls nested more than ${MAX_CALL_DEPTH} deep: ${chain.join(" → ")}`
      );
    }

    const plan = compileNotebook(document);
    // A contract failure names the callee, because from the caller's seat the error
    // is about the call it just made, not about a notebook it cannot see.
    const input = notebookFilesService.withReadablePaths(
      plan.inputs,
      bindInputs(plan.inputs, request.input)
    );
    // The callee's owner's, which is not necessarily the caller's: a notebook runs with the
    // credentials of whoever owns *it*.
    const secrets = await secretsService.getByKeys(
      await notebookAccessService.ownerOf(found.id),
      plan.secrets
    );

    // A called notebook is a run in its own right, with its own id and its own history
    // row. It used to be invisible: a callee that failed at 3am left no record anywhere,
    // and the only trace was a sentence inside the caller's error.
    const runId = randomUUID();
    await notebookRunsService.start({
      runId,
      notebookId: found.id,
      triggerSource: "call",
      parentRunId: context.parentRunId,
      startedBy: context.startedBy,
    });

    const nested = {
      stack: [...context.stack, found.id],
      names: chain,
      log: context.log,
      publish: context.publish,
      parentRunId: runId,
      startedBy: context.startedBy,
      useDeployed: context.useDeployed,
      signal: context.signal,
      fan: context.fan,
      parentSlot: slot,
    };

    const recorder = new NotebookRunRecorder(runId, sourcesOf(plan));
    // Published under the callee's own run id, so a client following the *caller* still
    // never sees another notebook's cells — but the workspace does, which is how a call
    // chain lights up across the map.
    const ee = createRunEmitter({ runId, notebookId: found.id }, (event) => {
      context.publish(event);
      recorder.handle(event);
    });

    // The callee's logs also surface on the cell that is waiting, labelled, so a failure
    // deep in a chain is readable without going looking for the nested run.
    ee.on("cell:log", (event: { level: string; payload: string }) => {
      context.log(event.level, `[${document.name}] ${event.payload}`);
    });

    const result = await runNotebook(plan, {
      ee,
      secrets,
      input,
      call: (nestedRequest) => this.callNotebook(nestedRequest, nested),
      // A callee writes into its own folder, not the caller's: a file belongs to the
      // notebook that produced it, however deep in a chain that notebook sits.
      file: notebookFilesService.writerFor(found.id),
      signal: context.signal,
    });
    await recorder.drain();

    if (result.status === "failed") {
      throw new Error(`${document.name}: ${result.errors[0] ?? "run failed"}`);
    }

    return result.outputs;
  }

  /** The bridge handed to a run's cells, rooted at the notebook that started it. */
  private callerFor(
    notebookId: string,
    name: string,
    publish: RunEventSink,
    runId: string,
    useDeployed: boolean,
    signal: AbortSignal,
    fan: FanOut,
    startedBy?: string
  ): NotebookCaller {
    return (request, log) =>
      this.callNotebook(request, {
        stack: [notebookId],
        names: [name],
        log: log ?? (() => {}),
        publish,
        parentRunId: runId,
        startedBy,
        useDeployed,
        signal,
        fan,
      });
  }

  async start(
    notebookId: string,
    publish: RunEventSink,
    options: StartRunOptions = {}
  ): Promise<StartedRun> {
    const record = await notebooksService.getById(notebookId);
    if (!record) throw new NotebookNotFoundError(notebookId);

    // What started the run decides which copy of the notebook it runs. A trigger, or an
    // agent calling the notebook as a tool, is the outside world arriving — and the
    // outside world gets the version someone deployed.
    const useDeployed =
      options.triggerSource === "cron" ||
      options.triggerSource === "webhook" ||
      options.triggerSource === "tool" ||
      options.triggerSource === "page";
    const document = useDeployed
      ? await notebooksService.getDeployedDocument(notebookId)
      : notebooksService.parseDocument(record);
    if (!document) throw new NotebookNotDeployedError(record.name);

    const fullPlan = compileNotebook(document);

    // Bound before the run id exists, so bad arguments are a rejected request rather
    // than a run that fails on its first cell.
    const boundInputs = notebookFilesService.withReadablePaths(
      fullPlan.inputs,
      bindInputs(fullPlan.inputs, options.args)
    );

    let plan = fullPlan;
    if (options.cellId) {
      const single = selectPlanCell(fullPlan, options.cellId);
      if (!single) throw new CellNotFoundError(options.cellId);
      plan = single;
    }

    // Refused before a run row exists, so a rejected burst leaves no history behind. A cron
    // run is let into the queue past the point where a webhook is turned away: the caller of
    // a webhook can try again, but a missed tick is simply a run that never happened.
    if (runGate.isFull(options.triggerSource === "cron")) throw new TooManyRunsError();

    // The owner's, whoever pressed Run: an editor's run uses the notebook's secrets, not the
    // editor's own, and the editor never sees them.
    const secrets = await secretsService.getByKeys(record.owner_id, plan.secrets);

    const runId = randomUUID();
    await notebookRunsService.start({
      runId,
      notebookId,
      triggerSource: options.triggerSource ?? (options.cellId ? "cell" : "manual"),
      cellId: options.cellId,
      startedBy: options.startedBy,
    });

    // Recording is composed into the sink, so every event that reaches a client
    // also reaches storage and no emit site has to remember to persist.
    const recorder = new NotebookRunRecorder(runId, sourcesOf(plan));
    const ee = createRunEmitter({ runId, notebookId }, (event) => {
      publish(event);
      recorder.handle(event);
    });

    // Detached: runNotebook reports its own outcome through terminal events and never
    // rejects for a cell failure. The gate slot is taken here rather than before the
    // run row is written, so a queued run still has an id the caller can follow.
    //
    // `completed` exists for callers with no event stream to watch — an agent over MCP
    // has only the answer it is handed. It never rejects, so ignoring it stays safe.
    let settle: (result: NotebookRunResult) => void = () => {};
    const completed = new Promise<NotebookRunResult>((resolve) => {
      settle = resolve;
    });

    // One signal for the whole chain: the deadline below and a cancel both abort it, and
    // every cell, nested or not, listens to it.
    const controller = new AbortController();
    const fan = new FanOut(maxNestedConcurrency(), maxNestedCalls());
    this.activeRuns.set(runId, controller);

    void (async () => {
      const release = await runGate.acquire();
      // The clock starts when the run does, not when it joined the queue: waiting for a
      // slot is not the run's time to spend.
      const seconds = maxRunMs() / 1000;
      const deadline = setTimeout(() => {
        controller.abort(new Error(`Run exceeded its overall deadline of ${seconds} s`));
      }, maxRunMs());
      try {
        const result = await runNotebook(plan, {
          ee,
          secrets,
          // Declared arguments first, so a trigger payload seeded under `input`
          // cannot quietly shadow a value the contract promised.
          input: { ...options.input, ...boundInputs },
          call: this.callerFor(
            notebookId,
            document.name,
            publish,
            runId,
            useDeployed,
            controller.signal,
            fan,
            options.startedBy
          ),
          file: notebookFilesService.writerFor(notebookId),
          signal: controller.signal,
        });
        // Waiting for the recorder means a caller that reads the run the moment this
        // resolves sees every cell, not whichever writes happened to land first.
        await recorder.drain();
        settle(result);
      } catch (err: unknown) {
        settle({ status: "failed", errors: [(err as Error).message], ms: 0, outputs: {} });
      } finally {
        clearTimeout(deadline);
        this.activeRuns.delete(runId);
        release();
      }
    })();

    return { runId, declaredOutputs: fullPlan.outputs ?? [], completed };
  }
}

export const notebookExecutionService = new NotebookExecutionService();
