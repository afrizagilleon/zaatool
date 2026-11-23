import { randomUUID } from "node:crypto";
import {
  maxNestedCalls,
  maxNestedConcurrency,
  maxQueuedRunsPerOwner,
  maxRunMs,
  maxRunsPerOwner,
} from "../config.js";
import { abortMessage } from "../core/run-abort.js";
import { FanOut, Slot } from "../core/nested-fanout.js";
import { compileNotebook, selectPlanCell } from "../core/notebook-compiler.js";
import { RunGate, type RunTicket } from "../core/run-gate.js";
import { runNotebook, type NotebookRunResult } from "../core/notebook-runner.js";
import { notebookFilesService } from "./notebook-files.service.js";
import { bindInputs } from "../core/notebook-contract.js";
import { createRunEmitter, type RunEventSink } from "../core/run-emitter.js";
import { notebooksService } from "./notebooks.service.js";
import { notebookRunsService } from "./notebook-runs.service.js";
import { NotebookRunRecorder } from "./notebook-run-recorder.js";
import { secretsService } from "./secrets.service.js";
import { createRedactor, type SecretRedactor } from "../core/secret-redactor.js";
import { genericRunError } from "../core/run-projection.js";
import type { EventEmitter } from "node:events";
import { notebookAccessService } from "./notebook-access.service.js";
import { cellHostForOwner } from "./cell-host.service.js";
import { authService } from "./auth.service.js";
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

export class OwnerInactiveError extends Error {
  constructor(name: string) {
    super(
      `Notebook "${name}" belongs to an account that has been deactivated, so it no longer ` +
        `runs on its own. Give it to an active account (transfer-owner) or reactivate the owner.`
    );
    this.name = "OwnerInactiveError";
  }
}

/** Shared by every entry point — the editor, webhooks and the scheduler alike. */
const MAX_CONCURRENT_RUNS = 4;
const MAX_QUEUED_RUNS = 20;
/** Where a cron run is finally refused: past the webhook bound, but not unbounded. */
const MAX_QUEUED_SCHEDULED_RUNS = MAX_QUEUED_RUNS * 5;
/** Half of the slots and of the queue for any one owner: the other half stays for everybody else. */
const half = (n: number): number => Math.max(1, Math.ceil(n / 2));
const runGate = new RunGate({
  maxConcurrent: MAX_CONCURRENT_RUNS,
  maxQueued: MAX_QUEUED_RUNS,
  maxQueuedScheduled: MAX_QUEUED_SCHEDULED_RUNS,
  maxPerOwner: maxRunsPerOwner(half(MAX_CONCURRENT_RUNS)),
  maxQueuedPerOwner: maxQueuedRunsPerOwner(half(MAX_QUEUED_RUNS)),
});

/**
 * How deep `notebooks.run` may nest.
 *
 * A cycle is caught exactly by the call stack, so this is not the cycle guard — it
 * bounds legitimate-looking chains that are really a design gone wrong, and keeps a
 * runaway from holding a worker per level.
 */
const MAX_CALL_DEPTH = 5;

export type CancelOutcome =
  | { outcome: "cancelled" }
  | { outcome: "finished"; status: NotebookRunResult["status"] }
  | { outcome: "not-active" };

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
  /** The share link that asked, so the run can be followed with that link and with no other. */
  shareId?: string;
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

/**
 * Whose secrets a run of this notebook receives.
 *
 * A cell is code somebody wrote, and it can print or send anything it is handed, so the
 * secrets it receives must be ones its author was already entitled to hold:
 *
 *  - **Production** (cron, webhook, a page, an agent calling the app as a tool: everything
 *    that runs the *deployed* version) uses the owner's. Deploying is the step where a human
 *    reads what will run and approves it, so the owner's credentials go to code the owner
 *    has signed off on, and nobody else's edit can reach them without a deploy.
 *  - **The owner's own run** of the draft uses the owner's.
 *  - **Anybody else's run of the draft** (an invited editor pressing Run, or their agent)
 *    uses *the starter's own* secrets of the same names. An editor can write a cell that
 *    prints `process.env.API_KEY`; what it prints must then be the editor's key, not the
 *    owner's. If the starter has none by that name the cell gets it as missing, exactly like
 *    an unset secret (see `missingSecretsNote`).
 *  - A notebook with no owner runs with none; a draft run with no account behind it (which
 *    no entry point produces) gets none either.
 *
 * Decided per run and carried down a chain of calls: a draft run by an editor reaches every
 * callee with the editor's secrets, and a production run reaches every callee with its own
 * owner's.
 */
