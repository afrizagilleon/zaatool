#!/usr/bin/env bash
#
# Install zaatool: write .env with fresh secrets and, with --start, pull the images and start.
#
#   curl -fsSL https://github.com/afrizagilleon/zaatool/releases/latest/download/install.sh | bash -s -- --start
#   curl -fsSL https://raw.githubusercontent.com/afrizagilleon/zaatool/<tag>/scripts/install.sh | bash -s -- --version <tag> --start
#   ./scripts/install.sh --domain zaa.example.com --behind-proxy yes --web-port 8080 --tz Asia/Jakarta
#
# Two ways to run it:
#
#   * from a checkout (./scripts/install.sh): uses the .env.example and docker-compose.yml
#     beside it, and writes .env there;
#   * on its own (piped from curl, or copied to an empty machine): makes the folder --dir
#     (default ./zaatool), downloads docker-compose.yml, .env.example and the status, update
#     and uninstall scripts of the chosen version into it, and writes .env there.
#
# What it does, and no more:
#
#   * writes .env from .env.example with a random JWT_SECRET, POSTGRES_PASSWORD and SECRETS_KEY;
#   * sets how the web port is exposed (see --behind-proxy) and which release to run;
#   * prints the Caddy block for your domain and the commands that come next;
#   * with --start, pulls the images and starts the stack (nothing is built on this machine).
#
# What it does not do, on purpose: it never touches Caddy or anything else on this machine.
# zaatool is a guest on your server, not its owner; you paste the block. The one exception is
# --with-caddy, for a server that has no proxy: then zaatool runs its own Caddy container, in
# its own compose project, on ports 80 and 443.
#
# An existing .env is never overwritten. --force replaces it, after saving a copy beside it.
#
# Options:
#   --dir DIR               folder to install into when not run from a checkout (default ./zaatool)
#   --version TAG           the release to install, e.g. v1.0.0 (default: the version this script
#                           was published with; run from the repository, it is "latest")
#   --start                 pull the images, start the stack, wait until it is healthy (up to
#                           120 s), print the one-time setup code
#   --build                 with --start, build the images from this checkout instead of pulling
#                           (only from a checkout)
#   --with-caddy            also run a Caddy container that serves --domain with HTTPS (a server
#                           with no proxy of its own; needs ports 80 and 443 free and DNS
#                           pointing here)
#   --domain NAME           the public name Caddy will serve (omit it if there is none yet)
#   --behind-proxy yes|no   is there a reverse proxy (Caddy, nginx) on THIS host?
#                             yes: web listens on 127.0.0.1 only, TRUST_PROXY=2
#                             no:  web listens on every interface, TRUST_PROXY=1
#   --web-port N            host port for the web container (default 8080)
#   --tz NAME               IANA time zone for cron triggers (default UTC)
#   --output FILE           write here instead of ./.env
#   --force                 replace an existing .env and downloaded files (a copy of .env is kept)
#   -h, --help              this text
#
# Test hook: ZAATOOL_RAW_BASE replaces https://raw.githubusercontent.com/afrizagilleon/zaatool
# as the place the files are downloaded from (<base>/<ref>/<path>).
#
# Needs: bash, openssl, curl or wget, and the usual POSIX tools (awk, sed, tr).

# Filled in on the copy attached to a GitHub Release; empty in the repository.
EMBEDDED_VERSION=""

set -euo pipefail

DOMAIN=""
BEHIND_PROXY=""
WEB_PORT=""
TZ_NAME=""
OUTPUT=".env"
FORCE="no"
VERSION=""
DIR=""
START="no"
BUILD="no"
WITH_CADDY="no"

usage() {
  # Piped from curl there is no file to read the help from.
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
  else
    echo "Usage: install.sh [--dir DIR] [--version TAG] [--start] [--with-caddy] [--domain NAME]"
    echo "                  [--behind-proxy yes|no] [--web-port N] [--tz NAME] [--force]"
  fi
}

