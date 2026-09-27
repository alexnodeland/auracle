# The math — storyboard

An illustrated film, no footage. Eleven beats, 379 words at speed 0.9. Every
picture is a diagram of something the reference documents and the code
computes; every number on screen carries the name of the constant it comes
from, so a viewer can grep for it.

**Build.** `films/math/film.js`, in the style of `films/engine/film.js`: the
same `stack()`, `voiceLine()`/`speak()`, `wordTime()`, `box()` and `arrow()`
helpers (lift them into `stage/kit.js` or copy them), kit pieces named below,
and captions from the script text with `*green*` / `_amber_` emphasis. Green is
sound, amber is the model's mind; the model is amber almost everywhere in this
film. Formulas are IBM Plex Mono with `<sub>`/`<sup>`, as the engine film sets
`u(x) = max<sub>k</sub> θ<sub>k</sub> · φ(x)`.

**Do not reuse** the engine film's posterior scene (`sceneUtility`'s ellipse
labelled `Laplace: N(θ̂, H⁻¹)`). The posterior is not a Gaussian approximation;
see beat 4 and `SCRIPTS.md`.

**Word cues** below are `lineId:word` (first word in the line that starts with
it), the same form `walk.js` and `footage.mjs` resolve.

---

## 1. `intro` — the pipeline (intro1)

- **On screen.** The reference's pipeline, typeset left to right at y≈420,
  silk text with green arrows:
  `term →compile→ patch →render→ audio →vet→ audio →φ→ ℝ⁴⁴ →u_θ→ ℝ`.
  Under it an amber return arc from `ℝ` back to `term`, labelled
  "answers condition θ · θ reshapes how the next term is proposed".
  Eyebrow top-left: `THE MATH`.
- **Kit.** `arrow()` ×6 (green) + one curved amber `arrow()` (`curve: 0.35`);
  `textBlock` for the eyebrow.
- **Cues.** Arrows draw on in order from the beat start (0.2 s apart);
  `intro1:why` → the amber return arc draws; `intro1:shape` → the three amber
  stages (`φ`, `u_θ`, the arc) glow once.

## 2. `utility` — standardized features, a max of lenses (utility1–3)

- **utility1.** Left: `phiBars` (18 bars) above the engine film's 26-cell
  structural grid; both slide into one column labelled `φ(x) ∈ ℝ⁴⁴`
  (`18 audio + 26 structural`). On `utility1:standardized`: the column
  re-scales and the label becomes `z = (φ − μ) / s` with the footnote
  "refit at every posterior fit, over the log and the pool
  (`Standardizer::fit`)". Leave `phiBars` labels off here (the kit's
  `PHI_AUDIO` names are not the real coordinate names; see `SCRIPTS.md`).
- **utility2.** Right, large amber: `u(x) = max`<sub>`k`</sub>` θ`<sub>`k`</sub>`ᵀ z(x)`.
  On `utility2:maximum`: `max` glows. On `utility2:never`: a dim, struck-through
  `Σ`<sub>`k`</sub>` w`<sub>`k`</sub>` θ`<sub>`k`</sub>`ᵀ z` slides in under it.
  Footnote: "K = 1 + ⌊n/20⌋, capped at 5 (`SessionConfig::k_styles`)".
- **utility3.** Cross-fade to the taste film's two islands (`sceneLenses` dots:
  a dark cluster left, a bright cluster right) with two amber lens arrows
  θ₁, θ₂ from a common origin (new drawing: two `arrow()`s). On
  `utility3:drones` the left cluster lights, on `utility3:plucks` the right.
  On `utility3:scored`: one dot from each cluster lifts into a small
  `duelCard` pair (A "drone", B "pluck"), and under them
  `u(A) = θ₁ᵀz(A)` and `u(B) = θ₂ᵀz(B)` on one shared axis — the duel is
  well posed because both sides are on the same scale.
- **Small print, not narrated** (bottom-left, 18px mono, silk-dim):
  `θ_kj ~ N(0, σ_θ²), σ_θ = 1/(√d · s_K)`, with `s_K = 1, .826, .748, .701, .669`
  for K = 1…5 (`MAX_NORMAL_SD`): the correction that keeps `Var(u_a − u_b)` the
  same at every K.

