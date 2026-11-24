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
| `actor.ts` | the typed *actor* (user, agent, webhook, cron, share, cli, system, anonymous) |
| `request-context.ts` | per-request context (AsyncLocalStorage): request id, actor, ip |
| `logger.ts` | the one way to write the operational log: JSON lines, redaction |
| `secret-redactor.ts` | replaces a run's secret values with `[secret:NAME]` |
| `run-projection.ts` | what a given reader may see of a run |

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
notebook-runner  ──▶ js-runner      (child node, --permission)
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

Each cell runs in a process of its own, in layers. What each layer enforces, and what it
does not:

**Enforced, every platform: JavaScript.** A JS cell is a child `node` started with
`--permission`. It can read its host script (`core/cell-host.mjs`), its own folder (the input files
the engine copied in) and the `node_modules` of the packages it declared; it cannot write any file, start a process
or a thread, or load a native addon. The runtime refuses these, so `module._load` and every
other route around the `require` list ends in `ERR_ACCESS_DENIED` — the list is only the
friendly message that comes first. Its environment is a small allow-list plus the secrets
it declared, never the engine's: those are handed over after the process has started and set
inside it, so they are not in `/proc/<pid>/environ`. Its heap is capped everywhere
(`MAX_CELL_MEMORY_MB`, default 512), and on Linux with the sandbox on the kernel caps the whole
process, off-heap `Buffer`s included, for JavaScript and for Python alike (`core/cell-limits`:
memory, number of processes and threads, largest file, no core dumps; Python has its own memory
limit, `MAX_PYTHON_CELL_MEMORY_MB`, default 1024). A cell that outgrows a limit fails and the
engine, a different process, carries on. Timeout, deadline and cancel kill the whole tree.

**Enforced on Linux/Docker: one group per owner, one uid per process.** The image starts the
engine as root and spawns every cell — JS, Python, and the `uv` run that installs a notebook's
packages — in the **notebook owner's group** and as a **uid of its own**. Each account gets its
own gid the first time one of its notebooks runs (`SANDBOX_UID_BASE` + allocation order, kept in
`users.sandbox_uid`), and its own folder `${SANDBOX_HOME}/owners/<gid>`: HOME, temp folder and
`uv` cache, shared by the owner's cells through the group (cells run with `umask 007`), and
root's, so a cell cannot replace them (C-01: the engine never `chown`s, `chmod`s or copies by
path inside anything a cell can write to; see `core/owner-home` and `core/workspace-fs`). Every
cell process leases a uid from the pool in `core/uid-sweep` and a folder of its own (that uid's,
0700) under the owner's; when it ends, a helper running as that uid kills everything the uid
left (a `setsid` child, a double-forked daemon), waits until nothing is left, removes the
folder's contents and the uid's files in `/dev/shm`, and only then is the uid used again. So a
cell cannot read the engine's environment or anything root-only, cannot write to `/app`, cannot
signal, trace or read the `/proc/<pid>/environ` of another cell — of its owner or any other,
which is where secrets are — and cannot read another owner's files or package cache. The
cell's own code is not on its command line (Python's wrapper is a file in its folder, 0600,
because `/proc/<pid>/cmdline` is readable by every user), and the engine makes each cell the
first choice of the kernel's OOM killer (`core/oom-guard`). The kernel enforces this; on JS cells
node's permission model sits on top. Python cells, which have no equivalent of the permission
model, rely on this layer alone. `packages:` for Python may name anything on PyPI (the shape of
the requirement is checked, and it is resolved to exact versions at deploy); installing runs
package code, so the `uv` run is a process like a cell, with the owner's group and a uid of its
own, under its own, looser limits (`MAX_INSTALL_*`). A JavaScript cell may name only a short list
shipped with the engine.

