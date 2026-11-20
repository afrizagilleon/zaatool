#!/usr/bin/env bash
#
# Prepare a first installation: write .env with fresh secrets, say what to do next.
#
#   ./scripts/install.sh                                   # asks what it needs to
#   ./scripts/install.sh --domain zaa.example.com --behind-proxy yes --web-port 8080 --tz Asia/Jakarta
#
# What it does, and no more:
#
#   * writes .env from .env.example with a random JWT_SECRET, POSTGRES_PASSWORD and SECRETS_KEY;
#   * sets how the web port is exposed (see --behind-proxy);
#   * prints the Caddy block for your domain and the commands that come next.
#
# What it does not do, on purpose: it never runs `docker compose`, and it never touches
# Caddy or anything else on this machine. zaatool is a guest on your server, not its owner;
# you paste the block and you start the stack.
#
# An existing .env is never overwritten. --force replaces it, after saving a copy beside it.
#
# Options:
#   --domain NAME           the public name Caddy will serve (omit it if there is none yet)
#   --behind-proxy yes|no   is there a reverse proxy (Caddy, nginx) on THIS host?
#                             yes: web listens on 127.0.0.1 only, TRUST_PROXY=2
#                             no:  web listens on every interface, TRUST_PROXY=1
#   --web-port N            host port for the web container (default 8080)
#   --tz NAME               IANA time zone for cron triggers (default UTC)
#   --output FILE           write here instead of ./.env
#   --force                 replace an existing .env (a copy is kept)
#   -h, --help              this text
#
# Needs: bash, openssl, and the usual POSIX tools (awk, sed, tr).

set -euo pipefail

cd "$(dirname "$0")/.."

DOMAIN=""
BEHIND_PROXY=""
WEB_PORT=""
TZ_NAME=""
OUTPUT=".env"
FORCE="no"

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
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
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

command -v openssl >/dev/null 2>&1 || die "openssl is required to make the secrets"
[ -f .env.example ] || die ".env.example not found; run this from a zaatool checkout"

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
if [ -n "$COOKIE_SECURE" ]; then
  set_var COOKIE_SECURE "$COOKIE_SECURE"
fi

( umask 077; cp "$TMP" "$OUTPUT" )
chmod 600 "$OUTPUT" 2>/dev/null || true

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
if [ -n "$COOKIE_SECURE" ]; then
  echo "      COOKIE_SECURE     = $COOKIE_SECURE"
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

if [ -n "$DOMAIN" ]; then
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

cat <<NEXT
Next:

  1. docker compose up -d --build
  2. docker compose logs engine | grep -i setup     # the one-time setup code
  3. Open the site, choose "Create the first one", enter the code and your details.
     (No browser handy? 'docker compose exec engine pnpm create-user <name> --role creator'
     makes the first creator without a code.)

NEXT
