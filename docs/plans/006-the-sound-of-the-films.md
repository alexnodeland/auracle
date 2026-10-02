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
7. **Casting.** *Done.* The shot generators cast from the shortlist in
   `sound.json` (`cast.shortlist`), including offers a shot grows.
   - `shotgen.CAST` names the preset each role plays, checked against the
     wiring it ships with:
     - Slow Weather for chords and swells: Glass Pad's layout (a supersaw
       into a filter an LFO sweeps, the same knob addresses), with a band
       pass where Glass Pad has a low pass and a reverb where it has a
       chorus;
     - Morph Pad for the honest controls: it ships with Space toward far
       only and Grit a search control, and was measured so in session
       (vp-honest: *turns toward far only*, and Grit grew an offer);
     - Wobble Board for runs and touch; Ceiling for the acid line (Acid
       Line's circuit); Held Under for the bass; Rotor for a moving
       texture.

     `pick("cast")` is the warm start's card on the list (Ceiling, in the
     seeded deal), played and picked first, so it is what PERFORM opens and
     what My patches plays. `CAST_DEALT` logs the deal and stops with a
     clear message when it holds no card on the list, and a pick never
     clicks a card already picked.
   - An offer is grown from a cast preset and logged. The tour's cold open
     grows its offer from Slow Weather (rehearsed: *reverb → eq, resonance
     Q 0.8 → Q 0.9, detune 60% → 84%, +3 more*, then taken).
   - `shotgen.dump` refuses an off-list preset (loaded, opened, played on
     the warm start or dropped as a fixture) unless the shot's `uncast`
     gives the reason, and `tools/test_shotgen.py` holds every walkthrough
     to it in `make dev-check`; the four written by hand (launch's footage,
     seen and not heard; `circuit` and `perform`, replaced; `zzprobe`, a
     probe) are listed there with why. The exceptions, each because a
     line names the preset or describes its circuit: view-patch's one patch
     (Glass Pad, seven shots: read3 to read5 and hear5), its chains (Ask The
     Dice) and Steps (Loom); view-perform's Bell Jar (named9) and Loom
     (dock5); sounddesign's Ask The Dice (chains2); composing's MIDI clock on
     Loom (the one preset with a step sequencer). Task 8 moves them as it
     re-scripts: view-patch onto Slow Weather.
   - Not cast, and logged instead: what the session deals (the pool,
     duels, the warm start's other two picks). Casting those waits for the
     sonic floor (RFC-005).
   - A picture dropped back onto the app is the one the shot just exported
     (footage.mjs `drop {download}`), so view-patch's take2 and composing's
     share3 ("it opens as the same patch") are literally true; the First
     Bass fixtures are gone.
   - Rehearsed (shared lane, 1 October): the tour's `to-open`, `to-first`
     and `to-bank`, view-patch's `vp-cold` and `vp-take`, view-perform's
     `vp-honest`, and composing's `co-direction` and `co-share` pass. Every
     other recast shot is generated and validated; its full rehearsal is
     task 8's.
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
       `view-perform/storyboard.md` ~87): Wander now reads *frozen* (#80);
     - three films count *forty-two modules*; AUDIO IN, TRACK and CAPTURE
       (Plan-007 tasks 4 to 6) made it forty-five: the circuit film's line (`www/video/films/circuit/script.json`
       ~72), the DSP film's line (`dsp/script.json` ~62, published in
       `www/docs/src/films.md` ~158, `dsp.vtt` ~23 and `films.json` ~345) and
       its pill *the palette · 42 modules · 10 groups* (`dsp/film.js` ~630,
       its comment ~2375), and the PATCH view film's line
       (`view-patch/script.json` ~178), its callout *42 modules*
       (`view-patch/film.js` ~150) and storyboard (`view-patch/storyboard.md`
       ~168).
     - the PERFORM view film's storyboard quotes *grittier by 3.9σ* "in this
       session" (`view-perform/storyboard.md` ~184). Offers for a given seed
       changed when each offer began walking on a stream of its own, so that
       figure is not reproducible any more: re-check it at the rehearsal.
   - **Casting left to the re-script** (task 7): the `uncast` shots above.
     Each needs its line rewritten around a preset on the shortlist (or a
     Steps module added on camera), then the shot recast. view-patch's
     `KNOB_H` for Slow Weather is measured in its first rehearsal, as
     Ceiling's was, and read3 needs checking on the move: Slow Weather's
     filter is a band pass, so "a filter softens it" may not hold.
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
