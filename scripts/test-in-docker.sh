#!/usr/bin/env bash
#
# Runs the whole engine test suite inside the engine image, on Linux, as root, with the
# sandbox on: the conditions the real deployment has and a Windows or macOS laptop does not
# (per-owner uids, prlimit, /proc, symlink semantics). Windows-only runs have hidden Linux
# bugs before.
#
#   ./scripts/test-in-docker.sh                 # build the image from this checkout, run all
#   ./scripts/test-in-docker.sh owner-disk      # one test file (substring, as `pnpm test <x>`)
#   IMAGE=zaatool-engine:x ./scripts/test-in-docker.sh   # use an image already built
#
# A throwaway Postgres runs on a throwaway docker network; both are removed when the script
# ends, including when it fails or is interrupted. The image it builds is removed too, unless
# it was given with IMAGE. Exit status is the suite's.
#
# Needs: docker. The container is started the way production starts it: through the image's
# entrypoint (tini as PID 1, then the cell firewall, which then drops NET_ADMIN), with
# `--cap-add NET_ADMIN --cap-add SYS_RESOURCE` (compose gives the engine both), and with the
# sandbox the image configures. A few tests read repository files the engine image does not
# contain (docker-compose.yml, three files of the web package); those are mounted read-only,
# nothing else is; web-alignment also needs `@zaa-tool/shared` to resolve from there, so the container
# links it into place before running the suite.

set -uo pipefail

# Git Bash on Windows rewrites a path such as /app/docker-compose.yml in an argument into
# C:/Program Files/Git/app/..., which silently breaks the -v mounts below. Harmless elsewhere.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.." || exit 1
command -v docker >/dev/null 2>&1 || { echo "test-in-docker.sh: docker is not installed or not on PATH" >&2; exit 1; }

FILTER="${1:-}"
RUN_ID="$$-$(date +%s)"
NETWORK="zaatool-test-net-$RUN_ID"
DB_CONTAINER="zaatool-test-db-$RUN_ID"
TEST_CONTAINER="zaatool-test-run-$RUN_ID"
BUILT_IMAGE=""
IMAGE="${IMAGE:-}"

cleanup() {
  docker rm -f "$TEST_CONTAINER" "$DB_CONTAINER" >/dev/null 2>&1
  docker network rm "$NETWORK" >/dev/null 2>&1
  if [ -n "$BUILT_IMAGE" ]; then docker rmi "$BUILT_IMAGE" >/dev/null 2>&1; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [ -z "$IMAGE" ]; then
  BUILT_IMAGE="zaatool-test-engine:$RUN_ID"
  IMAGE="$BUILT_IMAGE"
  echo "== building $IMAGE"
  docker build -q -f packages/engine/Dockerfile -t "$IMAGE" . >/dev/null || { echo "image build failed" >&2; exit 1; }
fi

echo "== starting Postgres on $NETWORK"
docker network create "$NETWORK" >/dev/null || exit 1
docker run -d --name "$DB_CONTAINER" --network "$NETWORK" \
  -e POSTGRES_USER=zaa_user -e POSTGRES_PASSWORD=zaa_password -e POSTGRES_DB=zaa_tool \
  postgres:15-alpine >/dev/null || exit 1

for _ in $(seq 1 60); do
  docker exec "$DB_CONTAINER" pg_isready -h 127.0.0.1 -U zaa_user -d zaa_tool >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$DB_CONTAINER" pg_isready -h 127.0.0.1 -U zaa_user -d zaa_tool >/dev/null 2>&1 || { echo "Postgres did not become ready" >&2; exit 1; }

echo "== running the suite${FILTER:+ ($FILTER)} as root, sandbox on"
# NODE_ENV is development here: the image sets production, which refuses to start without
# secrets the tests do not have. The SANDBOX_* values come from the image, so the sandbox
# is exactly the one that ships. The suite is the one inside the image (the build copied
# packages/engine, tests included), not a mount; only the files named above are mounted.
# shellcheck disable=SC2086
docker run --name "$TEST_CONTAINER" --network "$NETWORK" \
  --cap-add NET_ADMIN --cap-add SYS_RESOURCE --memory 3g ${EXTRA_DOCKER_ARGS:-} \
  -v "$PWD/docker-compose.yml:/app/docker-compose.yml:ro" \
  -v "$PWD/packages/web/nginx.conf:/app/packages/web/nginx.conf:ro" \
  -v "$PWD/packages/web/vite.config.ts:/app/packages/web/vite.config.ts:ro" \
  -v "$PWD/packages/web/src/lib:/app/packages/web/src/lib:ro" \
  -e NODE_ENV=development \
  -e POSTGRES_HOST="$DB_CONTAINER" -e POSTGRES_PORT=5432 \
  -e POSTGRES_USER=zaa_user -e POSTGRES_PASSWORD=zaa_password -e POSTGRES_DB=zaa_tool \
  "$IMAGE" sh -c 'mkdir -p /app/packages/web/node_modules/@zaa-tool && ln -s /app/packages/shared /app/packages/web/node_modules/@zaa-tool/shared && exec pnpm test "$@"' sh ${FILTER:+"$FILTER"}
STATUS=$?

echo "== suite exited with $STATUS"
exit "$STATUS"
