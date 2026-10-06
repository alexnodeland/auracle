#!/usr/bin/env bash
# Set up a machine to build, test and film Auracle. Idempotent: run it again
# after pulling and it only does what is missing.
#
#   scripts/setup.sh            the engine, the app and its tests
#   scripts/setup.sh --film     also the films: voice, film tools, models, sound
#   scripts/setup.sh --site     also the site's doc toolchain (mdBook + plugins)
#   scripts/setup.sh --sccache  also sccache, which `make` compiles through when
#                               AURACLE_SCCACHE=1 is set (opt-in; not in --all;
#                               AURACLE_SCCACHE=1 in the environment implies it)
#   scripts/setup.sh --all      everything but sccache
#
# `make setup` and `make film-setup` run the first two.
#
# What it needs already installed (it checks, and says how to get them):
#   - rustup (https://rustup.rs) 1.28 or later; it installs the toolchain
#     rust-toolchain.toml pins, with rustfmt, clippy and the wasm32 target
#   - Node 22, the version in .node-version that CI runs (fnm or nvm, when
#     installed, are used to install and select it). Node 26 will not do:
#     Playwright 1.56's browser install hangs on it (the download finishes,
#     the unzip never does)
#   - for --film: Python 3.10, 3.11 or 3.12 (kokoro 0.9.4 does not install on
#     3.13), found as python3.12 / python3.11 / python3.10 / python3, or the
#     one named by AURACLE_PYTHON (a command or a path; a .venv-voice from
#     another Python is then rebuilt). A .venv-voice already there is kept.
#     It must be able to reach pypi.org: a per-app firewall (Little Snitch)
#     that blocks one Python is caught here, with a pointer to this variable
#
# What it installs:
#   base   the pinned Rust toolchain (rust-toolchain.toml: its components and
#          the wasm32-unknown-unknown target) and its llvm-tools component,
#          wasm-pack 0.15.0, cargo-nextest (the Rust test runner),
#          cargo-llvm-cov at the Makefile's LLVM_COV_VERSION (make coverage),
#          cargo-mutants at exactly the Makefile's MUTANTS_VERSION (make mutants),
#          the browser tests' npm packages and Playwright's Chromium, the git
#          hooks, and the app's engine (make wasm)
#   film   .venv-voice (the voice's pinned torch/kokoro/whisper set plus the
#          film tools' numpy/scipy/pillow/imageio-ffmpeg; the film make
#          targets use it), the Kokoro-82M and faster-whisper small.en models
#          in $AURACLE_VOICE_MODELS (~/.cache/auracle-voice), and the films'
#          shared sound (make film-sounds)
#   site   mdbook, mdbook-katex and mdbook-admonish at the pinned versions
#   sccache  sccache at SCCACHE_VERSION, built with no remote storage (a
#          cache on this disk only). `make` uses it when AURACLE_SCCACHE=1 is
#          in the environment: put `export AURACLE_SCCACHE=1` in your shell's
#          profile. A new worktree's first build then takes the crates.io
#          dependencies from the cache, not the compiler; each worktree keeps
#          its own target/ (the Makefile says why that is safe). The cache is
#          ~/Library/Caches/Mozilla.sccache on a Mac (~/.cache/sccache on
#          Linux), up to 10 GB; SCCACHE_CACHE_SIZE sets another limit
#
# Nothing here needs sudo. ffmpeg comes with imageio-ffmpeg; espeak-ng with
# espeakng-loader.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SCCACHE_VERSION=0.18.0
FILM=0 SITE=0 SCCACHE=0
if [ "${AURACLE_SCCACHE:-}" = 1 ]; then SCCACHE=1; fi
for a in "$@"; do
  case "$a" in
    --film) FILM=1 ;;
    --site) SITE=1 ;;
    --sccache) SCCACHE=1 ;;
    --all) FILM=1 SITE=1 ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "unknown option: $a (see --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "!! $1 not found: $2" >&2; exit 1; }; }
export PATH="$HOME/.cargo/bin:$PATH"

say "Rust"
need rustup "install it from https://rustup.rs, then re-run this"
# Given no toolchain, rustup installs the one rust-toolchain.toml names, with
# the components and target it lists (here, at the root, it finds the file).
# That needs rustup 1.28 or later; an older one wants a toolchain named.
ru_version="$(rustup --version 2>/dev/null | awk '{ print $2; exit }')"
IFS=. read -r ru_major ru_minor _ <<<"${ru_version:-0.0}"
if [ "${ru_major:-0}" -lt 1 ] || { [ "$ru_major" = 1 ] && [ "${ru_minor:-0}" -lt 28 ]; }; then
  echo "!! rustup ${ru_version:-of unknown version} is older than 1.28, which installs the toolchain rust-toolchain.toml names." >&2
  echo "   Update it (\`rustup self update\`, or \`brew upgrade rustup\` if Homebrew installed it), then re-run this." >&2
  exit 1
fi
rustup toolchain install --no-self-update
if ! wasm-pack --version 2>/dev/null | grep -q '0\.15\.'; then
  cargo install wasm-pack --version 0.15.0 --locked
fi
cargo nextest --version >/dev/null 2>&1 || cargo install cargo-nextest --locked
# `make coverage`: the pinned toolchain's llvm-tools (not in rust-toolchain.toml,
# which every CI job installs, and which would carry 41 MB more to each), and
# cargo-llvm-cov at the version the Makefile names, or later. An older one is
# replaced: before 0.7 it instrumented every dependency, quiver's DSP loops
# included, and the run took about thirteen times as long.
rustup component add llvm-tools
llvm_cov="$(sed -n 's/^LLVM_COV_VERSION := //p' Makefile)"
have="$(cargo llvm-cov --version 2>/dev/null | awk '{ print $2 }')"
if [ -z "$have" ] || [ "$(printf '%s\n%s\n' "$llvm_cov" "$have" | sort -V | head -1)" != "$llvm_cov" ]; then
  cargo install cargo-llvm-cov --version "$llvm_cov" --locked
