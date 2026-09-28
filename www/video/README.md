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

## Setting up

Everything here runs from the repo root, on Linux or macOS.

- **Node and Chromium**, for the stage, the renderer and the footage recorder:
  `cd tests/web && npm ci && npx playwright install chromium` (the browser tests
  use the same install).
- **Python 3** with `numpy`, `scipy`, `pillow` and `imageio-ffmpeg` (which
  brings its own ffmpeg), for the timeline, the mix, the encode and the checks.
- **The voice**, in its own environment (it pins torch and friends; see the
  file for why): `python3 -m venv .venv-voice && .venv-voice/bin/pip install -r
  www/video/voice/requirements.txt`. The models download on first use into
  `$AURACLE_VOICE_MODELS`.
- **Rust**, for the music: the scores are played by the engine
  (`cargo run --release -p auracle-wasm --example score`).
- **The app's wasm**, for walkthroughs: `make wasm` (or `wasm-pack build
  crates/auracle-wasm --target web --release --no-opt --out-dir
  ../../apps/web/pkg && make wasm-stamp` where wasm-opt can't be downloaded).
  The footage is the app as built, so build it from the commit you publish.
- **The shared sound**, once: `www/video/tools/sounds.sh` renders the three
  scores in `sound/` into `www/video/out/sound/`. The stingers there are every
  film's effects.

## Making an illustrated film

The explainers (`taste`, `engine`, `math`, `dsp`) and the launch film's
illustrated scenes are drawn by the stage, frame by frame.

1. **Write** `films/<film>/script.json` (beats of lines, short sentences; each
   is also a caption) and a storyboard. `films/SCRIPTS.md` is the brief the
   current films were written to.
2. **Voice it:** `www/video/tools/voice.sh <film>`. It flattens the script
   with the shared pronunciations (`films/lexicon.json`), speaks every line
   (Kokoro-82M), transcribes each back (Whisper) and fails any line whose words
   drift from the script (WER over 0.10), then lays the timeline on the
   measured word times. Fix a failing line with a lexicon entry or a rewrite,
   never by loosening the check.
3. **Arrange the bed** in `films/<film>/arrangement.json` (sections in bars at
   84 BPM). A beat's `bed_db` in the script sets the bed's level under it
   (≤ −60 is out).
4. **Draw it** in `films/<film>/film.js` with the kit, pinned to the timeline's
   cues. Preview with `python3 -m http.server 8000` from the repo root and
   `http://localhost:8000/www/video/films/<film>/?t=12&play`.
5. **Render:** `www/video/tools/illustrated.sh <film> <poster seconds>`. It
   fits the study score to the arrangement and plays it, takes the sound cues
   from the picture, makes a first mix (the envelopes the picture pulses with),
   renders the frames, then mixes and encodes: MP4 and WebM, captions, poster.

## Making a walkthrough

A walkthrough is the real app, driven by a script and recorded with its own
sound. `stage/walk.js` adds the camera, callouts, chapter labels and captions.
The deep dives (`tour`, `view-*`) follow `films/VIEWS.md`.

### Writing the shots

`films/<film>/shots.json` has one shot per beat: its set-up, run off camera,
then actions on a clock pinned to the narration (`"at": "keys1:Play+0.45"` is
the moment the voice reaches "Play" in line keys1). The header of
`tools/footage.mjs` is the full reference: every op, time form, selector
rule and field. Write a generator for anything long (`films/<film>/gen_shots.py`,
importing `tools/shotgen.py`), so a change of voice or timing is one re-run.

What makes shots reliable:

- **Seed the session** (`init`, from `shotgen.INIT`), so every shot deals the
  same pool, warm start and duel sides, and a rehearsal predicts the
  recording. Pick warm-start cards by category and PERFORM controls by what
  they do (`.search`, `.half-lo`), never by name: the wiring is measured per
  session.
- **Wait on the app's own signals** (`until` a selector or a page predicate,
  with a `stamp` to time later actions from), never on fixed pauses. A result
  that takes tens of seconds (EVOLVE POOL, ⚡) is a cut (`clips`): the film
  jumps from the press to the result, and actions after it are mapped through
  the cut.
- **Measure marks** for every callout (`marks`, or a `mark` action once the
  thing is on screen); walk.js pins callouts to them.
- **Order gestures** that depend on each other inside a `seq`.
- **Let the app be the music:** chords on the bar line at 84 BPM (`"snap":
  "bar"`), and the bed out under demos (`bed_db`).
- **Show the truth.** If the app does something the guide or the film doesn't
  say, film what it does and fix the app, or the words.

