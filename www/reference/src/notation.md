# Notation

Fixed throughout. Where a symbol appears in the code under a different name, the
code's name is given.

## Objects

| Symbol | Is | In the code |
|---|---|---|
| $x$ | A patch **term** — a tree in the typed grammar | `PatchTree` |
| $p$ | A tree **path**, e.g. `node/0/1` | path keys |
| $t$ | A **trace** — the execution record of the grammar program | `fugue::Trace` |
| $\varphi(x) \in \R^{40}$ | The feature vector of $x$ | `Features::phi()` |
| $\varphi_{\text{audio}} \in \R^{15}$ | Perceptual descriptors of the render | `AudioFeatures` |
| $\varphi_{\text{struct}} \in \R^{25}$ | Structural descriptors of the term | `StructFeatures` |
| $z$ | A **standardized** feature vector, $z = (\varphi - \mu)/s$ | `phi_std` |

$\varphi$ is always the concatenation $[\varphi_{\text{audio}} ;
\varphi_{\text{struct}}]$, in that order. It is written $\varphi$ rather than
$\phi$ throughout — the code's `phi` is this vector.

## The taste model

| Symbol | Is | In the code |
|---|---|---|
| $K$ | Number of style lenses ($\le 5$) | `TasteConfig::k_styles` |
| $d$ | Feature dimension ($40$) | `TasteConfig::n_features` |
| $\theta_k \in \R^{d}$ | Lens $k$'s weight vector | `TasteSample::theta[k]` |
| $\theta$ | All of them, $K \times d$ | `TasteSample::theta` |
| $u(x)$ | Latent utility of $x$ | `utility_mix` |
| $u_k(x)$ | Lens $k$'s utility, $\theta_k^\top z$ | `utility(phi, k)` |
| $\tau_s$ | Session $s$'s keep/kill threshold | `TasteSample::tau[s]` |
| $c_j$ | Star cutpoint $j$ | `TasteSample::cuts[j]` |
| $\sigma_\theta$ | Prior SD of one $\theta$ coordinate | `TasteConfig::sigma_theta()` |
| $s_K$ | Max-of-$K$-normals SD correction | `MAX_NORMAL_SD` |
| $S$ | Number of sessions in the log | `FitSet::n_sessions()` |

## Search

| Symbol | Is | In the code |
|---|---|---|
| $p_{\text{grammar}}(x)$ | Prior probability of term $x$ | `PatchGrammarPrior` |
| $\beta$ | Boltzmann sharpness | `SessionConfig::beta` |
| $\pi_\beta$ | The target, $\propto p_{\text{grammar}}(x)\,e^{\beta\,\E[u_\theta(x)]}$ | — |
| $\eta$ | Proposal-tilt strength | `SessionConfig::proposal_tilt` |
| $\mathcal{L}$ | The set of locked addresses | `locked: HashSet<String>` |

## Conventions

- $\sigma(\cdot)$ is the **logistic** function $\sigma(v) = 1/(1+e^{-v})$, never a
  standard deviation. Standard deviations are always subscripted ($\sigma_\theta$)
  or written as $s$.
- $\log$ is natural. Log-losses are in **nats**.
- Indices are **0-based**, matching the code, including cutpoint indices — which
  matters for reading the [ordinal likelihood](./taste/likelihoods.md#star-ratings--a-cumulative-logit).
- Weights $w$ are always **normalized** unless stated: importance weights sum to
  one, recency weights are relative to the newest observation being $1$.
- "Standardized" always means *after* the affine transform in
  [Standardization](./features/standardization.md). The taste model never sees raw
  $\varphi$; the observation **log** never stores anything else.

## KaTeX macros

Defined in `www/reference/book.toml` so a symbol cannot mean two things on two
pages:

| Macro | Renders |
|---|---|
| `\R` | $\R$ |
| `\E` | $\E$ |
| `\phivec` | $\phivec$ |
| `\thetak` | $\thetak$ |
| `\sig` | $\sig$ |
