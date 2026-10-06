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
edit() { printf '{"tool_input":{"file_path":"%s"}}' "$1"; }
bashc() { python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]}}))' "$1"; }

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
printf '{"a":1,}' > "$tmp/bad.json";     expect 2 "broken JSON" post-edit-check.sh "$(edit "$tmp/bad.json")"
printf 'def f(:\n' > "$tmp/bad.py";      expect 2 "broken Python" post-edit-check.sh "$(edit "$tmp/bad.py")"
if command -v rustfmt >/dev/null; then
  printf 'fn main( { }\n' > "$tmp/bad.rs"; expect 2 "broken Rust" post-edit-check.sh "$(edit "$tmp/bad.rs")"
  printf 'fn  main(){let x=1;}\n' > "$tmp/ok.rs"; expect 0 "formats Rust" post-edit-check.sh "$(edit "$tmp/ok.rs")"
  grep -q '    let x = 1;' "$tmp/ok.rs" || { echo "  FAIL: rustfmt did not format"; fails=$((fails + 1)); }
fi
# The specs' lint, where tests/web's packages are installed (npm ci there; CI's
# Web job installs them), on specs in a copy of tests/web's lint set-up
# outside the tree, where no Playwright run can pick them up: a violation the
# copy's suppressions hold passes, a new one fails, a clean spec passes.
web="$root/tests/web"
nm="$web/node_modules"
if [ -x "$nm/.bin/eslint" ] && [ -d "$nm/eslint-plugin-playwright" ] && [ -d "$nm/@eslint-community/eslint-plugin-eslint-comments" ]; then
  lint="$tmp/tests/web"
  mkdir -p "$lint" && cp "$web/eslint.config.mjs" "$lint/" && ln -s "$web/node_modules" "$lint/node_modules"
  waits='const { test, expect } = require("./fixtures");\n\ntest("waits", async ({ page }) => {\n  await page.waitForTimeout(100);\n  await expect(page.locator("#a")).toBeVisible();\n});\n'
  printf '{"held.spec.js":{"playwright/no-wait-for-timeout":{"count":1}}}\n' > "$lint/eslint-suppressions.json"
  printf "$waits" > "$lint/held.spec.js"; expect 0 "a violation the suppressions hold" post-edit-check.sh "$(edit "$lint/held.spec.js")"
  printf "$waits" > "$lint/new.spec.js";  expect 2 "a new spec's fixed wait" post-edit-check.sh "$(edit "$lint/new.spec.js")"
  printf 'const { test, expect } = require("./fixtures");\n\ntest("shows", async ({ page }) => {\n  await expect(page.locator("#a")).toBeVisible();\n});\n' > "$lint/ok.spec.js"
  expect 0 "a clean new spec" post-edit-check.sh "$(edit "$lint/ok.spec.js")"
fi
expect 0 "session start"         session-start.sh '{}'
echo "  hooks: $runs cases, $fails failure(s)"
[ "$fails" = 0 ]
