#!/usr/bin/env bash
#
# Update a running installation.
#
#   ./scripts/update.sh
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

if [ ! -f .env ]; then
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
docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-zaa_user}" \
  -d "${POSTGRES_DB:-zaa_tool}" > "$BACKUP_FILE"

# A pg_dump that failed still leaves a file, and an empty file looks like a backup right
# up until the moment you need it.
if [ ! -s "$BACKUP_FILE" ]; then
  echo "The backup is empty. Stopping — nothing has been changed."
  rm -f "$BACKUP_FILE"
  exit 1
fi
echo "    $(wc -c < "$BACKUP_FILE") bytes"

# Files a notebook wrote are not in the database, and they are not replaceable either.
echo "==> Backing up storage to ${BACKUP_DIR}/storage-${STAMP}.tar"
docker compose exec -T engine tar -cf - -C /app/packages storage \
  > "${BACKUP_DIR}/storage-${STAMP}.tar"

echo "==> Pulling"
git pull --ff-only

# Stamped into both images so the Resources page can answer "is this what I deployed".
BUILD_VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
BUILD_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
export BUILD_VERSION BUILD_COMMIT
echo "    ${BUILD_VERSION} · ${BUILD_COMMIT}"

echo "==> Building and restarting"
docker compose up -d --build

echo "==> Waiting for the engine"
for attempt in $(seq 1 30); do
  if docker compose exec -T engine node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "    healthy after ${attempt}s"
    echo
    echo "Done. If something is wrong, the way back is:"
    echo "  docker compose down"
    echo "  git checkout ${BUILD_COMMIT}"
    echo "  docker compose exec -T postgres psql -U ${POSTGRES_USER:-zaa_user} -d ${POSTGRES_DB:-zaa_tool} < ${BACKUP_FILE}"
    exit 0
  fi
  sleep 1
done

echo
echo "The engine did not come up. Its log:"
docker compose logs --tail 40 engine
echo
echo "Your backup is at ${BACKUP_FILE}."
exit 1
