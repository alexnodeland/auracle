# Open questions

<p class="lede">Things this design has not settled. They are written down here
rather than left out, because a reference that only describes what works is not
a description of the system.</p>

- **Tempered SMC for generation.** The [Boltzmann target](../search/target.md)
  is written down but not sampled from. Whether the crossover population kernel
  is worth the complexity over local climbing is untested; the measured
  non-concentration of the pool — it *widens* slightly over a session —
  weakens the diversity argument for it.
- ~~**Cross-island discovery.**~~ **Closed by measurement, and it was wrong.**
  This entry read: *"local refinement from island A will not find island B; a
  tempering schedule would cross the valley."* Measured against a bimodal
  synthetic user (`make islands`), **20.9 % of refinement events cross islands**
  — 13.5 % of all events decisively, with both ends more than 1.0 onto their
  island rather than hovering at the boundary — and **0 of 8 seeds** ended with
  a pool on one island only.

  The reasoning was wrong about the geometry. The walk is not local in *feature*
  space: it is a reversible-jump walk over a **tree grammar**, and a single
  accepted structural move swaps a subtree, which is a large jump in φ. There is
  no valley to cross, because the search does not have to travel through the
  space between the islands. See
  [Refinement](../search/refinement.md#the-islands-are-not-separated-by-a-valley).
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
  (cap $K$ at 3) is gated on `style_share` evidence from real sessions.

  **That evidence is now collected.** Every posterior fit records what fraction
  of the pool each lens claimed, and the register persists across reloads
  (`Engine::style_shares`). The question is still open — it wants sessions,
  which take time to accumulate, and synthetic runs cannot answer it — but it is
  now open for want of *data* rather than for want of an instrument. Rows where
  `k == k_styles` are the ones that bear on it: `k` grows with the log, so an
  early row with two lenses is not evidence that lenses 3–5 are idle.
- ~~**Which state of a refinement walk to inject.**~~ **Run, and it tied.** A
  walk renders ~40 candidates and keeps one; `RefineKeep::Best` takes the
  highest-`log π_β` state the walk occupied, seed included, and ships switched
  off. Sixteen paired seeds:

  | | `Last` | `Best` |
  |---|---|---|
  | mean gain | +1.927 ± 0.452 | +1.774 ± 0.302 |
  | median gain | +2.058 | +1.819 |
  | 10% trimmed | +1.840 ± 0.383 | **+1.925 ± 0.190** |
  | climbed on | 14/16 | 15/16 |

  Paired difference (`Best` − `Last`): mean **−0.153 ± 0.384**, median −0.185,
  trimmed −0.113 ± 0.318, sign test **8 better / 8 worse (p = 1.000)**. As exact
  a tie as sixteen seeds can produce, and it does not clear zero at 2 se on any
  statistic — so the default stays `Last`, kept re-checkable rather than
  deleted, as `Acquisition::Thompson` is.

  Neither the feared failure nor the hoped-for win appeared. The worry was that
  argmax over a surrogate would deepen the catastrophic tail; across the pair
  the tails are a wash. What *did* show is that **`Best` is the lower-variance
  rule rather than the better one** — half the trimmed standard error (0.190
  against 0.383). Injecting the walk's argmax is more consistent than injecting
  where it stopped; it just does not aim anywhere better on average. That is the
  argument to re-run this on if the surrogate ever gets sharper.
- ~~**Interior signal taps in quiver.**~~ **Closed, and it was wrong.** This
  entry read: *"a compiled patch exposes exactly one output … a quiver-side
  probe API would turn both into measurements. Not filed — it needs scoping
  first."* There was nothing to scope and nothing to file. quiver's
  `StateObserver` has taken `Level`, `Scope` and `Spectrum` subscriptions on
  any node port for some time, in the release the lockfile already pinned. The
  gap was here, not upstream.

  The compiler now records where each term node's audio leaves it, and the
  rack's flow animation multiplies a measured RMS into its reach factor while
  notes sound. Two expectations about the work turned out not to hold either:
  `sync_output_keepalive` is unnecessary, because the genome is a tree and
  every module's output already feeds a parent, so quiver is already computing
  every metered value; and the open design question — which of N voices to
  meter — has an answer, the most recently pressed one, since a sum across the
  bank averages notes at different envelope phases and is not the level on any
  wire. The port trace stays an offline render, now by choice: it wants the
  same phrase every time so that two looks at it are comparable.
- ~~**fugue-evo's `parallel` feature on wasm32.**~~ **Closed, and it was wrong
  three times over.** The entry read: *"it does not compile there, so the
  workspace takes fugue-evo with default features off and refinement is
  single-threaded natively too — in the one place the engine is embarrassingly
  parallel."*

  Wrong about the blocker: [fugue-evo#22](https://github.com/alexnodeland/fugue-evo/pull/22)
  established that `checkpoint`, not `parallel`, was the only thing that did not
  build on wasm32. Wrong about the remedy: enabling `parallel` would change
  nothing here, because every `rayon` use in fugue-evo sits under
  `#[cfg(feature = "classic")]`, and Auracle takes `["std", "ppl"]` and drives
  refinement itself through `inference::mh::EvolutionChain`. And wrong about the
  prize: the harness is not waiting on single-threaded refinement. `search_health`
  and the `refinement_improves_pool` floor already spawn one thread per seed and
  saturate the machine, so parallelising *inside* a refinement cannot make a
  16-seed measurement faster — the cores are already busy.

  What is left is real but smaller than the entry implies, and it is a UX
  number rather than a harness one: latency on a **single** refinement, which is
  the app's ⚡ button. Filed as that, not as a build-configuration change.
- **Remaining quiver hardening** (non-blocking, tracked upstream):
  `voct_to_hz` is unclamped — overflow is now *recovered* by Q198 rather than
  prevented, and a pitch clamp would also tame aliasing garbage at
  absurd-but-finite pitches.
- **The brightness cluster in φ_audio.** `rolloff_mean`, `zcr_mean` and
  `centroid_mean` carry VIFs of 18.4 / 10.4 / 5.9 — three genuine measurements
  of one perceptual thing. Dropping any discards real signal; the right fix is
  a shared or fused prior over the cluster, which is a
  [modelling](../features/audio.md) change and is not done.