**Enforced on Linux/Docker: the network, per uid.** The entrypoint (tini first, so PID 1 reaps
orphaned cell processes) runs as root before the engine and puts an `iptables`/`ip6tables` chain
on every uid in `SANDBOX_UID_BASE`..`+SANDBOX_UID_COUNT-1`. Cells may use DNS (Docker's `127.0.0.11`
and the container's resolvers) and the internet; they are refused loopback (the engine's own port),
`10/8`, `172.16/12`, `192.168/16`, `169.254/16` (cloud metadata), `100.64/10` and `fc00::/7`,
`fe80::/10`, `::1`, so the database and every other container are out of reach. `CELL_EGRESS_ALLOW`
makes named exceptions. The entrypoint then drops only `CAP_NET_ADMIN` from the bounding set
(`setpriv`), so the engine cannot remove the rules and a cell, which has no capabilities, cannot
either. The engine proves the firewall at start by running a probe child as a cell uid against its
own loopback, and refuses to start if the connection succeeds, unless the operator set
`CELL_EGRESS_FIREWALL=off` (loud warning). The probe is the engine's own fixed code, so a cell
cannot influence the answer. `docker exec` shells get the container's full capability set: an
operator can change the rules, a cell cannot.

**Enforced: what a cell can read of storage.** The storage folder is root's and closed (0700) on
Linux, and a JS cell is refused it by the permission model on every platform. A cell gets only
copies the engine puts in its own folder before it starts: the run's `file` inputs, and files
that notebooks it called handed back or that the run itself wrote. A `file` input is admitted
only if its actor could open that path in the storage browser (the person who started the run,
or the owner for cron, webhooks and share links; for a nested call, the caller's owner), or if
it is under the notebook's own `uploads/<id>/` or `notebooks/<id>/`; anything else is refused
as "file not found".

**Enforced on Linux/Docker: disk, and who dies first.** The files an owner's cells leave
(temp folder, `uv` cache) are measured against `MAX_OWNER_DISK_MB` (default 2048) before each
cell, and an owner over it is refused while everybody else carries on (`core/owner-disk`; the
measuring never follows a symlink and never changes anything). Cleaning up is done by a process
with a cell's identity, never by root. The engine also writes `oom_score_adj` 1000 to every cell
(`core/oom-guard`), so when the container's memory runs out the kernel kills a cell before the
engine. That needs `SYS_RESOURCE`, which compose grants; without it the engine warns at start.

**Not enforced:**

- **The network is open to the internet, not to the inside.** On Linux/Docker an iptables firewall
  per cell uid (S-06; installed by the image's entrypoint, see "Enforced on Linux/Docker: the
  network" above) refuses cells loopback, the private ranges and the cloud metadata address. It
  covers only the container's own network namespace: `network_mode: host` has no such firewall
  for the host's services; and on Windows or a dev machine there is none at all. A cell can
  still reach anything on the public internet, and, if the operator allowed it with
  `CELL_EGRESS_ALLOW`, the destinations listed there. Node's permission model has no switch for
  the network, so JS cells rely on this layer too. `CELL_EGRESS_FIREWALL=off` removes the
  firewall on purpose (the engine warns loudly), and a cell can send anything it can read out to
  the internet.
- **Python on Windows or a dev machine has no isolation.** The `SANDBOX_*` variables are
  ignored on Windows and unset in development, and so are the limits, the disk quota, the
  firewall and the uid sweep: a Python cell there runs as the user who started the engine and
  can read storage, `.env` and everything else that user can, with only the timeout to stop it.
  On Windows its leftover child processes can also outlive it (`taskkill /T` only follows live
  parents). (A JS cell is still confined by the permission model there, and cannot call
  `process.kill`.) A production start on Windows warns about this. Windows is not a deploy target.
- **Cells of the same owner share files, not processes.** Two notebooks of one account can read
  and write each other's files in the owner's shared folders (temp, home, package cache); the
  owner is one domain of trust (an editor's cells run as the owner's uid, though a draft run by an editor gets the editor's own secrets, not the owner's). They cannot
  signal or read each other's processes. A cell can also fill the shared temp folder (up to the
  owner's disk quota, which it shares with the owner's other cells) or poison the shared package
  cache for its owner's next cells. A file a cell deliberately makes mode 0700 cannot be cleaned
  by another uid of the same owner; it still counts against that owner's quota.
- **Cells can read what is world-readable in the image.** `/app` is closed (directories 0711,
  files 0600, except what a JS cell needs to load), but `/etc`, `/usr` and the engine's
  `node_modules` are readable, as they are in any container. `/dev/shm` is writable by every
  cell (64 MB by default in Docker, shared) and is swept per uid, not rationed.
- **A notebook with no owner does not run** where cells change uid; there is no uid to give it.
- **The engine itself runs as root in the container.** Switching a child to another uid
  needs it. A flaw in the engine is a root flaw inside the container, not on the host.
- **Limits are ceilings, not reservations.** Several cells at once can add up to more than the
  container's memory limit; the kernel then kills a cell first (see above), but the run it was
  part of fails. A cell of a notebook that runs nested notebooks keeps its process while it waits.
- **The accounting is in memory, in one engine.** The pool of cell uids, the in-flight sweeps
  and the disk usage cache are not shared or persisted. That is safe with one engine per
  container, which is the only supported shape; a restart takes the cells with it. A uid whose
  sweep cannot be confirmed is retired until the engine restarts. The disk quota can be passed
  inside the 5-second window its usage is cached for.
- **Cells are separated by uid, not by namespace.** The sweep kills everything of a cell's uid
  (a `setsid` child, a double-forked daemon) the moment the cell is over, and nothing of
  another cell can be touched. A PID namespace per cell would be more thorough, and for
  notebooks from authors you do not know a separate runner container would be the real
  boundary; neither exists yet.

So: much stronger than it was, still **not a hardened boundary.** A notebook runs code on
your server with your server's network access. Give `creator` only to people you would give
a shell to. The JavaScript package list exists so that a cell cannot load the engine's own
dependencies (a database client, for one), not to contain a determined author; Python packages
are unrestricted by name.

---

## 5. Data

| Table | Holds |
|---|---|
| `notebooks` | the draft document, name, runtime, tags, `updated_at`, `owner_id`, `app_visibility` |
| `notebook_versions` | deployed snapshots, with `deployed_by_user_id` (whose secrets a production run uses) |
| `notebook_access` | who a notebook is shared with: `editor` or `app` rows |
| `notebook_runs` | run history, logs, outputs, `started_by`, and who really started it (`actor_type`, `agent_token_id`, `agent_client`, `trigger_id`, `share_id`) |
| `notebook_triggers` | index of triggers, rebuilt from the document on every save |
| `notebook_shares` | shared page links and password hashes |
| `secrets` | secret values, referenced by name from notebooks; each belongs to one account (`owner_id`) |
| `agent_tokens` | scoped MCP tokens, each acting as one account (`user_id`) |
| `users` | accounts (`creator` / `viewer`) |
| `audit_events` | the audit trail: append-only, hash-chained, no foreign keys (see "Logs and audit") |
| `files` | uploaded files |
| `skills` | reusable snippets |

**The document is the source of truth; indexes follow it.** `notebook_triggers` is rebuilt
from the document on every save rather than edited alongside it, because two things that
must agree, edited separately, eventually will not.

`db/initializer.ts` creates tables and columns. It never inserts rows — a fixture planted in
schema creation runs on every installation of the tool, forever. (The one allowed exception is
backfilling a column it has just added, in the same block that adds it, so the backfill runs
once: owners, and each existing secret copied to every creator.)

### Who sees what

A notebook has **one owner** and any number of **editors** the owner invites. *Editor* is a
permission on one notebook, not a kind of account: accounts stay `creator` or `viewer`, and only
a creator can own or edit anything. The deployed version is an **app**, used by everybody
(the default) or by people the owner names, who never see its source.

Every door — REST, MCP, the WebSocket, nested `notebooks.run`, webhooks, storage — asks the same
module, `services/notebook-access.service.ts`. None of them writes its own version of the
question. A notebook the caller may not see is answered **404, word for word the answer for a
notebook that does not exist**; nothing about it, not even that it is there, is theirs to know.

| | owner | editor | app user | anyone else |
|---|---|---|---|---|
| in the notebook list; read source and draft; save; run the draft; deploy and undeploy; share links; triggers; every run; cancel a run | yes | yes | no | 404 |
| delete the notebook; change who has access (editors, app visibility) | yes | no (403) | no | 404 |
| in the Apps list; run the deployed version with `args`; upload for the page | yes | yes | yes | 404 |
| runs they can read | all | all | only those they started | 404 |

An app user receives the **page** — name, description, inputs, outputs, layout, buttons — and never
a cell, the setup, secret names, triggers or packages. A run nobody started (a schedule, a
webhook, a share link) is the team's to read.

Consequences that are deliberate, and worth knowing before inviting someone:

- **Secrets belong to whoever made them, and a deployed version runs with its deployer's.** The
  owner's secrets go to the owner's own runs of the draft and to production runs of versions the
  *owner* deployed. A production run (a webhook, a schedule, a share link, a page, an app tool, and
  a notebook called from another notebook, which uses the *callee's* deployed version's deployer)
  uses the secrets of whoever deployed that version (`notebook_versions.deployed_by_user_id`),
  because deploying is the step where a human approves the code, and the approver's credentials
  go only to code they approved. An editor who deploys therefore gets the editor's secrets in
  production, never the owner's; the owner sees "production runs use X's secrets" in the deploy
  state, and redeploying makes the owner the deployer. A version with no recorded deployer (a
  legacy row) falls back to the owner and logs `secrets.deployer_unknown`. Transferring a notebook
  does not change a version's deployer. A draft run by an editor uses the *editor's own* secrets of
  the same names. In both cases, if the holder has none by that name the cell sees it as missing and
  the run log says so. Cell code can print or send anything it is handed, so nobody is handed
  credentials of someone who has not approved the code.
- **Run output is redacted and projected.** The values of a run's secrets are replaced by
  `[secret:NAME]` in everything the run stores or sends (raw, JSON/URL/hex/base64 forms): an
  accident guard, not a defence against an author who wants a secret out (that is what the rule
  above is for). Whoever is not an owner or editor of the notebook (app users, share links,
  webhook callers, another owner's notebook calling this one) is told only the run's status,
  timings, the notebook's declared outputs and a generic error. Never cell code, logs or
  intermediate values. A share link can follow only runs that link started. Finished runs are
  deleted after `RUN_RETENTION_DAYS` (default 90), and changing or deleting a secret rewrites the
  old value out of stored runs.
- **A notebook reaches only what its owner could use.** `notebooks.run` and page buttons resolve
  their target among the notebooks the *calling notebook's owner* may use as an app (or open, in
  a draft run). Anything else is "not found". A notebook with no owner calls nothing.
- **Agent tokens act as the account that made them.** An agent sees exactly what that person sees;
  `author` writes only while that person is still a creator and active. Tokens are listed and
  revoked by their owner only.
- **The WebSocket follows the same rule.** `watch` delivers only runs the account could read over
  REST, and catalog changes it could see (a save only to the team); `subscribe` to a run needs the
  right to read that run; a share link follows only runs of its own notebook.
- **Storage:** `notebooks/<id>/` and `uploads/<id>/` are hidden from, and unreadable by bearer
  path to, anyone who cannot edit that notebook. Signed links are unchanged. **Every other folder
  in storage stays shared among creators**, as it always was.
- **Deployed names stay unique across the installation** (see Draft vs deployed). A refused
  deploy can therefore reveal that somebody else's app already uses a name.
- **A notebook's code cannot read another owner's files either** (closes K-19, FX-20): cells run as
  the owner's own uid and cannot enter storage; see "Sandboxing, honestly". On Windows or a dev
  machine a *Python* cell is the exception, because there is no uid to drop to.

There is no administrator in the app. Recovery is on the server:
`pnpm --filter @zaa-tool/engine transfer-owner <from-username> <to-username> [--notebook <id>]`
(or `--orphaned` for notebooks nobody owns) moves notebooks and copies the secrets they name to the
new owner.


### Secrets: the short version

- **Who sees a value.** Nobody through the app: the Secrets page lists names, never values. A
  value reaches exactly one place, the process of a run whose binding names it.
- **Binding.** The owner's own runs use the owner's secrets. A draft run by an editor uses the
  *editor's* secrets of the same names. A production run (webhook, schedule, share link, page,
  app tool, nested call) uses the secrets of whoever *deployed* that version. A name the holder
  does not have is missing to the cell, and the run log says so. Details above, under "Who sees what".
