# Running zaatool somewhere that is not your laptop

One page. It assumes a machine with Docker on it and nothing else, and it is written to be
followed a year from now by someone who has forgotten all of this — which is probably you.

---

## Two things that bite on the first deploy

**One.** `JWT_SECRET` must be at least 32 characters, and the engine refuses to start in
production without one. That is deliberate. Generate it once, keep it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Changing it later signs everyone out **and** kills every share link and file link you have
ever handed out.

**Two.** `NODE_ENV` must be the exact string `production` — the check is `===`, so
`Production`, `prod`, or leaving it unset all fall through to a wide-open CORS policy.
`docker-compose.yml` already writes `NODE_ENV: production` literally for the `engine`
service, so this does not bite as long as you deploy through compose. It bites if you run
the engine outside compose — systemd, pm2, `node dist/` directly. If that is your plan,
check:

```bash
docker compose exec engine node -e "console.log(JSON.stringify(process.env.NODE_ENV))"
# must print exactly: "production"
```

---

## First time

```bash
git clone <your remote> zaatool && cd zaatool
cp .env.example .env
```

Fill in the two values that have no default:

```bash
# JWT_SECRET — sessions, share links and file links are all signed with this
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# POSTGRES_PASSWORD — anything long. Changing it later means changing it in the
# database volume too, so pick it now.
```

Then:

```bash
docker compose up -d --build
```

Three containers come up: `postgres`, `engine`, `web`. Only `web` publishes a port —
`8080` by default. Open `http://<machine>:8080`.

One origin serves everything: `web` is nginx, holding the bundle and proxying `/api`,
`/hooks`, `/mcp`, `/storage` and `/ws` to the engine. That is what makes a share link a
real URL, and it is why no cross-origin request happens at all. If you ever serve the
bundle from somewhere other than the engine, name the origins — otherwise production
accepts same-origin only:

```bash
CORS_ORIGINS=https://app.example.com,https://staging.example.com
```

**Rate limits count clients, not the proxy.** The login limiter (10 attempts per 15
minutes) and the webhook limiter key on the client address, which behind nginx exists only
in `X-Forwarded-For`. The engine trusts that header from loopback and private-network
peers (`TRUST_PROXY`, default `loopback, linklocal, uniquelocal`) and from no one else, so
the compose nginx is believed and a stranger reaching the engine directly cannot pick
their own address. If a load balancer sits in front of nginx on a public address, name
it: `TRUST_PROXY=1` (hop count) or a subnet list. Without that, every user shares one
bucket and one person typing a wrong password ten times locks everyone out.

**Put TLS in front of it.** Caddy, nginx, a cloud load balancer, whatever you already run.
Not optional: sessions and share tokens travel in headers, and the microphone in a
notebook's page will not work at all without HTTPS.

**Checking a fresh install actually works** — not just that it started:

```bash
docker compose ps
# three services: postgres, engine, web — all Up. postgres should say (healthy).

curl -fsS http://localhost:8080/api/health && echo " ← engine answered"
```

Then open `http://<machine>:8080` and **register the first account**. An installation with
no users at all always accepts the first one, and that account becomes `creator` — no need
to flip `ALLOW_REGISTRATION`.

The test that is easiest to skip and matters most: **create one notebook, deploy it, run
it.** An installation that can log in but cannot execute anything has proven nothing yet.

> **If it fails:** `docker compose logs --tail 40 engine`. Two failures look like bugs on
> first encounter and are not: `Refusing to start: JWT_SECRET is not set`, and a notebook
> declaring `packages:` failing with a message about `uv` (only possible if you are not
> using the provided image — `uv` is baked into it).

---

## The first account

Registration is closed. There is one exception that cannot be configured away: an
installation with **no users at all** always accepts the first one, and that account
becomes the creator.

So open the app and register. That is the whole procedure.

If somebody beat you to it, or you need a second creator:

```bash
docker compose exec engine pnpm reset-password --list
docker compose exec engine pnpm reset-password <username> --role creator
```

A new password is generated and printed once. There is no email path and there will not be
one — this project has no mail server, and a reset link is only as trustworthy as the
mailbox it lands in. Whoever can reach this terminal owns the machine, which is the
authority a reset email is trying, badly, to stand in for.

