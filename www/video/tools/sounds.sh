#!/usr/bin/env bash
# The shared sound of the films not yet moved to N3: the three old scores in
# sound/ (signal, study, stingers), played by Auracle's own engine into
# www/video/out/sound/. No mix lays the stingers now (ADR-014: the films have
# no cues; Plan-006 task 6 removes them). The explainers fit study to their own
# arrangement instead (illustrated.sh), and a film on N3 renders its own score
# (fit_score.py --film). Renders are deterministic, so this runs once.
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
