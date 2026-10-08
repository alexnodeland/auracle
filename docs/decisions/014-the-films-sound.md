---
title: "The films' sound: one key, one room, the instrument on top"
number: 14
status: accepted
author: Claude Code
created: 2026-09-30
originating_proposal: 7
superseded_by: null
---

# ADR-014: The films' sound

## Status

Accepted

## Context

The films' sound had launch-video tropes, no single voice, and the instrument
under its own soundtrack:
- 31 blips, 6 whooshes, and a logo sting with a sub-bass drop;
- four tonal centers and five reverbs;
- music that covered the playing.

The maintainer chose a direction by ear over six rounds of auditions
([RFC-007](../proposals/007-the-sound-of-the-films.md);
[`docs/notes/sound-2026-09/`](../notes/sound-2026-09/README.md)).

## Decision

- **The instrument scores its own films.** Every sound is a bank preset played
  by the engine, cast from a measured shortlist, and later from above the sonic
  floor (RFC-005).
- **No cues:** no whoosh, blip, shimmer, riser or sting, and never white noise.
- **One key, register and room:** F, at 66 BPM, in 8-bar cycles.
  - The bed and the on-camera playing share the key and register.
  - The parts share Cathedral's room.
- **Two marks:** Bloom opens and Reach closes. The motif is heard only in them.
  Since 2026-10-07 (the maintainer's choice, watching the launch film) the
  bed sounds from a film's first frame and Bloom comes two of its beats later,
  rather than Bloom blooming out of silence (`sound.json` `form.bed_first`;
  the drone is struck a bar before the film, so its slow attack is over by
  the first frame).
- **The bed is N3:**
  - a drone that only breathes;
  - voice-led harmony over the F pedal;
  - a burble;
  - falling sighs in the narration's gaps.
- **The voice is EQ'd at −18 LUFS,** with the bed at −3 LU, ducked 2 dB, and
  carved 3 dB in 1–4 kHz. The pad dips 2 dB in 300–600 Hz while the voice
  speaks. A demo is −22 LUFS with the bed 5 LU under it (from −18 and 9 LU,
  on 2026-10-07 and 8: the launch film's demos were a bit too loud).
- **The grammar:** explain, pause (0.7 s), demo, its tail rings out, a pause
  (0.8 s), then continue. The marks bracket the voice by about 1.75 s.
- **One source:** `www/brand/sound.json` holds the values, generated into the
  scores and the mix, with a drift check in `make dev-check`.

The values are in [`SPEC.md`](../notes/sound-2026-09/SPEC.md).

## Options Considered

### Option 1: Keep Signal, Study and the stingers

This is the launch-video sound the maintainer rejected. Rejected.

### Option 2: No music

Heard in round 1. The films lose their warmth, and the marks lose their place.
Rejected.

### Option 3: The instrument's own music, chosen by ear and specified as values (chosen)

It costs a rework of the film tools and a re-mix of every film.

## Consequences

- The film tools change ([Plan-006](../plans/006-the-sound-of-the-films.md)).
  Every film is re-mixed, and most are re-timed.
- Casting is a step of making a film, including what a shot grows.
- `www/video/AGENTS.md` points here, beside [`voice.md`](../../www/brand/voice.md)'s spoken voice.
