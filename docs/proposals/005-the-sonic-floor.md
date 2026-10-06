---
title: "The sonic floor: where the measurement lives, what it costs, and the first deals"
number: 5
status: draft
author: Claude Code
created: 2026-10-06
updated: 2026-10-06
supersedes: null
superseded_by: null
---

# RFC-005: The sonic floor

## Audience

- **The maintainer,** who decided on 2026-10-06 that this proposal be written,
  measuring first (#144), and who accepts or amends its recommendation. The
  thresholds, the features and where the floor applies are design decisions,
  listed at the end as open questions.
- **Anyone building it:** the measurement (`auracle-features`), the fill
  (`auracle-session`), the wasm engine and the app (the first deals, and the
  hollow faces of [RFC-006](006-the-sound-at-the-centre.md) §3), and the film
  tools (casting, [RFC-007](007-the-sound-of-the-films.md)).

[RFC-004](004-design-direction.md) §6 named the sonic floor and left its
engineering to this proposal: where the measurement lives, what it costs, and
whether filtered first deals move the search's measured numbers
(`make revalidate`).

## Context

### What RFC-004 decided

- **"The first sounds a player hears are good."** RFC-004 found that "the boot
  fill, the warm start and the first duels deal whatever the prior draws", and
  set a floor "measured by the engine: harshness (for example sensory
  roughness and the share of energy far above the laptop band), noise
  dominance, and register".
- **Decision 6:** the floor governs a session's first deals and the films'
  casting, and nothing after that. The model then follows the player's picks
  below the floor as well: harsh can be someone's taste
  ([ADR-011](../decisions/011-one-design-system.md)).
- **The prior is not reweighted by the floor.** #62's octave reweighting
  (weights `[.05, .15, .40, .25, .15]` for octaves −2…+2) stands or falls on
  its own measurements and lands separately.
- **The vet stays a pathology gate.**

### What the first deals are today

- **The boot fill.** The pool (40 in the app, `poolSize` in `main.js`) fills
  from the indexed draw stream: `fill_draw` hands draws to the render farm,
  and `absorb_prior` folds results in index order (`fill_pool_step` is the
  same fold, serially). A draw lands unless the vet refuses it or it repeats
  a tree. The worker hands the app over when 8 have landed (`PLAYABLE_AT` in
  `worker.js`), and the first duel is dealt then. The fill runs at boot and
  at a restore's top-up, nowhere else.
- **Duels.** Before a posterior exists, `deal_duel_except` deals a uniform
  pair from the pool. The default rule (`Acquisition::Random`) stays uniform
  afterwards.
- **The warm start** deals presets, not prior draws: one card per preset
  category, then two more at random (`warmSample` in `main.js`). Its "teach
  it" fits a posterior at once (`warmStartDone` sends `fit`). So for a player
  who takes the warm start, one duel is dealt before a posterior exists.
