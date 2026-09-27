# Open questions

<p class="lede">Things this design has not settled. They are written down here
rather than left out, because a reference that only describes what works is not
a description of the system.</p>

Every entry below is a question **this design raised**. Possibilities it never
raised are a separate register — [unraised directions](./directions.md) — and
an entry there graduates onto this page as soon as someone can state the
measurement that would settle it.

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
- **Fan-out and feedback in the grammar.** Two separate ceilings, deferred
  together because they are the two things the term algebra cannot say.

  This entry used to read *"the grammar is DAG-only today"*, which understated
  it in the direction that matters. The genome is a **tree** — `term.rs` says so
  in its first line — and a tree forbids more than cycles. It forbids *sharing*:
  one output cannot feed two places, so there is no shared sub-patch. A DAG
  would already allow that. The distinction is the whole of the first half of
  this entry, and the docs were describing the looser of the two ceilings.

  **Fan-out** is the more valuable of the two and the more invasive. One
  oscillator into both a filter and a delay line, summed — an idiom so ordinary
  that the app already has to explain its absence. The connect offer does that
  well, volunteering the constraint as a fact (*"A copy: one output cannot feed
  two places"*), and the panel called it the best copy in the product. But it is
  still a ceiling being narrated rather than lifted.

  The cost is not the grammar rule; it is everything keyed to the tree. Child
  indices (`node/0`, `node/1`) are the trace addressing, so a shared node has no
  single path and the address scheme stops being a naming of the term. That
  scheme is load-bearing for panel knobs, locks, live parameter handles, MH
  proposals and the persisted genome — `CONTRIBUTING.md` lists it as a sharp
  edge for exactly this reason. `children()`, `size()`, `depth()` and
  `site_count()` all assume each node is visited once, and `size` is φ's
  parsimony term. Every structural op in `mutate` assumes a unique parent. It is
  a genome-format change with a migration, not a production.

  **Feedback** needs a mandatory attenuator and limiter in the loop path, and a
  delay of at least one sample to be computable at all. quiver's graph is
  evaluated per sample in dependency order, so a cycle needs an explicit
  unit-delay node to break it — which is a real design, not a relaxation of the
  acyclicity check.

  **Deferred, deliberately, and this is the record of it.** Neither is blocked
  on evidence — no measurement would change the answer — so neither belongs in
  the "measure it" pile with the rest of this page. They are blocked on being
  worth a genome migration, and nothing in the loop currently says they are: the
  search is not starved for expressiveness (refinement crosses islands, and the
  pool widens rather than concentrates). Re-open this when a listener wants
  something the tree cannot say, rather than when someone notices it cannot say
  it.
- **Per-style audition phrases** — a discovered bass style picks a bassline, a
  pad style a chord swell. Still open, and worth stating precisely what stands
  in the way, because the migration mechanism is *not* it.

  The `:p2` [stimulus tag](../audition/phrase.md) does solve the history
  problem: a phrase change renames the audio coordinates, old votes keep their
  stimulus-independent structural coordinates, and their old-stimulus audio
  coordinates are imputed as "no evidence" — which the likelihood now handles
  honestly rather than as a measurement. Two prerequisites are therefore
  already met, and one is not:

  - **Comparability is fine**, contrary to the obvious worry. The phrase is a
    property of the *session* (`SessionConfig::phrase`), not of a candidate, so
    everything in a pool is auditioned under one stimulus and duels stay
    apples-to-apples. Per-*style* phrases only make sense as per-*context*
    phrases for the same reason.
  - **The tag would have to be derived rather than declared.** `:p2` is a
    hard-coded literal in `AudioFeatures::NAMES`, and `Features::phi_names` is
    global. A phrase that varies needs the tag to be a function of the
    `PhraseSpec` actually rendered, or the names silently stop describing the
    numbers.
  - **The real obstacle is circular, and it is a design problem rather than an
    engineering one.** A style is *discovered* — it is an inference from φ.
    φ is measured under a phrase. If the phrase is chosen by the style, then
    the stimulus depends on an inference that depends on the stimulus. That
    loop can be broken (bootstrap from the standard phrase, switch only once a
    style's share is confidently high, never re-audition history), but every
    way of breaking it is a decision about how much the instrument is allowed
    to change what it is measuring while it measures it.

  Deferred until that loop has an answer worth defending, rather than until
  someone has time — the mechanism is ready and the question is not.
- ~~**Where acquisition would earn its keep.**~~ **Measured, and the tie does
  not break.** [BALD ties uniform pairing](../search/acquisition.md) at session
  horizon, and this entry named two regimes where that should stop being true:
  a much larger pool, or a much longer session. Both were run at 20 CRN-paired
  seeds, `bald − random`:

  | regime | cos θ* | rank r | excess nats |
  |---|---|---|---|
  | baseline (pool 48, 6 rounds) | +0.059 ± 0.046 *(static)* | +0.045 ± 0.068 | −0.013 ± 0.012 *(static)* |
  | **pool 192** | −0.002 ± 0.044 | +0.015 ± 0.061 | −0.001 ± 0.012 |
  | **24 rounds** (288 duels) | +0.031 ± 0.042 | +0.013 ± 0.013 | −0.003 ± 0.006 |

  At the baseline BALD has two marginal wins in the *static* regime (t = 2.6 and
  −2.2). **Widening the pool fourfold removes them** rather than growing them,
  and lengthening the session fourfold leaves everything inside noise with
  several signs flipped. The reasoning behind the entry — that a bigger pair
  space gives an information-seeking rule more redundancy to prune — does not
  survive being tried.

  What *is* stable across all three regimes is that BALD beats dueling Thompson
  (t = 2.9 to 6.9), which was already known and is unchanged.

  So uniform random pairing stands as the default on the same grounds it always
  had: it ties the information-seeking rule everywhere anyone has looked, has no
  tuning constants, and makes every duel an unbiased calibration sample. The
  session-length knob this needed (`--rounds`) is now in `learn_synthetic`
  beside `--pool`, so the next person can ask a third regime without patching
  a constant.
- **Fit cost at the K cap.** Single-site MH re-executes the whole program per
  step, so a mature [fit](../taste/posterior.md) is both slower and
  statistically thinner than an early one (210 + S sites over a fixed 10 000
  steps ≈ 47 sweeps per site). The address table is hoisted out of the step
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
  `centroid_mean` are three genuine measurements of one perceptual thing.
  A fused prior over the cluster is now **implemented and switched off**, which
  is a more useful state than either "not done" or "done".

  The VIFs quoted when this was written were 18.4 / 10.4 / 5.9; after the ZCR DC
  removal they measure **16.9 / 9.7 / 5.9** and `zcr_mean` no longer trips the
  collinearity flag at all. A third of the original argument was a coordinate
  bug rather than a modelling problem.

  Two gates were run at ρ = 0.25 and they **disagreed**. The closed-loop gate,
  which scores θ recovery, improved (0.657 → 0.702). The 48-seed paired climb,
  which scores what the pool is worth to the listener, regressed —
  **−0.579 ± 0.188 trimmed (−3.09 se)**, sign test 16 better / 32 worse
  (p = 0.029). So it ships at ρ = 0.

  Both results are real because they measure different things: pooling an
  ill-conditioned ridge regularizes *estimating* θ, and biases the *search* that
  consumes θ. The general point outlives the feature — a VIF says these
  coordinates move together across **patches**, which is a fact about φ; fusing
  their coefficients asserts a listener's **preferences** move together, which
  is a fact about people and does not follow. Re-open if the listener model ever
  gains a reason to believe it does; the sweep and both gates are there to
  re-run.
