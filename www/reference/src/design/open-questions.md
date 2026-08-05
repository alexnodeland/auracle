# Open questions

<p class="lede">Things this design has not settled. They are written down here
rather than left out, because a reference that only describes what works is not
a description of the system.</p>

- **Tempered SMC for generation.** The [Boltzmann target](../search/target.md)
  is written down but not sampled from. Whether the crossover population kernel
  is worth the complexity over local climbing is untested; the measured
  non-concentration of the pool — it *widens* slightly over a session —
  weakens the diversity argument for it.
- **Cross-island discovery.** [Local refinement](../search/refinement.md) from
  island A will not find island B. A tempering schedule would cross the valley;
  today the user reaches the second island by hand or by the prior.
- **A feedback production in the grammar**, with a mandatory attenuator and
  limiter in the loop path. The [grammar](../genome/grammar.md) is DAG-only
  today.
- **Per-style audition phrases** — a discovered bass style picks a bassline, a
  pad style a chord swell. The `:p2` [stimulus tag](../audition/phrase.md) is
  the migration mechanism that would let this land without invalidating
  history.
- **Where acquisition would earn its keep.** [BALD ties uniform
  pairing](../search/acquisition.md) at session horizon. A much larger pool or
  a much longer session is where the tie should break; neither has been
  measured.
- **Fit cost at the K cap.** Single-site MH re-executes the whole program per
  step, so a mature [fit](../taste/posterior.md) is both slower and
  statistically thinner than an early one (205 + S sites over a fixed 10 000
  steps ≈ 48 sweeps per site). The address table is hoisted out of the step
  loop, but the shape of the problem remains.
- **A `thin` parameter in fugue's chain driver.** `adaptive_mcmc_chain`
  materializes every step and discards 97% one line later — hundreds of
  megabytes of transient wasm32 heap for 500 surviving draws. It cannot be
  fixed on the Auracle side; the pieces needed to reimplement the driver with
  identical RNG consumption are private in fugue-ppl 0.2.1.
- **Remaining quiver hardening** (non-blocking, tracked upstream):
  `voct_to_hz` is unclamped — overflow is now *recovered* by Q198 rather than
  prevented, and a pitch clamp would also tame aliasing garbage at
  absurd-but-finite pitches.
- **The brightness cluster in φ_audio.** `rolloff_mean`, `zcr_mean` and
  `centroid_mean` carry VIFs of 18.4 / 10.4 / 5.9 — three genuine measurements
  of one perceptual thing. Dropping any discards real signal; the right fix is
  a shared or fused prior over the cluster, which is a
  [modelling](../features/audio.md) change and is not done.
