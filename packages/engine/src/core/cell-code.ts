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

import { spawn } from "child_process";
import { jsSyntaxProblem } from "./cell-analysis.js";

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

/** Named so an agent can fix itself in one turn rather than guessing at a parse error. */
function describeProblem(code: string, detail: string): string {
  if (/^\s*(`{3,}|~{3,})/.test(code)) {
    return `that code is still wrapped in a markdown fence — send the code only (${detail})`;
  }
  return `that code does not parse: ${detail}`;
}

/**
 * Whether this is syntactically code at all — JavaScript, checked in process.
 *
 * Parsed by acorn with the same wrapper the worker builds, so what passes here is what
 * will run there. Microseconds, and it is the check that would have caught the fence.
 *
 * Python needs an interpreter, so it is {@link pythonSyntaxProblem} and asynchronous.
 */
export function codeSyntaxProblem(code: string, runtime: "node" | "python"): string | null {
  if (runtime !== "node") return null;
  const detail = jsSyntaxProblem(code);
  return detail === null ? null : describeProblem(code, detail);
}

/**
 * The same question for Python, which only Python can answer.
 *
 * Wrapped exactly as `python-runner.ts` wraps it — a bare `return` is a syntax error at
 * module level and legal inside `def main`, so checking the unwrapped text would refuse
 * every well-formed cell in the workspace.
 *
 * Two deliberate softnesses. A machine with no interpreter gets `null` rather than a
 * refusal, because a missing Python is a deployment problem and not this notebook's
 * fault; and the check is given two seconds, after which it gives up quietly. Neither is
 * a way for broken code to get in — the fence, the failure this was built for, is caught
 * by {@link stripCodeFence} before any of this runs.
 */
export function pythonSyntaxProblem(code: string): Promise<string | null> {
  if (code.trim() === "") return Promise.resolve(null);

  const wrapped = code.includes("def main(")
    ? code
    : `def main(inputs):\n${code.split("\n").map((line) => `    ${line}`).join("\n")}`;

  return new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "python" : "python3", [
      "-c",
      "import sys; compile(sys.stdin.read(), '<cell>', 'exec')",
    ]);

    let stderr = "";
    const done = (answer: string | null) => {
      clearTimeout(timer);
      child.removeAllListeners();
      child.kill();
      resolve(answer);
    };

    const timer = setTimeout(() => done(null), 2000);

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    // No interpreter on this machine. Not the notebook's problem.
    child.on("error", () => done(null));

    child.on("close", (exitCode) => {
      if (exitCode === 0) return done(null);
      // The traceback's last line is the useful one: "SyntaxError: invalid syntax".
      const lines = stderr.trim().split("\n").filter(Boolean);
      const reason = lines[lines.length - 1] ?? "SyntaxError";
      // Line numbers refer to the wrapper, which is one line longer than the cell.
      const where = /line (\d+)/.exec(stderr);
      const line = where ? ` (around line ${Math.max(1, Number(where[1]) - 1)})` : "";
      done(describeProblem(code, `${reason}${line}`));
    });

    child.stdin.end(wrapped);
  });
}