- **Who sees a run.** Owners and editors see the whole run. App users, share visitors, webhook
  callers, other users' agents and cross-owner callers get status, timings, declared outputs and
  a generic error (`core/run-projection.ts`). The WebSocket applies the same rule: a share link's
  socket follows only runs started through that link (`notebook_runs.share_id`), and a
  non-editor socket receives only `run:done` and `run:error`.
- **Redaction is accident prevention, not a boundary.** One function (`core/secret-redactor.ts`)
  replaces a secret's value with `[secret:NAME]` in everything a run stores or sends: raw, JSON,
  URL-encoded, hex, and base64/base64url at every alignment, for values of at least 6 characters.
  Cell code that wants to leak a secret (split it, reverse it, post it to a server) can; that
  is why a secret is handed only to code its holder has approved. A secret spread over several
  log lines (a multi-line key) is not recognised.
- **Scrub and retention.** Changing or deleting a secret rewrites its old value out of stored
  runs. Finished runs are deleted after `RUN_RETENTION_DAYS` (default 90). Runs made before
  redaction show empty outputs on public pages, on purpose, with no fallback.
- **Public pages are not progressive.** Because non-editors get only the final projection, a
  shared page shows results when the run ends, not cell by cell.

### Logs and audit

Three streams, kept apart because they answer different questions and have different readers.

