#!/usr/bin/env bash
# SessionStart: say what a new session needs to know before touching anything.
# Whatever this prints is added to the session's context. It never fails the
# session: every check is best-effort.
set -u
# The session's own checkout, from the cwd the hook is given: a session in a
# worktree under .claude/worktrees/ has its own apps/web/pkg, and
# CLAUDE_PROJECT_DIR may still name the main checkout.
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/_root.sh"
cwd="$(python3 "$here/_input.py" cwd)"
root="$(checkout_root "${cwd:-$(pwd)}")"
root="${root:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
cd "$root" 2>/dev/null || exit 0

# 1. Is the app's engine older than the Rust it is built from, a dev build,
#    or unfinished?
wasm="apps/web/pkg/auracle_wasm_bg.wasm"
if [ ! -f "$wasm" ]; then
  echo "apps/web/pkg has no built engine: run \`make wasm\` before serving the app or running browser tests."
else
  newer=$(find crates -name '*.rs' -newer "$wasm" 2>/dev/null | head -3)
  [ -n "$newer" ] || newer=$(find Cargo.lock Cargo.toml crates \( -name Cargo.toml -o -name Cargo.lock \) -newer "$wasm" 2>/dev/null | head -1)
  if [ -n "$newer" ]; then
    echo "apps/web/pkg is older than the Rust sources (e.g. ${newer%%$'\n'*}). If the change reaches the app, run \`make wasm\` before any browser test or film rehearsal."
  fi
  # A quick build (make wasm-dev) is for trying an engine edit by hand, and
  # an unfinished one is a build that failed, was stopped or is running
  # (scripts/wasm_pkg.py `begin`); the browser targets, the specs and the
  # films refuse both.
  if grep -qE '"profile": *"dev"' apps/web/pkg/build.json 2>/dev/null; then
    echo "apps/web/pkg is a dev build (\`make wasm-dev\`): the browser tests, rehearsals and recordings refuse it. Run \`make wasm\` before them."
  elif grep -qE '"profile": *"unfinished"' apps/web/pkg/build.json 2>/dev/null; then
    echo "apps/web/pkg is an unfinished build (a \`make wasm\` that failed or was stopped, or is running): the browser tests, rehearsals and recordings refuse it. Run \`make wasm\` before them."
  fi
fi

# 2. Who is using or waiting for the browser?
q="${BROWSER_QUEUE:-${TMPDIR:-/tmp}/auracle-browser-queue}"
n=$(ls "$q" 2>/dev/null | wc -l | tr -d ' ')
running=$(pgrep -f '^node [^ ]*tools/footage.mjs' >/dev/null 2>&1 && echo yes || echo no)
if [ "${n:-0}" -gt 0 ] || [ "$running" = yes ]; then
  echo "Browser queue: $n job(s) waiting, footage.mjs running: $running. Run browser jobs through www/video/tools/one_browser.sh."
fi
exit 0
