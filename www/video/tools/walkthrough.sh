#!/usr/bin/env bash
# A walkthrough (the real app, recorded), from its rehearsed shots to the
# encoded MP4 and WebM:
#   record every shot → check the takes → study score fitted to the
#   arrangement → sound cues → the app's own sound laid under the picture
#   (app_audio.py follows cuts) → first mix → frames → final mix and encode.
#
#   www/video/tools/walkthrough.sh FILM POSTER_SECONDS [--record-only | --no-record]
#                                  [--shot a,b] [--draft]
#
#   --record-only  record and check the takes, then stop: the only part that
#                  needs a quiet machine (record_films.sh records every film
#                  first, then finishes them)
#   --no-record    finish from the takes already on disk
#   --shot a,b     re-record only these shots; the others' takes are reused
#   --draft        a fast MP4 and the 720p preview, no WebM: for review. Run
#                  again without it (--no-record) before publishing.
#
# Record on a quiet machine: nothing else heavy running, one browser. A
# rehearsal (rehearse.sh) must pass first, and voice.sh must have run (the
# shots are pinned to the narration's measured words). This never re-times
# the narration. MUSIC_DB / DUCK_DB / APP_DB override the levels; JOBS sets
# the render's parallel pages (default: one per core).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
F="$1"; POSTER="$2"; shift 2
REC=1; POST=1; SHOTS=(); DRAFT=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-record) REC=0 ;;
    --record-only) POST=0 ;;
    --shot) SHOTS=(--shot "$2"); shift ;;
    --draft) DRAFT=(--draft) ;;
  esac
  shift
done
cd "$ROOT/www/video"
if [ "$REC" = 1 ]; then
  tools/one_browser.sh node tools/footage.mjs "$F" ${SHOTS[@]+"${SHOTS[@]}"} 2>&1 | tee "out/$F/record.log" | grep -v '^\s*$' | tail -40
fi
python3 tools/takes.py "$F" || echo "!! takes need attention (see above)"
[ "$POST" = 1 ] || exit 0
A=$(python3 -c "import json,sys;a=json.load(open(sys.argv[1]));print(' '.join(f\"{s['section']}={s['bars']}\" for s in a['sections']))" "films/$F/arrangement.json")
python3 tools/fit_score.py sound/study.json "out/$F/study.fitted.json" $A | sed -n 1p
rm -rf "out/$F/music"
(cd "$ROOT" && cargo run -q --release -p auracle-wasm --example score -- "www/video/out/$F/study.fitted.json" "www/video/out/$F/music" --jobs 3 | tail -2)
node tools/render.mjs "$F" --cues | tail -1
python3 tools/app_audio.py "$F" --gain-db "${APP_DB:--3}" > "out/$F/app.json"
MIX=(--voice "out/$F/voice" --music "out/$F/music/study" --sfx out/sound/stingers --app "out/$F/app.json" --music-db "${MUSIC_DB:--6}" --duck-db "${DUCK_DB:--9}")
python3 tools/mix.py "$F" "${MIX[@]}" | tail -4
node tools/render.mjs "$F" --jobs "${JOBS:-$(getconf _NPROCESSORS_ONLN)}" | tr '\r' '\n' | tail -1
python3 tools/mix.py "$F" "${MIX[@]}" --encode ${DRAFT[@]+"${DRAFT[@]}"} --preview --poster "$POSTER" | tail -5
ls -la "out/$F/$F.mp4" "out/$F/$F-preview.mp4"
