---
title: "The sonic floor: the reading, the floored fill, and the films cast by it"
number: 9
status: active
author: Claude Code
created: 2026-10-31
updated: 2026-10-31
originating_proposal: 5
related_adrs: [1, 4, 11, 12, 13, 14, 25, 26]
---

# Plan-009: The sonic floor

## Objective

This plan builds [RFC-005](../proposals/005-the-sonic-floor.md) under
[ADR-026](../decisions/026-the-sonic-floor.md):

- a `FloorReport` beside φ on every featurization, with its three thresholds
  as named constants;
- a fill that admits only the prior draws above the floor, on by default, and
  revalidated;
- the films casting a seeded session's prior draws by the same verdict.

The maintainer accepted RFC-005 on 2026-10-06 and asked for the build before
the films are cast (#142). #144 tracks it.

Hollow faces read the same verdict, but they come with RFC-006's views
([Plan-005](005-the-sound-at-the-centre.md)), not here.

## Bounded contexts

| Context | Owns | Files |
| --- | --- | --- |
| Census | The measurement the thresholds rest on | `crates/auracle-features/examples/sonic_floor.rs` |
| Reading | `FloorReport`, `FLOOR_NOISE_MAX`, `FLOOR_ROUGH_MAX`, `FLOOR_HI_MAX`; the report on `CachedFeatures`; `RENDER_EPOCH` | `crates/auracle-features` (`src/floor.rs`, `src/floor/tests.rs`, `src/cache.rs`, `src/lib.rs`, `AGENTS.md`) |
| Fill | `SessionConfig::sonic_floor`, the admission, the verdict on `Candidate` | `crates/auracle-session` (`src/engine.rs`, `src/farm.rs`) |
| Bindings | The verdict on each row the app reads; what the shipped seed deals | `crates/auracle-wasm`, its `tests/boot_probe.json`, and the generated `apps/web/perform-wirings.json` and `apps/web/preset-faces.json` |
| Words | What describes the fill | `www/reference/src/`, `docs/architecture/`, `changelog.d/` |
| Casting | What a film may cast from a seeded session | `www/video/tools/shotgen.py`, `docs/architecture/films.md`, `www/video/README.md`, `www/brand/sound.json` |

## Progress

Three PRs and one issue: #144 tracks the build until the last of them merges.

| PR | Tasks | Issue | Status |
| --- | --- | --- | --- |
| A: the acceptance record (RFC-005 accepted, ADR-026, this plan, and the pages that pointed at RFC-005) | – | #144 | built (`claude/accept-rfc-005`) |
| B: the floor in the engine, revalidated, with the words that describe it | 1–7 | #144 | not started |
| C: the films cast by the floor | 8 | #144 | not started; #142's casting waits for it |

PR B carries the words that describe the fill (task 7), because a description
changes in the same change as what it describes
([ADR-004](../decisions/004-descriptions-stay-true.md)). The reference's
page quotes the floor's constants by name, and `make dev-check` fails on a
quoted name the code doesn't have, so that page can't land before the code.

## Tasks

### 1. The census again, under #62's octave weights

RFC-005's numbers were drawn with every octave equally likely. #62's weights
merged after it (#363, 2026-10-07). The prior now draws each oscillator's
octave from `OCTAVE_WEIGHTS` (`[.05, .15, .40, .25, .15]` for −2…+2, in
`prior.rs`) in both samplers, so every fill seed draws other trees. The RFC's
"(#62)" columns were an estimate (an effective n of about 1,330 of 1,956).

- `examples/sonic_floor.rs` draws through the prior, so it draws the weights
  already. Its importance weight (`w62`: each oscillator's weight in
  `OCTAVE_WEIGHTS_62` over 1/5) would now count them twice. Drop it, with the
  "(#62)" columns and the effective n, so every share is measured, not
  estimated.
- Re-run it:
  `nice -n 10 cargo run -p auracle-features --example sonic_floor --release -- 5 <threads>`.
- Record the result in this plan, in a *Measured (task 1)* section, beside
  RFC-005's numbers:
  - for the recommended floor (the example's `face hi` row): the share that
    clears, draws to 8 and to 40, renders per patch, `P(≥2|8)`, the spread,
    Δu and Δbest48;
  - the presets it drops, and the cast preset nearest a threshold. A preset's
    readings don't depend on the prior, so a change there means the render
    moved;
  - the register table by lowest octave, which shows whether #62 did for
    `spk` what RFC-005 estimated (`spk ≥ 0.2` for about 91% of draws).
- The constants stay the accepted ones. A result that undoes RFC-005's case
  for them goes to the maintainer before task 2: a cast preset below the
  floor, or a floored pool that doesn't fill within `max_draws` (400).
- `--listen DIR` writes the 48 renders for an ear check, if the maintainer
  asks for one. ADR-026 keeps the kit available.

### 2. The reading (`auracle-features`)

- `src/floor.rs`: `FloorReport { noise, rough, hi }` and the three constants,
  `FLOOR_NOISE_MAX` (0.5), `FLOOR_ROUGH_MAX` (2.5) and `FLOOR_HI_MAX` (0.2),
  with the verdict: a sound clears when all three hold.
  - `noise` and `rough` from one 8192-point analysis of the normalized
    render: the held C4 after its first 100 ms, and the C4+E4 dyad for
    roughness (the larger of the two medians), as the example reads them.
  - `hi` off the face's long-term spectrum (the share above 5 kHz), at no
    cost.
- Computed in `featurize_memo` on every featurization, and carried as
  `CachedFeatures::floor` beside the face, with a serde default as the face
  has. Exported in `lib.rs`.
- The example then reads noise and roughness through `floor.rs` rather than
  its own copy, so the census and the floor can't part.
- Its cost measured natively and in wasm, as the face's was
  ([faces](../../www/reference/src/features/faces.md)). RFC-005 measured about
  4 ms natively, 2% of a featurization at the lighter load.
- `src/floor/tests.rs`, from RFC-005's *How to verify*:
  - a sine reads noise and roughness near 0;
  - white noise, and white noise through a low-pass (the case φ's flatness
    misses), read noise near 1;
  - two partials 30 Hz apart near 1 kHz read rougher than one alone;
  - the cast, as a census: every preset on `www/brand/sound.json`'s shortlist
    clears the floor, the list read from the file, not retyped.
- `crates/auracle-features/AGENTS.md`: a row for `floor.rs`, and the rule in
  one line: the floor reads beside φ and governs only the fill (ADR-026).

### 3. The epoch

- `RENDER_EPOCH` 3 → 4, with its row in `cache.rs`'s table: every row carries
  a `FloorReport`, and a row without one must not reach the fill. The list of
  what bumps the epoch, in the same comment, gains a reading the fill admits
  on.
- Beside `a_stored_row_is_keyed_by_its_namespace` (`auracle-wasm`), an
  assertion that the namespace names the epoch, so a row stored without a
  report is never a hit.
- No change to the app's stores. The render store (`auracle-renders`,
  `render-store.js`) and the faces' (`auracle-faces`, `worker.js`) are
  stamped with the namespace. Each browser's first boot after the bump clears
  them and renders cold, once, and PERFORM re-measures the wirings it kept,
  in the background.
- The bump alone owes `make perform-wirings` and `make preset-faces`:
  `shipped_wirings` and `shipped_faces` fail until both are regenerated
  (task 5).

### 4. The fill (`auracle-session`)

- `SessionConfig::sonic_floor`, on by default, so `make climb`,
  `make search-check` and the other harnesses fill as the app does.
- The admission in both folds: `fill_pool_step` (the serial fold, through
  `measure_draw`) and `absorb_prior` (the farm's results in index order, and
  `measured_here_if_stale` for a listener measured here). A draw below the
  floor is consumed and doesn't land, as a vet failure is.
- The verdict on `Candidate`.
- `farm.rs`'s docs say what the fill admits. `fill_draw` keeps a quarter more
  draws in flight than the pool still needs, plus one, sized for a pass rate
  of 98%: check it against task 1's rate.
- Nothing else is floored: walks, offers, edits, imports, restored sounds,
  presets and the warm start.
- Tests:
  - under the floor, only draws above it land, and one below it is consumed
    like a vet failure;
  - the serial and farm paths still build the same pool (the fold's existing
    tests, extended);
  - with the floor off, the pool is what it was;
  - a sound below the floor that the player adds (a preset, an import) still
    joins the pool.

### 5. What the shipped seed deals (`auracle-wasm` and the generated files)

- The verdict on each row the app reads, as a field of the rows it already
  sends (not a new binding), for hollow faces later.
- `tests/boot_probe.json` regenerated (`UPDATE_BOOT_PROBE=1`, `boot_agrees`),
  and `tests/web/boot_agrees.spec.js` run against the built wasm. A verdict
  compares a threshold with an FFT-derived value that native and wasm can
  read apart in the last digits. The probe's `kept` and `draws_consumed`
  catch a verdict that flips.
- `make perform-wirings` and `make preset-faces`, committed. Both files are
  generated, never edited by hand.
- `make wasm`, then the boot in the browser: the wall clock from `init` to
  `playable` and to `filled`, before and after, cold and with the store warm,
  on the test port. RFC-005 put the hand-over at 11.8 draws instead of 8.6.
  #301 holds the first sound to about a second on the reference machine
  ([ADR-025](../decisions/025-every-interaction-answers-at-once.md)), so a
  slower veil is reported there, with its numbers.
- Every seed now deals another pool, as after #62. #327's re-measure of
  `PERFORM_SEED` and `SEED` is made on the floored pool.

### 6. The revalidation

- `make revalidate` on both sides: `main` before, the branch after, with the
  tables diffed in this plan, as Plan-007 task 2 recorded its.
- `make climb` and `make search-check`, paired: both arms' pools read on one
  reference scale, as `learn_synthetic --compare` does, since the floored
  arm's standardizer differs.
- `make phi-stats` and `make norm-peak` draw the prior directly, so they must
  not move.
- This takes hours on a four-core machine. The render-cost note records
  `search-check` running 1.5 hours a side under load without finishing
  ([render-cost-2026-10](../notes/render-cost-2026-10/README.md)). Run it on a
  quiet machine, and give the load with the tables.

### 7. The words that describe the fill (in PR B)

Each lands with the code it describes:

- **The reference:**
  - a page beside the vet's, *The floor is not the vet* (under `audition/`,
    and in `SUMMARY.md`), with the constants by name and where they live, and
    task 1's measurement;
  - a line in `design/decisions.md`;
  - the patch loop's Fill step in `architecture/two-loops.md`, which says vet
    failures burn attempts (a draw below the floor burns one too);
  - `persistence.md`, which quotes `RENDER_EPOCH` as 3: it becomes 4, and the
    page's list of what bumps the epoch gains a reading the fill admits on.
- **The architecture:** `docs/architecture/system.md`'s pool step says what
  lands, and so does `web-runtime.md` wherever it says what a draw needs to
  land.
- **The changelog:** `changelog.d/sonic-floor.md`, since a player hears the
  change in a new session's first sounds. Its words come from
  `www/brand/voice.md`'s word table. A new word for the floor is drafted for
  the table first and waits for the maintainer; none is planned, since nothing
  on screen names the floor.
- **What stays:** the fill's card, "listening to 40 sounds: you start as soon
  as the first 8 land", which the guide quotes, stays true. The `truth-pass`
  skill finds any other sentence about what the fill deals.

### 8. The films cast by the floor (PR C, before #142)

- `www/video/tools/shotgen.py` (the cast's comment and `dump`'s rule),
  [`films.md`](../architecture/films.md)'s walkthrough shots and
  `www/video/README.md` say that a seeded session's prior draws in the pool,
  and a duel between two of them, are cast by the floor, and that the warm
  start's other cards stay logged, not cast.
  - How a shot tells a prior draw from a sound added to the pool (the warm
    start's picks, a preset opened) is this task's to settle: from the
    verdict each row carries (task 5), or from the pool's own record.
  - `tools/test_shotgen.py` holds every committed `shots.json` to the new
    rule, in `make dev-check`.
- `www/brand/sound.json`'s shortlist criteria point at the floor, for
  anything a film casts off the shortlist. RFC-007's two-note probe (noise
  share ≤ 0.02, roughness ≤ 6) has no code in the repository. Then
  `make sound`, which writes `www/video/tools/sound_defaults.py` and the
  scores (`make dev-check` fails while they are stale).
- The pages that say the films wait on the floor say they don't:
  [the view films' runbook](../runbooks/finish-the-view-films.md),
  [Plan-004](004-one-design-system.md) task 8 and
  [Plan-006](006-the-sound-of-the-films.md)'s casting.

## Constraints

From RFC-005 and the records it rests on:

- **Decision 6** (RFC-004, [ADR-011](../decisions/011-one-design-system.md)):
  the floor governs the first deals and the films' casting. It never touches
  evolution, offers, edits or imports, and it never reweights the prior.
- **The vet stays a pathology gate.** φ, loudness normalization and the vet's
  thresholds don't change.
- **The fill is a deterministic fold**
  ([ADR-001](../decisions/001-one-random-stream-per-consumer.md)). A draw's
  index is consumed whatever its outcome, the farm and the serial paths build
  the same pool, and a seed deals the same first bank whatever the browser
  has cached.
- **The app hands over at 8** (`PLAYABLE_AT`, `worker.js`). The pool is 40 and
  the draw budget 400.
- **No interaction waits on the floor**
  ([ADR-025](../decisions/025-every-interaction-answers-at-once.md)). Its cost
  is the fill's extra renders, measured at boot (task 5).
- **No new word for players** without the maintainer's approval
  ([ADR-013](../decisions/013-one-voice.md)).

## Done when

- Every featurization carries a `FloorReport`, and the fill admits only the
  prior draws that clear it, natively and in wasm, with the floor's tests and
  the cast census green.
- `RENDER_EPOCH` is 4, and `boot_probe.json`, `perform-wirings.json` and
  `preset-faces.json` are regenerated.
- The paired revalidation is in this plan, with `make phi-stats` and
  `make norm-peak` unchanged.
- The reference, `system.md`, `persistence.md` and the changelog describe the
  floored fill.
- The films cast a seeded session's prior draws by the floor, and
  `sound.json`'s shortlist points at it.
- #144 closes with PR C.
