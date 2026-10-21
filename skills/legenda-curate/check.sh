#!/bin/sh
# The otto check script for legenda-curate: wake the curator only when the list is running low.
#
#   exit 0  the queue already holds LEGENDA_QUEUE_MAX items or more (no wake is spent), or the
#           server is down (a stopped server shouldn't burn a wake; otto's safety net still wakes)
#   exit 1  fewer than LEGENDA_QUEUE_MAX items are waiting: time to find more
#   exit 2  anything else: otto fails open and wakes
#
# The queue counts everything waiting in the enabled sources: follow intake, the curator's
# suggestions and what you added yourself.
#
# launchd's PATH is minimal, so legenda is named by absolute path. To change the threshold, or
# for a non-default instance (LEGENDA_DIR), edit a copy of this script: otto copies the script
# when you set it, and otto launchers don't set environment variables.
LEGENDA="${LEGENDA_BIN:-$HOME/.bun/bin/legenda}"
max="${LEGENDA_QUEUE_MAX:-20}"

out="$("$LEGENDA" list --state queue --json 2>/dev/null)"
code=$?
case "$code" in
  0) ;;
  4) echo "legenda server unreachable"; exit 0 ;;
  *) echo "legenda list failed ($code)"; exit 2 ;;
esac

count="$(printf '%s' "$out" | jq -e '.items | length' 2>/dev/null)" || { echo "unexpected legenda output"; exit 2; }
if [ "$count" -lt "$max" ]; then
  echo "$count in the queue, fewer than $max"
  exit 1
fi
echo "$count in the queue, at least $max"
exit 0
