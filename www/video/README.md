# The films

Auracle's launch film, explainers and walkthroughs are made from this
directory, the same way the site is: from source, by commands anyone can run
again. A film is narration, pictures and sound, and each has one owner here:

| Part | Where | What makes it |
|---|---|---|
| The script | `films/<film>/script.json` | Written by hand: every line of narration, grouped into beats (scenes), with the pauses between them |
| The voice | `voice/` | `tts.py`: Kokoro-82M, offline, one WAV per line; `asr_check.py` transcribes every line back and fails a line whose words drift from the script |
| The timing | `films/<film>/timeline.json` | `tools/timeline.py`: lays the measured lines onto the music's clock, each demo after its line with its tail rung out, and the two marks around the narration |
| The music | `sound/` | Scores played by Auracle's own engine, offline (`cargo run -p auracle-wasm --example score`). Every note in these films is the instrument. Its values are `www/brand/sound.json`'s (§ The sound) |
| The picture | `films/<film>/film.js` | Scenes drawn on the stage (`stage/`), pinned to the timeline's cues, never to hand-typed seconds |
| The footage | `films/<film>/shots.json` | `tools/footage.mjs`: the real app, driven by a script and recorded with its own sound |
| The mix | `tools/mix.py` | The ladder in `www/brand/sound.json`: the narration through its chain, the bed under it, each demo at its own level, the two marks, no cues; -16 LUFS, true peak under -1 dBTP; H.264 + AAC, captions (WebVTT) and a poster |

## The stage

`stage/stage.js` is a small deterministic timeline: a frame is a pure function
of time, so `seek(t)` draws the same frame in a preview tab and in the renderer,
in any order. Nothing animates by itself: no CSS transitions, no timers. That
is what lets a film be rendered again, bit for bit, after the voice or the
music changes.

`stage/kit.js` is the illustration kit, drawn in the instrument's own materials:

- graphite plates and silk-screened Jost;
- two phosphors. **Green is sound, amber is the model's mind**, exactly as in
  the app and the brand (`www/brand/`). There is no third colour. Every colour
  is a token of `stage.css`'s, generated from `www/brand/tokens.json`; the kit
  and the films read them with `ink()` and `inkA()`, never as literals.
- the type scale, in frame pixels. A size a film writes into a style comes
  from the same tokens: text from the frame's own tier, `--t-frame-n` (step n
  of the scale's ratio, 12 × 1.2ⁿ, in pixels of the 1920 × 1080 frame), and
  spaces and corners from the shared steps. The drawing helpers (the kit's
  `textBlock()`, a film's `label()` or `txt()`) still take a number for a
  label's size, which the token check does not count (#291).

`stage/walk.js` turns recorded footage into a walkthrough. It adds a slow
camera, callouts that point at the thing being named, a chapter label and
captions, all pinned to the words of the narration.

Preview any film in a browser, served from the repo root:

    python3 -m http.server 8000
    open http://localhost:8000/www/video/films/launch/?t=12&play

`?t=` shows one frame and `?play` runs from there in real time.

## The sound

The films' sound is [ADR-014](../../docs/decisions/014-the-films-sound.md)'s,
and its values live in one file, `www/brand/sound.json`, as the colors live
in `tokens.json`:
- the key, tempo and form;
- the cast, with every knob the finals turned;
- the two marks (Bloom in, Reach out) and the bed (N3);
- each part's EQ, pan and level;
- the voice chain, the loudness ladder, the duck, the carve and the pad's dip;
- the grammar's timings.

`docs/notes/sound-2026-09/SPEC.md` is where each value was chosen.

    make sound

(`www/brand/sound.py`) writes it out:
- **The scores** `sound/bloom.json`, `sound/reach.json` and `sound/n3.json`.
  The notes are the auditioned finals in `docs/notes/sound-2026-09/scores/`.
  Every track's preset, voices, trim, transpose and knobs, the lead's bend
  times and the drone's breath are the cast's. As committed they render bit
  for bit what was auditioned.
- **The mix's defaults** `tools/sound_defaults.py`: the ladder, the voice
  chain, the duck, carve and dip, each part's EQ, pan and level, the
  grammar's timings, the marks' levels, the shortlist and the room. `mix.py`
  reads every level it sets from it, and `timeline.py` every timing. It also
  holds the bed's notes (`BED`) and how the lead plays a line (`LEAD`), which
  `fit_score.py --film` writes a film's bed from.

The rest of `sound.json`'s numbers and pitches describe the notes rather than
being written into them: the pedal, the marks' length, the lead's legato and
swell, the bed's voicings, burble and sighs, and the demo (which only the
reel played). `make sound` leaves the notes as they are, and
`make dev-check` fails while `sound.json` disagrees with them.

