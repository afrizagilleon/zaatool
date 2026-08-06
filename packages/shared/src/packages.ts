/**
 * What a cell is allowed to import.
 *
 * The policy itself is the engine's — it is the engine that loads a JavaScript package
 * into its own worker and the engine that hands a Python requirement to `uv`. But the
 * editor has to state the same policy before anything is saved, or the only way to learn
 * that `pg` is refused is to deploy and watch a run fail.
 *
 * So the *list* and the *shape* live here, where both sides read them, and the judging
 * stays where it belongs. That is the difference between this and what it replaces: the
 * engine's allowlist and the editor's allowlist were never going to be two lists, because
 * there was never an editor list at all — the field simply did not exist in the UI.
 */

/**
 * JavaScript packages a cell may require, beyond node's own built-ins.
 *
 * Short on purpose. Everything here ships with the engine, so nothing is fetched at run
 * time and nothing can be added by writing a notebook — growing this list is a change to
 * the engine, reviewed like any other.
 *
 * Notably absent, and permanently: `pg`, `minio`, and anything else that holds a
 * connection to infrastructure this application owns.
 */
export const ALLOWED_JS_PACKAGES = ["yaml", "uuid", "zod"] as const;

/**
 * A Python requirement, as `uv` will read it.
 *
 * Deliberately permissive about *which* package and strict about the shape: `pandas`,
 * `pandas==2.2.0`, `python-dateutil>=2.8` are all fine, and anything carrying a path, a
 * URL, a shell character or a flag is not. A requirement is a name and a version, and
 * everything else people put in that field is a way of running something else.
 *
 * Not a `RegExp` literal shared between two callers, because a regex object carries
 * `lastIndex` and sharing one across `test` calls is a bug waiting for the day someone
 * adds the `g` flag. Each side builds its own from the same source.
 */
export const PYTHON_REQUIREMENT_SOURCE =
  "^[A-Za-z0-9][A-Za-z0-9._-]*(\\[[A-Za-z0-9,._-]+\\])?((==|>=|<=|~=|!=|>|<)[A-Za-z0-9._*+-]+)?$";
