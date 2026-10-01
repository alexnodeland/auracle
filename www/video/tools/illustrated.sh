#!/usr/bin/env bash
# An illustrated film (the stage draws every frame), from its measured voice
# to the encoded MP4 and WebM:
#   timeline → the bed (a film on N3: its bed and marks written to the
#   timeline; otherwise the study score fitted to the arrangement) → score
#   render → the picture's sound cues, counted (the mix lays none) → first
#   mix (the envelopes the picture pulses with) → frames → final mix, encode,
#   captions and poster.
#
#   www/video/tools/illustrated.sh FILM POSTER_SECONDS
#
# Run voice.sh FILM first, and sounds.sh once. The mix takes the ladder and
# the duck from www/brand/sound.json (mix.py's defaults) and lays no cues
# (ADR-014); a film laid out before the grammar is mixed exactly as it was,
# bar the cues (`before_the_grammar`). MUSIC_DB / DUCK_DB override the bed's
# level and its duck for a trial mix.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
F="$1"; POSTER="$2"
cd "$ROOT/www/video"
# The demos' measured tails, when there are any (tools/demo_tail.py).
DEMOS=(); [ -f "out/$F/demos.json" ] && DEMOS=(--demos "out/$F/demos.json")
# The summary line, and any demo laid out on an estimated tail or snap ignored.
python3 tools/timeline.py "films/$F" --voice "out/$F/voice/manifest.json" ${DEMOS[@]+"${DEMOS[@]}"} | sed -n '1p;/ESTIMATED/p;/snap:/p'
# Is the film on the N3 bed (sound.json `bed.name`, as the timeline reads its
# script)? Its score renders into music/<the score's title, as a file name>.
read -r ON_N3 BED < <(python3 -c "
import json, re, sys; sys.path.insert(0, 'tools'); import sound_defaults as d, timeline
print(int(timeline.on_n3(json.load(open(sys.argv[1])))), re.sub('[^a-z0-9]+', '_', d.SCORES['bed']['title'].lower()).strip('_'))
" "films/$F/script.json")
rm -rf "out/$F/music"
if [ "$ON_N3" = 1 ]; then
  python3 tools/fit_score.py --film "films/$F" "out/$F/$BED.film.json" | sed -n 1p
  (cd "$ROOT" && cargo run -q --release -p auracle-wasm --example score -- "www/video/out/$F/$BED.film.json" "www/video/out/$F/music" --jobs 2 | tail -2)
  MUSIC=(--score "out/$F/$BED.film.json" --music "out/$F/music/$BED")
else
  A=$(python3 -c "import json,sys;a=json.load(open(sys.argv[1]));print(' '.join(f\"{s['section']}={s['bars']}\" for s in a['sections']))" "films/$F/arrangement.json")
  python3 tools/fit_score.py sound/study.json "out/$F/study.fitted.json" $A | sed -n 1p
  (cd "$ROOT" && cargo run -q --release -p auracle-wasm --example score -- "www/video/out/$F/study.fitted.json" "www/video/out/$F/music" --jobs 2 | tail -2)
  MUSIC=(--music "out/$F/music/study")
fi
node tools/render.mjs "$F" --cues | tail -1
MIX=(--voice "out/$F/voice" "${MUSIC[@]}"
     ${MUSIC_DB:+--music-db "$MUSIC_DB"} ${DUCK_DB:+--duck-db "$DUCK_DB"})
python3 tools/mix.py "$F" "${MIX[@]}" | tail -1
node tools/render.mjs "$F" --jobs 3 | tr '\r' '\n' | tail -1
python3 tools/mix.py "$F" "${MIX[@]}" --encode --poster "$POSTER" | tail -1
ls -la "out/$F/$F.mp4" "out/$F/$F.webm"