die() {
  echo "install.sh: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain) [ "$#" -ge 2 ] || die "--domain needs a value"; DOMAIN="$2"; shift 2 ;;
    --behind-proxy) [ "$#" -ge 2 ] || die "--behind-proxy needs yes or no"; BEHIND_PROXY="$2"; shift 2 ;;
    --web-port) [ "$#" -ge 2 ] || die "--web-port needs a number"; WEB_PORT="$2"; shift 2 ;;
    --tz) [ "$#" -ge 2 ] || die "--tz needs a time zone name"; TZ_NAME="$2"; shift 2 ;;
    --output) [ "$#" -ge 2 ] || die "--output needs a file name"; OUTPUT="$2"; shift 2 ;;
    --force) FORCE="yes"; shift ;;
    --dir) [ "$#" -ge 2 ] || die "--dir needs a folder"; DIR="$2"; shift 2 ;;
    --version) [ "$#" -ge 2 ] || die "--version needs a tag"; VERSION="$2"; shift 2 ;;
    --start) START="yes"; shift ;;
    --build) BUILD="yes"; shift ;;
    --with-caddy) WITH_CADDY="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

command -v openssl >/dev/null 2>&1 || die "openssl is required to make the secrets"

# Where are we? Piped from curl there is no script file, and BASH_SOURCE is empty.
REPO_MODE="no"
SRC="${BASH_SOURCE[0]:-}"
if [ -n "$SRC" ] && [ -f "$SRC" ]; then
  CHECKOUT="$(cd "$(dirname "$SRC")/.." && pwd)"
  if [ -f "$CHECKOUT/.env.example" ] && [ -f "$CHECKOUT/docker-compose.yml" ]; then
    REPO_MODE="yes"
  fi
fi

if [ -z "$VERSION" ]; then
  VERSION="$EMBEDDED_VERSION"
fi
if [ -z "$VERSION" ]; then
  VERSION="latest"
fi
case "$VERSION" in
  *[!A-Za-z0-9._-]*) die "the version should be a tag like v1.0.0, not '$VERSION'" ;;
esac
if [ "$BUILD" = "yes" ] && [ "$START" != "yes" ]; then
  die "--build goes with --start"
fi

fetch() {
  # fetch URL FILE
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "curl or wget is required to download $1"
  fi
}

download() {
  # download PATH [optional]: <base>/<ref>/PATH into ./PATH, never over an existing file
  # without --force. The optional ones only warn.
  local path="$1" optional="${2:-}" url="$BASE/$REF/$1"
  if [ -e "$path" ] && [ "$FORCE" != "yes" ]; then
    echo "==> Keeping the $path already in $(pwd) (--force downloads it again)"
    return 0
  fi
  echo "==> Downloading $path ($REF)"
  mkdir -p "$(dirname "$path")"
  if fetch "$url" "$path.part"; then
    mv "$path.part" "$path"
  else
    rm -f "$path.part"
    if [ -n "$optional" ]; then
      echo "    (could not download $url; skipped)" >&2
    else
      die "could not download $url"
    fi
  fi
}

if [ "$REPO_MODE" = "yes" ]; then
  [ -z "$DIR" ] || die "--dir is for installing without a checkout; this installs in $CHECKOUT"
  cd "$CHECKOUT"
else
  [ "$BUILD" != "yes" ] || die "--build needs a checkout of the source (run ./scripts/install.sh from it)"
  DIR="${DIR:-zaatool}"
  mkdir -p "$DIR"
  cd "$DIR"
  # A tag is also the git ref the files are published under; "latest" follows main.
  REF="$VERSION"
  if [ "$VERSION" = "latest" ]; then
    REF="main"
  fi
  BASE="${ZAATOOL_RAW_BASE:-https://raw.githubusercontent.com/afrizagilleon/zaatool}"
  download docker-compose.yml
  download .env.example
  for s in status.sh update.sh uninstall.sh; do
    download "scripts/$s" optional
    chmod +x "scripts/$s" 2>/dev/null || true
  done
