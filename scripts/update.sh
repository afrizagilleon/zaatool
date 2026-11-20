#!/usr/bin/env bash
#
# Update a running installation.
#
#   ./scripts/update.sh                    # pull the images of ZAATOOL_VERSION (from .env) and restart
#   ./scripts/update.sh --version v1.3.0   # move to that release first (writes ZAATOOL_VERSION in .env)
#   ./scripts/update.sh --build            # source checkout: git pull, then build the images here
#
# The order matters and it is the whole content of this script: **take the backup before
# anything else**. The engine runs its migrations on startup, so by the time you know an
# update went badly, it has already touched the schema. A dump taken afterwards is a dump
# of the problem.
#
# Backups land in ./backups and nothing deletes them. Disk is cheaper than the afternoon
# you would spend without one.

set -euo pipefail

cd "$(dirname "$0")/.."

MODE="pull"
NEW_VERSION=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --build) MODE="build"; shift ;;
    --version) [[ "$#" -ge 2 ]] || { echo "--version needs a tag"; exit 1; }; NEW_VERSION="$2"; shift 2 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# {0,1}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

COMPOSE=(docker compose)
if [[ "$MODE" = "build" ]]; then
  COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.build.yml)
fi

if [[ ! -f .env ]]; then
  echo "No .env here. Copy .env.example to .env and fill it in first."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="backups"
BACKUP_FILE="${BACKUP_DIR}/zaatool-${STAMP}.sql"

mkdir -p "$BACKUP_DIR"

echo "==> Backing up the database to ${BACKUP_FILE}"
"${COMPOSE[@]}" exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-zaa_user}" \
  -d "${POSTGRES_DB:-zaa_tool}" > "$BACKUP_FILE"

# A pg_dump that failed still leaves a file, and an empty file looks like a backup right
# up until the moment you need it.
if [[ ! -s "$BACKUP_FILE" ]]; then
  echo "The backup is empty. Stopping — nothing has been changed."
  rm -f "$BACKUP_FILE"
  exit 1
fi
echo "    $(wc -c < "$BACKUP_FILE") bytes"

# Files a notebook wrote are not in the database, and they are not replaceable either.
echo "==> Backing up storage to ${BACKUP_DIR}/storage-${STAMP}.tar"
"${COMPOSE[@]}" exec -T engine tar -cf - -C /app/packages storage \
  > "${BACKUP_DIR}/storage-${STAMP}.tar"

if [[ "$MODE" = "build" ]]; then
  echo "==> Pulling the source"
  git pull --ff-only

  # Stamped into both images so the Resources page can answer "is this what I deployed".
  BUILD_VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
  BUILD_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  export BUILD_VERSION BUILD_COMMIT
  echo "    ${BUILD_VERSION} · ${BUILD_COMMIT}"

  echo "==> Building and restarting"
  "${COMPOSE[@]}" up -d --build
else
  if [[ -n "$NEW_VERSION" ]]; then
    echo "==> Moving to $NEW_VERSION (ZAATOOL_VERSION in .env)"
    if grep -q '^ZAATOOL_VERSION=' .env; then
      sed -i.bak "s|^ZAATOOL_VERSION=.*|ZAATOOL_VERSION=$NEW_VERSION|" .env && rm -f .env.bak
    else
      printf '
ZAATOOL_VERSION=%s
' "$NEW_VERSION" >> .env
    fi
    ZAATOOL_VERSION="$NEW_VERSION"
    export ZAATOOL_VERSION
  fi
  echo "==> Pulling the images (${ZAATOOL_VERSION:-latest})"
  "${COMPOSE[@]}" pull engine web
  echo "==> Restarting"
  "${COMPOSE[@]}" up -d
fi

echo "==> Waiting for the engine"
for attempt in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T engine node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "    healthy after ${attempt}s"
    echo
    echo "Done. If something is wrong, the way back is:"
    echo "  docker compose stop engine web"
    echo "  docker compose exec -T postgres dropdb   -U ${POSTGRES_USER:-zaa_user} ${POSTGRES_DB:-zaa_tool}"
    echo "  docker compose exec -T postgres createdb -U ${POSTGRES_USER:-zaa_user} ${POSTGRES_DB:-zaa_tool}"
    echo "  docker compose exec -T postgres psql -U ${POSTGRES_USER:-zaa_user} -d ${POSTGRES_DB:-zaa_tool} < ${BACKUP_FILE}"
    if [[ "$MODE" = "build" ]]; then
      echo "  git checkout <the previous commit>"
      echo "  docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build"
    else
      echo "  set ZAATOOL_VERSION in .env back to the previous release, then:"
      echo "  docker compose pull engine web && docker compose up -d"
    fi
    exit 0
  fi
  sleep 1
done

echo
echo "The engine did not come up. Its log:"
"${COMPOSE[@]}" logs --tail 40 engine
echo
echo "Your backup is at ${BACKUP_FILE}."
exit 1
