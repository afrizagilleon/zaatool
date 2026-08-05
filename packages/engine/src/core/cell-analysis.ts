import { parse } from "acorn";
import { simple as walkSimple, ancestor as walkAncestor } from "acorn-walk";
import type { Node } from "acorn";

/**
 * What a cell reads and what it writes, read from its syntax tree.
 *
 * The first version of this scanned characters, and it was wrong in the way a character
 * scanner is always wrong: it understood the shape it was written against and nothing
 * else. `return { a, b }` was read correctly; `return cond ? { a } : { b }`,
 * `return await build()`, and `return { ...previous, total }` all came back as
 * "unknown" — and unknown is not harmless here, because it is what switches off the
 * check that stops an edit breaking the chain of names between cells.
 *
 * A real parser answers exactly, so the check stays on. Where the answer genuinely cannot
 * be known — a computed key, a spread of something opaque, a value returned from a
 * function — it says so, and that uncertainty is now scoped to the cells that follow
 * rather than switching off the whole notebook.
 */

/**
 * Wrapped the same way `worker-boot.ts` wraps it, so what parses here is what runs there.
 *
 * The newline after the brace is not cosmetic: without it the cell's first line shares a
 * line with the wrapper, and every column a parse error reports on that line is offset by
 * the wrapper's length — "column 103" for a mistake in the fourth character. The cell now
 * starts at line 2, column 0, so subtracting one line gives the cell's own position.
 */
const WRAPPER_LINES = 1;

function wrap(code: string): string {
  return `async function __cell(inputs, require, Table, FileObject, ImageObject, notebooks, files) {\n${code}\n}`;
}

function parsed(code: string): Node | null {
  try {
    return parse(wrap(code), { ecmaVersion: "latest", sourceType: "script" }) as Node;
  } catch {
    return null;
  }
}

/**
 * Names a cell takes off the shared scope.
 *
 * Read from member expressions rather than matched in text, so `inputs.rows` inside a
 * string or a comment is not counted, and `inputs["rows"]` is.
 */
export function cellReads(code: string): string[] {
  const names = new Set<string>();
  const tree = parsed(code);

  if (!tree) {
    // Unparseable code still gets an answer, because an outline of a broken cell is
    // exactly when someone wants to know what it was reaching for.
    for (const match of code.matchAll(/inputs\s*\.\s*([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
    for (const match of code.matchAll(/inputs\s*\[\s*["']([^"']+)["']\s*\]/g)) names.add(match[1]);
    return [...names];
  }

  walkSimple(tree, {
    MemberExpression(node: unknown) {
      const member = node as {
        object: { type: string; name?: string };
        property: { type: string; name?: string; value?: unknown };
        computed: boolean;
      };
      if (member.object.type !== "Identifier" || member.object.name !== "inputs") return;

      if (!member.computed && member.property.type === "Identifier" && member.property.name) {
        names.add(member.property.name);
        return;
      }
      if (member.computed && member.property.type === "Literal" && typeof member.property.value === "string") {
        names.add(member.property.value);
      }
    },
  });

  return [...names];
}

interface Written {
  names: string[];
  /** False when something returned could not be accounted for. */
  known: boolean;
}

/**
 * Names a cell returns.
 *
 * Every `return` in the cell contributes, because a cell that returns different shapes on
 * different paths writes the union of them — and a check that only looked at the first
 * one would bless an edit that breaks the other.
 *
 * Returns inside a nested function are ignored: they belong to that function, not to the
 * cell, and counting them was one of the character scanner's quieter mistakes.
 */
export function cellWrites(code: string): Written {
  const tree = parsed(code);
  if (!tree) return { names: [], known: false };

  const names = new Set<string>();
  let known = true;
  let sawReturn = false;

  /** The cell body is the one function that matters; anything nested is somebody else's. */
  const body = (tree as unknown as { body: Node[] }).body[0];

  const describe = (expression: unknown): void => {
    const node = expression as { type: string; [key: string]: unknown };
    if (!node) {
      // `return;` writes nothing, and that is a known nothing.
      return;
    }

    switch (node.type) {
      case "ObjectExpression": {
        for (const property of node.properties as { type: string; computed?: boolean; key?: { type: string; name?: string; value?: unknown } }[]) {
          if (property.type === "SpreadElement") {
            known = false;
            continue;
          }
          const key = property.key;
          if (property.computed) {
            known = false;
            continue;
          }
          if (key?.type === "Identifier" && key.name) names.add(key.name);
          else if (key?.type === "Literal" && typeof key.value === "string") names.add(key.value);
          else known = false;
        }
        return;
      }

      // Both branches can happen, so both are written.
      case "ConditionalExpression":
        describe(node.consequent);
        describe(node.alternate);
        return;

      // `return a || {}` and `return a ?? {}` — same reasoning.
      case "LogicalExpression":
        describe(node.left);
        describe(node.right);
        return;

      case "AwaitExpression":
        describe(node.argument);
        return;

      default:
        known = false;
    }
  };

  /**
   * Only the cell's own returns.
   *
   * A `return` inside a callback belongs to that callback — `rows.map(r => ({ id: r.id }))`
   * does not write `id` into the notebook's scope. The ancestor chain is how that is told
   * apart: the nearest enclosing function must be the cell body itself.
   */
  const FUNCTIONS = new Set([
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
  ]);

  walkAncestor(body, {
    ReturnStatement(node: unknown, _state: unknown, ancestors: Node[]) {
      const enclosing = [...ancestors].reverse().find((one) => FUNCTIONS.has(one.type));
      if (enclosing !== body) return;

      sawReturn = true;
      describe((node as { argument: unknown }).argument);
    },
  });

  // A cell with no return at all writes nothing, and that is certain rather than unknown.
  if (!sawReturn) return { names: [], known: true };

  return { names: [...names], known };
}

/**
 * Whether the code parses, and where it does not.
 *
 * The check that was missing: `compileNotebook` reads structure and never looked at a line
 * of code, which is how a cell containing nothing but a markdown fence was stored, passed
 * the compiler, and was reported as a success.
 */
export function jsSyntaxProblem(code: string): string | null {
  if (code.trim() === "") return null;
  try {
    parse(wrap(code), { ecmaVersion: "latest", sourceType: "script" });
    return null;
  } catch (err) {
    const error = err as Error & { loc?: { line: number; column: number } };
    const where = error.loc
      ? ` (line ${Math.max(1, error.loc.line - WRAPPER_LINES)}, column ${error.loc.column + 1})`
      : "";
    return `${error.message.replace(/\s*\(\d+:\d+\)\s*$/, "")}${where}`;
  }
}
