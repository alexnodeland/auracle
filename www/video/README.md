# The films

Auracle's launch film, explainers and walkthroughs are made from this
directory, the same way the site is: from source, by commands anyone can run
again. A film is narration, pictures and sound, and each has one owner here:

| Part | Where | What makes it |
|---|---|---|
| The script | `films/<film>/script.json` | Written by hand: every line of narration, grouped into beats (scenes), with the pauses between them |
| The voice | `voice/` | `tts.py`: Kokoro-82M, offline, one WAV per line; `asr_check.py` transcribes every line back and fails a line whose words drift from the script |
| The timing | `films/<film>/timeline.json` | `tools/timeline.py`: lays the measured lines onto the music's bar grid, so a cut lands on a beat |
| The music | `sound/` | Scores played by Auracle's own engine, offline (`cargo run -p auracle-wasm --example score`). Every note in these films is the instrument |
| The picture | `films/<film>/film.js` | Scenes drawn on the stage (`stage/`), pinned to the timeline's cues, never to hand-typed seconds |
| The footage | `films/<film>/shots.json` | `tools/footage.mjs`: the real app, driven by a script and recorded with its own sound |
| The mix | `tools/mix.py` | Narration at a fixed level, music ducked under it, effects on the frames that show them; -16 LUFS, true peak under -1 dBTP; H.264 + AAC, captions (WebVTT) and a poster |

## The stage

`stage/stage.js` is a small deterministic timeline: a frame is a pure function
of time, so `seek(t)` draws the same frame in a preview tab and in the renderer,
in any order. Nothing animates by itself: no CSS transitions, no timers. That
is what lets a film be rendered again, bit for bit, after the voice or the
music changes.

`stage/kit.js` is the illustration kit, drawn in the instrument's own materials:

- graphite plates and silk-screened Jost;
- two phosphors. **Green is sound, amber is the model's mind**, exactly as in
  the app and the brand (`www/brand/`). There is no third colour.

`stage/walk.js` turns recorded footage into a walkthrough. It adds a slow
camera, callouts that point at the thing being named, a chapter label and
captions, all pinned to the words of the narration.

Preview any film in a browser, served from the repo root:

    python3 -m http.server 8000
    open http://localhost:8000/www/video/films/launch/?t=12&play

`?t=` shows one frame and `?play` runs from there in real time.

## Making a film

    # 1. The voice (first run downloads the models, ~350 MB, into the cache).
    python3 www/video/voice/tts.py www/video/films/launch/script.json www/video/out/launch/voice
    python3 www/video/voice/asr_check.py www/video/out/launch/voice

    # 2. The timing, from the measured voice.
    python3 www/video/tools/timeline.py www/video/films/launch --voice www/video/out/launch/voice/manifest.json

    # 3. The music, arranged to the timing (arrangement.json), played by the engine.
    cargo run --release -p auracle-wasm --example score -- www/video/sound/signal.json www/video/out/launch/music

    # 4. Footage, for the walkthroughs (needs `make wasm`).
    node www/video/tools/footage.mjs perform

    # 5. Sound cues from the picture, a first mix (for the envelopes), the
    #    picture, then the final mix and encode.
    node www/video/tools/render.mjs launch --cues
    python3 www/video/tools/mix.py launch --voice … --music … --sfx …
    node www/video/tools/render.mjs launch --jobs 3
    python3 www/video/tools/mix.py launch --voice … --music … --sfx … --encode --poster 16.8

Renders land in `www/video/out/` (ignored by git). A finished film is copied to
`www/landing/assets/film/` with its poster and captions. From there, `make site`
places it wherever the guide and the reference embed it. There is one copy in
the repo, as with the screenshots.

## Why the films are not committed while they are drafts

A video is a large binary, and git keeps every version of it forever. Drafts
therefore live in `www/video/out/` and are shared for review from there. A film
is committed once, when it is finished. Re-rendering after that is a decision to
spend repository size, not a side effect of running the pipeline.
