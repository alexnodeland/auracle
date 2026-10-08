# The posterior

<p class="lede">MCMC when it can afford to, importance sampling when it cannot, and an
honest signal for when the cheap path has run out.</p>

## The full fit

`TasteModel::fit` runs fugue’s **adaptive single-site Metropolis–Hastings**,
with these defaults (`SessionConfig` in `engine.rs`, and `KEEP` in
`auracle-taste`’s `model.rs`):

| | Default |
|---|---|
| Post-warmup steps | 10,000 (`mcmc_samples`) |
| Warmup steps | 3,000 (`mcmc_warmup`) |
| Retained draws | ≤ 500 (`KEEP`), by thinning |

Every site is an `f64` (there are
[no discrete latents](./utility.md#what-max-utility-buys-structurally)), so
fugue’s generic chain applies, and no site is conditional on another’s value,
so the program’s structure never changes. The fit runs that chain
[over an array of the sites’ values](#the-kernel) rather than through the
program. Adaptation tunes per-site proposal scales during warmup.

Each MH step moves **one** site, so a useful way to budget is $\text{steps}
\approx \text{sites} \times \text{desired effective sweeps}$. At $K=5$,
$225 + S$ sites over 10,000 steps is at most about 44 sweeps per site. That is
thin, and it is the tension noted in
[site count](./likelihoods.md#site-count-and-what-it-costs).

The result is uniformly weighted:

```rust
TastePosterior { cfg, samples, weights: vec![1.0 / n; n] }
```

### The kernel

fugue’s chain driver runs the whole program on every MH step: it rebuilds
$225 + S$ `sample` nodes and their closures, and fills a fresh trace of as many
`BTreeMap` entries, to move one number. That rebuild, not the likelihood, was
most of a refit’s time. Since the structure never changes, `TasteModel::fit`
runs a kernel of its own (`model/kernel.rs`). The state is an array of the
sites’ values in the program’s execution order, and a step proposes one value,
decodes the array into a draw, and scores it with the program’s own pieces:
the same priors, the same cutpoint transform and the same likelihood sum.

It is fugue’s kernel, not a new one. The start is a prior run of the program
itself. The site is drawn over the trace’s address order as fugue draws it, its
scale comes from fugue’s own `DiminishingAdaptation`, and the Gaussian step and
the accept test are fugue’s, reading the random stream in the same order. The
log-weight is summed in the trace’s order. So a seed deals the same draws, bit
for bit: the kernel’s tests run it against fugue’s driver over seeds and
configurations (fused groups, several sessions, stars, imputed coordinates, a
recency half-life, a stride longer than the chain), and `fit_bench`’s checksums
did not move.

| µs per step, `fit_bench 10000 3000` | first fit ($K=1$, 6 rows, 50 sites) | mature fit ($K=5$, 100 rows, 226 sites) |
|---|---|---|
| fugue’s driver | 22.7 | 207.1 |
| the kernel | **1.9** | **47.8** |

What is left of a mature step is the likelihood: the same 226 sites over 6
rows take 6.1 µs a step.

### The address table

`SiteAddrs::new` builds every site address **once** per fit, and the program
clones `Address` (an `Arc` refcount bump plus a cached hash) into each node.
The kernel keys its proposal scales by the same addresses.

When fugue’s driver rebuilt the program on every step, building addresses
inline (`addr!(format!("theta{k}"), i)`) cost a `format!` into a `String`, a
re-allocation into `Arc<str>`, and a SipHash of that string, **per site per
step**: roughly 3.7 M allocations per mature fit, and measurably the bulk of
the fit’s wall time then (`examples/fit_bench.rs`).

The addresses are a pure function of $(K, d, n_{\text{stars}}, S)$, none of
which move during a fit. And they are produced by the *same* `addr!`
invocations as before, so traces, serialized posteriors, and warm-start paths
see byte-identical addresses.

### Thinning happens at the driver, not after it

95% of the post-warmup chain is discarded (19 draws in every 20), and it is
discarded *as it is produced*.

That used to happen one line after the whole chain was built. `adaptive_mcmc_chain`
materialized every step, pushing `(TasteSample, Trace)` per iteration into a
`Vec` it returned by value, and only then did `step_by(stride)` keep every 20th.
At $K = 5$ that is ~10,000 `Trace` clones of 225 + S `BTreeMap` entries each,
held live at once to retain 500: **303.1 MB peak RSS** at the shipped budget,
scaling with `n_samples`, and a plausible mobile-Safari OOM on a 32-bit heap
rather than mere waste.

It could not be fixed here then. The retention was inside fugue’s chain driver,
and the pieces needed to reimplement that driver with identical RNG consumption
(`single_site_mh_step`, `propose_and_score`, `SingleSiteProposalHandler`) are
private or `pub(crate)`; forking fugue’s inference core into this crate would
have traded a memory spike for a correctness hazard on every upgrade. (The
[kernel](#the-kernel) has since done that reimplementation, for time rather
than memory, and its tests against fugue’s driver are what guard that hazard:
a fugue upgrade that changes the chain fails them. It keeps every
`stride`-th draw as it runs, as the driver does.)

So it was fixed **upstream** instead, as
[fugue-ppl 0.2.2](https://github.com/alexnodeland/fugue/pull/47):
`adaptive_mcmc_chain_thinned` takes a stride and pushes only when
`i % thin == 0`.

| | peak RSS | mature-fit checksum |
|---|---|---|
| before | 303.1 MB | `07d204764b58c88b` |
| after | **18.2 MB** | `07d204764b58c88b` |

**16.7× less peak memory for bit-identical draws.** The unchanged checksum is
the point of that table rather than a footnote to it. `thin` gates the push and
nothing else: every transition still runs, so the RNG is consumed in the same
order and quantity, and $0, \text{stride}, 2\cdot\text{stride}, \dots$ is exactly
what `step_by` kept. `fit_bench`’s per-fit checksum is the Auracle-side witness;
fugue’s `thinning_retains_exactly_the_draws_step_by_would` is the upstream one.

What stays resident is the 500 draws the posterior actually keeps, so **the peak
no longer scales with `mcmc_samples` at all**. The budget is now free to be
chosen on the recovery tables rather than against a memory ceiling.

## Between fits: sequential importance sampling

A full fit costs seconds and cannot run after every pick. So each new
observation is folded into the existing draws by reweighting:

$$w_s \;\leftarrow\; \frac{w_s \, p(y \mid \theta_s)}{\sum_{s'} w_{s'} \, p(y \mid \theta_{s'})}$$

```rust
let m = (0..n)
    .filter(|&i| self.weight(i) > 0.0)
    .map(|i| ll[i])
    .fold(f64::NEG_INFINITY, f64::max);
let mut w: Vec<f64> = (0..n)
    .map(|i| match self.weight(i) {
        wi if wi > 0.0 => wi * (ll[i] - m).exp(),
        _ => 0.0,
    })
    .collect();
```

This is **exact** (the weighted draws target the updated posterior), and its
cost is linear in the number of draws. It is what makes each duel respond to
the one before it; without
it the acquisition rule reads a frozen posterior and re-asks the same question
until the next full fit.

The likelihoods are shifted before they are exponentiated, by the best
log-likelihood among the draws that still carry weight. A draw whose weight
has already fallen to zero takes no part, in the shift or in the products.

### However strong the contradiction

A vote can rule out every draw that still carries weight. Likelihoods of
$e^{-3000}$ and $e^{-2400}$ are far under the smallest double (about
$e^{-745}$), and taken as they are, every product would round to zero.
Shifted by the best weighted draw, that draw's product is its own weight, so
the sum cannot underflow while that draw's log-likelihood is finite. The
weight moves to the draw that contradicts the vote least, by the exact
update. If it concentrates the weights far enough, ESS falls, the draws are
[resampled](#systematic-resampling), and the
[refit trigger](#the-refit-trigger) is armed.

The shift used to be taken over every draw, including those with no weight
left. When one of those scored best, its log-likelihood set the shift, and a
vote that every weighted draw ruled out firmly enough pushed every product
under the smallest double. The weighted draws still ranked the vote, but the
update was skipped: a slightly weaker version of the same vote could collapse
the weights and arm the trigger, while the stronger one left them where they
were (`the_update_is_exact_however_strong_the_contradiction` in
`auracle-taste`).

Every vote on a finite $\varphi$ has a finite log-likelihood under every
draw: a duel, a keep or a cut, and a star rating wherever its utility sits
against the cutpoints
([computed in log space](likelihoods.md#star-ratings-a-cumulative-logit), by a
form exact in both tails). So a stronger contradiction never moves the
weights less than a weaker one
(`every_vote_on_a_finite_phi_has_a_finite_likelihood` in `auracle-taste`).

A star rating between the lowest and the highest used to be the exception.
Far below its lower cutpoint its log-likelihood lost precision, and about 37
under it underflowed to $-\infty$ where the true value is finite: a draw it
underflowed for lost all its weight, and once every weighted draw's did, the
weights were kept. On three test draws weighted [0.7, 0.3, 0], a rating of 1
collapsed the weights to [0, 1, 0] at one strength and left them at
[0.7, 0.3, 0] at a stronger one. It now moves them by the exact update at
every strength, to about [0.0001, 0.9999, 0] at that stronger one (#227;
`a_star_rating_far_below_its_cutpoint_updates_exactly_at_every_strength`).

### A vote with no likelihood keeps the weights

The denominator is now not a number only when the weighted draws give the
update nothing to go by: when one of their log-likelihoods is NaN, or all of
them are $-\infty$ (the shift is then $-\infty$ too, and
$-\infty - (-\infty)$ is NaN). Only a vote on a $\varphi$ that is not
finite does that, since every vote on a finite one has a finite
log-likelihood ([above](#however-strong-the-contradiction)). One that holds a
NaN (which [vetting](../audition/vetting.md) exists to prevent) makes every
log-likelihood NaN. Then the update **keeps the previous weights**. That is
a choice: a NaN leaves no update to make. What the votes since the last fit
taught the draws stays, and the observation waits in the log for the next
fit. ESS is unchanged, so such a vote never calls for a resample by
itself. The update used to reset the weights to uniform here,
which threw that evidence away and claimed a full ESS besides
(`a_vote_with_no_finite_likelihood_keeps_the_previous_weights` in
`auracle-taste`).

### What the app is sent after each pick

The reweighted draws are the posterior the engine holds until the next fit,
so the app is told what they say after every pick, not only after a refit.
Each reply to a pick (a duel, a cut, stars, an answered offer in PERFORM)
carries the pool's ratings as they stand, a `ratings` field filled from
`WasmEngine::belief()`:

```json
{"ranked":[{"id":12,"mean":0.84,"std":0.31,"style":1}, …],
 "seeds":[12,7,31, …],
 "may_replace":[40,3, …]}
```

- **`ranked`**: every pool member's posterior mean and std of the mixture
  utility, best first, and the lens most responsible for it. They are the
  ranked list's numbers and the map's glow, size and color for each pool dot,
  computed under the weights the pick left, exactly as a refit's views would
  compute them.
- **`seeds`**: the parents the next generation would take, and
  **`may_replace`**: the members its end could retire
  ([refinement](../search/refinement.md#before-a-generation-its-seeds-and-what-it-may-replace)).

One pass over the draws per member serves the mean, the std and the lens
(`utility_mix_and_responsibilities`). Measured in wasm under node on an
Apple M3 Max (`examples/pick_belief.mjs` in `auracle-wasm`, beside its
native twin `pick_belief.rs`), that is under a millisecond per pick for a
session of 30 picks (two lenses) and under 2 ms at five lenses. While a
generation is open with the pool over size, what its end would retire is
ranked as well, under the posterior it opened with: 1.8 ms at two lenses and
3.9 ms at five. The rest of the map, its projection and the ghosts of earlier
picks, costs 28 ms by 100 picks and grows with the history, so it still waits
for a refit.

### Effective sample size

$$\mathrm{ESS} = \frac{1}{\sum_s w_s^2}$$

Equals the draw count for uniform weights, and collapses toward 1 as weights
concentrate.

Importance weights **degenerate**, and ESS says so rather than letting the
posterior quietly become one point wearing 500 hats. It is the engine’s signal
that a real refit is due.

<figure class="viz" data-viz="ess">
<figcaption><strong>Fold observations in and watch the weights concentrate.</strong>
Each bar is one posterior draw. Reweighting is exact and costs almost nothing,
but the mass keeps collecting on fewer draws until a “posterior” of a handful
of points would tell the acquisition rule it is certain when it is merely
exhausted. Then press <em>resample</em>: ESS goes back to full and most of the
draws are now duplicates of each other: the sample is impoverished rather than
informative, which is why this is a stopgap and not a substitute for a
fit.</figcaption>
</figure>

### Systematic resampling

When weights have concentrated far enough (ESS below half the draws),
`resampled()` draws the weighted set back to a uniformly weighted one of the
same size.

The trade: resampling produces **duplicate draws**, so the sample is
impoverished but still spans the posterior’s support, and ESS on the fresh
uniform weights no longer *claims* more information than is there. Left
unresampled, almost all the mass sits on one draw, and a “posterior” of one
point tells the acquisition function it is certain when it is merely exhausted.

It is a stopgap between full refits, not a substitute for one.

Deterministic (systematic, offset $\tfrac{1}{2N}$) rather than multinomial,
because every other stochastic step in the engine is seeded and reproducible
and this one has no reason not to be.

### The refit trigger

```rust
pub fn needs_refit(&self) -> bool {
    match &self.posterior {
        Some(_) => self.resamples_since_fit > 0,
        None => !self.log.is_empty(),
    }
}
```

The engine’s condition is not a count of picks. It is **“the weights have had
to be resampled at least once since the last real fit”**, that is, the cheap
path has provably run out of road. With no posterior yet, it is true as soon as
the log holds anything. The engine reports it in its status. A vote that
rules out every weighted draw arms it like any other pick that concentrates
the weights, [however strong](#however-strong-the-contradiction) it is,
unless it is a vote with
[no likelihood](#a-vote-with-no-likelihood-keeps-the-weights), one on a
$\varphi$ that holds a NaN. Such a vote leaves the
weights as they were and does not arm it, but the picks after it reweight
from those weights as usual.

The app does not wait for it. Every sixth pick refits (`FIT_EVERY`, 6, in
`apps/web/main.js`), and PERFORM’s answered offers count as picks. Two other
moments refit at once: the end of the warm start, and opening a taste profile
that holds picks. The app used
to require `needs_refit` as well, to save the seconds of a fit whose posterior
had not gone stale. Which picks those were depended on how surprising they had
been, so a run of agreeable picks ended with the teaching meter’s countdown and
no refit: the meter promised something it then did not do. A fit costs a few
seconds off the audio thread, at most once every six picks outside those two
moments, and the pair stays audible through it.

## Label alignment

Mixture posteriors are permutation-symmetric in the style labels (label
switching), so per-style summaries are meaningless on a raw posterior.

`aligned()` resolves it post hoc, in two passes:

1. Relabel every sample to best match a reference (the last sample), maximizing
   total $\theta$ **cosine similarity** across styles.
2. Recompute the mean of the pass-1 result and relabel against that.

Alignment is **exhaustive over permutations**, which is fine because $K \le 5$
and $5! = 120$. No-op at $K = 1$.

Call it before `theta_mean`, `theta_std`, `style_share`, or anything else
per-style. Aggregate quantities (`utility_mix`, `prob_prefers`, and `slope`,
which names each draw's style by its rating) are permutation-invariant and do
not need it.

## What the summaries are

All weighted by the importance weights:

| | |
|---|---|
| `theta_mean(k)` | $\sum_s w_s \theta_{k,s}$ |
| `theta_std(k)` | Per-dimension posterior SD: the whiskers on LEARNING’s weights |
| `utility_mix(z)` | $(\text{mean}, \text{sd})$ of $u$: glow and size on the map |
| `responsibilities(z)` | $\sum_s w_s \mathbb{1}[\text{best style of } z \text{ under } \theta_s = k]$ |
| `style_share(Z)` | `responsibilities` averaged over candidates |
| `slope(z, ê)` | $(\text{mean}, \text{sd})$ of $\theta_{k^\star}^\top \hat e$, $k^\star$ each draw’s best style of $z$: PERFORM’s [lean](../search/perform.md#which-way-your-taste-leans) |
| `prob_prefers(a,b)` | $\sum_s w_s\, \sigma(u_s(a) - u_s(b))$ |

`prob_prefers` marginalizes $\theta$ **and** the weights **and** the
per-candidate style choice, which is why it is the right forecast to show for a
pair: it is a predictive probability, not a point estimate’s opinion.

## Serialization

`TastePosterior` serializes to JSON, and `weights` carries `#[serde(default)]`
so older persisted posteriors, written before reweighting existed, deserialize
to empty and are read as uniform.

The **observation log remains the source of truth**. A posterior snapshot is a
cache: it can always be recomputed from the log plus its
[standardizer](../features/standardization.md), and that is exactly what a
[profile](../persistence.md) stores.