| Stream | Answers | Lives in | Kept |
|---|---|---|---|
| Operational log | What did the engine do, what went wrong? | stdout of `engine` and `web` (nginx) | Docker's rotation (10 x 50 MB), or wherever you ship it |
| Audit trail | Who changed what, who was refused? | table `audit_events` | `AUDIT_RETENTION_DAYS`, default 400 (`0` keeps everything) |
| Run output | What did this run print and return? | `notebook_runs` | `RUN_RETENTION_DAYS`, default 90, and the 50 newest per notebook |

A cell's output never goes into the operational log, and the operational log is never a record
of who did what to a notebook; that is the audit trail's job.

**Operational log** (`core/logger.ts`; `console.*` is gone from production paths and
`CONTRIBUTING.md` forbids it). One JSON object per line: `ts`, `level`, `service`, `event`
(stable dotted name), `msg`, the actor (`actor.type`, `actor.user_id`, ...) when known, and the
request's `request_id`, which is also the `X-Request-Id` response header and the `requestId`
in a 500. `http.request` is the access log; webhook slugs and share tokens are masked in the
path. Redaction: values under credential-named keys (password, token, secret, authorization,
cookie, api key, slug, setup code, signature...) are replaced at any depth, and a Postgres
error's `detail` (it quotes the failing row) is dropped. Unhandled errors end in one global
handler that logs the real error and answers a generic 500 with the request id.
`LOG_LEVEL` (`debug|info|warn|error`) and `LOG_FORMAT` (`json|pretty`) tune it. nginx writes
the same shape (`"service":"zaatool-web"`), masks `/hooks/`, `/a/` and `/api/shared/` and drops
the query string. The only credential deliberately logged is the setup code, as one
`auth.setup_code` line while no account exists.

