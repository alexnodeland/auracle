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
chain applies with no custom kernel. Adaptation tunes per-site proposal scales during
warmup.

Each MH step moves **one** site, so a useful way to budget is
$\text{steps} \approx \text{sites} \times \text{desired effective sweeps}$. At $K=5$,
$205 + S$ sites over 10 000 steps is roughly 48 sweeps per site — which is thin, and
is the tension noted in
[site count](./likelihoods.md#site-count-and-what-it-costs).

The result is uniformly weighted:

```rust
TastePosterior { cfg, samples, weights: vec![1.0 / n; n] }
```

### The address table

`SiteAddrs::new` builds every site address **once** per fit, and the model clones
`Address` (an `Arc` refcount bump plus a cached hash) into each node.

This is not micro-optimization. Building addresses inline —
`addr!(format!("theta{k}"), i)` — cost a `format!` into a `String`, a re-allocation into
`Arc<str>` and a SipHash of that string, **per site per step**: roughly 3.7 M
allocations per mature fit, and measurably the bulk of the fit's wall time
(`examples/fit_bench.rs`; the fit is `steps × sites`-shaped and the likelihood is only
~20% of it even at 100 observations).

The addresses are a pure function of $(K, d, n_{\text{stars}}, S)$, none of which move
during a fit. And they are produced by the *same* `addr!` invocations as before, so
traces, serialized posteriors and warm-start paths see byte-identical addresses.

### A known waste, and why it is not fixed here

97% of the chain is discarded one line after it is built.

`adaptive_mcmc_chain` **materializes every step** — it pushes `(TasteSample, Trace)` per
iteration into a `Vec` it returns by value — and only then does `step_by(stride)` keep
every 20th. At $K = 5$ that is ~10 000 `Trace` clones of 205 `BTreeMap` entries each,
held live at once: hundreds of megabytes of transient wasm32 heap for 500 surviving
draws. On mobile Safari that is a plausible OOM rather than mere waste.

This **cannot be fixed on the Auracle side.** The retention is inside fugue's chain
driver, and the pieces needed to reimplement that driver here with identical RNG
consumption — `single_site_mh_step`, `propose_and_score`,
`SingleSiteProposalHandler` — are private or `pub(crate)` in fugue-ppl 0.2.1. Forking
fugue's inference core into this crate would trade a memory spike for a correctness
hazard on every upgrade.

The fugue-side API that would close it is small and additive: a `thin: usize` parameter
(or an `FnMut(&A, &Trace)` sink) on `adaptive_mcmc_chain`, pushing only when
`i % thin == 0`. The chain's arithmetic and RNG draws are untouched by it, so the
surviving draws stay bit-identical — it only stops retaining the ones that were always
going to be dropped.

Until then the peak scales with `n_samples`, which is why bringing that default down
from 30 000 to 10 000 was a 3× memory win as well as a 3× time win.

## Between fits: sequential importance sampling

A full fit costs seconds and cannot run after every vote. So each new observation is
folded into the existing draws by reweighting:

$$w_s \;\leftarrow\; \frac{w_s \, p(y \mid \theta_s)}{\sum_{s'} w_{s'} \, p(y \mid \theta_{s'})}$$

```rust
let m = ll.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
let mut w: Vec<f64> = (0..n).map(|i| self.weight(i) * (ll[i] - m).exp()).collect();
```

This is **exact** — the weighted draws target the updated posterior — and it costs
$O(S)$. It is what makes each duel respond to the one before it; without it the
acquisition rule reads a frozen posterior and re-asks the same question until the next
full fit.

The max-shift before exponentiating is the usual guard. Log-likelihoods here are bounded
above by 0, so it is not strictly needed for duels, but it keeps mixed modalities safe.

### Effective sample size

$$\mathrm{ESS} = \frac{1}{\sum_s w_s^2}$$

Equals the draw count for uniform weights, and collapses toward 1 as weights
concentrate.

This is the honest part of the design: importance weights **degenerate**, and ESS says
so rather than letting the posterior quietly become one point wearing 500 hats. It is
the trigger for paying for a real refit.

### Systematic resampling

When weights have concentrated far enough, `resampled()` draws the weighted set back to
a uniformly weighted one of the same size.

The trade is honest: resampling produces **duplicate draws**, so the sample is
impoverished but still spans the posterior's support — and ESS on the fresh uniform
weights no longer *claims* more information than is there. Left unresampled, almost all
the mass sits on one draw, and a "posterior" of one point tells the acquisition function
it is certain when it is merely exhausted.

It is a stopgap between full refits, not a substitute for one.

Deterministic (systematic, offset $\tfrac{1}{2N}$) rather than multinomial, because
every other stochastic step in the engine is seeded and reproducible and this one has no
reason not to be.

### The refit trigger

```rust
pub fn needs_refit(&self) -> bool {
    match &self.posterior {
        Some(_) => self.resamples_since_fit > 0,
        None => !self.log.is_empty(),
    }
}
```

So the condition is not "every $n$ duels" — it is **"we have had to resample at least
once since the last real fit"**, i.e. the cheap path has provably run out of road. The
app surfaces this as the teaching meter and the wordmark's listening lamp; a refit
happens at most every six duels, and only when this says so.

## Label alignment

Mixture posteriors are permutation-symmetric in the style labels (label switching), so
per-style summaries are meaningless on a raw posterior.

`aligned()` resolves it post hoc, in two passes:

1. Relabel every sample to best match a reference — the last sample — maximizing total
   $\theta$ **cosine similarity** across lenses.
2. Recompute the mean of the pass-1 result and relabel against that.

Alignment is **exhaustive over permutations**, which is fine because $K \le 5$ and
$5! = 120$. No-op at $K = 1$.

Call it before `theta_mean`, `theta_std`, `style_share` or anything else per-style.
Aggregate quantities — `utility_mix`, `prob_prefers` — are permutation-invariant and do
not need it.

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

`prob_prefers` marginalizes $\theta$ **and** the weights **and** the per-candidate lens
choice, which is why it is the right thing to show on a bank row: it is a predictive
probability, not a point estimate's opinion.

## Serialization

`TastePosterior` serializes to JSON, and `weights` carries `#[serde(default)]` so older
persisted posteriors — written before reweighting existed — deserialize to empty and are
read as uniform.

The **observation log remains the source of truth**. A posterior snapshot is a cache: it
can always be recomputed from the log plus its
[standardizer](../features/standardization.md), and that is exactly what a
[profile](../persistence.md) stores.
