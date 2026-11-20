#!/usr/bin/env bash
#
# Remove zaatool from this machine, and nothing else.
#
#   ./scripts/uninstall.sh                  # remove the containers and images; KEEP the data
#   ./scripts/uninstall.sh --purge          # also delete the database and stored files (asks first)
#   ./scripts/uninstall.sh --purge --yes    # the same without the question
#
# It acts on this folder's compose project only (docker compose down --rmi all, plus
# --volumes with --purge): it never runs `docker system prune` and never touches another
# project, a reverse proxy you run yourself, or the files in this folder. Without --purge
# the data volumes stay, so installing again brings back the same accounts and notebooks.
#
# Before --purge it offers a last backup (pg_dump, the storage folder, a copy of .env) in
# ./backups. --purge --yes takes that backup too; --no-backup skips it.

set -euo pipefail

cd "$(dirname "$0")/.."

PURGE="no"
YES="no"
BACKUP="ask"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --purge) PURGE="yes"; shift ;;
    --yes) YES="yes"; shift ;;
    --no-backup) BACKUP="no"; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "uninstall.sh: unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "uninstall.sh: docker is not installed or not on PATH" >&2; exit 1; }

COMPOSE=(docker compose)
PROJECT="$("${COMPOSE[@]}" config --format json 2>/dev/null | sed -n 's/^  *"name": *"\([^"]*\)".*/\1/p' | head -n 1)"
PROJECT="${PROJECT:-$(basename "$(pwd)")}"

# Every profile, so a bundled Caddy is removed too whether or not .env still switches it on.
COMPOSE+=(--profile caddy)

echo "Compose project: $PROJECT (folder $(pwd))"
echo
echo "Containers and volumes of this project:"
"${COMPOSE[@]}" ps -a --format 'table {{.Name}}\t{{.Status}}' 2>/dev/null || true
docker volume ls --filter "label=com.docker.compose.project=$PROJECT" --format '  volume {{.Name}}' 2>/dev/null || true
echo

if [ "$PURGE" = "yes" ]; then
  if [ "$YES" != "yes" ]; then
    echo "--purge DELETES the database and every stored file of '$PROJECT'. This cannot be undone."
    if [ ! -t 0 ]; then
      echo "uninstall.sh: no terminal to ask on; add --yes if you are sure." >&2
      exit 1
    fi
    read -r -p "Type the project name ($PROJECT) to go on: " typed
    if [ "$typed" != "$PROJECT" ]; then
      echo "Not the name; nothing was changed."
      exit 1
    fi
  fi

  if [ "$BACKUP" = "ask" ]; then
    if [ "$YES" = "yes" ]; then
      BACKUP="yes"
    else
      read -r -p "Take a last backup into ./backups first? [Y/n] " answer
      case "$answer" in n|N|no|NO) BACKUP="no" ;; *) BACKUP="yes" ;; esac
    fi
  fi

  if [ "$BACKUP" = "yes" ]; then
    STAMP="$(date +%Y%m%d-%H%M%S)"
    mkdir -p backups
    if [ -f .env ]; then
      set -a
      # shellcheck disable=SC1091
      source .env
      set +a
    fi
    if "${COMPOSE[@]}" exec -T postgres true >/dev/null 2>&1; then
      echo "==> backups/zaatool-final-$STAMP.sql"
      "${COMPOSE[@]}" exec -T postgres pg_dump -U "${POSTGRES_USER:-zaa_user}" -d "${POSTGRES_DB:-zaa_tool}" > "backups/zaatool-final-$STAMP.sql"
      if [ ! -s "backups/zaatool-final-$STAMP.sql" ]; then
        rm -f "backups/zaatool-final-$STAMP.sql"
        echo "uninstall.sh: the database dump is empty; nothing was changed." >&2
        exit 1
      fi
      echo "==> backups/storage-final-$STAMP.tar"
      "${COMPOSE[@]}" exec -T engine tar -cf - -C /app/packages storage > "backups/storage-final-$STAMP.tar"
      if [ ! -s "backups/storage-final-$STAMP.tar" ]; then
        rm -f "backups/storage-final-$STAMP.tar"
        echo "uninstall.sh: the storage archive is empty; nothing was changed." >&2
        exit 1
      fi
    else
      echo "The database container is not running, so it cannot be dumped. Start it (docker compose up -d postgres)" >&2
      echo "and run this again, or use --no-backup if you really want no copy." >&2
      exit 1
    fi
    if [ -f .env ]; then
      echo "==> backups/env-final-$STAMP  (the SECRETS_KEY in it is what opens the stored secrets)"
      ( umask 077; cp .env "backups/env-final-$STAMP" )
    fi
  fi

  echo "==> Removing containers, images and volumes of $PROJECT"
  "${COMPOSE[@]}" down --rmi all --volumes --remove-orphans
else
  echo "==> Removing containers and images of $PROJECT (the data volumes stay)"
  "${COMPOSE[@]}" down --rmi all --remove-orphans
fi

echo
echo "Done."
if [ "$PURGE" != "yes" ]; then
  echo "The data volumes are still here; running the installer again brings the same data back."
  echo "To delete them too: ./scripts/uninstall.sh --purge"
fi
echo
echo "What this script does not remove, because it is not its to remove:"
echo "  * the zaatool block in your Caddyfile (or nginx config), if you pasted one: delete it and reload;"
echo "  * this folder ($(pwd)) with .env, backups/ and Caddyfile: delete it yourself when you are sure"
echo "    (.env holds the SECRETS_KEY: without it, a restored database's secrets cannot be read);"
echo "  * the images postgres and caddy, if another project uses them (docker image ls)."