**Actor model** (`core/actor.ts`). Every entry point sets an actor, so every log line and audit
row says who, in one vocabulary: `user` (session), `agent` (an MCP token: its id and label, the
owning user, and the `clientInfo` the client announced, which is self-reported and never
trusted), `webhook` and `cron` (identified by the trigger row, never by the slug), `share`
(the share row), `cli` (command and OS user), `system` (boot, reconciliation, cleanup) and
`anonymous`. Identity is the id; names are stored as they were at the time, so a row still
reads after a rename or delete. Runs carry the same attribution, and notebook authorship is
typed (`kind`, `userId`, `tokenId`) rather than a free-text name.

**Audit trail** (`services/audit.service.ts`). Each row: id, time, action (`noun.verb`),
outcome (`success`, `failure`, `denied`), actor, target (type, id, owner, name at the time), ip,
user agent, request id and a small `meta` (names and facts, never a value; strings are cleaned
of control characters and capped). What is recorded: sign-in, sign-out, register, first-account
setup, password change, logout everywhere, user create and role change; agent token issue,
revoke, session start and failed authentication; notebook deploy, undeploy, delete, transfer
and access changes; share create, revoke and failed share passwords; secret create, update and
delete, and `secrets_key.rotate`; run cancel; webhook receipt; authorisation refusals
(`authz.denied`); engine start; and the trail's own `audit.prune` and `audit.suppressed` (a
burst of identical refusals is collapsed into one row that counts them). Failed sign-ins are
recorded with outcome `failure`. Running a notebook is not an audit event: that is the run history.

