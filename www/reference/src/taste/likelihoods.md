# One utility, three likelihoods

<p class="lede">Every feedback mode conditions the same latent $u$. They differ only in
how an answer connects to it.</p>

All three enter as a **single `factor`** carrying the total weighted
log-likelihood, so from fugue's point of view the model has one observation
node regardless of how many kinds of feedback the log contains.

<figure class="viz" data-viz="likelihoods">
<figcaption><strong>One latent quantity, three ways of asking about it.</strong>
Move candidate A's utility and watch all three panels respond together. Drag τ
to see a strict session and a generous one; drag the star cutpoints to see why
★★★ means <em>between two cutpoints</em> rather than the number three. Squeeze
two cutpoints together and that rating nearly stops being reachable, which is
exactly what a rater who never uses the middle of the scale looks like to the
model.</figcaption>
</figure>

## Pairwise duels: Bradley–Terry

$$P(A \succ B) = \sigma\big(u(A) - u(B)\big)$$

```rust
Feedback::Duel { a, b, chose_a } => {
    let d = s.utility_mix(a) - s.utility_mix(b);
    log_sigmoid(if *chose_a { d } else { -d })
}
```

The primary signal: best statistical properties, lowest cognitive load. It
identifies $u$ up to an additive constant, which is exactly the right amount of
information: a preference relation does not have an origin, and pretending
otherwise is what makes absolute ratings drift.