## 3. `likelihoods` — three likelihoods on one utility (likelihoods1–5)

Three panels in a row, each a graphite `plate` (620×520), sharing one amber
utility axis along the bottom. Port the math of `VIZ['likelihoods']`
(`www/viz/viz.js`) into stage drawings; nothing here is interactive.

- **likelihoods1.** The three plates rise in (0.15 s apart), titled
  `duel`, `cut`, `stars`.
- **likelihoods2 → panel 1.** The logistic curve over `Δu = u(A) − u(B)`,
  with `P(A ≻ B) = σ(u(A) − u(B))`. On `likelihoods2:Bradley` the curve
  draws; on `likelihoods2:difference` a dot slides along Δu and its height is
  read off.
- **likelihoods3 → panel 2.** `P(keep) = σ(u(x) − τ_s)`, `τ_s ~ N(0, 1)`,
  one τ per session. Tag under the title: "bank ▸ cut = kill
  (`record_keep(id, false)`)". On `likelihoods3:bar` a vertical amber τ line
  appears on the axis.
- **likelihoods4.** On `likelihoods4:picky` two session rows appear, `s = 1`
  (generous, τ left) and `s = 2` (strict, τ right); the same patch dot sits at
  the same u in both, and only τ moved. On `likelihoods4:taste` the dot pulses:
  it did not move.
- **likelihoods5 → panel 3.** Six bands on the u axis separated by five
  cutpoints `c₀…c₄`, labelled 0–5 ★;
  `P(y = k) = σ(c_k − u) − σ(c_{k−1} − u)` and, small,
  `c₀ = −2 + 1.5 r₀,  c_j = c_{j−1} + e^{−0.5 + 0.7 r_j}` (ordered by
  construction). On `likelihoods5:harsh` all five cutpoints slide right
  together; the rated patch's u marker stays put.
- **Footer across all three, not narrated:** "one factor:
  `Σᵢ wᵢ log p(yᵢ | θ)`, recency `wᵢ = 0.5^((n−1−i)/150)`
  (`recency_half_life`)".

## 4. `posterior` — MCMC draws, then exact reweighting (posterior1–4)

- **posterior1.** A list of the model's sites in mono, all tagged `∈ ℝ`:
  `θ₀,₀ … θ₄,₄₃` · `τ_s` · `r₀ … r₄`. On `posterior1:labels` a struck-out
  `z_i ∈ {1…K}` fades (there is no discrete lens assignment to sample: the max
  form removed it).
- **posterior2.** `tasteCloud` (kit, amber, n = 160 drawn, caption "500 draws")
  grows from the origin. On `posterior2:Metropolis` one arrow at a time jitters
  (single-site moves). Label: "adaptive single-site MH · 3 000 warmup +
  10 000 steps · thinned to 500 (`mcmc_warmup`, `mcmc_samples`, `KEEP`)".
- **posterior3.** Port `VIZ['ess']`: a row of weight bars, one per draw, under
  the cloud. On `posterior3:reweights`: formula
  `w_s ← w_s p(y | θ_s) / Σ_s′ w_s′ p(y | θ_s′)`; bars redistribute and the
  cloud's arrows fade by weight (`tasteCloud.update` with the new pick's
  direction). Tag: "exact · O(S) per answer".
- **posterior4.** An `ESS = 1 / Σ w_s²` meter drops with each answer. On
  `posterior4:collapse` it crosses half the draw count and flashes
  "resampled"; on `posterior4:refit` the cloud is redrawn fresh and full, and
  the caption reads "`needs_refit()`: resampled since the last fit · at most
  every 6 duels".

## 5. `calibration` — forecast first, score with a proper rule (calibration1–4)

- **calibration1.** Two `duelCard`s; above them the taste film's dashed
  forecast note "forecast: B, 64%". On `calibration1:answer` B is picked; on
  `calibration1:Brier` a pill: `(p_chosen − 1)² = (0.64 − 1)² = 0.13`, then
  `B = mean (p_chosen − 1)²` and `skill = 1 − B / 0.25`.
