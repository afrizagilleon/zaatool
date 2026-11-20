# The browser side, built once and then served as files.
#
# The second stage is nginx rather than a node server on purpose: after `vite build` there
# is nothing to run. What nginx adds is the part that makes this a *deployment* rather than
# a folder — one origin for the app and the engine, so a share link is a URL on your domain
# and nothing has to be told where the API lives.

FROM node:24-bookworm-slim AS build

WORKDIR /app
# Installed rather than activated through corepack. `devEngines.packageManager` in the root
# manifest carries a *range* (^11.6.0), and corepack refuses to run against anything that is
# not an exact version — so the shim fails before pnpm is ever reached.
RUN corepack disable && npm install --global --no-fund --no-audit --ignore-scripts pnpm@11.6.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/web/package.json packages/web/
COPY packages/shared/package.json packages/shared/
# Scripts off for the install; esbuild (used by vite) needs its own, so only that one runs.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @zaa-tool/web... && pnpm rebuild esbuild

COPY packages/shared packages/shared
COPY packages/web packages/web

# Shown in the app. Baked in because a static bundle has no other way to know.
ARG BUILD_VERSION=dev
ARG BUILD_COMMIT=unknown
ENV VITE_BUILD_VERSION=$BUILD_VERSION \
    VITE_BUILD_COMMIT=$BUILD_COMMIT

RUN pnpm --filter @zaa-tool/web build

FROM nginx:1.27-alpine
# The `map` has to sit at http level, which conf.d is included into; the server block
# comes after it alphabetically, which is the only ordering nginx cares about here.
COPY packages/web/nginx-upgrade.conf /etc/nginx/conf.d/00-upgrade.conf
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 80
