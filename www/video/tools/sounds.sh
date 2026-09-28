#!/usr/bin/env bash
# The shared sound: the three scores in sound/ (signal, study, stingers),
# played by Auracle's own engine into www/video/out/sound/. The stingers are
# every film's effects (mix.py --sfx www/video/out/sound/stingers); the
# explainers fit study to their own arrangement instead (illustrated.sh).
# Renders are deterministic, so this runs once.
#
#   www/video/tools/sounds.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
for s in signal study stingers; do
  [ -d "www/video/out/sound/$s" ] && continue
  cargo run -q --release -p auracle-wasm --example score -- "www/video/sound/$s.json" www/video/out/sound --jobs 3
done
ls www/video/out/sound