- **calibration2.** New drawing: expected Brier score against the reported
  probability q for a true p = 0.7, a parabola with its minimum at q = p. On
  `calibration2:honest` a marker drops into the minimum.
- **calibration3.** Port `VIZ['reliability']`: five bins (`N_BINS = 5`), the
  diagonal, dots. On `calibration3:overconfidence` the right-hand dots sink
  below the diagonal (says 90%, right 60% of the time) while a counter labelled
  "accuracy" stays at 61%; the skill number beside it drops.
- **calibration4.** Four amber bars, one per `ProvenanceScore` stream:
  "dealt duels · PERFORM offers · heard edits · asserted edits". (The engine
  film's calibration bars used "self-reports"; use these four.)

## 6. `acquisition` — which pair to ask (acquisition1–3)

- **acquisition1.** A grid of 40 pool dots (the pool the web app asks for);
  a question mark between two of them.
- **acquisition2.** A three-row chart from `search/acquisition.md`, static
  pool, 20 seeds × 72 duels: rows random / BALD / Thompson, columns
  `cos θ*` ↑ (0.460 / 0.484 / 0.416), rank r ↑ (0.731 / 0.762 / 0.628),
  excess nats ↓ (0.211 / 0.199 / 0.254). On `acquisition2:tied` the
  "BALD − random" difference bars appear with ±2 s.e. whiskers that all
  cross zero; on `acquisition2:lost` the Thompson row dims and its
  "BALD − Thompson" whiskers clear zero.
- **acquisition3.** Two dots are picked uniformly at random from the grid and
  dealt as a duel; a pill "◇ unbiased probe" lands on it on
  `acquisition3:unbiased`. Footnote: "`Acquisition::Random` (default); BALD
  and Thompson are kept so the comparison stays runnable".

## 7. `target` — the Boltzmann target and β (target1–3; music `loop_b`)

- **target1.** Reuse the engine film's landscape (`sceneSearch`): the prior
  curve in green, the target in amber. Formula at the top:
  `π_β(x) ∝ p_grammar(x) · e^{β 𝔼[u_θ(x)]}`. On `target1:prior` the green
  curve draws; on `target1:exponential` the amber one rises out of it.
- **target2.** Three small term trees of depth 1, 2, 3 beside the curve, each
  with a prior-mass bar that shrinks by a factor at every level ("each level
  multiplies in another Bernoulli that came out processor"). On
  `target2:penalty` a struck-through `− λ·size` appears and fades.
- **target3.** An amber `knob` labelled β. On `target3:Beta` it turns
  0 → 2 → 8 and the amber curve is recomputed each frame: equal to the prior
  at 0, tilted at 2 (tick "shipped · `SessionConfig::beta`"), collapsed onto
  the mode at 8 ("optimizer").
- **Footnote, not narrated.** "With a posterior, the grammar's categorical
  weights are tilted by the model (η = 0.6, each multiplier clamped to ¼…4,
  `proposal_tilt`), and that tilted grammar is the prior the walk runs under:
  `π′ ∝ p_tilted · e^{β𝔼[u]}` — reference, Proposals." Optionally show
  `VIZ['tilt']`'s hollow and filled bars for two seconds at the end.

## 8. `refine` — MH on the trace, and what it keeps (refine1–3)

- **refine1.** Reuse the engine film's genome tree (`sceneGenome`) with its
  trace addresses. On `refine1:Metropolis` a parameter move: `node/0#cut`
  flashes and its value changes. On `refine1:trace` a structural move: the
  `lfo` leaf is regenerated (`s&h` → `steps`), tagged "reversible jump
  (fugue handles the Jacobian bookkeeping)".
- **refine2.** Back on the landscape: ten amber walkers start from the ten
  best pool dots and take 40 steps each (the engine film's MH walker ×10,
  deterministic seeds). Label "`refine_seeds` = 10 · `refine_steps` = 40
  (2 × `N_OPS`)".
- **refine3.** On `refine3:ends` each walker's final state is flagged and
  dropped into a pool strip. On `refine3:sampling` a faint histogram of π_β
  appears behind, to contrast a sample with where the climbs ended. Caption:
  "`RefineKeep::Last` — local hill-climbing on π_β, not a draw from it".

## 9. `locks` — exact conditioning (locks1–3)

- **locks1.** A trace as a mono list: `node#op`, `node/0#cut 🔒`,
  `node/0#res 🔒`, `node/0/m#mod`, `node/0/m#rate`, `amp#release`. Formula:
  `π_β(x_¬L | x_L)` · "Metropolis-within-Gibbs".
- **locks2.** Three proposals as arrows x → x′, each rejected with a red ✕
  on its word: `locks2:change` (a new value at `node/0#cut`),
  `locks2:delete` (a subtree removal that takes `node/0#res` with it),
  `locks2:create` (a birth at a locked address).
- **locks3.** The asymmetric case: x → x′ (birth) allowed in green while
  x′ → x (death) is rejected; the region is drawn lopsided. On
  `locks3:deaths` `violates_locks(prev, next, locked)` checks both traces, the
  birth is rejected too, and the region becomes symmetric. Small print: "a
  brand-new address inside a locked module is in neither trace, so it is not
  caught — a lock is a promise about addresses, not subtrees".

## 10. `perform` — named directions, a Jacobian, a ridge solve, verified halves (perform1–4)

- **perform1.** Reuse the engine film's six named arrows (`scenePerform`).
  On `perform1:Bright` the weights appear beside each arrow:
  Bright `(centroid + rolloff)/√2`, Snap `(−attack + crest)/√2`,
  Motion `½(held_centroid_std + slow + mid + fast)`, Body `bass_fraction`,
  Grit `flatness_mean`, Space `tail_ratio`. A patch dot moves between two
  presets while the arrows stay fixed.
- **perform2.** The engine film's heat grid, re-cut to 18 rows (audio z)
  × n knob columns: `J_{:,k} = (z(v₀ + h_k e_k) − z(v₀)) / h_k`, `h = 0.08`
  toward the interior, "n + 1 renders" (`JACOBIAN_STEP`). On
  `perform2:differently` two grids side by side (First Bass, Glass Pad) with the
  `#cut` column lighting different rows, and a two-row table: median purity
  own Jacobian 0.61 / 0.77 / 0.75 against a leave-one-out per-knob table
  0.23 / 0.16 / 0.09 (Bright / Snap / Motion).
- **perform3.** `δ* = (JᵀJ + λI)⁻¹ Jᵀ ê`, `λ = 0.05` (`RIDGE`); four columns
  outlined by effect `|δ_k|·‖J_k‖` (`MAX_KNOBS` = 4), then re-solved on them;
  a full turn moves no knob more than half its range (`MAX_TRAVEL`). Gate:
  `search ⇔ ρ < 0.35 ∨ R < 0.15σ` (`PURITY_FLOOR`, `REACH_FLOOR`).
- **perform4.** A small plot of `m(c) = êᵀ(z(v(c)) − z(v₀))` with four render
  dots at `c ∈ {−1, −½, +½, +1}`. On `perform4:rendered` the dots land; on
  `perform4:closes` the lower half of First Bass's Motion is shown moving the
  wrong way (the linear prediction said stiller; the render was very slightly
  more restless) and turns red, and a `knob` beside it redraws with only its
  upper ring and the caption "already as still as it gets". Small print: "open if
  0 < s·m(s/2) < s·m(s) and r_s ≥ 0.075 · one retry at half travel".

## 11. `outro` (outro1)

The engine film's lockup (`mark` + wordmark). On `outro1:constant`, mono
tokens drift in under it: `beta 2.0 · proposal_tilt 0.6 · recency_half_life
150 · RIDGE 0.05 · JACOBIAN_STEP 0.08 · PURITY_FLOOR 0.35 · REACH_FLOOR 0.15`.
On `outro1:reference` three pills: `taste model ▸`, `search ▸`,
`performance ▸`. Fade to black over the 2.5 s tail.
