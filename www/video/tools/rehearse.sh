#!/usr/bin/env bash
# Rehearse a walkthrough (footage.mjs --dry), one browser at a time, then
# summarise it: every shot's errors, lateness, stamps and logs.
#
#   www/video/tools/rehearse.sh FILM [--shot a,b]
#
# Screenshots and sidecars land in www/video/out/FILM/dry/; the run's log is
# appended to www/video/out/FILM/dry.log.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
F="$1"; shift
mkdir -p "$ROOT/www/video/out/$F"
log="$ROOT/www/video/out/$F/dry.log"
cd "$ROOT"
echo "=== $(date +%T) $F $*" >> "$log"
www/video/tools/one_browser.sh nice -n 10 node www/video/tools/footage.mjs "$F" --dry "$@" >> "$log" 2>&1
echo "=== $(date +%T) done $F" >> "$log"
python3 www/video/tools/rehearsal.py "$F"
