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

The two loops run at different speeds on purpose, and the asymmetry is the whole
reason the design works: the machine can evaluate thousands of candidates against a
learned surrogate silently, and surface only a curated few. That is the answer to
interactive evolution's classic failure mode — the human bottleneck, where a user
is asked to rate a whole population per generation and quits from fatigue.

<figure class="viz" data-viz="two-loops">
<figcaption><strong>The same diagram, with the traffic moving.</strong> What the
ASCII version above cannot show is the thing that matters most: the two loops run
at <em>different speeds</em>. Green flows continuously with no human in it; amber
moves at the pace you answer questions.</figcaption>
</figure>

## The patch loop

Machine-paced. No human in it.

1. **Fill.** Sample terms from the grammar prior, compile, render, vet, featurize.
   Pool target is `SessionConfig::pool_size` vetted candidates — **48** by
   default, though the web app passes **40** (`apps/web/main.js`) — with at most
   400 draws attempted per fill, since vet failures burn attempts.
2. **Refine.** Once a posterior exists, take the top
   `refine_seeds` candidates and run `refine_steps` Metropolis–Hastings steps from
   each. Defaults are **10 seeds × 40 steps**, both scaled from the palette's
   operator count so a palette change does not silently change the search's
   character.
3. **Inject.** Each surviving child displaces the pool's lowest-utility member.
   Pinned candidates are exempt.

The 10 × 40 split is [measured, not argued](../search/refinement.md#the-split-is-measured) —
and it is a genuine optimum, with moving in *either* direction worse.

## The taste loop

Human-paced, and persistent across sessions.

1. **Observe.** Every duel, star, keep/kill and edit claim appends to the
   observation log — as **raw** $\varphi$, never standardized. That is what lets the
   standardizer be re-fit later without invalidating history.
2. **Reweight**, immediately. Each new observation folds into the existing
   posterior by importance sampling. Exact, $O(S)$, and it is what makes the next
   question respond to the last answer.
3. **Refit**, occasionally. Full MCMC over the log — 10 000 post-warmup steps after
   3 000 warmup, thinned to at most 500 retained draws.

The refit trigger is the interesting part. It is not "every $n$ duels": it fires
when the reweighted posterior's **effective sample size** has degraded far enough
that resampling was needed. See
[The posterior](../taste/posterior.md#between-fits-sequential-importance-sampling).

## Where they meet

**Acquisition** picks what to show you. **The proposal tilt** carries $\theta$ back
into the grammar.

The tilt is the part that makes this more than a scored search. The fitted
structural coefficients reshape the *categorical proposal weights* the search draws
new modules from:

$$w'_i \;\propto\; w_i \exp(\eta\, t_i)$$

with each multiplier clamped to $[\tfrac14, 4]$ so no module kind is ever starved
or monopolized. Details and the shrinkage applied to $t_i$ are in
[Proposals](../search/proposals.md).

So the loop is genuinely closed: your answers change what gets *proposed*, not only
what scores well once proposed.

## Why this is preferential Bayesian optimization

Because that is what it is. There is a latent objective (your utility), an
expensive oracle (you), a cheap surrogate (the posterior), and a generator of
candidates (the grammar prior plus MH). The acquisition step is where $\theta$'s
posterior *uncertainty* earns its keep: early sessions can ask informative
questions — duels the model cannot rank — and a confident model can mostly serve
things you will like.

Whether it is *worth* asking informative questions rather than random ones turned
out to be an empirical question with a surprising answer. See
[Acquisition](../search/acquisition.md).

## The gate on all of it

`auracle-session`'s closed-loop test runs the engine against a `SyntheticUser` with
known ground-truth $\theta^*$, end to end through the **real** grammar → render →
vet → feature pipeline, and asserts that the learned taste ranks genuinely
preferred patches on top.

It is slow and it is the most valuable test in the workspace: it is the only one
that can fail when the *loop* is broken while every component is individually
correct.
