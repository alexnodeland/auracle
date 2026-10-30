#!/usr/bin/env bash
# SessionStart, on Claude Code on the web only (CLAUDE_CODE_REMOTE=true): set
# up the cloud container the way `make setup` sets up a laptop. A cloud
# session starts from a fresh clone on a container that has rustup and Node
# but none of the tools scripts/setup.sh installs (wasm-pack, cargo-nextest,
# cargo-llvm-cov, cargo-mutants, sccache, tests/web's packages) and no engine,
# so every session began by installing them by hand. Run by session-start.sh,
# before its report, with the hook's JSON on stdin.
#
# 1. binaryen's wasm-opt, at the version wasm-pack asks for, on PATH:
#    wasm-pack's own download ignores the proxy's CA bundle and fails, which
#    stops `make wasm` after it has compiled
#    (docs/runbooks/wasm-opt-download.md). curl trusts the proxy.
# 2. scripts/setup.sh --no-engine, before the session's first turn: the
#    tools, installed once per container and skipped when present (setup.sh
#    is idempotent), so a cold container takes minutes here and a warm one
#    seconds.
# 3. The engine, in the background: another checkout's release build when
#    one was made from this Rust (`make pkg-reuse`), otherwise `make wasm`,
#    logged, with its pid kept so the report says it is building and a
#    second session start does not build it again.
#
# It never fails the session: a step that fails says so, with its log.
set -u
[ "${CLAUDE_CODE_REMOTE:-}" = true ] || exit 0
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/_root.sh"
input="$(cat)"
field() { printf '%s' "$input" | python3 "$here/_input.py" "$1"; }
# A clear or a compaction is the same container mid-session: nothing to set
# up, and setup.sh's `npm ci` would empty tests/web/node_modules under a
# browser run.
case "$(field source)" in clear|compact) exit 0 ;; esac
cwd="$(field cwd)"
root="$(checkout_root "${cwd:-$(pwd)}")"
root="${root:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
cd "$root" 2>/dev/null || exit 0

logs="${TMPDIR:-/tmp}/auracle-web-setup"
mkdir -p "$logs"
export PATH="$HOME/.cargo/bin:$PATH"

# 1. wasm-opt. A wrapper rather than a link, so the binary finds its
#    lib/libbinaryen.so beside it however it is called.
binaryen=117 # wasm-pack 0.15's, as CI builds with
if ! wasm-opt --version 2>/dev/null | grep -q "version $binaryen\b"; then
  dir="$HOME/.local/share/auracle/binaryen-$binaryen"
  rm -rf "$dir" && mkdir -p "$dir" "$HOME/.cargo/bin"
  url="https://github.com/WebAssembly/binaryen/releases/download/version_$binaryen/binaryen-version_$binaryen-x86_64-linux.tar.gz"
  if curl -sSfL --retry 3 "$url" 2>"$logs/binaryen.log" | tar -xz -C "$dir" --strip-components=1 2>>"$logs/binaryen.log" &&
    "$dir/bin/wasm-opt" --version >/dev/null 2>&1; then
    printf '#!/bin/sh\nexec "%s/bin/wasm-opt" "$@"\n' "$dir" >"$HOME/.cargo/bin/wasm-opt"
    chmod +x "$HOME/.cargo/bin/wasm-opt"
  else
    echo "Web setup: binaryen $binaryen's wasm-opt did not install ($logs/binaryen.log), so \`make wasm\` will stop at wasm-opt: docs/runbooks/wasm-opt-download.md."
  fi
fi

# 2. The tools. Once more on a failure: a cold container's first install
#    fetches hundreds of crates, and the proxy can drop a tunnel mid-download.
if ! { scripts/setup.sh --no-engine >"$logs/setup.log" 2>&1 || scripts/setup.sh --no-engine >"$logs/setup.log" 2>&1; }; then
  echo "Web setup: scripts/setup.sh failed twice (the end of $logs/setup.log says where). Run \`make setup\` once the cause is fixed."
  exit 0
fi

# 3. The engine.
pidfile="$logs/wasm.pid"
if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
  exit 0 # building already, from an earlier start; session-start.sh says so
fi
python3 scripts/wasm_pkg.py check >/dev/null 2>&1 && exit 0
make -s pkg-reuse >/dev/null 2>&1 && exit 0
setsid nohup nice -n 10 make wasm >"$logs/wasm.log" 2>&1 </dev/null &
echo $! >"$pidfile"
exit 0
