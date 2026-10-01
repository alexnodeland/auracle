# Utility as a max of experts

<p class="lede">A candidate is as good as its best style thinks it is. Two more
obvious designs cannot represent a cross-island comparison at all.</p>

<!-- film:math -->
<figure class="film" id="film-math">
<video controls preload="none" playsinline poster="../../assets/film/math.jpg">
<source src="../../assets/film/math.mp4" type="video/mp4">
<track kind="captions" src="../../assets/film/math.vtt" srclang="en" label="English" default>
</video>
<figcaption>For a technical audience: the taste model and the search as the code computes them, and why each piece has the form it does. <span class="film-len">2:46</span> · <a href="../../docs/films.html#film-math">chapters and transcript</a></figcaption>
</figure>
<!-- /film:math -->

## The form

A candidate $x$ has the feature vector $\varphi(x)$, which the
[standardizer](../features/standardization.md) maps to $z(x)$ with per-feature
means $\mu$ and scales $s$. The taste model holds $K$ **styles**, and style $k$
is a weight vector $\theta_k$: a linear functional on $z$. Utility is the
**maximum** over styles, not a weighted mixture:

$$u(x) = \max_{k \in 1..K} \; \theta_k^\top z(x), \qquad z(x) = \frac{\varphi(x) - \mu}{s}$$

At $K = 1$ this reduces *exactly* to Bayesian linear regression on $z$, which
is a useful property: the mixture is a strict generalization with no
special-casing at the boundary.

One posterior draw's utility (`TasteSample::utility_mix`):

```rust
pub fn utility_mix(&self, phi: &[f64]) -> f64 {
    self.theta.iter()
        .map(|t| dot(t, phi))
        .fold(f64::NEG_INFINITY, f64::max)
}
```

## Why a maximum

Taste is **multi-modal**. One person can love dark drones *and* bright plucks
("ambient-me" and "acid-me"), and those are not points on one axis. A single
linear utility would average them into a preference for neither, and would then
be confidently wrong about both.

The max form gives each island its own style, and every judgment, **including
a duel across two islands**, compares candidates on the shared scale
$u = \max_k u_k$. A dark drone and a bright pluck are both scored, each by
whichever style rates it highest, and the comparison is well-formed.

<figure class="viz" data-viz="max-experts">
<figcaption><strong>Drag either arrow.</strong> Each arrow is a lens (a style):
one direction in feature space. Each candidate is colored by the style that
scores it highest and lit by how highly, the same encoding the instrument's
taste map uses. Pull the arrows apart and two islands appear, each with its own
idea of what "good" points at. Then press <em>compare K = 1</em>:
one direction has to explain both islands at once, and the only direction that
does lies between them, describing a taste nobody has.</figcaption>
</figure>

## Two rejected designs, and why

### A per-session style latent $z_s$

*"One mood per session: sample which style is active, then use it."*

Fails because it cannot represent several islands **inside** a session. A user
who auditions a pad, then a bass, then a pad in one sitting is not switching
moods; they have two tastes at once. Whenever the session's latent is wrong
for the current candidate, every observation in that session is scored by the
wrong style.

### A per-observation marginalized style

*"Marginalize over which style judges each observation."*

Fails on a sharper point: it forces **both duel items through the same style**,
so a cross-island comparison is unrepresentable. There is no style under which
"the drone beats the pluck" is a sensible statement if the drone lives in style
1 and the pluck in style 2, and a duel between them is exactly the question the
acquisition rule will ask.

This is not a theoretical objection. A synthetic bimodal user exposed it: the
marginalized mixture **failed to beat $K = 1$**. Adding capacity made the model
no better, which is the signature of capacity the likelihood cannot use.

### What max-utility buys structurally

**There are no discrete latent sites at all.** No style assignment to sample,
no categorical variables, no label-switching *during* inference to fight. Every
site in the model is an `f64`, which means fugue's generic adaptive single-site
MH applies unchanged, with no custom kernel and no Rao-Blackwellization.

Label permutation is resolved **post hoc** instead, by
[`TastePosterior::aligned`](./posterior.md#label-alignment).

## $K$ is an upper bound, not a claim

$K = 5$ by default (`SessionConfig::k_styles`, in `engine.rs`), and the fitted
number of *live* styles grows with evidence.

Nothing enforces that; it falls out. A style with no evidence to explain stays
near its prior, and `style_share` reports what fraction of the pool each style
actually claims as its best. **A style claiming ≈0% is idle**: the player's
taste has fewer islands than $K$, and the app dims it rather than inventing a
name for it.

So $K$ is capacity, and the data decides how much gets used.

## The prior, and the correction $K$ forces

$$\theta_{k,j} \sim \mathcal{N}(0, \sigma_\theta^2), \qquad
\sigma_\theta = \frac{1}{\sqrt{d}\; s_K}$$

The $1/\sqrt{d}$ factor is standard: with $\lVert z \rVert^2 \approx d$ for a
standardized vector, it makes the prior utility of a candidate roughly
unit-variance, so likelihood scales stay sane at any feature count.

The $s_K$ factor is the correction the max form forces, and it is easy to miss.

Under the prior each $u_k$ is marginally $\mathcal{N}(0,1)$, so $u = \max_k
u_k$ is **the maximum of $K$ iid standard normals**, whose standard deviation
*falls* with $K$ (`MAX_NORMAL_SD`, in `auracle-taste`'s `model.rs`):

| $K$ | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| $s_K$ | 1.000 | 0.826 | 0.748 | 0.701 | 0.669 |

The mean shift cancels in duels (both sides shift equally) and is absorbed by
$\tau$ and the cutpoints elsewhere. **The variance shrinkage does not cancel.**
Left uncorrected, $\mathrm{Var}(u_a - u_b)$ drops from 2.0 at $K=1$ to 0.90 at
$K=5$, so growing $K$ mid-session would quietly make the model *less* able to
express a strong preference.

That is the opposite of what adding capacity should do, and a player would meet
it as a model that grows vaguer the longer they play.

Dividing by $s_K$ restores invariance: $\mathrm{Var}(u_a - u_b)$ is the same at
every $K$.

## What the interface reads off this

| Quantity | Is |
|---|---|
| `utility_mix(z)` | $(\text{mean}, \text{sd})$ of $u$ over posterior draws: the glow and size on the taste map |
| `utility(z, k)` | Style $k$'s rating specifically |
| `best_style(z)` | Which style claims this candidate: the hue on the map |
| `responsibilities(z)` | Posterior probability that each style is the best one for this candidate |
| `style_share(pool)` | Per-style share of the pool, averaged over candidates |
| `prob_prefers(a, b)` | $\E_\theta\,[\sigma(u(a) - u(b))]$: the forecast the app shows for a pair |

`responsibilities` is a posterior distribution over *which* style applies, which
is strictly more informative than an argmax and is what lets a candidate sit
visibly between two islands.
