#!/usr/bin/env bash
# PreToolUse (Bash): refuse two commands that waste time or give wrong answers
# in this repo, with the right command in the message.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
cmd="$(python3 "$here/_input.py" command)"
[ -n "$cmd" ] || exit 0

# 1. Rust tests in a debug build: ~20x slower on audio, and the grammar suite
#    overflows its stack (docs/decisions/005-tests-run-optimized.md).
if printf '%s' "$cmd" | grep -Eq '(^|[;&|(]|\s)cargo(\s+\+\S+)?\s+test\b'; then
  if ! printf '%s' "$cmd" | grep -Eq -- '--release|--profile|--doc'; then
    echo "Rust tests run optimized here: use \`make test-crate CRATE=auracle-grammar\` (optimized, on the pinned compiler) or \`make test\`, or add \`--profile test-fast\`. Debug builds are ~20x slower on audio and overflow the grammar suite's stack." >&2
    exit 2
  fi
fi

# 2. A Playwright run outside the browser queue competes with rehearsals and
#    recordings (docs/decisions/003-one-browser-at-a-time.md).
if printf '%s' "$cmd" | grep -Eq 'playwright\s+test' \
  && ! printf '%s' "$cmd" | grep -Eq 'one_browser\.sh|--list|make\s+smoke'; then
  echo "Run browser tests through the queue, on their own port: \`cd tests/web && AURACLE_TEST_PORT=8690 ../../www/video/tools/one_browser.sh npx playwright test <spec>\`." >&2
  exit 2
fi
exit 0
