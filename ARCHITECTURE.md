# Architecture

How zaatool is built, and — where it matters — why it is built that way rather than the
obvious alternative. If you only want to run it, read [DEPLOY.md](DEPLOY.md) instead.

---

## 1. The shape

```
packages/
  shared/   TypeScript types only. No runtime logic, no side effects.
  engine/   Express 5 + WebSocket + the execution runtime.
  web/      React 19 + Vite + Tailwind + Zustand.
```

```
web  ──imports──▶  shared  ◀──imports──  engine

web  ✗  engine        never, in either direction
```

`shared` is the only channel between the two halves. A type used by both **must** live
there. This is not style — it is what stops the page's idea of an output and the engine's
idea of an output from drifting apart, which is a class of bug that does not announce
itself.

In production, three containers:

| Container | What it is |
|---|---|
| `web` | nginx serving the built static bundle |
| `engine` | one Node process — API, WebSocket, MCP, scheduler, executor |
| `postgres` | Postgres 15, bound to `127.0.0.1` only |

No Redis, no message broker, no object store. Everything the engine coordinates lives in
one process and one database, so there is nothing for a broker to coordinate *between*.
The day this needs a second engine node is the day that changes — until then a queue would
be infrastructure bought against a problem nobody has.

---

## 2. Engine layers

```
routes/       →  controllers/  →  services/  →  db/
              ↘  mcp/          ↗
                 core/   (pure logic: no Express, no SQL)
```

| Layer | Allowed to | Never |
|---|---|---|
| `routes/` | wire paths to controller methods, apply middleware | contain logic |
| `controllers/` | validate, call a service, respond | touch the database, hold business rules |
| `services/` | business rules, transactions, orchestration | see `req`/`res` |
| `core/` | pure functions — parse, compile, analyse, run | import Express or reach the database |
| `db/` | connection pool, schema creation | hold business rules |
| `mcp/` | expose the same services to agents | re-implement anything in `services/` |

`server-entry.ts` is the composition root. Everything is wired there and only there.

**The rule with teeth:** `mcp/` and `controllers/` are two doors into the *same* services.
An agent writing a notebook and a person writing a notebook go through the same validation,
the same compile check, the same save. When they did not, the second door quietly accepted
documents the first would have refused, and the notebooks it produced failed at run time
instead of at write time.

### `core/` — the interesting part

| File | Job |
|---|---|
| `notebook-text.ts` | the markdown text form ⇄ `NotebookJson`. Agents read and write this. |
| `notebook-compiler.ts` | `NotebookJson` → an executable plan; refuses what cannot run |
| `notebook-runner.ts` | walks the plan, sequential and parallel |
| `js-runner.ts` / `python-runner.ts` | actually execute a cell |
| `notebook-contract.ts` | binds and validates declared inputs |
| `notebook-outline.ts` | what each cell reads and writes, without running it |
| `notebook-edit.ts` | apply one cell edit to a document |
| `notebook-map.ts` | who calls whom, which trigger fires what |
| `notebook-packages.ts` | the package allow-list and version pinning |

---

## 3. A notebook, precisely

A notebook is an ordered list of **steps**. A step is either a **cell** (prose + code) or a
**parallel group** containing **lanes**, each of which is itself a list of steps.

```
steps:
  - cell        "load the CSV"          → writes `rows`
  - parallel
      lane A:  cell "summarise"         → reads `rows`, writes `summary`
      lane B:  cell "chart it"          → reads `rows`, writes `chart`
  - cell        "email the result"      → reads `summary`, `chart`
```

Cells share one scope, top to bottom. Lanes all see the scope as it stood at the fork; what
they write merges after the join. There is no wiring, because the order *is* the wiring.

### The contract

```yaml
inputs:
  - name: month
    type: string
    required: true
outputs:
  - name: summary
    render: markdown
  - name: sales
    render: bar
    x: region
```

This one declaration is read by four different things:

1. the page — to draw a form and, after the run, tiles
2. the HTTP endpoint — to reject bad arguments before a run starts
3. the MCP tool schema — so an agent sees typed parameters, not a blob
4. `notebook.run()` from another notebook — the reuse boundary

Four readers, one source. A feature that satisfies only the page is not finished.

### Draft vs deployed

Saving writes the **draft**. Deploying pins the current draft into `notebook_versions` and
points the notebook at it. Triggers, callers and agents all execute the *deployed* version.

Before this existed, saving was publishing: editing a notebook at 2pm changed what its
webhook did at 2:01. Survivable while only one person could edit; indefensible once an
agent could.

---

## 4. Executing a run

```
POST /api/notebooks/:id/run
      │
      ▼
notebook-execution.service
      │  compile the deployed (or draft) document → plan
      │  bind declared inputs           ── bad args? reject here, before a run row exists
      │  run gate                       ── too many concurrent runs? reject, no history left behind
      │  fetch only the secrets the plan names
      ▼
notebook-runner  ──▶ js-runner      (worker_threads)
                 ──▶ python-runner  (child process, uv)
      │
      │  events: cell:start · cell:log · cell:done · cell:error · run:done
      ▼
WebSocket  ──▶ the editor, the page, the shared page
recorder   ──▶ notebook_runs
```

Two ordering decisions worth naming:

- **Arguments are bound before the run id exists.** A rejected call is a rejected *request*,
  not a run that failed on its first cell and left a row behind.
- **A document is judged before it is stored, not after.** Saving first and reporting the
  compile afterwards is how a broken cell got stored with "Compiles." printed underneath it.

### Running one cell

