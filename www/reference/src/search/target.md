# The Boltzmann target

<p class="lede">One distribution, two factors: the grammar supplies parsimony, the
learned taste supplies direction, and $\beta$ is the single dial between them.</p>

## The target

$$\pi_\beta(x) \;\propto\; p_{\text{grammar}}(x)\;\exp\!\big(\beta \cdot \E[u_\theta(\varphi(x))]\big)$$

This is fugue-evo's `EvolutionModel` with the learned utility plugged in as fitness, so
the whole thing becomes an ordinary probabilistic program and typed-MH / SMC drivers
apply unchanged.

## What each factor does

**$p_{\text{grammar}}(x)$ is the parsimony pressure.** Not a penalty term — the actual
prior probability of the term under the
[typed PCFG](../genome/grammar.md#parsimony-is-the-prior-not-a-penalty). Deeper terms pay
more prior mass by construction, because each extra level multiplies in another Bernoulli
that came out "processor" plus that node's own parameter draws.

This is worth contrasting with the norm. Ad-hoc size penalties in genetic programming need
tuning, interact badly with fitness scaling, and leave the target distribution as
something nobody has written down. Here the target *is* written down, and the parsimony
term is a probability rather than a hyperparameter.

**$\exp(\beta \E[u_\theta])$ is the direction.** The expectation is over the posterior, so
the search climbs the model's *mean* belief and is not seduced by a single confident-looking
draw.

## $\beta$

`SessionConfig::beta`, default **2.0**.

| $\beta$ | Behaviour |
|---|---|
| $\to 0$ | Browse the prior. The taste model is ignored |
| $2.0$ | Shipped default |
| large | Optimizer mode — "give me your best guess at my perfect patch" |

One dial for conservatism, which is the practical payoff of writing the target down: there
is no explore/exploit schedule to tune, no diversity term, no niching parameter. Tempering
the same target is also how tempered SMC would work if it were wired up.

## Fitness through the surrogate

`SurrogateFitness` is the bridge:

```rust
impl Fitness for SurrogateFitness {
    fn evaluate(&self, genome: &PatchTree) -> f64 {
        match featurize_memo(genome, &self.phrase, &self.memo, false) {
            Ok((cf, _)) => {
                let phi = self.standardizer.transform(&cf.features.phi());
                self.posterior.utility_mix(&phi).0
            }
            Err(_) => QUARANTINE_FITNESS,
        }
    }
}
```

Three things in nine lines:

**Quarantine is a fitness, not just a filter.** `QUARANTINE_FITNESS = -50.0`, so a
pathological candidate contributes a large negative factor to the target and the search
**learns to avoid the region** rather than repeatedly sampling it. That is
[safety layer 2](../audition/vetting.md#quarantine-is-not-just-hiding); hiding alone would
leave the search wasting budget somewhere it cannot see is bad.

**The standardizer must be the one the observations were made under.** $\theta$ is
meaningless against any other scaling — see
[Standardization](../features/standardization.md#it-persists-with-the-profile-always).

**`want_audio: false`.** The surrogate only ever wants $\varphi$; nothing in a refinement
generation is played. Asking for samples would undo the memo — a miss would convert 141k
`f64`s it then drops, and a hit would copy a ~565 KB buffer out of the audio tier. Twice
per MH step, ~96 times per seed, that is tens of megabytes of churn for a value discarded
on the next line.

## The memo is not an optimization detail

It is what makes the walk affordable at all.

`adaptive_single_site_mh` executes the model **twice per step**: once to re-score the
current trace — which is bit-identically the tree the previous step accepted, and therefore
already featurized — and once for the proposal. Without a memo, **one render in two is a
recomputation of a number the walk already has.**

At ~600 ms per render, a 40-step walk from each of 10 seeds is 800 renders without the
memo and 400 with it. That is the difference between a generation taking half a minute and
taking a minute, per generation, forever.

## What is not sampled from this

Stated plainly because it is the most overstatable claim in the project:

**What ships is not a sample from $\pi_\beta$.** Refinement runs a short adaptive
single-site MH walk warm-started from each of the best pool members and keeps the final
state — local hill-climbing *on* that target, which is what a candidate pool needs, rather
than a draw *from* it.

Tempered SMC with the crossover population kernel remains the design. The distinction, and
why local climbing is arguably the right thing for this product anyway, is
[Refinement](./refinement.md).
