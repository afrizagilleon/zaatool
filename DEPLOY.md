# Running zaatool somewhere that is not your laptop

One page. It assumes a machine with Docker on it and nothing else, and it is written to be
followed a year from now by someone who has forgotten all of this — which is probably you.

---

## Which of the three are you

| You have | Do this | Where |
|---|---|---|
| A server that **already runs a reverse proxy** (Caddy, nginx) and other things | the installer with `--behind-proxy yes`, then paste one block into your proxy | [Behind Caddy](#behind-caddy-on-a-server-that-already-runs-other-things) |
| A **blank VPS** with nothing on ports 80 and 443 | `--with-caddy --domain ...`: zaatool brings its own Caddy | [A blank VPS](#a-blank-vps-zaatool-brings-its-own-caddy) |
| A **laptop** or a machine to try it on | `--start` alone; open `http://localhost:8080` | [On a laptop](#on-a-laptop) |

Every path pulls prebuilt images from GHCR (`ghcr.io/afrizagilleon/zaatool-engine` and
`-web`), so the machine builds nothing. Building from source is covered at the end of this page.

### The one-liner

```bash
curl -fsSL https://github.com/afrizagilleon/zaatool/releases/latest/download/install.sh | bash -s -- [options] --start
```

The `install.sh` on a release page knows its own version: it downloads the `docker-compose.yml`,
`.env.example` and helper scripts of that tag, writes `ZAATOOL_VERSION=<tag>` into `.env` and starts
exactly that release. To install another release, take the script from its raw URL and name it:

```bash
curl -fsSL https://raw.githubusercontent.com/afrizagilleon/zaatool/v1.0.0/scripts/install.sh | bash -s -- --version v1.0.0 --start
```

Without `--version` the raw script installs `latest` and the files from `main`. Options: `--dir`
(default `./zaatool`), `--domain`, `--behind-proxy yes|no`, `--web-port`, `--tz`, `--with-caddy`,
`--force`, `--start`. Without `--start` it stops after writing `.env` and prints what to run.
`--start` waits up to 120 seconds for postgres, engine and web to report healthy, then prints the
setup code. It never overwrites an existing `.env`.

---

## Behind Caddy, on a server that already runs other things

This is the path for a machine that has a reverse proxy (Caddy) and other services on it.
zaatool is a guest there: it opens **one** port, on the loopback address only, publishes no
database port at all, and caps the engine's CPU and memory. Nothing in this procedure
touches Caddy or any other service for you.

1. **Write `.env`.** The installer fills in random secrets and asks whether a proxy runs
   on this host:

   ```bash
   curl -fsSL https://github.com/afrizagilleon/zaatool/releases/latest/download/install.sh | \
     bash -s -- --domain zaa.example.com --behind-proxy yes --web-port 8080 --tz Asia/Jakarta
   cd zaatool
   ```

   Leave the flags out and it asks. It never overwrites an existing `.env` (`--force`
   replaces it, keeping a copy) and never edits a Caddyfile. Add `--start` to do step 2
   in the same command. (From a source checkout, `./scripts/install.sh` takes the same flags.)
   With `--behind-proxy yes` it sets `WEB_BIND=127.0.0.1` and `TRUST_PROXY=2` (Caddy, then
   nginx in the web container, then the engine).

2. **Start the stack.**

   ```bash
   docker compose pull && docker compose up -d
   docker compose ps          # postgres, engine, web: all (healthy)
   ```

   The web container listens on `127.0.0.1:8080` (or the `--web-port` you gave). Only this
   machine can reach it. Postgres has no host port. The engine is limited to 2 GB of memory
   and 2 CPUs; change `ENGINE_MEMORY_LIMIT` / `ENGINE_CPU_LIMIT` in `.env` and run
   `docker compose up -d` again.

3. **Add the block the script printed to your Caddyfile** and reload Caddy yourself:

   ```
   zaa.example.com {
       reverse_proxy 127.0.0.1:8080
   }
   ```

   Caddy gets the certificate and the session cookie is `Secure`, which is why
   `COOKIE_SECURE` stays unset in this setup.

4. **Read the setup code.** While no account exists the engine prints a one-time code to
   its log when it starts. It is in memory only; a restart makes a new one.

   ```bash
   docker compose logs engine | grep -i setup
   ```

5. **Create the first account.** Open `https://zaa.example.com`, choose *Create the first
   one*, enter the setup code with your username and password. That account is the creator.
   Anyone who opens the URL before you cannot take it: without the code, registration
   answers 403.

   There is a way that needs no browser and no code, because whoever holds a terminal on
   the server owns it:

   ```bash
   docker compose exec engine pnpm create-user <username> --role creator
   ```

   For automation, set `SETUP_CODE` in `.env` to a value of your own (long and random) and
   the engine uses it instead of the generated one. It stops meaning anything once there
   is an account, but remove it from `.env` afterwards anyway.

**Without a proxy of your own**, see the next two sections. (Trying it on a VPS directly: `--behind-proxy no` sets
`WEB_BIND=0.0.0.0` and `TRUST_PROXY=1`, so the app is open to the whole network over plain
HTTP, and with no domain it sets `COOKIE_SECURE=false` (a browser never sends a Secure
cookie back over HTTP). That is a way to look at it, not a way to run it.

**What this does not isolate.** A notebook cell is code you or a creator wrote, and it has
outbound network access. The cell runs in a container on Docker's network, where the host
is reachable through the bridge gateway: another service on this machine that listens on
`0.0.0.0` (an agent, an admin panel, a database) can be called from a cell. Suggestion, not
something this repository tests: bind such services to `127.0.0.1` (which a container
cannot reach through the gateway) or protect them with their own authentication, and
give the creator role only to people you would let run code on this server.

---

## A blank VPS: zaatool brings its own Caddy

For a machine with nothing on ports 80 and 443. Do **not** use this on a server that already
has a proxy: the ports would collide, and zaatool does not take over servers (which is why it
is off unless you ask).

1. **DNS first.** Create an `A` record (and `AAAA` if the machine has IPv6) for the name,
   pointing at this machine, and wait until it resolves (`dig +short zaa.example.com`).
   Caddy asks Let's Encrypt for the certificate on its first start; if the name does not
   resolve to this machine yet the request fails, and Let's Encrypt rate-limits repeated
   failures. Ports 80 and 443 (TCP, and 443/UDP for HTTP/3) must be open in the firewall.
2. **Install:**

   ```bash
   curl -fsSL https://github.com/afrizagilleon/zaatool/releases/latest/download/install.sh | \
     bash -s -- --with-caddy --domain zaa.example.com --tz Asia/Jakarta --start
   ```

   `--with-caddy` writes a `Caddyfile` for the domain, sets `COMPOSE_PROFILES=caddy` and
   `PUBLIC_DOMAIN` in `.env` (so every later `docker compose` in that folder includes Caddy),
   sets `TRUST_PROXY=2`, and writes a `docker-compose.override.yml` that stops publishing
   the web port on the host: Caddy reaches `web` over the compose network and is the only
   thing listening. (`ports: !reset` needs Docker Compose 2.24 or newer.)
3. Open `https://zaa.example.com` after a minute and create the first account as above.

---

## On a laptop

```bash
curl -fsSL https://github.com/afrizagilleon/zaatool/releases/latest/download/install.sh | bash -s -- --start
```

With no domain the installer sets `COOKIE_SECURE=false` and the web port listens on
`127.0.0.1:8080`; open `http://localhost:8080`. No proxy, no certificate, no DNS.

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

The installer does what follows for you. By hand, from a checkout:

```bash
git clone <your remote> zaatool && cd zaatool
cp .env.example .env
```

Fill in the three values that have no default:

```bash
# JWT_SECRET — sessions, share links and file links are all signed with this
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# SECRETS_KEY — encrypts the secrets in the database; read "The secrets key" below
openssl rand -hex 32

# POSTGRES_PASSWORD — anything long. Changing it later means changing it in the
# database volume too, so pick it now.
```

Then:

```bash
docker compose pull && docker compose up -d
```

(From a source checkout, with changes that are not released: see "Building from source" below.)

Three containers come up: `postgres`, `engine`, `web`. Only `web` publishes a port —
`8080` by default, on `127.0.0.1` (this machine only, so a reverse proxy on the same host
can reach it and nothing else can). Open `http://localhost:8080` on the machine itself. To try
it from another device without a proxy, set `WEB_BIND=0.0.0.0` and `COOKIE_SECURE=false` in
`.env` (plain HTTP). Postgres publishes no port; use `docker compose exec postgres psql ...`.

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
in `X-Forwarded-For`. Compose sets `TRUST_PROXY=1`: the engine believes exactly one hop,
the compose nginx, and keys each client on the address nginx saw. A client cannot pick its
own address by sending the header, because nginx appends the real one and only that last
entry is read. The engine publishes no port, so nothing reaches it without nginx.

If another proxy sits in front of nginx (Caddy for TLS, a load balancer, Cloudflare),
count it: `TRUST_PROXY=2`. Leave it at 1 and every user shares that proxy's bucket, so
one person typing a wrong password ten times locks everyone out. Set it higher than the
real number of proxies and a client can name its own address again.

Do not use the engine's own default (`loopback, linklocal, uniquelocal`, meant for
`pnpm dev`) behind nginx. It trusts every private address, and nginx sees a client on
a private address under Docker Desktop, rootless Docker, or a proxy on the same host.
That client then picks its own address and is never limited (K-28, tested on Docker
Desktop).

**Cron runs in one time zone.** Every notebook schedule is read in `CRON_TZ` (an IANA
name such as `Asia/Jakarta`; default `UTC`), not in the server's or the browser's zone, so
`0 9 * * *` means 09:00 there. An unknown name makes the engine refuse to start. Each
minute fires once; schedules that fell due while the engine was down are not replayed, and
the log says when the scheduler started. Compose passes `CRON_TZ` through from `.env`.

**Put TLS in front of it.** Caddy, nginx, a cloud load balancer, whatever you already run.
Not optional: the session cookie and share tokens travel with every request, and the
microphone in a notebook's page will not work at all without HTTPS. The session cookie is
marked `Secure` (see below), so over plain HTTP a browser will not send it back at all.

**How a browser signs in.** The web app does not keep a token anywhere a script can read.
Signing in makes the engine set a `zaa_session` cookie (`HttpOnly`, `SameSite=Lax`, valid
for 24 hours) and the browser attaches it itself. Three consequences:

- `COOKIE_SECURE` decides whether that cookie is `Secure`. Unset, it is on whenever the
  engine runs in production, which `docker-compose.yml` does. It is a setting and not
  "whatever the request looks like" because behind Caddy and then nginx the engine sees
  `X-Forwarded-Proto: http` (nginx overwrites it), so it cannot tell. To try the stack over
  plain HTTP with no TLS in front, set `COOKIE_SECURE=false` in `.env`. Otherwise the
  browser accepts the cookie and never sends it back, and sign-in seems to work and then
  signs you out on the very next request.
- Anything that changes data and is authenticated by the cookie must also carry an
  `X-Zaatool-Request: 1` header (the web app adds it), which is what stops another website
  from making your browser do it. Scripts that send `Authorization: Bearer <token>` do not
  need it. Login and register need it from everyone.
- A session can be ended. Changing a password, deactivating an account, `reset-password`
  on the terminal, and **Log out of all devices** (the account dialog; `POST
  /api/auth/logout-all`) each make every earlier session stop working at once, including
  `Bearer` tokens from `curl`. **Log out** only drops the cookie in that browser.

The WebSocket for run events refuses a browser whose `Origin` is not this site (or listed in
`CORS_ORIGINS`), since the cookie would otherwise ride along on a socket opened by any page
the visitor happens to have open.

The web app is served with a Content-Security-Policy: scripts only from the site itself,
none inline and no `eval`. If a proxy in front adds a CSP header of its own, both apply and
the stricter wins.

**Checking a fresh install actually works** — not just that it started:

```bash
docker compose ps
# three services: postgres, engine, web — all Up. postgres should say (healthy).

curl -fsS http://localhost:8080/api/health && echo " ← engine answered"
```

Then open `http://localhost:8080` (or your domain) and **register the first account** with the
setup code from the engine log: `docker compose logs engine | grep -i setup`. An installation
with no users at all accepts the first one, and that account becomes `creator` — no need to
flip `ALLOW_REGISTRATION`.

The test that is easiest to skip and matters most: **create one notebook, deploy it, run
it.** An installation that can log in but cannot execute anything has proven nothing yet.

> **If it fails:** `docker compose logs --tail 40 engine`. Two failures look like bugs on
> first encounter and are not: `Refusing to start: JWT_SECRET is not set`, and a notebook
> declaring `packages:` failing with a message about `uv` (only possible if you are not
> using the provided image — `uv` is baked into it).

---

## The first account

Registration is closed. There is one exception that cannot be configured away: an
installation with **no users at all** accepts the first one, and that account becomes the
creator. It is not open to just anyone who finds the URL first, though: the engine prints a
random one-time setup code to its log at startup, and the first registration must carry it.

```bash
docker compose logs engine | grep -i setup
```

Open the app, choose *Create the first one*, enter the code. A missing or wrong code is a
403. The code is kept in memory only (a restart makes a new one), and means nothing once an
account exists. `SETUP_CODE` in `.env` replaces the random code, and
`pnpm create-user <name> --role creator` inside the engine container needs no code at all.

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
# Signing in needs the X-Zaatool-Request header too; the reply's "token" is the Bearer value.
curl -X POST http://localhost:8080/api/auth/login \
  -H "X-Zaatool-Request: 1" -H "Content-Type: application/json" \
  -d '{"username":"you","password":"your password"}'

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

Both are required. The database holds notebooks, runs, secrets (encrypted, see below), and accounts; `storage`
holds uploaded and notebook-written files. Restoring only one leaves database rows pointing
at files that no longer exist.

Nothing deletes the contents of `backups/`. Prune old ones by hand occasionally.

---

## Updating

Two modes, same order: **the backup comes first**, because the engine migrates the schema on
startup and a dump taken afterwards is a dump of the problem.

**Installed from release images (the normal case):**

```bash
./scripts/update.sh --version v1.1.0     # back up, set ZAATOOL_VERSION in .env, pull, restart
./scripts/update.sh                      # same release again, e.g. to pick up a re-pushed latest
```

There is no git involved: the folder holds `docker-compose.yml`, `.env` and the scripts. Pin a
tag in `ZAATOOL_VERSION` (the installer does) so an update is something you chose; with
`latest` it is whatever was published last. To go back, put the previous tag in `.env` and run
`docker compose pull engine web && docker compose up -d`, after restoring the backup if the
schema changed (the restore procedure below).

**Installed from a source checkout** (`./scripts/update.sh --build`): the rest of this section.
**Do not `git pull` first.** The script does that itself, after the backup.

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
./scripts/update.sh --build
```

In order: back up the database, back up storage, `git pull --ff-only`, `docker compose -f
docker-compose.yml -f docker-compose.build.yml up -d --build`, wait up to 30s for the engine to
answer healthy.

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

## The secrets key

The values in the Secrets page are stored encrypted (AES-256-GCM) in the database, with the
key in `SECRETS_KEY` — 64 hex characters, made with `openssl rand -hex 32`. A `pg_dump` that
leaks does not open them.

- **Lose the key and every secret is gone.** There is no recovery. Keep a copy of `.env` (or
  just that line) somewhere other than where the database backups live: a backup next to its
  own key protects nothing, and a key that is only on the machine dies with the machine.
- The engine refuses to start in production without a valid key, and refuses to start with a
  key that does not open the secrets already in the database
  (`SECRETS_KEY tidak cocok dengan secret di database`). It never overwrites an encrypted
  secret. Restoring a backup therefore needs the `SECRETS_KEY` from when it was taken.
- Upgrading an installation that already has secrets: set `SECRETS_KEY` in `.env` and start.
  Secrets stored in plaintext are encrypted on that start (the log says how many).
- **Changing the key** is not an edit of `.env`. Re-encrypt first, in one transaction (all or
  nothing), then switch:

```bash
docker compose exec -e SECRETS_KEY=<old> -e NEW_SECRETS_KEY=$(openssl rand -hex 32) engine   pnpm rotate-secrets-key
# it prints the next step: put the new key in .env as SECRETS_KEY, then
docker compose up -d
```

  Note the new key before running it; the command does not store it anywhere.

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

```bash
./scripts/status.sh
```

Reads and changes nothing: the version the engine reports, each container's state and health,
CPU and memory, the size of the data volumes and of `backups/`, the ports published on the
host, and where `.env` is. Postgres, engine and web all carry a healthcheck, and `web` waits
for `engine` to be healthy, which waits for `postgres`.

Logs rotate on their own: each container keeps at most 3 files of 10 MB (`LOG_MAX_SIZE`,
`LOG_MAX_FILE` in `.env`), so they cannot fill the disk. A changed value applies when the
containers are recreated (`docker compose up -d --force-recreate`).

Open **Resources**. The bottom line names the app's build and the engine's build.

They should match. When they do not, a browser is holding an old bundle — hard-refresh it.
The engine's own answer is also available without signing in:

```bash
curl http://localhost:8080/api/health
```

---

## Removing zaatool

```bash
./scripts/uninstall.sh                 # containers, images, network of this project; data volumes stay
./scripts/uninstall.sh --purge         # also the database and stored files; asks you to type the project name
```

It touches this folder's compose project only: no `docker system prune`, nothing of another
project, nothing of a proxy you run. `--purge` first offers a last backup in `backups/` (a
database dump, the storage tar and a copy of `.env`, whose `SECRETS_KEY` opens the stored
secrets); `--purge --yes` skips the question but still takes the backup (`--no-backup` to
refuse it). It then prints what it left for you: the block in your Caddyfile, and the folder.

---

## Releasing (for the maintainer)

Images are built by GitHub Actions, not by hand. Once the work is on `main`:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The `release` workflow builds `linux/amd64` and `linux/arm64` images, pushes
`ghcr.io/afrizagilleon/zaatool-engine` and `-web` as `:v1.0.0` and `:latest`, and creates the
GitHub Release with `docker-compose.yml`, `.env.example`, `install.sh` (version embedded) and
`SHA256SUMS`. The first time, make the two packages public (GitHub profile, Packages, each
package, Package settings, Change visibility) or an installer on another machine cannot pull
them. `workflow_dispatch` publishes a test tag without a Release and without moving `latest`.

---

## Building from source

For changes that are not released yet, or to run exactly what is on disk:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

`docker-compose.build.yml` only adds `build:` to engine and web, with the same image names.
`./scripts/update.sh --build` and `./scripts/install.sh --start --build` do this for you.

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
- **`Refusing to start: SECRETS_KEY is not set`** (or `not 64 hex characters`) — see
  "The secrets key". Generate one with `openssl rand -hex 32`.
- **`Refusing to start: SECRETS_KEY tidak cocok dengan secret di database`** — the key in
  `.env` is not the one the secrets were encrypted with. Put the right one back; do not
  generate a new one.
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
engine, reviewed like any other, because a JavaScript package is read from the engine's own
`node_modules` rather than installed into a throwaway environment.

---

## What a cell can reach

Each cell is a process of its own. These settings shape it (all optional; the image sets the
`SANDBOX_*` ones):

- **`MAX_CELL_MEMORY_MB`** (default `512`) — heap limit of one JavaScript cell. A cell that
  exceeds it fails; the engine does not. It does not cap Python cells or memory held outside
  the JS heap.
- **`SANDBOX_UID_BASE`, `SANDBOX_UID_COUNT`, `SANDBOX_GID`, `SANDBOX_HOME`** — the
  unprivileged users cells (and the `uv` run that installs packages) are spawned as, **one
  per notebook owner**. The first time an account's notebook runs, the engine gives the account
  the next free uid, starting at `SANDBOX_UID_BASE` (default `20000`) and counting up to
  `SANDBOX_UID_COUNT` (default `40000`), and keeps it in the database (`users.sandbox_uid`).
  Every cell of that account's notebooks runs as it, so one owner's cells cannot read another
  owner's files, package cache or running cells' environment (secrets); the kernel refuses.
  When the range is used up, a notebook of a new owner fails with a message that names
  `SANDBOX_UID_COUNT`. `SANDBOX_GID` (default `10001`) is a group shared by all of them and
  is never what lets one owner into another's folder. `SANDBOX_HOME` (default `/home/sandbox`)
  holds `owners/<uid>`: each owner's HOME, temp folder, package cache and the folder every
  cell process is given (removed when it ends), all closed to everyone else. A uid already
  handed out that no longer fits the range after you change the base or count is replaced by a
  new one. The image sets these and needs the engine to run as root, which it does; if you set
  them on an engine that is not root, it refuses to start, because every cell would fail. On
  Windows they are ignored, with a warning.
  **`SANDBOX_UID`, the old single-user variable, is no longer read:** an engine that still
  has it set refuses to start, so remove it from your `.env` and compose file.
- A notebook **with no owner** does not run where cells change uid (there is no uid to give
  it); hand it to an account with `transfer-owner`.
- The **storage folder is closed to cells**: the engine makes it root-only (`0700`) at start,
  and a JavaScript cell is also refused it by node's permission model on every platform. A cell
  reads an input file from a copy the engine puts in the cell's own folder, and only if the run
  was allowed that file: a path into another owner's `notebooks/<id>/` or `uploads/<id>/`
  folder is refused as "file not found". A file a notebook returns through `notebooks.run` is
  copied to the caller the same way.

What this does not do: **the network is open** — a cell can connect to anything the server
can, the database port included (though it cannot read the password). If that matters, put
the engine on a network where the database is only reachable with credentials a cell does not
have, and firewall egress. Cells of the *same* owner share a uid, so they can see each other
(an owner's notebooks are one domain of trust), and the engine runs as root inside the
container. See "Sandboxing, honestly" in ARCHITECTURE.md.
