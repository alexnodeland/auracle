---
title: "The sonic floor: a verdict beside φ, applied at the fill"
number: 26
status: accepted
author: Claude Code
created: 2026-10-31
originating_proposal: 5
superseded_by: null
---

# ADR-026: The sonic floor

## Status

Accepted by the maintainer on 2026-10-06, on #144: "accept RFC-005's
recommendations as written, its recommended answers to the open questions
included". The listen RFC-005 offered was not held first: "the listen kit
stays available for an ear check". Recorded here on 2026-10-31
([RFC-005](../proposals/005-the-sonic-floor.md)).
[Plan-009](../plans/009-the-sonic-floor.md) builds it, before the films are
cast (#142).

Three earlier records point at this floor by RFC-005's name. ADRs are not
edited, so they keep that name, and this record is the decision they wait on:
- [ADR-011](011-one-design-system.md): "A sonic floor governs a session's
  first deals and the films' casting, and nothing after that".
- [ADR-012](012-motion-shows-what-the-engine-does.md): a face drawn hollow
  below the floor.
- [ADR-014](014-the-films-sound.md): the films cast "later from above the
  sonic floor".

## Context

RFC-004 asked that the first sounds a player hears be good, under a floor the
engine measures, and left the engineering to RFC-005 (RFC-004 part 6 and
decision 6). Today the boot fill deals whatever the prior draws: a draw lands
unless the vet refuses it (2.2% of draws) or it repeats a tree in the pool.
The vet is a pathology gate, and nothing that measures a sound today tells
harsh from not. φ's flatness misses low-passed noise, and nothing in φ reads
roughness.

RFC-005 measured candidate readings over 2,000 fill draws and the 62 presets:
- a noise share and a sensory roughness of the held C4, about 4 ms a patch,
  where the render is 92–94% of a featurization;
- the share of energy above 5 kHz, which the face already measures, so it
  costs nothing.

The three rules agree on most of the draws they remove. Register, the third
reading RFC-004 named, would drop three of the films' cast, and #62 moves it
in the prior instead.

## Decision

1. **The floor is measured beside φ, as the face is.** A
   `FloorReport { noise, rough, hi }`, from a new
   `auracle-features/src/floor.rs`, is computed in `featurize_memo` on every
   featurization and carried on `CachedFeatures`.
   - `noise` and `rough` come from one 8192-point analysis of the held C4
     after its first 100 ms, and of the C4+E4 dyad for roughness.
   - `hi` comes off the face.
   - The model never reads it. φ, the vet and loudness normalization don't
     change.
2. **A sound clears the floor when all three hold:** `noise` ≤
   `FLOOR_NOISE_MAX` (0.5), `rough` ≤ `FLOOR_ROUGH_MAX` (2.5) and `hi` ≤
   `FLOOR_HI_MAX` (0.2). The thresholds are named constants, and the
   reference quotes them by name.
3. **The floor applies at the fill, and nowhere else.**
   - A prior draw below it is consumed and doesn't land, as a vet failure
     is. The serial fold (`fill_pool_step`) and the farm's
     (`absorb_prior`) admit the same draws.
   - It is on by default (`SessionConfig::sonic_floor`), so `make climb` and
     `make search-check` measure the fill that ships.
   - Walks, offers, edits, imports, restored sounds, presets and the warm
     start are not floored. No deal is floored except through the pool it
     deals from.
   - The prior is not reweighted.
4. **Register is left out.** #62's octave weights take it (merged in #363).
   There is no `spk` rule, and no `mute` rule. Of the three readings RFC-004
   named, this keeps harshness and noise dominance.
5. **No stored row without a verdict reaches the fill.** The floor moves
   `RENDER_EPOCH` from 3 to 4, so every row a browser kept under the old
   namespace is orphaned and cleared. Correctness rests on the namespace
   alone, as it does today, not on a rule in `farm.js`.
6. **The films cast from the same verdict.**
   - Off the shortlist in `www/brand/sound.json`, the floor replaces RFC-007's
     two-note probe, whose code is not in the repository.
   - A seeded session's prior draws in the pool, and a duel between two of
     them, are above the floor by construction, so a film can cast them.
   - The warm start's other cards stay logged, not cast. The page draws them,
     and about four warm starts in five show one below the floor.
7. **Hollow faces read the same verdict,** sent with each sound's row, when
   RFC-006's views draw them.
8. **Nothing on screen names the floor.** If the app or the guide comes to
   explain it, the word is drafted for `www/brand/voice.md` and waits for the
   maintainer ([ADR-013](013-one-voice.md)). The reference names it, in the
   technical register.

Not decided here:
- the noise share and roughness as φ coordinates, which the Grit question asks
  for (RFC-005 option B and open question 7): a φ change of its own;
- slow attacks (open question 8): a question about the prior's attack site.

## Options Considered

### Option 1: In the vet

A floor failure would be a quarantine.
- It would apply to every render, walks, offers and edits included, against
  decision 6.
- A refused patch has no φ and no face, so it can't be drawn hollow.
- The vet's thresholds are φ's contract, so `phi-stats`' quarantine table
  would move by the floor's whole rejection rate.

Rejected.

### Option 2: In φ

Noise share and roughness as coordinates the model learns from. It is a φ
change, with all it owes, and it still needs a rule over the values to be a
floor. Not now: worth deciding on its own, for Grit.

### Option 3: Beside φ, from what is already measured

φ's flatness and the face's high band, with no new pass. Filtered noise clears
it: Noise Wash, Static Ocean, Ticker and Woodblock. Rejected.

### Option 4: At the deal, or as a quota

- At the deal, the first duels would deal only sounds above the floor, at no
  render's cost. The bank would hold sounds below it from the start, and
  "first" would need a count.
- As a quota, a draw below the floor would land with some probability. It
  costs what the fill costs, scaled, and adds a constant.

Rejected for the fill.

### Option 5: Reweight the prior

Ruled out by RFC-004. Register belongs to #62.

### Option 6: Beside φ, with a new reading, applied at the fill (chosen)

About 4 ms a featurization. It costs renders at boot: a draw below the floor
is a render that doesn't land.

## Consequences

- **The fill takes more renders.** RFC-005 measured 1.36 renders for each
  patch that lands, against 1.02: 11.8 draws to the 8 the app hands over at,
  against 8.6, and 56.8 to a pool of 40, against 41.4. They were drawn with
  every octave equally likely, so Plan-009's first task measures them again
  under #62's weights. `max_draws` (400) stays ample.
- **The boot is measured again.** Each browser's first boot after the bump
  renders cold, once, as any cold boot does. The time to `playable` is
  measured before and after, cold and with the store warm. A slower hand-over
  is reported on #301, which holds the first sound to about a second on
  [ADR-025](025-every-interaction-answers-at-once.md)'s reference machine.
- **What a seed deals moves**, as #62 moved it. The boot probe is regenerated,
  the standardizer is fitted on a floored pool, and the shipped wirings and
  preset faces are measured again under the new namespace.
- **The search is revalidated, paired.** `make revalidate` runs on both sides,
  with `make climb` and `make search-check` read on one reference scale,
  since the floored arm's standardizer differs. `make phi-stats` and
  `make norm-peak` draw the prior directly, so they must not move.
- **A player hears the change in what the fill deals, and nowhere else.**
  After it, the model follows their picks below the floor as well: harsh can
  be someone's taste.
- **`apps/web` needs no code for the floor.** Its stores are stamped with the
  namespace. Hollow faces come with RFC-006's views.
- **Until the build, the films keep their rule:** what a seeded session deals
  is logged, not cast.
