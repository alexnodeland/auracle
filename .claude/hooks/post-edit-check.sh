#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): format Rust, syntax-check scripts and
# lint the browser specs at once, so a broken file is reported at the edit
# and not at `make check`.
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
    # rustup's rustfmt, run from the file's directory so rustup finds the
    # toolchain rust-toolchain.toml pins, as `make fmt` does; a Homebrew
    # rustfmt first on PATH would format with another release.
    rustfmt="${CARGO_HOME:-$HOME/.cargo}/bin/rustfmt"
    [ -x "$rustfmt" ] || rustfmt="$(command -v rustfmt)" || exit 0
    out=$(cd "$(dirname "$file")" && "$rustfmt" --edition 2021 "$file" 2>&1) || fail "rustfmt could not parse $file:" "$out"
    ;;
  *.js|*.mjs|*.cjs)
    command -v node >/dev/null || exit 0
    # Also the only check that notices a backtick inside live-audio.js's
    # PROCESSOR template literal, which otherwise fails silently at runtime.
    # The app's scripts are ES modules, and a plain --check parses them as
    # scripts: it misses a name declared twice in a module function
    # (make js-check checks them the same way).
    case "$file" in
      */apps/web/*.js) out=$(node --check --input-type=module < "$file" 2>&1) ;;
      *) out=$(node --check "$file" 2>&1) ;;
    esac || fail "node --check failed for $file:" "$out"
    # A spec or helper in tests/web is linted as make web-check lints it (its
    # eslint.config.mjs, from its directory, where the suppressions are): a
    # few tenths of a second for one file. Skipped where tests/web's packages
    # are not installed (npm ci there); make web-check says so.
    case "$file" in
      */tests/web/*.js|*/tests/web/*.mjs)
        web="$(dirname "$file")"
        if [ -x "$web/node_modules/.bin/eslint" ] && [ -f "$web/eslint.config.mjs" ]; then
          out=$(cd "$web" && node_modules/.bin/eslint --no-warn-ignored "$(basename "$file")" 2>&1) || fail \
            "ESLint failed for $file:" "$out" \
            "Fix it rather than suppress it (tests/web/AGENTS.md § The lint). A count that fell is recorded with: cd tests/web && npx eslint --prune-suppressions"
        fi
        ;;
    esac
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
