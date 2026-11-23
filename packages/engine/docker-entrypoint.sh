#!/bin/sh
# Starts the engine in the image, after tini (PID 1, so orphaned cell processes get reaped).
#
# What it does, as root, before the engine exists (S-06): puts a firewall on every uid a cell
# can run as, then drops CAP_NET_ADMIN from the bounding set so nothing that runs afterwards
# (the engine, and so no cell) can take the firewall down again. Cells keep the internet and
# DNS; they lose the engine's own port, the database and every other container on the Docker
# network, the cloud metadata address, and the private ranges. Only NET_ADMIN is dropped:
# the engine still needs SETUID/SETGID/KILL to run cells and SYS_RESOURCE to pin their
# oom_score_adj.
#
#   CELL_EGRESS_ALLOW     comma or space separated list of what cells may reach inside those
#                         ranges: CIDRs (10.1.2.0/24, fd00::/8), a bare IPv4 address, or
#                         host:port ([::1]:443 for IPv6). A host name is resolved once, now.
#   CELL_EGRESS_FIREWALL  `on` (default) or `off`. Off is for a host that does this another
#                         way; it is loud on purpose.
#
# Not a sandbox deployment (no SANDBOX_* set, or not root): the command runs unchanged.
# A mistake in the list stops the start with the reason, because a typo that silently opens
# nothing, or everything, is worse than a container that does not come up.
#
# CELL_FW_DRYRUN=1 prints the iptables commands instead of running them, and does not exec
# (used by the tests).

set -eu
set -f # an entry such as `*` must stay text

fail() {
  echo "zaatool-entrypoint: $*" >&2
  exit 1
}

# run: execute for real. validate: check the list only, touch nothing. dry: print the commands.
PHASE=validate
ipt() {
  case "$PHASE" in
    run) iptables -w "$@" ;;
    dry) echo "iptables $*" ;;
  esac
}
ip6t() {
  case "$PHASE" in
    run) ip6tables -w "$@" ;;
    dry) echo "ip6tables $*" ;;
  esac
}

blank() { [ -z "$(printf '%s' "$1" | tr -d '[:space:]')" ]; }

DRY="${CELL_FW_DRYRUN:-}"

if [ -z "$DRY" ]; then
  if blank "${SANDBOX_GID:-}${SANDBOX_UID_BASE:-}${SANDBOX_UID_COUNT:-}" || [ "$(id -u)" != 0 ]; then
    exec "$@"
  fi
fi

case "${CELL_EGRESS_FIREWALL:-on}" in
  on) ;;
  off)
    cat >&2 <<'MSG'

zaatool-entrypoint: ************************************************************
zaatool-entrypoint: CELL_EGRESS_FIREWALL=off. Cells are NOT firewalled: they can reach
zaatool-entrypoint: this engine's own port, the database, every other container on the
zaatool-entrypoint: network, the cloud metadata address and the private ranges. Only
zaatool-entrypoint: do this if the network around the container already blocks that.
zaatool-entrypoint: ************************************************************

MSG
    exec "$@"
    ;;
  *) fail "CELL_EGRESS_FIREWALL is \"${CELL_EGRESS_FIREWALL}\"; use \"on\" (default) or \"off\"." ;;
esac

# --- the uid range cells run as ------------------------------------------------------------
BASE="${SANDBOX_UID_BASE:-20000}"
COUNT="${SANDBOX_UID_COUNT:-40000}"
case "$BASE$COUNT" in
  *[!0-9]* | "") fail "SANDBOX_UID_BASE and SANDBOX_UID_COUNT must be plain numbers." ;;
esac
{ [ "$BASE" -ge 1 ] && [ "$COUNT" -ge 1 ]; } || fail "SANDBOX_UID_BASE and SANDBOX_UID_COUNT must be greater than 0."
RANGE="$BASE-$((BASE + COUNT - 1))"

# --- what to let through -------------------------------------------------------------------
OCTET='(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])'
V4="$OCTET\\.$OCTET\\.$OCTET\\.$OCTET"
V6='[0-9A-Fa-f:]*:[0-9A-Fa-f:]*'
HOSTNAME_RE='[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?'
is() { printf '%s' "$2" | grep -Eq "^($1)\$"; }
port_ok() { is '[0-9]{1,5}' "$1" && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }

# `RETURN` hands the packet back to OUTPUT, which lets it through.
allow_cidr4() { ipt -A CELLFW -d "$1" -j RETURN; }
allow_cidr6() { ip6t -A CELLFW -d "$1" -j RETURN; }
allow_hostport4() {
  ipt -A CELLFW -d "$1" -p tcp --dport "$2" -j RETURN
  ipt -A CELLFW -d "$1" -p udp --dport "$2" -j RETURN
}
allow_hostport6() {
  ip6t -A CELLFW -d "$1" -p tcp --dport "$2" -j RETURN
  ip6t -A CELLFW -d "$1" -p udp --dport "$2" -j RETURN
}

bad_entry() { fail "CELL_EGRESS_ALLOW entry \"$1\" is not a CIDR (10.1.2.0/24), an address, or host:port ($2)."; }

