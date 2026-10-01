---
title: "The sound of the films: one key, one room, the instrument on top"
number: 7
status: in-review
author: Claude Code
created: 2026-09-30
updated: 2026-09-30
supersedes: null
superseded_by: null
---

# RFC-007: The sound of the films

## Audience

The maintainer, who chose all of this by ear over five rounds of auditions on
2026-09-30, and anyone who scores, casts, mixes or narrates an Auracle film.
[RFC-004](004-design-direction.md) part 6 set "no UI sounds" and casting from
above the sonic floor, and part 7 set the voice and the pace.
[`www/brand/voice.md`](../../www/brand/voice.md) sets the spoken voice. This
proposal sets everything the films sound like around the words.

## Context

An audit of the films' sound on 2026-09-30 measured what they do today
([`AUDIT.md`](../notes/sound-2026-09/AUDIT.md)):

- **Launch-video tropes:**
  - 31 blips and 6 pass-by whooshes;
  - 5 logo stings with a 12-semitone sub-bass drop, 59% of the sting's energy
    below 60 Hz;
  - a riser;
  - a 100 BPM launch bed with a kick and a 16th-note arpeggio;
  - three four-chord loops.
- **No single voice:**
  - four tonal centers (D, F, A and C);
  - five different reverbs;
  - one preset (Glass Pad) in 61 of 107 shots, with nothing cast.
- **The instrument under its own soundtrack:**
  - the app's sound is laid in unmatched at −3 dB and ducks half as much as
    the bed;
  - in `playing`, the music covers the playing for 10.7 s.
- **Bugs:**
  - the beds go silent after bar 16 in the longer films (up to 44 s of digital
    silence in `math` and `dsp`);
  - a cue with no audio file is silently dropped;
  - the duck amount has three different values in three places.

The maintainer's brief: "this is an aesthetic audio project after all. So the
sample sounds and all of our sound marks or any transition sounds or background
music shouldn't be too launch video-ish. It should also carry a consistent
voice across all of these different settings and be in line with our visual
direction."

Five rounds of auditions followed, each with every take on the same excerpt at
the same loudness, and a sixth finished it. The evidence (the spec, the scores,
the marks and the final reel) is in
[`docs/notes/sound-2026-09/`](../notes/sound-2026-09/README.md). The direction that emerged, in the maintainer's words: "soft,
textural, not dinging bells… It shouldn't be like conference music. I think
more nature ambient, like Mort Garson."

## Proposal

### 1. Principles

- **The instrument scores its own films.** Every sound is a bank preset played
  by the engine. This is already true of the music; it becomes a rule for
  everything.
- **No cues.** No whoosh, blip, shimmer, riser or sting. A transition is the
  real sound changing, or a breath of less sound. Never white noise.
- **One key, one register, one room.**
  - The bed, the marks and the on-camera playing share F and a register.
  - The parts' reverbs are aligned to sound like one space.
- **The instrument sits on top.** The bed stays under a demo but never covers
  it.
- **Explain, pause, demo, continue.**
  - The voice never talks over a demo, and a demo never plays under speech.
  - A demo rings out, then the bed carries a pause, then the voice.
- **The marks bracket the voice closely.** The voice begins about two seconds
  after the entrance mark, and the exit mark follows the last word by about as
  much.

### 2. The cast

Sixteen presets, shortlisted by measurement:
- low spectral centroid;
- noise share 0.02 or less (white noise measures 0.70);
- low roughness;
- a round attack;
- no energy below 60 Hz worth naming.

Bells, tines and plucks are excluded by name.

| Role | Presets |
| --- | --- |
| Pads and textures | Cathedral, Long Room, Rotor, Morph Pad, Tidal, Slow Weather |
| Soft leads | Wobble Board, Falling Sign, Solo Flight, Telegraph, Choirboy, Fifth Wheel |
| Low and burbling | Held Under, Heartbeat, Ceiling, Dub Echo |

A film's demos are cast from this list, or from above the sonic floor once
RFC-005 exists. A shot that grows or takes an offer casts what it plays as
well. The tour's cold open played an offer grown from Glass Pad, with a noise
share of 0.70; that is what made round 1's opening sound like white noise.

### 3. Key, tempo, form

F, with Lydian and borrowed-minor color, at 66 BPM in 4/4, in 8-bar cycles.

