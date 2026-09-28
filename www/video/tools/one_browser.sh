#!/usr/bin/env bash
# Run a command when it is this command's turn for the browser: rehearsals,
# recordings and browser tests share one machine, and two browsers at once
# make both late (a rehearsal's timings stop predicting the recording).
#
#   www/video/tools/one_browser.sh COMMAND [ARGS…]
#
# First come, first served: each caller takes a ticket (its arrival time) in
# a queue directory and runs when its ticket is the oldest, so a job cannot
# wait forever behind a stream of others that happen to poll at the right
# moment. A ticket whose process has gone is swept, so a killed job never
# blocks the queue. It also waits out any footage.mjs started outside it.
# BROWSER_QUEUE picks the directory (default: one per machine, in $TMPDIR).
set -uo pipefail
Q="${BROWSER_QUEUE:-${TMPDIR:-/tmp}/auracle-browser-queue}"
mkdir -p "$Q"
ticket="$Q/$(date +%s%N)-$$"
touch "$ticket"
trap 'rm -f "$ticket"' EXIT
while :; do
  for f in "$Q"/*; do
    [ -e "$f" ] || continue
    kill -0 "${f##*-}" 2>/dev/null || rm -f "$f"
  done
  first=$(ls "$Q" | sort | head -1)
  if [ "$Q/$first" = "$ticket" ] && ! pgrep -f "^node [^ ]*tools/footage.mjs" > /dev/null; then
    break
  fi
  sleep 2
done
"$@"
