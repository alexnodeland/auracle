# Proposals, and the taste tilt

<p class="lede">The loop closes here: what the model learns reshapes the grammar the
search walks — what it <em>proposes</em>, and, because the tilted grammar is
installed as the prior, what it <em>scores against</em> too.</p>

## Moves

Refinement uses fugue's **adaptive single-site MH** over the trace, so the move
set is whatever the trace machinery provides:

- **Parameter moves** perturb one continuous or discrete site.
- **Structural moves** regenerate a subtree, which changes the *set* of sites
  and is therefore a reversible-jump move. fugue handles the Jacobian
  bookkeeping; Auracle does not implement it.

The structural moves are the same lattice as
[hand edits](../genome/edits.md#hand-edits-and-mh-proposals-are-the-same-moves). One
vocabulary, two callers.

## The tilt

Once a posterior exists, the grammar's **categorical weights** are reshaped by
what it has learned:

$$w'_i \;\propto\; w_i \cdot \mathrm{clamp}\!\big(e^{\eta t_i},\ \tfrac14,\ 4\big)$$

then renormalized. `SessionConfig::proposal_tilt` is $\eta$, default **0.6**.

```rust
pub fn tilt_weights(base: &[f64], tilts: &[f64], eta: f64) -> Vec<f64> {
    let mut out: Vec<f64> = base.iter().zip(tilts)
        .map(|(w, t)| w * (eta * t).exp().clamp(0.25, 4.0))
        .collect();
    let sum: f64 = out.iter().sum();
    if sum > 0.0 { for w in &mut out { *w /= sum; } }
    out
}
```

The function is **pure**, which is why the taste→grammar mapping is testable
without an MCMC fit. That matters for a mapping this easy to get subtly wrong.

### The clamp

$[\tfrac14, 4]$ bounds every multiplier, so **no module kind is ever starved or
monopolized**.

<figure class="viz" data-viz="tilt">
<figcaption><strong>Hollow bars are the prior's own weights; filled bars are the
tilted ones.</strong> Raise η and the model's opinions start pushing kinds
around. Then turn the clamp off: the strongest coefficients drive their kinds
toward never being proposed at all. A prior that cannot <em>generate</em> an
option can never be argued back into it, because the evidence would have to
come from proposing it. Red is a multiplier sitting at a bound.</figcaption>
</figure>

Without it a confidently-fitted coefficient could drive a kind's proposal
weight to effectively zero, and the search would stop being able to *discover*
that it was wrong about that kind. A prior that has been argued out of
considering an option cannot be argued back in by evidence it can no longer
generate.

## Where $t_i$ comes from

`biased_prior` builds the tilt vector from the posterior, in three steps.

**1. Blend the lenses by their pool share.**

$$\bar\theta = \sum_k \text{share}_k \, \theta_k^{\text{mean}}, \qquad
\bar\sigma = \sum_k \text{share}_k \, \theta_k^{\text{sd}}$$

Share-weighted rather than uniform, so an idle lens (one claiming ≈0% of the
pool) contributes ≈nothing to how the search proposes. Uniform weighting would
let a lens with no evidence steer the search as hard as one with plenty.

**2. Shrink each coefficient by its own uncertainty.**

$$\mathrm{shrink}(\theta, \sigma) = \theta \cdot \frac{|\theta|}{|\theta| + \sigma}$$

| Regime | Factor |
|---|---|
| $\sigma \ll |\theta|$ | $\to 1$ — trust it |
| $\sigma = |\theta|$ | $\tfrac12$ |
| $\sigma \gg |\theta|$ | $\to 0$ — mostly prior, ignore it |

Same shape as a signal-to-noise weighting, and chosen over a hard significance
cut for a specifically *musical* reason: a cut makes the proposal distribution
**jump discontinuously** as evidence accumulates, and users hear that as the
instrument changing its mind. A smooth ramp is a model getting more
opinionated; a threshold crossing is a different instrument arriving
mid-session.

**3. Map coordinates to categorical slots.** The source-kind tilts read
`n_vco`, `n_supersaw`, `n_noise`, `n_wavetable`, `n_pluck`, `n_formant`
directly; processor and modulation tilts read their family coordinates.

### The `n_mix` reconstruction

[`n_mix` is not a column of $\varphi$](../features/structural.md#a-second-subtler-identity):
it was dropped to break an exact linear dependency.

But the search still needs *some* tilt for the mix production, and
`biased_prior` recovers it from the source coefficients. That is legitimate
precisely because of the identity that forced the drop: `n_mix` is determined
by the other counts, so information about it is present in what remains. The
dependency that made the column unusable as a *regressor* is what makes it
recoverable as a *tilt*.

## Why tilt rather than only score

A scored-only search is limited by what it happens to generate. If the prior
draws bitcrush into 2.5% of terms, then no matter how much the model likes
bitcrush, only 2.5% of proposals will contain one and the search has to wait
for luck.

Tilting the grammar means the search **looks where the model expects to find
things**. Combined with the clamp, it is a change of emphasis rather than a
change of support: every kind stays reachable, and the ones the model believes
in get proposed more often.

```admonish warning title="It is a prior tilt, not a proposal tilt"
This page used to say that tilting changes the *kernel*, not the target, and that the
stationary distribution is unchanged. **That was false**, and the September 2026 audit
(AU-G3) caught it. `biased_prior` builds the tilted grammar and installs it as the
**prior** of the `EvolutionModel`; fugue-evo's target is `prior.model() + factor(β·f)`,
and fugue's categorical proposal is a resample from that same prior, so the Hastings terms
cancel and the chain is a correct MH sampler for

$$\pi'(x) \;\propto\; p_{\text{tilted}}(x)\, e^{\beta\, \E[u_\theta(x)]},$$

which is a *different* target from $\pi_\beta$. The seed is scored under the same tilted
prior, `RefineKeep::Best` ranks under it, and the parsimony mass the walk climbs is the
tilted one. Nothing about that is unsound — MH is exact for $\pi'$ — but "what the search
is climbing" includes the tilt.

A true proposal tilt, one that leaves $\pi_\beta$ alone, would need a custom site proposal
carrying its own Hastings correction; fugue 0.2.2 offers only `PriorResample` for `usize`
sites, so it is not available without an upstream hook. Because refinement
[hill-climbs](./refinement.md) rather than samples, the practical effect is the one
intended — the climb finds the kinds the listener likes sooner — and the field keeps its
name (`SessionConfig::proposal_tilt`) since the app and the harness both set it. What
changed is the claim, not the code.
```

## Structural taste, specifically

Note that the tilt reads the **structural** coefficients. That is a deliberate
asymmetry: $\varphi_{\text{struct}}$ coordinates map onto grammar productions
more or less directly (`n_filter` ↔ the filter production), whereas an audio
coefficient like `centroid_mean` has no single production to point at.
Brightness is a property of the composition, not of a module.

So the audio half of $\theta$ influences the search only through the fitness
factor, and the structural half through both the fitness factor and the tilted
prior. Turning
`centroid_mean` into a proposal tilt would require a model of which productions
raise brightness, which is a model nobody has fitted.