- **The films** cast presets from RFC-007's shortlist. What a seeded session
  deals (the pool, a duel, the warm start's other cards) is logged, not cast,
  "until the sonic floor" ([`films.md`](../architecture/films.md)).

### What measures a sound today

- **The vet** (`vet.rs`), on the raw render: RMS, peak, `dc_ratio`, and
  `pinned_fraction`, which is informational. It refuses silence, runaway
  level, DC and non-finite samples, deliberately leniently: "a gate that
  quietly enforces a preference corrupts the data it protects"
  ([the reference](../../www/reference/src/audition/vetting.md)).
- **Normalization** (`loudness.rs`): the loudness before, the gain, and what
  the peak ceiling gave up. Playback has its own leveler
  (`auracle-wasm/src/level.rs`).
- **φ_audio**: 18 coordinates of the normalized render, among them
  `flatness_mean` (noise), `centroid_mean`, `bass_fraction`, `attack_s` and
  `motion_fast` (8–30 Hz flutter). Nothing in φ measures roughness. That is an
  open question of its own: Grit hears noise, not saturation
  ([open questions](../../www/reference/src/design/open-questions.md)).
- **The face** (`face.rs`): the render's spectrum in 40 bands and 12 slices,
  taken in every featurization. "A picture, not a feature": nothing in φ, the
  model or the vet reads it.
- **RFC-007's shortlist** used "noise share ≤ 0.02, roughness ≤ 6" from a
  two-note probe of the presets. That probe's code is not in the repo, so
  its numbers can't be reproduced or compared with anything here.

## What was measured

[`crates/auracle-features/examples/sonic_floor.rs`](../../crates/auracle-features/examples/sonic_floor.rs)
draws the fill stream as `Engine::draw_from` does: five fill seeds, the first
400 draws of each (`max_draws`), 2,000 draws in all. It featurizes each draw
step by step, timed, and reads every candidate on the same normalized render.
It also measures the 62 presets. Every share is also given under #62's
octave weights, as an importance-weighted estimate (effective n ≈ 1,330 of
1,956). The command, the machine and the tables as printed are in the
[appendix](#appendix-the-measurement).

New readings, defined in the example and nowhere else:

- **noise**: the share of the held C4's power outside its prominent spectral
  peaks (186 ms frames, after its first 100 ms). A tone reads near 0, harmonic
  or not; noise reads near 1, filtered or not.
- **rough**: sensory roughness, Vassilakis's pair model (Sethares-style
  dissonance) over the 40 strongest spectral peaks, frame by frame. It takes
  the median over the held C4 or over the C4+E4 dyad, whichever is larger. A
  harmonic tone reads near 0; beating partials and noise read high.
- **hi**, **spk**: the share of energy above 5 kHz, and in 200 Hz–5 kHz (what
  a laptop speaker plays; `pool_loudness`'s `spk`, which #62 quotes).
  `hi_face` and `spk_face` are the same shares read off the face.
- **period** and **wobble**: the held C4's periodicity and its pitch spread
  in cents. **mute**: the quietest of the phrase's four notes against the
  loudest, dB.

What the numbers say:

1. **The render is the cost; a reading is not.** Over four runs of the
   example as committed, a featurization's median is 186–235 ms, and the
   render is 92–94% of it. The new readings cost, as a share of one
   featurization: roughness and noise together 1.8–2.1%, pitch 1.1–1.4%, the
   bands 0.9–1.1%, mute 0.1%. The face,
   as a precedent, costs 1.0% or less here, and its own measurement found
   1.1% natively and 1.2% in wasm
   ([faces](../../www/reference/src/features/faces.md)). Read off the face,
   `hi` is free: it agrees with the new pass to a median difference of 0.000,
   and 28 of 1,956 draws fall on the other side of 0.2.
2. **φ's flatness misses filtered noise.** Of the 333 draws whose noise share
   is over 0.5, 139 read a flatness of 0.1 or less. Noise Wash reads flatness
   0.00 and noise 1.00: flatness divides the spectrum's geometric mean by its
   arithmetic mean over every bin to Nyquist, and a low-passed noise is not
   flat there. A floor on noise needs the new reading.
3. **The three harshness rules mostly agree.** Of 492 draws that fail
   `noise ≤ 0.5, rough ≤ 2.5, hi ≤ 0.2`, 29 fail on noise alone, 116 on
   roughness alone and 26 on the high band alone. Roughness correlates with
   noise (Spearman 0.81), and `hi` with the centroid (0.93). Of the 116 draws
   roughness removes on its own, 66 hold a supersaw and 28 a chorus: detuned
   and chorused sound.
4. **Register is a different question.** `spk ≥ 0.2` (#62's laptop
   threshold) clears 80.8% of vetted draws, 90.8% under #62's weights. It
   drops eight presets: Rotor, Heartbeat and Ceiling, all three in the films'
   cast, and Sub & Sparkle, Deadfall, Flint, Sour Mash and Inside Out. Six of
   the seven bass presets sit just above it (`spk` 0.21–0.32). By lowest
   oscillator octave, `spk < 0.2` holds for 54% of draws at −2 and 25% at −1,
   against 1–4% from 0 up: #62's table, reproduced. Even `spk ≥ 0.05` drops
   Deadfall and Flint.
5. **What the vet and the normalizer already measure is not a floor.**
   `pinned_fraction` is at most 0.002 in 95% of draws, so as a floor it would
   separate nothing. `dc_ratio` is at most 0.038 in 95% of draws (a blocker
   follows every tube drive). The peak cut and the gain cap are level, which
   playback already levels.
6. **Slow attacks are a style, not a fault.** 38% of vetted draws take more
   than a second to reach 90% of their first note (median 449 ms), but the
   cast has pads at 1.2–1.5 s (Cathedral, Choirboy, Slow Weather).
7. **Pitch adds little.** Periodicity tracks the noise share (Spearman
   −0.81). Pitch spread exceeds 25 cents in 18% of draws. Whether that is
   vibrato or a fault needs a listen, and no rule on it is proposed.
8. **The vet refuses 2.2%** (silence 2.0%, DC 0.1%). Every other draw lands
   today.

The candidate floors, over the 1,956 vetted draws (the full table, with the
#62 estimates and the module kinds each removes, is in the appendix):

| Floor | Clears | Draws to 8 | Draws to 40 | Renders per patch | Spread | Presets dropped |
|---|---|---|---|---|---|---|
| none (vet only) | 100% | 8.6 | 41.4 | 1.02 | 1.00 | 0 |
| noise ≤ 0.5 | 83.0% | 10.8 | 50.6 | 1.23 | 0.96 | 7 |
| rough ≤ 2.5, hi ≤ 0.2 | 76.3% | 11.8 | 56.6 | 1.34 | 0.95 | 8 |
| **noise ≤ 0.5, rough ≤ 2.5, hi ≤ 0.2** | **74.8%** | **11.8** | **57.2** | **1.37** | **0.95** | **9, none cast** |
| the same, hi off the face | 75.2% | 11.8 | 56.8 | 1.36 | 0.95 | 9, none cast |
| … and spk ≥ 0.05 | 68.8% | 12.0 | 62.2 | 1.49 | 0.93 | 10 |
| … and mute ≥ −30 dB | 72.9% | 11.8 | 57.8 | 1.40 | 0.94 | 9 |
| spk ≥ 0.2 (register) | 80.8% | 10.4 | 49.6 | 1.27 | 0.98 | 8, three cast |
| flatness ≤ 0.1, hi_face ≤ 0.2 (no new pass) | 87.8% | 10.2 | 48.8 | 1.16 | 0.97 | 4 |

"Draws to 8" and "to 40" are the draws a fill-time floor consumes before the
8th and 40th patch lands (mean of five boots). "Spread" is the mean pairwise
distance of the floored draws in standardized φ, against all vetted draws.

The proposed floor drops nine presets: Noise Wash, Static Ocean, Jet Wash and
Long Way Down (4 of the 13 textures); Flint, Ticker, Woodblock and Gated
Snare (4 of the 8 percussion); and Inside Out (1 of the 6 weird). It drops
none of the 16 the films cast. The cast preset nearest a threshold is Wobble
Board, at roughness 2.39 against 2.5.

What it does to the first deals: it removes 81% of the draws that hold a
noise source (58 of 303 clear it), about 40% of those with a ring modulator,
granular or vibrato, and about 37% of those with a chorus or a delay. The
floored draws sit 0.29–0.31σ lower on `n_noise`, `flatness_mean`,
`rolloff_mean` and `zcr_mean` than all vetted draws.

## Constraints

- **Decision 6.** The floor governs the first deals and the films' casting.
  It must not touch evolution, offers, edits or imports, and it must not
  reweight the prior.
- **The vet stays a pathology gate.** Its thresholds are part of φ's contract
  ([`crates/auracle-features/AGENTS.md`](../../crates/auracle-features/AGENTS.md)).
- **φ is a contract.** A change to φ owes `make revalidate` on both sides, a
  stimulus tag or a migration, `make perform-wirings` and `FILE_MASKED`.
- **The fill is a deterministic fold.** A draw's index is consumed whatever
  its outcome, and the farm and serial paths build the same pool
  ([ADR-001](../decisions/001-one-random-stream-per-consumer.md)).
  `crates/auracle-wasm/tests/boot_agrees.rs` pins what the shipped seed deals,
  natively and in wasm.
- **The app hands over at 8.** The pool is 40, the draw budget 400, and
  `fill_draw` over-issues by a quarter plus one.
- **Hollow faces need a verdict on every sound**, children and offers
  included (RFC-006 §3), not only on the fill's draws.

## Options

### Where the measurement lives

**A. In the vet.** A floor failure would be a quarantine.
- It would apply to every render, walks, offers and edits included, against
  decision 6.
- A refused patch has no φ and no face, so it can't be drawn hollow.
- `featurize_memo` keeps only successes, so a walk would re-render every
  refused proposal.
- The vet's thresholds are φ's contract, so `phi-stats`' quarantine table
  would move by the floor's whole rejection rate.

Not proposed.

**B. In φ.** Noise share and roughness as new coordinates the model learns
from.
- That is a φ change, with all it owes.
- It does not by itself make a floor: a floor is still a rule over the
  values.
- It is worth deciding separately, because a roughness axis is also what the
  Grit question asks for. The floor's readings can be promoted later.

**C. Beside φ, as the face is.**
- A `FloorReport` computed in `featurize_memo` from the same normalized
  render, carried on `CachedFeatures` beside the face, with a serde default.
  A row without it is measured again before the fill admits on it, so, as
  with faces, no `RENDER_EPOCH` bump. No such row exists today: nothing
  keeps rows across boots, and the farm sends its rows as whole
  `CachedFeatures` JSON, which carries a new field as it is.
- The model never reads it.
- Every featurization carries it, so a child, an offer or an import has a
  verdict too: enough for hollow faces and for casting any patch.
- The farm sends it with the rest of `CachedFeatures`, so the engine reads a
  verdict without a render.
- Two versions:
  - **C1, free:** φ's flatness and the face's high band. No new pass, but
    it misses filtered noise (Noise Wash, Static Ocean, Ticker and Woodblock
    all clear it).
  - **C2:** the noise share and roughness from one new analysis of the held
    note and the dyad (about 2% of a featurization), and the high band off
    the face.

**D. Reweight the prior.** Ruled out by RFC-004. Register belongs to #62.

### Where it applies

**(i) At the fill.** A draw below the floor is consumed and does not land,
exactly as a vet failure is (`push_prior`'s callers, `fill_pool_step` and
`absorb_prior`, reading the farm's report).
- The whole first bank is above the floor: the duels, the bank's ▶, the
  TASTE map, the patches a first offer walks from, and every film that
  records a seeded session.
- It costs renders: 1.37 per patch that lands instead of 1.02. The app
  waits 11.8 draws for the 8 it hands over at, instead of 8.6, and 57 for a
  full pool, instead of 41.
- 400 draws are still ample: a full pool takes 57. `fill_draw` keeps a
  quarter more draws in flight than the pool still needs, sized for today's
  pass rate of 98%; the build checks what 73% wants.
- It moves what a seed deals: the boot probe is regenerated, and the
  standardizer is fitted on a floored pool. The shipped preset wirings are
  measured under a booted pool's standardizer, so `make perform-wirings` is
  owed.
- `make climb` and `make search-check` fill through `Engine::fill_pool`, so
  they move. `make phi-stats` and `make norm-peak` draw the prior directly
  and cannot.

**(ii) At the deal.** The first N duels shown deal only from candidates
above the floor. The pool is unchanged.
- It costs no renders. The pool, the standardizer, the boot probe and the
  wirings are untouched.
- In all 243 runs of 8 vetted draws, at least two cleared the floor, so a
  pair can be dealt at `playable` and the hand-over stays at 8.
- The bank holds sounds below the floor from the start (drawn hollow, once
  RFC-006 builds them), and a player meets them with ▶.
- "First" needs a count, a new constant. "Before a posterior" would floor
  one duel for a player who takes the warm start.
- The harnesses move too if it is on in `SessionConfig`: their teaching
  duels come from the floored set.

**(iii) Shaped: a quota.** A draw below the floor lands with probability q,
drawn from the fill's own stream.
- A few harsh sounds stay in the first deals, so a player who likes them can
  say so early.
- It costs what (i) costs, scaled, and adds a constant.

Drawing extra and keeping the best by margin was considered and dropped: it
breaks the fold's rule that each index lands or not on its own, and it renders
more.

### What a floored fill does to the measured search

Read off the draws, on one reference scale (every vetted draw), with
`search_health`'s synthetic listener, the one `make climb` grades with:

- **Where the climb starts:** the pool's mean utility moves +0.07 and its
  expected best of 48 moves −0.13 (−0.18 with `hi` off the face), against a
  utility spread of 2.44. `search_health` documents that a change of ±0.4 in
  the climb's mean gain is inside its seed-to-seed spread.
- **The standardizer:** the floored pool's scale is 5% tighter (spread
  0.95). Four coordinates move about 0.3σ.

Whether the search climbs as well from a floored pool is not predictable from
draws; that is what the paired run is for.

## Recommendation

For the maintainer to accept or amend.

1. **Measure beside φ (C2).** A new `auracle-features/src/floor.rs` with
   `FloorReport { noise, rough, hi }`, computed in `featurize_memo` on every
   featurization and carried on `CachedFeatures`. `hi` comes off the face;
   noise and roughness come from one 8192-point analysis of the held note and
   the dyad. Its thresholds are named constants, `FLOOR_NOISE_MAX` (0.5),
   `FLOOR_ROUGH_MAX` (2.5) and `FLOOR_HI_MAX` (0.2), quoted by name in the
   reference.
2. **Apply it at the fill (i)**, on by default in `SessionConfig`, so the
   harnesses measure what ships, with the paired revalidation in the build
   PR. The alternative, off in `SessionConfig` and on in `WasmEngine`, would
   leave every table unmoved and measuring a fill the app does not run.
   Nothing else is floored: not walks, offers, edits, imports, saved
   patches restored, presets, or the warm start.
3. **The proposed floor is noise ≤ 0.5, rough ≤ 2.5, hi ≤ 0.2.** It drops
   none of the films' cast. The presets it drops are the noise and
   percussion presets built to sound that way, and Inside Out and Long Way
   Down. A listen confirms or moves each threshold.
4. **Leave register out of the floor.** This amends RFC-004's list of three:
   at #62's threshold a register rule drops three cast presets and sits on
   the bass category's edge, and #62 cuts the draws under that threshold from
   19% to 9% on its own. If a residual rule is wanted, `spk ≥ 0.05` removes
   6.7% of draws (3.2% after #62), and still drops Deadfall and Flint.
5. **The films cast from the same report.** For anything not on the
   shortlist, it replaces RFC-007's unrecorded probe (`noise share ≤ 0.02,
   roughness ≤ 6`). With the floor at the fill, what a seeded session deals is
   above the floor by construction, and the rule in `shotgen.py` and
   `films.md` that it is "logged, not cast" can point at the floor
   instead.
6. **Hollow faces read the same verdict**, sent with each sound's row, when
   RFC-006's views are built.

## What it would change

- **`auracle-features`**:
  - `src/floor.rs` and `floor/tests.rs`;
  - `CachedFeatures::floor`, filled in `featurize_memo` (`cache.rs`);
  - the exports in `lib.rs`;
  - a row for `floor.rs` in `crates/auracle-features/AGENTS.md`.
- **`auracle-session`**:
  - `SessionConfig::sonic_floor`;
  - the admission in `fill_pool_step` and `absorb_prior`, through
    `measure_draw` and `measured_here_if_stale`, so a listening draw measured
    here is floored the same way;
  - the fill's docs in `farm.rs`;
  - the verdict on `Candidate`.
- **`auracle-wasm`**:
  - the verdict on each row the app reads;
  - `tests/boot_probe.json` regenerated (`UPDATE_BOOT_PROBE=1`);
  - `apps/web/perform-wirings.json` re-measured.
- **`apps/web`**: nothing for the floor itself. The fill's card ("listening to
  40 sounds: you start as soon as the first 8 land") stays true. Hollow faces
  come with RFC-006's views.
- **The films**: `www/video/tools/shotgen.py` and
  [`films.md`](../architecture/films.md) say that what a session deals is
  cast; `www/brand/sound.json`'s shortlist criteria point at the floor.
- **The words**:
  - the reference gains a page beside the vet's, "The floor is not the vet",
    with the constants and this measurement, and a line in the design
    decisions;
  - `docs/architecture/system.md`'s pool step says what lands;
  - a changelog fragment, since a player hears the change.
  - If the app or the guide names the floor (to explain a hollow face, say),
    that word is drafted for `www/brand/voice.md` first.

## How to verify

- **The readings, in `floor/tests.rs`:**
  - a sine reads noise and roughness near 0;
  - white noise, and white noise through a low-pass, read noise near 1 (the
    second is the case φ's flatness misses);
  - two partials 30 Hz apart near 1 kHz read rougher than one alone.
- **The cast, as a census:** every preset on `sound.json`'s shortlist clears
  the floor. The list is read from the file, not retyped.
- **The fill, in the engine's tests:**
  - under the floor, only draws above it land, and one below it is consumed
    like a vet failure;
  - the serial and farm paths still build the same pool (the fold's existing
    tests, extended);
  - with the floor off, the pool is what it was.
- **Across targets:** `boot_agrees` is regenerated and its wasm spec run. A
  verdict compares a threshold with an FFT-derived value, which can differ
  between native and wasm in the last digits. The spec's `kept` and
  `draws_consumed` fields catch a verdict that flips.
- **The search, paired:**
  - `make climb` and `make search-check` before and after, both arms' pools
    read on one reference scale, as `learn_synthetic --compare` does, since
    the floored arm's standardizer differs;
  - `make phi-stats` and `make norm-peak`, to show they did not move.
- **`make perform-wirings`**, committed.
- **The boot, in the browser:** wall clock from `init` to `playable` and to
  `filled`, before and after, on the test port.
- **A listen**, below.

## What a listen checks

The example's `--listen DIR` writes the renders to start from: for each rule,
the four draws nearest its threshold on each side among those the other two
rules clear, and the first eight draws that clear the floor and the first
eight that don't. On laptop speakers and on headphones:

1. **Roughness's line first.** Are the draws just over 2.5 harsh, or lush
   detuned sounds that belong in a first impression? Most of what roughness
   removes alone is supersaw and chorus, and Wobble Board, in the cast, sits
   at 2.39.
2. **Each edge.** If the side that fails sounds fine, the threshold moves
   out; if the side that clears sounds bad, it moves in.
3. **Clears against fails, blind.** Would you be glad to hear each as one of
   your first sounds?
4. **The nine presets the floor drops.** Should a first impression skip
   them? The percussion is judged on the held C4 after its first 100 ms,
   which is mostly its decay: Woodblock reads noise 1.00 there.

## Open questions

For the maintainer:

1. **Fill, deal or quota?** This proposal recommends the fill.
2. **The thresholds:** noise ≤ 0.5, rough ≤ 2.5, hi ≤ 0.2, after a listen.
3. **Register:** leave it to #62 (recommended), or add `spk ≥ 0.05`?
4. **A note that doesn't speak:** add `mute ≥ −30 dB`? It removes 2.8% of
   draws and no preset.
5. **The window:** noise and roughness read the held C4 after its first 100 ms
   (roughness takes the dyad too). Should they read the phrase's loudest
   span instead, so percussion is judged on its strike?
6. **The warm start** is unfloored by design: it is there to span the space.
   About four warm starts in five show at least one preset below the floor.
   It deals one card per category, then two from the rest, so none is below
   the floor with probability (9/13)·(4/8)·(5/6)·(46/55)·(45/54) ≈ 0.20.
   Keep it so?
7. **Roughness and the noise share in φ**, for Grit: a separate φ change.
8. **Slow attacks:** 38% of draws take over a second to arrive. That is a
   question about the prior's attack site, like #62's octaves, and outside
   the floor.
9. **A word for players.** Nothing here names the floor on screen. If the
   app or the guide comes to explain a hollow face, its word is drafted for
   `www/brand/voice.md` and waits for your approval.

## Appendix: the measurement

```bash
nice -n 10 cargo run -p auracle-features --example sonic_floor --release -- 5 8 --listen DIR
```

Five boots, eight threads, on an Apple M3 Max (16 cores) with a load average
of 19–36 from other builds during the runs. The readings are deterministic:
six runs printed the same values. The timings are not: read them as shares,
which held to within a point across runs. A run takes about 90 s. The
example prints every table below; the preset table is cut here to the
presets a floor drops and the cast preset nearest a threshold.

The vet, over 2,000 draws: 1,956 land (97.8%), 41 are silent (2.0%), 3 are
DC-dominated (0.1%); under #62's weights, 97.9%, 1.9% and 0.1%.

Cost per patch, one run (ms):

```text
step                                 median      p90    share
featurize (render, vet, φ, face)     185.92   543.11   100.0%
  render                             171.76   525.49    92.4%
  vet + normalize                      2.74     3.94     1.5%
  φ (audio + struct)                   7.15    11.59     3.8%
  face                                 1.91     2.95     1.0%
bands: spk, hi (new pass)              2.09     3.28     1.1%
peaks: rough + noise (8192 FFT)        3.97    13.87     2.1%
pitch: period + wobble (NACF)          2.52     4.24     1.4%
mute (per-note RMS)                    0.13     0.14     0.1%
```

The candidates over vetted draws, and the share that clears each threshold
(in brackets, under #62's weights):

```text
candidate      from        p5      p25      p50      p75      p95 presets50   clears: uniform prior (#62)
flatness       φ        0.000    0.000    0.001    0.006    0.273     0.000   ≤0.05: 88.7% (88.9%) ≤0.1: 89.6% (89.9%) ≤0.2: 91.7% (91.9%)
noise          new      0.000    0.002    0.058    0.307    0.996     0.020   ≤0.3: 74.5% (78.9%) ≤0.5: 83.0% (84.2%) ≤0.7: 85.7% (86.4%)
period         new      0.133    0.912    0.994    0.999    1.000     0.993   ≥0.3: 88.2% (88.7%) ≥0.5: 85.7% (86.3%) ≥0.7: 83.2% (83.9%)
rough          new      0.002    0.234    1.197    2.263    4.239     0.719   ≤2: 71.0% (74.5%) ≤2.5: 78.6% (80.1%) ≤3: 83.1% (83.7%)
motion_fast    φ       -6.644   -6.644   -6.551   -4.381   -2.444    -6.077   ≤-4: 80.6% (79.9%) ≤-3: 91.1% (90.7%) ≤-2: 96.9% (96.2%)
hi (> 5 kHz)   new      0.000    0.000    0.007    0.039    0.648     0.001   ≤0.1: 85.4% (85.6%) ≤0.2: 91.0% (91.1%) ≤0.35: 92.9% (93.2%)
hi_face        face     0.000    0.000    0.007    0.035    0.543     0.001   ≤0.1: 86.4% (86.6%) ≤0.2: 92.4% (92.6%) ≤0.35: 93.7% (93.9%)
centroid Hz    φ      148.542  724.575 2753.382 4463.117 9766.205   944.020   ≤1500: 38.0% (36.5%) ≤2500: 45.5% (43.9%) ≤4000: 69.6% (67.8%)
spk (200–5k)   new      0.016    0.243    0.688    0.944    1.000     0.831   ≥0.05: 93.3% (96.8%) ≥0.1: 90.2% (95.0%) ≥0.2: 80.8% (90.8%)
spk_face       face     0.024    0.338    0.731    0.956    1.000     0.833   ≥0.05: 94.0% (97.4%) ≥0.1: 91.9% (96.3%) ≥0.2: 84.3% (92.3%)
bass_fraction  φ        0.000    0.003    0.171    0.655    0.983     0.147   ≤0.5: 66.9% (81.3%) ≤0.7: 76.7% (88.8%) ≤0.85: 86.6% (93.5%)
wobble cents   new      0.000    0.129    0.922   12.803  139.665     1.141   ≤10: 73.2% (73.9%) ≤25: 81.7% (81.4%) ≤50: 87.6% (87.4%)
mute dB        new    -28.442  -14.798   -8.044   -4.983   -2.922    -5.231   ≥-40: 99.3% (99.5%) ≥-30: 97.2% (97.2%) ≥-20: 83.3% (83.1%)
attack ms      φ        4.945   59.801  448.795 1552.452 1747.774    38.631   ≤500: 51.6% (52.0%) ≤1000: 61.7% (61.5%) ≤1500: 72.6% (72.2%)
pinned         vet      0.000    0.000    0.000    0.000    0.002     0.000   ≤0.05: 100.0% (100.0%) ≤0.1: 100.0% (100.0%) ≤0.2: 100.0% (100.0%)
dc_ratio       vet      0.000    0.000    0.000    0.001    0.038     0.000   ≤0.01: 90.5% (90.1%) ≤0.05: 95.5% (95.1%) ≤0.1: 97.4% (97.1%)
peak cut dB    norm     0.000    0.000    0.000    0.000    4.021     0.000   ≤1: 87.7% (88.5%) ≤4: 94.9% (95.0%) ≤8: 99.1% (99.0%)
gain capped    norm     0.000    0.000    0.000    0.000    1.000     0.000   ≤0: 91.8% (92.2%)
the face against the new pass: spk |Δ| median 0.007, p95 0.124, 15 draws across 0.05; hi |Δ| median 0.000, p95 0.102, 28 draws across 0.2
```

The candidate floors. "Moves" gives the four φ coordinates the floored draws
shift most, in σ of all vetted draws. "More of" lists the module kinds a
floor removes at a rate well above its overall rate, among kinds in at least
40 vetted draws. Δu and Δbest48 are `search_health`'s listener, the mean and
the best of 48, on the same scale, where u has a spread of 2.44:

```text
floor     rule                                            clears   (#62)   to 8  to 40  renders/  P(≥2|8)  spread     Δu Δbest48
vet only  the fill as it is: no floor                     100.0%  100.0%    8.6   41.4      1.02     100%    1.00  +0.00   +0.00
noise     noise ≤ 0.5                                      83.0%   84.2%   10.8   50.6      1.23     100%    0.96  +0.19   -0.02
          moves: flatness_mean -0.30σ, n_noise -0.29σ, rolloff_mean -0.23σ, zcr_mean -0.23σ
          removes 17% overall; more of: noise 76% of 303, granular 34% of 47, ringmod 31% of 58, vibrato 26% of 90, phaser 24% of 62, bitcrush 23% of 65
harsh     rough ≤ 2.5 and hi ≤ 0.2                         76.3%   77.8%   11.8   56.6      1.34     100%    0.95  +0.07   -0.12
          moves: flatness_mean -0.31σ, n_noise -0.31σ, zcr_mean -0.30σ, rolloff_mean -0.30σ
          removes 24% overall; more of: noise 79% of 303, ringmod 40% of 58, vibrato 38% of 90, chorus 37% of 204, delay 36% of 253, bitcrush 32% of 65, phaser 32% of 62, granular 30% of 47
floor     noise ≤ 0.5, rough ≤ 2.5, hi ≤ 0.2               74.8%   76.5%   11.8   57.2      1.37     100%    0.95  +0.07   -0.13
          moves: n_noise -0.31σ, flatness_mean -0.31σ, rolloff_mean -0.30σ, zcr_mean -0.29σ
          removes 25% overall; more of: noise 81% of 303, granular 43% of 47, ringmod 41% of 58, vibrato 38% of 90, chorus 37% of 204, delay 37% of 253, bitcrush 34% of 65, phaser 32% of 62, filter 32% of 568
face hi   the same, hi read off the face                   75.2%   76.9%   11.8   56.8      1.36     100%    0.95  +0.07   -0.18
          moves: flatness_mean -0.31σ, n_noise -0.31σ, rolloff_mean -0.29σ, zcr_mean -0.29σ
          removes 25% overall; more of: noise 80% of 303, granular 43% of 47, ringmod 40% of 58, vibrato 37% of 90, delay 36% of 253, chorus 36% of 204, bitcrush 34% of 65, phaser 32% of 62
+ laptop  floor, and spk ≥ 0.05                            68.8%   73.9%   12.0   62.2      1.49     100%    0.93  +0.22   -0.23
          moves: n_noise -0.32σ, flatness_mean -0.31σ, zcr_mean -0.19σ, rolloff_mean -0.18σ
          removes 31% overall; more of: noise 84% of 303, granular 47% of 47, ringmod 47% of 58, vibrato 44% of 90, delay 44% of 253, chorus 43% of 204, filter 41% of 568
+ speaks  floor, and mute ≥ −30 dB                         72.9%   74.4%   11.8   57.8      1.40     100%    0.94  +0.13   -0.17
          moves: flatness_mean -0.31σ, n_noise -0.31σ, zcr_mean -0.30σ, rolloff_mean -0.30σ
          removes 27% overall; more of: noise 81% of 303, granular 45% of 47, ringmod 41% of 58, vibrato 40% of 90, chorus 40% of 204, delay 38% of 253, filter 34% of 568
register  spk ≥ 0.2 (#62's laptop threshold)               80.8%   90.8%   10.4   49.6      1.27     100%    0.98  -0.02   -0.11
          moves: bass_fraction -0.36σ, rolloff_mean +0.26σ, zcr_mean +0.25σ, centroid_mean +0.21σ
          removes 19% overall; more of: vco 26% of 794
free      flatness ≤ 0.1 and hi_face ≤ 0.2 (no new pass)   87.8%   88.1%   10.2   48.8      1.16     100%    0.97  +0.20   -0.02
          moves: flatness_mean -0.30σ, rolloff_mean -0.26σ, zcr_mean -0.25σ, n_noise -0.24σ
          removes 12% overall; more of: noise 63% of 303, duck 18% of 44, phaser 18% of 62
```

How the readings relate, and the proposed floor's rules:

```text
spearman noise ~ flatness     +0.59
spearman noise ~ period       -0.81
spearman rough ~ noise        +0.81
spearman hi ~ centroid        +0.93
spearman spk ~ bass_fraction  -0.83
noise > 0.5: 333 draws, 139 of them at flatness ≤ 0.1
the floor fails 492: on noise alone 29, roughness alone 116, the high band alone 26
of the 116 roughness alone removes, the most hold: supersaw 66, vco 44, filter 39, chorus 28
draws with a noise source: 303, of which 58 clear the floor
#62's weights: effective n 1328 of 1956
```

Register by lowest oscillator octave:

```text
lowest octave   -2   465 draws   spk < 0.2:   54%   spk < 0.05:   19%
lowest octave   -1   374 draws   spk < 0.2:   25%   spk < 0.05:    7%
lowest octave   +0   368 draws   spk < 0.2:    2%   spk < 0.05:    1%
lowest octave   +1   303 draws   spk < 0.2:    1%   spk < 0.05:    1%
lowest octave   +2   271 draws   spk < 0.2:    4%   spk < 0.05:    2%
lowest octave none   175 draws   spk < 0.2:    7%   spk < 0.05:    4%
```

The presets each floor drops (the example prints every preset's readings):

```text
vet only  fails  0 of 62 presets (0 of the 16 cast)
noise     fails  7 of 62 presets (0 of the 16 cast)
harsh     fails  8 of 62 presets (0 of the 16 cast)
floor     fails  9 of 62 presets (0 of the 16 cast)
face hi   fails  9 of 62 presets (0 of the 16 cast)
+ laptop  fails 10 of 62 presets (0 of the 16 cast)
+ speaks  fails  9 of 62 presets (0 of the 16 cast)
register  fails  8 of 62 presets (3 of the 16 cast)
free      fails  4 of 62 presets (0 of the 16 cast)
```

```text
preset             flat  noise  rough    hi   spk   mute att ms  fails
Noise Wash         0.00   1.00   4.21  0.00  0.38   -5.0   1858  noise, harsh, floor, face hi, + laptop, + speaks
Static Ocean       0.04   0.84   4.46  0.18  0.80   -8.2   1494  noise, harsh, floor, face hi, + laptop, + speaks
Jet Wash           0.52   0.99   2.16  0.74  0.25   -3.8     30  noise, harsh, floor, face hi, + laptop, + speaks, free
Long Way Down      0.05   0.23   3.04  0.11  0.86   -5.1    145  harsh, floor, face hi, + laptop, + speaks
Flint              0.36   0.99   3.18  0.96  0.04   -9.3      1  noise, harsh, floor, face hi, + laptop, + speaks, register, free
Ticker             0.08   1.00   6.31  0.19  0.81   -4.0      4  noise, harsh, floor, face hi, + laptop, + speaks
Woodblock          0.00   1.00   0.41  0.02  0.98   -5.1      1  noise, floor, face hi, + laptop, + speaks
Gated Snare        0.51   1.00   3.59  0.79  0.21  -18.1      2  noise, harsh, floor, face hi, + laptop, + speaks, free
Inside Out         0.04   0.20   9.16  0.84  0.16   -9.8   1805  harsh, floor, face hi, + laptop, + speaks, register, free
Wobble Board       0.00   0.04   2.39  0.00  0.85   -3.7      3    [cast]
Rotor              0.00   0.00   0.29  0.00  0.13   -7.8   1515  register  [cast]
Heartbeat          0.00   0.00   0.03  0.00  0.17   -3.2    136  register  [cast]
Ceiling            0.00   0.04   0.19  0.00  0.18   -4.0      4  register  [cast]
Deadfall           0.00   0.05   0.44  0.00  0.03   -8.5      6  + laptop, register
```
