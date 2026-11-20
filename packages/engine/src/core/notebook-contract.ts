import type { NotebookParam } from "@zaa-tool/shared";
import { safeSubPath } from "./storage-paths.js";
import { signStorageLink } from "./storage-links.js";
import { STORAGE_DIR } from "./storage-root.js";

/**
 * Enforcement of the reuse boundary: what a caller must supply, and what it gets back.
 *
 * Kept apart from the compiler because it runs per *call*, not per document — the same
 * compiled plan is bound to different arguments on every invocation.
 */

export class ContractError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "ContractError";
  }
}

/**
 * Values arrive from HTTP bodies and query strings as often as from another notebook,
 * so "3" where a number was declared is a caller using the web, not a caller making a
 * mistake. Coercion is deliberately narrow: only unambiguous conversions, never
 * truthiness, and never a silent `NaN`.
 */
function coerce(param: NotebookParam, value: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  switch (param.type) {
    case "json":
      return { ok: true, value };

    case "string":
      if (typeof value === "string") return { ok: true, value };
      if (typeof value === "number" || typeof value === "boolean") {
        return { ok: true, value: String(value) };
      }
      return { ok: false, reason: `expected a string, got ${describe(value)}` };

    case "number": {
      if (typeof value === "number" && Number.isFinite(value)) return { ok: true, value };
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return { ok: true, value: parsed };
      }
      return { ok: false, reason: `expected a number, got ${describe(value)}` };
    }

    case "boolean": {
      if (typeof value === "boolean") return { ok: true, value };
      if (value === "true") return { ok: true, value: true };
      if (value === "false") return { ok: true, value: false };
      return { ok: false, reason: `expected a boolean, got ${describe(value)}` };
    }

    /**
     * A file arrives as the descriptor the engine handed out when it stored the bytes.
     * A bare string is accepted as the path, because that is what a caller writes by hand
     * when reusing a file a previous run produced — and it is the only form an agent can
     * type without having uploaded anything.
     */
    case "file": {
      // Only `{ name, path, url? }` survives. A descriptor is data from the caller, so
      // anything else on it (notably `absolute_path`) is dropped rather than trusted,
      // and a `path` that does not stay inside storage is a refusal, not a skip.
      let raw: { name?: unknown; path?: unknown; url?: unknown };
      if (typeof value === "string" && value.trim() !== "") {
        raw = { name: value.split("/").pop() ?? value, path: value.trim() };
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        raw = value as typeof raw;
        if (typeof raw.path !== "string" || raw.path.trim() === "") {
          return { ok: false, reason: "expected a file with a `path`" };
        }
      } else {
        return { ok: false, reason: `expected a file, got ${describe(value)}` };
      }

      const relative = safeSubPath(raw.path, STORAGE_DIR);
      if (relative === null || relative === "") {
        return { ok: false, reason: "expected a file whose `path` is inside storage" };
      }

      // The caller's `url` is ignored: it is derived from the validated path, so a
      // descriptor cannot make the cell's `file.url` point at somewhere it did not earn.
      const file: { name: string; path: string; url: string } = {
        name: typeof raw.name === "string" ? raw.name : relative.split("/").pop() ?? relative,
        path: (raw.path as string).trim(),
        url: signStorageLink(relative),
      };
      return { ok: true, value: file };
    }
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** The permitted values, with any labels stripped — labels are for people, not matching. */
export function optionValues(param: NotebookParam): Array<string | number> {
  if (!Array.isArray(param.options)) return [];
  const values: Array<string | number> = [];
  for (const option of param.options) {
    if (typeof option === "string" || typeof option === "number") values.push(option);
    else if (option && (typeof option.value === "string" || typeof option.value === "number")) {
      values.push(option.value);
    }
  }
  return values;
}

/**
 * Coerces one value and, where the input declares a fixed set, checks it is in it.
 *
 * Membership is tested *after* coercion so `?direction=usd_to_idr` from a query string
 * and `{ direction: "usd_to_idr" }` from a caller are judged the same way.
 */
function coerceOne(
  param: NotebookParam,
  permitted: Array<string | number>,
  value: unknown
): { ok: true; value: unknown } | { ok: false; reason: string } {
  const result = coerce(param, value);
  if (!result.ok || permitted.length === 0) return result;

  if (!permitted.includes(result.value as string | number)) {
    return {
      ok: false,
      reason: `expected one of ${permitted.map((one) => JSON.stringify(one)).join(", ")}, got ${JSON.stringify(result.value)}`,
    };
  }
  return result;
}

/**
 * Binds supplied arguments to declared inputs.
 *
 * Undeclared arguments are dropped rather than merged into scope: the contract is the
 * whole interface, so a caller cannot reach past it and set an internal name.
 */
export function bindInputs(
  params: NotebookParam[] | undefined,
  supplied: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!Array.isArray(params) || params.length === 0) return {};

  const args = supplied ?? {};
  const bound: Record<string, unknown> = {};
  const issues: string[] = [];

  for (const param of params) {
    if (!param?.name) continue;

    const given = Object.prototype.hasOwnProperty.call(args, param.name)
      ? args[param.name]
      : undefined;

    if (given === undefined || given === null) {
      if (param.default !== undefined) {
        bound[param.name] = param.default;
      } else if (param.required) {
        issues.push(`"${param.name}" is required`);
      }
      continue;
    }

    const permitted = optionValues(param);

    // A multiple-choice input always hands the notebook a list, even of one — code that
    // loops over a selection should not need a special case for "they only picked one".
    if (param.multiple) {
      const items = Array.isArray(given) ? given : [given];
      const chosen: unknown[] = [];
      let failed = false;

      for (const item of items) {
        const result = coerceOne(param, permitted, item);
        if (result.ok) chosen.push(result.value);
        else {
          issues.push(`"${param.name}": ${result.reason}`);
          failed = true;
        }
      }

      if (!failed) bound[param.name] = chosen;
      continue;
    }

    const result = coerceOne(param, permitted, given);
    if (result.ok) bound[param.name] = result.value;
    else issues.push(`"${param.name}": ${result.reason}`);
  }

  if (issues.length > 0) throw new ContractError(issues);
  return bound;
}

/**
 * Lifts the declared outputs out of the final scope.
 *
 * A name that was declared but never written comes back as `null` rather than being
 * left out, so a caller destructuring the result gets a value it can test instead of
 * a property that silently does not exist.
 */
export function selectOutputs(
  names: string[] | undefined,
  scope: Record<string, unknown>
): Record<string, unknown> {
  if (!Array.isArray(names) || names.length === 0) return {};

  const selected: Record<string, unknown> = {};
  for (const name of names) {
    if (typeof name !== "string" || name.length === 0) continue;
    selected[name] = Object.prototype.hasOwnProperty.call(scope, name) ? scope[name] : null;
  }
  return selected;
}
