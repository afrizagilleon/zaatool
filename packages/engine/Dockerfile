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
RUN mkdir -p /app/packages/storage
VOLUME ["/app/packages/storage"]

# Stamped at build time and shown on the Resources page, because "which version is this"
# should be answerable from the app rather than from whoever last ran the deploy.
ARG BUILD_VERSION=dev
ARG BUILD_COMMIT=unknown
ENV BUILD_VERSION=$BUILD_VERSION \
    BUILD_COMMIT=$BUILD_COMMIT \
    NODE_ENV=production

EXPOSE 4000
WORKDIR /app/packages/engine
CMD ["pnpm", "exec", "tsx", "src/server-entry.ts"]