To invite someone, sign in as a creator and either turn `ALLOW_REGISTRATION=true` on
briefly, or:

```bash
curl -X POST http://localhost:8080/api/auth/users \
  -H "Authorization: Bearer <your token>" \
  -H "Content-Type: application/json" \
  -d '{"username":"someone","password":"a long one","role":"viewer"}'
```

A `viewer` opens Apps and presses Run. A `creator` writes notebooks, deploys them, holds
secrets and uploads files.

---

## Backing up, any time

Automatic backups only happen when `./scripts/update.sh` runs. If you want one right now —
before trying something, or just on a schedule — there is no separate script for it. These
are the same two commands `update.sh` runs, and running them by hand is safe at any time,
including while the app is in use:

```bash
cd /path/to/zaatool
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)

# 1. The database.
docker compose exec -T postgres pg_dump -U zaa_user -d zaa_tool > backups/zaatool-$STAMP.sql

# 2. Files notebooks wrote. This is NOT in the database.
docker compose exec -T engine tar -cf - -C /app/packages storage > backups/storage-$STAMP.tar
```

**Check the result. This is the step that gets skipped:**

```bash
ls -lh backups/ | tail -2
```

A `pg_dump` that failed still leaves a file, and an empty file looks exactly like a backup
right up until you need it. Zero bytes or a few hundred = not a backup. Yours should be
tens of KB or more.

Both are required. The database holds notebooks, runs, secrets, and accounts; `storage`
holds uploaded and notebook-written files. Restoring only one leaves database rows pointing
at files that no longer exist.

Nothing deletes the contents of `backups/`. Prune old ones by hand occasionally.

---

## Updating

**Do not `git pull` first.** `./scripts/update.sh` does that itself, and the order is the
whole point — it takes a backup **before** pulling anything. Pull first and the backup you
end up with is a backup of the new code; if a new migration is what breaks, you are holding
a dump of the problem.

**Production should be on `main`** — or whatever branch is checked out in the production
folder, and that should be `main`. The script uses `git pull --ff-only`, which refuses to
merge anything that cannot fast-forward. So if the production checkout is accidentally on
`dev`, or has local commits, the script **stops** with a git error instead of merging
silently. Check first:

```bash
cd /path/to/zaatool
git status --short --branch
```

You want to see `## main...origin/main` and nothing else. If there are modified files in
production, find out why before running the script — `--ff-only` will fail on them.

Then, one command, from the repo root:

```bash
./scripts/update.sh
```

In order: back up the database, back up storage, `git pull --ff-only`, `docker compose up
-d --build`, wait up to 30s for the engine to answer healthy.

**If it stops partway through:** nothing is broken. The backup is taken first, and neither
`pull` nor `build` touch data. Read the message, fix it, run again.

**If the engine will not come up:** the script prints the last 40 lines of the engine's log
and where your backup landed, then exits 1. The way back is the restore procedure below —
the rollback line the script itself prints is intentionally the short version; use the full
procedure here, not that one-liner, if the schema has already changed.

To verify an update did not lose data, count something before and after:

```bash
docker compose exec -T postgres psql -U zaa_user -d zaa_tool -c \
  "SELECT 'notebooks' AS t, count(*) FROM notebooks
   UNION ALL SELECT 'runs', count(*) FROM notebook_runs
   UNION ALL SELECT 'secrets', count(*) FROM secrets
   UNION ALL SELECT 'users', count(*) FROM users;"
```

Same numbers before and after `update.sh` = pass.

**Behaviour change: triggers now follow the deployed version.** Older versions wrote the
trigger index from the *draft* every time a notebook was saved. The engine now rebuilds that
index from each notebook's deployed version every time it starts (never in the migration
itself), and a save no longer touches it. So after this update a cron or webhook that was
added to a draft **after** that notebook's last deploy — and that was firing until now —
stops firing until the notebook is deployed again, and a webhook whose secret was removed
only in the draft gets its secret back. Every such change is printed once at boot, one line
each:

```bash
docker compose logs engine | grep "Trigger index"
```

No lines means nothing changed. Notebooks that were never deployed have no triggers.

