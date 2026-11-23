import type {
  CellLogEntry,
  NotebookRunStatus,
  RecordedCellResult,
  RunEvent,
} from "@zaa-tool/shared";
import { notebookRunsService } from "./notebook-runs.service.js";
import { logger } from "../core/logger.js";

/** The only part of the runs store this recorder needs. */
export interface RunResultStore {
  recordCell(runId: string, cellId: string, result: RecordedCellResult): Promise<void>;
  finish(
    runId: string,
    status: NotebookRunStatus,
    error?: string,
    outputs?: Record<string, unknown>
  ): Promise<void>;
}

/**
 * Turns a run's event stream into a history row.
 *
 * Composed into the emitter's sink so persistence sits at one point: every event
 * that reaches a client also reaches storage, and no emit site has to remember to
 * record anything.
 *
 * It stores what it is given. Secrets are already redacted from the events by the emitter that
 * feeds it (see `createRunEmitter`), so nothing unredacted is ever written here.
 *
 * Writes are detached — a failed insert must not take down a running notebook — but
 * never floating: each is caught and logged.
 */
export class NotebookRunRecorder {
  /** Logs arrive before the cell finishes, so they are held until there is a result to attach them to. */
  private pendingLogs = new Map<string, CellLogEntry[]>();
  /** Writes started but not yet settled, so a caller can wait for the record to be whole. */
  private inFlight = new Set<Promise<void>>();
  private sources: Record<string, string | undefined>;

  constructor(
    private readonly runId: string,
    /** The code each cell ran, so a restored run can be checked against current code. */
    sources: Record<string, string | undefined> = {},
    private readonly store: RunResultStore = notebookRunsService
  ) {
    this.sources = sources;
  }

  handle(event: RunEvent): void {
    const cellId = typeof event.cellId === "string" ? event.cellId : undefined;

    switch (event.type) {
      case "cell:start":
        if (cellId) this.pendingLogs.delete(cellId);
        break;

      case "cell:log":
        if (cellId) {
          const logs = this.pendingLogs.get(cellId) ?? [];
          logs.push({ level: String(event.level ?? "info"), msg: String(event.payload ?? "") });
          this.pendingLogs.set(cellId, logs);
        }
        break;

      case "cell:done":
        if (cellId) {
          this.write(cellId, {
            source: this.sources[cellId],
            output: (event.output ?? {}) as Record<string, unknown>,
            written: (event.written ?? []) as string[],
            ms: Number(event.ms ?? 0),
          });
        }
        break;

      case "cell:error":
        if (cellId) {
          // The source is kept even though the result cannot be trusted: "which code
          // produced this error" is the first thing anyone asks of a past failure.
          // Freshness ignores it because the result carries an error.
          this.write(cellId, {
            source: this.sources[cellId],
            error: String(event.error ?? "Unknown error"),
            ms: Number(event.ms ?? 0),
          });
        }
        break;

      case "run:done":
        this.detach(
          this.store.finish(
            this.runId,
            "success",
            undefined,
            event.outputs && typeof event.outputs === "object"
              ? (event.outputs as Record<string, unknown>)
              : undefined
          )
        );
        break;

      case "run:error":
        this.detach(
          this.store.finish(this.runId, "failed", String(event.error ?? "Run failed"))
        );
        break;
    }
  }

  private write(cellId: string, result: RecordedCellResult): void {
    const logs = this.pendingLogs.get(cellId);
    this.pendingLogs.delete(cellId);
    this.detach(
      this.store.recordCell(this.runId, cellId, logs ? { ...result, logs } : result)
    );
  }

  private detach(write: Promise<void>): void {
    const tracked = write.catch((err: unknown) => {
      logger.error("Could not record a run.", { event: "run.record_failed", run_id: this.runId, err });
    });
    this.inFlight.add(tracked);
    void tracked.finally(() => this.inFlight.delete(tracked));
  }

  /**
   * Resolves once every write started so far has settled.
   *
   * Detached writes are right for a browser watching over a socket — it already has
   * the events — but wrong for a caller whose only view of the run is the stored row.
   * An agent asks for a cell's output the instant the run ends, and without this it
   * can read a row the last write has not reached yet.
   */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }
}
