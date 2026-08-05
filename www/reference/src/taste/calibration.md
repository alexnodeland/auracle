# Calibration

<p class="lede">Every duel is forecast before it is answered. This page is how those
forecasts are scored, and why the obvious metric would have lied.</p>

## Prequential by construction

`record_duel` scores the posterior's $P(A \text{ wins})$ **and only then** appends the
observation. So every forecast is a genuine out-of-sample, one-step-ahead prediction —
the model has never seen the answer it is being scored on.

That part was always right. What was done with them was not.

## Why not accuracy

A running count of $p > 0.5$ outcomes is **accuracy**, and accuracy is not a proper
scoring rule. Two failures, and the second is fatal here:

**It cannot see sharpness.** A model that says 0.51 every time and is right 51% of the
time scores identically to one that says 0.99 and is right 51% of the time. The second
is wildly overconfident and accuracy cannot tell you.

**It is pinned near 50% by the acquisition rule.** An information-seeking rule
*deliberately* picks pairs near $p = 0.5$, because those are the questions worth asking.
So the hit rate sits near chance **by construction** — a perfectly calibrated model looks
like a coin flip, and the user concludes it is not learning.

<figure class="viz" data-viz="reliability">
<figcaption><strong>Four hundred real forecasts, scored.</strong> Move the
confidence dial to make the forecaster over- or under-claim and watch the dots
leave the diagonal. Then press <em>ask only near-ties</em>: the hit rate drops to
around 50% and stays there <em>however good the model is</em>, because that is
what asking hard questions does to a coin-flip tally. The skill score keeps
moving, which is the whole reason it is the one on display.</figcaption>
</figure>

The second point is what makes accuracy actively harmful rather than merely crude: the
metric penalizes the search for doing its job.

`hit_rate` is still computed and shown, **only** so the interface can display how
misleading it is next to the real number.

## Brier score and skill

$$B = \frac{1}{n}\sum_{i} \big(p_i^{\text{chosen}} - 1\big)^2$$

where $p^{\text{chosen}}$ is the probability the model gave to the option the user
actually picked. Lower is better; $B = 0.25$ is what always saying 0.5 scores.

Reported as **skill** against that baseline:

$$\text{skill} = 1 - \frac{B}{0.25}$$

| skill | Means |
|---|---|
| $0$ | No better than a coin flip |
| $1$ | Perfect and certain |
| $< 0$ | Worse than a coin |

Brier is proper and bounded, and it **moves as sharpness improves** rather than only as
accuracy does — which is exactly the property accuracy lacked.

## Log-loss, and what it may not be compared across

$$\text{LL} = \frac{1}{n}\sum_i -\log p_i^{\text{chosen}} \quad \text{(nats)}$$

Baseline $\log 2 \approx 0.693$.

Comparable across **time** for one acquisition rule. **Not** comparable across
acquisition rules — an information-seeking rule serves duels near $p = 0.5$, which carry
the highest log-loss by construction. Comparing two rules on their own self-chosen
question sets would score *the willingness to ask hard questions* as a failure.

`check_log_loss` is the version for that comparison. See below.

## The selection-bias fix

The acquisition function chooses which duels get scored, which means overall skill is
measured on a question set the model helped select. That is circular.

So a fraction of duels are **drawn uniformly at random** and flagged
`Forecast::random_check` — the app marks them **◇ unbiased probe**. Calibration
restricted to those is unbiased:

| Field | Is |
|---|---|
| `check_n` | Number of random-probe forecasts |
| `check_skill` | Brier skill on them — the number without an asterisk |
| `check_log_loss` | Log-loss on them — the only log-loss comparable across rules |

It costs a small share of the query budget and it is the only number here that means what
it says unqualified.

```admonish note title="With the default rule, every duel is a probe"
The shipped default acquisition is **uniform random pairing**, so every duel is already
an unbiased sample and `check_skill` equals overall skill. The probe machinery exists
for the BALD rule, where the distinction is real — and it is one of the reasons uniform
pairing was chosen. See [Acquisition](../search/acquisition.md).
```

## The reliability diagram

Five buckets over $P(A \text{ wins})$ — `N_BINS = 5`, the most a small session can fill
without every bucket being noise. Each bucket reports:

| | |
|---|---|
| `predicted` | Mean forecast in the bucket — the model's claim |
| `observed` | Observed frequency of "A won" — the evidence |
| `n` | How many forecasts landed here |

Plotted, the diagonal is the claim and the dots are the reality. This is the display that
makes calibration *legible* — a single number cannot distinguish "overconfident at the
top end" from "underconfident in the middle", and the shape of the failure is what tells
you what to do about it.

The app draws a whisker per bucket for how much a bucket that size could wobble by
chance, so a dot off the diagonal with a whisker crossing it is not yet evidence of
anything.

## By provenance

The same scores, split by how the answer was collected:

```rust
pub struct ProvenanceScore {
    pub provenance: String,  // "duel" | "heard_edit" | "self_report"
    pub n: usize,
    pub brier: f64,
    pub log_loss: f64,
    pub skill: f64,
}
```

The comparison this exists for: a hand edit committed through a **heard** duel and one
committed by ticking *my edit is better* make the same claim in the log, and there is no
reason to believe they are equally reliable. Scoring them against forecasts the model
made *before* either answer arrived is the only way to find out which — and it costs one
tag.

Empty streams are omitted, so a session that has never committed a hand edit carries
exactly one row and reads as it always did.

## Interpreting it

| Shape | Reading |
|---|---|
| Skill ≈ 0, small $n$ | Too early. Correct and expected |
| Skill < 0 with real $n$ | Worse than chance — either overfitting a coincidental coordinate, or genuinely inconsistent answers |
| Dots below the diagonal on the right | Overconfident: when it says 80% it is right less often |
| Dots above on the left | Underconfident |
| Skill stuck near 0 with large $n$ | The preference is probably [not in the feature space](../../docs/teaching.html#what-it-cannot-learn) |

The user-facing version of this table is in
[Reading what it learned](../../docs/reading-the-model.html).

## Why this page matters more than it looks

Almost every system that claims to learn preferences shows a confidence number it cannot
justify. Committing to a forecast before each answer and then reporting error against a
proper scoring rule means the model **can publicly fail** — and a low score early is the
mechanism working.

That is the price of the number meaning anything at all, and it is why the app shows
"not beating a coin flip yet" rather than hiding the metric until it flatters.