Two rules apply from the same update, and both refuse at deploy time with a message that
says why: a notebook cannot be deployed while another deployed notebook has the same name
(`notebooks.run("name")` in production looks names up among deployed notebooks, so two of
one name would be ambiguous), and a webhook with no `secretKey` needs a slug of at least 22
letters, digits, `-` or `_`. A notebook that is already deployed keeps running until you
next deploy it; it is only that deploy that can be refused.

---

## Restoring from a backup

The most important thing on this page. A backup that has never been restored is not a
backup — it is an archive of hope.

```bash
# 1. Stop what writes. Postgres stays up.
docker compose stop engine web

# 2. Drop and recreate the database. A plain psql restore into a database that
#    still has its schema fails on every CREATE TABLE — this step is not optional.
docker compose exec -T postgres dropdb   -U zaa_user zaa_tool
docker compose exec -T postgres createdb -U zaa_user zaa_tool

# 3. Pour the dump back in.
docker compose exec -T postgres psql -U zaa_user -d zaa_tool < backups/zaatool-<stamp>.sql

# 4. Bring back the files — these are NOT in the database.
docker compose start engine
docker compose exec -T engine tar -xf - -C /app/packages < backups/storage-<stamp>.tar

# 5. Start the rest.
docker compose start web
```

What to check: step 3 finishes with no `ERROR` lines. Run the counting query above and
compare it to the state when the backup was taken. Then **open a page that has a file on
it** and confirm the file actually renders — a database row pointing at a file that did not
come back looks fine in a query and broken on screen.

**Confirmed working, 2026-08-09**: backup → drop the postgres volume → restore → app runs
normally, files included.

---

## Checking what is running

Open **Resources**. The bottom line names the app's build and the engine's build.

They should match. When they do not, a browser is holding an old bundle — hard-refresh it.
The engine's own answer is also available without signing in:

```bash
curl http://localhost:8080/api/health
```

---

## What is where

| Thing | Where it lives | Backed up by `update.sh` |
|---|---|---|
| Notebooks, runs, secrets, users, share links | the `postgres_data` volume | yes |
| Files notebooks wrote or were sent | the `storage_data` volume | yes |
| Everything else | the images | rebuilt |

Two volumes. If you are copying an installation to another machine, those are the two
things to bring.

---

## What is deliberately not here

- **MinIO.** It was in `docker-compose.yml` from the beginning and nothing ever used it —
  storage is a folder on disk. A running service nobody uses is a password to rotate and a
  port to firewall.
- **Redis.** Nothing is shared between processes. The scheduler is one process and the run
  gate is one process, so a second engine would break on duplicated cron jobs long before
  it needed a cache. If you ever want two engines, that is the problem to solve first.
- **Two engine replicas**, for the same reason.

---

## If postgres goes down mid-run

Since FX10 (2026-08-09) the pool survives it: a `pool.on('error', ...)` listener stops a
dropped idle connection from taking the whole process down with it, internal driver errors
no longer reach an unauthenticated login screen, and the frontend no longer throws a raw
`SyntaxError` on a non-JSON response. No manual `docker compose restart engine` should be
needed after postgres comes back. If you see otherwise, that is a regression worth a report.

---

## When something else is wrong

```bash
docker compose logs -f engine        # what the engine is saying
docker compose logs --tail 50 web    # nginx, if pages are not loading at all
docker compose ps                    # what is actually up
```

Two refusals are deliberate and will look like failures the first time you meet them:

- **`Refusing to start: JWT_SECRET is not set`** — production will not fall back to the
  development secret, because that secret is in the repository. Set it in `.env`.
- **A notebook that declares `packages:` fails with a message about `uv`** — only possible
  if you are not using the provided image. `uv` is baked into it.

---

## Python libraries

A notebook declares them:

```yaml
runtime: python
packages: [pandas, "requests>=2.31"]
```

The environment is built before the first cell and cached, so the second run costs nothing.
Nothing needs installing on the host — the engine image carries `uv`.

JavaScript is the other way round: node's built-in modules always work, and beyond them a
cell may only use the short list the engine ships. Adding to that list is a change to the
engine, reviewed like any other, because a JavaScript package loads into the engine's own
process rather than a throwaway environment.
