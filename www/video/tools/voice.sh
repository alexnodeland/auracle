#!/usr/bin/env bash
# A film's narration, measured: script → Kokoro TTS → Whisper round trip (a
# line whose words drift from the script fails the film) → the timeline laid
# on the measured word times.
#
#   www/video/tools/voice.sh FILM
#
# The voice tools need their own Python (see voice/requirements.txt):
#   python3 -m venv .venv-voice && .venv-voice/bin/pip install -r www/video/voice/requirements.txt
# AURACLE_VOICE_PY picks the interpreter (default .venv-voice/bin/python at
# the repo root); AURACLE_VOICE_MODELS is where the models are cached.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
F="$1"
PY="${AURACLE_VOICE_PY:-$ROOT/.venv-voice/bin/python}"
cd "$ROOT"
out="www/video/out/$F/voice"
mkdir -p "$out"
python3 www/video/tools/voice_script.py "www/video/films/$F" "www/video/out/$F/tts.json"
"$PY" www/video/voice/tts.py "www/video/out/$F/tts.json" -o "$out"
"$PY" www/video/voice/asr_check.py "$out"
# The demos' measured tails, when there are any (tools/demo_tail.py).
DEMOS=(); [ -f "www/video/out/$F/demos.json" ] && DEMOS=(--demos "www/video/out/$F/demos.json")
python3 www/video/tools/timeline.py "www/video/films/$F" --voice "$out/manifest.json" ${DEMOS[@]+"${DEMOS[@]}"}
