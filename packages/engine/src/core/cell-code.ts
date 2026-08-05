/**
 * What a cell's code is allowed to be, when it arrives from an agent.
 *
 * This exists because of one measured failure. Asked to change a single cell, Hermes sent:
 *
 *     ```js
 *     const rate = …
 *     ```
 *
 * — code wrapped in a markdown fence, because a fence is how a language model has marked
 * code its entire life. It was stored verbatim, it **passed the compiler**, and the tool
 * reported success. The notebook was broken from that moment and said nothing until it ran.
 *
 * Two lessons, and both are rules now rather than intentions:
 *
 *  - **The obvious wrapping is not a mistake to reject, it is a form to accept.** A tool
 *    that refuses the most natural thing a model can send is a tool that will be worked
 *    around, and the workaround was rewriting the whole notebook — the exact cost this
 *    was built to remove.
 *  - **Nothing is stored without being checked.** `compileNotebook` reads structure and
 *    never looked at a line of code, so "it compiles" meant nothing about whether the code
 *    was code.
 */

/** Opening fence: three or more backticks or tildes, with an optional language word. */
const FENCE_OPEN = /^\s*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n/;

/**
 * Removes a markdown fence around a whole block of code.
 *
 * Only when the fence wraps *everything*: a cell whose code legitimately contains a fenced
 * block in a template literal keeps it, because the closing fence there is not the last
 * thing in the string. Never throws — a shape it does not recognise is returned untouched
 * and left for the syntax check to judge.
 */
export function stripCodeFence(code: string): string {
  // Line endings are normalised on the way in. A model on a Windows-shaped transport can
  // send CRLF, and a stray `\r` at the end of a line is invisible in every view of the
  // code while being perfectly capable of breaking a template literal.
  const text = String(code ?? "").replace(/\r\n/g, "\n");
  const open = FENCE_OPEN.exec(text);
  if (!open) return text;

  const marker = open[1][0];
  const length = open[1].length;
  const body = text.slice(open[0].length);

  // The closing fence must be the end of the content, allowing trailing whitespace.
  const close = new RegExp(`\\r?\\n?[ \\t]*\\${marker}{${length},}[ \\t]*\\s*$`);
  const closed = close.exec(body);
  if (!closed) return text;

  return body.slice(0, closed.index);
}

/**
 * Whether this is syntactically code at all.
 *
 * JavaScript is checked here, in process, by compiling it the same way the worker will —
 * `new Function` with the same parameter list. It costs microseconds and it is the check
 * that would have caught the fence.
 *
 * Python is not checked: doing it properly means spawning an interpreter on every write,
 * and the failure this was built for — the fence — is already gone by the time this runs.
 * That gap is recorded rather than hidden; see F-002 in the repair plan.
 */
export function codeSyntaxProblem(code: string, runtime: "node" | "python"): string | null {
  if (runtime !== "node") return null;
  if (code.trim() === "") return null;

  try {
    // Same shape as `worker-boot.ts` builds, so what passes here is what will run there.
    new Function(
      "inputs",
      "require",
      "Table",
      "FileObject",
      "ImageObject",
      "notebooks",
      "files",
      `"use strict"; return (async () => { ${code} })()`
    );
    return null;
  } catch (err) {
    const message = (err as Error).message;
    // The one an agent will actually hit, named so it can fix itself in one turn.
    if (/^\s*(`{3,}|~{3,})/.test(code)) {
      return `that code is still wrapped in a markdown fence — send the code only (${message})`;
    }
    return `that code does not parse: ${message}`;
  }
}
