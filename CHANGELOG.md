# Changelog

All notable changes to Auracle are documented here, grouped by development
pass. The format is based on [Keep a Changelog](https://keepachangelog.com/);
the project is pre-1.0. Entries below 0.1.0 were written when the project was
called Ricercar (and, earlier, EvoSynth) and name it as it was then — a
changelog that edits its own past is not a record.

## [Unreleased]

### Fixed — an imputed coordinate no longer arrives as a measurement

`FitSet::build` imputes an absent coordinate at the standardizer's mean, which
standardizes to exactly 0 — the honest imputation for "this observation says
nothing about that axis". For a **duel** that is the end of it: both candidates
carry the same absence, the term cancels in `u_a − u_b`, and the observation is
correctly silent about that axis.

For **keep/kill** and **stars** there is no second candidate to cancel against.
`u(x)` is compared to a threshold, and a coordinate imputed at zero contributes
exactly zero to that sum — so the model read a patch that might be extreme on
the missing axis as though it were average on it, and then took the resulting
verdict at full confidence. The information was missing; the certainty was not.

The likelihood now marginalizes the missing contribution instead of assuming it
away: an imputed coordinate's `θ_i · x_i` has variance `θ_i²` under the
standardizer's own unit-normal prior, and the comparison is attenuated by
`1/√(1 + πσ²/8)` — the logistic analogue of integrating a probit link. The model
still learns from the observation; it stops claiming certainty about the part
that was guesswork. An imputed axis the listener does not care about is free,
because its `θ` is zero.

Low severity while duels dominate, and it spikes exactly when it matters most:
immediately after a stimulus-tag bump, when every audio coordinate of the old
log is imputed at once — which is when the migration machinery is supposed to be
protecting the profile.

**No revalidation is owed and the reason is worth stating.** `FitSet::as_is`
imputes nothing, and `FitSet::build` marks a coordinate absent only when a log's
recorded feature names do not cover it — which cannot happen for a log written
under the current names. Every synthetic measurement in the harness therefore
runs with an empty absent set, and the change is provably inert for them. It
activates on migrated real logs, which is what it is for.

### Added — the brightness cluster's fused prior, implemented and switched off

`rolloff_mean`, `zcr_mean` and `centroid_mean` are three genuine measurements of
one perceptual thing, and `rolloff_mean` is the worst-conditioned coordinate in
φ. The open question asked for a shared or fused prior over the cluster rather
than dropping a column. It is now built — a latent mean per style, members drawn
about it — and it ships at `ρ = 0`, which is off.

**Two gates were run and they disagreed. That is the finding.**

Against the always-on closed-loop gate, which scores θ *recovery*, fusing helps:

| ρ | mean posterior/truth r |
|---|---|
| 0.00 | 0.657 — the flat prior, reproduced exactly |
| **0.25** | **0.702** |
| 0.50 | 0.644 |
| 0.75 | fails the per-seed floor |

Against the **climb** at ρ = 0.25 — 48 paired seeds, the gate that asks what the
pool is actually worth to the listener — it hurts, and not marginally:

| statistic | value |
|---|---|
| 10% trimmed | **−0.579 ± 0.188 (−3.09 se)** |
| median | −0.726 |
| sign test | 16 better / 32 worse, **p = 0.029** |
| climbed | 41/48 → 38/48 |

Both are true because they measure different things. Pooling an ill-conditioned
ridge is a real regularizer for *estimating* θ. It is a *bias* for the search
that consumes θ: the synthetic listener puts 2.0 on `centroid_mean` and exactly
0 on the other two, so shrinking them together drags the one coefficient that
matters toward two that do not, and the search aims worse.

**The general warning is worth more than the feature.** A VIF says the three
coordinates move together *across patches* — a fact about φ. Fusing their
coefficients asserts that a listener's *preferences* about them move together —
a fact about people, which does not follow from the first and had not been
measured. The issue's framing invited that conflation, and the climb caught it.

Kept re-checkable rather than deleted, as `RefineKeep::Best` and
`Acquisition::Thompson` are. At `ρ = 0` it emits no latent sites at all, so the
program is the flat one node for node and the fit stays at 206 sites.

Also: the premise had already moved. The VIFs motivating this were 18.4/10.4/5.9;
after the ZCR DC removal they measure **16.9/9.7/5.9** and `zcr_mean` is no
longer flagged at all — a third of the original argument was a coordinate bug.

### Added — `Silence`, so an empty socket is empty in the term too

An "empty" socket made sound. The rack drew a dashed EMPTY plate and the
substitute node underneath it was a `Vco`, so the plate was honest and the patch
was not: the model was taught on a tree containing a source the player believed
was silent, and every φ coordinate measured a render with it in.

**Its prior weight is small but not zero, and that is the whole design.** At zero
the grammar gives `p = 0` to any tree containing a hole, `log p` is −∞, and MH
rejects every proposal that touches one — so unplugging a socket would quietly
make a patch un-evolvable. At 0.5% a `Silence`-only tree renders silent, the vet
gate quarantines it, and evolution learns to avoid holes rather than being
forbidden from representing one. Both halves are tests.

It is appended at source index 6 rather than inserted, because a source kind's
*index* is the persisted wire format; the round-trip test asserts the literal 6,
since a test that asked the encoder what it wrote would agree with any
renumbering. It compiles to a `Vca` with an unpatched audio input — `Offset`'s
ports are `CvBipolar`, and feeding one to an audio consumer would raise a
signal-kind warning on every patch holding a hole.

**`n_silence` joins the source/binary identity as its own φ column, and the VIF
sweep confirms it.** The worry was that a 0.5% column is a near-indicator
variable — the objection that kept `n_ringmod` out. Measured over 1200 draws it
comes back at **VIF 1.1**, the best-conditioned coordinate in φ, with no exact
dependency introduced and the worst VIF in the whole vector *falling* 16.9 →
16.1. A hole's prevalence is set by the player's edits rather than by the prior,
which is what makes it unlike the other rare kinds.

For the same reason it is deliberately **not tilted by taste** in `biased_prior`:
the tilt moves proposals toward source kinds a listener is enjoying, and a hole
is not a timbre anyone can enjoy.

Paired 48-seed climb against `main`: mean **+0.041 ± 0.377**, median −0.108, 10%
trimmed **−0.083 ± 0.207**, sign test 22 better / 26 worse (p = 0.665). No
detectable effect on search health, which is what an expressiveness change that
the synthetic listener has no opinion about should show. Seeds that climbed went
41/48 → 45/48 and the worst seed went −10.30 → −2.48, but McNemar puts that at
p = 0.344 — suggestive, not established.

### Changed — the RefineKeep A/B was run, and it tied

A refinement walk renders ~40 candidates and injects one. Which one was never
measured — the shipped rule is "the state the walk ended on", and
`RefineKeep::Best` (the highest-`log π_β` state the walk occupied, seed
included) has been implemented, free and switched off, waiting for the
instrument that would settle it.

Sixteen paired seeds, same list both arms:

| | `Last` | `Best` |
|---|---|---|
| mean gain | +1.927 ± 0.452 | +1.774 ± 0.302 |
| median gain | +2.058 | +1.819 |
| 10% trimmed | +1.840 ± 0.383 | **+1.925 ± 0.190** |
| climbed on | 14/16 | 15/16 |

Paired difference: mean **−0.153 ± 0.384**, median −0.185, trimmed
−0.113 ± 0.318, sign test **8 better / 8 worse (p = 1.000)**. As exact a tie as
sixteen seeds can produce. Nothing clears zero at 2 se, so **the default stays
`Last`** and the result is written into the `RefineKeep` doc comment — a rule
rejected on evidence stays re-checkable, the way `Acquisition::Thompson` is kept
after losing.

Neither the feared failure nor the hoped-for win appeared. The worry was that
argmax over a surrogate would find the surrogate's errors and deepen the
catastrophic tail; across the pair the tails are a wash. What did show is that
**`Best` is the lower-variance rule rather than the better one** — half the
trimmed standard error. Injecting the walk's argmax is more *consistent* than
injecting where it stopped; it simply does not aim anywhere better on average.
That is the argument to re-run this on if the surrogate ever gets sharper.

### Fixed — two φ coordinates that were measuring the wrong thing

**ZCR counted crossings of zero, not of the signal's own centre.** A constant
offset suppresses them, so a patch riding +0.3 with a ±0.2 oscillation crosses
zero *never* and read as maximally dark — the floor of the axis, for a tone that
is plainly not dark. The vet gate admits `|mean|/rms` up to 0.6, so that is a
reachable render rather than a hypothetical, and `zcr_mean` feeds a linear model
as if it were a brightness measurement. Subtracting the mean is the whole fix;
for a render with no offset the count is unchanged.

**Spectral flux stepped across a silent gap** as though the frames either side
were adjacent, because `prev_mag` only tracked frames that passed the power
floor. Flux is the change between *adjacent* frames, so carrying it across a
rest reports a difference that did not happen in one hop. The standard phrase
has four rests, so every re-entry scored a spurious burst of movement — the
opposite of what a rest is.

Both are pinned by fixtures that fail without them: an offset tone that must
read as bright as the centred tone it is a copy of, and a burst-rest-burst
phrase whose flux must not notice that the second burst is ten times quieter.

**What the revalidation said, and what it said about itself.** Renders are
untouched (`norm-peak` is identical), and collinearity *improved*: over 1200
draws `rolloff_mean` fell 17.7 → 16.9 and `zcr_mean` 10.3 → **9.7**, dropping
off the collinear list it had been on. That matters beyond this change — the
open question about the brightness cluster is a VIF argument, and one of its
three numbers just moved for a reason unrelated to modelling.

The climb is where this got interesting. At 16 seeds the paired difference read
−0.530 ± 0.391; at 48 seeds it read **+0.749 ± 0.857** — the opposite sign, both
inside the noise. Neither is a fact about the search. Three seeds of 48 carry
**95% of the variance**: pool utility collapses catastrophically on a small
fraction of seeds, worth tens of utility against a typical gain of two, so the
mean is not a statistic about search health but about whether a seed list
happened to contain a collapse.

Read robustly, the answer is clean and tight:

| | 16 seeds | 48 seeds |
|---|---|---|
| paired mean | −0.530 ± 0.391 | +0.749 ± 0.857 |
| median | | **−0.095** |
| 10% trimmed mean | | **−0.099 ± 0.191** |
| sign test | | 20 better / 28 worse, p = 0.31 |

A correctness fix to two coordinates the synthetic user has **zero weight on**
should not move the search, and measured properly it does not: −0.10 ± 0.19,
four times tighter than the raw mean and indistinguishable from zero.

`make climb` now prints the median and the 10% trimmed mean beside the mean, so
the next φ change is read on a statistic that can resolve it. The mean stays —
the collapses are real, and hiding them would be worse than reporting a number
that a collapse can swing.

### Changed — the rack's flow animation measures the level it draws

The cables' motion was scaled by an estimate: *reach*, meaning how much of what
is on this cable arrives at the amp, computed from the patch with every source
assumed to be at unity. Two comments explained why it could not be a
measurement — "the analyser hangs off the master and there is no per-node port
to attach to" — and both were out of date. quiver's `StateObserver` takes
`Level`, `Scope` and `Spectrum` subscriptions on any node port, and has for
some time; it is in the `quiver-dsp` release the lockfile already pins.

The reach half was right and stays. It is what makes a whole limb go still
together when a mixer branch is crossfaded away, instead of leaving four cables
running at full speed into a stopped one. What it could not see was the other
half — a filter choking its input, an envelope closed, an oscillator that is
simply quiet — because it had no way to ask. Now it asks: the compiler records
where each term node's audio leaves it (`CompiledVoice::taps`), `LivePoly`
holds a `Level` subscription on each, and while notes sound the measured RMS is
multiplied into the reach factor.

Two questions the register said were open have answers:

- **Which voice to meter.** The most recently pressed sounding one, re-chosen
  every quantum. A sum across the bank averages different notes at different
  envelope phases, which is not the level on any wire.
- **Whether `sync_output_keepalive` is needed.** It is not. That call pins
  ports nothing consumes, and it dirties the patch — a recompile that would
  have had to be staged around the audio thread the way patch swaps are. The
  genome is a typed tree, so every module's output already feeds exactly one
  parent and quiver is already computing every value metered here.

Metering is off until a surface asks and allocation-free while off, which is
the state every player is in. The port trace stays an offline render, now by
choice rather than by constraint: a `Scope` subscription reads whatever is
being held, which while someone is reading a teaching surface is usually
nothing, and "what does a wavefolder do to a saw" wants the same phrase every
time so that two looks at it are comparable.

### Changed — CI stops making every PR pay for the parts it cannot affect

A PR took ~11m30s, and 11m12s of that was the one `Test` job. Measured rather
than guessed, and then measured again in CI afterwards:

| | before | after |
|---|---|---|
| test compile, warm cache | 2m21s | **1m12s** |
| a Rust PR, end to end | 11m30s | **~8m** |
| a site or brand PR | 11m30s | **~2m** — only `Site` runs |
| a README or changelog PR | 11m30s | **16s** — nothing to build |
| three pushes to one PR | three full runs | the first two cancelled |

The honest headline is the docs PR and the cancellation, not the Rust PR. After
the compile is halved and the suite is unblocked, **~365s of the remaining ~8m is
one test**, `refinement_improves_pool`, and that floor is not movable from here —
see the note at the end.

**A test profile that is not the release profile.** `[profile.release]` sets
`lto = "fat"` and `codegen-units = 1` to shave the render loop of the artifact
users wait on. Applied to five test binaries it instead funnels every link
through one core. Timing the three heaviest tests under both profiles, runtime
differed by under a tenth of a second — the LTO was buying the suite *nothing*
and costing it a serialized link. `[profile.test-fast]` keeps release's
`opt-level` (the DSP genuinely needs it; debug is ~20× slower) and drops the
shipping flags. `make test` uses it too, so the contributor loop gets it as well.

**The slowest test gets a runner to itself.** `refinement_improves_pool` walks 16
seeds on one thread each; on a 4-core runner those queue four deep. It is ~550s
of CPU against ~270s for the other 170 tests *combined*, so in one job it did not
merely take its own time — every other test waited behind it for the cores. Two
nextest shards on exact complementary filters now split it off, so the job takes
as long as the floor takes rather than the floor plus the suite. The filters
being complements is what keeps it honest: no test can land in both shards or in
neither, and `--no-tests=fail` makes a rename that empties a shard go red instead
of silently dropping a gate.

**Jobs gated on what the change reaches.** Most PRs here are documentation, brand
and site copy — the same observation `search-health.yml` already makes about
where a PR budget goes. The Rust jobs now require Rust to have changed, and the
Makefile and workflows count as touching everything. Narrowing applies to
`pull_request` only: `main` is what the site deploys from and what releases are
cut from, so it is never partially verified.

Also: `concurrency` with `cancel-in-progress`, so a new push stops the run its
own commit obsoleted instead of paying for two answers; `fmt` folded into `lint`,
having spent more on scheduling than on work; `rust-cache` saves restricted to
`main`, so PR branches stop evicting the warm cache every other job restores
from; `wasm-pack` from the tool cache rather than curl-piping an installer; and
job timeouts, because the 6-hour default is a lot of rope for a hung run.

One new check, `CI`, reports the aggregate. It is the one to require in a branch
ruleset — the jobs above are conditional, and requiring a job that legitimately
skips would wedge every documentation PR.

**What is left, and why it stays.** `refinement_improves_pool` is now ~81% of a
Rust PR's wall clock: 365s of the ~8m. Its 16 seeds are independent and it is the
obvious thing to split across runners — and it must not be. The gate is the
**median** of the 16 per-seed gains, chosen over the mean because two seeds in
that spread are catastrophic outliers; the test's own doc comment records that a
four-seed gate "would have been a coin flip that failed for reasons having
nothing to do with the change under review." A median cannot be assembled from
independent shards, and a per-shard gate is exactly the coin flip that reasoning
rejected. The seeds stay together.

That leaves core count as the only remaining lever, and it is a billing decision
rather than a code one. The test's doc comment records ~70s wall for the 16 seeds
— that is a 16-core machine, where they run one-per-core; a 4-core runner queues
them four deep and takes 365s. A larger runner would put a Rust PR near ~2m30s at
roughly neutral cost, since four times the rate over a quarter of the minutes is
a wash. It is not enabled here: larger runners are billed even for public repos,
so it is the repo owner's call rather than a default.

### Added — a cross-island measurement, which closed an open question by refuting it

The reference listed as an open question: *"local refinement from island A will
not find island B. A tempering schedule would cross the valley; today the user
reaches the second island by hand or by the prior."* It had never been measured,
which is why it was written down — the taste model is a max of K linear experts
precisely so one user can hold several islands, and the search is a local walk,
so the tension looked real.

`make islands` teaches a genuinely bimodal synthetic user (two islands opposed
on every coordinate they share), runs real generations, and asks how often a
child lands on the island its parent was not on:

| | |
|---|---|
| refinement events that cross islands | **99 / 473 (20.9%)** |
| of those, *decisive* — both ends > 1.0 onto their island | 64 (**13.5%** of all events) |
| seeds whose pool ended on one island only | **0 / 8** |

The decisive column is the one that carries the claim. A patch on the decision
boundary flips island under an arbitrarily small change, and counting that as
crossing a valley measures nothing; filtering it out leaves the answer standing.
Pool share is reported beside it as a control, since both islands being occupied
would say only that the prior scattered candidates over both.

**The reasoning was wrong about the geometry.** It treated refinement as a local
walk in *feature* space. It is a reversible-jump walk over a **tree grammar**,
where one accepted structural move swaps a subtree — a large jump in φ. The
search never has to travel through the space between the islands, so there is no
valley for a tempering schedule to cross. Tempered SMC may still earn its place
on the distributional claim; it no longer earns it on this one.

Also adds **`--keep-best`**, which re-runs the whole harness under
`RefineKeep::Best` so the two arms can be paired seed-for-seed. That A/B is
tracked in #42 rather than run here.

### Fixed — the small batch from the gap sweep

Four items that cost nothing to verify, kept apart from two that do.

- **`FftPlanner` was rebuilt on every render.** Planning is where rustfft
  computes the twiddle factors for the frame size, and a fresh planner per call
  redid it for every candidate the search featurizes — thousands per generation,
  for a table that depends only on a compile-time constant. Now `thread_local!`.
  Bit-identical by construction, and **verified**: the feature table over 40
  prior draws is byte-identical to `main`.
- **`TastePosterior::aligned` used an unweighted reference mean** in its second
  pass, while every other summary on the type respects the importance weights.
  Draws stop being equally probable the moment `reweighted` folds a vote in, so
  the label alignment was leaning on draws the evidence had already discounted —
  hardest exactly when the weights have concentrated, which is when the
  per-style summaries are most worth reading.
- **The locked-refinement step compensation had a silent ceiling.** It is
  `LOCK_SCALE_CAP` now, and the fact that a very heavily locked walk explores
  less than the config nominally buys is written down rather than left to be
  discovered. It is a cost bound, not a correction: `⚡ evolve from this` is a
  button press with a person waiting behind it.
- **A module doc claimed φ_audio was 12 dimensions.** It is 15. It now names
  `AudioFeatures::NAMES` rather than repeating a count, so it cannot go stale
  again.

**Two related items are deliberately not here.** ZCR has no DC removal (the vet
gate admits `|mean|/rms` up to 0.6, so a DC-offset patch reads as very dark) and
spectral flux steps across a silent gap as though the frames were adjacent. Both
are a few lines — and both move φ, so they owe a paired revalidation and will
ride the next wave that is already paying for one, alongside `Silence`.

### Fixed — the taste map could mirror itself between recomputes

A PCA axis is defined only up to sign, and nothing fixed it. Power iteration
returns whichever orientation has a positive inner product with its start
vector, so the orientation was a fact about the *solver* rather than about the
data — and the start is the highest-variance coordinate, which moves as the pool
does. The map is sold as *where you have travelled*; territory that mirrors
left-for-right between one refit and the next is a different claim about the
same place, and it flipped rarely enough to read as bad data rather than as a
property of the projection.

Axes now carry the standard `svd_flip` convention: largest-magnitude component
positive. The regression test builds data where the unfixed solver returns the
second axis at `-0.90` and asserts the sign is pinned.

**The second axis is where this bites**, which is worth recording because the
first one hides it: axis 1 starts from the highest-variance coordinate, which is
usually also where the leading eigenvector puts its mass, so its natural
orientation satisfies the convention by accident. The deflated axis starts from
that same vector with axis 1 projected *out*, and what remains has no such
relationship to the second eigenvector.

Separately, the iteration **stops when it has converged and reports when it has
not**, rather than running exactly 60 passes and returning whatever it held.
Power iteration converges as `(λ₂/λ₁)^k`, and near-ties in the top eigenvalues
are a designed-in property of this feature set — the brightness cluster is three
genuine measurements of one perceptual thing — so a fixed count was an assertion
about a ratio nobody had measured. `TasteMap::converged` carries the answer.

### Fixed — the audition clipped, and preference data was collected on it

Matching integrated loudness says nothing about the peak, and crest factor spans
tens of dB across this grammar. `normalize_to` capped *boost* and nothing else,
so normalizing a percussive patch to −18 LUFS sent it well over full scale.
Measured over 150 vetted prior draws (`make norm-peak`): **15% of renders peaked
above 1.0 and 8% above 1.25** — which is where the app's `master.gain = 0.8`
clips — with a worst case of **4.06**, 12 dB over. After: **nothing over the
ceiling**, p50 unmoved at 0.623, and the 22 patches that gave up gain are
exactly the 22 that had been over full scale (mean 3.0 dB, worst 12.2 dB). The
unmoved median is the check that this is a fault stop and not a re-levelling of
the whole pool.

The live voice was never exposed to this; `live.rs`'s master limiter has always
held a 0.98 ceiling. The offline path took the volt divisor and not the limiter,
and it is the offline path the duels are dealt from — so a clipped audition
collected a vote about *clipping* rather than about the patch, which is exactly
the confound loudness normalization exists to remove, one stage later and
silent.

The fix is **a smaller gain, not a limiter**. `normalize_to` now gives up
whatever makeup it must for the peak to clear `PEAK_CEILING`, and reports how
much as `Features::peak_reduction_db` so a surface can say a patch was pulled
down 3 dB rather than presenting it as merely quiet. A scalar keeps
`render_playback` bit-identical *by construction* — the property its
bit-identity test exists to protect — and cannot change timbre at all, where a
limiter would reshape the waveform and need a second copy of itself in the
replay path forever. What it costs is stated rather than hidden: the ~15% that
hit the ceiling audition below target, so loudness matching degrades exactly
where crest is highest. Quieter is a smaller bias on a preference judgment than
clipped.

**This moves φ, so it carries the revalidation.** `rms_mean` and `rms_std` are
the only audio coordinates that are not scale-invariant; everything else is a
ratio or a spectral shape and cannot see a gain change. Paired 16-seed
`make climb`, same seeds both sides:

| | mean gain | climbed | gen-6 Δ | max u |
|---|---|---|---|---|
| before | +1.877 ± 0.362 | 15/16 | **−0.073** | 6.730 |
| after | +2.457 ± 0.298 | **16/16** | +0.113 | 8.093 |

Paired difference **+0.579 ± 0.350 (1 se), t = 1.65, 95% CI [−0.121, +1.280]**,
improving on 11 of 16 seeds. **That crosses zero: the headline gain is not
significant** and is not claimed as one. What the run does establish is the
thing the standing rule exists to check — the change does not cost the search
anything — and three secondary readings point the same way: every seed now
climbs (the one that previously went backwards, `1209` at −1.036, now returns
+0.908), the frontier is higher, and the generation curve **stopped turning
over** (mean utility used to peak at generation 5 and *fall* at 6; it is still
rising at 6).

The grading function itself did not move, which is what makes this comparison
unusually clean: the synthetic user weights only scale-invariant coordinates,
so generation 0 is bit-identical across the two runs (mean −0.000, max 5.454).
Whatever moved, moved through the *model* — and the plausible mechanism, stated
as a hypothesis rather than a finding, is that `rms_mean` was near-degenerate
at a fixed loudness target (every patch normalized to the same level), so
standardizing divided by a tiny σ and handed the model an amplified-noise
coordinate. Peak-capping gives it real spread. That is the dead-coordinate
failure from the `1e30` sentinel, in the opposite direction, and it is
checkable with `make phi-stats` on both sides.

### Added — the search-health harness is a command, not a memory

`make check` gates correctness and says nothing about whether the search still
searches. That has always been a standing rule enforced by discipline; it is now
`make revalidate` (φ statistics, normalized peaks, pool climb, the full
battery), plus `make climb`, `search-check`, `budget-ab`, `phi-stats`,
`norm-peak`, `fit-bench` and `closed-loop` individually. A `Search health`
workflow runs the same targets nightly and on `workflow_dispatch`, writing every
table to the job summary and uploading the logs so two runs can be diffed
directly. Deliberately **not** on `pull_request`: it is tens of minutes of real
audio rendering, and most PRs here are documentation.

### Fixed — the refinement gate did not gate refinement

`refinement_improves_pool` made three assertions and none could fail for the
right reason. `best_after >= best_before` is true **by construction** — eviction
only removes the pool's worst member, so the top of the ranking cannot fall. It
graded children with `ranked()`, the *surrogate refinement is optimizing*, so a
search that had learned to fool its own fitness would have scored perfectly. And
`n_refined` was printed, never asserted, so a build that injected nothing passed
silently.

It now grades on the synthetic user's **true** utility, before and after real
generations — a small always-on version of `search_health --climb` — over
sixteen concurrent seeds (~70 s).

**The gate statistic is the median, and that was measured rather than assumed.**
The mean was the obvious choice and the data rejected it: the per-seed gains are
thirteen clear improvements plus two catastrophic seeds (−12.04, −5.55), which
drag the mean to +0.215 while the median sits at +1.481. Over *any four* of
those seeds the mean ranges −4.51 to +2.49 and is **negative 40% of the time**,
so the four-seed mean gate this test was first written with would have been a
coin flip failing for reasons unrelated to the change under review. Gates:
median > 0.5, at least 10 of 16 seeds improving, and no seed's best member
degrading.

The two bad seeds are worth naming rather than smoothing away: they are the
surrogate optimized against itself. `insert_candidate` admits and evicts by the
*model*, so a posterior fitted on 40 duels at the suite's trimmed MCMC budget
can swap out nine candidates the synthetic user liked for nine it does not. That
is not a defect in the machinery — and it is why `RefineKeep::Best` ships
switched off, since taking the argmax of that same surrogate is the move most
likely to make it worse.

Widening the horizon to three generations also exposed a **false assertion the
old test had been carrying**: it required every lineage child to still be
findable in the pool, which only holds while nothing has had a chance to be
evicted. Across generations a child injected in generation 1 is an ordinary
eviction candidate in generation 2, so that assertion fails on a *correct*
engine. The invariant that survives is the other direction — the permanent
lineage explains every refined member the fixed-size pool still holds — and that
is what is asserted now.

### Fixed — an identity test conflated "the property held" with "it was tested"

`refinement_carries_node_identity` asserted `carried > 0` — that every accepted
refinement shares at least one module with its seed — under the message *"a
refinement step that changed everything is not a refinement"*. That is a claim
about the **search**, not about identity, and it is not a true one: forty MH
steps over a small term can replace the root's kind, after which no key/kind
pair matches and there is nothing to carry. No uid is lost in that case, because
none is comparable.

The φ shift above moved one seed's trajectory into exactly that case and the
test went red with nothing wrong. A round that preserves no structure now
**skips** rather than fails, the strict identity assertion on matched modules is
untouched, and the final check still requires that at least one round actually
exercised the property. Same class of error as the lineage assertion above,
found the same way — by widening what the tests look at.

### Added — refinement can keep the walk's best state instead of its last

A refinement walk renders ~40 candidates and injects **one**, and which one was
never measured. `SessionConfig::refine_keep` makes it selectable:
`RefineKeep::Last` (the shipped behaviour, still the default) or
`RefineKeep::Best`, the highest-`log π_β` state the walk occupied — seed
included, so a walk that found nothing better than where it started now injects
nothing rather than whatever it was standing on at step 40.

The archive is **free**: every trace the kernel returns already carries its own
`log π_β`, so this is one `f64` compare per step and no extra render. Scored on
the target rather than on fitness alone — taking the argmax of `E[u]` would
discard the parsimony half of the distribution the walk is sampling, and would
do it with a bias toward the largest tree the walk touched. The default does not
move until the A/B says it should.

### Added — a persistent render cache

φ is a pure function of `(term, spec)`, and nothing was exploiting that across
reloads: every boot re-rendered the whole bank from nothing. The farm workers
now consult an IndexedDB store first and write back on a miss, so a returning
player pays for renders once.

`RENDER_EPOCH` is the coordinate the content key could not supply — the key
hashes the *inputs*, and a change to the normalizer or a descriptor's formula is
a change to the *function*. `cache_namespace` combines the two, and a namespace
mismatch orphans every row at once, which is the only correct granularity: a
cache whose invalidation is anything less than total will one day serve a number
from a featurizer that no longer exists. (This release bumps it to 1, because
the peak-capped normalization above moves `gain_db`.) The engine also re-derives
each row's key from the tree it holds before folding it in, so a hit is checked
rather than trusted.

Cached rows carry φ without samples, so jobs that asked for audio still render —
otherwise the saving would land on the first patches the player actually
auditions, which is where `wantAudio` exists to avoid it.

### Changed — the taste fit no longer holds the whole chain in memory

`adaptive_mcmc_chain` materialized every step and `step_by(stride)` kept every
20th one line later: ~10 000 `Trace` clones of 206 `BTreeMap` entries live at
once to retain 500. Measured at the shipped budget, **303.1 MB peak RSS**,
scaling with `mcmc_samples` — a plausible mobile-Safari OOM rather than mere
waste.

It could not be fixed here (the retention is inside fugue's chain driver, whose
internals are private), so it was fixed upstream and adopted:
`adaptive_mcmc_chain_thinned` takes the stride and pushes only every `thin`-th
draw. **18.2 MB peak RSS for bit-identical draws** — 16.7×, with `fit_bench`'s
per-fit checksum unchanged at `07d204764b58c88b`. `thin` gates the push and
nothing else, so every transition still runs and the RNG is consumed identically.
The peak no longer scales with the budget at all, which frees `mcmc_samples` to
be chosen on the recovery tables rather than against a memory ceiling.

Workspace dependency moves to fugue-ppl 0.2.2, which is where that API landed
(alexnodeland/fugue#47).

### Fixed — the site-count formula had not moved with φ

`27·K + n_sessions + 5` (33 at K=1, 141 at K=5) appeared in three places. φ is
40 coordinates now, not 27, so it is `d·K + n_sessions + 5` — **46 and 206**,
which `fit_bench` prints. The figure it feeds moved with it: 10 000 steps at
K = 5 is ~49 sweeps per site, not ~71.

### Changed — the brand page states the system, not how it was arrived at

A specification that narrates its own drafting dates the moment the drafting is
over. The page said the logotype was "already correct" and the lockup "the open
question", introduced the icon set as "the marks that lost the vote", and
recorded which candidate each icon had been before it was an icon. None of that
tells anyone what to draw. Those passages are rules now — *the wordmark's final
E must not be a second lamp*, *every icon is a shape and never a letterform*,
*an icon with no chapter behind it does not belong in the set* — and the
progress notes ("not yet wired into anything", "today that is only…") are gone
with them.

The **stacked lockup's descriptor is centred**, on every line. It was centred as
a box but left-aligned inside it, so at any width where it wraps it went
ragged-right under a centred wordmark. Both members of the stack also carry a
one-letter-space start margin: `letter-spacing` applies after the final letter
too, so tracked type centres half a letter-space to the left of true centre
unless it is corrected.

The same correction reaches the **README banner**, which is a raster and had the
same lean baked into it: measured against the 720px axis of the 1440px artboard,
the lockup's ink sat 2.5px left of centre and the tagline 3.5px left. It is
re-rendered from `render.html` — the compensation goes on the lockup rather than
on the wordmark, or it would open the specified 0.62em gap between the mark and
the word. `og.png` is unchanged; its type is set flush left, where the trailing
space costs nothing.

### Changed — "Make me one" builds something you can see

The hero's payoff button played a patch and left the screen showing the two
candidates it was not. The sound arrived, nothing appeared, and the most
available reading was that the button had done nothing.

The built patch now **replaces the duel** and takes the screen: an amber card —
green is sound, amber is the model, as everywhere else on the page — with the
generated name, its own waveform trace, and the coordinates it chose spelled out
(`from your 5 picks · brightness +0.42 · movement −0.33 · grit +0.05 · weight
+0.01`), so "built for you" is a claim the reader can check against the bars
directly below it rather than one they have to take. `hear it again` and `back
to training` (or <kbd>esc</kbd>) sit under it; returning restores the same duel
with the model untouched, and the button relabels to *Make me another*.

The screen holds the height it had with two cards on it while the built patch is
up. One card is shorter than two, and letting the panel collapse would have
pulled the button just pressed — and everything around it — a few hundred pixels
up the page, which is a good way to make a new patch arrive off-screen.

### Fixed — figure labels were being painted black on a black panel

Every label inside a figure on the landing page rendered black. `viz.css` styles
readable values with `fill: var(--fg)`, and the landing page defines the whole
phosphor palette but never defined `--fg` — an unresolvable `var()` in a `fill`
is invalid at computed-value time, which falls back to the inherited value and
then to the initial one, and the initial value of `fill` is black. The same rule
outranks the `fill` presentation attribute a figure sets on its own elements, so
the two-loops diagram's box titles, which encode *which loop this is* by colour,
were painted black too and the figure lost the thing it was drawing.

`--fg` and `--mono-font` are aliased on the landing page, every `var(--fg)` in
the figure runtime carries `var(--silk)` as its fallback, and the diagram's
titles are set as inline style so the figure's own colour wins.

Separately, `.v-axis` — axis names, units, and the small print inside a box —
was painting 9px glyphs in `--silk-mute`, which law 1 of the design system
reserves for rules and strokes and forbids for text. It is `--silk-dim` now, the
text tier, which lifts the same labels in both books in both themes.

### Changed — one rule for every figure in the books

Figures had grown three tiers and a bug in each. Detail crops were stretched to
the reading column by `.content figure img { width: 100% }` — the 252px bank
rail was published at 862px, a 3.4× upscale of 10px type. Full frames broke out
of the column to a width derived from `100vw` minus whatever the rule believed
was in the way, which was wrong with the sidebar collapsed: the frame ran 123px
off the right edge at every window width from 1200 to 1512. And roughly half the
figures had no caption at all.

One rule now, both books, no width classes: **every figure sits inside the
reading column, a little narrower than the prose, with a caption and alt text.**
Widths are capped, never set, so nothing is ever published larger than it was
captured, and the breakout tier is gone rather than repaired — no rule that
guesses at the available width can be right in a state nobody checked.

The trade is deliberate and is now written down where it can be checked: a
1440×900 frame lands at about 0.54×, where the app's own UI type is texture
rather than text. A frame is there to show the *shape* of a view and its caption
carries what the labels would have said; anything whose detail is the point is
published as a **crop**, at the size it was cropped to. `SCREENSHOTS.md` and
`encode-screens.sh` used to assert the opposite rule and now say this one.

Figures that were wrong, missing, or hand-drawn rather than merely mis-sized:

- **The warm start now shows the warm start.** "Pick 3 of 9" illustrated itself
  with a screenshot of the bank rail. There is a real capture of the three-pick
  card there now, and `SCREENSHOTS.md` records how to reach it.
- **The node bank got its frame** on *Wiring and the node bank*, and the
  **teaching meter** got its crop on *EVOLVE*. Both assets were being built and
  shipped by `encode-screens.sh` and referenced by nothing.
- **The landing page's coefficient figure is the coefficient plot.** It had
  been a whole 1440px app frame rendered at 665px beside a column of prose — a
  0.46× reduction in which the plot the caption describes was a smear and half
  the image was bank and keyboard.
- **A bank row is a bank row.** *Reading a row* drew one in ASCII inside a
  full-width code block, which read as a large empty box. It is a crop of the
  real row.

### Changed — one contributor document, and the design lives in the reference

`DEVELOPMENT.md` and `.github/CONTRIBUTING.md` were one document split across
two files that each pointed at the other; they are now a single root
[`CONTRIBUTING.md`](./CONTRIBUTING.md), which is also where GitHub looks first.
`CONTINUATION.md` — a session-handoff log superseded by this changelog — is
gone, with its still-true sharp edges carried into `CONTRIBUTING.md` rather
than dropped.

`DESIGN.md` is gone too, folded into the reference book under a new **Design**
part: [Lineage](https://alexnodeland.github.io/auracle/reference/design/lineage.html),
the [decisions log](https://alexnodeland.github.io/auracle/reference/design/decisions.html),
[milestones](https://alexnodeland.github.io/auracle/reference/design/milestones.html)
and [open questions](https://alexnodeland.github.io/auracle/reference/design/open-questions.html).
Its §1–§3 were already in that book in more depth, which is the problem: a
choice and the maths that justifies it were two documents that could disagree.
Every decision row now links to the page that works it out, and the `DESIGN.md
§N` citations scattered through the crates' doc comments name reference pages
instead of section numbers in a file that no longer exists.

### Changed — the README badge row, and a credit

The badges had five colours between them for no reason. One rule now: green
belongs to GitHub — the two workflow badges are GitHub's own and still go red
when a check fails — and everything the README asserts about itself is amber on
the rack's panel colour.

A `© 2026 Alex Nodeland` credit, linked to alexnodeland.com, is on the landing
page, both books, the brand page, the instrument's help card and the README.

The README's **Project Status** section is gone: a release badge reading
`v0.2.0` already says the project is pre-1.0, and a section restating it in
prose was one more place to forget to update. The one thing the version number
does not carry — that the save format may still move, and that an export is the
only backup — moved to Quick Start, where someone is about to make patches they
might want to keep. The landing footer lost the same phrase for the same
reason.

### Documentation site

The published site stops being "the instrument at a URL" and becomes a site with
the instrument in it. Four sections under one origin, all built by `make site`:

- **`/` — a landing page.** Hand-authored, in the instrument's own two-phosphor
  design system rather than a new one. Its hero is a **working duel**: two
  synthesized patches with real waveform traces rendered offline from the same
  graph builder that plays them, an online Bradley–Terry update, and a posterior
  whose credible intervals narrow as you pick. It is a four-coordinate miniature
  of a forty-coordinate model and the page says so under the panel.
- **`/play/` — the instrument.** Unchanged, and moved off the root. Every asset
  path in `apps/web` was already relative, so this cost nothing.
- **`/docs/` — a user guide.** Fifteen chapters on playing it: the three views,
  the bank, the rack, wiring, performance, what the model learns from and what it
  provably cannot, how to read its uncertainty, your data, the full key map,
  accessibility (including its four known gaps), troubleshooting, glossary.
- **`/reference/` — a technical reference.** Twenty-five chapters with the math
  set in KaTeX: the typed PCFG, trace addresses, compilation, the audition phrase,
  BS.1770 loudness, the vetting gate, both halves of φ, standardization, the
  max-of-experts utility, the three likelihoods, the posterior and its
  degeneracy diagnostics, calibration, the Boltzmann target, the taste tilt, locks
  as conditional refinement, acquisition, safety, persistence, the web runtime.
  Every constant is quoted from the code by name, every measured claim names the
  harness that produced it, and where the design and the implementation differ —
  refinement is local hill-climbing, not the designed tempered SMC — the page
  says so in its first paragraph.
- **`/reference/api/`** — rustdoc for all five crates.

Both books share one mdBook theme carrying the app's phosphor palette and its
three colour laws, with two themes (rack and paper) rather than mdBook's six.
KaTeX renders at **build time** and its stylesheet and faces are vendored, so the
whole site makes no external requests — a property `make site-check` now enforces,
along with every link, asset, cross-section anchor and the absence of any
root-absolute path (which would work locally and 404 under the project subpath).

CI builds and checks the site on every PR, because none of its failure modes are
visible to `make check`: an undefined KaTeX macro is a build *warning*, and a
cross-section link does not exist until four sections are assembled.

The screenshots throughout are the real app in a taught session, published at
their captured size — `www/SCREENSHOTS.md` records how to remake them and why
scaling a frame of this app is not an option.

### Changed — a plainer voice across the docs and the site

An editing pass over every prose document: the landing page, both books, the
README, `DESIGN.md` and the contributor docs. Nothing about the product changed,
only how it is described.

- **Headings name the thing rather than its presentation.** "Catalogued in
  signal-flow order, not alphabetically" is now "Forty-one modules, from source
  to output". The same went for "What to expect, honestly", "The memo is not an
  optimization detail", "Why this page matters more than it looks" and a dozen
  others. Two anchors moved with their headings, and every inbound link moved
  with them.
- **Implementation boasts came out.** A progress bar that is "honest rather than
  decorative", a guarantee that "provably" holds, a patch that is "byte-for-byte"
  the one that was evolved, a comment that is "the longest and most useful in the
  workspace", a build whose foundations arrive in "one clone". Where the fact
  underneath was load-bearing it stayed; where it was there to impress, it went.
- **Retrospectives left the user-facing pages.** The guide no longer explains
  which bugs the app used to have, how small a jack's hit area once was, or which
  trap it "has already fallen into once". The reference keeps the ones that are
  reference material: the sentinel incident, the two upstream quiver bugs, the
  acquisition retraction.
- **Fewer em dashes, and fewer "not X, but Y" constructions.** 731 em dashes down
  to 172, with the parenthetical ones turned into parentheses and the rhetorical
  ones into full stops.
- **`DESIGN.md` kept its decisions and lost its swagger.** The rejected designs,
  the layered-safety argument and the design-versus-implementation note all stay;
  "this version does it properly", "a confident model mostly serves bangers" and
  "non-negotiable" do not. The locks decision row was reworded, and the reference
  page that quotes it verbatim was updated in the same commit so the quotation
  stays true.

### Changed — `DESIGN.md` is an evergreen document now

It had drifted into a historical record: a "v1 module palette (~10)" against a
shipped palette of 41, `K = 3` against a shipped default of 5, `quiver-dsp`
0.1.x against 0.2.0, and sibling path dependencies that have come from crates.io
since 0.1.0. Every claim in it was re-checked against the code and the document
now describes the system as it stands, with the design-versus-implementation
gaps stated in place rather than left to be discovered.

New or corrected: the full 41-production palette and the append-only categorical
orders; φ's actual 15 + 25 split and why the axes are shaped as they are; the
`s_K` prior correction that keeps `Var(u_a − u_b)` invariant to K; the shipped
taste tilt (it was written as a "long-term" possibility); the measured 40 × 10
refinement split; the acquisition measurement and why the default is uniform
pairing; a new §1.6 on prequential calibration; the DC blocker in the mandatory
output chain; `QUARANTINE_FITNESS = −50.0` rather than "−∞/large-negative"; and
a posterior over `(θ, τ, cutpoints)` rather than the `(θ, z, τ, cutpoints)` left
over from a rejected design.

Section 6 was rewritten: the answered questions (phrase spec, acquisition,
persistence format, vet thresholds) are gone, and the genuinely open ones took
their place — tempered SMC, cross-island discovery, a feedback production, fit
cost at the K cap, and the fugue-side `thin` parameter.

### Changed — the docs menu bar, and the landing footer

**The menu bar stopped becoming two rows.** mdBook ships it as `flex-wrap:
wrap`, so once the cross-site nav, the book title and the three right-hand icons
stopped fitting, the bar silently doubled in height instead of overflowing — at
768px the print/repository/edit icons dropped onto a second row and the section
links ran off the right edge. It is one row at every width now, and what does
not fit is dropped deliberately: the desk affordances first, then the section
labels.

**The section labels moved into the drawer rather than shrinking.** The old
fallback collapsed them to their initials under 700px, and "A G R" is not a
navigation. Below 1000px they appear at the top of the sidebar instead, marked
with the section you are in, and the instrument keeps its button in the bar as
the one destination worth permanent space.

**The landing footer lost two horizontal rules and a third of its height.** It
was three full-width bands fenced by two rules, which on a 1568px frame is three
short lines of text spread down 300px with the right half empty. Identity and
tagline sit on the left now, destinations on the right, credits under both with
a single rule above them. One column under 960px.

### Fixed — the Pages workflow no longer fails on every release

Pushing a `v*` tag fired the Pages workflow, which built the site for nearly two
minutes and was then rejected at the deploy step: *"Tag v0.2.0 is not allowed to
deploy to github-pages due to environment protection rules."* The `github-pages`
environment permits deployments from the `main` branch only, so that deploy could
never have succeeded — one guaranteed red run per release, for a deploy that had
already happened.

The tag trigger is gone. It was settling a question that does not arise: a tag is
cut from a green `main`, so by the time the tag exists that commit has already
deployed from the branch. And the two claims in the docs could not both be true —
a site that "always tracks `main`" is not a site pinned to the last tag. The site
tracks `main`, the zip is pinned to the tag, and the documented release process is
what makes them the same build. `DEVELOPMENT.md` says so now.

### Added — a release badge, and the release status said out loud

The README carries a `github/v/release` badge linking to the latest release. It
currently reads **v0.1.0**, which is the point: the workspace, the changelog and
the docs have all said 0.2.0 since 2026-08-04, but the `v0.2.0` tag was never
pushed, so no 0.2.0 release and no 0.2.0 bundle exist. The badge is the one
place that cannot drift from the truth.

Two documents were asserting the release that was never cut:

- The guide told readers to `unzip auracle-v0.2.0-web.zip`, a file that has
  never existed on any release. The commands now use the same `vX.Y.Z`
  placeholder the prose above them already used.
- `DESIGN.md` said "Released at 0.2.0". It now says the workspace is at 0.2.0,
  that the tag has not been pushed, and that the newest published release is
  still `v0.1.0` — cut before the rename, and named Ricercar.

### Changed — the README's architecture diagram is a mermaid figure

The ASCII box drawing became a `flowchart TD`, which GitHub renders natively and
which stays legible in both the light and dark themes. It carries the same two
loops, with the pool → duel → log → posterior → refine cycle drawn rather than
implied.

Checked by rendering rather than by eye: the diagram was parsed and rendered
against mermaid 11 under both of GitHub's themes at README column width. Two
things that pass a syntax check and still look wrong were caught that way — the
`<br/>` in node labels gets stripped rather than honoured, so multi-line labels
ran their words together, and a left-to-right layout came out four times wider
than tall and unreadably small in a README column.

The lead paragraph also lost "keep/kill triage" from the list of what the app
collects, for the reason above.

### Fixed — three counts and one screen that does not exist

- **The preset library is 61 patches across seven families, not 29.** The guide
  and the reference had both been quoting the count from an earlier wave; a
  screenshot in the guide had been showing `presets 61` next to prose saying
  twenty-nine. The warm start's nine cards are also described correctly now:
  one per family first, then filled out to nine, rather than "one per family".
- **Keep/kill has no UI surface.** The guide's table of teaching signals sent
  readers to a "Triage" screen that has never been built. The likelihood, the
  per-session threshold and `Engine::record_keep` are all real and reachable
  through the wasm binding, but nothing in `apps/web` calls them. The guide, the
  reference and `DESIGN.md` now say so.
- The README's architecture diagram named Thompson sampling as the duel
  acquisition rule. It is selectable, it is not the default, and it measurably
  loses; the default is uniform pairing. The diagram now says so.

## [0.2.0] — 2026-08-04

The first release under the name **Auracle**, and the first one that is a
*patcher* rather than a patchbay with a splice tool behind it. Since 0.1.0 the
instrument gained wiring as a gesture, node identity that survives evolution,
a navigable canvas, destructive verbs you can see and undo, a model that says
what it believes and how sure it is, and an exported picture that is itself a
patch. The prebuilt web bundle is attached below — unzip, `python3 serve.py`,
play.

### Renamed — Ricercar → Auracle

The project is now **Auracle** (aural + oracle): it listens, it learns, and it
tells you what you are going to like. "Ricercar" was a musician's in-joke that
most people could neither pronounce nor spell.

- Crates `ricercar-*` → `auracle-*`, wasm artifacts `auracle_wasm*`, worklet
  processor `auracle-voice`, the workspace and every intra-workspace path dep.
- The wordmark is `AURACLE` with the final **E** as the "model is listening"
  light — the same one mark, two jobs the final R used to do.
- **Nothing a player saved is lost, and nothing of theirs is deleted.** The
  IndexedDB autosave is now `auracle`, with an adopt-on-boot chain that reads
  `ricercar` then `evosynth`; every `ricercar-*` / `evosynth-*` localStorage
  preference is copied to `auracle-*` at import time, before any of it is read,
  and never overwrites an answer this build already has.
- Exported patches are `.auracle.json`, PNG `tEXt` keyword `auracle`, SVG
  `metadata#auracle-patch`. **Files exported by any older build still open**:
  the JSON path never read the marker (a patch is recognized by its shape), and
  the PNG and SVG readers try the old names after the new one.

### Fixed — a hole that stays a hole, a view that cannot be stranded, and a patcher that fits on a laptop

The rest of the closing gate: the dissenting panelist's two named blockers (M2,
M3), the one-line durability bug the chair pulled in on impact (m1), the two
polish items ruled to ship alongside M2 (p4, p5), and the demo gate (M4).

- **An empty socket is named by the node standing in it, not by where that node
  sits.** `placeholderKeys` was a set of trace addresses, so it survived exactly
  as long as the addresses did: the client-side rewrite path carried holes
  across by object identity and **every** `StructOp` — insert, delete, replace,
  set_mod, swap_mix, at any key in the patch — forgot them. Unplug, then insert
  anything anywhere, and the dashed EMPTY plate silently became a full vco with
  knobs on it. A hole is now keyed by `uid`, the same identity locks are keyed
  by and for the same reason, so it rides through any edit inside the node that
  moved. Verified in the browser: an insert that does not touch the hole and an
  insert that moves it from `node/0/1` to `node/0/0/1` both leave it a hole,
  and dropping a source *into* it clears the mark on the frame the module lands.
- **A hole survives a reload,** in `holeStore`/`ui.holes`, the same shape and
  the same argument as `lockStore`/`ui.locks` — persisting it is only honest
  because it names a node. It also survives ⌘Z/⇧⌘Z, because `benchStep` carries
  it: pruning gets undo right for free and could never have got redo right.
- **`case "committed"` files the child's locks — and its holes — under the
  child.** One line and its twin (m1). The commit reply carries no `m.subject`
  so it never reaches `case "bench"`, and IDB ended with an entry for the parent
  and none for the patch the player had actually authored: pins evaporating on
  reload for the one patch that mattered most, with the next ⚡ then breeding
  away the routing they meant to hold. Verified end to end through a commit, a
  full page reload, and re-benching the child.
- **Canvas, bank and accessibility tree agree about absence** (p4). The IN THIS
  PATCH list printed "vco" and the plate's `aria-label` said "vco module" about
  a socket the canvas was drawing as empty. All three route through one
  predicate now; the chip is dashed, reads "empty", and carries no θ, because a
  belief about vcos is not a belief about a hole.
- **The EMPTY plate stops shouting** (p5). It was inheriting the plate of
  whatever it replaced — up to 240×164 with a recessed control well — giving the
  most visual weight on the panel to the thing that is not there. It renders at
  the narrow 96-unit width, one row tall, title and hint only, no well.
- **Freeform can no longer strand the view, and now says so if it has.**
  `contentBox()` returns the modules' bounding box instead of the layout
  canvas's extent, so a fit is a fit of what is drawn — a persisted layout that
  put every plate at y ≈ 3400 had Home dutifully framing 3744 units of which
  3400 were empty. The minimap reads the same box. `applyGrid` re-seeds from the
  **chain** when what is drawn is degenerate, instead of pinning the stranding —
  the one command that looked like a rescue was the one that made the damage
  permanent. A stored layout that places under two thirds of the rack's nodes is
  dropped wholesale rather than applied, and the inheritance test rose from
  "*some* uid in common" (1 in 18) to the same floor. A **reset** verb sits in
  the freeform controls, and below 0.30× with a measurably worse-than-chain
  arrangement the frame itself offers it. Measured on a reproduced stranding:
  0.049× → 0.249× at 1280×900, 0.080× → 0.403× at 1700×1000.
- **The patcher fits on a laptop** (M4). The docked spec card collapses to a
  single line when it has nothing to describe (and stays one line while armed,
  so a placement in progress never resizes the canvas underneath itself); the
  short-laptop media query's breakpoint moves from 860px to 940px, which is
  where it was always meant to apply — 1280×900 is the plan's own second test
  size; a **draggable divider** above the strip gives the player the final say,
  the node bank's rail pattern on the other axis, persisted and keyboard-
  operable; and the auto-LOD threshold scales with the frame's height, because
  what makes a knob small in a 364px band is the band, not the patch. Result at
  1280×900: rack frame **295 → 364px**, and **5 of 5** stock presets open in
  full detail with knobs (First Bass 0.67, Sub & Sparkle 0.61, Acid Line 0.67,
  Reese 0.44, Anvil 0.67 against a 0.40 threshold) where 5 of 5 opened as
  knob-less block diagrams. At 1700×1000 the frame is 489px, the threshold 0.54,
  and all five are in full detail.
- **The freeform verbs hold their slots** (m6, taken because M3 would otherwise
  have made it worse). `apply grid` used to be `display: none` outside freeform,
  so entering the mode slid the layout toggle ~100px under the pointer that had
  just pressed it and a second press fired *apply grid* — a command that
  rewrites every position. Both verbs are now reserved and disabled, and both
  are one word (`snap`, `reset`), because two long labels wrapped the group onto
  a second row at 1280 and cost 35px of the very budget M4 is fighting for.

### Fixed — the sentinel: a knob outside its range, and everything downstream that believed it

The closing panel's one non-negotiable item, found independently by three
reviewers from three unrelated surfaces: a faceplate reading "SUSTAIN 1200.0
dB", a HELD fragment printing `1e+30` for every parameter, and six cells of
exactly `1e30` inside the raw φ of the persisted observation log.

- **Every continuous site in the grammar has a declared range, and it is now
  written down** — `PARAM_DOMAIN`, one constant, next to the `u01()` the prior
  actually samples from. `PatchTree::domain_violations` reports the sites that
  leave it and `PatchTree::clamp_domains` pulls them back, both by walking the
  **trace** rather than matching 26 productions: the trace enumerates exactly
  the continuous sites, by construction, so there is no second table of "which
  fields are knobs" for the next module to be left out of.
- **`validate_tree` — the WS-1 rider — now speaks about values.** It has always
  gated size, depth and modulation depth; it had nothing to say about a knob,
  which is why a value could walk through it into `edit_set_tree`, into
  `finish()`, into φ, into the exported PNG's `tEXt` chunk and into the log.
- **Domains are repaired, ceilings are refused,** and the asymmetry is the
  point: a 40-node patch cannot be clamped without deciding what to delete, and
  a knob can be fixed exactly. Refusing would have meant a saved session that
  already contains one becomes an app the player cannot edit their way out of.
  `finish()` (so every `ReplaceTree`/`InsertTree`/`SetModTree` fragment the
  panel hands in), `edit_set_tree_apply`, `import_patch` and the refinement
  boundary all repair; identities survive, so locks and hand-placed positions
  ride through the repair.
- **The featurizer's quarantine caught only audio pathology.** `sustain = 1e30`
  *renders fine* — the limiter bounds the voice — so it passed the vet and its φ
  became evidence. `featurize` now refuses an out-of-domain term before the
  render, and refuses a non-finite coordinate after it.
- **`Standardizer::fit` gained a runaway-column detector — and it is a detector,
  not a trim, because the trim was measured and thrown out.** One escaped row
  gave `amp_sustain` a mean of ~1.2e29 and a σ of ~5.5e29, which standardizes
  every real patch to the same place: a dead coordinate the model can never
  learn from while the belief line still prints a contribution for it. The first
  fix was routine winsorization at 2% per tail; the 16-seed paired run took it
  straight back out (`+1.877 ± 0.362` → `+0.204 ± 1.347` mean gain, 15/16 → 11/16
  seeds climbing, one seed at −18.2). Trimming a real tail is not free. So the
  shipped rule uses the plain moments **unless** a column's plain σ exceeds its
  winsorized σ by more than `RUNAWAY_RATIO`, which makes it a bit-identical no-op
  on clean data by construction rather than by luck. The threshold was measured
  too — a new `winsor_ratio` example fits 150 clean 48-patch pools and reports
  the largest ratio any column reaches (14.6, `rms_std`), against ~2×10²⁹ for a
  single `1e30`; `1e6` sits five orders above the first and twenty-three below
  the second. Non-finite cells are dropped from their column instead of turning
  it into NaN.
- **Saved state is migrated, not deleted.** On load, every bank term is
  clamped, the observation log's unit coordinates are clamped **by name**
  (never positionally), the implicit-event stream's stored φ pairs are clamped
  positionally *only* at the live φ width, votes carrying a non-finite cell are
  dropped, and — if anything at all was repaired — the persisted standardizer is
  discarded and refit, because a scale fitted over a poisoned column is itself
  poisoned. The frontend says what was mended and how much of it, with counts.
  HELD fragments are UI state and are repaired on their own path in the client.
- **The panel's formatters now fail loudly.** Every knob unit was a *map*, not a
  check: handed `1e30` they answered "1200.0 dB", "Infinity kHz" and
  "1e+32%" — three plausible-looking readings of the same corruption. One guard
  in `knobUnit` renders anything outside 0–1 as `⚠ out of range`.
- **Where it came from.** `1e30` appears as a literal in no workspace source and
  in none of the vendored dependencies (`fugue-evo` 0.3.1, `fugue-ppl` 0.1.0 /
  0.2.0 / 0.2.1, `quiver-dsp` 0.1.x / 0.2.0), and the MH kernel *cannot* seat
  one: every continuous site is `Uniform(0,1)`, whose `log_prob` is −∞ outside
  the unit interval, so an escaped proposal scores `log α = −∞` and is
  rejected. That is measured, not argued — a new `mh_escape` example runs 8
  chains × 20 000 single-site transitions through the shipped kernel and
  observes zero escapes, and a full closed-loop seed (40-patch pool, 60 duels,
  6 refine generations) produces none either. In the shipped session the fault
  is traceable to one event: bank entry #23 (`origin: prior`) is clean, its
  hand-edited child #41 has the same amp envelope with `sustain`, `cut`, `res`
  and `mdepth` all at exactly `1e30` and a freshly-minted `uid` on the root
  filter, and #43/#55/#56 inherit from it. So it entered at the **hand-edit /
  whole-tree-replace boundary** — the one route into a term that went through
  neither `set_param`'s clamp nor the kernel's support check — in a session
  carried across builds, and that boundary is exactly what now has a gate.
- **The φ revalidation, since this touches φ.** 16 seeds, paired, same list both
  arms: pool climb `+1.877 ± 0.362`, climbing on 15/16 — **bit-identical on
  every seed**, which is the intended result and is a property of the design
  rather than a lucky null: the domain gate cannot fire on a synthetic loop that
  never had a bad value, and the standardizer is the plain moments unless a
  column is runaway. VIF over 300 draws is likewise identical to the digit (no φ
  column moved; `amp_sustain` 1.4, `rolloff_mean:p2` 19.6). What *did* move is
  the coordinate the fault was killing: in the shipped profile `amp_sustain`
  comes back with mean 0.647 and σ 0.284, so two patches at opposite ends of the
  knob are 3.5 σ apart — against ~4×10⁻³⁰ σ before the repair. It is a live
  coordinate again, and that is the only number in this section that is supposed
  to be different.
- New regression tests: the prior's own claim (400 draws, every site in
  domain), the sentinel repaired with identities intact, NaN landing mid-range
  rather than pinned to an end, an explicit fragment that cannot seat a bad
  value, the quarantine refusing the exact `1e30` term, clean columns fitting
  bit-identically over four differently-shaped distributions, one escaped row
  that can no longer kill a column, and the log repair being idempotent.

### Added — φ_struct sees how a patch is *arranged*

- **Two arrangement coordinates in φ_struct**, so the taste model can hold an
  opinion about routing and not only about contents: `chain_balance` (mean
  source-to-root path over the longest one — an asymmetric branch, whichever
  side the chain is on) and `frac_sidechained` (binary nodes whose `/1` — a
  ducker's key, a vocoder's modulator — is a chain rather than a bare
  oscillator). `filter(mix(a, b))` and `mix(filter(a), b)` were *the same
  point* in φ before this: same counts, different instrument.
- Both are ratios of shape sums, never linear in any count, which is what keeps
  them clear of the two exact identities that put `size`, `depth` and `n_mix`
  out of φ in the first place. VIF over 300 draws: 2.7 and 2.4, against
  `mod_density` 5.6 and the standing `rolloff_mean` 19.6.
- **Four columns were written and two were cut, both by measurement**, and that
  is the more useful half of the change:
  - `branch_width_max` came back at VIF 10.4 and took `n_vco` from 3.1 to 9.1.
    WS-8 §4 asked for a parallelism coordinate on the reading that serial and
    parallel patches "differ only in `n_mix`". They do not: the leaf count is
    `1 + Σ binaries` exactly, so a patch cannot gain a mixer without gaining a
    source, and the source counts have been in φ since v1. A synthetic listener
    who "likes wide patches" was already learned to Spearman 0.709 by the *old*
    feature set, which says the same thing independently.
  - `mod_at_source` measured *well* — VIF 3.0, full spread — and is out on a
    tie the harness could not break. An 8-seed search-health run made three
    columns look like an unambiguous regression (climb +1.714 → +1.320, best
    patch 8.154 → 6.503, 7/8 seeds climbing → 5/8). At 16 seeds the harness's
    standard error on that quantity turned out to be ±0.64, and the paired
    differences are +0.35 ± 0.73 for two columns and −0.33 ± 0.74 for three:
    neither a regression nor an improvement anything here can see. So the tie
    goes to cost — every column is a dimension of posterior variance the cold
    start pays down — and to scope: two columns answer the question this wave
    was asked, and the third answers a different one. It stays as a display
    field, for a wave with evidence to spend and its own measurement.
- **The routing-lock copy now claims learning.** WS-8 §4 sequenced that
  deliberately: until these columns landed, "lock wiring" could only promise
  that evolution would leave the routing alone.
- **The pre/post evolution measurement, in one line each** (before → after,
  same seeds): pool climb +1.714 → +1.723 · MH acceptance 46.5% → 49.6% ·
  locked refine beat its parent 66% → 69% · fitted-vs-true ranking 0.318 →
  0.389 · true best survived the generation 98% → 100% · closed-loop
  calibration r 0.693 → 0.688 (se ±0.018). And for a synthetic listener whose
  taste *is* a routing preference: fit-vs-truth 0.662 → 0.705, true utility
  gain +2.016 → +2.669, and a pool that ends up 82% sidechained rather than
  71.6%. The full table is on `search_health`'s module doc.
- `search_health` gained three modes. `--routing` is a synthetic listener whose
  taste *is* a routing preference; it walks the term rather than reading
  `StructFeatures`, so the same measurement compiles and runs on both sides of
  a feature-set change. `--climb` runs the pool-climb gate alone at any seed
  count and prints the per-seed numbers, because ±0.4 in the mean gain is
  inside the seed-to-seed spread and the aggregate cannot tell a regression
  from a lottery. `--tail` runs the expensive back half alone, so an
  interrupted comparison run does not have to start over.

### Changed

- Two open questions about the search loop are now **answered in the code**
  rather than in a commit message, because both would otherwise be re-asked
  from scratch:
  - The refinement budget split (`2·N_OPS` steps from `N_OPS/2` seeds) is a
    measured optimum, not an argument — moving off it in *either* direction
    scores worse, and depth from few seeds is actively harmful. The table is
    on `SessionConfig::refine_steps`.
  - The pool-decline scare from the palette expansion: the fitted ranking
    genuinely does churn between refits (Spearman 0.556), and it genuinely
    does not matter, because the true best survives 98% of generations and
    eviction only reads the bottom of the order. Recorded on
    `search_health`'s `retention`, along with why the upper-confidence-bound
    eviction rule it motivated was designed and not shipped.

### Added — wave 2C: modulation becomes a sort

- `ModNode` was a flat enum of leaves: one modulator, one destination, and
  nowhere to put anything in between. It is now **recursive with a depth
  bound**, so `s&h rand → quantize to a minor scale → slew` is a term the
  grammar can write, the taste model can learn and the rack can draw.
- Eleven new modulators: `euclid` (a clocked pattern — the rhythm behind most
  drum machines), the CV shapers `quantize`, `slew`, `rectify` and `hold`, and
  the combiners `min`, `max`, `and`, `or`, `xor` and `switch`.
- **Shapers wrap rather than replace.** Dropping a quantizer on a cable that
  already carries an LFO takes the LFO as its input — chaining is the whole
  point of the recursive sort, and it should not first cost you the modulator
  that made the cable worth quantizing. The socket says which of the three
  things will happen before you click.
- Palette: **30 → 41 modules**, and 43 of quiver's 65 are now reachable.

### Added — wave 2B: the binary-node family

- **Five more modules.** `pitch shift` (a harmoniser — one note becomes an
  interval), and four **binary** nodes whose second child is a *control* rather
  than something you hear: `compressor`, `ducker`, `gate` and `vocoder`.
- Wave one cut all five on the grounds that they "need a second free audio input
  the typed tree cannot name". `ring mod` shipped in that same wave *as a
  two-child node*, so the premise was already false — and the pitch shifter
  turned out to be unary all along; the port map that condemned it belonged to
  the vocoder.
- A `dynamics` group joins the catalogue, and binary sockets now carry real
  names — `in`/`key`, `carrier`/`voice` — instead of `a`/`b`.
- Palette: **25 → 30 modules**.

### Added — wave 2A: motion, voice, and pitch that can bend

- **Six more modules**, none of which needed an architectural change — they were
  cut in wave one on product grounds that did not survive re-reading:
  `formant` (a glottal pulse through five resonators, with a *continuous* vowel
  slide rather than a five-way switch), `flanger`, `tremolo`, `vibrato`,
  `eq` (three bands, ±12 dB, arriving flat) and `granular`.
- **Pitch modulation.** `vco` and `supersaw` gained a modulation slot landing on
  the pitch offset. Until this existed nothing in the instrument could bend a
  pitch — no vibrato, no pitch envelope, no siren — which made "vibrato is just
  an LFO on pitch, pre-baked" an argument for a capability that was not there.
- Palette: **19 → 25 modules**, and modulation slots **10 → 18**.
- A `motion` group joins the catalogue, between `space` and `combine`.

### Added — the palette, and the catalogue that holds it

- **Six new modules, appended to the grammar**: `wavetable` (eight bandlimited
  shapes with a modulatable morph — the first source whose timbre moves),
  `pluck` (Karplus–Strong, gate-triggered), `distortion` (soft / hard / tube),
  `bitcrush`, `phaser`, and `ringmod` — the grammar's **second binary node**,
  which is what makes COMBINE a real sort rather than a sidebar heading.
  Plus `follower`, an envelope follower that taps the module's own input so a
  patch responds to itself, and a `glide` knob on `s&h rand`. Nineteen modules,
  from twelve.
- **Modulation almost everywhere.** Delay, chorus, reverb, wavetable, pluck,
  distortion, bitcrush and phaser gained a modulation slot, each with a fixed,
  **named destination** the rack prints on the jack (`→ time`, `→ size`,
  `→ drive`). It was filter and wavefolder only, in an instrument whose DSP had
  supported the rest all along.
- **The node bank became a catalogue.** Six signal-flow groups, a transfer-
  function glyph per module, a port signature in both phosphors at rest, search
  by sound as well as by name (`grit`, `metal`, `wander`), a spec card with one
  sentence of plain English per module, and — where the evidence supports it —
  the model's own θ with a ±σ whisker.
- **Arm-and-place**, with a full keyboard equivalent. Click a module and every
  legal socket lights up and says what will happen to it: green **inserts**,
  amber **replaces**. Wiring previously had no keyboard path at all.
- **IN THIS PATCH** in the rail, a resizable and persisted width, a collapsed
  rail that keeps its name and its held count, and six new presets that
  exercise the new modules.

### Changed

- `φ_struct` carries **families**, not one column per module: `n_drive` covers
  fold + distortion + bitcrush, `n_mod_fx` covers chorus + phaser. Ten sparse
  per-kind columns would have arrived as near-indicator variables and cost the
  cold start ten dimensions of posterior variance before the model said
  anything.
- The taste→grammar proposal tilt is **shrunk by θ's own uncertainty** rather
  than reading `theta_mean` raw, and the refinement budget scales with the op
  alphabet.
- The rack's ⋯ menu stopped reprinting the module list — **replace with…** and
  **insert after…** hand off to the rail with the socket pre-chosen. One
  inventory, one place.
- The tray is now **held**, and states its terms where it stands.

### Fixed

- The belief the sidebar shows is gated on **evidence, not prevalence**: a
  coefficient whose |mean| sits inside its own σ draws a dot on zero and says
  "the model has looked and has no lean either way", rather than a short bar
  and a direction the posterior does not have.
- Tube-mode distortion is now included in the voice's DC-blocker test — its
  asymmetric shaping emits real DC, which the amp envelope would otherwise
  multiply into a per-note thump and carry into every feature vector.

## [0.1.0] — 2026-07-30

The first tagged release: a playable, taste-learning instrument. The
attached `ricercar-v0.1.0-web.zip` is the prebuilt web app — unzip,
`python3 serve.py`, play.

### Changed
- Dependencies come from crates.io (`quiver-dsp 0.1.1`, `fugue-ppl 0.2.1`,
  `fugue-evo 0.3.1`) — a single clone builds. The quiver wasm32
  `SystemTime` panic was fixed upstream and released as `quiver-dsp 0.1.1`.
- Repository adopted the fugue-ecosystem / quiver OSS standards: MIT
  license, Makefile (`make check` = the CI gate), DEVELOPMENT.md,
  contributing + issue/PR templates, CI with separate
  fmt/clippy/test/wasm jobs under `-D warnings`, and this changelog.

### Renamed
- **EvoSynth → Ricercar** (`efceab6`): crates `ricercar-*`, wasm artifacts,
  worklet processor, storage keys (with one-time migration of old saves),
  export filenames, UI wordmark. Old `.evopatch` files still import.

### Added — pass 6, "four tiers" (`4e94345`, `d12a23b`, `ca82994`)
- **Trust**: IndexedDB session autosave/restore; undo/redo over knob and
  structural edits; Web MIDI in (velocity, pitch bend, sustain); per-patch
  LUFS makeup gain for loudness-fair live audition; in-worklet WAV recording;
  shareable single-patch files.
- **Musicality**: sample-accurate arpeggiator (up/down/up-down/random, BPM ×
  division), glide, unison with detune + stereo spread, velocity→level
  curve; palette grew **reverb** (Freeverb) and a **sample-and-hold random**
  modulation source, end to end (grammar → features → UI).
- **Taste loop**: refinement proposals tilted by the structural taste
  posterior (`exp(η·θ)` on grammar kind weights); recency-weighted
  likelihood (half-life 150 observations); implicit signals logged (play
  counts, promotes); nameable, color-coded styles with auto-labels and
  exemplar audition; pre-vote duel forecasts with running calibration.
- **Surface**: modulation wires pulse at the modulator's rate; duel-deal
  staging; quick-duel strip on PLAY; `?` help overlay with first-run onboarding;
  coarse-pointer touch targets.

### Added — pass 5, bulletproofing (`a0e5628`)
- Zero-allocation render path, one-pole parameter smoothing, click-free
  patch swaps (fade → silent amortized rebuild → re-press held notes →
  fade-in), swap coalescing, compile-failure fallback, chaos gate tests.

### Added — passes 1–4 (`ad00e32`, `05bfbe4`, `76962fc`, `5819ef9`)
- Interactive workbench (every knob a live trace address), locks with exact
  conditional refinement, max-of-experts taste model, taste map / styles /
  directions views, lineage strip.
- The instrument: AudioWorklet 4-voice polyphony, app frame
  (PLAY/EVOLVE/TASTE), patch bank, docked keyboard.
- Feature-complete push: typed structural editing, presets, patch naming,
  dynamic style count, duel-card circuit flip.
- The live surface: zero-recompile knobs (`ExternalInput` atomics), typed
  jack-drag rewiring with a parts tray, labeled jacks, colored wires.

### Added — milestones M0–M5
- Workspace scaffold; grammar + trace codec + compiler; feature pipeline
  (vet gate, LUFS, φ); taste model with three likelihoods; two-loop session
  engine with dueling-Thompson acquisition (closed-loop gate: r > 0.6 in 60
  duels against a synthetic user); wasm bindings and the first web frontend.
