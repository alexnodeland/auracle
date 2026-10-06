#!/usr/bin/env bash
# The Claude Code hooks, exercised with inputs they must block and inputs they
# must let through (`make dev-check`). A hook that silently stops blocking is
# worse than no hook: people trust it.
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)"
H="$root/.claude/hooks"
export CLAUDE_PROJECT_DIR="$root"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fails=0; runs=0
expect() { # expect <exit> <name> <hook> <json>
  runs=$((runs + 1))
  printf '%s' "$4" | bash "$H/$3" >/dev/null 2>&1; got=$?
  if [ "$got" != "$1" ]; then echo "  FAIL: $2 (exit $got, wanted $1)"; fails=$((fails + 1)); fi
}
says() { # says <yes|no> <name> <hook> <json> <text>: whether what it prints holds the text
  runs=$((runs + 1))
  out="$(printf '%s' "$4" | bash "$H/$3" 2>/dev/null)"
  case "$out" in *"$5"*) got=yes ;; *) got=no ;; esac
  if [ "$got" != "$1" ]; then echo "  FAIL: $2 (printed: ${out:-nothing})"; fails=$((fails + 1)); fi
}
edit() { printf '{"tool_input":{"file_path":"%s"}}' "$1"; }
bashc() { python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]}}))' "$1"; }
cwdj() { python3 -c 'import json,sys;print(json.dumps({"cwd":sys.argv[1]}))' "$1"; }

expect 2 "edit apps/web/pkg"     guard-generated.sh "$(edit "$root/apps/web/pkg/auracle_wasm.js")"
expect 2 "edit site/"            guard-generated.sh "$(edit "$root/site/index.html")"
expect 2 "edit published film"   guard-generated.sh "$(edit "$root/www/landing/assets/film/tour.vtt")"
expect 0 "edit main.js"          guard-generated.sh "$(edit "$root/apps/web/main.js")"
expect 2 "debug cargo test"      guard-bash.sh "$(bashc 'cargo test -p auracle-grammar')"
expect 2 "debug cargo test, cd"  guard-bash.sh "$(bashc 'cd crates && cargo test')"
expect 0 "optimized cargo test"  guard-bash.sh "$(bashc 'cargo test -p auracle-grammar --profile test-fast')"
expect 0 "doc tests"             guard-bash.sh "$(bashc 'cargo test --doc --workspace')"
expect 0 "make test"             guard-bash.sh "$(bashc 'make test')"
expect 0 "grep for cargo test"   guard-bash.sh "$(bashc 'grep -n "cargo test" Makefile')"
expect 2 "unqueued playwright"   guard-bash.sh "$(bashc 'cd tests/web && npx playwright test smoke.spec.js')"
expect 0 "queued playwright"     guard-bash.sh "$(bashc 'AURACLE_TEST_PORT=8690 ../../www/video/tools/one_browser.sh npx playwright test')"
printf 'const a = ;\n' > "$tmp/bad.js";  expect 2 "broken JS"   post-edit-check.sh "$(edit "$tmp/bad.js")"
printf 'const a = 1;\n' > "$tmp/ok.js";  expect 0 "valid JS"    post-edit-check.sh "$(edit "$tmp/ok.js")"
# An ES module outside apps/web (the films' stage): a plain node --check
# passes a broken one, so the hook reads it as a module.
printf 'export const a = 1;\nconst b = ;\n' > "$tmp/bad-module.js"; expect 2 "broken ES module" post-edit-check.sh "$(edit "$tmp/bad-module.js")"
printf 'import { a } from "./ok.js";\nexport const b = a;\n' > "$tmp/module.js"; expect 0 "valid ES module" post-edit-check.sh "$(edit "$tmp/module.js")"
# A saved workflow gets the workflow check, not node --check (which passes
# anything with an `export` in it, and refuses its top-level return as a
# module): a sound one passes, and one that reads the clock is refused.
mkdir -p "$tmp/.claude/workflows"
cp "$root/.claude/workflows/ship-issues.js" "$tmp/.claude/workflows/ship-issues.js"
expect 0 "a sound workflow" post-edit-check.sh "$(edit "$tmp/.claude/workflows/ship-issues.js")"
printf '\nconst stamp = Date.now()\n' >> "$tmp/.claude/workflows/ship-issues.js"
expect 2 "a workflow that reads the clock" post-edit-check.sh "$(edit "$tmp/.claude/workflows/ship-issues.js")"
printf '{"a":1,}' > "$tmp/bad.json";     expect 2 "broken JSON" post-edit-check.sh "$(edit "$tmp/bad.json")"
printf 'def f(:\n' > "$tmp/bad.py";      expect 2 "broken Python" post-edit-check.sh "$(edit "$tmp/bad.py")"
if command -v rustfmt >/dev/null; then
  printf 'fn main( { }\n' > "$tmp/bad.rs"; expect 2 "broken Rust" post-edit-check.sh "$(edit "$tmp/bad.rs")"
  printf 'fn  main(){let x=1;}\n' > "$tmp/ok.rs"; expect 0 "formats Rust" post-edit-check.sh "$(edit "$tmp/ok.rs")"
  grep -q '    let x = 1;' "$tmp/ok.rs" || { echo "  FAIL: rustfmt did not format"; fails=$((fails + 1)); }
fi

