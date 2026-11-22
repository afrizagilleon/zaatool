**zaatool __VERSION__**: self-hosted automation where the unit of work is a notebook. Write
JavaScript or Python cells (yourself or with an AI agent over MCP), deploy, and share the result
as a page, an HTTP endpoint and a tool an agent can call.

> **Status: working beta.** One maintainer, single node. Read
> [What it is not](https://github.com/afrizagilleon/zaatool#what-it-is-not) before you plan on it.

## What's new since __PREVIOUS__

<!-- CHANGES -->

## Install

You need a Linux server (or a laptop) with Docker and Docker Compose. Nothing is built on your
machine: the images come ready from GHCR. zaatool lives in one folder and one compose project, and
never touches anything else on the server.

**A server that already runs Caddy or nginx** (the common case):

```bash
curl -fsSL https://github.com/afrizagilleon/zaatool/releases/download/__VERSION__/install.sh \
  | bash -s -- --domain zaa.example.com --behind-proxy yes --start
```

It prints a Caddy block. Paste it into your Caddyfile and reload Caddy:

```
zaa.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

**A blank VPS with no proxy** (zaatool brings its own Caddy and HTTPS; ports 80 and 443 must be
free and the domain must already point at the server):

```bash
curl -fsSL https://github.com/afrizagilleon/zaatool/releases/download/__VERSION__/install.sh \
  | bash -s -- --domain zaa.example.com --with-caddy --start
```

**Just trying it on a laptop:**

```bash
curl -fsSL https://github.com/afrizagilleon/zaatool/releases/download/__VERSION__/install.sh \
  | bash -s -- --behind-proxy no --start
```

Then open `http://localhost:8080`, and add `COOKIE_SECURE=false` to `zaatool/.env` first if you
reach it over plain HTTP from another machine.

## First account

The installer prints a one-time **setup code** (also in `docker compose logs engine`). Open your
domain, register, and give the code: the first account becomes the `creator`. Nobody who opens the
URL before you can take it.

**Back up `zaatool/.env` somewhere safe, apart from the database backups.** It holds
`SECRETS_KEY`; without it, every secret stored in the app is lost.

## Day to day

```bash
cd zaatool
./scripts/status.sh                       # version, health, CPU/memory, disk, open ports
./scripts/update.sh --version __VERSION__ # backs up first, then moves to this release
./scripts/uninstall.sh                    # removes zaatool, keeps the data
./scripts/uninstall.sh --purge            # also deletes the data (offers a last backup first)
```

## Connect an agent

Create an agent token on the Resources page, then point an MCP client at
`https://zaa.example.com/mcp` with `Authorization: Bearer <token>`. Agents build and run
notebooks; deploying and sharing stay with you.

More: [DEPLOY.md](https://github.com/afrizagilleon/zaatool/blob/__VERSION__/DEPLOY.md) ·
[README](https://github.com/afrizagilleon/zaatool/blob/__VERSION__/README.md) ·
`SHA256SUMS` below lists the checksums of the attached files.
