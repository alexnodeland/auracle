#!/usr/bin/env bash
# The shared sound of the films not yet moved to N3: the two old beds in
# sound/ (signal, study), played by Auracle's own engine into
# www/video/out/sound/. The films have no cues (ADR-014). The explainers fit
# study to their own arrangement instead (illustrated.sh), and a film on N3
# renders its own score, marks and all (fit_score.py --film). Renders are
# deterministic, so a score is rendered again only when it changes.
#
#   www/video/tools/sounds.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
for s in signal study; do
  [ -f "www/video/out/sound/$s/manifest.json" ] && [ ! "www/video/sound/$s.json" -nt "www/video/out/sound/$s/manifest.json" ] && continue
  cargo run -q --release -p auracle-wasm --example score -- "www/video/sound/$s.json" www/video/out/sound --jobs 3
done
ls www/video/out/sound
