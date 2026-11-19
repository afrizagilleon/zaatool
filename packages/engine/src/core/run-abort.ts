/**
 * What a run's abort signal says, as the message a cell fails with.
 *
 * One signal belongs to each root run (see the execution service). It is aborted by the
 * overall deadline or by someone cancelling, always with an Error whose message is the
 * sentence the run should end on.
 */
export function abortMessage(signal: AbortSignal): string {
  const reason = signal.reason;
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" && reason ? reason : "Run aborted";
}