### 4. The marks

Two marks, both in F, from the cast:

- **The entrance, "Bloom":** C, the Lydian B, A, then up to an open E, the
  major 7th, over Fmaj9, G6/F and Fmaj9. It ends open, and its last chord
  becomes the bed's first bar.
- **The exit, "Reach":** F, G, then a leap up a fourth to C, settling on A,
  over I, IV(maj9), iv6 and I. The leap is a shoot reaching up; the borrowed
  minor iv under the held C is the sigh before it resolves.

Both are played on Wobble Board (a soft, round lead with slow vibrato, sustain
0.80 and release 0.45) over a Cathedral pad and the drone, at −18 LUFS. Its
lead sits 6 dB over its pad.

### 5. The bed

Over an F pedal, the bed is:

- **The drone:** F2 and C3, held from the first second to the last and never
  re-struck. It breathes with one slow filter rise and fall a cycle.
- **The harmony:** voice-led, two bars a chord:

  | Bars | Chord | Voicing |
  | --- | --- | --- |
  | 1–2 | Fmaj9 | A3 C4 E4 G4 |
  | 3–4 | G6/F | B3 D4 E4 G4 |
  | 5–6 | B♭maj7/F | B♭3 D4 F4 A4 |
  | 7–8 | B♭m6/F | B♭3 D♭4 F4 G4 |

  Tied notes are held, and only moving voices re-strike. Two inner lines fall by
  half steps (B, B♭, A and D, D♭, C).
- **The burble:** a three-note cell in dotted eighths against the 4/4, under the
  voice's vowels, about 12 dB under the pad.
- **The melody:** short, falling two-note sighs on the chords' own notes, in a
  rhythm neither mark uses, in the narration's gaps only.
  - It never quotes the motif. The motif plays only as the two marks, so it is
    heard where it is placed and nowhere else.
  - It never plays in the bar before the exit mark.

### 6. The voice and the mix

- **The narration's chain:**
  1. a high-pass at 85 Hz;
  2. −2 dB at 315 Hz, when the low mids measure heavy;
  3. +2 dB at 4 kHz;
  4. a light split-band de-esser above 5 kHz;
  5. normalized to −18 LUFS.
- **The loudness ladder** (the E4 level, chosen by ear):

  | Element | Level |
  | --- | --- |
  | Voice | −18 LUFS |
  | Bed at rest | −21 LUFS (−3 LU relative to the voice) |
  | Bed under speech | Ducked 2 dB, plus a 3 dB carve in 1–4 kHz |
  | Demo | −18 LUFS |
  | Bed under a demo | 9 LU under the demo |
  | Marks | −18 LUFS |
  | Film master | −16 LUFS integrated, limiter at −1.2 dBTP |
- **The mix between the parts:** each part has its own place. Everything below
  150 Hz is centered.

  | Part | EQ | Stereo | Level |
  | --- | --- | --- | --- |
  | Drone | Low-pass 200 Hz | Mono | 6 LU under the pad |
  | Pad | High-pass 165 Hz; −2 dB in 300–600 Hz while the voice speaks | Wide | The reference |
  | Burble | 110–400 Hz | 20% left | 12 LU under the pad |
  | Bed melody | High-pass 220 Hz | 15% right | 4 dB under the pad |
  | Marks' lead | High-pass 220 Hz | Center | 6 dB over its pad |
  | Demo | None | Center | −18 LUFS, the bed 9 LU under it |
  | Voice | The chain above | Center | −18 LUFS |

  - **The drone's filter** halves its beating against the pad's B and D♭: that
    beating comes from its third harmonic at 262 Hz.
  - **No doubling:** where the melody would double the pad, the pad's top note
    rests.
  - **One room:** Cathedral's reverb is the cast's only room, and every part on
    it shares it; the leads sit dry in front of it. No outside reverb is added.
  - **Measured on the final reel:**
    - the voice is 23.6 dB over the bed in 1–4 kHz, and 2.7 dB in the vowel
      range;
    - the demo is 9.1 dB over the bed, with no dip under it;
    - both marks are at −18 LUFS;
    - the master is at −16.1 LUFS and −1.2 dBTP;
    - 41% of the bed's energy is in 100–300 Hz, down from 45%, and the drone,
      pad and burble share no band above 150 Hz.

