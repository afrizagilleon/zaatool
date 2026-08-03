import type { NotebookAction, NotebookActionKind } from "@zaa-tool/shared";

/**
 * Reading a notebook's declared buttons.
 *
 * Actions are the one place a page describes something other than data, so the reading is
 * strict: an action that could not work is dropped rather than rendered. A button that
 * does nothing when pressed is worse than a button that was never drawn — the first
 * teaches someone the page is broken, the second teaches them nothing.
 *
 * The three kinds are the whole vocabulary and are meant to stay three. Each is a verb
 * that already exists elsewhere in the product, so a button is a shortcut, never a new
 * capability. Anything that needed a fourth kind is a notebook.
 */

export const ACTION_KINDS: readonly NotebookActionKind[] = ["rerun", "run", "link"];

/** Only what a browser may follow. `javascript:` and `data:` are how a link becomes code. */
const SAFE_URL = /^(https?:\/\/|\/|#|mailto:)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The declared actions, normalised, with anything unusable dropped.
 *
 * Silently, and on purpose: this runs on every page render, and a malformed action is an
 * authoring mistake to be caught when writing the notebook — `notebook_write` reports it,
 * and the editor shows the list it will actually draw.
 */
export function actionSpecs(actions: NotebookAction[] | undefined): NotebookAction[] {
  if (!Array.isArray(actions)) return [];

  const specs: NotebookAction[] = [];
  for (const raw of actions) {
    if (!isRecord(raw)) continue;

    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const kind = raw.do as NotebookActionKind;
    if (!label || !ACTION_KINDS.includes(kind)) continue;

    if (kind === "rerun") {
      specs.push({ label, do: "rerun" });
      continue;
    }

    if (kind === "link") {
      const url = typeof raw.url === "string" ? raw.url.trim() : "";
      if (!url || !SAFE_URL.test(url)) continue;
      specs.push({ label, do: "link", url });
      continue;
    }

    const notebook = typeof raw.notebook === "string" ? raw.notebook.trim() : "";
    if (!notebook) continue;
    specs.push({
      label,
      do: "run",
      notebook,
      ...(isRecord(raw.args) ? { args: raw.args } : {}),
    });
  }

  return specs;
}

/**
 * Why an action was dropped, for the one caller that should say so out loud.
 *
 * `actionSpecs` is silent because rendering is not the place to complain. Writing is, so
 * `notebook_write` runs this and hands the list back to whoever wrote it.
 */
export function actionProblems(actions: NotebookAction[] | undefined): string[] {
  if (!Array.isArray(actions)) return [];

  const problems: string[] = [];
  actions.forEach((raw, index) => {
    const at = `action ${index + 1}`;
    if (!isRecord(raw)) {
      problems.push(`${at}: not a mapping`);
      return;
    }

    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (!label) problems.push(`${at}: needs a \`label\``);

    const kind = raw.do as NotebookActionKind;
    if (!ACTION_KINDS.includes(kind)) {
      problems.push(`${at}: \`do\` must be one of ${ACTION_KINDS.join(", ")}`);
      return;
    }

    if (kind === "link") {
      const url = typeof raw.url === "string" ? raw.url.trim() : "";
      if (!url) problems.push(`${at}: \`link\` needs a \`url\``);
      else if (!SAFE_URL.test(url)) {
        problems.push(`${at}: \`url\` must start with http://, https://, /, # or mailto:`);
      }
    }

    if (kind === "run" && !(typeof raw.notebook === "string" && raw.notebook.trim())) {
      problems.push(`${at}: \`run\` needs a \`notebook\` to call`);
    }
  });

  return problems;
}
