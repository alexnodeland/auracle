#!/usr/bin/env bash
# Set up a machine to build, test and film Auracle. Idempotent: run it again
# after pulling and it only does what is missing.
#
#   scripts/setup.sh            the engine, the app and its tests
#   scripts/setup.sh --film     also the films: voice, film tools, models, sound
#   scripts/setup.sh --site     also the site's doc toolchain (mdBook + plugins)
#   scripts/setup.sh --all      everything
#
# `make setup` and `make film-setup` run the first two.
#
# What it needs already installed (it checks, and says how to get them):
#   - rustup (https://rustup.rs); the toolchain and wasm32 target it adds
#   - Node 20 or newer (CI uses 22)
#   - for --film: Python 3.10, 3.11 or 3.12 (kokoro 0.9.4 does not install on
#     3.13), found as python3.12 / python3.11 / python3.10 / python3
#
# What it installs:
#   base   the wasm32-unknown-unknown target, wasm-pack 0.15.0, the browser
#          tests' npm packages and Playwright's Chromium, the git hooks, and
#          the app's engine (make wasm)
#   film   .venv-voice (the voice's pinned torch/kokoro/whisper set plus the
#          film tools' numpy/scipy/pillow/imageio-ffmpeg; the film make
#          targets use it), the Kokoro-82M and faster-whisper small.en models
#          in $AURACLE_VOICE_MODELS (~/.cache/auracle-voice), and the films'
#          shared sound (make film-sounds)
#   site   mdbook, mdbook-katex and mdbook-admonish at the pinned versions
#
# Nothing here needs sudo. ffmpeg comes with imageio-ffmpeg; espeak-ng with
# espeakng-loader.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FILM=0 SITE=0
for a in "$@"; do
  case "$a" in
    --film) FILM=1 ;;
    --site) SITE=1 ;;
    --all) FILM=1 SITE=1 ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a (see --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "!! $1 not found: $2" >&2; exit 1; }; }
export PATH="$HOME/.cargo/bin:$PATH"

say "Rust"
need rustup "install it from https://rustup.rs, then re-run this"
rustup show active-toolchain >/dev/null 2>&1 || rustup default stable
rustup target add wasm32-unknown-unknown
rustup component add rustfmt clippy
if ! wasm-pack --version 2>/dev/null | grep -q '0\.15\.'; then
  cargo install wasm-pack --version 0.15.0 --locked
fi

say "Node and the browser tests"
need node "install Node 20+ (https://nodejs.org or your package manager)"
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 20 ] || { echo "!! Node $major is too old: 20 or newer" >&2; exit 1; }
(cd tests/web && npm ci --no-audit --no-fund && npx playwright install chromium)

say "Git hooks"
make -s install-hooks

say "The app's engine (make wasm)"
make wasm

if [ "$FILM" = 1 ]; then
  say "The film tools and the voice (.venv-voice)"
  PY=""
  for c in python3.12 python3.11 python3.10 python3; do
    if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)'; then
      PY="$c"; break
    fi
  done
  [ -n "$PY" ] || { echo "!! the voice needs Python 3.10-3.12 (kokoro 0.9.4 does not install on 3.13)" >&2; exit 1; }
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
