#!/usr/bin/env bash
# An illustrated film (the stage draws every frame), from its measured voice
# to the encoded MP4 and WebM:
#   timeline → the bed (a film on N3: its bed and marks written to the
#   timeline; otherwise the study score fitted to the arrangement) → score
#   render → first mix (the envelopes the picture pulses with) → frames →
#   final mix, encode, captions and poster.
#
#   www/video/tools/illustrated.sh FILM POSTER_SECONDS
#
# A film that cuts to the real app (films/FILM/shots.json, as launch does)
# records its takes first (tools/footage.mjs, one browser, a quiet machine),
# reusing the takes already on disk: FOOTAGE=1 records them all again, and
# SHOTS=a,b those shots. DRAFT=1 encodes a fast MP4 and the 720p preview, no
# WebM, for review.
#
# Run voice.sh FILM first, and sounds.sh once. The mix takes the ladder and
# the duck from www/brand/sound.json (mix.py's defaults); the films have no
# cues (ADR-014). A film laid out before the grammar is mixed as it was before
# ADR-014, without its cues (`before_the_grammar`). MUSIC_DB / DUCK_DB
# override the bed's level and its duck for a trial mix.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
F="$1"; POSTER="$2"
cd "$ROOT/www/video"
# The film's takes of the real app, when it has any: those not on disk, or
# the ones asked for. The film's frames read them (out/FILM/shots/).
if [ -f "films/$F/shots.json" ]; then
  NEED=$(python3 -c "
import json, os, sys
f = sys.argv[1]
ids = [s['id'] for s in json.load(open(f'films/{f}/shots.json'))['shots']]
print(','.join(i for i in ids if not os.path.exists(f'out/{f}/shots/{i}.frames.json')))
" "$F")
  [ "${FOOTAGE:-0}" = 1 ] && NEED=$(python3 -c "import json,sys;print(','.join(s['id'] for s in json.load(open(sys.argv[1]))['shots']))" "films/$F/shots.json")
  [ -n "${SHOTS:-}" ] && NEED="$SHOTS"
  if [ -n "$NEED" ]; then
    python3 "$ROOT/scripts/wasm_pkg.py" check
    mkdir -p "out/$F"
    tools/one_browser.sh node tools/footage.mjs "$F" --shot "$NEED" 2>&1 | tee "out/$F/record.log" | grep -v '^\s*$' | tail -20
  fi
  python3 tools/takes.py "$F" || echo "!! takes need attention (see above)"
fi
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
  # The bed the script names (launch's is Signal), fitted to the film's
  # arrangement; Study when the script names none of the scores here.
  read -r OLD OLD_SLUG < <(python3 -c "
import json, os, re, sys
bed = str(json.load(open(sys.argv[1]))['music'].get('bed', '')).lower()
name = bed if bed and os.path.exists(f'sound/{bed}.json') else 'study'
print(name, re.sub('[^a-z0-9]+', '_', json.load(open(f'sound/{name}.json'))['title'].lower()).strip('_'))
" "films/$F/script.json")
  A=$(python3 -c "import json,sys;a=json.load(open(sys.argv[1]));print(' '.join(f\"{s['section']}={s['bars']}\" for s in a['sections']))" "films/$F/arrangement.json")
  python3 tools/fit_score.py "sound/$OLD.json" "out/$F/$OLD.fitted.json" $A | sed -n 1p
  (cd "$ROOT" && cargo run -q --release -p auracle-wasm --example score -- "www/video/out/$F/$OLD.fitted.json" "www/video/out/$F/music" --jobs 2 | tail -2)
  MUSIC=(--music "out/$F/music/$OLD_SLUG")
fi
MIX=(--voice "out/$F/voice" "${MUSIC[@]}"
     ${MUSIC_DB:+--music-db "$MUSIC_DB"} ${DUCK_DB:+--duck-db "$DUCK_DB"})
python3 tools/mix.py "$F" "${MIX[@]}" | tail -1
node tools/render.mjs "$F" --jobs 3 | tr '\r' '\n' | tail -1
if [ "${DRAFT:-0}" = 1 ]; then
  python3 tools/mix.py "$F" "${MIX[@]}" --encode --draft --preview --poster "$POSTER" | tail -2
  ls -la "out/$F/$F.mp4" "out/$F/$F-preview.mp4"
else
  python3 tools/mix.py "$F" "${MIX[@]}" --encode --poster "$POSTER" | tail -1
  ls -la "out/$F/$F.mp4" "out/$F/$F.webm"
fi
