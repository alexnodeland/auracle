#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): format Rust and syntax-check scripts at
# once, so a broken file is reported at the edit and not at `make check`.
# Exit 2 sends stderr back to Claude; exit 0 is silent.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
file="$(python3 "$here/_input.py" file_path)"
[ -n "$file" ] && [ -f "$file" ] || exit 0
case "$file" in
  */target/*|*/node_modules/*|*/apps/web/pkg/*) exit 0 ;;
esac
fail() { printf '%s\n' "$@" >&2; exit 2; }
case "$file" in
  *.rs)
    command -v rustfmt >/dev/null || exit 0
    out=$(rustfmt --edition 2021 "$file" 2>&1) || fail "rustfmt could not parse $file:" "$out"
    ;;
  *.js|*.mjs|*.cjs)
    command -v node >/dev/null || exit 0
    # Also the only check that notices a backtick inside live-audio.js's
    # PROCESSOR template literal, which otherwise fails silently at runtime.
    out=$(node --check "$file" 2>&1) || fail "node --check failed for $file:" "$out"
    ;;
  *.py)
    out=$(python3 -m py_compile "$file" 2>&1) || fail "Python syntax error in $file:" "$out"
    ;;
  *.json)
    out=$(python3 -m json.tool "$file" 2>&1 >/dev/null) || fail "Invalid JSON in $file:" "$out"
    ;;
  *.sh)
    out=$(bash -n "$file" 2>&1) || fail "Shell syntax error in $file:" "$out"
    ;;
esac
exit 0
