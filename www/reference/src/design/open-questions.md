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
  loop and the chain no longer holds itself in memory, so what is left is purely
  the statistical shape of the problem — the budget can now be chosen on the
  recovery tables rather than against a memory ceiling. The written-down option
  (cap $K$ at 3) is gated on `style_share` evidence from real sessions, which
  nothing collects or reports today.
- **Which state of a refinement walk to inject.** A walk renders ~40 candidates
  and keeps one. `RefineKeep::Best` is implemented and free, and ships switched
  off: argmax over a surrogate finds that surrogate's errors, and the patch-loop
  gate has already caught two seeds in sixteen ending **−12.0** and **−5.5**
  worse in true utility. The A/B is `make climb`, and it has not been run.
- **Interior signal taps in quiver.** A compiled patch exposes exactly one
  output, so the rack's flow animation *estimates* wire levels from the term
  rather than measuring them, and the port trace re-renders a truncated subtree
  per probe. A quiver-side probe API would turn both into measurements. Not
  filed — it needs scoping first.
- **fugue-evo's `parallel` feature on wasm32.** It does not compile there, so
  the workspace takes fugue-evo with default features off and refinement is
  single-threaded *natively* too — in the one place the engine is embarrassingly
  parallel. `RenderMemo` is already `Send + Sync`-shaped for it.
- **Remaining quiver hardening** (non-blocking, tracked upstream):
  `voct_to_hz` is unclamped — overflow is now *recovered* by Q198 rather than
  prevented, and a pitch clamp would also tame aliasing garbage at
  absurd-but-finite pitches.
- **The brightness cluster in φ_audio.** `rolloff_mean`, `zcr_mean` and
  `centroid_mean` carry VIFs of 18.4 / 10.4 / 5.9 — three genuine measurements
  of one perceptual thing. Dropping any discards real signal; the right fix is
  a shared or fused prior over the cluster, which is a
  [modelling](../features/audio.md) change and is not done.