fi

if [ -e "$OUTPUT" ] && [ "$FORCE" != "yes" ]; then
  echo "$OUTPUT already exists, so nothing was changed." >&2
  echo "Edit it by hand, or run again with --force to replace it (a copy is kept)." >&2
  exit 1
fi

# Questions are only asked of a person: with no terminal (a pipe, a provisioning script) a
# missing answer takes the safe default instead of hanging.
ask() {
  # ask VARNAME "question" "default"
  local name="$1" question="$2" default="$3" reply=""
  if [ -t 0 ]; then
    if [ -n "$default" ]; then
      read -r -p "$question [$default]: " reply || true
    else
      read -r -p "$question: " reply || true
    fi
  fi
  printf -v "$name" '%s' "${reply:-$default}"
}

if [ "$WITH_CADDY" = "yes" ]; then
  # Caddy is the proxy, and it is on this host.
  BEHIND_PROXY="yes"
fi
if [ -z "$BEHIND_PROXY" ]; then
  ask BEHIND_PROXY "Is a reverse proxy (Caddy, nginx) already running on this host? yes/no" "yes"
fi
case "$BEHIND_PROXY" in
  yes|y|Y|YES) BEHIND_PROXY="yes" ;;
  no|n|N|NO) BEHIND_PROXY="no" ;;
  *) die "--behind-proxy must be yes or no, not '$BEHIND_PROXY'" ;;
esac

if [ -z "$DOMAIN" ]; then
  ask DOMAIN "Public domain name for zaatool (empty if there is none yet)" ""
fi
if [ -z "$WEB_PORT" ]; then
  ask WEB_PORT "Host port for the web container" "8080"
fi
case "$WEB_PORT" in
  ''|*[!0-9]*) die "--web-port must be a number, not '$WEB_PORT'" ;;
esac
if [ "$WEB_PORT" -lt 1 ] || [ "$WEB_PORT" -gt 65535 ]; then
  die "--web-port must be between 1 and 65535"
fi
if [ -z "$TZ_NAME" ]; then
  ask TZ_NAME "Time zone cron triggers are read in (IANA name)" "UTC"
fi
case "$DOMAIN" in
  *[[:space:]/]*) die "the domain should be a bare name like zaa.example.com" ;;
esac
if [ "$WITH_CADDY" = "yes" ] && [ -z "$DOMAIN" ]; then
  die "--with-caddy needs --domain: Caddy asks for a certificate for that name"
fi

# Hex, so the values are safe in a dotenv file, in a connection string and in a shell.
JWT_SECRET="$(openssl rand -hex 32)"
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
# 32 bytes for AES-256-GCM. Losing it loses every secret stored in the app: back up .env
# separately from the database dumps (DEPLOY.md, "The secrets key").
SECRETS_KEY="$(openssl rand -hex 32)"

if [ "$BEHIND_PROXY" = "yes" ]; then
  WEB_BIND="127.0.0.1"
  TRUST_PROXY="2"
else
  WEB_BIND="0.0.0.0"
  TRUST_PROXY="1"
fi

# With no domain there is no certificate, and a Secure cookie is never sent back over HTTP:
# sign-in would seem to work and the next request would be signed out.
COOKIE_SECURE=""
if [ -z "$DOMAIN" ]; then
  COOKIE_SECURE="false"
fi

if [ -e "$OUTPUT" ]; then
  BACKUP="${OUTPUT}.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$OUTPUT" "$BACKUP"
  echo "==> Kept a copy of the old file as $BACKUP"
fi

