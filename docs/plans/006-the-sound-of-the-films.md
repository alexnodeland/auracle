---
title: "The sound of the films: the tools, the cast and the re-mix"
number: 6
status: active
author: Claude Code
created: 2026-09-30
updated: 2026-10-01
originating_proposal: 7
related_adrs: [4, 13, 14]
---

# Plan-006: The sound of the films

## Objective

This plan implements [RFC-007](../proposals/007-the-sound-of-the-films.md) under
[ADR-014](../decisions/014-the-films-sound.md). It brings the film tools to the
specification in [`SPEC.md`](../notes/sound-2026-09/SPEC.md):
- one source for the sound;
- the marks and the bed;
- the mix and the grammar;
- casting.

The films are then re-mixed. Recording and rehearsing need a quiet machine, so
the films whose footage must be re-recorded wait for one (Plan-004 task 8).

## Bounded contexts

| Context | Owns | Files |
| --- | --- | --- |
| Source | `sound.json` and its generator, the drift check | `www/brand/`, `www/video/sound/`, `make dev-check` |
| Scores | The marks, the bed, fitting a bed to a film | `www/video/sound/`, `www/video/tools/fit_score.py` |
| Mix | The ladder, the voice chain, the duck and carve, demo windows and tails | `www/video/tools/mix.py`, `app_audio.py`, `illustrated.sh`, `walkthrough.sh` |
| Timeline | Lines, pauses, demos and marks laid out on the clock | `www/video/tools/timeline.py`, `arrangement.json` |
| Casting | The shortlist in the shot generators, and what a shot grows | `www/video/films/*/gen_shots.py`, `tools/shotgen.py` |

## Tasks

1. **Fix now.** *Done* (#78).
   - beds go silent after bar 16 (`fit_score.py` never scales a phrase's
     `repeat`);
   - dsp's `render_glass_pad` cue has no WAV, and `mix.py` drops it silently;
   - the duck amount has three values in three places.
2. **One source.** *Done* (#78).
   - `www/brand/sound.json` holds the key, tempo and form; the cast with its
     knob tweaks; the marks; the bed's parts; the voice chain; the loudness
     ladder; the duck and carve; and the grammar's timings.
   - A generator writes the marks and the bed into `www/video/sound/` and the
     defaults into the mix.
   - `make dev-check` fails on drift.
3. **The mix.** *Done* (#84).
   - the voice chain;
   - the ladder (the bed at −3 LU, the demo and the marks at −18 LUFS, the
     master at −16);
   - the 2 dB duck with the 3 dB carve, and the pad's 2 dB vowel dip;
   - the app's sound normalized per demo window;
   - each part's EQ and pan;
   - cues removed.

   A film laid out before the grammar (no marks, no demos) is mixed exactly as
   it was, bar the cues, until it is re-voiced onto the grammar. Its levels are
   sound.json's `before_the_grammar`. A re-finish of each voiced walkthrough
   gives main's `mix.wav` byte for byte.
4. **The timeline.** *Done* (#84).
   - a line can carry a demo, laid out as a 0.7 s pause, the demo, its tail to
     −30 dB, then 0.8 s;
   - the entrance mark comes about 1.75 s before the first word, and the exit
     mark about 1.75 s after the last.

   On N3 nothing snaps. The tail is measured (`tools/demo_tail.py`,
   `--demos`), and `publish.py` refuses an estimated one. Deferred: mapping a
   walkthrough's demo to the stretch of its recorded take, so its tail is
   measured from the take (wave 3, with the re-recording).
5. **The scores.** *Done* (#84). `fit_score.py` fills sections, holds the
   drone, keeps ties across a cycle, and places the bed's sighs in the
   narration's gaps (they were placed by hand in the audition).
   - `fit_score.py --film` writes a film's N3 bed and its marks to its
     timeline. Written to the reel's timeline, the result is the approved reel
     note for note.
   - The sighs' rule is sound.json's `bed.parts.melody.placement`.
   - Deferred:
     - the passing chord before Reach (`passing_chord_beats`): the bed holds
       its chord through the bar before Reach instead, as the reel did;
     - a per-demo voicing under a demo: every demo takes the reel's A3 C4
       (`under_demo`).
6. **Stingers out.** *Done.*
   - `stingers.json` is gone, with `stage.sfx()`, its 25 call sites (launch,
     taste, math, engine, dsp, and the tour's title card), `render.mjs
     --cues` and `mix.py`'s count of them. The stage has no sound of its own.
   - Signal, launch's bed until it is re-voiced, loses its riser and its
     closing hit; its last section (`end`) is the finale ringing out.
   - The two marks take the cues' place: `timeline.py` puts Bloom 1.75 s
     before a film's first word and Reach 1.75 s after its last, where every
     logo sting stood (an outro's end card), as each film moves to N3.
7. **Casting:** the shot generators cast from the shortlist, including offers
   a shot grows (the tour's cold open).
8. **The words:** every script follows `www/brand/voice.md`'s spoken voice, and
   is re-voiced and re-timed.
   - **Known stale in the published films, fixed by re-voicing** (each line
     was true when recorded; the app changed under it, ADR-004):
     - the DSP film says *What fails is never played.* The keys now play an
       edit before its check, and a failed check mutes them
       (`www/video/films/dsp/script.json` ~141; published in
       `www/docs/src/films.md` ~158, `www/landing/assets/film/dsp.vtt` ~78
       and `www/landing/assets/film/films.json` ~356);
     - the playing film's storyboard quotes the MIDI toast
       *mapped: CC 74 → Bright*, which now reads *CC 74 now moves Bright,
       the first free control.* (`www/video/films/playing/storyboard.md`
       ~215);
     - the PERFORM view film's callout *learn: CC 20 → Space* mirrors the old
       learn toast, now *CC 20 now moves Space.*
       (`www/video/films/view-perform/film.js` ~268);
     - the callouts *Freeze: held* (`www/video/films/playing/film.js` ~109,
       `www/video/films/view-perform/film.js` ~229) and both storyboards'
       *held* for Wander's state (`playing/storyboard.md` ~45 and ~143, and
       `view-perform/storyboard.md` ~87): Wander now reads *frozen* (#80).
9. **The re-mix:**
   - films that need no new footage are re-mixed and published after review;
   - the walkthroughs are re-recorded on a quiet machine (Plan-004 task 8).
10. **Optional:** a glide field in `score.rs`, so the leads glide instead of
    bending into each note.

## Done when

- Every film uses the two marks and the N3 bed, with no cues.
- Each film's mix measures to the ladder.
- The grammar's timings hold in every film.
- `sound.json` is the one source, and the drift check runs in `make dev-check`.
