#!/usr/bin/env bash
# impl: docker
# Tail a docker container's logs. Works for any language (the container is just a
# PID from docker's PoV).
#
# Usage:
#   logs-docker.sh <container-name-or-id> [--lines N] [--since <duration>] [--grep <pattern>] [--follow --timeout S]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

eyes_require docker

CONTAINER="${1:-}"
[ -z "$CONTAINER" ] && eyes_die "usage: logs-docker.sh <container> [--lines N] [--since 5m] [--grep p] [--follow --timeout S]"
shift

LINES=200
SINCE=""
PATTERN=""
FOLLOW=0
FTIMEOUT=5

while [ "$#" -gt 0 ]; do
  case "$1" in
    --lines) LINES="$2"; shift 2;;
    --since) SINCE="--since $2"; shift 2;;
    --grep) PATTERN="$2"; shift 2;;
    --follow) FOLLOW=1; shift;;
    --timeout) FTIMEOUT="$2"; shift 2;;
    *) eyes_die "unknown arg: $1";;
  esac
done

docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER" \
  || docker ps --format '{{.ID}}' | grep -q "^$CONTAINER" \
  || eyes_die "container not running: $CONTAINER"

if [ "$FOLLOW" -eq 1 ]; then
  if [ -n "$PATTERN" ]; then
    eyes_timeout "$FTIMEOUT" docker logs --tail "$LINES" -f $SINCE "$CONTAINER" 2>&1 | grep --line-buffered -E "$PATTERN" | eyes_redact
  else
    eyes_timeout "$FTIMEOUT" docker logs --tail "$LINES" -f $SINCE "$CONTAINER" 2>&1 | eyes_redact
  fi
else
  if [ -n "$PATTERN" ]; then
    docker logs --tail "$LINES" $SINCE "$CONTAINER" 2>&1 | grep -E "$PATTERN" | eyes_redact || true
  else
    docker logs --tail "$LINES" $SINCE "$CONTAINER" 2>&1 | eyes_redact
  fi
fi
