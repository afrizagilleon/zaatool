# Running zaatool somewhere that is not your laptop

One page. It assumes a machine with Docker on it and nothing else, and it is written to be
followed a year from now by someone who has forgotten all of this — which is probably you.

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

**Put TLS in front of it.** Caddy, nginx, a cloud load balancer, whatever you already run.
Not optional: sessions and share tokens travel in headers, and the microphone in a
notebook's page will not work at all without HTTPS.

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

## Updating

```bash
./scripts/update.sh
```

It backs up the database **and** the storage folder before touching anything, then pulls,
rebuilds and waits for the engine to answer. The order is the point: the engine migrates on
startup, so a dump taken after an update is a dump of the problem.

Backups land in `./backups` and nothing deletes them.

Going back:

```bash
docker compose down
git checkout <the commit it printed>
docker compose exec -T postgres psql -U zaa_user -d zaa_tool < backups/zaatool-<stamp>.sql
docker compose up -d --build
```

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

## When something is wrong

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