# Sets KEY=value in the file being built: replaces KEY=..., else the commented "# KEY=..."
# line from .env.example, else appends. awk reads the value from the environment so no
# character in it needs escaping.
TMP="$(mktemp)"
trap 'rm -f "$TMP" "$TMP.next"' EXIT
# .env.example may have Windows line endings if it was checked out on Windows.
tr -d '\r' < .env.example > "$TMP"

set_var() {
  local key="$1" value="$2"
  KEY="$key" VALUE="$value" awk '
    BEGIN { key = ENVIRON["KEY"]; value = ENVIRON["VALUE"]; done = 0 }
    {
      if (!done && index($0, key "=") == 1) { print key "=" value; done = 1; next }
      if (!done && index($0, "# " key "=") == 1) { print key "=" value; done = 1; next }
      print
    }
    END { if (!done) print key "=" value }
  ' "$TMP" > "$TMP.next"
  mv "$TMP.next" "$TMP"
}

set_var JWT_SECRET "$JWT_SECRET"
set_var POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
set_var SECRETS_KEY "$SECRETS_KEY"
set_var WEB_BIND "$WEB_BIND"
set_var WEB_PORT "$WEB_PORT"
set_var TRUST_PROXY "$TRUST_PROXY"
set_var CRON_TZ "$TZ_NAME"
if [ "$VERSION" != "latest" ]; then
  set_var ZAATOOL_VERSION "$VERSION"
fi
if [ -n "$COOKIE_SECURE" ]; then
  set_var COOKIE_SECURE "$COOKIE_SECURE"
fi
if [ "$WITH_CADDY" = "yes" ]; then
  set_var PUBLIC_DOMAIN "$DOMAIN"
  # Every later `docker compose` command in this folder then includes the caddy service.
  set_var COMPOSE_PROFILES "caddy"
fi

( umask 077; cp "$TMP" "$OUTPUT" )
chmod 600 "$OUTPUT" 2>/dev/null || true

if [ "$WITH_CADDY" = "yes" ]; then
  printf '%s {\n    reverse_proxy web:80\n}\n' "$DOMAIN" > Caddyfile
  # Caddy reaches web over the compose network; the host needs no port for it.
  printf 'services:\n  web:\n    ports: !reset []\n' > docker-compose.override.yml
fi

mask() {
  # first four characters, then dots: enough to recognise, not enough to use
  printf '%s' "$1" | cut -c1-4 | tr -d '\n'
  printf '...(%s chars)' "${#1}"
}

echo "==> Wrote $OUTPUT (mode 600)"
echo "      JWT_SECRET        = $(mask "$JWT_SECRET")"
echo "      POSTGRES_PASSWORD = $(mask "$POSTGRES_PASSWORD")"
echo "      SECRETS_KEY       = $(mask "$SECRETS_KEY")   (back this file up: without it the secrets are gone)"
echo "      WEB_BIND          = $WEB_BIND"
echo "      WEB_PORT          = $WEB_PORT"
echo "      TRUST_PROXY       = $TRUST_PROXY"
echo "      CRON_TZ           = $TZ_NAME"
echo "      ZAATOOL_VERSION   = $VERSION"
if [ -n "$COOKIE_SECURE" ]; then
  echo "      COOKIE_SECURE     = $COOKIE_SECURE"
fi
if [ "$WITH_CADDY" = "yes" ]; then
  echo "      Caddy             = on, serving $DOMAIN (Caddyfile and docker-compose.override.yml written)"
fi
echo

if [ "$BEHIND_PROXY" = "no" ]; then
  echo "WARNING: no reverse proxy means the web port is open on every interface of this"
  echo "machine, over plain HTTP unless you put TLS in front of it yourself. Anyone who can"
  echo "reach port $WEB_PORT can reach the login screen. If you do not terminate HTTPS, the"
  echo "session cookie must not be Secure: COOKIE_SECURE=false in $OUTPUT."
  if [ -n "$DOMAIN" ] && [ -z "$COOKIE_SECURE" ]; then
    echo "You gave a domain, so COOKIE_SECURE was left on. That is only right if HTTPS reaches"
    echo "this port through something you run; otherwise set COOKIE_SECURE=false."
  fi
  echo
