/**
 * Computes the next `inputs` record for a node whose incoming edge changed.
 * Used both right after a node finishes executing (wsEventHandler) and when
 * the user rewires an edge on the canvas (flowStore) — in the latter case no
 * execution happens, this just carries forward the source's last known
 * output so display nodes don't go stale until the next real run.
 */
export function withPropagatedInput(
  currentInputs: Record<string, unknown> | undefined,
  targetHandle: string,
  value: unknown,
): Record<string, unknown> {
  return { ...currentInputs, [targetHandle]: value };
}

export function withClearedInput(
  currentInputs: Record<string, unknown> | undefined,
  targetHandle: string,
): Record<string, unknown> {
  const next = { ...currentInputs };
  delete next[targetHandle];
  return next;
}