export function secretHolderFor(
  notebookOwner: string | null,
  useDeployed: boolean,
  startedBy?: string
): { holder: string | null; substituted: boolean } {
  if (notebookOwner === null) return { holder: null, substituted: false };
  if (useDeployed) return { holder: notebookOwner, substituted: false };
  if (startedBy === notebookOwner) return { holder: notebookOwner, substituted: false };
  return { holder: startedBy ?? null, substituted: true };
}

/** The one note a run's log gets when it is a draft run by somebody other than the owner and some declared secret is not theirs. Names keys only, never values. */
export function missingSecretsNote(keys: string[]): string {
  const names = keys.map((key) => `"${key}"`).join(", ");
  const one = keys.length === 1;
  return (
    `Secret${one ? "" : "s"} ${names} ${one ? "is" : "are"} not among your own secrets. ` +
    `A draft run by someone other than the notebook's owner uses the starter's own secrets, never the owner's, ` +
    `so the cell sees ${one ? "it" : "them"} as missing. Add ${one ? "it" : "them"} under your secrets, ` +
    `or ask the owner to deploy and run the deployed version.`
  );
}

interface RunSecrets {
  values: Record<string, string>;
  redactor: SecretRedactor;
  /** Declared secrets the holder does not have; only ever set for a substituted holder. */
  missing: string[];
}

async function secretsForRun(
  plan: NotebookPlan,
  notebookOwner: string | null,
  useDeployed: boolean,
  startedBy?: string
): Promise<RunSecrets> {
  const { holder, substituted } = secretHolderFor(notebookOwner, useDeployed, startedBy);
  const { values, secret } = await secretsService.getForRun(holder, plan.secrets);
  return {
    values,
    redactor: createRedactor(secret),
    missing: substituted ? plan.secrets.filter((key) => !(key in values)) : [],
  };
}

/** Puts the "missing secrets" note in the run's log, on the first cell that starts. */
function noteMissingSecrets(ee: EventEmitter, missing: string[]): void {
  if (missing.length === 0) return;
  ee.once("cell:start", (event: { cellId?: string }) => {
    ee.emit("cell:log", {
      type: "cell:log",
      cellId: event.cellId,
      level: "warn",
      payload: missingSecretsNote(missing),
    });
  });
}

