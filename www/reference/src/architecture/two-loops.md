# The two loops

<p class="lede">A machine-paced loop and a human-paced loop, sharing one
observation stream.</p>

```text
┌─ patch loop (fast, silent, machine-paced) ─────────────────┐
│  grammar prior → vet → pool                                │
│  local MH toward π_β: subtree moves → struct-screen →       │
│  render survivors → feature-score                          │
└──────────────┬─────────────────────────────────────────────┘
               │ candidate pool (`pool_size`: 48 by default, 40 in the app)
               ▼
   acquisition: choose what to play
   (uniform by default; BALD selectable)
               │ audition + feedback events
               ▼
┌─ taste loop (slow, human-paced, persistent) ───────────────┐
│  observe events → posterior over (θ, τ, cutpoints)         │
│  persisted across sessions = the user model                │
└──────────────┬─────────────────────────────────────────────┘
               │ θ reshapes the prior's proposal weights
               └──────────────► back into the patch loop
```

The two loops run at different speeds on purpose. The machine can evaluate
thousands of candidates against a learned surrogate silently, and surface only
a curated few. That addresses interactive evolution’s classic failure mode: the
human bottleneck, where a user is asked to rate a whole population per
generation and quits from fatigue.

<figure class="viz" data-viz="two-loops">
<figcaption><strong>The same diagram, with the traffic moving.</strong> What the
ASCII version above cannot show is that the two loops run at <em>different
speeds</em>. Green flows continuously with no human in it; amber moves at the
pace of the player’s picks.</figcaption>
</figure>

## The patch loop

Machine-paced. No human in it.

1. **Fill.** Sample terms from the grammar prior, compile, render, vet,
   featurize. The pool target is `SessionConfig::pool_size` vetted candidates
   (**48** by default in `engine.rs`; the web app passes **40** in
   `apps/web/main.js`), with at most `max_draws` (400) draws attempted per
   fill, since vet failures burn attempts.
2. **Refine.** Once a posterior exists, take the top `refine_seeds` candidates
   and run `refine_steps` Metropolis–Hastings steps from each. The defaults in
   `engine.rs` are **10 seeds × 40 steps**, both scaled from the grammar’s
   processor count (`N_OPS`, 20, in `prior.rs`), so a change to the processor
   set does not silently change the search’s character.
3. **Inject.** Each child is admitted only if it beats the member it would
   displace. When the generation ends, the lowest-utility members are replaced
   to bring the pool back to size. Pinned (saved) candidates are exempt,
   including ones pinned while the generation runs.

The 10 × 40 split is
[measured](../search/refinement.md#the-split-is-measured); moving in either
direction is worse.

## The taste loop

Human-paced, and persistent across sessions.

1. **Observe.** Every duel (an EVOLVE pair, a heard PERFORM offer, or an edit
   claim), star, and cut appends to the observation log, as **raw** $\varphi$,
   never standardized. That is what lets
   the standardizer be re-fit later without invalidating history.
2. **Reweight**, immediately. Each new observation folds into the existing
   posterior by importance sampling. It is exact, costs time linear in the
   number of posterior draws, and is what makes the next pair respond to the
   last pick.
3. **Refit**, every sixth pick. Full MCMC over the log: 10,000 post-warmup
   steps (`mcmc_samples`) after 3,000 warmup steps (`mcmc_warmup`), thinned to
   at most 500 retained draws (`KEEP`, in `auracle-taste`’s `model.rs`).

The app paces refits by count: every sixth pick refits (`FIT_EVERY`, 6, in
`apps/web/main.js`). The engine also reports when the cheap path has run out of
road, that is, when the reweighted posterior’s **effective sample size** has
collapsed far enough to need resampling since the last fit
(`Engine::needs_refit`). The app does not wait for that signal. See
[The posterior](../taste/posterior.md#the-refit-trigger).

## Where they meet

**Acquisition** picks the pair the player hears next. **The taste tilt** carries $\theta$
back into the grammar.

The tilt is the part that makes this more than a scored search. The fitted
structural coefficients reshape the *categorical weights* of the grammar the
search draws new modules from. Because the tilted grammar is installed as the
prior, they also reshape the target the search climbs (see
[Proposals](../search/proposals.md)). Kind $i$’s weight $w_i$ is multiplied by
$e^{\eta t_i}$, where $t_i$ is the fitted coefficient for that kind and $\eta$
is the tilt strength (`proposal_tilt`, 0.6, in `engine.rs`):

$$w'_i \;\propto\; w_i \exp(\eta\, t_i)$$

with each multiplier clamped to $[\tfrac14, 4]$ so no module kind is ever
starved or monopolized. Details and the shrinkage applied to $t_i$ are in
[Proposals](../search/proposals.md).

So the loop is closed: the player’s picks change what gets *proposed* and what
the search counts as parsimonious, not only what scores well once proposed.

## Why this is preferential Bayesian optimization

There is a latent objective (the player’s utility), an expensive oracle (the
player), a cheap surrogate (the posterior), and a generator of candidates (the
grammar prior plus MH). The acquisition step is where $\theta$’s posterior
*uncertainty* would earn its keep: early sessions could ask informative
questions (duels the model cannot rank), and a confident model could mostly
serve sounds it predicts the player will pick.

Whether it is *worth* asking informative questions rather than random ones is
an empirical question. See [Acquisition](../search/acquisition.md).

## The gate on all of it

`auracle-session`’s closed-loop test runs the engine against a `SyntheticUser`
with known ground-truth $\theta^*$, end to end through the **real** grammar →
render → vet → feature pipeline, and asserts that the learned taste ranks
genuinely preferred patches on top.

It is slow, and it is the only test that can fail when the *loop* is broken
while every component is individually correct.