Each generated file says so at its top; edit `sound.json`, never them.
`make dev-check` fails when one is stale. It also fails on the two ways the
duck came to have three values in three places: a number as a film tool's
`--music-db`, `--duck-db` or `--gain-db` default, and a numeric
`MUSIC_DB`/`DUCK_DB`/`APP_DB` fallback (or `--music-db`/`--duck-db`/`--gain-db`
flag) in a film tool's shell code. Docstrings, help strings and comments may
quote a level.

The mix is the spec's (`tools/mix.py`):
- the voice through its chain, at −18 LUFS;
- the bed at rest 3 LU under it, ducked 2 dB under the voice, carved a
  further 3 dB in 1–4 kHz, and the pad dipped 2 dB in 300–600 Hz;
- each demo window at −22 LUFS, with the bed 5 LU under it;
- the marks at −18 LUFS over their 4.5 s;
- the master at −16 LUFS, and no cues.

It writes what it measured to `out/<film>/ladder.json`.

A film on the N3 bed (`"music": {"bed": "n3"}` in its script) is laid out and
scored to the spec's grammar:
- the bed sounds from the film's first frame (its score starts a bar earlier,
  where the drone is struck), and `timeline.py` puts Bloom two
  of its beats later (`form.bed_first`, 2026-10-07), the first word 1.75 s
  after Bloom's last note and Reach 1.75 s after the last word, and lays each
  line's `demo` after it: 0.7 s, the demo, its tail to −30 dB (measured,
  `--demos`), 0.8 s;
- `fit_score.py --film` writes the bed and the marks to that timeline, with
  the bed's sighs in the narration's gaps;
- `illustrated.sh` and `walkthrough.sh` take that route for it, and mix it on
  stems.

The films move to it as they are re-voiced
([Plan-006](../../docs/plans/006-the-sound-of-the-films.md)). Until then, a
film laid out before the grammar (no marks, no demos in its timeline) is
mixed exactly as it was before ADR-014, except that no cue is laid:
- the voice untreated;
- its Study bed 6 dB under the voice and ducked 9 dB, with no carve;
- the app at its gain, ducked 4.5 dB.

Those values are sound.json's `before_the_grammar`. A re-finish of any of the
six voiced walkthroughs gives main's `mix.wav` byte for byte.

### A demo

A line hands over to the instrument with a `demo`:

```json
{"id": "named2", "text": "Hold a chord and ride Bright up.",
 "demo": {"id": "bright", "play_s": 6.5, "tail_s": 1.1}}
```