The editor can run a single cell. Rather than keeping a live kernel, the engine replays the
scope that the cells above already produced, from their recorded runs. Cheap, stateless, and
correct as long as the earlier cells have run.

There is deliberately **no** range execution — the API takes one cell or all of them. Adding
"run until here" means adding a plan-truncation step in the engine; it is on the list.

### Sandboxing, honestly

JavaScript runs in a `worker_threads` worker. Python runs as a child process under `uv`,
with `packages:` resolved against an allow-list and pinned to exact versions.

This is **isolation, not a security boundary.** A notebook runs code on your server with
your server's network access. Give `creator` only to people you would give a shell to. The
package allow-list exists to stop typo-squatting and drive-by installs, not to contain a
determined author.

---

## 5. Data

| Table | Holds |
|---|---|
| `notebooks` | the draft document, name, runtime, tags, `updated_at` |
| `notebook_versions` | deployed snapshots |
| `notebook_runs` | run history, logs, outputs |
| `notebook_triggers` | index of triggers, rebuilt from the document on every save |
| `notebook_shares` | shared page links and password hashes |
| `secrets` | secret values, referenced by name from notebooks |
| `agent_tokens` | scoped MCP tokens |
| `users` | accounts (`creator` / `viewer`) |
| `files` | uploaded files |
| `skills` | reusable snippets |

**The document is the source of truth; indexes follow it.** `notebook_triggers` is rebuilt
from the document on every save rather than edited alongside it, because two things that
must agree, edited separately, eventually will not.

`db/initializer.ts` creates tables and columns. It never inserts rows — a fixture planted in
schema creation runs on every installation of the tool, forever.

---

## 6. Agents (MCP)

Mounted at `/mcp`, authenticated with scoped tokens:

| Scope | Can |
|---|---|
| `reader` | read and run |
| `author` | read, run, write, delete |

Registered: **13 tools**, one generated tool per deployed notebook, and a `conventions`
resource an agent reads before writing.

Three decisions that shaped this surface:

- **Partial reads.** `notebook_read` takes `part: outline | cell | setup | full` and
  **defaults to `outline`**. Reading twenty cells in full costs ~4,300 tokens; the outline
  costs a fraction and answers most questions. The cheap call is the default because a model
  that skips the description should land on the cheap one.
- **Partial writes.** `notebook_edit_cell` changes one cell. `notebook_edit_setup` changes
  one front-matter key. The alternative — resend the whole document — measurably lost
  `layout` and `actions` when a small model rewrote nineteen untouched cells from memory.
- **Optimistic concurrency.** Reads return `updated_at`; writes accept an optional
  `expected_updated_at` and refuse if it no longer matches. Optional on purpose: an older
  agent that does not send it behaves exactly as before.

---

## 7. Web

```
components/
  notebook/   the editor — cells, toolbar, contract, outline, triggers, map
  pages/      Apps: run a deployed notebook, arrange its outputs
    render/   one renderer per output shape
  map/        System Map (@xyflow/react — the only place it is used)
  ui/         primitives; each accepts its HTML element's props
hooks/        every fetch lives here — components never call fetch()
store/        Zustand, one slice per domain
lib/          pure helpers, unit-tested without React
```

Rules that are enforced rather than suggested:

- Components do not call `fetch()`. All API traffic goes through a hook.
- Notebook state (steps, runs, contract) lives in the store, not in component state.
- `components/ui/*` must be drop-in replacements for the HTML element they wrap.
- No inline styles — Tailwind only.

**Why the store and not props:** the editor, the preview and the toolbar all read the same
notebook. Threading it through props meant three components disagreeing about what "the
current notebook" was, depending on render order.

---

## 8. Testing

| | |
|---|---|
| `packages/engine/tests` | 35 files — `node:test` + `tsx`, against a real Postgres |
| `packages/web/tests` | 25 files, 179 tests — Vitest + Testing Library |

Conventions that exist because their absence cost something real:

- **Both packages must build.** `tsx` and `vitest` strip types without checking them, so a
  green suite does not prove the code compiles. `tsc` is a separate gate.
- **Fixtures are prefixed `zz-` and cleaned up.** Tests share a real database with a real
  installation.
- **A test must be able to fail for the right reason.** A test that passes with the fix
  reverted is not coverage; it is decoration.
- **A new component needs a caller.** A component test renders its component with
  hand-supplied props, so it passes perfectly for a feature that never appears on screen.
  `grep` for the caller.

---

## 9. Extension points

| To add | Do this | Not this |
|---|---|---|
| A language runtime | new file in `core/`, honour the runner contract | edit `notebook-runner.ts` |
| An output renderer | new file in `components/pages/render/` | branch inside an existing renderer |
| An agent tool | register in `mcp/notebook-tools.ts`, call an existing service | reimplement the service |
| A trigger kind | extend `NotebookTrigger` in `shared`, then the scheduler | special-case it at a call site |
| A UI variant | Tailwind/CVA props on the existing component | fork the component |

---

## 10. Things deliberately absent

Not oversights. If you are about to add one of these, that is a conversation first.

- **A queue.** One process; nothing to distribute.
- **Redis.** Nothing shared between machines, so no shared cache to hold.
- **An object store.** MinIO was wired in early and removed — files live on disk and in Postgres, and a second storage system was one more thing to back up for no benefit at this size.
- **Email.** No SMTP anywhere, which is why password reset is a CLI command instead of a link.
- **A canvas.** The drag-and-drop node graph was the original product and was retired on purpose. `@xyflow/react` survives for the read-only System Map only.
