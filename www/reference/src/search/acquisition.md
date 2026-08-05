# Acquisition

<p class="lede">Which duel to ask next. The answer turned out to be "it does not matter
much", and that is a real result rather than a shrug.</p>

## The rules

`Acquisition` is selectable, because the choice is an **empirical claim** and both
alternatives are kept so the comparison stays runnable. A rule chosen on evidence should
stay re-checkable; a rule rejected on evidence doubly so.

| Rule | Picks |
|---|---|
| **`Random`** *(default)* | A pair uniformly at random from the pool |
| `Bald` | The pair maximizing expected information gain about $\theta$ |
| `Thompson` | Dueling Thompson sampling — a best-arm rule |

## The measurement

```bash
cargo run -p auracle-session --example learn_synthetic --release -- --compare 20
```

20 seeds, 72 duels, refit every 12, against the synthetic user.

The methodology matters more than usual here, because the effect sizes are small:

- **Common random numbers.** Pool fill, the user's coin flip at duel $t$, the MCMC seed at
  round $r$, and refinement seeds are all **shared across arms**, so only the acquisition
  draw differs. Without this the between-seed variance would swamp everything.
- **One fixed held-out exam** under a single reference scale, so arms that built different
  pools are still answering the same questions.
- $\pm$ is **two standard errors of the paired difference.**

Three metrics: cosine similarity to the true $\theta^*$ (↑), rank correlation on the exam
(↑), and excess nats against the true model (↓).

### Static pool — i.i.d. prior draws, `refine_steps: 0`

| | cos θ\* ↑ | rank r ↑ | excess nats ↓ |
|---|---|---|---|
| **random** | 0.460 | 0.731 | 0.211 |
| thompson | 0.416 | 0.628 | 0.254 |
| bald | 0.484 | 0.762 | 0.199 |
| bald − thompson | **+0.068 ± 0.062** | **+0.134 ± 0.044** | **−0.055 ± 0.014** |
| bald − random | +0.025 ± 0.058 | +0.031 ± 0.046 | −0.012 ± 0.013 |

**Thompson is the one clear loser** ($t = 2.2 / 6.1 / -8.0$). It is a *best-arm* rule: it
converges on identifying the top patch, which is not what a duel is for here. Finding the
single best patch in a pool and learning the shape of a taste are different objectives, and
optimizing the first does not deliver the second.

BALD and uniform pairing are within two standard errors on every metric.

### Evolving pool — `refine_steps: 12`, refinement between rounds

A static i.i.d. pool is a weak regime to conclude from on its own: prior draws are spread
over feature space **by construction**, which is exactly where uniform pairs already achieve
near-optimal $\lVert \varphi_a - \varphi_b \rVert$ coverage and an information-seeking rule
has no redundancy to prune. The shipped pool is not that pool — refinement injects children
near the current best, and insertion evicts the worst — so the comparison runs an evolving
regime too.

| | cos θ\* ↑ | rank r ↑ | excess nats ↓ |
|---|---|---|---|
| **random** | 0.479 | 0.694 | 0.232 |
| thompson | 0.459 | 0.583 | 0.276 |
| bald | 0.465 | 0.707 | 0.232 |
| bald − thompson | +0.006 ± 0.068 | **+0.124 ± 0.066** | **−0.044 ± 0.017** |
| bald − random | −0.015 ± 0.055 | +0.013 ± 0.048 | −0.000 ± 0.014 |

Same answer. Thompson loses; BALD and uniform pairing tie on every metric.

## Why `Random` is the default

Measured in both the regime the product starts in and the regime it evolves into, uniform
pairing is indistinguishable from BALD — and **a rule with four tuning constants that ties a
rule with none should not ship on a tie.**

Two supporting reasons survived checking, one did not:

- The `info_gain` BALD reports had **zero consumers** in the frontend.
- BALD's repeat avoidance is real but barely needed over a 48-candidate pool that uniform
  pairing already samples without repeating (gated by
  `duels_spread_over_candidates_not_just_pairs`).
- `Random` makes **every** duel an unbiased
  [calibration sample](../taste/calibration.md#the-selection-bias-fix) rather than one in
  ten — a virtue that holds regardless of which rule learns $\theta$ faster.

### A retraction worth recording

One earlier justification was withdrawn for a bad reason, and the record should say so.

The "pool grows and concentrates" argument was dismissed on the grounds that insertion caps
the pool — but a capped *size* is not an unchanging *spread*, and evicting the worst member
could in principle concentrate a pool. Dismissing the concentration argument **because it was
unmeasured**, while treating a measurement from the other regime as decisive, had the burden
of proof backwards.

The evolving run above is that measurement. It happens to show the concentration
[never materializes](./refinement.md#the-measured-non-concentration), but the default rests on
the measured tie, not on the dismissal.

## What `Bald` is still for

It is not dead code and it is not a fallback. It **decisively beats the best-arm rule**, so it
is the right thing to reach for if acquisition ever needs to *do* something uniform pairing
cannot:

| Lever | Config | Default |
|---|---|---|
| Bias duels toward patches the user will enjoy auditioning | `duel_utility_weight` | 0.1 |
| Bound how often one patch reappears | `duel_exposure_penalty` | 0.25 |
| Avoid re-asking a pair | `duel_repeat_penalty` | 0.5 |
| Soften the selection | `duel_temperature` | 0.6 |
| Reserve unbiased probes | `duel_check_every` | 10 |

All measured, none currently worth the tie.

## A correction worth recording

An earlier version of the BALD rule scored its enjoyment term on **unnormalized** utility and
used an **absolute** softmax temperature of 0.05 nats.

Both are scale bets, and both lost. The enjoyment term grew without bound as the posterior
sharpened, and $\exp(\Delta J / T)$ ran to $e^{10}$ — so the "softmax" was an argmax. That
version was measurably **worse than random**, and it is the version an independent replication
measured.

It also produced the duel repetition observed in the running app: the same defect, seen from
two directions. Fixed, BALD ties random, and the tables above are the fixed rule.

The general lesson is one that recurs in this codebase: a temperature with units of nats is a
bet about the scale of the quantity it divides, and a quantity that grows as a model sharpens
will eventually break that bet.

## Where uncertainty would earn its keep

The design's argument for acquisition is that $\theta$'s posterior *uncertainty* lets early
sessions ask informative questions — duels the model cannot rank — while a confident model
mostly serves things you will like. That remains the right frame; it is also the frame in
which the measurement says the informative-question machinery is not currently paying for
itself.

The honest reading is that at session horizon — tens of duels, a 48-patch pool kept spread by
its own dynamics — there is not enough redundancy in the question set for an
information-seeking rule to exploit. A much larger pool, or a much longer session, is where
the tie would be expected to break.
