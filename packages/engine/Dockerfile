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

# The user cells run as (K-02). The engine starts as root and spawns every cell process,
# JavaScript and Python and the uv run that installs packages, as this user (SANDBOX_UID
# below), so a cell cannot read the engine's environment or anything root-only, and has no
# write access to /app. Its home holds only its own temp folder and uv's cache.
#
# The trade-off, stated plainly: the engine itself stays root inside the container, because
# switching a child to another uid needs it. A flaw in the engine is therefore a root flaw
# inside the container (not on the host); the cells are what this separates from it.
RUN groupadd --system --gid 10001 sandbox \
    && useradd --system --uid 10001 --gid 10001 --home-dir /home/sandbox --create-home \
       --shell /usr/sbin/nologin sandbox \
    && mkdir -p /home/sandbox/tmp /home/sandbox/.cache/uv \
    && chown -R sandbox:sandbox /home/sandbox

WORKDIR /app
# Installed rather than activated through corepack. `devEngines.packageManager` in the root
# manifest carries a *range* (^11.6.0), and corepack refuses to run against anything that is
# not an exact version — so the shim fails before pnpm is ever reached.
RUN corepack disable && npm install --global --no-fund --no-audit pnpm@11.6.0

# Manifests first, so a change to a cell's code does not reinstall the world.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @zaa-tool/engine...

COPY packages/shared packages/shared
COPY packages/engine packages/engine

# `packages/storage` is not a package — despite the name and the workspace glob, it is the
# folder `STORAGE_DIR` points at, which is why nothing copies it in. It is made here and
# mounted as a volume in compose; without one, every file a notebook has ever written
# disappears on the next deploy.
#
# /app stays root-owned and is not writable by `sandbox`. The storage folder is readable by
# it: the engine writes with the default umask (755 folders, 644 files), and a cell reads the
# files it was given as inputs from there. It cannot write to it; files.write goes through
# the engine.
RUN mkdir -p /app/packages/storage
VOLUME ["/app/packages/storage"]

# Stamped at build time and shown on the Resources page, because "which version is this"
# should be answerable from the app rather than from whoever last ran the deploy.
ARG BUILD_VERSION=dev
ARG BUILD_COMMIT=unknown
ENV BUILD_VERSION=$BUILD_VERSION \
    BUILD_COMMIT=$BUILD_COMMIT \
    NODE_ENV=production \
    SANDBOX_UID=10001 \
    SANDBOX_GID=10001 \
    SANDBOX_HOME=/home/sandbox

EXPOSE 4000
WORKDIR /app/packages/engine
CMD ["pnpm", "exec", "tsx", "src/server-entry.ts"]