apply_allow_entry() {
  entry="$1"
  case "$entry" in
    \[*\]:*) # [v6]:port
      addr="${entry#\[}"
      addr="${addr%%\]*}"
      port="${entry##*\]:}"
      is "$V6" "$addr" || bad_entry "$entry" "bad IPv6 address"
      port_ok "$port" || bad_entry "$entry" "port must be 1-65535"
      allow_hostport6 "$addr" "$port"
      ;;
    */*)
      addr="${entry%%/*}"
      bits="${entry#*/}"
      is '[0-9]{1,3}' "$bits" || bad_entry "$entry" "bad prefix length"
      if is "$V4" "$addr"; then
        [ "$bits" -le 32 ] || bad_entry "$entry" "an IPv4 prefix is 0-32"
        allow_cidr4 "$entry"
      elif is "$V6" "$addr"; then
        [ "$bits" -le 128 ] || bad_entry "$entry" "an IPv6 prefix is 0-128"
        allow_cidr6 "$entry"
      else
        bad_entry "$entry" "bad address"
      fi
      ;;
    *:*:*) # a bare IPv6 address
      is "$V6" "$entry" || bad_entry "$entry" "bad IPv6 address"
      allow_cidr6 "$entry/128"
      ;;
    *:*) # host:port
      host="${entry%:*}"
      port="${entry##*:}"
      port_ok "$port" || bad_entry "$entry" "port must be 1-65535"
      if is "$V4" "$host"; then
        allow_hostport4 "$host" "$port"
      elif is "$HOSTNAME_RE" "$host"; then
        case "$PHASE" in
          run)
            found=""
            for ip in $(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u); do
              allow_hostport4 "$ip" "$port"
              found=1
            done
            for ip in $(getent ahostsv6 "$host" 2>/dev/null | awk '{print $1}' | sort -u); do
              allow_hostport6 "$ip" "$port"
              found=1
            done
            [ -n "$found" ] || fail "CELL_EGRESS_ALLOW entry \"$entry\": \"$host\" does not resolve from here (is that container running, on this network?)."
            ;;
          dry) allow_hostport4 "$host" "$port" ;;
        esac
      else
        bad_entry "$entry" "bad host name"
      fi
      ;;
    *)
      if is "$V4" "$entry"; then allow_cidr4 "$entry/32"; else bad_entry "$entry" "no port, no prefix"; fi
      ;;
  esac
}

ALLOW_LIST="$(printf '%s' "${CELL_EGRESS_ALLOW:-}" | tr ',' ' ')"

# Mistakes in the list are found before anything is installed, so none leaves a half-built firewall.
for entry in $ALLOW_LIST; do apply_allow_entry "$entry"; done

if [ -z "$DRY" ]; then
  PHASE=run
  command -v iptables >/dev/null 2>&1 || fail "iptables is not installed; the official image has it."
  command -v setpriv >/dev/null 2>&1 || fail "setpriv (util-linux) is not installed; the official image has it."
  iptables -w -L OUTPUT -n >/dev/null 2>&1 ||
    fail "cannot change iptables: the container needs cap_add: [NET_ADMIN] (docker-compose.yml has it). To start without the cell firewall anyway, set CELL_EGRESS_FIREWALL=off, knowing what that leaves open."
else
  PHASE=dry
fi

# IPv6 is skipped only when this kernel has none at all.
HAS6=1
if [ "$PHASE" = run ] && [ ! -e /proc/net/if_inet6 ]; then
  HAS6=""
  echo "zaatool-entrypoint: no IPv6 in this container; only IPv4 is firewalled." >&2
fi

# A restart can find the previous chain; start clean either way.
reset_chain() { # $1 = iptables | ip6tables
  while "$1" -w -D OUTPUT -m owner --uid-owner "$RANGE" -j CELLFW 2>/dev/null; do :; done
  "$1" -w -F CELLFW 2>/dev/null || true
  "$1" -w -X CELLFW 2>/dev/null || true
}
if [ "$PHASE" = run ]; then
  reset_chain iptables
  [ -z "$HAS6" ] || reset_chain ip6tables
fi
ipt -N CELLFW
[ -z "$HAS6" ] || ip6t -N CELLFW

# Docker's embedded DNS is 127.0.0.11 and it DNATs the packet to a random port, so a rule on
# port 53 would not match: every port to that one address.
ipt -A CELLFW -d 127.0.0.11 -j RETURN

# Whatever resolver the container was given (on the default bridge it is the host's, e.g.
# 192.168.65.7 on Docker Desktop), UDP and TCP.
if [ -r /etc/resolv.conf ]; then
  for ns in $(awk '$1=="nameserver"{print $2}' /etc/resolv.conf | sed 's/%.*//'); do
    if is "$V4" "$ns"; then
      ipt -A CELLFW -d "$ns" -p udp --dport 53 -j RETURN
      ipt -A CELLFW -d "$ns" -p tcp --dport 53 -j RETURN
    elif [ -n "$HAS6" ] && is "$V6" "$ns"; then
      ip6t -A CELLFW -d "$ns" -p udp --dport 53 -j RETURN
      ip6t -A CELLFW -d "$ns" -p tcp --dport 53 -j RETURN
    fi
  done
fi

for entry in $ALLOW_LIST; do apply_allow_entry "$entry"; done

# 0.0.0.0/8 because connecting to 0.0.0.0 reaches this machine's own loopback.
for net in 0.0.0.0/8 127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10; do
  ipt -A CELLFW -d "$net" -j REJECT
done
ipt -I OUTPUT 1 -m owner --uid-owner "$RANGE" -j CELLFW

if [ -n "$HAS6" ]; then
  for net in ::/128 ::1/128 fc00::/7 fe80::/10 ::ffff:0:0/96; do
    ip6t -A CELLFW -d "$net" -j REJECT
  done
  ip6t -I OUTPUT 1 -m owner --uid-owner "$RANGE" -j CELLFW
fi

[ -z "$DRY" ] || exit 0

echo "zaatool-entrypoint: cell firewall installed for uids $RANGE."
exec setpriv --bounding-set -net_admin --inh-caps -net_admin "$@"