fi

if [ "$WITH_CADDY" = "yes" ]; then
  echo "Caddy will request a certificate for $DOMAIN: its DNS record must already point at this"
  echo "machine, and ports 80 and 443 must be free."
  echo
elif [ -n "$DOMAIN" ]; then
  echo "Add this to your Caddyfile, then reload Caddy yourself (this script does not touch it):"
  echo
  echo "$DOMAIN {"
  echo "    reverse_proxy 127.0.0.1:$WEB_PORT"
  echo "}"
  echo
else
  echo "No domain given, so there is no Caddy block to print. Once you have one:"
  echo
  echo "<your-domain> {"
  echo "    reverse_proxy 127.0.0.1:$WEB_PORT"
  echo "}"
  echo
fi

if [ "$START" != "yes" ]; then
  cat <<NEXT
Next (in $(pwd)):

  1. docker compose pull && docker compose up -d
  2. docker compose logs engine | grep -i setup     # the one-time setup code
  3. Open the site, choose "Create the first one", enter the code and your details.
     (No browser handy? 'docker compose exec engine pnpm create-user <name> --role creator'
     makes the first creator without a code.)

NEXT
  exit 0
fi

# ── --start ───────────────────────────────────────────────────────────────────

command -v docker >/dev/null 2>&1 || die "docker is not installed (or not on PATH); the files are in $(pwd)"
docker compose version >/dev/null 2>&1 || die "the 'docker compose' v2 plugin is required"

COMPOSE=(docker compose)
if [ "$OUTPUT" != ".env" ]; then
  COMPOSE+=(--env-file "$OUTPUT")
fi
if [ "$BUILD" = "yes" ]; then
  COMPOSE+=(-f docker-compose.yml -f docker-compose.build.yml)
  if [ -f docker-compose.override.yml ]; then
    COMPOSE+=(-f docker-compose.override.yml)
  fi
  echo "==> Building the images (this can take a while)"
  "${COMPOSE[@]}" build
else
  echo "==> Pulling the images ($VERSION)"
  # A fresh install only needs what is not here yet (and a tag that exists only on this machine
  # must not be looked up on the registry); update.sh is what refreshes images.
  "${COMPOSE[@]}" pull --policy missing
fi
echo "==> Starting"
"${COMPOSE[@]}" up -d

healthy() {
  # healthy SERVICE: its container reports "healthy"
  local id
  id="$("${COMPOSE[@]}" ps -q "$1" 2>/dev/null | head -n 1)"
  [ -n "$id" ] || return 1
  [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null)" = "healthy" ]
}

echo "==> Waiting for the stack to be healthy (up to 120 s)"
WAITED=0
until healthy postgres && healthy engine && healthy web; do
  if [ "$WAITED" -ge 120 ]; then
    echo >&2
    echo "Not healthy after 120 s. The engine's log:" >&2
    "${COMPOSE[@]}" logs --tail 40 engine >&2 || true
    exit 1
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done
echo "    healthy after about ${WAITED}s"
echo

echo "Setup code (needed once, to create the first account):"
"${COMPOSE[@]}" logs engine 2>/dev/null | grep -i "setup" | tail -n 3 || echo "  (none printed: an account may already exist)"
echo
if [ "$WITH_CADDY" = "yes" ]; then
  echo "Open https://$DOMAIN once its certificate has been issued (a minute or so)."
elif [ "$BEHIND_PROXY" = "yes" ]; then
  echo "zaatool answers on 127.0.0.1:$WEB_PORT of this machine; point your proxy at it (block above)."
else
  echo "zaatool answers on port $WEB_PORT of this machine."
fi
echo "Look at it: scripts/status.sh      Remove it: scripts/uninstall.sh"