- `id` names the demo (the line's id when it has none).
- `play_s` is how long the instrument plays, from its first note to its last
  note-off.
- `tail_s` is the script's estimate of the ring-out, used only until the tail
  is measured.

The timeline lays it out after the line:
- 0.7 s;
- the demo;
- its tail, until it has fallen 30 dB under its playing level;
- 0.8 s;
- then the next line.

The line's own `post` is not used.

**Measure the tail** from a take or a render:

    python3 www/video/tools/demo_tail.py WAV FIRST_NOTE NOTE_OFF --id bright --demos www/video/out/<film>/demos.json

The playing level is the median RMS of the mono sum over 50 ms frames, from
the first note to the note-off. `voice.sh`, the films' timing scripts and
`illustrated.sh` pass `demos.json` to `timeline.py --demos` when it exists.
The timeline marks a demo it laid out on an estimate (ESTIMATED), and
`publish.py` refuses such a film. In the mix, the app's sound over each demo
window goes to −22 LUFS, and the bed sits 5 LU under it.

## Setting up

Everything here runs from the repo root, on Linux or macOS. **`make
film-setup`** (`scripts/setup.sh --film`) does all of the below that can be
installed without sudo: the app's toolchain and engine, `.venv-voice` with the
voice's pinned set and the film tools' packages
(`www/video/requirements-tools.txt`), the voice models, and the shared sound.
It needs rustup, Node 22 (`.node-version`) and Python 3.10–3.12, and is safe to re-run. The
film make targets run on `.venv-voice`; to run a tool by hand, `source
.venv-voice/bin/activate` first. The parts, for reference:

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
- **The shared sound**, once: `www/video/tools/sounds.sh` renders the old
  beds (`signal` and `study` in `sound/`) into `www/video/out/sound/`, for
  the films not yet moved to N3, and again whenever one changes. A film on
  N3 needs no shared render: `fit_score.py --film` writes its own score, the
  marks included, and its pipeline renders it (§ The sound).

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
3. **The bed.** On N3 (`"music": {"bed": "n3"}`) there is nothing to arrange:
   the timeline places the marks and each demo, and `fit_score.py --film`
   writes the bed to them. A film still on Study arranges its bed in
   `films/<film>/arrangement.json` (sections in bars at 84 BPM). A beat's
   `bed_db` sets the bed's level under it (≤ −60 is out).
4. **Draw it** in `films/<film>/film.js` with the kit, pinned to the timeline's
   cues. Preview with `python3 -m http.server 8000` from the repo root and
   `http://localhost:8000/www/video/films/<film>/?t=12&play`.
5. **Render:** `www/video/tools/illustrated.sh <film> <poster seconds>`. It
   writes the film's bed and marks (on N3) or fits the study score, and plays
   it. It makes a first mix, which gives the envelopes the picture pulses
   with. The picture makes no sound of its own: the stage has no sound cues
   (ADR-014). Then it renders the
   frames, mixes and encodes: MP4 and WebM, captions, poster (`DRAFT=1`: a
   fast MP4 and the 720p preview, no WebM).
6. **Footage, if it cuts to the app:** a film with a `shots.json` (the
   launch film) records its takes first, as a walkthrough's are recorded
   (`footage.mjs`, one browser, a quiet machine; rehearse them with
   `rehearse.sh` first), and reuses the takes on disk after that:
   `FOOTAGE=1` records them all again, `SHOTS=a,b` those. Its `film.js`
   reads each take's frames and logs from `out/<film>/shots/`, and draws the
   app with the kit's `appScreen` in the same window and camera, so a drawn
   frame crosses into the recording on the same picture.

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

- **Cast what the shot plays** from the films' shortlist (RFC-007 part 2):
  the sixteen presets in `www/brand/sound.json` `cast.shortlist`, measured
  quiet of noise, round and low in roughness. `shotgen.CAST` names the one
  each role plays (a pad, a pad whose Space turns toward far only, a lead,
  an acid line, a bass, a texture), each checked against the wiring it ships
  with (`shotgen.cast`); a session re-measures it, so the rehearsal's wiring
  log is the final word. `pick("cast")` is the warm start's card on the list,
  checked for first (`CAST_DEALT`), and a pick never clicks a card already
  picked. To drop a picture back onto the app, drop the one the shot just
  exported (footage.mjs `drop {download}`).
  An offer is grown from a cast preset, and the shot logs what grew.
  `shotgen.dump` refuses a shot that loads, opens or plays from the warm
  start a preset off the list, unless the shot's `"uncast"` gives the
  reason (its line names that preset or describes its circuit), and writes
  each shot's `"cast"`. What the session deals (the pool, a duel) is logged,
  not cast, until the sonic floor (RFC-005).
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
- **Let the app be the music, after the voice:** each demo plays after its
  line, never under it (a line's `demo`, § A demo), in F at 66 BPM, and the
  bed comes down 5 LU under it by itself. On N3 nothing snaps. A film still
  on Study keeps its chords on the bar line at 84 BPM (`"snap": "bar"`) and
  takes the bed out under its demos (`bed_db`).
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

On a quiet machine. It records every shot (picture from Chromium's
screencast, kept as the JPEG it sends for each paint plus an index of which
paint each 30 fps frame shows, so nothing is encoded between shots; sound from
the app's master bus through the `?film` capture hook, so every audition is in
it), then checks the takes (`tools/takes.py`: errors, the paint rate while the
page moves, sound). After that it fits and plays the study score, lays the
app's sound under each shot's stretch of film (`tools/app_audio.py`, which
follows the cuts), mixes, renders the frames on every core, and encodes the
MP4, the WebM and the 720p preview side by side.

- `--shot a,b` re-records only those shots and reuses the other takes.
- `--record-only` stops after the takes; `--no-record` finishes from takes
  already on disk. Only recording needs the quiet machine.
- `--draft` encodes a fast MP4 and the preview, no WebM: for review. Finish
  with `--no-record` (no `--draft`) before publishing.

`tools/record_films.sh [--draft] <film> <poster> …` records every film first
and logs "quiet window over", then finishes each in turn.

Where the time went, for a 4½-minute film (EVOLVE, recorded 28 September):
about 11 minutes of shots and 7 of set-ups, 19 with the browser idle while
each shot was encoded to VP9 (now gone), about 16 rendering (now about 1.5×
faster per frame on the same machine, and on every core), and 8 + 12 for the
MP4 and the WebM one after the other (now side by side, or a few minutes for
a `--draft`).

## Publishing

    python3 www/video/tools/publish.py <film> [<film> …]

It copies the film, captions and posters to `www/landing/assets/film/`,
records it in `films.json` (chapters from `CHAPTER_NAMES`, the transcript
from the timeline), regenerates the guide's Films page, fills every
`<!-- film:<name> -->` marker in the guide and the reference, fills the
landing page's and README's markers, and makes the silent loop for the home
page from `LOOPS` / `VIEW_LOOPS`. It also un-hides the app's one film link
in the page, the warm start's tour link, once the tour is out. It writes the
published tour and view films, with their lengths, into the film chip's
`data-films`, and un-hides the chip once a view has its film; the chip and
⌘K's *Watch ‹LEVEL› in depth* read that list (⌘K's *Watch the films* opens
the guide's Films page). `make site` then places the one copy wherever it is
embedded.

## The tools

The steps above are also `make` targets: `make film-sounds`, `make
film-voice FILM=…`, `make film FILM=… POSTER=…`, `make film-rehearse FILM=…`,
`make film-record FILM=… POSTER=… [DRAFT=1] [SHOTS=a,b]`,
`make film-record-all FILMS="name poster …" [DRAFT=1]`,
`make film-preview FILM=…` and `make film-publish FILMS="…"`. `make sound`
writes the scores and the mix's defaults from `www/brand/sound.json`.

| Tool | What it does |
|---|---|
| `tools/voice.sh` | Script → TTS → ASR gate → timeline on measured words |
| `tools/voice_script.py` | A film's script as `voice/tts.py` reads it, with the shared lexicon |
| `tools/timeline.py` | Beats and lines laid on the music's clock; `--voice` for measured word times. A line's `demo` is laid after it (0.7 s, the demo, its tail to −30 dB from `--demos`, 0.8 s), and a film on the N3 bed gets the entrance mark 1.75 s before its first word and the exit mark 1.75 s after its last |
| `tools/demo_tail.py` | A demo's tail measured: how long after its last note-off it takes to fall 30 dB, into the file `timeline.py --demos` reads |
| `tools/fit_score.py` | The study score stretched to a film's arrangement, its phrases repeated to fill each section and cut at its end; with `--film`, a film's N3 bed and marks written to its timeline, the sighs in the narration's gaps |
| `tools/sound_defaults.py` | Generated by `make sound` from `www/brand/sound.json`: the ladder, the voice chain, the duck, carve and dip, each part's EQ, pan and level, the grammar's timings, the marks' levels, the shortlist, the room, the bed's notes (`BED`), how the lead plays a line (`LEAD`), and how a film laid out before the grammar is mixed (`BEFORE_THE_GRAMMAR`: the bed's level and duck, the app's gain and duck) |
| `tools/test_fit_score.py`, `tools/test_timeline.py`, `tools/test_mix.py`, `tools/test_shotgen.py` | The tools' own tests, run by `make dev-check` (the mix's need `.venv-voice`); `test_shotgen.py` also checks that every walkthrough is cast, or (the three written by hand) says why not |
| `tools/sounds.sh` | The old beds of the films not yet on N3, rendered to `out/sound/` (again only when one changes) |
| `tools/footage.mjs` | Record (or `--dry` rehearse) a walkthrough's shots |
| `tools/shotgen.py` | Shared pieces for a film's shots generator |
| `tools/validate.mjs` | Check a walkthrough's words, marks and beats resolve |
| `tools/rehearse.sh` | One-browser dry run, then `tools/rehearsal.py`'s summary |
| `tools/framing.py` | Contact sheets of camera crops and callouts from a rehearsal |
| `tools/one_browser.sh` | Run a command when it is its turn for the browser (a first-come, first-served queue) |
| `tools/takes.py` | Check recorded takes before spending a render on them |
| `tools/app_audio.py` | The recorded app sound under the picture, through the cuts |
| `tools/render.mjs` | The frames (or `--at` stills), exactly; kept as parts listed in `picture.ffconcat` |
| `tools/mix.py` | Voice, bed, marks and app sound mixed to the ladder and encoded, with captions and poster; the mix measured in `out/<film>/ladder.json`. Lays no cues |
| `tools/poster.mjs` | A poster frame on its own |
| `tools/illustrated.sh` | An illustrated film, voice to encode |
| `tools/walkthrough.sh` | A walkthrough, recording to encode |
| `tools/record_films.sh` | Several walkthroughs: records them all (the quiet part), then finishes each (encode, preview, clear the frame parts); `--draft` for review; stops at the first failure |
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
