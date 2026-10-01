---
title: "Films: from script to the site"
last_updated: 2026-09-30
related_adrs: [3, 4, 14]
---

# Films: from script to the site

## Purpose

For anyone making or changing a film. How the pieces in `www/video/` fit
together, what each step writes, and the order to run them. The tools
themselves are listed in `www/video/README.md`; the `film` skill walks a film
through these steps.

## Two kinds of film

| Kind | Picture | Examples | Built by |
| --- | --- | --- | --- |
| **Illustrated** | Drawn on the deterministic stage (`stage/stage.js`, `kit.js`) from the engine's own data | launch, taste, math, dsp, engine | `tools/illustrated.sh` (`make film`) |
| **Walkthrough** | Recordings of the real app in a browser, framed and captioned by `stage/walk.js` | playing, composing, sounddesign, tour, view-* | `tools/walkthrough.sh` (`make film-record`) |

Both share the voice, the score, the mix and publishing.

## The pipeline

```text
script.json ──► voice.sh ──► timeline.json, arrangement.json, voice/*.wav
                 (Kokoro TTS, then an ASR round trip that must read every line back)
     │
     ├─ illustrated: film.js draws beats on the timeline
     │
     └─ walkthrough: gen_shots.py ──► shots.json (actions timed to words and stamps)
                        │
                        ├─ validate.mjs      every word, mark and beat resolves
                        ├─ rehearse.sh       dry run in one browser, lateness and errors
                        ├─ framing.py        callouts and crops as contact sheets
                        └─ footage.mjs       the recording: video and the app's own sound per shot
                              └─ takes.py    each take's errors, paint rate and sound
score:   fit_score.py sound/study.json → the engine plays it (examples/score.rs) → music/
cues:    render.mjs --cues (the picture's envelopes, for the mix)
mix:     mix.py voice + music + stingers + app sound, ducked, −16 LUFS, captions (.vtt)
render:  render.mjs → part-*.mkv + picture.ffconcat (frames, in parallel)
encode:  mix.py --encode [--draft] --preview --poster T → <film>.mp4, .webm, -preview.mp4, .jpg, .webp
         (side by side; --draft: a fast MP4 and the preview only)
publish: publish.py → www/landing/assets/film/, guide markers, Films page, README, app chip
```

The sound's values live in `www/brand/sound.json`
([ADR-014](../decisions/014-the-films-sound.md)). `make sound` writes the two
marks and the N3 bed into `www/video/sound/` and the mix's defaults into
`www/video/tools/sound_defaults.py`. `make dev-check` fails when one of them
is stale, when `sound.json` disagrees with the record scores' notes, and when
a number is `mix.py`'s bed or duck default or a pipeline's fallback for them.
[Plan-006](../plans/006-the-sound-of-the-films.md) brings the pipeline above
to the marks, the bed and the ladder; until then it plays Study with the
stingers, at the levels in `sound.json`'s `mix_now`.

## Walkthrough shots

A shot is a list of actions on a clock tied to the narration: `at` a word or a
beat time, `until` a later one, or a **stamp** (a state the app reached, such
as "the offer is ready"). A **clip** removes a stretch between two marks from
the final cut, so a wait the engine needs is not a wait the viewer sits
through. Holds press at `at`; only their release may wait on a stamp.

Every walkthrough runs a **seeded session**: a set-up (`INIT`, taught or
plain) that reaches the same state in every take. A taught set-up re-deals the
duel after the fill (`shotgen.REDEAL`): it skips until the pair on the table is
the fifth one the engine has dealt, each skip once the pair behind the table
has been dealt, so the duel does not depend on how far the fill had got when
the first pairs were dealt.

## Readiness

A walkthrough is ready to record when:

1. `voice.sh` passes the ASR gate (every line recognised);
2. `validate.mjs` is clean;
3. a full `rehearse.sh` passes every shot with no errors and no action late;
4. `framing.py` shows every callout inside the frame;
5. every claim on screen is true of the session it records
   ([ADR-004](../decisions/004-descriptions-stay-true.md)).

Record on a quiet machine, one film at a time
([ADR-010](../decisions/010-tests-share-the-browser-recordings-do-not.md)). Only the recording
needs quiet: `record_films.sh` records every film first and logs "quiet
window over", then finishes them. Re-record only what changed
(`--shot a,b`), and review a `--draft` encode before the full one. After encoding, review
before publishing: `takes.py` clean, a contact sheet of frames, integrated
loudness about −16 LUFS, the poster.

## Disk

Frames dominate: roughly 0.8 GB per minute of film at 1080p in parts. The
render keeps parts and an ffconcat list rather than joining them, so the peak
is one copy. A take's own frames (one JPEG per paint in
`out/<film>/shots/<shot>/`) are smaller, a few hundred MB a film, and are kept:
they are what a re-render reads. Delete a film's parts once its MP4 and WebM exist; they
re-render deterministically.

## Sending a film for review

Uploads stop at 30 MB and an iPhone does not play WebM. Send the 720p MP4
preview (`make film-preview FILM=<name>`), about 13 MB for five minutes.
`make film-record-all` makes one for each film it records.

## References

- `www/video/README.md`: every tool, and setting up the voice environment
- [ADR-010](../decisions/010-tests-share-the-browser-recordings-do-not.md),
  [ADR-004](../decisions/004-descriptions-stay-true.md)
- [`../runbooks/film-shot-fails.md`](../runbooks/film-shot-fails.md),
  [`../runbooks/disk-full.md`](../runbooks/disk-full.md)
