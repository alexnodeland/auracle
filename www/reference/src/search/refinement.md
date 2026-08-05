# Refinement — what ships

<p class="lede">The design is tempered sequential Monte Carlo. What ships is a short local
Metropolis–Hastings walk. This page is about the difference, because it is easy
to overstate.</p>

```admonish warning title="Design versus implementation"
The [design](../design/open-questions.md) describes generation as sampling from
$\pi_\beta \propto p_{\text{grammar}} \cdot e^{\beta \E[u_\theta]}$ by tempered SMC with a
crossover population kernel. **That is an intention, not a description of the code.**

What runs is a dozen-to-forty-step adaptive single-site MH walk warm-started from each of
the best pool members, keeping the final state: local hill-climbing *on* that
target, rather than a draw *from* it.
```

## What runs

`Engine::refine` is three lines over two primitives:

```rust
pub fn refine<R: Rng>(&mut self, rng: &mut R) {
    for parent_id in self.refine_begin() {
        self.refine_seed(rng, parent_id);
    }
}
```

**`refine_begin`** advances the generation counter and returns the top
`refine_seeds` candidates by posterior utility, best first. It returns
**empty** (and does *not* advance the counter) when there is no posterior or no
standardizer, because there is no direction to climb in.

**`refine_seed`** clones the seed's tree, walks `refine_steps` MH steps with no
locks, and injects the final state as a child. It returns `None` if the walk
was rejected or landed on a tree the pool already holds.

**`refine_from(seed_id, locked)`** is the same thing from an explicit seed with
an explicit [lock set](./locks.md), the `⚡ evolve from this` path.

Injection displaces the pool's lowest-utility member; pinned candidates are
exempt.

## The split is measured

Defaults, both scaled from the palette's operator count `N_OPS = 20`:

$$\text{refine\_steps} = 2 \cdot N_{\text{OPS}} = 40, \qquad
\text{refine\_seeds} = \lceil N_{\text{OPS}} / 2 \rceil = 10$$

Riding `N_OPS` matters: a structural proposal picks a new operator from a
categorical that grew from six to twenty kinds, so a fixed budget would spend
the same number of proposals covering a far wider move set and land children in
a visibly thinner slice of it. The tuning survives a palette change.

The 40 × 10 split was an *argument* that could have been wrong in either
direction, so `search_health --budget-ab` was written to settle it. Over 8
seeds, 6 generations, graded against a synthetic user's true utility:

| steps | seeds | proposals | mean $u$ | max $u$ | |
|---|---|---|---|---|---|
| **40** | **10** | **400** | **1.714** | **8.154** | shipped |
| 40 | 3 | 120 | 1.241 | 6.178 | same depth, fewer seeds |
| 66 | 3 | 198 | 0.774 | 6.281 | same total, fewer seeds |
| 20 | 20 | 400 | 0.568 | 6.790 | half depth, double breadth |

The shipped split wins on both metrics, and moving off it in **either**
direction is worse.

Two rows are worth more than the headline.

**Depth from few seeds is harmful.** 66 × 3 runs 65% *more* proposals than 40 ×
3 and scores *lower* (0.774 against 1.241). A long chain from a bad starting
point converges confidently on somewhere you did not want to be, and the extra
steps are what get it there.

**Breadth is not free either.** 20 × 20 spends the full shipped budget and is
the worst row of the four. Twenty steps is not enough for a chain to leave its
seed, so the generation is twenty barely-moved copies of the current top, which
is also why it has the second-best `max`: it preserves the frontier by never
straying from it.

Re-run this before changing either number.

## Why local climbing suits this anyway

The gap between design and implementation is real, but the implementation is
not merely a shortcut.

**A candidate pool is not a sample.** The pool's job is to hold a few dozen
patches worth auditioning. A correct sample from $\pi_\beta$ would include
low-utility regions in proportion to their (small but nonzero) probability
mass, which is right for estimating an expectation and wrong for filling a
shortlist a person will listen to.

**Warm-starting from the best members is deliberate.** It concentrates effort
where the model already believes, which is what "propose toward me" means from
the user's side.

**Diversity comes from elsewhere.** The measured result below is that the pool
does not concentrate over a session anyway, so the thing SMC would primarily
buy (maintained diversity via a population kernel) is being supplied by
frontier-biased injection plus worst-eviction.

What is lost: any claim about the *distribution* of the pool, and the tempering
schedule's ability to cross low-utility valleys between islands. A
single-island user will not notice; a user with two distant islands may find
that refinement from island A never discovers island B, and has to reach it by
hand or by the prior.

## The measured non-concentration

From the same harness, as a manipulation check that turned into a finding.

Final pool spread, measured as mean pairwise $\lVert \Delta \varphi \rVert$ on
the reference scale, was **7.7–7.9 evolving** versus **7.2 static**. Six
generations over a 72-duel session did not concentrate the pool at all; it
*widened* it slightly, because mutation pushes children into feature-space
extremes faster than eviction trims them.

That has two consequences, and one of them decided a default:

1. The diversity argument for SMC is weaker than expected at session horizon.
2. The concentrated regime that [BALD](./acquisition.md) was hypothesized to
   win in **never arises**, so the measured tie between BALD and uniform
   pairing is not an artifact of a spread pool that only the static setup
   guaranteed. The product's own dynamics keep the pool spread.

## The screening cascade

$\varphi_{\text{struct}}$ is free (no compile, no render) so a structure-only
surrogate can prune candidates before the expensive path. Survivors get
rendered and scored in full.

This is designed into the feature split and is why $\varphi$ is
[two-part](../features/structural.md) rather than one vector. In the refinement path
specifically, the affordability comes primarily from
[the render memo](./target.md#why-the-render-memo-matters) rather than from
screening, because the walk re-scores its own current state on every step.

## Lineage

Every injected child records a `LineageEvent`:

```rust
pub struct LineageEvent {
    pub kind: String,          // "refine" | "edit"
    pub parent_id: u64,
    pub child_id: u64,
    pub diff: Vec<DiffEntry>,  // what changed, in trace-address terms
    pub parent_utility: f64,   // posterior mean at event time
    pub child_utility: f64,
}
```

`tree_diff` produces the address-level diff, which the app renders as `attack
0.59→0.83, +noise, −distortion · Δtaste +0.65`.

Utilities are **recorded at event time**: a later refit changes the model, and
re-deriving these numbers afterwards would rewrite history to look
better-informed than it was.

Hand edits appear in the same log tagged `"edit"`, because the lineage is a
record of everything that produced a patch and not only of what the machine
did.
