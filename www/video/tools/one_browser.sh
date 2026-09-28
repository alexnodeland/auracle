#!/usr/bin/env bash
# Run a command once no footage.mjs browser is running: rehearsals, recordings
# and browser tests share one machine, and two browsers at once make both late
# (a rehearsal's timings stop predicting the recording).
#
#   www/video/tools/one_browser.sh COMMAND [ARGS…]
#
# It matches only the node process (^node …tools/footage.mjs): a pattern that
# also matched a shell whose command line mentions the tool would wait on
# itself forever.
set -euo pipefail
while pgrep -f "^node [^ ]*tools/footage.mjs" > /dev/null; do sleep 3; done
exec "$@"
