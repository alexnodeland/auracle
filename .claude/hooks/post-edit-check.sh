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
  */.claude/workflows/*.js)
    # A saved Claude Code workflow is not a module: `export const meta`, then
    # a body that ends in a top-level return. `node --check` passes it
    # whatever it holds (an `export` hands it to Node's module loader, which
    # --check never runs), and as a module it is refused for its return. So
    # it gets the workflow check make dev-check runs: meta a pure literal,
    # its phases, no clock, a dry run on stubbed agents. The file's own
    # checkout's check, else this one's.
    command -v node >/dev/null || exit 0
    checker="${file%/.claude/workflows/*}/scripts/ops/check_workflows.mjs"
    [ -f "$checker" ] || checker="$here/../../scripts/ops/check_workflows.mjs"
    [ -f "$checker" ] || exit 0
    out=$(node "$checker" "$file" 2>&1) || fail "The workflow check failed for $file:" "$out"
    ;;
  *.js|*.mjs|*.cjs)
    command -v node >/dev/null || exit 0
    # Also the only check that notices a backtick inside live-audio.js's
    # PROCESSOR template literal, which otherwise fails silently at runtime.
    # The app's scripts are ES modules, and a plain --check parses them as
    # scripts: it misses a name declared twice in a module function
    # (make js-check checks them the same way). Any other .js with an import
    # or an export is a module too, and is read as one: a plain --check
    # passes such a file whatever follows (Node hands it to its module
    # loader, which --check never runs).
    case "$file" in
      */apps/web/*.js) out=$(node --check --input-type=module < "$file" 2>&1) ;;
      *.js) if grep -qE '^[[:space:]]*(import|export)[[:space:]{*]' "$file"; then
              out=$(node --check --input-type=module < "$file" 2>&1)
            else
              out=$(node --check "$file" 2>&1)
            fi ;;
      *) out=$(node --check "$file" 2>&1) ;;
    esac || fail "node --check failed for $file:" "$out"
    # A file in tests/web is linted as make web-check lints it: from
    # tests/web, where its eslint.config.mjs and the suppressions are, in a
    # few tenths of a second for one file. Skipped where tests/web's packages
    # are not installed (npm ci there); make web-check says so.
    case "$file" in
      */tests/web/*.js|*/tests/web/*.mjs)
        web="${file%/tests/web/*}/tests/web"
        nm="$web/node_modules"
        if [ -f "$web/eslint.config.mjs" ] && [ -x "$nm/.bin/eslint" ] && [ -d "$nm/eslint-plugin-playwright" ] \
          && [ -d "$nm/@eslint-community/eslint-plugin-eslint-comments" ]; then
          out=$(cd "$web" && node_modules/.bin/eslint --no-warn-ignored "${file#"$web"/}" 2>&1) || fail \
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
