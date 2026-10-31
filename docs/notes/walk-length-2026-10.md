# How long a refinement walk should be: two studies, closed, October 2026

Two measurement studies asked whether a longer walk (80 or 160 steps instead of
the shipped 40) still helps after a change to what the walk proposes:
[#355](https://github.com/alexnodeland/auracle/issues/355) after fugue-ppl
0.2.2 became 0.2.3, and
[#357](https://github.com/alexnodeland/auracle/issues/357) after oscillator
octaves were drawn with weights instead of uniformly. The maintainer closed
both on 2026-10-31 without a re-measurement. This note holds their tables, the
builds and seeds they ran on, the rows that were never finished, what has
changed in the walk since, and why they closed, so none of it lives only in the
issues. Dated, and not kept current: `search_health --hits` measures it again.

Every figure in the two tables below was measured on 2026-10-07 and is copied
from the two issues' bodies. The scratch binaries and TSVs that produced them
are gone, the issues name no commit, and no per-seed row was kept, so these
tables are the whole record. Each interval is the 95% interval the issue
printed; the issues do not say how it was computed.

## What was measured

Measurement 3 of `crates/auracle-session/examples/search_health.rs`
(`refine_hits`, `--hits N`): a pool of 48 is filled and taught by 60 synthetic
duels; then `Engine::refine_from` runs 8 times per seed from the pool's top
members with about a third of each member's knobs locked at random. A try
**beats its parent** when the child's posterior-mean utility is above the
parent's. The columns are `refine_steps` of 20, 40 (the default, `2·N_OPS`), 80
and 160, before the walk stretches its count for locked sites (up to
`LOCK_SCALE_CAP`, 4×; about 1.5× at a third locked). N seeds is the first N of
the harness's list, `0xE05 + i·0x101`. A rate over 16 seeds is a share of 128
tries, so two unpaired rates of about 70% differ by 11 percentage points at
roughly two standard errors; that is the "±11 pp" in #357.

## The first study (#355): fugue-ppl 0.2.2 to 0.2.3

fugue-ppl 0.2.3 (#143, #356) reflects a knob's Metropolis proposal into its
bounds, where 0.2.2 walked a positive knob in log space. Knob moves are
accepted more often (53% to 85% at the shipped budget) and are about 1.8×
larger. The builds were frozen and differed only in fugue-ppl, with seeds
paired. The closest pair on main is 2f97de3 (fugue-ppl 0.2.2) and 1cf1d6e
(#356, 0.2.3), which are consecutive commits; the issue does not say these were
the ones, so read them as a pointer.

| Measure | Seeds | 0.2.2 to 0.2.3 | Difference, 95% interval |
| --- | --- | --- | --- |
| Locked beat-parent, **40 steps (shipped)** | 48 | 66.7% to 70.3% | +0.036 [−0.037, +0.110] |
| Locked beat-parent, 80 steps | 16 | 75% to 71% | −0.039 [−0.115, +0.037] |
| Locked beat-parent, 160 steps | 8 paired; **the run was stopped** | not stated | −0.109 [−0.272, +0.053] |
| Pool climb at the shipped settings, mean gain | 16 | +2.000 to +1.852 | −0.148 [−0.836, +0.540]; the mean sat 0.05 to 0.17 lower at every generation |
| Eviction, fit against truth (Spearman) | not stated | 0.359 to 0.328 | −0.031 [−0.070, +0.008] |
| Offer census, shipped aim (1×3), moved at least the floor | not stated | 44.8% to 51.0% | +6.2 points [+1.4, +11.2]; Space up 12% to 54%, Bright up 17% to 50% |
| CPU, 400 fresh steps | 4 | +11% | paired wall time ran slower on 0.2.3 on every pair, under heavy load |

The shipped row passed the maintainer's rule (not worse beyond noise), so #143
shipped. The 80 and 160 rows lean negative inside the noise, and so does the
climb. The 0.2.2 climb's +2.000 is the figure `render-cost-2026-10` holds for
the climb on `c8541631` (16 seeds, ± 0.380, climbed on 14 of 16).

## The second study (#357): uniform to weighted octaves

#363 (`9c7cdf3`, for #62) draws an oscillator's octave from
`OCTAVE_WEIGHTS`, [.05, .15, .40, .25, .15] over −2 to +2, where it was
uniform. `search-check`'s measurement 3 was run on 16 seeds on both sides, on
frozen builds. The two sides deal different pools, because the octave draw
reads the random stream differently, so the comparison is **unpaired**.

**Both sides ran on fugue-ppl 0.2.2**, not 0.2.3. #357 was opened at 11:43 UTC
on 2026-10-07, before #356 (fugue-ppl 0.2.3) merged at 12:31, and the sides are
builds of #363's branch from before it was rebased onto main. Three things in
the record say so, and the issue names no commit or version:

- #363's description lists these rows (60.9 / 71.1 / 75.0% against 71.1 / 68.0
  / 71.9%, with the 16-seed climb) and only then says it was rebased onto
  `1cf1d6e` (fugue-ppl 0.2.3, #356). After the rebase it lists only
  `boot_probe.json` regenerated and `perform-wirings.json` measured again, and
  no `search-check`.
- The uniform side's 80-step row, 75.0%, is 96 of 128 tries, the same as
  #355's 0.2.2 arm (75%) and not its 0.2.3 arm (71%, 91 of 128). The harness is
  deterministic per build and seed (it seeds its generator from the seed, and
  quiver's on every render), so the same build and seeds read the same.
- The uniform side's 16-seed climb in #363's description, +2.000 ± 0.380 (14
  of 16), is #355's 0.2.2 climb (+2.000), and the figure `render-cost-2026-10`
  holds for `c8541631`. The weighted side's climb read +1.813 ± 0.244 (16 of
  16), a paired −0.187 ± 0.445.

So the comparison is uniform against weighted octaves on 0.2.2. It is not the
pair of commits on either side of #363 on main (`1cf1d6e` and `9c7cdf3`), which
both carry 0.2.3 and were not measured. Read the table below that way.

| Steps | Before (uniform) | After (weighted) | Difference, 95% interval |
| --- | --- | --- | --- |
| 20 | 60.9% | 71.1% | +10.2 pp [−1.4, +21.4] |
| **40 (shipped)** | **71.1%** | **68.0%** | **−3.1 pp [−14.2, +8.1]** |
| 80 | 75.0% | 71.9% | −3.1 pp [−13.8, +7.7] |
| 160 | 80.5% | **never finished** | none |

The shipped row passed under the same rule, so #363 shipped. Read across: the
before side climbs with walk length (61, 71, 75, 80%), and the after side is
flat (71, 68, 72% at 20, 40 and 80), so its rise from 20 to 80 steps is about
13 pp smaller. That is not significant, and most of it is a higher 20-step row
rather than a lower 80-step one. A six-seed sample read −25 pp at 160 steps on
the after side, but those six were the before side's best, so it says little.

**Fugue-ppl 0.2.3 with the weighted octaves, the walk main has had since
#363 merged, has no hit-rate reading at any walk length.** #355 measured 0.2.3
with octaves uniform, #357 measured weighted octaves on 0.2.2, and nothing
measured them together. That includes the 20-step row: "twenty steps is not
enough" read 60.9% against 71.1% at 20 and 40 steps with octaves uniform on
0.2.2, did not show with them weighted on 0.2.2 (71.1% against 68.0%, inside
the noise), and is unmeasured on 0.2.3 with them weighted.

The mechanism the issue proposed is a hypothesis that was not tested. fugue's
Metropolis step proposes `#oct` from its prior, and the walk's target is the
prior times `exp(β·fitness)`, so a longer walk would carry more of the prior's
octave tilt. The synthetic listener's `bass_fraction` weight (+1.0) pulls
against that tilt and its `centroid_mean` (+2.0) pulls with it.

## Rows never finished

- **#357's 160-step row on the weighted side.** It was never completed: about 7
  hours under load, before the renders got cheaper. No weighted-octave number
  exists for 160 steps.
- **#355's 160-step row.** Stopped at 8 paired seeds, so its interval
  (−0.109 [−0.272, +0.053]) is the widest here and the issue gives no rates.
- **A paired design for the octaves.** The same pools on both sides, for
  example the weighted prior for the pool with a uniform octave proposal in the
  walk, then the reverse, logging each trial's parent and child octave, never
  ran. It would resolve the effect below the ±11 pp the unpaired rows allow.
- **The render memo's hit rate per step on 0.2.2 and 0.2.3** (#355 asked for
  it, since a knob value inside the support is new every time and may explain
  the slower wall time) was never checked.
- **`--budget-ab` under 0.2.3.** The `(refine_steps, refine_seeds)` table in
  `SessionConfig::refine_steps`'s doc comment was measured under 0.2.2 and was
  not re-run.

## What has changed since, and what was not re-measured

Nothing below was followed by a re-measurement of these rows.

| Date | Change | What it does to a walk |
| --- | --- | --- |
| 2026-10-07, 12:31 UTC | #356 (`1cf1d6e`): fugue-ppl 0.2.3 | A knob's proposal reflects into its bounds: moves accepted more often and about 1.8× larger. What #355 measured. #357's rows were taken before it reached #363's branch |
| 2026-10-07, 14:10 UTC | #363 (`9c7cdf3`): weighted octaves | The "after" side of #357, on 0.2.2. It merged on top of #356, so main's walk has had both since this commit |
| 2026-10-08 | #389 (`9c0557e`): fugue-evo 0.3.1 to 0.4.0, and a walk runs its model once per step (`step_scored`) | Cheaper per step; its message says it draws the same randomness, so a seeded walk is the same |
| 2026-10-08, 10-09 | #391, #399 | The taste fit's cost, not the walk |
| 2026-10-09 | #393 (`9c81dca`): quiver-dsp 0.4.1 | A render about 39% cheaper in wasm; φ moves by at most 1.34e-11 of a spread |
| 2026-10-09 | #406 (`93e2e32`): quiver-dsp 0.5.1's block walk | The same samples bit for bit |

`refine_steps` is still `2·N_OPS` (40), `LOCK_SCALE_CAP` is still 4.0 and
`OCTAVE_WEIGHTS` is still [.05, .15, .40, .25, .15]. #389, #393 and #406 were
not meant to alter what a seeded walk draws or hears, so the figures are
expected to hold within the noise. That is an expectation, and no hit rate has
checked it. The search is chaotic: #393 moved φ by at most 1.34e-11 of a
spread and still sent one climb seed to a different end (a final gain 0.02
apart, in `render-cost-2026-10`). In the hit rate one flipped try moves a
16-seed rate by 0.78 points (1 in 128), so today's 68.0% could read 67.2% or
68.8% with nothing wrong. A re-run that differs from the figures by a try or
two is the noise, not a regression.

The climbs since: #393's revalidate ran 8-seed climbs on both sides of its
change, which `render-cost-2026-10` records only as a difference of at most
0.006 in generations 4 to 6. The repository keeps one climb of main's
combination, the 8-seed run of 2026-10-09 on `9c81dca` (fugue-ppl 0.2.3,
fugue-evo 0.4.0, weighted octaves, quiver-dsp 0.4.1, before #406): mean gain
**+2.218 ± 0.416** (se), climbed on 8 of 8
(`render-cost-2026-10/blocks/climb-before.txt`). Its seeds are the harness's
first eight, it is a climb and not a hit rate, and it is not paired with any
row above.

## Why they closed

The maintainer's decision, 2026-10-31:

- The shipped 40-step walk passed under each change, measured one at a time:
  not worse beyond noise (+0.036 [−0.037, +0.110] for fugue-ppl 0.2.3 with
  octaves uniform, −3.1 pp [−14.2, +8.1] for the weighted octaves on 0.2.2).
  The two together were not measured.
- Longer walks (80 and 160 steps) are not shipped. The default `refine_steps`
  stays 40. (A locked walk's own stretch for locked sites, up to 4×, is an
  older mechanism and not what these studies asked about.)

That leaves the 80 and 160 rows, which lean negative inside the noise, with
nothing in the app to decide.

Nothing was re-measured. The baselines the studies were meant to refresh are
refreshed from the figures above, with their dates:
`SessionConfig::refine_steps` in `crates/auracle-session/src/engine.rs` and the
header of `crates/auracle-session/examples/search_health.rs`.

## If it is reopened

- Measure main's walk first: `search_health --hits 16` on main at 20, 40 and
  80 steps, the reading that does not exist. The octave comparison on 0.2.3
  then needs the other side, main with the ten octave call sites reverted (the
  way #363 built its base), run with the same seed list, and the per-seed rows
  kept.
- Finish the weighted side's 160-step row on the same build (about the size of
  a climb), and keep the TSVs.
- The 0.2.2 arm of #355 cannot be built from main: fugue-evo 0.4.0 requires
  fugue-ppl `^0.2.3`. It needs a frozen build from before #389 (`2f97de3` is
  fugue-ppl 0.2.2 on fugue-evo 0.3.1), run with the same seed list.
- If a longer walk is worse and the paired result is clear, the levers the
  issues named: a per-site initial scale (upstream in fugue-evo, whose
  `EvolutionChain` keeps `adaptation` private, so a release the maintainer
  would have to approve); a narrower first knob step in Auracle; a walk that
  proposes octaves from a flatter kernel than the prior (a hook fugue-evo may
  not expose); or the maintainer revisiting the weighted prior. A change to the
  walk's kernel changes offers and walks and not φ, so it owes `make
  search-check` before and after and not `perform-wirings`, and it moves
  PERFORM's first offers.