Note that $u$ here is the **mixture** utility, so a duel across two islands
compares the drone's best style's rating with the pluck's best style's rating.
That this is well-formed is the whole reason for
[the max form](./utility.md#why-a-maximum).

`log_sigmoid` is computed stably as $-\mathrm{softplus}(-v)$ with
$\mathrm{softplus}(t) = \max(t,0) + \log(1 + e^{-|t|})$. The naive
$\log(1/(1+e^{-v}))$ underflows for moderately confident predictions, which is
exactly where a fitted model spends its time.

## Keep / kill: a thresholded Bernoulli

$$P(\text{keep}) = \sigma\big(u(x) - \tau_s\big), \qquad \tau_s \sim \mathcal{N}(0,1)$$

$\tau_s$ is a **per-session latent**, one per session in the log.

The app emits one side of it: a bank row's **cut** calls
`record_keep(id, false)` once its 7 s undo window closes (`UNDO_WINDOW_MS`, in
`main.js`'s `cutRow`).
Nothing emits a keep; the triage surfaces that would are unbuilt.

"Feeling picky today" is therefore *modeled* rather than treated as noise. A
session where the player cuts almost everything is read as a strict session (a
high $\tau_s$) rather than as a change in their taste. Without the per-session
threshold, a strict day and a generous day would average into a meaningless
global bar, and both days' data would be degraded by the other's.

One implementation subtlety: reweighting an old observation against a posterior
fitted *before* that session existed finds no $\tau_s$ site, and contributes
**zero** rather than guessing. No threshold site means no threshold evidence.

## Star ratings: a cumulative logit

$$P(y = k) = \sigma(c_k - u) - \sigma(c_{k-1} - u)$$

with 0-based cutpoints, $c_{-1} = -\infty$ (so the first term is 0) and
$c_{K_{\text{cat}}-1} = +\infty$ (so the last is 1). Six categories by default,
hence five cutpoints.

The code computes it in log space:

```rust
match (k == 0, k == n_cats - 1) {
    (true, true)   => 0.0,
    (true, false)  => log_sigmoid(a * (s.cuts[k] - u)),
    (false, true)  => log_sigmoid(-a * (s.cuts[k - 1] - u)),
    (false, false) => {
        let hi = log_sigmoid(a * (s.cuts[k] - u));
        let lo = log_sigmoid(a * (s.cuts[k - 1] - u));
        hi + (-(lo - hi).exp()).ln_1p()
    }
}
```

Subtracting two near-equal sigmoids used to bottom out at a floor of
$\ln 10^{-12} \approx -27.6$; in log space a rating far from $u$ scores its
real log-probability. The factor $a$ is 1 unless some of the observation's
coordinates were imputed ([below](#imputed-coordinates)).

This treats ★★★ as **"between two cutpoints"** rather than as the number 3,
which is the point. A rating is an ordinal judgment, and modeling it as a
real number asserts that the gap between 1 and 2 stars equals the gap between 4
and 5, which no rater believes.

Because the cutpoints are **fitted**, the model absorbs scale drift: a player
who becomes harsher moves the cutpoints, not $\theta$. Without that, a change in
rating habit would be indistinguishable from a change in taste.

### Enforcing the ordering

Cutpoints must be increasing. Rather than constrain the sampler, the model
samples unconstrained normals and transforms:

$$c_0 = -2 + 1.5\,r_0, \qquad c_j = c_{j-1} + \exp(-0.5 + 0.7\,r_j), \quad r_j \sim \mathcal{N}(0,1)$$

The exponential increments are positive by construction, so ordering holds for
**every** draw. No rejection, no constrained kernel, and the generic
single-site MH applies unchanged.

The constants place the prior sensibly: $c_0$ near $-2$ (so a 0-star rating
means "well below average"), and increments with a median of $e^{-0.5} \approx
0.61$ so the five cutpoints span a few units of utility.

## Imputed coordinates

An observation logged under an older feature set can lack some of the current
coordinates, and [persistence](../persistence.md#names-not-indices) imputes
them at the mean. A duel needs no correction: both sides carry the same
absence, so the imputed terms cancel in $u(A) - u(B)$. Keep/kill and stars
compare one $u$ with a fixed threshold, so there the model scales the
difference by

$$a = \frac{1}{\sqrt{1 + \pi \sigma^2 / 8}},$$

where $\sigma^2$ is the variance the imputed coordinates add to $u$ under the
draw: $\sum_i \theta_{k,i}^2$ over the imputed $i$, for the style $k$ that
scores the candidate. It is the logistic analogue of marginalizing a Gaussian
through a probit link. The observation still teaches, and stops claiming
certainty about a comparison that is partly guessed. With nothing imputed,
$a = 1$.

## Edit-beats-original

Not a fourth likelihood, but a **duel** with a provenance tag. Committing a
hand edit with *my edit is better* records `Duel { a: edited, b: original,
chose_a: true }`.

The tag is what makes the claim auditable. `Provenance` distinguishes:

| | |
|---|---|
| `Duel` | A dealt pair the player listened to |
| `HeardEdit` | An edit committed through a heard comparison |
| `SelfReport` | An edit committed by ticking the box |
| `PerformOffer` | A PERFORM offer heard against the sound being played, then taken (offer wins) or passed by asking for another (the played sound wins) |

These make the same claim in the log, and there is no reason to believe they
are equally reliable. [Calibration](./calibration.md#by-provenance) scores them
separately, which is the only way to find out rather than assume.

## Recency weighting

Every observation's log-likelihood is scaled before summing:

$$w_i = 0.5^{\,(n - 1 - i)/h}, \qquad h = 150$$

so the newest observation has weight 1 and one $h$ back has weight $\tfrac12$.
The default is `recency_half_life = Some(150.0)` (in `engine.rs`); `None`
disables forgetting entirely.

$$\log p(\mathcal{D} \mid \theta) = \sum_i w_i \, \log p(y_i \mid \theta)$$

Taste is allowed to change, and a model weighting a pick from three sessions
ago equally with one from a minute ago would fight the player when it did. The
cost is stated plainly: this is not a proper Bayesian posterior over a
stationary parameter, it is a tempered/discounted likelihood, chosen because
stationarity is the wrong assumption about a person.

## Implicit signals are logged, not modeled

Play counts, opening a pair's sound in PATCH, and the editor's stream of edits
and reverts are logged as `ImplicitEvent`s (`Engine::log_event`). **None of
them enters the likelihood.** Listen time and hover duration are not recorded
at all.

They are cheap to collect and easy to misread: a long listen can mean
fascination or confusion, and the two have opposite signs; a revert can be
curiosity. This version prefers less data that means what it says, and keeps
the log so a later fit can be validated against the explicit picks.

## Site count, and what it costs

The model has

$$K \cdot d + S + (n_{\text{stars}} - 1)$$

sample sites. With $d = 44$ and 6 star categories, that is $44K + S + 5$: **49
+ $S$** at $K=1$ and **225 + $S$** at $K=5$. (A fused prior over correlated
coordinates, built and off by default, would add $K$ sites per fused group.)

Single-site MH re-executes the whole program on **every step**, so every site
is reconstructed once per step. Two consequences, both measured by
`auracle-taste/examples/fit_bench.rs`:

- The fit is several times slower at the $K$ cap than at the first fit.
- The step budget is **fixed**, so a mature fit gets proportionally *fewer*
  sweeps per site than an early one. Growing $K$ makes the fit both slower and
  statistically thinner.

That is a real tension in the design, and it is why the
[address table is hoisted](./posterior.md#the-address-table) out of the step loop.
Building addresses inline cost a `format!`, a re-allocation and a SipHash **per
site per step**, which measured as the bulk of a mature fit's wall time.
