#!/usr/bin/env bash
# Run a command when it is this command's turn for the browser. Two lanes:
#
#   exclusive  rehearsals and recordings: the machine to themselves, because a
#              second browser makes a take late and its timings stop
#              predicting the recording. The default.
#   shared     browser tests: up to BROWSER_SHARED (default 2) at once, never
#              beside an exclusive job. A command running `playwright test`
#              is shared unless BROWSER_LANE says otherwise.
#
#   www/video/tools/one_browser.sh COMMAND [ARGS…]
#   BROWSER_LANE=exclusive|shared www/video/tools/one_browser.sh COMMAND …
#
# First come, first served: each caller takes a ticket (its arrival time) in a
# queue directory and starts only once everyone ahead of it has started, so a
# recording cannot starve behind a stream of tests, nor a test behind a stream
# of other tests. An exclusive job starts when it is first and nothing runs; a
# shared one when everyone ahead is a running shared job and there is room. A
# ticket whose process has gone is swept, so a killed job never blocks the
# queue. It also waits out any footage.mjs started outside it.
# BROWSER_QUEUE picks the directory (default: one per machine, in $TMPDIR).
set -uo pipefail
Q="${BROWSER_QUEUE:-${TMPDIR:-/tmp}/auracle-browser-queue}"
MAX="${BROWSER_SHARED:-2}"
mkdir -p "$Q"
lane="${BROWSER_LANE:-}"
if [ -z "$lane" ]; then
  case " $* " in *"playwright test"*|*" smoke "*) lane=shared ;; *) lane=exclusive ;; esac
fi
[ "$lane" = shared ] || lane=exclusive
name="$(date +%s%N)-$$"
ticket="$Q/$name"
printf '%s' "$lane" > "$ticket"
trap 'rm -f "$ticket" "$ticket.run"' EXIT
while :; do
  ahead=0; blocked=0
  for f in $(ls "$Q" | grep -E '^[0-9]+-[0-9]+$' | sort); do
    kill -0 "${f##*-}" 2>/dev/null || { rm -f "$Q/$f" "$Q/$f.run"; continue; }
    [ "$f" = "$name" ] && break
    ahead=$((ahead + 1))
    # Someone ahead has not started, or is (or may be) exclusive: wait.
    # A ticket from an older copy of this script holds no lane and no .run:
    # it counts as exclusive, and as not started.
    if [ ! -e "$Q/$f.run" ] || [ "$(cat "$Q/$f" 2>/dev/null)" != shared ]; then blocked=1; fi
  done
  if [ "$blocked" = 0 ] && ! pgrep -f "^node [^ ]*tools/footage.mjs" > /dev/null; then
    if [ "$lane" = exclusive ] && [ "$ahead" = 0 ]; then break; fi
    if [ "$lane" = shared ] && [ "$ahead" -lt "$MAX" ]; then break; fi
  fi
  sleep 2
done
touch "$ticket.run"
"$@"