# A branch's worktree lives inside the main checkout, at
# .claude/worktrees/<topic>, and the hooks judge a path from the root of the
# checkout it is in. A fake main checkout with a built engine (.git a
# directory, as in a clone) holding a worktree with none (.git a file, as git
# writes it there), and the session's project directory the main checkout's.
main="$tmp/main"; nested="$main/.claude/worktrees/x"
mkdir -p "$main/.git" "$main/apps/web/pkg" "$nested/apps/web" "$nested/target/debug"
printf 'gitdir: %s\n' "$main/.git/worktrees/x" > "$nested/.git"
touch "$main/apps/web/pkg/auracle_wasm_bg.wasm"
export CLAUDE_PROJECT_DIR="$main"
expect 2 "edit pkg, in a worktree in the checkout"      guard-generated.sh "$(edit "$nested/apps/web/pkg/auracle_wasm.js")"
expect 2 "write site/, in a worktree in the checkout"   guard-generated.sh "$(edit "$nested/site/index.html")"
expect 0 "edit main.js, in a worktree in the checkout"  guard-generated.sh "$(edit "$nested/apps/web/main.js")"
says yes "session in a worktree: its own engine"         session-start.sh "$(cwdj "$nested/apps/web")" "has no built engine"
says no  "session in the main checkout: its own engine"  session-start.sh "$(cwdj "$main")" "has no built engine"
# A worktree's own target/ is skipped; a worktree named `target` is checked.
printf 'const a = ;\n' > "$nested/target/debug/out.js"
expect 0 "a worktree's own target/" post-edit-check.sh "$(edit "$nested/target/debug/out.js")"
mkdir -p "$main/.claude/worktrees/target"; printf 'gitdir: x\n' > "$main/.claude/worktrees/target/.git"
printf 'const a = ;\n' > "$main/.claude/worktrees/target/bad.js"
expect 2 "broken JS, in a worktree named target" post-edit-check.sh "$(edit "$main/.claude/worktrees/target/bad.js")"
export CLAUDE_PROJECT_DIR="$root"

# The specs' lint, where tests/web's packages are installed (npm ci there; CI's
# Web job installs them), on specs in a copy of tests/web's lint set-up in the
# worktree above, outside the real tree, where no Playwright run can pick them
# up: a violation the copy's suppressions hold passes, a new one fails, a
# clean spec passes. The hook lints with the worktree's own tests/web.
web="$root/tests/web"
nm="$web/node_modules"
if [ -x "$nm/.bin/eslint" ] && [ -d "$nm/eslint-plugin-playwright" ] && [ -d "$nm/@eslint-community/eslint-plugin-eslint-comments" ]; then
  lint="$nested/tests/web"
  mkdir -p "$lint" && cp "$web/eslint.config.mjs" "$lint/" && ln -s "$web/node_modules" "$lint/node_modules"
  waits='const { test, expect } = require("./fixtures");\n\ntest("waits", async ({ page }) => {\n  await page.waitForTimeout(100);\n  await expect(page.locator("#a")).toBeVisible();\n});\n'
  printf '{"held.spec.js":{"playwright/no-wait-for-timeout":{"count":1}}}\n' > "$lint/eslint-suppressions.json"
  printf "$waits" > "$lint/held.spec.js"; expect 0 "a violation the suppressions hold" post-edit-check.sh "$(edit "$lint/held.spec.js")"
  printf "$waits" > "$lint/new.spec.js";  expect 2 "a new spec's fixed wait" post-edit-check.sh "$(edit "$lint/new.spec.js")"
  printf 'const { test, expect } = require("./fixtures");\n\ntest("shows", async ({ page }) => {\n  await expect(page.locator("#a")).toBeVisible();\n});\n' > "$lint/ok.spec.js"
  expect 0 "a clean new spec" post-edit-check.sh "$(edit "$lint/ok.spec.js")"
fi
expect 0 "session start"         session-start.sh '{}'
# The session-start report names a dev build of the engine, or an unfinished
# one, and only those.
says() { # says <name> <pattern> <yes|no>: what session-start.sh prints in a tree of its own
  runs=$((runs + 1))
  # The input names the session's directory, as Claude Code's does; the hook
  # judges the checkout it is in (here none, so CLAUDE_PROJECT_DIR's).
  out="$(printf '{"cwd": "%s"}' "$tmp/proj" | CLAUDE_PROJECT_DIR="$tmp/proj" bash "$H/session-start.sh" 2>/dev/null)"
  if printf '%s' "$out" | grep -q "$2"; then got=yes; else got=no; fi
  if [ "$got" != "$3" ]; then echo "  FAIL: $1 (said: ${out:-nothing})"; fails=$((fails + 1)); fi
}
mkdir -p "$tmp/proj/apps/web/pkg" && : > "$tmp/proj/apps/web/pkg/auracle_wasm_bg.wasm"
printf '{"build": "0123456789abcdef", "profile": "dev"}' > "$tmp/proj/apps/web/pkg/build.json"
says "a dev build is reported"        "is a dev build" yes
printf '{"build": "0123456789abcdef", "profile": "release"}' > "$tmp/proj/apps/web/pkg/build.json"
says "a release build is not"         "is a dev build" no
says "nor called unfinished"          "unfinished" no
printf '{"profile": "unfinished"}' > "$tmp/proj/apps/web/pkg/build.json"
says "an unfinished build is reported" "is an unfinished build" yes
echo "  hooks: $runs cases, $fails failure(s)"
[ "$fails" = 0 ]