/** A run's outcome with its secrets redacted, for everything that reads `completed` instead of the stream. */
function redactedResult(result: NotebookRunResult, redactor: SecretRedactor): NotebookRunResult {
  if (redactor.empty) return result;
  return {
    ...result,
    errors: result.errors.map((error) => redactor.string(error)),
    outputs: redactor.value(result.outputs),
  };
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
  /**
   * Storage paths some run in this chain was allowed to be given (see `admitInputFiles`),
   * shared by every run in it: what one notebook was handed it may hand on.
   */
  grants: Set<string>;
  /**
   * The deployed document each notebook was first called with in this run, by notebook id,
   * shared by the whole tree. A deploy that lands mid-run does not reach a callee the run
   * already used: one production run is one version of what it calls, not a mixture.
   */
  pinned: Map<string, NotebookJson>;
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
  private readonly activeRuns = new Map<
    string,
    { controller: AbortController; completed: Promise<NotebookRunResult> }
  >();

  /**
   * Cron runs that have been admitted and not yet settled, per notebook (waiting for a slot
   * counts). The scheduler asks before it fires, so a run that takes longer than its period
   * does not pile a new copy behind itself every tick.
   */
  private readonly cronInFlight = new Map<string, number>();

  hasCronRunInFlight(notebookId: string): boolean {
    return (this.cronInFlight.get(notebookId) ?? 0) > 0;
  }

  /**
   * Stops a running root run: every cell in its chain is terminated and the run ends
   * `failed` with "Cancelled by <who>".
   *
   * Resolves once the run is over, and says how it ended: `cancelled` only when it really
   * ended on this cancel. A run that finished (or failed) in the instant before the signal
   * was heard is `finished`, whatever it ended as — answering "cancelled" for a run that
   * succeeded would be a false report. `not-active` when no such run is active here: it
   * already finished, or it is not a root run.
   */
  async cancel(runId: string, who: string): Promise<CancelOutcome> {
    const entry = this.activeRuns.get(runId);
    if (!entry || entry.controller.signal.aborted) return { outcome: "not-active" };
    const reason = new Error(`Cancelled by ${who}`);
    entry.controller.abort(reason);
    const result = await entry.completed;
    const ended = result.status === "failed" && result.errors.some((e) => e.includes(reason.message));
    return ended ? { outcome: "cancelled" } : { outcome: "finished", status: result.status };
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
   * to borrow credentials a notebook never declared. Whose, exactly, is `secretHolderFor`'s
   * rule: the callee owner's in production, the starter's in a draft run.
   *
   * What the callee says back depends on whose it is. A callee of the *same owner* is part
   * of one system and keeps reporting its log lines and error text to the caller (redacted).
   * A callee of *another owner* is a service: its logs are not forwarded and its error text
   * is replaced by a generic message with the callee's run id, because that text is written
   * by an author the caller's owner does not know and routinely contains what that author's
   * cells had in hand.
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
      // The first call in this run decides the version; synchronous with the lookup's
      // result, so two parallel first calls cannot each pin a different one.
      const pinned = context.pinned.get(deployed.id);
      if (pinned) document = pinned;
      else {
        context.pinned.set(deployed.id, deployed.document);
        document = deployed.document;
      }
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
    //
    // The file inputs are admitted as the *caller's owner* (the person whose code chose the
    // path), and not as the callee's: a callee's owner may see folders the caller's cannot.
    const input = await notebookFilesService.admitInputFiles(
      plan.inputs,
      bindInputs(plan.inputs, request.input),
      { notebookId: found.id, actorId: callerOwner, ownFolders: false, grants: context.grants }
    );
    // The callee's owner's, which is not necessarily the caller's: in production a notebook
    // runs with the credentials of whoever owns *it*.
    const calleeOwner = await notebookAccessService.ownerOf(found.id);
    const sameOwner = calleeOwner === callerOwner;
    const held = await secretsForRun(plan, calleeOwner, context.useDeployed, context.startedBy);
    const secrets = held.values;
    // The callee's cells run as the callee's owner, as its secrets are the owner's.
    const host = await cellHostForOwner(calleeOwner, context.grants);

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
      grants: context.grants,
      pinned: context.pinned,
    };

    const recorder = new NotebookRunRecorder(runId, sourcesOf(plan));
    // Published under the callee's own run id, so a client following the *caller* still
    // never sees another notebook's cells — but the workspace does, which is how a call
    // chain lights up across the map.
    const ee = createRunEmitter(
      { runId, notebookId: found.id },
      (event) => {
        context.publish(event);
        recorder.handle(event);
      },
      held.redactor
    );
    noteMissingSecrets(ee, held.missing);

    // The callee's logs also surface on the cell that is waiting, labelled, so a failure
    // deep in a chain is readable without going looking for the nested run. Only for a
    // callee of the same owner, and redacted with the callee's own secrets first (this
    // listener sees the event before the emitter's redaction does).
    if (sameOwner) {
      ee.on("cell:log", (event: { level: string; payload: string }) => {
        context.log(event.level, `[${document.name}] ${held.redactor.string(String(event.payload))}`);
      });
    }

    const raw = await runNotebook(plan, {
      ee,
      secrets,
      input,
      call: (nestedRequest) => this.callNotebook(nestedRequest, nested),
      // A callee writes into its own folder, not the caller's: a file belongs to the
      // notebook that produced it, however deep in a chain that notebook sits.
      file: notebookFilesService.writerFor(found.id, context.grants),
      signal: context.signal,
      host,
    });
    await recorder.drain();
    const result = redactedResult(raw, held.redactor);

    if (result.status === "failed") {
      throw new Error(
        sameOwner
          ? `${document.name}: ${result.errors[0] ?? "run failed"}`
          : `${document.name}: ${genericRunError(runId).toLowerCase()}`
      );
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
    grants: Set<string>,
    startedBy?: string
  ): NotebookCaller {
    // One per root run, not per call: it is what makes the second call to a notebook see
    // the version the first one did.
    const pinned = new Map<string, NotebookJson>();
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
        grants,
        pinned,
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

    // A run nobody asked for, in the name of an account that is switched off, is the one
    // thing deactivating an account is meant to stop: its cron, its webhooks and its pages
    // would otherwise carry on with its secrets. A person pressing Run is a different case —
    // they are there, and a deactivated creator cannot sign in to do it.
    const unattended =
      options.triggerSource === "cron" ||
      options.triggerSource === "webhook" ||
      options.triggerSource === "page";
    if (unattended && record.owner_id) {
      const owner = await authService.currentUser(record.owner_id);
      if (owner && !owner.active) throw new OwnerInactiveError(record.name);
    }

    // The place in the gate is taken here, in the same step as the check, and given back on
    // every way out below that is not a run that went on to hold it. The bound was once
    // checked here and taken after several `await`s, so a burst saw an empty gate all at once.
    // A cron run is let into the queue past the point where a webhook is turned away: the
    // caller of a webhook can try again, but a missed tick is simply a run that never happened.
    const scheduled = options.triggerSource === "cron";
    const ticket = runGate.reserve(record.owner_id ?? "", scheduled);
    if (!ticket) throw new TooManyRunsError();
    if (scheduled) this.cronInFlight.set(notebookId, (this.cronInFlight.get(notebookId) ?? 0) + 1);
    const forgetCron = (): void => {
      if (!scheduled) return;
      const left = (this.cronInFlight.get(notebookId) ?? 1) - 1;
      if (left > 0) this.cronInFlight.set(notebookId, left);
      else this.cronInFlight.delete(notebookId);
    };

    try {
      return await this.launch(record, ticket, forgetCron, publish, options, useDeployed);
    } catch (err: unknown) {
      ticket.release();
      forgetCron();
      throw err;
    }
  }

  /** Everything after the gate: validated, recorded, then detached. A throw leaves the ticket to `start`. */
  private async launch(
    record: NonNullable<Awaited<ReturnType<typeof notebooksService.getById>>>,
    ticket: RunTicket,
    forgetCron: () => void,
    publish: RunEventSink,
    options: StartRunOptions,
    useDeployed: boolean
  ): Promise<StartedRun> {
    const notebookId = record.id;
    const document = useDeployed
      ? await notebooksService.getDeployedDocument(notebookId)
      : notebooksService.parseDocument(record);
    if (!document) throw new NotebookNotDeployedError(record.name);

    const fullPlan = compileNotebook(document);

    // Bound before the run id exists, so bad arguments are a rejected request rather
    // than a run that fails on its first cell.
    //
    // Files are admitted as whoever started the run, or as the notebook's owner when nobody
    // did (cron, webhook, a shared page): a file input cannot name a folder the actor could
    // not open in the storage browser. `grants` is what the whole chain of runs may copy
    // into a cell.
    const grants = new Set<string>();
    const boundInputs = await notebookFilesService.admitInputFiles(
      fullPlan.inputs,
      bindInputs(fullPlan.inputs, options.args),
      {
        notebookId,
        actorId: options.startedBy ?? record.owner_id,
        ownFolders: true,
        grants,
      }
    );

    let plan = fullPlan;
    if (options.cellId) {
      const single = selectPlanCell(fullPlan, options.cellId);
      if (!single) throw new CellNotFoundError(options.cellId);
      plan = single;
    }

    // The owner's for the owner's own run and for anything production; the starter's own for
    // somebody else's run of the draft (see `secretHolderFor`). An editor's cell can print
    // whatever it is handed, so it is handed the editor's secrets and never the owner's.
    const held = await secretsForRun(plan, record.owner_id, useDeployed, options.startedBy);
    const secrets = held.values;
    // Also the owner's: every cell of this notebook runs as their uid. Refused here, before a
    // run row exists, when there is none to give (no owner, or the uid range is full).
    const host = await cellHostForOwner(record.owner_id, grants);

    const runId = randomUUID();
    await notebookRunsService.start({
      runId,
      notebookId,
      triggerSource: options.triggerSource ?? (options.cellId ? "cell" : "manual"),
      cellId: options.cellId,
      startedBy: options.startedBy,
      shareId: options.shareId,
    });

    // Recording is composed into the sink, so every event that reaches a client
    // also reaches storage and no emit site has to remember to persist. The emitter
    // redacts the run's secrets before either sees an event.
    const recorder = new NotebookRunRecorder(runId, sourcesOf(plan));
    const ee = createRunEmitter(
      { runId, notebookId },
      (event) => {
        publish(event);
        recorder.handle(event);
      },
      held.redactor
    );
    noteMissingSecrets(ee, held.missing);

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
    this.activeRuns.set(runId, { controller, completed });

    void (async () => {
      await ticket.ready;
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
            grants,
            options.startedBy
          ),
          file: notebookFilesService.writerFor(notebookId, grants),
          signal: controller.signal,
          host,
        });
        // Waiting for the recorder means a caller that reads the run the moment this
        // resolves sees every cell, not whichever writes happened to land first.
        await recorder.drain();
        settle(redactedResult(result, held.redactor));
      } catch (err: unknown) {
        settle({
          status: "failed",
          errors: [held.redactor.string((err as Error).message)],
          ms: 0,
          outputs: {},
        });
      } finally {
        clearTimeout(deadline);
        this.activeRuns.delete(runId);
        forgetCron();
        ticket.release();
      }
    })();

    return { runId, declaredOutputs: fullPlan.outputs ?? [], completed };
  }
}

export const notebookExecutionService = new NotebookExecutionService();
