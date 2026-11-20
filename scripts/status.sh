#!/usr/bin/env bash
#
# What zaatool is doing on this machine. Reads, never changes.
#
#   ./scripts/status.sh
#
# Shows the running version, each container's state and health, CPU and memory, the size of
# the data volumes and of ./backups, the ports published on the host, and where .env is.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

command -v docker >/dev/null 2>&1 || { echo "status.sh: docker is not installed or not on PATH" >&2; exit 1; }

COMPOSE=(docker compose)
PROJECT="$("${COMPOSE[@]}" config --format json 2>/dev/null | sed -n 's/^  *"name": *"\([^"]*\)".*/\1/p' | head -n 1)"
PROJECT="${PROJECT:-$(basename "$(pwd)")}"

section() { printf '\n== %s\n' "$1"; }

section "Project"
echo "name:    $PROJECT"
echo "folder:  $(pwd)"
if [[ -f .env ]]; then
  echo ".env:    $(pwd)/.env"
  ver="$(sed -n 's/^ZAATOOL_VERSION=//p' .env | tail -n 1)"
  echo "release: ${ver:-latest (ZAATOOL_VERSION not set)}"
else
  echo ".env:    NOT FOUND (docker compose will refuse to start without it)"
fi

section "Running version (/api/health)"
if health="$("${COMPOSE[@]}" exec -T engine node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>r.text()).then(t=>{console.log(t)}).catch(e=>{console.log('no answer: '+e.message);process.exit(1)})" 2>/dev/null)"; then
  echo "$health"
else
  echo "the engine does not answer (is it running? docker compose ps)"
fi

section "Containers"
ids="$("${COMPOSE[@]}" ps -a -q 2>/dev/null)"
if [[ -z "$ids" ]]; then
  echo "none: zaatool is not installed here, or it was removed"
else
  # shellcheck disable=SC2086
  docker inspect -f '{{.Name}}  state={{.State.Status}}  health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}  image={{.Config.Image}}' $ids | sed 's#^/##'
fi

section "CPU and memory"
running="$("${COMPOSE[@]}" ps -q 2>/dev/null)"
if [[ -n "$running" ]]; then
  # shellcheck disable=SC2086
  docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' $running
else
  echo "nothing is running"
fi

section "Volumes"
vols="$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null)"
if [[ -z "$vols" ]]; then
  echo "none"
else
  # `docker system df -v` is the one place Docker reports a volume's size; its volume rows
  # are "NAME LINKS SIZE".
  df="$(docker system df -v 2>/dev/null)"
  while IFS= read -r v; do
    size="$(printf '%s\n' "$df" | awk -v v="$v" '$1 == v { print $3 }')"
    echo "$v  ${size:-size unknown}"
  done <<< "$vols"
fi

section "Backups"
if [[ -d backups ]]; then
  echo "backups/: $(du -sh backups 2>/dev/null | cut -f1) in $(find backups -maxdepth 1 -type f | wc -l | tr -d ' ') files"
  # shellcheck disable=SC2012
  ls -1t backups 2>/dev/null | head -n 3 | sed 's/^/  newest: /'
else
  echo "no backups/ folder yet (scripts/update.sh makes the first one)"
fi

section "Ports published on this host"
if [[ -n "$ids" ]]; then
  # shellcheck disable=SC2086
  docker inspect -f '{{.Name}}{{range $p, $b := .NetworkSettings.Ports}}{{if $b}}  {{$p}} -> {{range $b}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}{{end}}' $ids | sed 's#^/##'
fi
