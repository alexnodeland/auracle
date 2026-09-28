#!/usr/bin/env bash
# An illustrated film (the stage draws every frame), from its measured voice
# to the encoded MP4 and WebM:
#   timeline → study score fitted to the arrangement → score render → sound
#   cues from the picture → first mix (the envelopes the picture pulses with)
#   → frames → final mix, encode, captions and poster.
#
#   www/video/tools/illustrated.sh FILM POSTER_SECONDS
#
# Run voice.sh FILM first, and sounds.sh once. MUSIC_DB / DUCK_DB override
# the bed's level and ducking (the explainers use -6 / -9).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
F="$1"; POSTER="$2"
cd "$ROOT/www/video"
python3 tools/timeline.py "films/$F" --voice "out/$F/voice/manifest.json" | sed -n 1p
A=$(python3 -c "import json,sys;a=json.load(open(sys.argv[1]));print(' '.join(f\"{s['section']}={s['bars']}\" for s in a['sections']))" "films/$F/arrangement.json")
python3 tools/fit_score.py sound/study.json "out/$F/study.fitted.json" $A | sed -n 1p
rm -rf "out/$F/music"
(cd "$ROOT" && cargo run -q --release -p auracle-wasm --example score -- "www/video/out/$F/study.fitted.json" "www/video/out/$F/music" --jobs 2 | tail -2)
node tools/render.mjs "$F" --cues | tail -1
MIX=(--voice "out/$F/voice" --music "out/$F/music/study" --sfx out/sound/stingers --music-db "${MUSIC_DB:--6}" --duck-db "${DUCK_DB:--9}")
python3 tools/mix.py "$F" "${MIX[@]}" | tail -1
node tools/render.mjs "$F" --jobs 3 | tr '\r' '\n' | tail -1
python3 tools/mix.py "$F" "${MIX[@]}" --encode --poster "$POSTER" | tail -1
ls -la "out/$F/$F.mp4" "out/$F/$F.webm"
