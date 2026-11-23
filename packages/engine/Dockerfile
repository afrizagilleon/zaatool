# The engine.
#
# Runs the TypeScript directly, with `tsx`, and that is a decision rather than a shortcut:
# `@zaa-tool/shared` is consumed as source by both packages, so a compiled `dist` would
# still need the shared sources beside it. One runtime, one copy of the code, and the
# thing running is the thing you read.
#
# `uv` is copied in because M21 made it the way a Python notebook gets its libraries. It
# is a single static binary; the alternative is a notebook that declares `pandas` and
# fails at 3am on a machine that cannot install it.

FROM node:24-bookworm-slim

# Python for `runtime: python` notebooks, and the certificates uv needs to fetch wheels.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pinned: a package manager that updates itself underneath a deployment is a deployment
# that changes without anyone deciding to change it.
COPY --from=ghcr.io/astral-sh/uv:0.9.11 /uv /usr/local/bin/uv

# The users cells run as (K-02, FX-20). The engine starts as root and spawns every cell
# process, JavaScript and Python and the uv run that installs packages, as a uid of its own
# *per owner*: the first time an account's notebook runs, the engine gives the account the
# next uid from SANDBOX_UID_BASE upwards (SANDBOX_UID_COUNT of them) and makes
# /home/sandbox/owners/<uid>, 0700 and theirs, for its HOME, temp folder and package cache.
# A cell cannot read the engine's environment, anything root-only, another owner's files or
# another owner's running cells' environment, and has no write access to /app. No user is
# created here: the uids exist only as numbers, which is all the kernel needs. The group is
# shared and gives nobody access to anybody.
#
# The trade-off, stated plainly: the engine itself stays root inside the container, because
# switching a child to another uid needs it. A flaw in the engine is therefore a root flaw
# inside the container (not on the host); the cells are what this separates from it.
RUN groupadd --system --gid 10001 sandbox \
    && mkdir -p /home/sandbox/owners \
    && chmod 0755 /home/sandbox \
    && chmod 0711 /home/sandbox/owners

# Nothing a cell does needs /tmp: each owner's TMPDIR is their own folder, and Python's
# tempfile, uv, numpy, pandas and matplotlib all follow it. A world-writable /tmp was a
# place to drop files for another owner's cells to find and a disk to fill without a limit
# (S-07). /dev/shm stays writable, because multiprocessing needs it; Docker caps it at 64 MB.
RUN chmod 0755 /tmp

WORKDIR /app
# Installed rather than activated through corepack. `devEngines.packageManager` in the root
# manifest carries a *range* (^11.6.0), and corepack refuses to run against anything that is
# not an exact version — so the shim fails before pnpm is ever reached.
RUN corepack disable && npm install --global --no-fund --no-audit --ignore-scripts pnpm@11.6.0

# Manifests first, so a change to a cell's code does not reinstall the world.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
# Scripts off for the install; bcrypt (native build) and esbuild (binary) need theirs, so only those run.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @zaa-tool/engine... && pnpm rebuild bcrypt esbuild

COPY packages/shared packages/shared
COPY packages/engine packages/engine

# `packages/storage` is not a package — despite the name and the workspace glob, it is the
# folder `STORAGE_DIR` points at, which is why nothing copies it in. It is made here and
# mounted as a volume in compose; without one, every file a notebook has ever written
# disappears on the next deploy.
#
# /app stays root-owned and is not writable by a cell. The storage folder is root's and
# closed (0700): a cell cannot enter it. What a cell may read of it is the copy of each input
# file the engine puts in the cell's own folder; files.write goes through the engine. (The
# engine also makes the folder root-only at start, which covers a volume made by an older
# image.)
RUN mkdir -p /app/packages/storage && chmod 0700 /app/packages/storage
VOLUME ["/app/packages/storage"]

# Stamped at build time and shown on the Resources page, because "which version is this"
# should be answerable from the app rather than from whoever last ran the deploy.
ARG BUILD_VERSION=dev
ARG BUILD_COMMIT=unknown
ENV BUILD_VERSION=$BUILD_VERSION \
    BUILD_COMMIT=$BUILD_COMMIT \
    NODE_ENV=production \
    SANDBOX_UID_BASE=20000 \
    SANDBOX_UID_COUNT=40000 \
    SANDBOX_GID=10001 \
    SANDBOX_HOME=/home/sandbox

EXPOSE 4000
WORKDIR /app/packages/engine
CMD ["pnpm", "exec", "tsx", "src/server-entry.ts"]
