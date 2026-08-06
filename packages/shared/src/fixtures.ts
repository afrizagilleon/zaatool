/**
 * Which notebooks are scaffolding rather than work.
 *
 * Twenty-nine notebooks, and fifteen of them are test fixtures I wrote while proving
 * something worked. On the Apps page the first thirteen entries were all mine. That is a
 * list nobody can use, and I made it that way.
 *
 * The rule is the naming convention already in use — `zz-`, chosen so they sort last —
 * so nothing has to be migrated and nothing has to be marked by hand. Derived, not
 * stored: a notebook becomes a fixture by being renamed and stops being one the same way,
 * with no second source of truth to fall out of step.
 *
 * Hidden, never deleted. A fixture is somebody's evidence that a feature works, and the
 * list showing too much is not a reason to destroy it. Every screen that hides them says
 * how many it hid and offers to show them.
 */

/** Names that begin with this are scaffolding. Lower-cased before comparing. */
export const FIXTURE_PREFIX = "zz-";

export function isFixtureName(name: string): boolean {
  return name.trim().toLowerCase().startsWith(FIXTURE_PREFIX);
}

/**
 * Tags a notebook can carry, normalised.
 *
 * Lower-case, trimmed, deduplicated, and free of the empty string — so `Daily`, `daily `
 * and `daily` are one tag rather than three that look alike in a filter list. Order is
 * kept as written, because the first tag is usually the one the author means.
 */
export function normaliseTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** What a tag may contain: no spaces, no commas — those are how tags are separated. */
export function tagProblem(tag: string): string | null {
  const value = tag.trim();
  if (!value) return "A tag cannot be empty.";
  if (value.length > 32) return `“${value}” is too long — 32 characters at most.`;
  if (/[\s,]/.test(value)) return `“${value}” cannot contain spaces or commas.`;
  return null;
}
