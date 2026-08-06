import type { NotebookRuntime } from '@zaa-tool/shared';
import { ALLOWED_JS_PACKAGES, PYTHON_REQUIREMENT_SOURCE } from '@zaa-tool/shared';

/**
 * Whether a library can be asked for, judged while it is being typed.
 *
 * The engine judges this too, and its answer is the one that counts — this is the same
 * question asked early enough to be useful. Without it the only way to learn that `pg` is
 * refused was to save, deploy, run, and read a failure; with it the box turns red under
 * your cursor.
 *
 * Two judges of one rule is exactly the arrangement that produced this milestone, so the
 * rule itself is not duplicated: the list and the requirement shape come from
 * `@zaa-tool/shared`, and `web-alignment.test.ts` puts a corpus through both sides and
 * requires them to agree on every entry.
 */

const PYTHON_REQUIREMENT = new RegExp(PYTHON_REQUIREMENT_SOURCE);

/** Why this entry cannot be honoured, or null if it can. */
export function packageProblem(runtime: NotebookRuntime, entry: string): string | null {
  const name = entry.trim();
  if (name === '') return 'Empty.';

  if (runtime === 'python') {
    return PYTHON_REQUIREMENT.test(name)
      ? null
      : 'Not a plain requirement — a name, optionally with a version like pandas==2.2.0.';
  }

  return (ALLOWED_JS_PACKAGES as readonly string[]).includes(name)
    ? null
    : `Not available to JavaScript cells. The list is: ${ALLOWED_JS_PACKAGES.join(', ')}.`;
}