### Rehearsing

    node www/video/tools/validate.mjs <film>        # every word, mark and beat resolves
    www/video/tools/rehearse.sh <film> [--shot a,b] # a dry run, then its summary
    python3 www/video/tools/framing.py <film> [beat] # camera crops and callouts, as contact sheets

A rehearsal runs every set-up and action against the live app and records
nothing. It saves screenshots and a sidecar per shot to `out/<film>/dry/`. A
shot passes when its errors are empty and its actions start on time
(`late`). Rehearse again after the voice changes: actions follow the words.
Run one browser at a time on a shared machine (`tools/one_browser.sh` waits
for any other); timings measured under load don't predict a recording.

### Recording

    www/video/tools/walkthrough.sh <film> <poster seconds>

On a quiet machine. It records every shot (picture at 30 fps from Chromium's
screencast, sound from the app's master bus through the `?film` capture hook,
so every audition is in it), then checks the takes (`tools/takes.py`: errors,
paint rate, sound). After that it fits and plays the study score, lays the
app's sound under each shot's stretch of film (`tools/app_audio.py`, which
follows the cuts), mixes, renders the frames, and encodes. `--no-record`
re-mixes existing takes; `--shot a,b` re-records a few.

## Publishing

    python3 www/video/tools/publish.py <film> [<film> …]

It copies the film, captions and posters to `www/landing/assets/film/`,
records it in `films.json` (chapters from `CHAPTER_NAMES`, the transcript
from the timeline), regenerates the guide's Films page, fills every
`<!-- film:<name> -->` marker in the guide and the reference, fills the
landing page's and README's markers, and makes the silent loop for the home
page from `LOOPS` / `VIEW_LOOPS`. It also un-hides the app's film links
(the ⋯ menu, the help card, the warm start's tour link) once the film each
opens exists. `make site` then places the one copy wherever it is embedded.

## The tools

The steps above are also `make` targets: `make film-sounds`, `make
film-voice FILM=…`, `make film FILM=… POSTER=…`, `make film-rehearse FILM=…`,
`make film-record FILM=… POSTER=…`, `make film-record-all FILMS="name poster …"`,
`make film-preview FILM=…` and `make film-publish FILMS="…"`.

| Tool | What it does |
|---|---|
| `tools/voice.sh` | Script → TTS → ASR gate → timeline on measured words |
| `tools/voice_script.py` | A film's script as `voice/tts.py` reads it, with the shared lexicon |
| `tools/timeline.py` | Beats and lines laid on the bar grid; `--voice` for measured word times |
| `tools/fit_score.py` | The study score stretched to a film's arrangement |
| `tools/sounds.sh` | The shared scores, rendered once to `out/sound/` |
| `tools/footage.mjs` | Record (or `--dry` rehearse) a walkthrough's shots |
| `tools/shotgen.py` | Shared pieces for a film's shots generator |
| `tools/validate.mjs` | Check a walkthrough's words, marks and beats resolve |
| `tools/rehearse.sh` | One-browser dry run, then `tools/rehearsal.py`'s summary |
| `tools/framing.py` | Contact sheets of camera crops and callouts from a rehearsal |
| `tools/one_browser.sh` | Run a command when it is its turn for the browser (a first-come, first-served queue) |
| `tools/takes.py` | Check recorded takes before spending a render on them |
| `tools/app_audio.py` | The recorded app sound under the picture, through the cuts |
| `tools/render.mjs` | The frames (or `--cues`, or `--at` stills), exactly; kept as parts listed in `picture.ffconcat` |
| `tools/mix.py` | Voice, bed, effects and app sound mixed and encoded, with captions and poster |
| `tools/poster.mjs` | A poster frame on its own |
| `tools/illustrated.sh` | An illustrated film, voice to encode |
| `tools/walkthrough.sh` | A walkthrough, recording to encode |
| `tools/record_films.sh` | Several walkthroughs in turn: record, encode, clear the frames, make a preview; stops at the first failure |
| `tools/preview.sh` | A 720p MP4 of a finished film, small enough to send for review |
| `tools/publish.py` | A finished film onto the site, guide, reference, README and app |

Renders land in `www/video/out/` (ignored by git). A finished film is copied to
`www/landing/assets/film/` with its poster and captions. From there, `make site`
places it wherever the guide and the reference embed it. There is one copy in
the repo, as with the screenshots.

## Why the films are not committed while they are drafts

A video is a large binary, and git keeps every version of it forever. Drafts
therefore live in `www/video/out/` and are shared for review from there. A film
is committed once, when it is finished. Re-rendering after that is a decision to
spend repository size, not a side effect of running the pipeline.