### 7. The grammar's timings

| Moment | Value |
| --- | --- |
| The entrance mark | With the title, blooming into the bed's first bar |
| First line | 1.5–2 s after the entrance mark's last note |
| Pause before a demo | 0.7 s after the line's last word, on the bed |
| A demo | Starts mid-cycle so the pad doesn't re-strike under it. Its playing is about 6.5 s, and it is never cut off |
| After a demo | The tail rings out to −30 dB, then about 0.8 s on the bed, then the voice |
| The exit mark | 1.5–2 s after the last word, wherever the bed is in its cycle. The bed hands over into its first chord, and its own I, IV, iv, I resolves to F over the drone |

### 8. One source

Like `tokens.json` for color, one file, `www/brand/sound.json`, holds:
- the key, tempo and form;
- the cast, with each preset's knob tweaks;
- the marks' scores;
- the bed's parts;
- the voice chain;
- the loudness ladder;
- the duck and carve;
- the grammar's timings.

A generator writes the bed and the marks into `www/video/sound/` and the
defaults into the mix. `make dev-check` fails when a film's arrangement or
`mix.py` drifts from it.

## What changes in the film tools

[`SPEC.md`](../notes/sound-2026-09/SPEC.md) lists every change with
`file:line`. In brief:

- **`mix.py`:**
  - the ladder, the voice chain, the duck and carve;
  - demo windows with their tails;
  - the app's sound normalized per demo;
  - cues removed.
- **`timeline.py`:** a line can carry a demo, laid out as the pause, the demo,
  its tail, and the pause.
- **`fit_score.py`:**
  - sections filled, fixing the silence after bar 16;
  - the drone held;
  - ties kept across a cycle.
- **`stingers.json` and every `stage.sfx()` call:** removed. The two marks take
  their place.
- **Casting in the shot generators:** cast from the list, including what a shot
  grows.
- **Optional:** `score.rs` gains a glide field, so the leads glide instead of
  bending.

## Fix now, whatever else is decided

- **The beds go silent after bar 16** (`fit_score.py`).
- **dsp's `render_glass_pad` cue** has no audio file and is dropped silently.
- **The duck amount** has three different values in three places.

## Sequencing

1. **The fix-now bugs,** in their own small change.
2. **`sound.json` and its generator;** the bed and the marks as scores.
3. **`mix.py`, `timeline.py` and `fit_score.py`** to the spec, checked against
   the audition reel.
4. **Re-cast, re-voice and re-mix the films** (Plan-004 task 8). The view films
   come first, after the view rebuild (Plan-005).

## Alternatives considered

- **Keep Signal and Study.** They are the launch-video sound the maintainer
  rejected.
- **No music.** Heard as C4 and B4 in round 1; the films lose their warmth and
  the marks their place.
- **Library music.** It breaks "the instrument scores its own films" and the
  one-key rule.

## Consequences

- **Every film is re-mixed,** and most are re-timed: the grammar adds pauses
  and moves demos out from under speech.
- **The films sound like one instrument in one room,** in one key, with a mark
  at each end.
- **Casting becomes a step,** with the shortlist and, later, the sonic floor.

## Decided (maintainer, 2026-09-30)

Round by round in [`decisions.md`](../notes/vision-2026-09/decisions.md) (rounds 7
and 11 on) and in the sound notes:

1. **No cues.** Never white noise.
2. **Soft, textural, nature-ambient,** in the vein of Mort Garson. Not bells,
   not "conference music".
3. **One key and register** for the bed and the playing; the instrument over
   the bed.
4. **Explain, pause, demo, continue.** A demo rings out before the voice
   returns.
5. **The voice EQ'd,** with the bed at E4.
6. **Marks:** Bloom for the entrance and Reach for the exit.
7. **The bed:** N3, with the pad dipping 2 dB under the voice's vowels.
8. **The lead:** a little more sustain and release.
9. **The motif only in the marks:** the bed never quotes it.
10. **The marks bracket the voice:** the first word comes about 1.75 s after
    the entrance mark, and the exit mark about 1.75 s after the last word.
    The final reel runs 42.6 s.

## Open

1. **Melody placement:** generated per film from the narration's gaps, or
   written by hand.
2. **Glide in `score.rs`.**
3. **Casting from the sonic floor (RFC-005),** when it exists.