*Tamper evidence.* The table has no foreign keys (a row about a deleted user or notebook is
the one somebody wants later), and a trigger refuses `UPDATE`, `DELETE` and `TRUNCATE` except
for the retention job. Each row stores `prev_hash` and `hash` (sha256 over its content and the
previous hash), so a changed or removed row in the middle breaks the chain.
`pnpm --filter @zaa-tool/engine audit-verify` recomputes it (exit 0 intact, 1 broken, naming
the first bad row). After pruning, the oldest remaining row is the anchor and its `prev_hash` is
printed, to compare with an export or the `audit.prune` event. **Limit:** a chain cannot show
that the newest rows were deleted, and whoever holds database superuser access can rewrite the
whole chain. Keep periodic JSONL exports (or ship them to a SIEM) somewhere the database host
cannot reach.

*Failure to write.* An audit write that fails is logged as `audit.write_failed` and does not
block the action. A full disk should not lock everybody out, including the creator who must
fix it. A lost row is visible in the operational log. This is a decision, not an oversight.

*Reading it.* `GET /api/audit` (filters: `action` prefix, `actorType`, `targetType`,
`targetId`, `outcome`; paged) and the **Audit** page in the app. A `creator` sees everything;
anyone else sees the events they performed and the events about things they own. No route
writes or deletes. `GET /api/audit/export?format=jsonl` streams JSON lines, oldest first, for
creators only: the way to a SIEM. A failed sign-in records the username that was typed (up to
64 characters), which can be a mistyped password; the visibility rule is what limits that.

**Revision rule on save.** Saving a notebook that already exists must say which revision it is
based on. A save with none is refused `428` (`code: "revision_required"`, with
`currentRevision`) and a stale one `409` (`code: "conflict"`). Editors with the notebook open are
told when someone else saves (`catalog:changed` carries `revision` and `by`), so they reload
instead of overwriting.

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
  resources/  files, secrets, skills, accounts, agent tokens
  ui/         primitives; each accepts its HTML element's props
hooks/        every fetch lives here — components never call fetch()
store/        Zustand, one slice per domain
lib/          pure helpers, unit-tested without React
```

| Concern | Library |
|---|---|
| Cell editing | CodeMirror 6 (`javascript`, `python`, `markdown`) |
| Charts | Recharts |
| Markdown output | react-markdown |
| System Map | @xyflow/react + dagre for layout |
| File and skill editing | Monaco |

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
| `packages/engine/tests` | 98 files — `node:test` + `tsx`, against a real Postgres |
| `packages/web/tests` | 34 files, 237 tests — Vitest + Testing Library |

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
