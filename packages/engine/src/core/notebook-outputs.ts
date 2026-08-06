import type { NotebookOutput } from "@zaa-tool/shared";
import { OUTPUT_RENDERS } from "@zaa-tool/shared";

/**
 * Reading a notebook's declared outputs.
 *
 * An output is written either as a bare name or as `{ name, render, … }`. Both mean the
 * same thing to the runner — a name lifted out of the final scope — so everything that
 * only needs names goes through `outputNames` and never learns there are two forms.
 *
 * The full form exists for one reason: a page has to decide how to show the value. That
 * is a presentation question, and it lives on the output rather than in a separate
 * layout because a second declaration is a second thing to keep in step.
 */

export { OUTPUT_RENDERS };

/** Every declared name, in order, with duplicates and empties dropped. */
export function outputNames(outputs: Array<string | NotebookOutput> | undefined): string[] {
  if (!Array.isArray(outputs)) return [];

  const names: string[] = [];
  for (const output of outputs) {
    const name = typeof output === "string" ? output.trim() : (output?.name ?? "").trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The same list in its full form, so a caller can ask how each one should be shown. */
export function outputSpecs(
  outputs: Array<string | NotebookOutput> | undefined
): NotebookOutput[] {
  if (!Array.isArray(outputs)) return [];

  const specs: NotebookOutput[] = [];
  for (const output of outputs) {
    const spec = typeof output === "string" ? { name: output.trim() } : { ...output };
    spec.name = (spec.name ?? "").trim();
    if (!spec.name) continue;
    if (specs.some((existing) => existing.name === spec.name)) continue;
    specs.push(spec);
  }
  return specs;
}