fi
# `make mutants`: cargo-mutants at exactly the version the Makefile names, as
# CI pins it (mutants.yml). Another version can list other mutants, so a
# local run and CI's would not agree on what survives.
mutants="$(sed -n 's/^MUTANTS_VERSION := //p' Makefile)"
if [ "$(cargo mutants --version 2>/dev/null | awk '{ print $2 }')" != "$mutants" ]; then
  cargo install --locked "cargo-mutants@$mutants"
fi
# sccache, opt-in (--sccache, or AURACLE_SCCACHE=1 in the environment, which
# `make setup` passes on): before the engine's first build below, so that
# one goes through it too. Built without remote storage, which a cache on
# this disk does not need.
if [ "$SCCACHE" = 1 ]; then
  if [ "$(sccache --version 2>/dev/null | awk '{ print $2 }')" != "$SCCACHE_VERSION" ]; then
    cargo install --locked --no-default-features "sccache@$SCCACHE_VERSION"
  fi
  if [ "${AURACLE_SCCACHE:-}" = 1 ]; then
    echo "$(sccache --version): make compiles through it (AURACLE_SCCACHE=1)"
  else
    echo "$(sccache --version): to have make compile through it, put  export AURACLE_SCCACHE=1  in your shell's profile"
  fi
fi

say "Node and the browser tests"
want="$(cat .node-version)"
if command -v fnm >/dev/null; then
  eval "$(fnm env --shell bash)"
  fnm use --install-if-missing "$want"
elif [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  set +u; . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"; nvm install "$want"; set -u
fi
need node "install Node $want (fnm and nvm read .node-version)"
major="$(node -p 'process.versions.node.split(".")[0]')"
case "$major" in
  20|22|24) ;;
  *) echo "!! Node $major: use Node $want (.node-version); fnm or nvm install it. Playwright 1.56's browser install hangs on Node 26" >&2; exit 1 ;;
esac
(cd tests/web && npm ci --no-audit --no-fund && npx playwright install chromium)

say "Git hooks"
make -s install-hooks

say "The app's engine (make wasm)"
make wasm

if [ "$FILM" = 1 ]; then
  say "The film tools and the voice (.venv-voice)"
  fits='import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)'
  if [ -z "${AURACLE_PYTHON:-}" ] && [ -x .venv-voice/bin/python ] && .venv-voice/bin/python -c "$fits" 2>/dev/null; then
    PY=.venv-voice/bin/python   # keep the venv there is, whichever Python made it
  else
    PY=""
    for c in ${AURACLE_PYTHON:-python3.12 python3.11 python3.10 python3}; do
      if command -v "$c" >/dev/null && "$c" -c "$fits"; then
        PY="$c"; break
      fi
    done
    [ -n "$PY" ] || { echo "!! the voice needs Python 3.10-3.12 (kokoro 0.9.4 does not install on 3.13)${AURACLE_PYTHON:+; AURACLE_PYTHON=$AURACLE_PYTHON is not one}" >&2; exit 1; }
  fi
  # Fail in seconds, not after pip's minutes of retries, when this Python
  # cannot reach the package index (curl reaching it proves nothing: a
  # per-app firewall judges each executable on its own).
  "$PY" -c 'import urllib.request; urllib.request.urlopen("https://pypi.org/simple/pip/", timeout=10)' 2>/dev/null || {
    echo "!! $PY ($("$PY" -c 'import os, sys; print(os.path.realpath(sys.executable))')) cannot reach pypi.org. If other programs can," >&2
    echo "   a firewall is blocking this Python: allow it, or choose another, e.g. AURACLE_PYTHON=python3.11 make film-setup" >&2
    exit 1
  }
  # A venv made from another Python than AURACLE_PYTHON names is rebuilt.
  want_v="$("$PY" -c 'import sys; print(sys.version_info[:2])')"
  if [ -x .venv-voice/bin/python ] && [ "$(.venv-voice/bin/python -c 'import sys; print(sys.version_info[:2])')" != "$want_v" ]; then
    rm -rf .venv-voice
  fi
  [ -x .venv-voice/bin/python ] || "$PY" -m venv .venv-voice
  .venv-voice/bin/python -m pip install --quiet --upgrade pip
  .venv-voice/bin/python -m pip install -r www/video/voice/requirements.txt -r www/video/requirements-tools.txt

  say "The voice models (Kokoro-82M, faster-whisper small.en)"
  AURACLE_VOICE_MODELS="${AURACLE_VOICE_MODELS:-$HOME/.cache/auracle-voice}" \
    .venv-voice/bin/python - <<'PY'
import os
from pathlib import Path
models = Path(os.environ["AURACLE_VOICE_MODELS"]).expanduser()
models.mkdir(parents=True, exist_ok=True)
# The same cache layout tts.py and asr_check.py use (HF_HUB_CACHE = models).
os.environ["HF_HUB_CACHE"] = str(models)
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
from huggingface_hub import snapshot_download
snapshot_download("hexgrad/Kokoro-82M", cache_dir=str(models))
from faster_whisper import WhisperModel
WhisperModel("small.en", device="cpu", compute_type="int8", download_root=str(models))
print(f"models in {models}")
PY

  say "The films' shared sound (make film-sounds)"
  make film-sounds
fi

if [ "$SITE" = 1 ]; then
  say "The site's doc toolchain (make site-tools)"
  make site-tools
fi

say "Done"
echo "Check it with: make check   (and, after --film: make film-rehearse FILM=tour)"
