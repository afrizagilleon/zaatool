/**
 * What an operator is told when a script fails. A sentence a person wrote (a validation
 * message, "No account named ...") is shown as it is; a database error is reduced to its
 * SQLSTATE code, because a driver's message can quote a row and its `detail` always does.
 * Only `.message` is ever printed, never the error object, so no `detail` or `parameters`
 * reaches the terminal or whatever captures it.
 */
export function humanMessage(err: unknown): string {
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
    return `The database refused this (SQLSTATE ${code}).`;
  }
  return err instanceof Error ? err.message : String(err);
}
