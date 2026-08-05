# The posterior

<p class="lede">MCMC when it can afford to, importance sampling when it cannot, and an
honest signal for when the cheap path has run out.</p>

## The full fit

`TasteModel::fit` runs fugue's **adaptive single-site Metropolis–Hastings**:

| | Default |
|---|---|
| Post-warmup steps | 10 000 (`mcmc_samples`) |
| Warmup steps | 3 000 (`mcmc_warmup`) |
| Retained draws | ≤ 500, by thinning |

Every site is an `f64` — there are
[no discrete latents](./utility.md#what-max-utility-buys-structurally) — so the generic
chain applies with no custom kernel. Adaptation tunes per-site proposal scales
during warmup.

Each MH step moves **one** site, so a useful way to budget is $\text{steps}
\approx \text{sites} \times \text{desired effective sweeps}$. At $K=5$, $205 +
S$ sites over 10 000 steps is roughly 48 sweeps per site — which is thin, and
is the tension noted in
[site count](./likelihoods.md#site-count-and-what-it-costs).

The result is uniformly weighted:

```rust
TastePosterior { cfg, samples, weights: vec![1.0 / n; n] }
```

### The address table

`SiteAddrs::new` builds every site address **once** per fit, and the model
clones `Address` (an `Arc` refcount bump plus a cached hash) into each node.

Building addresses inline (`addr!(format!("theta{k}"), i)`) cost a `format!`
into a `String`, a re-allocation into `Arc<str>` and a SipHash of that string,
**per site per step**: roughly 3.7 M allocations per mature fit, and measurably
the bulk of the fit's wall time (`examples/fit_bench.rs`; the fit is `steps ×
sites`-shaped and the likelihood is only ~20% of it even at 100 observations).

The addresses are a pure function of $(K, d, n_{\text{stars}}, S)$, none of
which move during a fit. And they are produced by the *same* `addr!`
invocations as before, so traces, serialized posteriors and warm-start paths
see byte-identical addresses.

### Thinning happens at the driver, not after it

97% of the chain is discarded, and it is discarded *as it is produced*.

That used to happen one line after the whole chain was built. `adaptive_mcmc_chain`
materialized every step — pushing `(TasteSample, Trace)` per iteration into a
`Vec` it returned by value — and only then did `step_by(stride)` keep every 20th.
At $K = 5$ that is ~10 000 `Trace` clones of 205 + S `BTreeMap` entries each,
held live at once to retain 500: **303.1 MB peak RSS** at the shipped budget,
scaling with `n_samples`, and a plausible mobile-Safari OOM on a 32-bit heap
rather than mere waste.

It could not be fixed here. The retention was inside fugue's chain driver, and
the pieces needed to reimplement that driver with identical RNG consumption
(`single_site_mh_step`, `propose_and_score`, `SingleSiteProposalHandler`) are
private or `pub(crate)`; forking fugue's inference core into this crate would
have traded a memory spike for a correctness hazard on every upgrade.

So it was fixed **upstream** instead, as
[fugue-ppl 0.2.2](https://github.com/alexnodeland/fugue/pull/47):
`adaptive_mcmc_chain_thinned` takes a stride and pushes only when
`i % thin == 0`.

| | peak RSS | mature-fit checksum |
|---|---|---|
| before | 303.1 MB | `07d204764b58c88b` |
| after | **18.2 MB** | `07d204764b58c88b` |

**16.7× less peak memory for bit-identical draws** — the unchanged checksum is
the point of that table rather than a footnote to it. `thin` gates the push and
nothing else: every transition still runs, so the RNG is consumed in the same
order and quantity, and $0, \text{stride}, 2\cdot\text{stride}, \dots$ is exactly
what `step_by` kept. `fit_bench`'s per-fit checksum is the Auracle-side witness;
fugue's `thinning_retains_exactly_the_draws_step_by_would` is the upstream one.

What stays resident is the 500 draws the posterior actually keeps, so **the peak
no longer scales with `mcmc_samples` at all** — the budget is now free to be
chosen on the recovery tables rather than against a memory ceiling.

## Between fits: sequential importance sampling

A full fit costs seconds and cannot run after every vote. So each new
observation is folded into the existing draws by reweighting:

$$w_s \;\leftarrow\; \frac{w_s \, p(y \mid \theta_s)}{\sum_{s'} w_{s'} \, p(y \mid \theta_{s'})}$$

```rust
let m = ll.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
let mut w: Vec<f64> = (0..n).map(|i| self.weight(i) * (ll[i] - m).exp()).collect();
```

This is **exact** (the weighted draws target the updated posterior) and it
costs $O(S)$. It is what makes each duel respond to the one before it; without
it the acquisition rule reads a frozen posterior and re-asks the same question
until the next full fit.

The max-shift before exponentiating is the usual guard. Log-likelihoods here
are bounded above by 0, so it is not strictly needed for duels, but it keeps
mixed modalities safe.

### Effective sample size

$$\mathrm{ESS} = \frac{1}{\sum_s w_s^2}$$

Equals the draw count for uniform weights, and collapses toward 1 as weights
concentrate.

Importance weights **degenerate**, and ESS says so rather than letting the
posterior quietly become one point wearing 500 hats. It is the trigger for
paying for a real refit.

<figure class="viz" data-viz="ess">
<figcaption><strong>Fold observations in and watch the weights concentrate.</strong>
Each bar is one posterior draw. Reweighting is exact and costs almost nothing,
but the mass keeps collecting on fewer draws until a "posterior" of a handful
of points would tell the acquisition rule it is certain when it is merely
exhausted. Then press <em>resample</em>: ESS goes back to full and most of the
draws are now duplicates of each other: the sample is impoverished rather than
informative, which is why this is a stopgap and not a substitute for a
fit.</figcaption>
</figure>

### Systematic resampling

When weights have concentrated far enough, `resampled()` draws the weighted set
back to a uniformly weighted one of the same size.

The trade: resampling produces **duplicate draws**, so the sample is
impoverished but still spans the posterior's support, and ESS on the fresh
uniform weights no longer *claims* more information than is there. Left
unresampled, almost all the mass sits on one draw, and a "posterior" of one
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

So the condition is not "every $n$ duels": it is **"we have had to resample at
least once since the last real fit"**, i.e. the cheap path has provably run out
of road. The app surfaces this as the teaching meter and the wordmark's
listening lamp; a refit happens at most every six duels, and only when this
says so.

## Label alignment

Mixture posteriors are permutation-symmetric in the style labels (label
switching), so per-style summaries are meaningless on a raw posterior.

`aligned()` resolves it post hoc, in two passes:

1. Relabel every sample to best match a reference (the last sample), maximizing
   total $\theta$ **cosine similarity** across lenses.
2. Recompute the mean of the pass-1 result and relabel against that.

Alignment is **exhaustive over permutations**, which is fine because $K \le 5$
and $5! = 120$. No-op at $K = 1$.

Call it before `theta_mean`, `theta_std`, `style_share` or anything else
per-style. Aggregate quantities (`utility_mix`, `prob_prefers`) are
permutation-invariant and do not need it.

## What the summaries are

All weighted by the importance weights:

| | |
|---|---|
| `theta_mean(k)` | $\sum_s w_s \theta_{k,s}$ |
| `theta_std(k)` | Per-dimension posterior SD — the whiskers in DIRECTIONS |
| `utility_mix(z)` | $(\text{mean}, \text{sd})$ of $u$ — glow and size on the map |
| `responsibilities(z)` | $\sum_s w_s \mathbb{1}[\text{best lens of } z \text{ under } \theta_s = k]$ |
| `style_share(Z)` | `responsibilities` averaged over candidates |
| `prob_prefers(a,b)` | $\sum_s w_s\, \sigma(u_s(a) - u_s(b))$ |

`prob_prefers` marginalizes $\theta$ **and** the weights **and** the
per-candidate lens choice, which is why it is the right thing to show on a bank
row: it is a predictive probability, not a point estimate's opinion.

## Serialization

`TastePosterior` serializes to JSON, and `weights` carries `#[serde(default)]`
so older persisted posteriors, written before reweighting existed, deserialize
to empty and are read as uniform.

The **observation log remains the source of truth**. A posterior snapshot is a
cache: it can always be recomputed from the log plus its
[standardizer](../features/standardization.md), and that is exactly what a
[profile](../persistence.md) stores.
