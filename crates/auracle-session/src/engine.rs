//! The two-loop session engine (the reference: *The two loops*).
//!
//! - **Patch loop** (machine-paced, silent): fill a pool with vetted prior
//!   draws; once a posterior exists, *refine* — warm-start fugue-evo's typed
//!   MH from the best pool members on the Boltzmann target
//!   `π_β ∝ p_grammar · exp(β·E[u(x)])` and inject improved candidates. The
//!   refinement run is a **short local MH walk** from each seed (a dozen
//!   steps, final state kept), not a draw from `π_β`: it moves candidates
//!   uphill on that target, which is what the pool needs, but nothing here
//!   claims the pool is distributed as `π_β`.
//! - **Taste loop** (human-paced, persistent): feedback events append to the
//!   [`ObservationLog`] as **raw** φ; the posterior is re-fit from the log,
//!   standardizing at fit time.
//!
//! Between them, **acquisition**: [`Engine::next_duel`] maximizes expected
//! information about θ (BALD). See its docs for why the obvious alternative —
//! dueling Thompson sampling — is the wrong objective for this product.
//!
//! **Locks** (partial evolution): any set of trace addresses can be frozen
//! during refinement. The MH kernel still proposes over all sites; a proposal
//! that touches a locked address is rejected outside the kernel. Because the
//! underlying kernel satisfies detailed balance on the full space, rejecting
//! locked-coordinate moves yields a valid Metropolis-within-Gibbs sampler on
//! the *conditional* posterior given the locked values — locking is exact,
//! not a heuristic. That exactness depends on the rejection region being
//! *symmetric*: [`Engine::violates_locks`] therefore checks births as well as
//! deaths and edits. Wasted proposals are compensated by scaling step counts.
//!
//! All UI modes are emitters into the same observation stream: the engine
//! does not know which surface produced an event. Candidates carry stable
//! `id`s — pool positions shift on eviction, ids never do.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use auracle_features::{
    featurize_memo, render_playback, Audition, AuditionClip, ClipSource, Features, PhraseSpec,
    RenderMemo, SavedClip,
};
use auracle_grammar::prior::N_OPS;
use auracle_grammar::rng::gen_index;
use auracle_grammar::{tree_diff, DiffEntry, PatchGrammarPrior, PatchTree, Take};
use auracle_taste::{
    Feedback, FitSet, Observation, ObservationLog, Provenance, Standardizer, TasteConfig,
    TasteModel, TastePosterior,
};
use fugue::Trace;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde::{Deserialize, Serialize};

use crate::calib::{calibration, Calibration, Forecast};
use crate::farm::{draw_seed, Draw, PreFeaturized};
use crate::naming::{claim_name, NameScale, NAME_FLOOR};
use crate::walk::{run_walk, walk_seed, WalkContext, WalkJob, WalkResult};

/// The φ coordinate names, as owned strings (what the log records).
pub fn phi_names() -> Vec<String> {
    Features::phi_names()
        .into_iter()
        .map(|n| n.to_string())
        .collect()
}

/// Which rule picks the next duel.
///
/// Selectable because the choice is an empirical claim, and
/// `learn_synthetic --compare` measures it. Both alternatives are kept so
/// that comparison stays runnable — a rule chosen on evidence should stay
/// re-checkable, and a rule rejected on evidence doubly so.
///
/// ## The measurement, and what it is a measurement *of*
///
/// `cargo run -p auracle-session --example learn_synthetic --release --
/// --compare 20`, on the synthetic user: 20 seeds, 72 duels, refit every 12.
/// **Common random numbers** — pool fill, the user's coin flip at duel *t*,
/// MCMC seed at round *r*, and refinement seeds are all shared across arms,
/// so only the acquisition draw differs. Both regimes are graded on one fixed
/// held-out exam under a single reference scale, so arms that built different
/// pools are still answering the same questions. `±` is two standard errors
/// of the paired difference.
///
/// ### Static pool (i.i.d. prior draws, `refine_steps: 0`)
///
/// | | cos θ\* ↑ | rank r ↑ | excess nats ↓ |
/// |---|---|---|---|
/// | **random** | 0.460 | 0.731 | 0.211 |
/// | thompson | 0.416 | 0.628 | 0.254 |
/// | bald | 0.484 | 0.762 | 0.199 |
/// | bald − thompson | **+0.068 ± 0.062** | **+0.134 ± 0.044** | **−0.055 ± 0.014** |
/// | bald − random | +0.025 ± 0.058 | +0.031 ± 0.046 | −0.012 ± 0.013 |
///
/// Dueling Thompson sampling is the one clear loser, at t = 2.2 / 6.1 / −8.0.
/// It is a best-arm rule: it converges on identifying the top patch, which is
/// not what a duel is for here. BALD and uniform pairing are inside two
/// standard errors of each other on every metric.
///
/// A static i.i.d. pool is also a weak regime to conclude from on its own:
/// prior draws are spread over feature space *by construction*, which is
/// exactly where uniform pairs already achieve near-optimal `‖φ_a − φ_b‖`
/// coverage and an information-seeking rule has no redundancy to prune. The
/// concern was that the shipped pool is not that pool — refinement injects
/// children near the current best and `insert_candidate` evicts the worst —
/// so `--compare` runs an **evolving** regime too, with real refinement
/// between rounds (the `Regime` type in `learn_synthetic.rs` documents the
/// design).
///
/// ### Evolving pool (`refine_steps: 12`, refinement between rounds)
///
/// | | cos θ\* ↑ | rank r ↑ | excess nats ↓ |
/// |---|---|---|---|
/// | **random** | 0.479 | 0.694 | 0.232 |
/// | thompson | 0.459 | 0.583 | 0.276 |
/// | bald | 0.465 | 0.707 | 0.232 |
/// | bald − thompson | +0.006 ± 0.068 | **+0.124 ± 0.066** | **−0.044 ± 0.017** |
/// | bald − random | −0.015 ± 0.055 | +0.013 ± 0.048 | −0.000 ± 0.014 |
///
/// Same answer: Thompson loses, BALD and uniform pairing tie on every metric.
///
/// The run's manipulation check is itself a finding. Final pool spread (mean
/// pairwise `‖Δφ‖`, reference scale) was **7.7–7.9 evolving vs 7.2 static**:
/// six generations over a 72-duel session did not concentrate the pool at
/// all — frontier-biased injection plus worst-eviction *widened* it slightly,
/// because mutation pushes children into feature-space extremes faster than
/// eviction trims them. So the concentrated regime BALD was hypothesized to
/// win never arises at session horizon, and the tie is not an artifact of a
/// spread pool that only the static setup guaranteed — the product's own
/// dynamics keep the pool spread.
///
/// ## Why `Random` is the default
///
/// Measured in both the regime the product starts in and the regime it
/// evolves into, uniform pairing is indistinguishable from BALD — and a rule
/// with four tuning constants that ties a rule with none should not ship on
/// a tie. Two supporting justifications survived checking, one did not: the
/// `info_gain` BALD reports had **zero** consumers in the frontend, and BALD's
/// repeat avoidance, while real, is barely needed over a 48-candidate pool
/// that uniform pairing already samples without repeating (measured in
/// `duels_spread_over_candidates_not_just_pairs`). `Random` also makes
/// **every** duel an unbiased calibration sample rather than one in ten —
/// a virtue that holds regardless of which rule learns θ faster.
///
/// One earlier justification was retracted for a bad reason, and the record
/// should say so. The "pool grows and concentrates" argument was dismissed on
/// the grounds that `insert_candidate` caps the pool — but a capped *size* is
/// not an unchanging *spread*, and evicting the worst member could in
/// principle concentrate a pool. Dismissing the concentration argument
/// *because it was unmeasured*, while treating a measurement from the other
/// regime as decisive, had the burden of proof backwards. The evolving run
/// above is that measurement; it happens to show the concentration never
/// materializes, but the default rests on the measured tie, not on the
/// dismissal.
///
/// ## What `Bald` is still for
///
/// It is not dead code and it is not a fallback. It decisively beats the
/// best-arm rule, so it is the right thing to reach for if acquisition ever
/// needs to *do* something uniform pairing cannot: bias duels toward patches
/// the user will enjoy auditioning ([`SessionConfig::duel_utility_weight`]),
/// bound how often one patch reappears ([`SessionConfig::duel_exposure_penalty`]),
/// or report why a question was asked. Those levers exist and are measured;
/// none of them is currently worth the tie.
///
/// ## A correction worth recording
///
/// An earlier version of this rule scored its enjoyment term on *unnormalized*
/// utility and used an *absolute* softmax temperature of 0.05 nats. Both are
/// scale bets, and both lost: the enjoyment term grew without bound as the
/// posterior sharpened, and `exp(ΔJ/T)` ran to `e¹⁰`, so the "softmax" was an
/// argmax. That version was measurably *worse* than random, and it is the
/// version an independent replication measured. It is also what produced the
/// duel repetition seen in the running app — the same defect, observed from
/// two directions. Fixed, BALD ties random; the numbers above are the fixed
/// rule.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Acquisition {
    /// Uniformly random pairs. The default — see the type doc.
    #[default]
    Random,
    /// Dueling Thompson sampling: two posterior draws, duel their champions.
    /// Best-arm identification — converges on the top patch, not on θ.
    Thompson,
    /// Expected information gain about θ, plus an enjoyment term and a
    /// repeat penalty, sampled from a softmax. Beats [`Acquisition::Thompson`]
    /// decisively and ties [`Acquisition::Random`]; see the type doc.
    Bald,
}

/// Which state of a refinement walk becomes the injected child.
///
/// Selectable because the choice is an empirical claim, and the same rule
/// applies here as to [`Acquisition`]: a rule chosen on evidence should stay
/// re-checkable, and a rule rejected on evidence doubly so. `make climb` and
/// `search_health --budget-ab` are where the comparison runs.
///
/// ## Why this is a question at all
///
/// A refinement walk renders and featurizes ~40 candidates and injects **one**.
/// Which one is free to choose — the whole walk is already in the memo, and
/// every trace the kernel returns already carries its own `log π_β` — so the
/// choice costs nothing either way and has never been measured.
///
/// The tension is real in both directions. [`Self::Last`] is a draw from where
/// the chain ended up, which respects the target's own weighting and is
/// robust: it cannot be fooled by a single point where the surrogate happens
/// to be over-optimistic. [`Self::Best`] takes the walk's argmax, which is what
/// a *shortlist* wants — the pool is not a sample, it is a few dozen patches a
/// person will listen to — but argmax over a surrogate is the classic way to
/// find that surrogate's errors rather than the user's preferences.
///
/// ## The A/B, run, and its result — a tie
///
/// `make climb SEEDS=16` on both arms, same seed list, so the per-seed lines
/// pair directly:
///
/// ```text
///                        Last              Best
/// mean gain        +1.927 ± 0.452    +1.774 ± 0.302
/// median gain      +2.058            +1.819
/// 10% trimmed      +1.840 ± 0.383    +1.925 ± 0.190
/// climbed on       14/16             15/16
///
/// paired (Best − Last)   mean    −0.153 ± 0.384   (−0.40 se)
///                        median  −0.185
///                        trimmed −0.113 ± 0.318
///                        sign     8 better / 8 worse, p = 1.000
/// ```
///
/// Eight and eight is as exact a tie as sixteen seeds can produce. The
/// difference does not clear zero at 2 se on any of the three statistics, so
/// **the default stays [`Self::Last`]** — kept re-checkable rather than
/// deleted, the same way [`Acquisition::Thompson`] is kept after losing.
///
/// Two things worth reading off it rather than leaving in the table:
///
/// - **The feared failure did not happen, and neither did the hoped-for win.**
///   The worry was that argmax over a surrogate would find the surrogate's
///   errors and deepen the catastrophic tail. Across the pair the tails are a
///   wash — the worst `Last` seed goes −0.74 → −1.80 under `Best`, and the
///   next two worst go −0.64 → +0.52 and +0.12 → +1.29. `Best` climbs on one
///   more seed and means marginally less.
/// - **`Best` is the lower-variance rule, not the better one.** Its trimmed
///   standard error is half `Last`'s (0.190 against 0.383). Injecting the
///   walk's argmax is more *consistent* than injecting where it stopped; it
///   just does not aim anywhere better on average. That is a coherent thing
///   for argmax-over-a-noisy-surrogate to be, and it is the argument to
///   re-run this on if the surrogate ever gets sharper.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefineKeep {
    /// Inject the state the walk ended on. The shipped behaviour, and the
    /// default — the A/B above ran and tied, so nothing moved it.
    #[default]
    Last,
    /// Inject the highest-`log π_β` state the walk occupied, seed included —
    /// so a walk that found nothing better than its seed injects nothing.
    Best,
}

/// What the pool does with audition audio.
///
/// Renders are the engine's only expensive artifact and its bulkiest one: at
/// the default phrase a single audition buffer is ~565 KB of f32, and a full
/// pool of them is tens of megabytes of wasm heap — resident forever, for
/// audio the user will mostly never ask to hear. But φ, not audio, is what
/// the pool exists to hold, and [`auracle_features::render_playback`] can
/// reproduce any buffer bit-identically from the term. So retention is a
/// policy, not a structural requirement.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RenderPolicy {
    /// Materialize every candidate's buffer at admission and keep it for the
    /// lifetime of the candidate. Fastest audition, largest footprint.
    Eager,
    /// Materialize on [`Engine::render_of`], keeping the most recently
    /// auditioned [`SessionConfig::audio_cache`] buffers and dropping the
    /// rest. A cold audition costs one render.
    Lazy,
    /// Never keep audio. Headless callers (tests, `learn_synthetic`) never
    /// audition anything, and this is what they should pay.
    #[default]
    None,
}

/// Engine configuration.
#[derive(Clone, Debug)]
pub struct SessionConfig {
    /// Vetted candidates to maintain in the pool.
    pub pool_size: usize,
    /// Maximum prior draws attempted per `fill_pool` (vet failures burn
    /// attempts).
    pub max_draws: usize,
    /// MH refinement steps per seed (scaled up when locks waste proposals).
    ///
    /// The default scales with [`N_OPS`]: a structural proposal picks a new
    /// operator from a categorical that the v2 palette widened from six to
    /// twenty, so a fixed budget would spend the same number of proposals
    /// covering a far wider move set and land the pool's children in a
    /// visibly thinner slice of it.
    ///
    /// ## The split is measured, not reasoned
    ///
    /// `2·N_OPS` steps from `N_OPS/2` seeds was an argument, and the argument
    /// could have been wrong in either direction. `search_health --budget-ab`
    /// exists to settle it; over 8 seeds, 6 generations, graded against the
    /// synthetic user's true utility:
    ///
    /// | steps | seeds | proposals | mean u | max u | |
    /// |---|---|---|---|---|---|
    /// | 40 | 10 | 400 | **1.714** | **8.154** | shipped |
    /// | 40 |  3 | 120 | 1.241 | 6.178 | same depth, fewer seeds |
    /// | 66 |  3 | 198 | 0.774 | 6.281 | same total, fewer seeds |
    /// | 20 | 20 | 400 | 0.568 | 6.790 | half depth, double breadth |
    ///
    /// The shipped split wins on both metrics, and it is a genuine optimum
    /// rather than the top of a slope: moving off it in *either* direction is
    /// worse. Two rows are worth more than the headline.
    ///
    /// **Depth from few seeds is actively harmful.** 66×3 runs 65% more
    /// proposals than 40×3 and scores *lower* (0.774 against 1.241) — a long
    /// chain from a bad starting point converges confidently on somewhere you
    /// did not want to be, and the extra steps are what get it there.
    ///
    /// **Breadth is not free either.** 20×20 spends the shipped budget and is
    /// the worst row of the four. Twenty steps is not enough for a chain to
    /// leave its seed, so the generation is twenty barely-moved copies of the
    /// current top — which is also why it has the second-best `max`: it
    /// preserves the frontier by never straying from it.
    ///
    /// Re-run this before changing either number.
    pub refine_steps: usize,
    /// How many top candidates to refine from. Also scaled with [`N_OPS`] —
    /// more seeds is more *starting points*, which is what actually buys
    /// coverage of a wider palette, whereas more steps per seed buys depth
    /// around one. See [`SessionConfig::refine_steps`] for the measurement
    /// that fixes the ratio between them.
    pub refine_seeds: usize,
    /// Boltzmann sharpness β of the refinement target.
    pub beta: f64,
    /// Which state of a refinement walk becomes the injected child.
    pub refine_keep: RefineKeep,
    /// Maximum style components in the taste mixture
    /// (max-of-linear-experts); the fitted K grows with evidence up to this
    /// cap.
    ///
    /// K is also the fit's dominant cost driver, because single-site MH
    /// rebuilds the whole program every step and the site count is
    /// `d·K + n_sessions + 5` — at today's d = 44, that is 50 at K = 1 and
    /// **226 at K = 5** (printed by `fit_bench`, so it moves with φ). Two
    /// consequences, both measured by `auracle-taste/examples/fit_bench.rs`:
    /// the fit is ~4× slower at the cap than at the first fit, and the step
    /// budget is *fixed*, so a mature fit gets ~4× fewer sweeps per site than
    /// an early one — growing K makes the fit both slower and statistically
    /// thinner.
    ///
    /// **Open option, deliberately not taken here: cap this at 3** (sites
    /// 226 → 138, a ~1.6× mature-fit win at no engineering cost). It is left
    /// open because unlike the address hoist and the budget cut it is not a
    /// pure efficiency change — it removes model *capacity*, and capacity is
    /// the whole point of the mixture (a user with four islands of taste
    /// cannot be represented by three lenses). Take it only on evidence:
    /// [`TastePosterior::style_share`](auracle_taste::TastePosterior::style_share)
    /// reports what fraction of the pool each lens claims, and if lenses 4
    /// and 5 sit near zero share across real sessions they are paying 88
    /// sites per step for nothing. `learn_synthetic --compare` is the A/B.
    pub k_styles: usize,
    /// The audition stimulus.
    pub phrase: PhraseSpec,
    /// How the pool retains audition audio.
    pub render_policy: RenderPolicy,
    /// Audition buffers kept resident under [`RenderPolicy::Lazy`], most
    /// recently auditioned first. Sized for the current duel pair, the bench
    /// subject, and enough recent history that stepping back through the bank
    /// is free.
    pub audio_cache: usize,
    /// Post-warmup MH steps per posterior fit.
    ///
    /// This is the one knob in this struct that buys wall time with
    /// *statistics*, so it is set from a measurement rather than a guess.
    /// Only 500 draws survive thinning at any budget, so the budget does not
    /// buy draws — it buys **sweeps per site**, and at K = 5 (226 sites) even
    /// 10 000 steps is only ~44 sweeps.
    ///
    /// Recovery vs budget at the mature operating point (K = 5, n_obs = 100,
    /// 12 seeds, `cargo run --release -p auracle-taste --example fit_bench
    /// -- sweep 12`): held-out duel agreement with the noiseless ground-truth
    /// ordering, and the cosine of the best lens against θ\*.
    ///
    /// | steps | held-out acc | best-lens cos | native fit |
    /// |---|---|---|---|
    /// | 30 000 | 0.767 | 0.724 | 1.79 s |
    /// | 20 000 | 0.757 | 0.717 | 1.16 s |
    /// | **10 000** | **0.746** | **0.686** | **0.60 s** |
    /// | 8 000 | 0.738 | 0.690 | 0.49 s |
    /// | 6 000 | 0.737 | 0.653 | 0.38 s |
    /// | 5 000 | 0.729 | 0.655 | 0.33 s |
    /// | 3 000 | 0.713 | 0.599 | 0.20 s |
    ///
    /// That curve is smooth, so it says where the trade *stops paying*. The
    /// second instrument is the end-to-end M4 gate
    /// (`closed_loop_learns_synthetic_taste`, which runs at exactly this
    /// budget through the real render → vet → feature pipeline). One run of
    /// it is a **single draw** — over the pool lottery, the duel answers and
    /// the chain — so it is replicated over 13 seeds here (`cargo run
    /// --release -p auracle-session --example closed_loop_sweep`). Its
    /// pool/truth correlation `r` against the 0.6 gate, plus the other two
    /// metrics the test asserts:
    ///
    /// | steps | mean r | min r | seeds with r ≤ 0.6 | mean top-5 | mean cos |
    /// |---|---|---|---|---|---|
    /// | 30 000 | 0.736 | 0.575 | 1/13 | 3.14 | 0.528 |
    /// | 20 000 | 0.722 | 0.576 | 2/13 | 2.88 | 0.497 |
    /// | **10 000** | **0.726** | **0.551** | **2/13** | **2.78** | **0.475** |
    /// | 8 000 | 0.715 | 0.503 | 1/13 | 3.07 | 0.456 |
    /// | 6 000 | 0.747 | 0.600 | 1/13 | 3.39 | 0.497 |
    /// | 5 000 | 0.689 | 0.476 | 2/13 | 3.15 | 0.392 |
    ///
    /// Read that as a noisy measurement, because it is one. Within a single
    /// budget the seed-to-seed spread of `r` is sd ≈ 0.07–0.10 over a range
    /// of ≈ 0.25; between budgets from 6 000 up the means sit in
    /// 0.715–0.747, i.e. inside one standard error (≈ 0.02) of each other —
    /// and 6 000 posts the *highest* mean of the six, which is the plainest
    /// sign that this instrument's ranking of the upper budgets is noise.
    /// **From 6 000 to 30 000 it cannot tell them apart.** Only 5 000
    /// separates at all — lowest on mean `r`, on min `r` and on cos — and
    /// even that gap to 30 000 (0.047) is barely over one standard error of
    /// the difference.
    ///
    /// So the argument for 10 000 is *not* that it passes where 5 000 fails.
    /// Every budget here fails the 0.6 gate on some seed, including the old
    /// 30 000 (1 of 13), and 5 000 clears it on 11 of 13. The argument is:
    /// 10 000 is 3× cheaper than 30 000 and gives up 0.010 of mean `r`, which
    /// is inside the noise; the `fit_bench` sweep above — 12 seeds on a
    /// metric with far less variance — prices the same cut at 0.021 of
    /// held-out accuracy and 0.038 of cos; and cutting further to 5 000 saves
    /// only another 0.27 s per fit while costing 0.017 more held-out
    /// accuracy, 0.031 more cos and 0.037 of mean `r`, the one budget *both*
    /// instruments mark down. 10 000 is where the two instruments agree, not
    /// where a threshold was crossed.
    ///
    /// (An earlier revision of this table read the M4 gate at a single seed,
    /// `0xE05`, and concluded that 5 000 "fails outright" at r = 0.565 while
    /// 10 000 held "the widest margin of any budget tried". Both are
    /// artifacts of that one draw: 0xE05 sits ~1.2 sd low at 5 000 and right
    /// on the mean at 10 000. The per-seed numbers reproduce exactly — the
    /// inference from one of them did not.)
    ///
    /// The earlier 30 000 also predated the address hoist in
    /// [`auracle_taste::model`], which made every step ~1.7× cheaper on its
    /// own; the two together take a mature fit from ~1.86 s to ~0.60 s
    /// natively (~13 s → ~4 s in the browser).
    pub mcmc_samples: usize,
    /// Warmup (adaptation) steps per fit, held at ~30 % of
    /// [`Self::mcmc_samples`]. Warmup only tunes the per-site proposal
    /// scales; it produces no draws, so it is pure overhead beyond the point
    /// the scales converge.
    pub mcmc_warmup: usize,
    /// Recency half-life for the taste likelihood, in observations
    /// (`None` = no forgetting). Tastes drift; old votes should fade.
    pub recency_half_life: Option<f64>,
    /// Strength of the taste→grammar tilt (0 disables): structural θ
    /// components multiply the grammar's kind weights by `exp(η·θ)` during
    /// refinement.
    ///
    /// Named for what it was meant to do; what it *does* is tilt the **prior**
    /// — see [`Engine::biased_prior`] and `www/reference/src/search/proposals.md`.
    /// The tilted grammar is installed as the `EvolutionModel`'s prior, so it
    /// is part of the target the walk climbs, not merely of the kernel that
    /// explores it. Kept under this name because it is a config field the app
    /// and the harness both set; renaming it buys nothing the doc cannot.
    pub proposal_tilt: f64,
    /// λ in the duel objective: how much the *pleasantness* of a duel counts
    /// against its informativeness, applied to **pool-standardized** utility.
    /// The user's enjoyment is a resource too — two mud patches are a cheap
    /// question and an expensive answer.
    ///
    /// Keep it small. Information gain is bounded by `ln 2 ≈ 0.693` nats, so
    /// a λ near 0.3 lets the ±2σ enjoyment term swing the objective by ±0.6 —
    /// as much as the entire information range — and the acquisition function
    /// quietly reverts to "duel the two best patches", which is the best-arm
    /// behaviour BALD was adopted to escape. Measured on the synthetic user
    /// (`learn_synthetic --compare`), λ = 0.3 cost 0.15 of pool-ranking
    /// correlation against λ = 0; 0.1 leaves it a tie-breaker.
    pub duel_utility_weight: f64,
    /// γ in the duel objective: penalty per previous showing of the same
    /// pair. Without it the acquisition function re-asks its favourite
    /// question until the next refit.
    pub duel_repeat_penalty: f64,
    /// Penalty per previous *appearance of either candidate*, regardless of
    /// who it was paired against.
    ///
    /// The pair penalty alone does not stop degeneracy, and the shipped app
    /// proved it: over twelve consecutive duels one candidate appeared in
    /// six. Every pairing `#1 vs #7`, `#1 vs #15`, `#1 vs #22` is a *distinct*
    /// pair and pays no pair penalty at all, while the enjoyment term keeps
    /// nominating the highest-utility candidate. The user does not experience
    /// "distinct pairs"; they experience hearing the same patch over and over.
    /// This term is what makes the *candidate* budget finite.
    pub duel_exposure_penalty: f64,
    /// Softmax temperature over the duel objective, as a **fraction of the
    /// objective's own spread** across the candidate pairs.
    ///
    /// Scale-free for the same reason the enjoyment term is standardized: an
    /// absolute temperature is a bet on how far apart the scores happen to
    /// be. Shipped at an absolute 0.05 nats it was a bad bet — the objective
    /// spans several tenths of a nat once the enjoyment term is in it, so
    /// `exp(ΔJ/T)` ran to `e¹⁰` and the "softmax" was an argmax with extra
    /// steps. Expressed as a fraction of the observed SD, 0.6 means the same
    /// softness whatever the spread.
    pub duel_temperature: f64,
    /// Show one uniformly-random "check" duel every N pairs shown (pairs
    /// dealt and thrown away unseen do not count; see
    /// [`Engine::duel_shown`]). An
    /// information-seeking acquisition deliberately picks pairs near p = 0.5,
    /// so calibration measured on acquisition-chosen duels is
    /// selection-biased; these are the unbiased subsample.
    ///
    /// Redundant under [`Acquisition::Random`], where every duel is already
    /// uniform and is tagged as a check — the setting is kept because it is
    /// exactly what [`Acquisition::Bald`] would need, and because one in ten
    /// was measured to be underpowered anyway (a few forecasts out of fifty
    /// cannot fill a five-bin reliability diagram). 0 disables.
    pub duel_check_every: usize,
    /// Which rule picks the next duel.
    pub acquisition: Acquisition,
    /// Fold each new observation into the posterior weights by importance
    /// sampling between full refits. Off makes the posterior frozen between
    /// fits, which is what the A/B compares against.
    pub sis_between_fits: bool,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            pool_size: 48,
            max_draws: 400,
            // 12 and 3 were tuned against the six-operator v1 palette; both
            // ride N_OPS so the same tuning survives a palette change.
            refine_steps: 2 * N_OPS,
            refine_seeds: N_OPS.div_ceil(2),
            beta: 2.0,
            refine_keep: RefineKeep::default(),
            k_styles: 5,
            phrase: PhraseSpec::default(),
            render_policy: RenderPolicy::None,
            audio_cache: auracle_features::DEFAULT_AUDIO_CAP,
            mcmc_samples: 10_000,
            mcmc_warmup: 3_000,
            recency_half_life: Some(150.0),
            proposal_tilt: 0.6,
            duel_utility_weight: 0.1,
            duel_repeat_penalty: 0.5,
            duel_exposure_penalty: 0.25,
            duel_temperature: 0.6,
            duel_check_every: 10,
            acquisition: Acquisition::default(),
            sis_between_fits: true,
        }
    }
}

/// Where a candidate came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    /// Drawn from the grammar prior.
    Prior,
    /// Produced by taste-guided MH refinement.
    Refined,
    /// Hand-edited on the panel and committed.
    Edited,
    /// Loaded from the built-in preset bank.
    Preset,
}

/// Give a tree its node identities on the way into the pool.
///
/// The pool is where a term stops being a search intermediate and becomes a
/// patch someone can open, lock, lay out and breed from, so it is exactly where
/// identities are worth minting — and the only place. Search itself hands
/// through thousands of anonymous trees per generation; a prior draw carries
/// none, and a tree restored from a save written before uids existed carries
/// none either, which is the whole of that migration: old saves deserialize
/// with every `uid` defaulted to unset and are settled here on the way in.
fn settled(mut tree: PatchTree) -> PatchTree {
    tree.ensure_uids();
    tree
}

/// A vetted pool member.
pub struct Candidate {
    /// Stable id (unique for the lifetime of the engine; survives pool
    /// reordering and eviction of *other* members).
    pub id: u64,
    /// The term.
    pub tree: PatchTree,
    /// Its extracted features.
    pub features: Features,
    /// Standardized feature vector (empty until the standardizer exists).
    pub phi_std: Vec<f64>,
    /// Content address of this candidate's `(term, spec)` featurization.
    /// Carried rather than recomputed because hashing the term is the one
    /// thing every cache path needs and the term never changes.
    pub key: String,
    /// The audition buffer, when resident. Governed by
    /// [`SessionConfig::render_policy`] — under [`RenderPolicy::Lazy`] this is
    /// `None` until [`Engine::render_of`] materializes it, and may go back to
    /// `None` when a newer audition evicts it. Never a signal that the
    /// candidate is unplayable; ask [`Engine::render_of`] for that.
    ///
    /// Shared with the memo (and with whoever last asked for it) through an
    /// [`Arc`] — one allocation per audition, however many holders it has.
    pub render: Option<Arc<Audition>>,
    /// Provenance.
    pub origin: Origin,
    /// User-given name (frontends fall back to `tree.signature()`).
    pub name: Option<String>,
    /// The generated name this patch was given, kept from then on (see
    /// [`Engine::fix_names`]). `None` until the bank is first handed over with
    /// [`NAME_FLOOR`] sounds in it, and for a patch with a name of its own.
    pub auto_name: Option<String>,
    /// The user asked to keep this one: [`Engine::insert_candidate`] will never
    /// evict it.
    ///
    /// Deliberately **not** derived from the star rating. A star is an
    /// observation that enters the log and moves θ; if a rating also decided
    /// what survives, users would rate strategically to protect patches, and
    /// every protective over-rating is a preference they never held — under
    /// exactly the pressure where they care most. So the two channels stay
    /// separate: stars are what you think, pins are what you keep.
    ///
    /// Capped by [`Engine::pin_cap`]; see there for why the pool cannot be
    /// pinned solid.
    pub pinned: bool,
    /// Kept as new and not yet in a pick: no eviction takes it.
    ///
    /// Set by [`Engine::commit_edit`] on the sound it admits (keep as new,
    /// and a shared patch imported through it), *after* the comparison that
    /// kept it is recorded: that comparison is part of keeping it, not a
    /// judgment of it. Cleared the first time the sound is one of the two in
    /// a recorded pick ([`Engine::record_duel`] and every other path through
    /// it, or a PERFORM offer answered, [`Engine::record_tree_duel`]),
    /// whichever side was picked. From then on it competes like any member.
    ///
    /// The other half of "the player made this": without it, a preset opened
    /// on a full pool replaced the sound just kept whenever the model rated
    /// it lowest, before the model had heard a single answer about it.
    ///
    /// Not a pin: it does not count against [`Engine::pin_cap`], it is not
    /// shown as saved, and at most [`Engine::unjudged_cap`] members carry it
    /// (a keep past the cap hands the oldest back to normal eviction).
    pub unjudged: bool,
}

impl Candidate {
    /// Whether no eviction may take this member on its own account: saved
    /// (pinned), or kept as new and not yet in a pick. The one rule
    /// [`Engine::insert_candidate`] and every eviction order apply.
    pub fn kept(&self) -> bool {
        self.pinned || self.unjudged
    }
}

/// One recorded evolution/edit step, for the lineage display.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LineageEvent {
    /// Generation counter at the time of the event (increments per
    /// `refine`/`refine_from` call).
    pub generation: usize,
    /// `"refine"` or `"edit"`.
    pub kind: String,
    /// Parent candidate id.
    pub parent_id: u64,
    /// Child candidate id.
    pub child_id: u64,
    /// What changed, in trace-address terms.
    pub diff: Vec<DiffEntry>,
    /// Parent posterior-mean utility at event time (0 with no posterior).
    pub parent_utility: f64,
    /// Child posterior-mean utility at event time.
    pub child_utility: f64,
}

/// A portable taste profile: the observation log **plus the standardizer its
/// φ vectors were standardized under**. θ is only meaningful relative to its
/// standardizer, so the two persist together.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Profile {
    /// The observation log (source of truth).
    pub log: ObservationLog,
    /// The standardizer under which every φ in the log was recorded.
    pub standardizer: Option<Standardizer>,
}

/// Tilt categorical proposal weights by taste: `w'_i ∝ w_i · exp(η·t_i)`,
/// with each multiplier clamped to `[1/4, 4]` so no kind is ever starved or
/// monopolized, and the result renormalized. Pure, so the taste→grammar
/// mapping is testable without an MCMC fit.
/// Shrink a posterior mean toward zero by its own uncertainty:
/// `θ·|θ|/(|θ| + σ)`.
///
/// The factor is 1 when the coefficient is many standard deviations from
/// zero, ½ when `σ = |θ|`, and →0 when the posterior is mostly prior. It is
/// the same shape as a signal-to-noise weighting, chosen over a hard
/// significance cut because a cut makes the proposal distribution jump
/// discontinuously as evidence accumulates, and users hear that as the
/// instrument changing its mind.
fn shrink(mean: f64, std: f64) -> f64 {
    let m = mean.abs();
    if m <= 0.0 {
        return 0.0;
    }
    mean * m / (m + std.max(0.0))
}

pub fn tilt_weights(base: &[f64], tilts: &[f64], eta: f64) -> Vec<f64> {
    let mut out: Vec<f64> = base
        .iter()
        .zip(tilts)
        .map(|(w, t)| w * (eta * t).exp().clamp(0.25, 4.0))
        .collect();
    let sum: f64 = out.iter().sum();
    if sum > 0.0 {
        for w in &mut out {
            *w /= sum;
        }
    }
    out
}

/// A restored entry with an unreadable take, waiting to land in the pool
/// (repaired) or be held ([`Engine::finish_restore`]).
#[derive(Clone, Debug)]
struct PendingHeld {
    /// As it was loaded, which is what a held sound is saved as.
    original: BankEntry,
    /// Already counted as repaired by the domain clamp.
    clamped: bool,
    /// As restore handed it on, which is what an absorbed entry carries.
    restored: PatchTree,
}

/// Why [`Engine::readmit_held`] did not bring a held sound back. A code, not
/// copy: the frontend says it in its own words.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadmitError {
    /// No held sound has that id.
    NotHeld,
    /// The take offered is empty, or could not be read itself.
    NoTake,
    /// The held sound has no unreadable take for it to replace.
    NothingToReplace,
    /// With the new take it still does not vet (its reason).
    DoesNotVet(String),
}

/// One bank entry of a saved session (renders and features are re-derived
/// on import — trees are the source of truth).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BankEntry {
    /// The candidate's stable id (preserved so lineage references stay
    /// meaningful).
    pub id: u64,
    /// The patch term.
    pub tree: PatchTree,
    /// Provenance.
    pub origin: Origin,
    /// User-given name.
    pub name: Option<String>,
    /// Whether the user pinned this patch against eviction.
    ///
    /// `#[serde(default)]` is what makes this change safe for sessions saved
    /// before pins existed: the record is one IndexedDB key with no schema
    /// version, so compatibility has to be by construction. An old session
    /// loads with nothing pinned, which is exactly what it meant.
    #[serde(default)]
    pub pinned: bool,
    /// The generated name it was shown under, so a reload does not read a new
    /// one off the restored pool. Absent from sessions saved before names were
    /// kept; those are named once, on restore ([`Engine::finish_restore`]).
    #[serde(default)]
    pub auto_name: Option<String>,
    /// Kept as new and not yet in a pick ([`Candidate::unjudged`]). Absent
    /// from sessions saved before it existed, which load as judged, and left
    /// out of the file when false, so a session with no such sound saves
    /// exactly as it did.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unjudged: bool,
}

/// An implicit preference signal, logged but (for now) not modeled: promote
/// events, hand-edit commits, per-patch play counts. Un-logged signal is
/// gone forever; modeling can come later.
///
/// The three optional fields carry the editor's stream (WS-8 §3). The single
/// most informative row in it is a **revert**: the player made an edit, heard
/// it, sat with it for a few seconds, and took it back. That is a preference
/// statement about a pair of patches neither of which is in the bank, at edit
/// granularity — far denser than the duel stream and the natural training set
/// for an edit-level model. It is unbuildable without a year of this log, and
/// the log is unbuildable retroactively, which is the whole argument for
/// writing it before anything reads it.
///
/// Deliberately **not** in the likelihood, exactly as the play counts already
/// here are not: a revert is confounded with curiosity, and the honest place
/// for it is a v2 fit that can be validated, not a silent term in the model
/// the player is being shown a number from.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ImplicitEvent {
    /// `"promote"`, `"play"`, `"edit"`, `"revert"`, `"commit"`, …
    pub kind: String,
    /// Candidate id the event is about (0 when it is about the bench, which
    /// is not a candidate until it is committed).
    pub id: u64,
    /// Magnitude (play counts, dwell in ms, 1 for point events).
    pub value: f64,
    /// Session index when it happened.
    pub session: usize,
    /// Free-form JSON detail: the `StructOp` and module kind for an edit, the
    /// query string for a link-drag search, the outcome of a commit. A string
    /// rather than a typed field per event kind, because the point of this log
    /// is to be *written* now and interpreted later — a schema fixed today is
    /// a schema that stops the next event kind from being logged at all.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub detail: String,
    /// Raw φ before the event, where the event is a transition (revert).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub phi_before: Vec<f64>,
    /// Raw φ after it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub phi_after: Vec<f64>,
}

/// What one posterior fit claimed for each style lens.
///
/// Recorded per fit and persisted, because the question it answers is about
/// **real sessions over time** and cannot be answered from one of them.
/// [`SessionConfig::k_styles`] documents an option that is deliberately not
/// taken — cap K at 3, taking the fit from 226 sites to 138 for a ~1.6×
/// mature-fit win — and gates it explicitly on whether lenses 4 and 5 sit near
/// zero share across real sessions. Nothing collected that, so the decision
/// could not be made either way; this is the collection.
///
/// It is deliberately not a judgment. A row says what the shares *were* at a
/// given evidence count, and how many lenses the fit was even allowed (`k`
/// grows with the log and is capped by config, so an early row with two lenses
/// is not evidence that lenses 3–5 are idle — it is evidence they did not
/// exist yet). Reading rows where `k == k_styles` is what the option needs.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StyleShareRecord {
    /// Observations in the log at the time of the fit.
    pub observations: usize,
    /// Lenses this fit was allowed — `min(1 + log/20, k_styles)`.
    pub k: usize,
    /// Share of the pool claimed by each lens, aligned, summing to ~1.
    pub shares: Vec<f64>,
}

/// A full saved session: everything needed to restore the app across a
/// reload — the portable profile plus the bank and its history.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionState {
    /// Log + standardizer.
    pub profile: Profile,
    /// The patch bank (trees, origins, names).
    pub bank: Vec<BankEntry>,
    /// Evolution/edit history.
    pub lineage: Vec<LineageEvent>,
    /// Generation counter.
    pub generation: usize,
    /// User-given style names (index = aligned style index).
    #[serde(default)]
    pub style_names: Vec<String>,
    /// Implicit preference events.
    #[serde(default)]
    pub events: Vec<ImplicitEvent>,
    /// Out-of-sample duel forecasts (calibration survives a reload).
    #[serde(default)]
    pub forecasts: Vec<Forecast>,
    /// Per-fit style shares — the evidence [`SessionConfig::k_styles`]' open
    /// option is gated on.
    #[serde(default)]
    pub style_shares: Vec<StyleShareRecord>,
    /// The taste map's axes as last drawn, so the map comes back after a
    /// reload facing the way it was left. Absent from sessions saved before
    /// it existed; their first map takes the sign convention.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map_axes: Option<[Vec<f64>; 2]>,
    /// The audition clip patches that listen are measured with, in its saved
    /// form (`auracle_features::SavedClip`: 16-bit samples in base64, at most
    /// `MAX_CLIP_SECONDS`, about 600 KB of text for five seconds of mono).
    /// Absent when the session measures with the built-in reference.
    ///
    /// Held as raw JSON and checked on the way in, not parsed as part of the
    /// session: a clip that cannot be read must cost the session its clip,
    /// never its bank and its log. An unreadable one restores as the
    /// reference, and [`Engine::audition_clip_status`] says why.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audition_clip: Option<serde_json::Value>,
    /// A sound of your own, as the coordinates of φ its file measures, by
    /// name ([`crate::own::OwnSound`]): never the audio. Absent from sessions
    /// saved before it existed, and from any without one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub own_sound: Option<crate::own::OwnSound>,
}

/// Which clip the patches that listen are measured with, as
/// [`Engine::audition_clip_status`] reports it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClipStatus {
    /// `reference` or `captured`.
    pub source: ClipSource,
    /// The clip's content id: what a listening patch's render key carries.
    pub id: String,
    /// Length, seconds.
    pub seconds: f64,
    /// 1 or 2.
    pub channels: usize,
    /// Set when the session file held a clip that could not be read, so the
    /// reference is measuring in its place: what was wrong with it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unreadable: Option<String>,
}

/// What [`Engine::set_audition_clip`] did to the pool.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ClipChange {
    /// Members that listen, measured again with the new clip.
    pub remeasured: Vec<u64>,
    /// Members that listen and no longer vet under it. They stay in the pool
    /// with the measurement they had (a clip change never deletes a patch);
    /// the caller says which.
    pub unmeasured: Vec<u64>,
}

/// A chosen duel, with the reasoning that produced it.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct DuelChoice {
    /// Pool index of candidate A.
    pub a: usize,
    /// Pool index of candidate B.
    pub b: usize,
    /// Expected information gain about θ, in nats (0 for random pairs).
    /// Bounded above by `ln 2 ≈ 0.693`, the entropy of a coin flip.
    pub info_gain: f64,
    /// True when this pair was drawn uniformly at random as a calibration
    /// check rather than chosen by the acquisition function.
    pub random_check: bool,
    /// How the pair was dealt: `"random"` (the random rule, or no posterior
    /// yet), `"check"` (a scheduled random probe under a choosing rule),
    /// `"thompson"` or `"bald"`.
    pub method: &'static str,
}

/// What a hand edit's commit reported about the edit against the original.
///
/// The type exists because the old `as_improvement: bool` could not say the
/// most informative thing a player can say. "I edited this, listened to both,
/// and the original was better" is a duel with a known answer — and under a
/// boolean it was **unrepresentable**: `false` meant "said nothing", so the
/// loss was silently discarded and the log only ever saw edits that won. A
/// preference log that records only successes is a biased sample of exactly
/// the kind the model has no defence against, and hand editing is the richest
/// signal in the app.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditOutcome {
    /// Nothing was claimed. Lineage still links the two; no observation.
    Untold,
    /// The player heard both and picked. `edited_won: false` is the losing
    /// direction — the half that used to be inexpressible.
    Heard {
        /// True when the edit beat the original.
        edited_won: bool,
    },
    /// The player asserted the edit is better without hearing them back to
    /// back (the express "my edit is better" checkbox). Same claim, weaker
    /// evidence, tagged so it can be scored separately.
    SelfReported,
}

impl EditOutcome {
    /// `(edited_won, provenance)` when this outcome makes a claim.
    pub fn told(&self) -> Option<(bool, Provenance)> {
        match self {
            EditOutcome::Untold => None,
            EditOutcome::Heard { edited_won } => Some((*edited_won, Provenance::HeardEdit)),
            EditOutcome::SelfReported => Some((true, Provenance::SelfReport)),
        }
    }
}

/// One feature's exact share of a candidate's utility.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Contribution {
    /// φ coordinate name.
    pub name: String,
    /// The lens's weight on it.
    pub theta: f64,
    /// The candidate's standardized value on it.
    pub phi_std: f64,
    /// `theta · phi_std` — this feature's signed share of the utility.
    pub contribution: f64,
}

/// Why the model scores one candidate the way it does.
///
/// Utility is **exactly linear within a style lens**, so this decomposition
/// is exact rather than a local surrogate: `Σ contribution = utility`. No
/// SHAP, no LIME, no approximation error to caveat.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Explanation {
    /// Candidate id.
    pub id: u64,
    /// Aligned index of the lens that claims this candidate.
    pub style: usize,
    /// That lens's user-given name (`""` if unnamed).
    pub style_name: String,
    /// Posterior-mean utility **under that lens** — exactly the sum of the
    /// contributions. This is the quantity the decomposition explains.
    pub utility: f64,
    /// Posterior std of that same lens utility — how sure the model is about
    /// this score.
    pub utility_std: f64,
    /// Posterior-mean **mixture** utility `E[max_k u_k]` — the number the
    /// bank is ranked by, and the one to show as *the score*.
    ///
    /// It is not the same number as `utility`, and it is never smaller: the
    /// ranking takes the max over lenses inside the expectation, while the
    /// decomposition necessarily fixes one lens first. Jensen's inequality
    /// does the rest. Showing `utility` next to a bank ordered by
    /// `mix_utility` would render a systematically lower number beside the
    /// row it is supposed to explain.
    pub mix_utility: f64,
    /// Posterior probability that `style` really is this candidate's best
    /// lens. Near 1, `utility ≈ mix_utility` and the explanation is the whole
    /// story; well below 1, the candidate sits between islands and the gap is
    /// worth surfacing rather than hiding.
    pub responsibility: f64,
    /// Every feature's contribution, sorted by descending magnitude.
    pub contributions: Vec<Contribution>,
}

fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

/// Binary entropy in nats, guarded at the ends.
fn binary_entropy(p: f64) -> f64 {
    let p = p.clamp(1e-12, 1.0 - 1e-12);
    -p * p.ln() - (1.0 - p) * (1.0 - p).ln()
}

/// Dueling Thompson sampling, kept for the acquisition A/B (see
/// [`Acquisition`]). Draw two posterior samples and duel each one's champion;
/// if they agree, duel the champion against the runner-up.
fn thompson_pair<R: Rng>(
    posterior: &TastePosterior,
    pool: &[Candidate],
    cands: &[usize],
    rng: &mut R,
) -> (usize, usize) {
    let n = posterior.samples.len();
    if n == 0 {
        return (cands[0], cands[1]);
    }
    let champion = |s: &auracle_taste::TasteSample, skip: Option<usize>| -> usize {
        cands
            .iter()
            .copied()
            .filter(|i| Some(*i) != skip)
            .max_by(|x, y| {
                s.utility_mix(&pool[*x].phi_std)
                    .total_cmp(&s.utility_mix(&pool[*y].phi_std))
            })
            .unwrap_or(cands[0])
    };
    let s1 = &posterior.samples[gen_index(rng, n)];
    let s2 = &posterior.samples[gen_index(rng, n)];
    let a = champion(s1, None);
    let b = champion(s2, None);
    if a == b {
        (a, champion(s2, Some(a)))
    } else {
        (a, b)
    }
}

/// A hashable fingerprint of a feature vector, for de-duplicating the
/// standardizer's reference sample. Bit patterns of the raw values: identical
/// candidates featurize deterministically, so exact equality is the right
/// test and rounding would only invent collisions.
fn quantize(row: &[f64]) -> Vec<u64> {
    row.iter().map(|x| x.to_bits()).collect()
}

/// Posterior-mean mixture utility of a standardized φ under `p` (0 with no
/// posterior, or for a member never standardized).
fn mix_utility(p: Option<&TastePosterior>, phi_std: &[f64]) -> f64 {
    match p {
        Some(p) if !phi_std.is_empty() => p.utility_mix(phi_std).0,
        _ => 0.0,
    }
}

/// Unordered key for a candidate pair.
fn pair_key(a: u64, b: u64) -> (u64, u64) {
    if a <= b {
        (a, b)
    } else {
        (b, a)
    }
}

/// The session engine.
/// Most rows the implicit-event stream keeps; older rows are dropped oldest
/// first. See `Engine::bound_events`.
pub const EVENTS_CAP: usize = 4096;
/// How many of the newest events keep their raw φ vectors. See
/// `Engine::bound_events`.
pub const EVENT_PHI_KEEP: usize = 256;
/// The fewest observations a τ session must hold before the next reload opens
/// another. See [`Engine::begin_session`].
pub const MIN_SESSION_OBS: usize = 5;
/// Observations per style lens a fit may use: a fit over `n` observations is
/// allowed `1 + n / OBS_PER_STYLE` lenses, up to [`SessionConfig::k_styles`].
/// See [`Engine::fit_posterior`]. Named because the app says it (LEARNING's
/// math reads it through `WasmEngine::model_facts`).
pub const OBS_PER_STYLE: usize = 20;

/// What the last refinement did — a child, or the reason there was none.
///
/// `refine_seed`/`refine_from` return `Option<u64>` because every caller
/// wants the child id and nothing else *on success*; on `None` they used to
/// be silent about why, and four different reasons hid behind one answer.
/// The one that mattered most was [`RefineOutcome::OutsideSupport`]: a seed
/// with `log p = −∞` under the grammar prior makes `EvolutionChain::init_from`
/// return `None` before a single step is taken, and that is not "the walk
/// found nothing" — it is "the walk never started", and the only fix is to
/// the patch, not to the budget.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefineOutcome {
    /// Nothing has been refined yet in this engine.
    Idle,
    /// A child was injected into the pool.
    Injected,
    /// No posterior or standardizer yet: there is no taste to refine toward.
    NoTaste,
    /// The seed id is not in the pool (evicted, or never there).
    UnknownSeed,
    /// The seed has zero mass under the grammar prior, so the chain cannot be
    /// started from it. Today that means a knob outside its domain, a tree
    /// deeper than the prior's support (a session saved by a build with the
    /// old ceilings), or a modulation fragment the grammar cannot score.
    OutsideSupport,
    /// The walk ran and ended where it started: no accepted move improved on
    /// the seed (or, under `RefineKeep::Last`, none was accepted at all).
    NoMove,
    /// The walk landed on a patch the pool already holds.
    Duplicate,
    /// The child was novel but ranked below the pool's worst member and was
    /// not admitted.
    NotAdmitted,
    /// The walk result is not the one the engine absorbs next: its generation
    /// was already finished (stopped, or replaced by a newer one), or it
    /// arrived ahead of an earlier job. Nothing changed. Results are absorbed
    /// strictly in job order, so a caller holds an early one until its turn.
    Stale,
}

impl RefineOutcome {
    /// The wire spelling (`snake_case`), for surfaces that speak strings.
    pub fn as_str(self) -> &'static str {
        match self {
            RefineOutcome::Idle => "idle",
            RefineOutcome::Injected => "injected",
            RefineOutcome::NoTaste => "no_taste",
            RefineOutcome::UnknownSeed => "unknown_seed",
            RefineOutcome::OutsideSupport => "outside_support",
            RefineOutcome::NoMove => "no_move",
            RefineOutcome::Duplicate => "duplicate",
            RefineOutcome::NotAdmitted => "not_admitted",
            RefineOutcome::Stale => "stale",
        }
    }
}

/// A generation between [`Engine::refine_jobs`] and its finish: what the
/// engine needs to absorb its results in job order and to retire what they
/// displaced at the end.
///
/// Not persisted. A reload mid-generation simply ends it: the children
/// already absorbed are in the bank, nothing has been retired, and the next
/// generation's finish evicts whatever the pool still owes.
struct OpenGeneration {
    /// The generation number its children are stamped with.
    generation: usize,
    /// The shared context, kept for the serial path ([`Engine::refine_seed`]).
    context: WalkContext,
    /// The jobs, in absorption order. Their seeds are what each child is
    /// diffed against and inherits node identities from.
    jobs: Vec<WalkJob>,
    /// Index of the next job to absorb.
    next: usize,
    /// Ids the end-of-generation eviction must spare besides pinned ones: the
    /// seed of a `⚡ evolve from this` absorbed while this generation is open.
    protect: HashSet<u64>,
}

/// How many dealt, unanswered check pairs the engine remembers (see
/// `Engine::pending_checks`). A duel is answered within a few deals; this only
/// bounds the pairs that never are.
pub const PENDING_CHECKS: usize = 32;

/// How many pairs dealt but not yet reported shown the engine remembers (see
/// `Engine::dealt_unshown`). The app holds at most a pair on the table, the
/// pair dealt ahead and a few re-deals of it; this only bounds the deals it
/// throws away.
pub const DEALT_UNSHOWN: usize = 8;

pub struct Engine {
    /// Configuration.
    pub cfg: SessionConfig,
    /// The patch prior.
    pub prior: PatchGrammarPrior,
    /// Standardizer fit on the first pool fill; persisted with the profile.
    pub standardizer: Option<Arc<Standardizer>>,
    /// The observation log (source of truth).
    pub log: ObservationLog,
    /// The current posterior, if fit (label-aligned).
    pub posterior: Option<Arc<TastePosterior>>,
    /// Current session index.
    pub session: usize,
    /// The candidate pool.
    pub pool: Vec<Candidate>,
    /// Evolution/edit history.
    pub lineage: Vec<LineageEvent>,
    /// Generation counter (one per refinement call).
    pub generation: usize,
    /// User-given style names (index = aligned style index; empty = unnamed).
    pub style_names: Vec<String>,
    /// Implicit preference events (logged, not yet modeled).
    pub events: Vec<ImplicitEvent>,
    /// Out-of-sample duel forecasts, scored before each answer was known.
    pub forecasts: Vec<Forecast>,
    /// Style shares recorded at each posterior fit. See [`StyleShareRecord`].
    style_shares: Vec<StyleShareRecord>,
    /// How many times each (unordered) candidate pair has been shown, keyed
    /// by stable id. Drives the repeat penalty in [`Engine::next_duel`].
    shown_pairs: HashMap<(u64, u64), u32>,
    /// How many times each candidate has been offered, by any pairing.
    shown_candidates: HashMap<u64, u32>,
    /// Pairs put in front of the player this run (not the same as
    /// observations recorded — the user may skip; not the same as pairs
    /// dealt — a deal ahead can be thrown away unseen). Paces the random check
    /// duels, so the calibration subsample is a fixed share of what the player
    /// was actually asked.
    duels_shown: usize,
    /// Pairs dealt by [`Engine::deal_duel_except`] and not yet reported shown
    /// by [`Engine::duel_shown`], oldest first, each with whether it was dealt
    /// as a random check. Bounded by [`DEALT_UNSHOWN`]: a deal the caller
    /// threw away is simply forgotten.
    dealt_unshown: VecDeque<((u64, u64), bool)>,
    /// Check pairs dealt and not yet answered, oldest first. An answer is
    /// scored as a random check when its pair was dealt as one — not only
    /// when it is the *last* pair dealt. The app records a vote after its
    /// seven-second undo window, by which time the next pair has usually been
    /// dealt, so matching the last pair alone tagged almost nothing: TRUST
    /// read "0 of 20" checks after 33 duels that were every one of them a
    /// uniform, i.e. check, pair. Bounded: a pair nobody answers is let go
    /// after [`PENDING_CHECKS`] more are dealt.
    pending_checks: VecDeque<(u64, u64)>,
    /// How many times the importance weights have collapsed and been
    /// resampled since the last full MCMC fit — the staleness signal behind
    /// [`Engine::needs_refit`].
    resamples_since_fit: usize,
    /// The featurization memo every featurize in this engine consults.
    memo: RenderMemo,
    /// Ids whose audition buffer is resident under [`RenderPolicy::Lazy`],
    /// least recently used first.
    audio_lru: VecDeque<u64>,
    /// Base seed of the indexed pool-draw stream ([`crate::farm`]). Taken from
    /// the caller's RNG on the first fill, so [`Engine::fill_pool_step`]'s
    /// signature — and the amount of that RNG's stream a fill consumes — stay
    /// what they were.
    fill_seed: Option<u64>,
    /// Next index of that stream the *fold* will consume. Advances only on
    /// absorption, which is what makes it independent of how many draws are in
    /// flight.
    draw_cursor: u64,
    /// Next index handed out by [`Engine::fill_draw`]. Runs ahead of
    /// `draw_cursor` by whatever is in flight; speculative distance between
    /// them is free, because an index that is never absorbed never happened.
    issue_cursor: u64,
    next_id: u64,
    /// What the last session restore had to mend — see
    /// [`Engine::repair_report`]. Saved terms whose knobs were out of range,
    /// log cells clamped, and observations dropped as uninterpretable.
    repaired_terms: usize,
    repaired_cells: usize,
    dropped_observations: usize,
    /// What the most recent `refine_seed`/`refine_from` did — see
    /// [`RefineOutcome`]. Not persisted: it describes a call, not a session.
    last_refine: RefineOutcome,
    /// The generation being absorbed, if one is open. See [`OpenGeneration`].
    open: Option<OpenGeneration>,
    /// `⚡ evolve from this` walks drawn and not yet absorbed or cancelled,
    /// by seed id: the context and job [`Engine::refine_from_job`] dealt, so
    /// [`Engine::refine_from_walk`] can walk that very job here. A seed in
    /// this table is never evicted (an edit's insert, a preset, a trim): a
    /// walk from a patch that left the pool meanwhile would be thrown away
    /// as `unknown_seed`. Not persisted: a walk in flight does not survive
    /// a reload.
    evolving: HashMap<u64, (WalkContext, WalkJob)>,
    /// What the last generation to finish retired ([`Engine::retired`]). Not
    /// persisted: it describes a call, like `last_refine`.
    retired: Vec<u64>,
    /// The taste map's axes as last drawn, so the next map faces the same way
    /// (see [`Engine::taste_map`]). Behind a lock because drawing the map is a
    /// read of the session, and remembering how it was drawn is not a change
    /// to it. Persisted with the session, so a reload does not mirror it either.
    pub(crate) map_axes: std::sync::Mutex<Option<[Vec<f64>; 2]>>,
    /// Why the last restore measured with the reference though the session
    /// held a clip; see [`ClipStatus::unreadable`].
    clip_unreadable: Option<String>,
    /// Sounds the last restore **held back**: a CAPTURE's take could not be
    /// read, and without it the sound did not render (the take was its only
    /// source). Never in the pool, so never dealt, fitted, mapped, wired or
    /// walked; written back by [`Engine::export_state`] JSON-equal to what was loaded, so
    /// a save loses none of them; brought back by [`Engine::readmit_held`].
    /// See [`Engine::held`].
    held: Vec<BankEntry>,
    /// During a restore: each bank entry with an unreadable take, as it was
    /// loaded, and whether it was already counted as repaired. One that
    /// lands in the pool is repaired; one still here at
    /// [`Engine::finish_restore`] is held. Keyed by id, but a list per id: a
    /// file can repeat an id, and one entry must never drop another.
    pending_held: HashMap<u64, Vec<PendingHeld>>,
    /// A sound of your own, if the player has brought one
    /// ([`crate::own`]). Persisted with the session as features only.
    pub(crate) own: Option<crate::own::OwnSound>,
}

impl Engine {
    /// Create an engine over the given prior.
    pub fn new(prior: PatchGrammarPrior, cfg: SessionConfig) -> Self {
        Self {
            cfg,
            prior,
            standardizer: None,
            log: ObservationLog::new(),
            posterior: None,
            session: 0,
            pool: Vec::new(),
            lineage: Vec::new(),
            generation: 0,
            style_names: Vec::new(),
            events: Vec::new(),
            forecasts: Vec::new(),
            style_shares: Vec::new(),
            shown_pairs: HashMap::new(),
            shown_candidates: HashMap::new(),
            duels_shown: 0,
            dealt_unshown: VecDeque::new(),
            pending_checks: VecDeque::new(),
            resamples_since_fit: 0,
            memo: RenderMemo::default(),
            audio_lru: VecDeque::new(),
            fill_seed: None,
            draw_cursor: 0,
            issue_cursor: 0,
            next_id: 1,
            repaired_terms: 0,
            repaired_cells: 0,
            dropped_observations: 0,
            last_refine: RefineOutcome::Idle,
            open: None,
            evolving: HashMap::new(),
            retired: Vec::new(),
            map_axes: std::sync::Mutex::new(None),
            clip_unreadable: None,
            held: Vec::new(),
            pending_held: HashMap::new(),
            own: None,
        }
    }

    /// Replace the featurization memo every featurize in this engine consults
    /// — fill, insert, restore, and the refinement surrogate.
    ///
    /// Shared rather than owned so a frontend can pre-load one and read back
    /// what the engine learned. A walk captures it by clone when it starts,
    /// and the memo never changes a result (a hit is bit-identical to a
    /// miss), so swapping it mid-generation only costs renders.
    pub fn set_memo(&mut self, memo: RenderMemo) {
        self.memo = memo;
    }

    /// The featurization memo.
    pub fn memo(&self) -> &RenderMemo {
        &self.memo
    }

    /// Content address of candidate `id`'s featurization.
    pub fn key_of(&self, id: u64) -> Option<&str> {
        self.find(id).map(|i| self.pool[i].key.as_str())
    }

    /// The audition buffer of candidate `id`, materializing it if
    /// [`RenderPolicy::Lazy`] deferred it.
    ///
    /// `None` for an unknown id, for [`RenderPolicy::None`], or for a term
    /// that no longer renders — a restored bank outlives the DSP that made it,
    /// and a caller that cannot distinguish "not yet" from "never" will wait
    /// forever. This is the *only* honest source of that answer.
    ///
    /// Bit-identical to the buffer the candidate's features were measured on
    /// ([`auracle_features::render_playback`]).
    ///
    /// Shared rather than copied: the pool, the memo and the caller all hold
    /// the same ~565 KB allocation through an [`Arc`], so a repeat request is
    /// a refcount bump. Callers that must own samples clone the inner value at
    /// their own call site, where the cost is visible.
    pub fn render_of(&mut self, id: u64) -> Option<Arc<Audition>> {
        let i = self.find(id)?;
        if let Some(a) = self.pool[i].render.clone() {
            if self.cfg.render_policy == RenderPolicy::Lazy {
                self.touch_audition(id);
            }
            return Some(a);
        }
        if self.cfg.render_policy != RenderPolicy::Lazy {
            // Eager already stored one at admission; None keeps nothing.
            return None;
        }
        let key = self.pool[i].key.clone();
        let audio = match self.memo.get_audio(&key) {
            Some(a) => a,
            None => Arc::new(
                render_playback(
                    &self.pool[i].tree,
                    &self.cfg.phrase,
                    self.pool[i].features.gain_db,
                )
                .ok()?,
            ),
        };
        self.pool[i].render = Some(Arc::clone(&audio));
        // `touch_audition` may evict other members but never `id`, which it
        // marks most-recently-used; the returned handle is valid regardless.
        self.touch_audition(id);
        Some(audio)
    }

    /// Mark `id`'s buffer as most recently used and drop whatever falls out of
    /// [`SessionConfig::audio_cache`].
    fn touch_audition(&mut self, id: u64) {
        // Evicted candidates leave their ids behind; dropping them here keeps
        // the cache from being consumed by ghosts and holding live buffers
        // past the cap.
        let live: HashSet<u64> = self.pool.iter().map(|c| c.id).collect();
        self.audio_lru.retain(|x| *x != id && live.contains(x));
        self.audio_lru.push_back(id);
        let cap = self.cfg.audio_cache.max(1);
        while self.audio_lru.len() > cap {
            let Some(evicted) = self.audio_lru.pop_front() else {
                break;
            };
            if let Some(i) = self.find(evicted) {
                self.pool[i].render = None;
            }
        }
    }

    /// Whether an admitting featurize should bother producing samples.
    ///
    /// Only [`RenderPolicy::Eager`] keeps a buffer, so under the other two
    /// policies asking for one would convert 141 k samples straight into a
    /// `drop`. This is the flag every `featurize_memo` call in the engine
    /// passes, and the reason the pool fill under `Lazy` costs φ only.
    fn wants_admitted_audio(&self) -> bool {
        self.cfg.render_policy == RenderPolicy::Eager
    }

    /// The audition buffer a freshly-admitted candidate should carry, per
    /// policy. `fresh` is the buffer the admitting featurize produced, if it
    /// rendered rather than hitting the memo.
    fn admitted_render(
        &self,
        tree: &PatchTree,
        features: &Features,
        fresh: Option<Arc<Audition>>,
    ) -> Option<Arc<Audition>> {
        match self.cfg.render_policy {
            RenderPolicy::Eager => fresh.or_else(|| {
                render_playback(tree, &self.cfg.phrase, features.gain_db)
                    .ok()
                    .map(Arc::new)
            }),
            RenderPolicy::Lazy | RenderPolicy::None => None,
        }
    }

    fn alloc_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Pool index of a candidate id.
    pub fn find(&self, id: u64) -> Option<usize> {
        self.pool.iter().position(|c| c.id == id)
    }

    /// Start a new session (its own τ latent). Returns its index.
    ///
    /// A new session opens only when the latest one holds at least
    /// [`MIN_SESSION_OBS`] observations; otherwise the latest is resumed. Every
    /// import path calls this, so before the rule each reload opened a τ site
    /// — `sites = d·K + n_sessions + 5` — and a once-per-visit voter
    /// accumulated one nuisance site per visit forever, each stealing
    /// single-site MH budget from θ. A threshold that a session cannot
    /// reasonably have earned is not a threshold worth its own latent; it is
    /// merged into the last one that was.
    pub fn begin_session(&mut self) -> usize {
        if !self.log.is_empty() {
            let n = self.log.n_sessions();
            let latest = n.saturating_sub(1);
            let in_latest = self
                .log
                .observations
                .iter()
                .filter(|o| o.session() == latest)
                .count();
            self.session = if in_latest >= MIN_SESSION_OBS {
                n
            } else {
                latest
            };
        }
        self.session
    }

    /// Fill the pool with vetted prior draws (up to `pool_size`). Fits the
    /// standardizer on the first successful fill.
    pub fn fill_pool<R: Rng>(&mut self, rng: &mut R) {
        let target = self.cfg.pool_size;
        while self.pool.len() < target {
            if self.fill_pool_step(rng, target - self.pool.len()) == 0 {
                break;
            }
        }
        // Fill fell short (vet failures exhausted the draw budget): fit the
        // standardizer on what we have rather than leaving φ un-standardized.
        if self.standardizer.is_none() && !self.pool.is_empty() {
            let rows: Vec<Vec<f64>> = self.pool.iter().map(|c| c.features.phi()).collect();
            self.standardizer = Some(Arc::new(Standardizer::fit(&rows)));
            for c in &mut self.pool {
                c.phi_std = self
                    .standardizer
                    .as_ref()
                    .unwrap()
                    .transform(&c.features.phi());
            }
            self.fix_names();
        }
    }

    /// Add up to `max_new` vetted candidates (bounded by `max_draws`
    /// attempts). Returns how many were added — the incremental unit that
    /// lets a frontend post progress between batches. Standardization runs
    /// once the pool first reaches `pool_size` (or on any later addition).
    ///
    /// This is the serial fold of the indexed draw stream ([`crate::farm`]):
    /// index `i` is consumed whatever its outcome, and dedupe / vetting decide
    /// only whether it *lands*. The farm path ([`Engine::fill_draw`] +
    /// [`Engine::absorb_prior`]) is the same fold with the render moved
    /// off-engine, so the two produce the same pool from the same
    /// `fill_seed` — and so does any chunking of `max_new`, because the cursor
    /// lives in the engine rather than in a loop variable.
    pub fn fill_pool_step<R: Rng>(&mut self, rng: &mut R, max_new: usize) -> usize {
        self.ensure_fill_seed(rng);
        let mut added = 0;
        while added < max_new
            && self.pool.len() < self.cfg.pool_size
            && self.draw_cursor < self.cfg.max_draws as u64
        {
            let index = self.draw_cursor;
            let Some(tree) = self.draw_at(index) else {
                break;
            };
            self.consume_draw(index);
            if self.pool.iter().any(|c| c.tree == tree) {
                continue;
            }
            if let Some(pre) = self.measure_draw(tree) {
                self.push_prior(pre);
                added += 1;
            }
        }
        self.standardize_pool();
        added
    }

    /// Render, vet and featurize a draw here, under this session's phrase
    /// (and so its audition clip) and memo: the serial fold's measurement,
    /// and the farm's fallback for a listener it measured under another clip
    /// ([`Engine::absorb_prior`]). `None` is a vet or compile failure.
    fn measure_draw(&self, tree: PatchTree) -> Option<PreFeaturized> {
        let want_audio = self.wants_admitted_audio();
        let (cached, audition) =
            featurize_memo(&tree, &self.cfg.phrase, &self.memo, want_audio).ok()?;
        Some(PreFeaturized {
            tree,
            cached,
            audition,
        })
    }

    // ------------------------------------------------------------------
    // The indexed draw stream and its off-engine fold (see `crate::farm`)
    // ------------------------------------------------------------------

    /// Base seed of this engine's pool-draw stream, taking one from `rng` if
    /// the stream has not started yet.
    ///
    /// Exactly one `u64` is drawn from the caller's RNG per engine, on the
    /// first fill. That is deliberate: the serial and farm paths consume the
    /// same amount of the caller's stream, so everything downstream of the
    /// fill that shares that RNG (duel selection, MCMC) stays aligned between
    /// them.
    pub fn ensure_fill_seed<R: Rng>(&mut self, rng: &mut R) -> u64 {
        match self.fill_seed {
            Some(s) => s,
            None => {
                let s = rng.gen::<u64>();
                self.fill_seed = Some(s);
                s
            }
        }
    }

    /// Base seed of the pool-draw stream, if it has started.
    pub fn fill_seed(&self) -> Option<u64> {
        self.fill_seed
    }

    /// Pin the pool-draw stream to an explicit base seed. Only meaningful
    /// before the first draw; a fill in progress keeps the seed it started on.
    pub fn set_fill_seed(&mut self, seed: u64) {
        if self.draw_cursor == 0 && self.issue_cursor == 0 {
            self.fill_seed = Some(seed);
        }
    }

    /// Next index of the draw stream the fold will consume.
    pub fn draw_cursor(&self) -> u64 {
        self.draw_cursor
    }

    /// The term at `index` of this engine's draw stream — a pure function of
    /// `(fill_seed, index)` and the prior, costing microseconds and no render.
    ///
    /// This is what makes a lost farm job re-issuable with no retained state:
    /// the job *is* its index.
    pub fn draw_at(&self, index: u64) -> Option<PatchTree> {
        let base = self.fill_seed?;
        let mut sub = StdRng::seed_from_u64(draw_seed(base, index));
        Some(self.prior.sample_with_rng(&mut sub))
    }

    /// Hand out up to `n` unrendered draws for off-engine featurization.
    ///
    /// Returns fewer than `n` — or nothing — when the pool has as much work
    /// outstanding as it can still use, or the `max_draws` budget is spent.
    /// An empty return is *not* by itself a stop signal: it may simply mean
    /// every slot the pool can still fill is already in flight. The caller
    /// stops when the pool reaches its target, or when an empty return
    /// coincides with nothing outstanding.
    ///
    /// Requires a started stream ([`Engine::ensure_fill_seed`] or
    /// [`Engine::set_fill_seed`]); yields nothing otherwise.
    pub fn fill_draw(&mut self, n: usize) -> Vec<Draw> {
        let mut out = Vec::new();
        if self.fill_seed.is_none() {
            return out;
        }
        let need = self.cfg.pool_size.saturating_sub(self.pool.len());
        if need == 0 {
            return out;
        }
        // Over-issue by a quarter for vet failures and duplicates, plus one so
        // a single remaining slot still gets a second attempt in flight. More
        // than that is not wrong — over-issue is discardable by construction —
        // just wasted work on a machine that could have been rendering
        // something the pool will keep.
        let ceiling = (need + need / 4 + 1) as u64;
        let outstanding = self.issue_cursor.saturating_sub(self.draw_cursor);
        let room = ceiling.saturating_sub(outstanding);
        for _ in 0..(n as u64).min(room) {
            if self.issue_cursor >= self.cfg.max_draws as u64 {
                break;
            }
            let index = self.issue_cursor;
            let Some(tree) = self.draw_at(index) else {
                break;
            };
            let dup = self.pool.iter().any(|c| c.tree == tree);
            self.issue_cursor = index + 1;
            out.push(Draw { index, tree, dup });
        }
        out
    }

    /// Fold one off-engine result into the pool.
    ///
    /// `index` **must** be [`Engine::draw_cursor`] — results are absorbed in
    /// index order, and that ordering is the entire determinism argument: the
    /// pool at index `i` is a pure function of indices `< i`, so it cannot
    /// depend on how many renders were running. Anything else is refused
    /// (returns `None` without consuming), because silently absorbing out of
    /// order would produce a pool no width reproduces.
    ///
    /// `pre` is `None` for a draw the farm rejected — a vet failure, a
    /// compile failure, or a result that failed to survive transport. The
    /// index is consumed either way, exactly as a failed draw burns an attempt
    /// in the serial loop.
    ///
    /// A draw that **listens** is the one exception: the farm measured it
    /// with whatever clip its phrase carried, and that is this session's
    /// measurement only if the result's key, which names the clip, is this
    /// session's. After a capture, or a restore that installed a clip, the
    /// farm can still be on the old phrase until it is sent the new one. So a
    /// listener with another key, or with no result (vetted out under another
    /// clip, perhaps), is measured here instead, exactly as the serial fold
    /// would have measured it. A draw that does not listen keys no clip and
    /// is taken as sent.
    ///
    /// Returns the new candidate id, or `None` when the draw did not land
    /// (rejected, duplicate, or the pool was already full).
    pub fn absorb_prior(&mut self, index: u64, pre: Option<PreFeaturized>) -> Option<u64> {
        if index != self.draw_cursor
            || self.pool.len() >= self.cfg.pool_size
            || index >= self.cfg.max_draws as u64
        {
            return None;
        }
        self.consume_draw(index);
        let pre = self.measured_here_if_stale(index, pre);
        let mut id = None;
        if let Some(pre) = pre {
            if !self.pool.iter().any(|c| c.tree == pre.tree) {
                id = Some(self.push_prior(pre));
            }
        }
        self.standardize_pool();
        id
    }

    /// `pre`, unless draw `index` listens and `pre` is not this session's
    /// measurement of it, in which case the draw measured here (see
    /// [`Engine::absorb_prior`]).
    fn measured_here_if_stale(
        &self,
        index: u64,
        pre: Option<PreFeaturized>,
    ) -> Option<PreFeaturized> {
        let current = |p: &PreFeaturized| {
            !p.tree.listens()
                || p.cached.key == auracle_features::render_key(&p.tree, &self.cfg.phrase)
        };
        match pre {
            Some(p) if current(&p) => Some(p),
            pre => {
                let tree = self.draw_at(index)?;
                if !tree.listens() {
                    return pre;
                }
                // A duplicate lands nowhere, so there is nothing to measure.
                if self.pool.iter().any(|c| c.tree == tree) {
                    return None;
                }
                self.measure_draw(tree)
            }
        }
    }

    /// Mark index `index` as folded in, whatever its outcome.
    fn consume_draw(&mut self, index: u64) {
        self.draw_cursor = index + 1;
        self.issue_cursor = self.issue_cursor.max(self.draw_cursor);
    }

    /// Admit a prior draw whose featurization is already done. The single push
    /// site for [`Origin::Prior`], shared by the serial and farm paths so
    /// there is no second copy of the admission rules to drift.
    fn push_prior(&mut self, pre: PreFeaturized) -> u64 {
        let PreFeaturized {
            tree,
            cached,
            audition,
        } = pre;
        // Fold the off-engine work into this engine's memo: a farm render is
        // exactly the artifact a later audition or refinement would otherwise
        // recompute, and the memo is where every other path looks for it.
        self.memo.put(cached.clone(), audition.clone());
        let id = self.alloc_id();
        let render = self.admitted_render(&tree, &cached.features, audition);
        self.pool.push(Candidate {
            id,
            tree: settled(tree),
            phi_std: Vec::new(),
            key: cached.key,
            render,
            features: cached.features,
            origin: Origin::Prior,
            name: None,
            auto_name: None,
            pinned: false,
            unjudged: false,
        });
        id
    }

    /// Fit the standardizer once the pool first reaches `pool_size`, then give
    /// every un-standardized member its φ_std. The tail of a fill step, lifted
    /// so the serial and farm paths run the identical bookkeeping.
    fn standardize_pool(&mut self) {
        if self.standardizer.is_none() && self.pool.len() >= self.cfg.pool_size {
            let rows: Vec<Vec<f64>> = self.pool.iter().map(|c| c.features.phi()).collect();
            self.standardizer = Some(Arc::new(Standardizer::fit(&rows)));
        }
        let Some(sz) = self.standardizer.clone() else {
            return;
        };
        for c in &mut self.pool {
            if c.phi_std.is_empty() {
                c.phi_std = sz.transform(&c.features.phi());
            }
        }
        self.fix_names();
    }

    /// Give every pool member a φ_std **now**, fitting a standardizer from
    /// the current pool if none exists yet — so a *partially filled* pool is
    /// already duel-able.
    ///
    /// [`Engine::fill_pool_step`] only fits once the pool reaches
    /// `pool_size`, and that single condition is what forces a frontend to sit
    /// out the entire fill before it can ask its first question:
    /// [`Engine::next_duel_full`] skips candidates whose `phi_std` is empty,
    /// so a half-filled pool contains no legal pair at all. This is the
    /// escape hatch a progressive boot needs — it costs no renders, only the
    /// mean/variance of what has already been drawn.
    ///
    /// It never *replaces* an existing standardizer. θ is only meaningful
    /// relative to the standardization its φ were measured under, so an
    /// imported profile's geometry has to survive a boot that tops the pool
    /// up ([`Engine::import_profile`]). Re-fitting is
    /// [`Engine::restandardize_if_untaught`]'s job, and it is only safe
    /// before a posterior exists.
    pub fn standardize_now(&mut self) {
        if self.pool.is_empty() {
            return;
        }
        if self.standardizer.is_none() {
            let rows: Vec<Vec<f64>> = self.pool.iter().map(|c| c.features.phi()).collect();
            self.standardizer = Some(Arc::new(Standardizer::fit(&rows)));
        }
        let sz = self.standardizer.clone().expect("just fit above");
        for c in &mut self.pool {
            if c.phi_std.is_empty() {
                c.phi_std = sz.transform(&c.features.phi());
            }
        }
        // The partial pool is handed over here, so this is where names are
        // first shown, and first kept once it holds `NAME_FLOOR` sounds; what
        // they are read against does not depend on how many it holds.
        self.fix_names();
    }

    /// Re-fit the standardizer over the finished pool — a no-op the moment a
    /// posterior exists.
    ///
    /// A progressive boot fits a *provisional* standardizer over the first
    /// handful of draws ([`Engine::standardize_now`]) so the user can start
    /// voting; the completed pool is a better reference population, and
    /// re-expressing φ on it is lossless because the log stores **raw**
    /// values (`refit_standardizer`'s rationale). But once θ has
    /// been fit, its coordinates are denominated in the standardizer that was
    /// live at fit time, and moving the scale under a live posterior would
    /// silently rescale every utility in the app. So this refuses in exactly
    /// that case: the next [`Engine::fit_posterior`] re-fits both together,
    /// in the order that keeps them consistent.
    pub fn restandardize_if_untaught(&mut self) {
        if self.posterior.is_none() {
            self.refit_standardizer();
        }
    }

    /// Re-fit the standardizer over everything the model is about to see: the
    /// raw φ in the log **and** the live pool.
    ///
    /// Fitting it once on the first 40 prior draws and freezing it meant that
    /// as the pool drifted toward refined candidates the z-scores drifted with
    /// it, and the linear model ended up extrapolating well outside the range
    /// it was calibrated on. Because the log now stores raw values, re-fitting
    /// is free and lossless — it re-expresses the same evidence on a scale
    /// that still matches where the data actually is.
    fn refit_standardizer(&mut self) {
        let names = phi_names();
        // The reference population is *the patches the user has encountered*,
        // each counted once — the live pool plus anything in the log that has
        // since been evicted. Deliberately not the multiset of comparisons:
        // acquisition decides which candidates get dueled repeatedly, and
        // letting that decide the coordinate system closes a feedback loop
        // between the question-asker and the units the answers are measured
        // in. Same reason the standardizer exists at all.
        let mut rows: Vec<Vec<f64>> = self.pool.iter().map(|c| c.features.phi()).collect();
        let mut seen: HashSet<Vec<u64>> = rows.iter().map(|r| quantize(r)).collect();
        for row in self.log.raw_rows(&names) {
            // Width guard, belt-and-braces: a ragged row reaches an assertion
            // inside `Standardizer::fit` and panics the whole engine. A log
            // that survived a bad migration should cost us that vote, not the
            // session.
            if row.len() == names.len() && seen.insert(quantize(&row)) {
                rows.push(row);
            }
        }
        if rows.is_empty() {
            return;
        }
        let sz = Arc::new(Standardizer::fit(&rows));
        for c in &mut self.pool {
            c.phi_std = sz.transform(&c.features.phi());
        }
        self.standardizer = Some(sz);
    }

    /// Fit (or re-fit) the taste posterior from the observation log. The
    /// stored posterior is label-aligned (safe for per-style summaries) and
    /// its importance weights are reset to uniform.
    pub fn fit_posterior<R: Rng>(&mut self, rng: &mut R) {
        if self.log.is_empty() {
            return;
        }
        self.refit_standardizer();
        let Some(sz) = self.standardizer.clone() else {
            return;
        };
        let names = phi_names();
        let d = names.len();
        // Style capacity grows with evidence: one lens per ~20 observations,
        // capped by config. Idle lenses collapse to ~0 share on their own,
        // so K is an upper bound the data may or may not use.
        let k = (1 + self.log.len() / OBS_PER_STYLE)
            .min(self.cfg.k_styles)
            .max(1);
        let mut taste_cfg = TasteConfig::mixture(d, k);
        taste_cfg.recency_half_life = self.cfg.recency_half_life;
        // The brightness cluster shares a latent mean per style. Resolved by
        // *name* here because this is the layer that knows them; the taste
        // crate is handed indices and never learns what they mean. A name that
        // is not in φ simply does not join the group, so a stimulus-tag bump
        // or a dropped column degrades to the flat prior rather than panicking
        // or silently fusing the wrong coordinate.
        let bright: Vec<usize> = ["rolloff_mean", "zcr_mean", "centroid_mean"]
            .iter()
            .filter_map(|want| names.iter().position(|n| n.split(':').next() == Some(want)))
            .collect();
        if bright.len() > 1 {
            taste_cfg.fused = vec![bright];
        }
        let model = TasteModel::new(taste_cfg);
        let data = FitSet::build(&self.log, &names, &sz);
        let posterior = model.fit(rng, &data, self.cfg.mcmc_samples, self.cfg.mcmc_warmup);
        // Aligned to the **previous** fit's lenses, not merely to itself. MCMC
        // has no reason to return the lenses in the same order twice — with
        // probability ≈ 1 − 1/K! two consecutive fits disagree — and everything
        // keyed by lens index (`style_names`, the style shares, the panel's
        // lens colours) would silently attach to a different taste after every
        // refit. Lens `i` now stays the lens that most resembles the old lens
        // `i`; a lens added because the log grew takes an index the old fit
        // did not claim, so no name has to move.
        let reference: Vec<Vec<f64>> = self
            .posterior
            .as_ref()
            .filter(|p| p.cfg.n_features == d)
            .map(|p| (0..p.k_styles()).map(|k| p.theta_mean(k)).collect())
            .unwrap_or_default();
        let posterior = Arc::new(posterior.aligned_to(&reference));
        // Measured against the pool the fit is about to be used on, which is
        // the population the shares are a statement about — not against the
        // log, whose φ are the things already judged.
        let pool_phis: Vec<Vec<f64>> = self
            .pool
            .iter()
            .filter(|c| !c.phi_std.is_empty())
            .map(|c| c.phi_std.clone())
            .collect();
        if !pool_phis.is_empty() {
            self.style_shares.push(StyleShareRecord {
                observations: self.log.len(),
                k,
                shares: posterior.style_share(&pool_phis),
            });
        }
        self.posterior = Some(posterior);
        self.resamples_since_fit = 0;
    }

    /// Style shares recorded at each fit, oldest first. See
    /// [`StyleShareRecord`].
    pub fn style_shares(&self) -> &[StyleShareRecord] {
        &self.style_shares
    }

    /// Effective sample size of the current posterior's importance weights —
    /// how much of the draw set still carries information after the
    /// observations folded in since the last full fit. `None` before the
    /// first fit.
    pub fn posterior_ess(&self) -> Option<f64> {
        self.posterior.as_ref().map(|p| p.ess())
    }

    /// True when the cheap between-fit updates have run out of road and a
    /// full MCMC refit is worth its seconds: the weights have collapsed
    /// (ESS below half the draws) at least once since the last fit, or the
    /// log has evidence no posterior has seen. A frontend can drive refits
    /// off this instead of a fixed vote count.
    pub fn needs_refit(&self) -> bool {
        match &self.posterior {
            Some(_) => self.resamples_since_fit > 0,
            None => !self.log.is_empty(),
        }
    }

    /// Posterior-mean mixture utility of a standardized φ (0 with no
    /// posterior).
    pub fn utility_of(&self, phi_std: &[f64]) -> f64 {
        match &self.posterior {
            Some(p) if !phi_std.is_empty() => p.utility_mix(phi_std).0,
            _ => 0.0,
        }
    }

    /// Did the step from `prev` to `next` touch any locked address?
    /// "Touch" = change its value, delete it, **or create it** (structure
    /// moves that would rewrite a locked module's path are rejected too —
    /// locked means *don't touch*).
    ///
    /// Both directions are checked, and that is not pedantry. Scanning only
    /// `prev` lets a *birth* at a locked address through while rejecting the
    /// death that would undo it. The constraint region is then asymmetric —
    /// x → x′ allowed, x′ → x rejected — which breaks detailed balance and
    /// makes the Metropolis-within-Gibbs argument for locking being exact
    /// simply false. The chain would drift into locked structure it can never
    /// leave.
    ///
    /// **What this does and does not guarantee.** `locked` is a set of exact
    /// address strings, typically snapshotted from the UI. Every address in
    /// it is frozen, in both directions, and *that* is exact. It is not the
    /// same as freezing a module: a structural move that grows a brand-new
    /// address inside a locked module — one that was in neither trace when
    /// the set was taken, so it cannot be in the set — is not caught. That
    /// case is symmetric (unmatched by construction in both directions), so
    /// it costs nothing in detailed balance; it just means "locked" is a
    /// guarantee about *addresses*, not about subtrees.
    pub fn violates_locks(prev: &Trace, next: &Trace, locked: &HashSet<String>) -> bool {
        crate::walk::violates_locks(prev, next, locked)
    }

    /// Grammar prior with kind-weights tilted toward the fitted taste: each
    /// structural θ component (share-weighted across styles) multiplies its
    /// kind's weight by `exp(η·θ)`. This is θ_struct → grammar feedback —
    /// refinement *proposes* toward the user instead of merely filtering,
    /// which is where visible directionality comes from.
    ///
    /// **It tilts the target, not only the proposal**, and that has to be said
    /// plainly because the reference once said the opposite. The result is
    /// installed as the prior of the `EvolutionModel`, whose target is
    /// `prior.model() + factor(β·f)`; fugue's categorical proposal is a
    /// resample from that same prior, so the Hastings terms cancel and the
    /// chain is a correct MH sampler for `π' ∝ p_tilted(x) · exp(β·u(x))` — a
    /// *different* stationary distribution from the untilted `π_β`. The seed
    /// is scored under the same tilted prior, `RefineKeep::Best` ranks under
    /// it, and the parsimony mass the walk climbs is the tilted one. A tilt
    /// that left the target alone would need a custom site proposal with its
    /// own Hastings correction, which fugue 0.2.2 does not offer for `usize`
    /// sites (only `PriorResample`). Since refinement hill-climbs rather than
    /// samples, the practical effect is the one intended — the climb finds the
    /// kinds the listener likes sooner — but what "best" means is under the
    /// tilted prior.
    ///
    /// Two things make the mapping from φ names to grammar weights less than
    /// a lookup, and both are consequences of φ carrying **families**
    /// (`auracle_features::StructFeatures`):
    ///
    /// - Several kinds share one coefficient. `n_drive` speaks for the
    ///   wavefolder, the distortion, the bitcrusher and the ring modulator;
    ///   `n_mod_fx` for the chorus, phaser, flanger, tremolo and vibrato;
    ///   `n_time` for the delay, the granulator and the pitch shifter;
    ///   `n_filter` for the filter, the EQ and the vocoder; `n_dynamics` for
    ///   the compressor, the ducker and the gate. They each get the family's
    ///   tilt, which is the honest reading: the evidence never distinguished
    ///   them, so the proposal should not pretend it did. Their *base* weights
    ///   still differ, so the tilt shifts the family without flattening it.
    /// - `n_mix` is not in φ at all — it is determined by the source count and
    ///   the other five binary counts under the exact identity that removed it
    ///   — so its tilt comes from the sources: wanting more sources is wanting
    ///   more binary nodes to combine them, and that is the only sense in
    ///   which the taste model has an opinion here. The other five binaries
    ///   take the tilt of whichever family they are counted under.
    ///
    /// Each coefficient is also **shrunk by its own posterior uncertainty**,
    /// `θ·|θ|/(|θ| + σ)`, before it tilts anything. The new palette's
    /// coefficients are the least identified ones in the model — a pool of 48
    /// draws contains a handful of bitcrushers — so a raw posterior mean is
    /// as likely to be sampling noise as signal, and feeding noise into the
    /// *proposal* distribution compounds it: the pool drifts toward the
    /// spurious kind, which produces more evidence about it, which is not the
    /// same as producing more evidence *for* it. A coefficient whose σ equals
    /// its mean tilts half as hard; one that is mostly noise tilts not at all.
    pub(crate) fn biased_prior(&self) -> PatchGrammarPrior {
        let mut prior = self.prior.clone();
        let eta = self.cfg.proposal_tilt;
        let Some(p) = &self.posterior else {
            return prior;
        };
        if eta <= 0.0 {
            return prior;
        }
        let names = Features::phi_names();
        let pool_phis: Vec<Vec<f64>> = self
            .pool
            .iter()
            .filter(|c| !c.phi_std.is_empty())
            .map(|c| c.phi_std.clone())
            .collect();
        let shares = p.style_share(&pool_phis);
        let (mut theta, mut sd) = (vec![0.0; names.len()], vec![0.0; names.len()]);
        for k in 0..p.k_styles() {
            let w = shares.get(k).copied().unwrap_or(0.0);
            for (t, mi) in theta.iter_mut().zip(p.theta_mean(k)) {
                *t += w * mi;
            }
            for (s, si) in sd.iter_mut().zip(p.theta_std(k)) {
                *s += w * si;
            }
        }
        let g = |name: &str| {
            names
                .iter()
                .position(|n| *n == name)
                .map(|i| shrink(theta[i], sd[i]))
                .unwrap_or(0.0)
        };
        let sources = [
            g("n_vco"),
            g("n_supersaw"),
            g("n_noise"),
            g("n_wavetable"),
            g("n_pluck"),
            g("n_formant"),
            // `Silence` is deliberately **not** tilted by taste, and this zero
            // is the whole of that decision. The tilt exists to move proposals
            // toward source kinds the listener is enjoying; a hole is not a
            // timbre anyone can enjoy, it is the absence of one, and its
            // prevalence is meant to come from a player unplugging a socket
            // rather than from a fitted coefficient.
            //
            // It is also the column where a tilt would be least trustworthy.
            // At a 0.5% prior rate `n_silence` is zero in nearly every row a
            // fit sees — the near-indicator shape that kept `n_ringmod` out of
            // φ as a column of its own. `shrink` would damp a spurious
            // coefficient, but the multiplier it feeds is exponential, and
            // amplifying holes into the pool is a failure a listener notices
            // immediately.
            0.0,
            // `AudioIn` is not tilted either. It is a player kind
            // (`SourceKind` in the grammar's prior): its sampling weight is 0,
            // so no generation draws one and no multiplier could move it.
            // Whether a patch listens is the player's choice, made by patching
            // one in, and it has no φ column a coefficient could be read from.
            0.0,
        ];
        let src = tilt_weights(&prior.source_weights, &sources, eta);
        prior.source_weights = src.try_into().expect("source weight arity");
        // Mix inherits the sources' average tilt — it is the node that exists
        // to combine them, and it is the one column the identity removed.
        //
        // Wave 3 tried to replace this proxy with a measurement: a
        // `branch_width_max` φ coordinate, so that "I like parallel routing"
        // would be a thing a user could say and this line could hand back. The
        // VIF sweep threw the column out (10.4, and it took every source count
        // with it), and the reason is the same identity that removed `n_mix`
        // in the first place — the leaf count is `1 + Σ binaries` exactly, so
        // a patch cannot gain a mixer without gaining a source. Which means
        // this proxy was never a proxy. Wanting more sources *is* wanting more
        // binaries, as an equation, and the average below is reading the
        // evidence for both. The wave-3 coordinates that did survive
        // (`chain_balance`, `frac_sidechained`, `mod_at_source`) describe how
        // a patch is arranged rather than how wide it is, and none of them
        // maps onto a single production's weight, so none of them belongs
        // here: a tilt is a claim about one categorical outcome, and
        // "asymmetric" is not an outcome any one production produces.
        //
        // Averaged over the seven kinds the table had before AUDIO IN, not
        // all eight: the input's untilted zero joining the mean would shift
        // every session's mixer tilt by an eighth without anything about the
        // listener having changed. (Silence's zero has been in the mean since
        // it arrived, so leaving it there moves nothing.)
        let binary_tilt = sources[..7].iter().sum::<f64>() / 7.0;
        let (drive, mod_fx) = (g("n_drive"), g("n_mod_fx"));
        // `n_filter` and `n_time` are families now too — the eq and the
        // vocoder are counted under the first, the granulator and the pitch
        // shifter under the second — so every member of each takes the same
        // tilt, exactly as the drive and movement families already did.
        let (spectral, time) = (g("n_filter"), g("n_time"));
        // Wave 2B's three level-shapers share one coefficient for the same
        // reason: the evidence never distinguished a compressor from a ducker
        // from a gate, so the proposal must not pretend it did.
        let dynamics = g("n_dynamics");
        let op = tilt_weights(
            &prior.op_weights,
            &[
                binary_tilt,   // mix
                spectral,      // filter
                drive,         // fold
                time,          // delay
                mod_fx,        // chorus
                g("n_reverb"), // reverb
                drive,         // distortion
                drive,         // bitcrush
                mod_fx,        // phaser
                drive,         // ring mod — counted inside n_drive
                mod_fx,        // flanger
                mod_fx,        // tremolo
                mod_fx,        // vibrato
                spectral,      // eq — counted inside n_filter
                time,          // granular — counted inside n_time
                time,          // pitch shift — counted inside n_time
                dynamics,      // compressor
                dynamics,      // ducker
                dynamics,      // gate
                spectral,      // vocoder — counted inside n_filter
            ],
            eta,
        );
        prior.op_weights = op.try_into().expect("op weight arity");
        // "no modulation" carries no tilt — only the filled kinds compete.
        // Wave 2C's three take their family's coefficient, on the same rule as
        // the op table: the euclidean generator and the two recursive
        // productions are all counted inside `n_mod_logic` or `n_mod_shape`,
        // and the evidence never separated a quantizer from a slew limiter.
        //
        // `Op` reads `n_mod_shape` and `Pair` reads `n_mod_logic`, but the
        // euclid — which is a *leaf* — reads `n_mod_logic` too, because that
        // is the column it is counted in. Tilting it by anything else would
        // move the prior in a direction no observation supports.
        //
        // The step sequencer reads `n_rand` for the same reason: that column
        // is the stepped-CV family and counts it (`StructFeatures::n_stepped`),
        // so a user whose votes lean toward stepped modulation tilts the S&H
        // and the step sequence together, and nothing tilts it that has not
        // seen it.
        let (shape, logic, stepped) = (g("n_mod_shape"), g("n_mod_logic"), g("n_rand"));
        let md = tilt_weights(
            &prior.mod_weights,
            &[
                0.0,
                g("n_lfo"),
                g("n_env"),
                stepped,
                g("n_follow"),
                logic,   // euclid — counted inside n_mod_logic
                shape,   // op
                logic,   // pair
                stepped, // steps — counted inside n_rand
            ],
            eta,
        );
        prior.mod_weights = md.try_into().expect("mod weight arity");
        prior
    }

    /// Posterior probability that pool member `a` beats `b` in a duel
    /// (`None` before the first fit).
    pub fn predict_duel(&self, a: usize, b: usize) -> Option<f64> {
        let p = self.posterior.as_ref()?;
        let (pa, pb) = (&self.pool[a].phi_std, &self.pool[b].phi_std);
        if pa.is_empty() || pb.is_empty() {
            return None;
        }
        Some(p.prob_prefers(pa, pb))
    }

    /// Log an implicit preference event (promote, play time, …). Logged
    /// only — not yet part of the likelihood.
    pub fn log_event(&mut self, kind: &str, id: u64, value: f64) {
        self.log_event_detail(kind, id, value, "", Vec::new(), Vec::new());
    }

    /// The same, carrying the editor's detail and (for a transition) the raw
    /// φ on both sides of it. See [`ImplicitEvent`] for why the detail is an
    /// opaque string and why none of this reaches the likelihood.
    pub fn log_event_detail(
        &mut self,
        kind: &str,
        id: u64,
        value: f64,
        detail: &str,
        phi_before: Vec<f64>,
        phi_after: Vec<f64>,
    ) {
        self.events.push(ImplicitEvent {
            kind: kind.into(),
            id,
            value,
            session: self.session,
            detail: detail.into(),
            phi_before,
            phi_after,
        });
        self.bound_events();
    }

    /// Keep the implicit-event stream bounded: at most [`EVENTS_CAP`] rows,
    /// and raw φ on only the newest [`EVENT_PHI_KEEP`] rows that carry it.
    ///
    /// The stream is serialized into every autosave and grew forever, two
    /// 41-coordinate vectors at a time for every edit, revert and play flush.
    /// Nothing reads it yet — it exists to be fitted on later — so the shape
    /// of the corpus matters more than any one row's φ: the event rows stay
    /// (kind, id, value, detail) far longer than their vectors do, and the
    /// vectors are the part that costs.
    fn bound_events(&mut self) {
        if self.events.len() > EVENTS_CAP {
            let excess = self.events.len() - EVENTS_CAP;
            self.events.drain(..excess);
        }
        let mut with_phi = 0usize;
        for e in self.events.iter_mut().rev() {
            if e.phi_before.is_empty() && e.phi_after.is_empty() {
                continue;
            }
            with_phi += 1;
            if with_phi > EVENT_PHI_KEEP {
                e.phi_before = Vec::new();
                e.phi_after = Vec::new();
            }
        }
    }

    /// Name (or rename; empty clears) an aligned style index.
    pub fn set_style_name(&mut self, k: usize, name: &str) {
        if k >= 16 {
            return;
        }
        if self.style_names.len() <= k {
            self.style_names.resize(k + 1, String::new());
        }
        self.style_names[k] = name.trim().chars().take(24).collect();
    }

    /// How many distinct candidate pairs the exposure tally currently tracks.
    /// A diagnostic: the tally is pruned on eviction, and this is how a test
    /// sees that it was.
    pub fn shown_pairs_len(&self) -> usize {
        self.shown_pairs.len()
    }

    /// The candidate ids the exposure tally currently tracks. A diagnostic,
    /// as [`Engine::shown_pairs_len`].
    pub fn shown_candidate_ids(&self) -> Vec<u64> {
        self.shown_candidates.keys().copied().collect()
    }

    /// What the most recent absorption did ([`Engine::refine_absorb`],
    /// [`Engine::refine_seed`], [`Engine::refine_from`] and its job/absorb
    /// pair). [`RefineOutcome::Idle`] until one has run.
    pub fn last_refine(&self) -> RefineOutcome {
        self.last_refine
    }

    /// Insert a hand-made candidate — an edit or a preset — evicting the worst
    /// member at once if the pool is full (never `protect`, never a kept one,
    /// [`Candidate::kept`]: saved, or kept as new and not yet in a pick; never
    /// the seed of a ⚡ walk in flight). It always lands when anything is evictable: the player asked for
    /// it. Refined children do not come here; they must earn their slot and
    /// wait for the generation's end ([`Engine::admit_refined`]).
    fn insert_candidate(
        &mut self,
        tree: PatchTree,
        origin: Origin,
        protect: Option<u64>,
    ) -> Option<u64> {
        let standardizer = self.standardizer.as_ref()?;
        // Memoized: refinement and the edit bench both featurize the tree they
        // hand here, so on every one of those paths this is a hit.
        let want_audio = self.wants_admitted_audio();
        let (cf, fresh) = featurize_memo(&tree, &self.cfg.phrase, &self.memo, want_audio).ok()?;
        let phi_std = standardizer.transform(&cf.features.phi());
        if self.pool.len() >= self.cfg.pool_size {
            // Rank un-standardized members as *worst*, explicitly, rather
            // than letting `utility_of` score them 0.0 and land them
            // mid-pack above genuinely-disliked patches. Today this cannot
            // happen — the `?` above means a standardizer exists, and every
            // path that admits a candidate under one also transforms its φ —
            // but that is an invariant three functions away, and the same
            // "empty φ scores exactly zero" reasoning already produced one
            // live bug in duel selection. Cheaper to be unconditionally right
            // here than to rely on the invariant holding after the next edit.
            let rank = |c: &Candidate| (!c.phi_std.is_empty(), self.utility_of(&c.phi_std));
            let worst = self
                .pool
                .iter()
                .enumerate()
                .filter(|(_, c)| {
                    Some(c.id) != protect && !c.kept() && !self.evolving.contains_key(&c.id)
                })
                .min_by(|(_, x), (_, y)| {
                    let (sx, ux) = rank(x);
                    let (sy, uy) = rank(y);
                    sx.cmp(&sy).then(ux.total_cmp(&uy))
                })
                .map(|(i, _)| i);
            let worst_idx = worst?;
            let gone = self.pool[worst_idx].id;
            self.pool.swap_remove(worst_idx);
            // The exposure tallies are about candidates that can still be
            // dealt; an evicted id can never be, and keeping its rows made both
            // maps grow with every eviction for the life of the session.
            self.shown_pairs
                .retain(|(a, b), _| *a != gone && *b != gone);
            self.shown_candidates.remove(&gone);
        }
        let id = self.alloc_id();
        let render = self.admitted_render(&tree, &cf.features, fresh);
        self.pool.push(Candidate {
            id,
            tree: settled(tree),
            phi_std,
            key: cf.key,
            render,
            features: cf.features,
            origin,
            name: None,
            auto_name: None,
            pinned: false,
            unjudged: false,
        });
        self.fix_names();
        Some(id)
    }

    /// The pool members an eviction takes first, lowest first: every member
    /// that is neither kept ([`Candidate::kept`]: saved, or kept as new and
    /// not yet in a pick) nor in `protect`, ranked by `(standardized,
    /// utility)` ascending, utility under `judge` — a member without φ_std
    /// ranks worst explicitly, for the reason [`Engine::insert_candidate`]
    /// gives. Ties keep pool order, so the first of equals goes first, which
    /// is the member `min_by` picked when eviction happened one child at a
    /// time.
    fn eviction_order(&self, protect: &HashSet<u64>) -> Vec<(usize, f64)> {
        let judge = self.judge();
        self.eviction_order_by(protect, |i| mix_utility(judge, &self.pool[i].phi_std))
    }

    /// [`Engine::eviction_order`] with each member's utility given by pool
    /// index rather than taken under [`Engine::judge`]: a generation not yet
    /// opened would rank under the posterior it would open with, the current
    /// one.
    fn eviction_order_by(
        &self,
        protect: &HashSet<u64>,
        utility: impl Fn(usize) -> f64,
    ) -> Vec<(usize, f64)> {
        let mut rows: Vec<(usize, bool, f64)> = self
            .pool
            .iter()
            .enumerate()
            .filter(|(_, c)| {
                !c.kept() && !protect.contains(&c.id) && !self.evolving.contains_key(&c.id)
            })
            .map(|(i, c)| (i, !c.phi_std.is_empty(), utility(i)))
            .collect();
        rows.sort_by(|a, b| a.1.cmp(&b.1).then(a.2.total_cmp(&b.2)));
        rows.into_iter().map(|(i, _, u)| (i, u)).collect()
    }

    /// The posterior a generation's admissions and retirements are judged
    /// under: while a generation is open, the one it opened with (its
    /// context's), not the one picks made since have reweighted. Which
    /// children are kept, and which members they displace, then do not
    /// depend on when the picks landed relative to the walks — the pool is
    /// the one the serial path would have bred with the picks after it. With
    /// no generation open, or if the scale has changed under it (a refit the
    /// app does not allow meanwhile), the current posterior.
    fn judge(&self) -> Option<&TastePosterior> {
        if let (Some(open), Some(st)) = (&self.open, &self.standardizer) {
            if Arc::ptr_eq(st, &open.context.standardizer) {
                return Some(&open.context.posterior);
            }
        }
        self.posterior.as_deref()
    }

    /// Posterior-mean mixture utility of a standardized φ under `judge`
    /// (0 with no posterior).
    fn judged_utility(&self, phi_std: &[f64]) -> f64 {
        mix_utility(self.judge(), phi_std)
    }

    /// Admit a refined child **without evicting anyone yet**. Returns the new
    /// id, or `None` if the child does not earn a slot.
    ///
    /// The bar is the one eviction-per-child always set: a refined child must
    /// beat the member it would displace. It is computed against the pool as
    /// it will stand once the evictions already owed are paid — with `e`
    /// evictions owed after this child is in, the child must beat the `e`-th
    /// lowest evictable member, which is exactly the member per-child eviction
    /// would be comparing it with at this point. So the children admitted and
    /// the members finally retired are the ones per-child eviction chose
    /// (`deferred_eviction_retires_what_per_child_eviction_did` pins it). What
    /// moves is *when* the retirees leave — at [`Engine::refine_finish`] — so
    /// a save made while the generation runs protects its patch, and a row the
    /// player is looking at does not vanish half way through.
    fn admit_refined(&mut self, tree: PatchTree, protect: &HashSet<u64>) -> Option<u64> {
        let standardizer = self.standardizer.as_ref()?;
        // Memoized: the walk featurized the state it ended on, and a farm
        // walk's result puts that featurization here before this runs.
        let want_audio = self.wants_admitted_audio();
        let (cf, fresh) = featurize_memo(&tree, &self.cfg.phrase, &self.memo, want_audio).ok()?;
        let phi_std = standardizer.transform(&cf.features.phi());
        let mean_new = self.judged_utility(&phi_std);
        let owed = (self.pool.len() + 1).saturating_sub(self.cfg.pool_size);
        if owed > 0 {
            // Fewer evictable members than evictions owed: nothing can make
            // room, as when every candidate for eviction was pinned.
            let (_, bar) = *self.eviction_order(protect).get(owed - 1)?;
            if mean_new <= bar {
                return None;
            }
        }
        let id = self.alloc_id();
        let render = self.admitted_render(&tree, &cf.features, fresh);
        self.pool.push(Candidate {
            id,
            tree: settled(tree),
            phi_std,
            key: cf.key,
            render,
            features: cf.features,
            origin: Origin::Refined,
            name: None,
            auto_name: None,
            pinned: false,
            unjudged: false,
        });
        self.fix_names();
        Some(id)
    }

    /// Retire the lowest evictable members until the pool is back to
    /// `pool_size`, or nothing evictable is left. Returns the retired ids,
    /// lowest first. Removal keeps the survivors' order.
    pub(crate) fn evict_to_size(&mut self, protect: &HashSet<u64>) -> Vec<u64> {
        let owed = self.pool.len().saturating_sub(self.cfg.pool_size);
        if owed == 0 {
            return Vec::new();
        }
        let gone: Vec<u64> = self
            .eviction_order(protect)
            .into_iter()
            .take(owed)
            .map(|(i, _)| self.pool[i].id)
            .collect();
        let set: HashSet<u64> = gone.iter().copied().collect();
        self.pool.retain(|c| !set.contains(&c.id));
        // The exposure tallies are about candidates that can still be dealt;
        // a retired id never can be again.
        self.shown_pairs
            .retain(|(a, b), _| !set.contains(a) && !set.contains(b));
        for id in &gone {
            self.shown_candidates.remove(id);
        }
        gone
    }

    /// Taste-guided refinement, one whole generation: open it
    /// ([`Engine::refine_jobs`]), run every walk here with this engine's memo
    /// ([`run_walk`]), absorb the results in job order
    /// ([`Engine::refine_absorb`]) and retire what they displaced. These are
    /// the jobs, the pure walk and the absorption the render farm drives, so
    /// the serial path is the parallel one with a single worker.
    pub fn refine<R: Rng>(&mut self, rng: &mut R) {
        let Some((ctx, jobs)) = self.refine_jobs(rng) else {
            return;
        };
        for job in &jobs {
            let result = run_walk(&ctx, job, &self.memo);
            self.refine_absorb(result);
        }
        self.refine_finish();
    }

    /// What every walk of a generation opened now would share — the prior
    /// tilted by the posterior as the pool stands, the posterior, the
    /// standardizer, the phrase, β and the keep rule — or `None` before there
    /// is a taste to refine toward.
    pub fn walk_context(&self) -> Option<WalkContext> {
        let (Some(posterior), Some(standardizer)) = (&self.posterior, &self.standardizer) else {
            return None;
        };
        Some(WalkContext {
            prior: self.biased_prior(),
            posterior: Arc::clone(posterior),
            standardizer: Arc::clone(standardizer),
            phrase: self.cfg.phrase.clone(),
            beta: self.cfg.beta,
            refine_keep: self.cfg.refine_keep,
            toward: None,
        })
    }

    /// Open a generation as data: the context its walks share and one job
    /// per parent, best parent first. `None` if there is nothing to refine
    /// toward yet (no posterior), in which case no generation is opened and
    /// the counter does not advance.
    ///
    /// Finishes any generation still open first ([`Engine::refine_finish`]).
    /// Then: bumps [`Engine::generation`], takes the top
    /// [`SessionConfig::refine_seeds`] of [`Engine::ranked`] as parents
    /// ([`Engine::next_seeds`] names them before it runs), draws
    /// **one** `u64` from `rng` (the caller's `refine` stream) and gives job
    /// `i` the seed [`walk_seed`]`(base, i)`. Each walk therefore owns its
    /// randomness, and no walk can move another by finishing early or late.
    ///
    /// The jobs can run anywhere ([`run_walk`] is pure); their results come
    /// back through [`Engine::refine_absorb`] in job order.
    pub fn refine_jobs<R: Rng>(&mut self, rng: &mut R) -> Option<(WalkContext, Vec<WalkJob>)> {
        self.refine_finish();
        let ctx = self.walk_context()?;
        let rows = self.seed_rows(&self.ranked(), &HashSet::new());
        Some(self.open_jobs(rng, ctx, rows))
    }

    /// Open a generation over the parents at pool indices `rows`, in that
    /// order, sharing `ctx`: bumps [`Engine::generation`], draws one `u64`
    /// from `rng` and gives job `i` the seed [`walk_seed`]`(base, i)`.
    /// [`Engine::refine_jobs`] opens the taste's generation through it, and
    /// [`Engine::refine_toward_jobs`] a sound of your own's. The caller has
    /// finished any generation still open.
    pub(crate) fn open_jobs<R: Rng>(
        &mut self,
        rng: &mut R,
        ctx: WalkContext,
        rows: Vec<usize>,
    ) -> (WalkContext, Vec<WalkJob>) {
        self.generation += 1;
        let base: u64 = rng.gen();
        let jobs: Vec<WalkJob> = rows
            .into_iter()
            .enumerate()
            .map(|(index, i)| WalkJob {
                generation: self.generation,
                index,
                parent_id: self.pool[i].id,
                seed: self.pool[i].tree.clone(),
                locked: Vec::new(),
                steps: self.cfg.refine_steps,
                rng_seed: walk_seed(base, index as u64),
            })
            .collect();
        if !jobs.is_empty() {
            self.open = Some(OpenGeneration {
                generation: self.generation,
                context: ctx.clone(),
                jobs: jobs.clone(),
                next: 0,
                protect: HashSet::new(),
            });
        }
        (ctx, jobs)
    }

    /// Fold one walk's result into the open generation: the novelty check,
    /// admission and lineage, exactly as the serial path always did after its
    /// walk. Returns the child id, or `None` with the reason in
    /// [`Engine::last_refine`].
    ///
    /// Results are taken **strictly in job order**. One that is not the next
    /// job of the open generation — early, repeated, or from a generation that
    /// has since finished — changes nothing and reads
    /// [`RefineOutcome::Stale`]; hold it and offer it again in its turn.
    ///
    /// Admission never evicts here ([`Engine::admit_refined`] says why);
    /// absorbing the last job finishes the generation, which is when the
    /// displaced members are retired. To stop early, call
    /// [`Engine::refine_finish`]: the children already absorbed stay, and the
    /// pool is back to size.
    pub fn refine_absorb(&mut self, result: WalkResult) -> Option<u64> {
        let turn = match &mut self.open {
            Some(open)
                if result.generation == open.generation
                    && result.index == open.next
                    && open
                        .jobs
                        .get(result.index)
                        .is_some_and(|j| j.parent_id == result.parent_id) =>
            {
                open.next += 1;
                let last = open.next == open.jobs.len();
                Some((
                    open.jobs[result.index].seed.clone(),
                    open.protect.clone(),
                    last,
                ))
            }
            _ => None,
        };
        let Some((seed, protect, last)) = turn else {
            self.last_refine = RefineOutcome::Stale;
            return None;
        };
        let (child, outcome) = self.absorb_walk(result.parent_id, &seed, result, &protect);
        self.last_refine = outcome;
        if last {
            self.refine_finish();
        }
        child
    }

    /// Close the open generation, if any, and retire the lowest members not
    /// kept ([`Candidate::kept`]) until the pool is back to [`SessionConfig::pool_size`].
    /// Returns the retired ids, lowest first.
    ///
    /// This is **stop**: the children absorbed so far stay, results still in
    /// flight read [`RefineOutcome::Stale`] if offered, and the pool is
    /// consistent. It is also what absorbing a generation's last job does, and
    /// what opening the next one does first. Idempotent; with no generation
    /// open it still restores the pool's size (a session saved mid-generation
    /// reloads over size, and is trimmed here).
    ///
    /// Pins are read **now**, not when a child was admitted: a patch saved at
    /// any point before the finish is never retired by it. So is the mark of
    /// a sound kept as new: one kept while the generation ran is spared, and
    /// one that has since been in a pick competes.
    ///
    /// The retirees are ranked under the posterior the generation opened
    /// with, as its admissions were: picks made while it ran reweight the
    /// posterior for the next pair, not for which children are kept.
    pub fn refine_finish(&mut self) -> Vec<u64> {
        let was_open = self.open.is_some();
        let protect = self
            .open
            .as_ref()
            .map(|o| o.protect.clone())
            .unwrap_or_default();
        let gone = self.evict_to_size(&protect);
        self.open = None;
        if was_open || !gone.is_empty() {
            self.retired = gone.clone();
        }
        gone
    }

    /// The ids the last generation to finish retired, lowest first —
    /// whether it finished on its last absorb, on a stop, or because the next
    /// one opened. The pool no longer holds them.
    pub fn retired(&self) -> &[u64] {
        &self.retired
    }

    /// `(absorbed, total)` jobs of the open generation, or `None` when none
    /// is open.
    pub fn refine_progress(&self) -> Option<(usize, usize)> {
        self.open.as_ref().map(|o| (o.next, o.jobs.len()))
    }

    /// The members [`Engine::refine_finish`] would retire if it ran now,
    /// lowest first: while a generation runs, the rows a save would rescue.
    /// Ranked as the finish will rank them, under the posterior the
    /// generation opened with.
    /// Empty when the pool is not over size.
    pub fn retiring(&self) -> Vec<u64> {
        let owed = self.pool.len().saturating_sub(self.cfg.pool_size);
        if owed == 0 {
            return Vec::new(); // and no eviction order to rank
        }
        let protect = self
            .open
            .as_ref()
            .map(|o| o.protect.clone())
            .unwrap_or_default();
        self.eviction_order(&protect)
            .into_iter()
            .take(owed)
            .map(|(i, _)| self.pool[i].id)
            .collect()
    }

    /// The seed rule, in one place: the top [`SessionConfig::refine_seeds`]
    /// rows of `ranked` (an [`Engine::ranked`] list) whose member is not in
    /// `gone`, as pool indices, best first. [`Engine::refine_jobs`] takes its
    /// parents here, so [`Engine::next_seeds`] cannot drift from it.
    fn seed_rows(&self, ranked: &[(usize, f64, f64)], gone: &HashSet<u64>) -> Vec<usize> {
        ranked
            .iter()
            .map(|&(i, _, _)| i)
            .filter(|&i| !gone.contains(&self.pool[i].id))
            .take(self.cfg.refine_seeds)
            .collect()
    }

    /// The parents a generation opened now would refine from, best first:
    /// the `parent_id`s [`Engine::refine_jobs`] would give its jobs if it ran
    /// now. Empty before there is a taste to refine toward (no posterior or
    /// no standardizer), when `refine_jobs` opens nothing.
    ///
    /// The top [`SessionConfig::refine_seeds`] of [`Engine::ranked`], under
    /// the posterior as it stands, so the seeds move with every pick between
    /// refits as the ranked list does. `refine_jobs` first finishes any
    /// generation still open, which retires [`Engine::retiring`]; those
    /// members are passed over here for the same reason.
    pub fn next_seeds(&self) -> Vec<u64> {
        self.next_seed_rows(&self.ranked(), &self.retiring())
    }

    /// [`Engine::next_seeds`] from a ranked list and [`Engine::retiring`]
    /// already computed. While the pool is over size `retiring` is a whole
    /// eviction order under the posterior the open generation started with,
    /// the dearest part of [`Engine::belief`], so it is computed once there.
    pub(crate) fn next_seed_rows(
        &self,
        ranked: &[(usize, f64, f64)],
        retiring: &[u64],
    ) -> Vec<u64> {
        if self.posterior.is_none() || self.standardizer.is_none() {
            return Vec::new();
        }
        let gone: HashSet<u64> = retiring.iter().copied().collect();
        self.seed_rows(ranked, &gone)
            .into_iter()
            .map(|i| self.pool[i].id)
            .collect()
    }

    /// The members a generation opened now could retire, lowest first: no
    /// member outside this list can leave the pool at its end, whatever its
    /// walks breed, as long as nothing else changes the pool meanwhile (a
    /// save, an edit, a preset, a ⚡ child).
    ///
    /// [`Engine::refine_jobs`] opens with a finish, which retires
    /// [`Engine::retiring`]: those come first. Then each of the generation's
    /// `w` walks ([`Engine::next_seeds`]) admits at most one child, and its
    /// finish retires only as many members as the children put the pool over
    /// size, lowest first under the posterior it opened with (the current
    /// one). A member with that many evictable members below it is never
    /// reached, so the rest of the list is the lowest `pool + w − pool_size`
    /// evictable members (`w` of them when the pool is at size, fewer while
    /// it fills): not kept ([`Candidate::kept`]: saved, or kept as new and not
    /// yet in a pick), and not the seed of a ⚡ in flight.
    ///
    /// The engine does not know what the app has cut: a cut member is in the
    /// pool, ranks low, and is in this list like any other.
    pub fn may_replace(&self) -> Vec<u64> {
        let retiring = self.retiring();
        let walks = self.next_seed_rows(&self.ranked(), &retiring).len();
        let p = self.posterior.as_deref();
        self.may_replace_after(retiring, walks, |i| mix_utility(p, &self.pool[i].phi_std))
    }

    /// [`Engine::may_replace`] given [`Engine::retiring`], the generation's
    /// `walks`, and each member's utility under the current posterior by pool
    /// index (all three computed once by a caller that already has them, as
    /// [`Engine::belief`] has).
    pub(crate) fn may_replace_after(
        &self,
        retiring: Vec<u64>,
        walks: usize,
        utility: impl Fn(usize) -> f64,
    ) -> Vec<u64> {
        let mut out = retiring;
        if walks == 0 {
            return out;
        }
        let first: HashSet<u64> = out.iter().copied().collect();
        let left = self.pool.len() - first.len();
        let owed = (left + walks).saturating_sub(self.cfg.pool_size);
        if owed == 0 {
            return out;
        }
        out.extend(
            self.eviction_order_by(&HashSet::new(), utility)
                .into_iter()
                .map(|(i, _)| self.pool[i].id)
                .filter(|id| !first.contains(id))
                .take(owed),
        );
        out
    }

    /// Open a generation with its jobs kept in the engine, and return the
    /// parent ids it will refine from, in job order. Empty if there is nothing
    /// to refine toward yet (no posterior), in which case the generation
    /// counter is **not** advanced.
    ///
    /// The serial driver: pair it with [`Engine::refine_seed`] to run a
    /// generation one walk at a time and report progress between walks. It
    /// is [`Engine::refine_jobs`] with the jobs held here instead of handed
    /// out, so it draws the same one base seed from `rng`.
    pub fn refine_begin<R: Rng>(&mut self, rng: &mut R) -> Vec<u64> {
        self.refine_jobs(rng)
            .map(|(_, jobs)| jobs.iter().map(|j| j.parent_id).collect())
            .unwrap_or_default()
    }

    /// Run the open generation's job for `parent_id` here, with this
    /// engine's memo, and absorb it. Returns the injected child id, or `None`
    /// — and then [`Engine::last_refine`] says why: the walk did not move, it
    /// landed on a patch the pool already holds, the child was not admitted,
    /// the seed was outside the prior's support, or no open job has that
    /// parent ([`RefineOutcome::UnknownSeed`]). Jobs listed before it that
    /// were never run are skipped.
    pub fn refine_seed(&mut self, parent_id: u64) -> Option<u64> {
        let found = self.open.as_mut().and_then(|open| {
            let at = open.next
                + open.jobs[open.next..]
                    .iter()
                    .position(|j| j.parent_id == parent_id)?;
            open.next = at;
            Some((open.context.clone(), open.jobs[at].clone()))
        });
        let Some((ctx, job)) = found else {
            self.last_refine = RefineOutcome::UnknownSeed;
            return None;
        };
        let result = run_walk(&ctx, &job, &self.memo);
        self.refine_absorb(result)
    }

    /// Locked refinement from one explicit seed candidate: evolve everything
    /// *except* the locked addresses. Returns the injected child id, or `None`
    /// with the reason in [`Engine::last_refine`].
    ///
    /// One job over the generation's path: [`Engine::refine_from_job`], then
    /// [`Engine::refine_from_walk`] (the pure walk here with this engine's
    /// memo, absorbed).
    pub fn refine_from<R: Rng>(
        &mut self,
        rng: &mut R,
        seed_id: u64,
        locked: &[String],
    ) -> Option<u64> {
        self.refine_from_job(rng, seed_id, locked).ok()?;
        self.refine_from_walk(seed_id)
    }

    /// Walk the ⚡ job [`Engine::refine_from_job`] dealt for `seed_id` here,
    /// with this engine's memo, and absorb it: the child a farm worker would
    /// have bred from the same job. The frontend draws the job first and
    /// only then decides where to walk it, so the `refine` stream is drawn
    /// in the order the requests came, however long a crew takes to come
    /// up. `None` with [`RefineOutcome::UnknownSeed`] when no job for that
    /// seed is in flight.
    pub fn refine_from_walk(&mut self, seed_id: u64) -> Option<u64> {
        let Some((ctx, job)) = self.evolving.get(&seed_id).cloned() else {
            self.last_refine = RefineOutcome::UnknownSeed;
            return None;
        };
        let result = run_walk(&ctx, &job, &self.memo);
        self.refine_from_absorb(seed_id, result)
    }

    /// Drop the ⚡ job in flight for `seed_id` (a stop): its seed may be
    /// evicted again, and its result, if it is offered anyway, is absorbed
    /// as any other would be. Returns whether one was in flight.
    pub fn refine_from_cancel(&mut self, seed_id: u64) -> bool {
        self.evolving.remove(&seed_id).is_some()
    }

    /// The seeds of the ⚡ walks in flight, ascending.
    pub fn refine_from_inflight(&self) -> Vec<u64> {
        let mut ids: Vec<u64> = self.evolving.keys().copied().collect();
        ids.sort_unstable();
        ids
    }

    /// `⚡ evolve from this` as data: the context and the single job, for a
    /// farm worker to walk while this engine keeps answering. Draws one `u64`
    /// from `rng`. Fails, with the reason also in [`Engine::last_refine`],
    /// when the seed is not in the pool or there is no taste yet.
    ///
    /// The job is kept until [`Engine::refine_from_absorb`] (or
    /// [`Engine::refine_from_walk`]) takes its result or
    /// [`Engine::refine_from_cancel`] drops it, and until then its seed is
    /// never evicted.
    pub fn refine_from_job<R: Rng>(
        &mut self,
        rng: &mut R,
        seed_id: u64,
        locked: &[String],
    ) -> Result<(WalkContext, WalkJob), RefineOutcome> {
        let Some(i) = self.find(seed_id) else {
            self.last_refine = RefineOutcome::UnknownSeed;
            return Err(RefineOutcome::UnknownSeed);
        };
        let Some(ctx) = self.walk_context() else {
            self.last_refine = RefineOutcome::NoTaste;
            return Err(RefineOutcome::NoTaste);
        };
        let job = WalkJob {
            generation: self.generation,
            index: 0,
            parent_id: seed_id,
            seed: self.pool[i].tree.clone(),
            locked: locked.to_vec(),
            steps: self.cfg.refine_steps,
            rng_seed: walk_seed(rng.gen(), 0),
        };
        self.evolving.insert(seed_id, (ctx.clone(), job.clone()));
        Ok((ctx, job))
    }

    /// Fold a `⚡ evolve from this` walk in: novelty, admission and lineage,
    /// with the seed never displaced by its own child. Returns the child id,
    /// or `None` with the reason in [`Engine::last_refine`].
    ///
    /// With no generation open this is a generation of its own: the counter
    /// advances only when a child actually lands (it used to advance on every
    /// press, so a run of "no move" presses read as empty generations), and
    /// what the child displaced is retired at once. While a pool generation
    /// is open the child joins it — stamped with its number, the seed spared
    /// by its finish, and nothing retired before then.
    pub fn refine_from_absorb(&mut self, seed_id: u64, result: WalkResult) -> Option<u64> {
        self.evolving.remove(&seed_id);
        let (child, outcome) = self.absorb_from(seed_id, result);
        self.last_refine = outcome;
        child
    }

    fn absorb_from(&mut self, seed_id: u64, result: WalkResult) -> (Option<u64>, RefineOutcome) {
        if result.parent_id != seed_id {
            return (None, RefineOutcome::Stale);
        }
        let Some(i) = self.find(seed_id) else {
            return (None, RefineOutcome::UnknownSeed);
        };
        let seed = self.pool[i].tree.clone();
        if let Some(open) = &mut self.open {
            open.protect.insert(seed_id);
            let protect = open.protect.clone();
            return self.absorb_walk(seed_id, &seed, result, &protect);
        }
        // Open the generation the child will be recorded under, and close it
        // again if nothing lands — `record_child` stamps `self.generation`, so
        // the bump has to precede it.
        self.generation += 1;
        let protect = HashSet::from([seed_id]);
        let (child, outcome) = self.absorb_walk(seed_id, &seed, result, &protect);
        self.evict_to_size(&protect);
        if child.is_none() {
            self.generation -= 1;
        }
        (child, outcome)
    }

    /// The shared back half of every refinement: the walk's verdict, the
    /// novelty check, the admission, the lineage. Returns the child (if any)
    /// *and* the outcome, so the public entry points can report both.
    fn absorb_walk(
        &mut self,
        parent_id: u64,
        seed: &PatchTree,
        result: WalkResult,
        protect: &HashSet<u64>,
    ) -> (Option<u64>, RefineOutcome) {
        let WalkResult {
            child,
            reason,
            cached,
            ..
        } = result;
        let Some(mut end) = child else {
            return (None, reason.unwrap_or(RefineOutcome::NoMove));
        };
        // A no-op for any honest walk (it clamps before returning), and the
        // line that keeps a damaged farm result from seating a knob past its
        // domain in the pool.
        end.clamp_domains();
        // The walk's own featurization of its child, when its content key says
        // it is of this very tree: admission then costs no render here.
        if let Some(c) = cached {
            if c.key == auracle_features::render_key(&end, &self.cfg.phrase) {
                self.memo.put(c, None);
            }
        }
        if self.pool.iter().any(|c| c.tree == end) {
            return (None, RefineOutcome::Duplicate);
        }
        match self.record_child(parent_id, seed, end, "refine", protect) {
            Some(id) => (Some(id), RefineOutcome::Injected),
            None => (None, RefineOutcome::NotAdmitted),
        }
    }

    /// Commit a hand-edited tree as a new candidate. If `original_id` is
    /// given, a lineage event links them; `outcome` says what the player
    /// reported about the pair, and only a *told* outcome writes an
    /// observation.
    pub fn commit_edit(
        &mut self,
        original_id: Option<u64>,
        tree: PatchTree,
        outcome: EditOutcome,
    ) -> Option<u64> {
        if let Some(i) = self.pool.iter().position(|c| c.tree == tree) {
            // The edit landed on a patch the bank already holds, so there is
            // no new candidate to insert. There *was* still a comparison: the
            // player heard two patches and picked one, and discarding that
            // answer because the winner happened to already exist would throw
            // away a real vote on the grounds of a bookkeeping collision. The
            // pair is scored against the twin instead.
            let (existing, told) = (self.pool[i].id, outcome.told());
            if let (Some(oid), Some((edited_won, provenance))) = (original_id, told) {
                if let Some(pi) = self.find(oid) {
                    if existing != oid {
                        self.record_duel_as(i, pi, edited_won, provenance);
                    }
                }
            }
            return None;
        }
        let original = original_id.and_then(|id| self.find(id)).map(|i| {
            (
                self.pool[i].id,
                self.pool[i].tree.clone(),
                self.pool[i].phi_std.clone(),
            )
        });
        let child_id = self.insert_candidate(tree, Origin::Edited, original_id)?;
        if let Some((pid, ptree, pphi)) = original {
            let ci = self.find(child_id).expect("just inserted");
            let (ctree, cphi) = (self.pool[ci].tree.clone(), self.pool[ci].phi_std.clone());
            self.lineage.push(LineageEvent {
                generation: self.generation,
                kind: "edit".into(),
                parent_id: pid,
                child_id,
                diff: tree_diff(&ptree, &ctree),
                parent_utility: self.utility_of(&pphi),
                child_utility: self.utility_of(&cphi),
            });
            // A committed edit is a genuine one-step-ahead question — the
            // model has never seen this tree — so it goes through the same
            // forecast-then-observe path a dealt duel does, in the same
            // (edit, original) order, and carries the tag that lets a
            // self-report be scored against a heard comparison rather than
            // averaged into it.
            if let Some((edited_won, provenance)) = outcome.told() {
                if let (Some(ci), Some(pi)) = (self.find(child_id), self.find(pid)) {
                    self.record_duel_as(ci, pi, edited_won, provenance);
                }
            }
        }
        // Marked after the comparison above, which judged the original if
        // anything: the pick that keeps a sound is not a judgment of it, or
        // the protection would be gone the moment it was given.
        self.mark_unjudged(child_id);
        Some(child_id)
    }

    /// How many sounds kept as new may be protected at once
    /// ([`Candidate::unjudged`]): a quarter of the pool, as many as may be
    /// saved ([`Engine::pin_cap`]), and apart from that budget.
    ///
    /// The bound is what keeps the pool from being protected solid: with at
    /// most a quarter saved and a quarter kept as new and unsaved (a saved
    /// one is not counted twice), at least half of a pool of four or more can
    /// always be replaced (less the seeds of ⚡ walks in flight), so an insert
    /// always lands and a generation's end always brings the pool back to
    /// size. Below four the `max(1)` floors can protect more than half. Keeping one more past the cap hands the oldest kept sound back
    /// to normal eviction rather than refusing the keep: the newest is the one
    /// a player is still working with.
    pub fn unjudged_cap(&self) -> usize {
        (self.cfg.pool_size / 4).max(1)
    }

    /// The ids of the members kept as new and not yet in a pick, ascending
    /// (oldest keep first: ids are issued in order).
    pub fn unjudged(&self) -> Vec<u64> {
        let mut ids: Vec<u64> = self
            .pool
            .iter()
            .filter(|c| c.unjudged)
            .map(|c| c.id)
            .collect();
        ids.sort_unstable();
        ids
    }

    /// Protect `id` until it is in a pick, then hold the marks to
    /// [`Engine::unjudged_cap`].
    fn mark_unjudged(&mut self, id: u64) {
        if let Some(i) = self.find(id) {
            self.pool[i].unjudged = true;
        }
        self.bound_unjudged();
    }

    /// Clear the oldest marks past [`Engine::unjudged_cap`]. Ids are issued
    /// in order, so the lowest ids are the oldest keeps. A saved sound is
    /// protected by its save and is not counted: its mark stays, for the day
    /// it is unsaved ([`Engine::set_pinned`] bounds the marks again then).
    fn bound_unjudged(&mut self) {
        let ids: Vec<u64> = self
            .unjudged()
            .into_iter()
            .filter(|id| self.find(*id).is_some_and(|i| !self.pool[i].pinned))
            .collect();
        let over = ids.len().saturating_sub(self.unjudged_cap());
        for id in &ids[..over] {
            if let Some(i) = self.find(*id) {
                self.pool[i].unjudged = false;
            }
        }
    }

    /// The pool member whose tree is `tree`, if any, has now been in a pick:
    /// it competes like any member from here on ([`Candidate::unjudged`]).
    /// Only a member already in the pool when the pick was made counts, one
    /// with an id at most `as_of` (`u64::MAX` for a pick made now): one kept
    /// as new after it was not in it.
    /// [`Engine::record_tree_duel_as_of`] calls it for both sides it records;
    /// a frontend calls it for a sound that was in the pick under another
    /// form, as PERFORM's sound in hand is heard with its controls moved.
    pub fn mark_judged(&mut self, tree: &PatchTree, as_of: u64) {
        for c in &mut self.pool {
            if c.unjudged && c.id <= as_of && c.tree == *tree {
                c.unjudged = false;
            }
        }
    }

    fn record_child(
        &mut self,
        parent_id: u64,
        seed: &PatchTree,
        mut end: PatchTree,
        kind: &str,
        protect: &HashSet<u64>,
    ) -> Option<u64> {
        // The one place a refined child meets its seed, and therefore the one
        // place its node identities can be recovered.
        //
        // the locked walk (`walk::walk_on`) runs typed MH over the *trace*, and every accepted step
        // rebuilds the whole genome through `crate::genome`'s decoder — a trace
        // is a map from address to value and has no room for a uid, so what
        // comes back is structurally almost the seed and completely anonymous.
        // Without this line every ⚡ would look to the panel like a brand-new
        // patch: locks gone, hand-placed positions gone, selection gone, on the
        // one action the whole instrument is built around. Positions and locks
        // are the point of uids, and evolution is the point of auracle.
        end.inherit_uids(seed);
        let parent_phi = self
            .find(parent_id)
            .map(|i| self.pool[i].phi_std.clone())
            .unwrap_or_default();
        let child_id = self.admit_refined(end, protect)?;
        let ci = self.find(child_id).expect("just inserted");
        let (ctree, cphi) = (self.pool[ci].tree.clone(), self.pool[ci].phi_std.clone());
        self.lineage.push(LineageEvent {
            generation: self.generation,
            kind: kind.into(),
            parent_id,
            child_id,
            diff: tree_diff(seed, &ctree),
            parent_utility: self.utility_of(&parent_phi),
            child_utility: self.utility_of(&cphi),
        });
        Some(child_id)
    }

    /// Pool indices ranked by posterior-mean mixture utility (descending);
    /// with no posterior, arbitrary order with zero scores.
    pub fn ranked(&self) -> Vec<(usize, f64, f64)> {
        let mut rows: Vec<(usize, f64, f64)> = self
            .pool
            .iter()
            .enumerate()
            .map(|(i, c)| match &self.posterior {
                Some(p) if !c.phi_std.is_empty() => {
                    let (m, s) = p.utility_mix(&c.phi_std);
                    (i, m, s)
                }
                _ => (i, 0.0, 0.0),
            })
            .collect();
        rows.sort_by(|a, b| b.1.total_cmp(&a.1));
        rows
    }

    /// Choose the next duel by **expected information gain about θ** (BALD),
    /// traded off against how pleasant the duel is to answer and penalized for
    /// repetition, then sampled from a softmax rather than argmaxed.
    ///
    /// Returns pool indices `(a, b)`; `None` if fewer than two candidates are
    /// standardized. See [`Engine::next_duel_full`] for the annotated form.
    ///
    /// ## Why not dueling Thompson sampling
    ///
    /// The obvious acquisition here — draw two posterior samples, duel each
    /// one's champion — is a real algorithm, correctly implemented, and the
    /// wrong objective. DTS is **best-arm identification**: it converges on
    /// finding the single top patch. What this system needs from a duel is
    /// *information about θ*, because θ is what reshapes the proposal
    /// distribution and paints the taste map. Those goals diverge sharply.
    /// The Fisher information in one Bradley–Terry duel is
    ///
    /// ```text
    /// I(θ) = p(1−p) · Δ Δᵀ ,   Δ = φ_a − φ_b ,   p = σ(θ·Δ)
    /// ```
    ///
    /// which scales with `p(1−p)` **and** with `‖Δ‖²`. DTS maximizes the
    /// first (champions tie at p ≈ 0.5) while actively *minimizing* the
    /// second: two champions of the same concentrating posterior are two
    /// high-utility patches, which in a 48-member pool means two *similar*
    /// patches. It systematically picks the least informative near-tie
    /// available. And once the draw set concentrates, both champions become
    /// the same index and the user is shown top-1 vs top-2 over and over.
    ///
    /// BALD scores the mutual information between the outcome and θ,
    /// `I = H(E_s[p_s]) − E_s[H(p_s)]` — high exactly when the posterior
    /// *disagrees with itself* about who wins, which is the definition of a
    /// question worth asking.
    ///
    /// Measured against DTS on the synthetic user (10 paired seeds, 72
    /// duels): pool-ranking correlation +0.101 ± 0.058, predictive excess
    /// −0.040 ± 0.017 nats. Measured against *uniformly random* pairing: no
    /// difference outside noise on any metric. See [`Acquisition`] for the
    /// full table and for why `Bald` is still the default.
    pub fn next_duel<R: Rng>(&mut self, rng: &mut R) -> Option<(usize, usize)> {
        self.next_duel_full(rng).map(|d| (d.a, d.b))
    }

    /// [`Engine::next_duel`] with the reasoning attached: which rule chose the
    /// pair, its expected information gain in nats, and whether it is one of
    /// the uniformly-random check duels that calibration is scored on.
    pub fn next_duel_full<R: Rng>(&mut self, rng: &mut R) -> Option<DuelChoice> {
        self.next_duel_except(rng, &[])
    }

    /// [`Engine::next_duel_full`], never dealing a candidate whose id is in
    /// `exclude`: the patches the player has cut. A cut hides the row and
    /// teaches the model a kill, but the patch stays in the pool until a
    /// generation replaces it, and without this it could be put back in front
    /// of the player as a duel side minutes after they threw it out. The
    /// caller owns the list (the app holds a cut back for its undo window
    /// before the engine hears of it, and persists the set itself), so it is
    /// passed in rather than inferred from the log, whose kills carry no ids.
    ///
    /// For a caller that shows every pair it deals: the deal counts as shown
    /// at once. A caller that deals ahead and may throw a deal away uses
    /// [`Engine::deal_duel_except`] and reports what it shows.
    pub fn next_duel_except<R: Rng>(&mut self, rng: &mut R, exclude: &[u64]) -> Option<DuelChoice> {
        let choice = self.deal_duel_except(rng, exclude)?;
        self.duel_shown(self.pool[choice.a].id, self.pool[choice.b].id);
        Some(choice)
    }

    /// Record that the pair `(a_id, b_id)` (candidate ids, either order),
    /// dealt by [`Engine::deal_duel_except`], is now in front of the player.
    /// Returns false, and counts nothing, for a pair not dealt or already
    /// reported — putting a pair back up (a retracted pick restores its
    /// question) is not a second showing.
    ///
    /// Everything that is about what the player has *seen* moves here rather
    /// than at the deal: the check cadence, the repeat and exposure penalties
    /// the choosing rules read, and the pending check a later answer is
    /// scored against. A deal thrown away unseen (the app deals the next pair
    /// ahead, and drops it after a cut, an eviction or a retraction, or when
    /// the engine deals the pair already on the table) then moves none of
    /// them. Counted at the deal, a scheduled check dealt ahead and thrown
    /// away was a check nobody was asked, and the calibration subsample
    /// shrank with every one.
    pub fn duel_shown(&mut self, a_id: u64, b_id: u64) -> bool {
        let key = pair_key(a_id, b_id);
        // The newest deal of the pair is the one on the table; any older deal
        // of it was thrown away, and goes too, so a later putting-back finds
        // nothing to count.
        let Some(&(_, random_check)) = self.dealt_unshown.iter().rev().find(|(k, _)| *k == key)
        else {
            return false;
        };
        self.dealt_unshown.retain(|(k, _)| *k != key);
        self.duels_shown += 1;
        *self.shown_pairs.entry(key).or_insert(0) += 1;
        *self.shown_candidates.entry(key.0).or_insert(0) += 1;
        *self.shown_candidates.entry(key.1).or_insert(0) += 1;
        if random_check {
            self.pending_checks.push_back(key);
            if self.pending_checks.len() > PENDING_CHECKS {
                self.pending_checks.pop_front();
            }
        }
        true
    }

    /// Choose the next duel as [`Engine::next_duel_except`] does, without
    /// counting it as shown: the caller reports the pairs it puts in front
    /// of the player with [`Engine::duel_shown`]. Whether this deal is a
    /// scheduled check depends on how many pairs have been *shown*, so a deal
    /// thrown away and dealt again is dealt under the same schedule. The
    /// random stream is consumed exactly as `next_duel_except` consumes it.
    pub fn deal_duel_except<R: Rng>(&mut self, rng: &mut R, exclude: &[u64]) -> Option<DuelChoice> {
        // Un-standardized candidates score utility exactly 0 (`dot` over an
        // empty vector), which beats every real utility once a user has killed
        // enough patches — they must not be selectable, the same guard
        // `ranked()` applies.
        let cands: Vec<usize> = (0..self.pool.len())
            .filter(|&i| !self.pool[i].phi_std.is_empty() && !exclude.contains(&self.pool[i].id))
            .collect();
        if cands.len() < 2 {
            return None;
        }
        let uniform = |rng: &mut R| -> (usize, usize) {
            let i = gen_index(rng, cands.len());
            let mut j = gen_index(rng, cands.len() - 1);
            if j >= i {
                j += 1;
            }
            (cands[i], cands[j])
        };

        let check = self.cfg.duel_check_every > 0
            && self.duels_shown > 0
            && self.duels_shown.is_multiple_of(self.cfg.duel_check_every);

        let choice = match (&self.posterior, check) {
            // No taste yet, or a scheduled check duel: uniform at random.
            // A uniform pair *is* a calibration check, so it is tagged as one
            // whether it was scheduled or is simply how this engine picks
            // every duel. Under the default rule that makes the unbiased
            // subsample the entire sample, which is the whole reason to
            // prefer it: the reliability diagram needs no asterisk.
            (None, _) => {
                let (a, b) = uniform(rng);
                DuelChoice {
                    a,
                    b,
                    info_gain: 0.0,
                    random_check: true,
                    method: "random",
                }
            }
            // Under the random rule every pair is random, so a scheduled
            // check is no different from any other deal and says "random".
            // Matched before the check arm: labelled "check", every tenth
            // pair read as the exception to a rule that has none. Both arms
            // draw the pair the same way, so a seeded deal is unchanged.
            (Some(_), _) if self.cfg.acquisition == Acquisition::Random => {
                let (a, b) = uniform(rng);
                DuelChoice {
                    a,
                    b,
                    info_gain: 0.0,
                    random_check: true,
                    method: "random",
                }
            }
            (Some(_), true) => {
                let (a, b) = uniform(rng);
                DuelChoice {
                    a,
                    b,
                    info_gain: 0.0,
                    random_check: true,
                    method: "check",
                }
            }
            (Some(posterior), false) if self.cfg.acquisition == Acquisition::Thompson => {
                let (a, b) = thompson_pair(posterior, &self.pool, &cands, rng);
                DuelChoice {
                    a,
                    b,
                    info_gain: 0.0,
                    random_check: false,
                    method: "thompson",
                }
            }
            (Some(posterior), false) => {
                let (a, b, info) = self.bald_pair(posterior, &cands, rng);
                DuelChoice {
                    a,
                    b,
                    info_gain: info,
                    random_check: false,
                    method: "bald",
                }
            }
        };

        let key = pair_key(self.pool[choice.a].id, self.pool[choice.b].id);
        self.dealt_unshown.push_back((key, choice.random_check));
        if self.dealt_unshown.len() > DEALT_UNSHOWN {
            self.dealt_unshown.pop_front();
        }
        Some(choice)
    }

    /// The BALD scan itself. Utilities are precomputed once per candidate per
    /// draw (`S × |pool|`), then every pair is scored from that table — the
    /// whole sweep is a few hundred thousand sigmoids, milliseconds in wasm.
    fn bald_pair<R: Rng>(
        &self,
        posterior: &TastePosterior,
        cands: &[usize],
        rng: &mut R,
    ) -> (usize, usize, f64) {
        let s_n = posterior.samples.len();
        if s_n == 0 {
            let i = gen_index(rng, cands.len());
            let mut j = gen_index(rng, cands.len() - 1);
            if j >= i {
                j += 1;
            }
            return (cands[i], cands[j], 0.0);
        }
        // u[s][c] over the *standardized* pool.
        let u: Vec<Vec<f64>> = posterior
            .samples
            .iter()
            .map(|s| {
                cands
                    .iter()
                    .map(|&i| s.utility_mix(&self.pool[i].phi_std))
                    .collect()
            })
            .collect();
        let w: Vec<f64> = (0..s_n).map(|s| posterior.weight(s)).collect();
        let mean_u: Vec<f64> = (0..cands.len())
            .map(|c| (0..s_n).map(|s| w[s] * u[s][c]).sum())
            .collect();
        // The enjoyment term is scored on **pool-standardized** utility, not
        // raw utility. Raw utility has no fixed scale: it grows without bound
        // as the posterior sharpens, so a fixed λ against it starts as a
        // gentle nudge and ends up swamping the information term entirely —
        // at which point the acquisition function has silently turned back
        // into the best-arm rule this one replaced. Standardized, λ means the
        // same thing at duel 10 and duel 200.
        let u_mu = mean_u.iter().sum::<f64>() / mean_u.len().max(1) as f64;
        let u_sd = (mean_u.iter().map(|u| (u - u_mu) * (u - u_mu)).sum::<f64>()
            / mean_u.len().max(1) as f64)
            .sqrt()
            .max(1e-9);
        let z_u: Vec<f64> = mean_u.iter().map(|u| (u - u_mu) / u_sd).collect();

        let lambda = self.cfg.duel_utility_weight;
        let gamma = self.cfg.duel_repeat_penalty;
        let rho = self.cfg.duel_exposure_penalty;
        // How often each candidate has been *put in front of the user*, by any
        // pairing. See `duel_exposure_penalty`: without this the top-utility
        // candidate is nominated over and over through pairs that are all
        // technically distinct.
        let seen: Vec<f64> = cands
            .iter()
            .map(|&i| {
                self.shown_candidates
                    .get(&self.pool[i].id)
                    .copied()
                    .unwrap_or(0) as f64
            })
            .collect();
        let mut best = Vec::with_capacity(cands.len() * cands.len() / 2);
        for ci in 0..cands.len() {
            for cj in (ci + 1)..cands.len() {
                let mut p_bar = 0.0;
                let mut mean_h = 0.0;
                for s in 0..s_n {
                    let p = sigmoid(u[s][ci] - u[s][cj]);
                    p_bar += w[s] * p;
                    mean_h += w[s] * binary_entropy(p);
                }
                let info = binary_entropy(p_bar) - mean_h;
                let shown = self
                    .shown_pairs
                    .get(&pair_key(self.pool[cands[ci]].id, self.pool[cands[cj]].id))
                    .copied()
                    .unwrap_or(0) as f64;
                let j = info + lambda * (z_u[ci] + z_u[cj]) / 2.0
                    - gamma * shown
                    - rho * (seen[ci] + seen[cj]);
                best.push((ci, cj, j, info));
            }
        }
        // Softmax over the objective, at a temperature set by the objective's
        // *own* spread. An absolute temperature is a bet on how far apart the
        // scores happen to be, and at 0.05 nats against a spread of several
        // tenths this "softmax" was an argmax — which is exactly the best-arm
        // lock-in BALD exists to avoid.
        let j_mu = best.iter().map(|x| x.2).sum::<f64>() / best.len().max(1) as f64;
        let j_sd = (best
            .iter()
            .map(|x| (x.2 - j_mu) * (x.2 - j_mu))
            .sum::<f64>()
            / best.len().max(1) as f64)
            .sqrt();
        let t = (self.cfg.duel_temperature * j_sd).max(1e-9);
        let max_j = best.iter().map(|x| x.2).fold(f64::NEG_INFINITY, f64::max);
        let total: f64 = best.iter().map(|x| ((x.2 - max_j) / t).exp()).sum();
        let mut r = rng.gen::<f64>() * total;
        for &(ci, cj, j, info) in &best {
            r -= ((j - max_j) / t).exp();
            if r <= 0.0 {
                return (cands[ci], cands[cj], info);
            }
        }
        let &(ci, cj, _, info) = best.last().expect("at least one pair");
        (cands[ci], cands[cj], info)
    }

    /// Append one feedback event and fold it into the current posterior.
    ///
    /// `raw` is what the log keeps — un-standardized values plus the names
    /// they belong to, so the log stays interpretable across feature-set
    /// changes. `standardized` is the same event on the current scale, used
    /// only to reweight the existing posterior draws by sequential importance
    /// sampling: an O(S) update that makes the *next* duel respond to this
    /// one instead of waiting for the next multi-second MCMC refit.
    fn observe(&mut self, raw: Feedback, standardized: Feedback) {
        self.observe_as(raw, standardized, Provenance::Duel);
    }

    /// The same, carrying how the answer was collected. The tag reaches the
    /// log and nothing else: `standardized` goes into the posterior update
    /// untouched, so two observations that differ only in provenance move the
    /// posterior identically. Provenance is evidence *about the evidence*, and
    /// weighting by it would be a modeling claim with no measurement behind it
    /// — see [`Provenance`].
    fn observe_as(&mut self, raw: Feedback, standardized: Feedback, provenance: Provenance) {
        self.log.push(Observation::tagged(
            raw,
            self.session,
            &phi_names(),
            provenance,
        ));
        if self.cfg.sis_between_fits {
            if let Some(p) = &self.posterior {
                let mut updated = p.reweighted(&standardized, self.session);
                // Degenerate weights make the acquisition function read a
                // one-point "posterior" as certainty. Resample back to a
                // uniform set rather than let that happen; the impoverishment
                // is bounded by how soon the next full refit lands.
                if updated.ess() < updated.samples.len() as f64 / 2.0 {
                    updated = updated.resampled();
                    self.resamples_since_fit += 1;
                }
                self.posterior = Some(Arc::new(updated));
            }
        }
    }

    /// Record a duel outcome between two pool members (by pool index).
    ///
    /// The out-of-sample forecast is scored *here*, before the observation is
    /// appended — the model has to commit before it is told the answer, which
    /// is what makes [`Engine::calibration`] prequential rather than a
    /// in-sample self-assessment.
    pub fn record_duel(&mut self, a: usize, b: usize, chose_a: bool) {
        self.record_duel_as(a, b, chose_a, Provenance::Duel);
    }

    /// The same, for a pair the app assembled itself rather than dealt — a
    /// hand edit against the patch it was edited from. One code path, so the
    /// editor's answers are scored, logged and folded into the posterior by
    /// exactly the machinery a dealt duel is, and differ only in the tag that
    /// says where they came from.
    fn record_duel_as(&mut self, a: usize, b: usize, chose_a: bool, provenance: Provenance) {
        // An answer consumes the check its showing was, whether or not the
        // model can forecast it yet. This used to happen only inside the
        // forecast below, so a check shown and answered before the first fit
        // stayed pending, and the next time the same pair was shown (as a
        // chosen pair, after the fit) its answer was scored as that old
        // check: one check too many, on a pair the model had chosen.
        let key = pair_key(self.pool[a].id, self.pool[b].id);
        // Both sides have been in a pick now, whichever was picked
        // ([`Candidate::unjudged`]); the comparison that keeps a sound as new
        // marks it only after this has run ([`Engine::commit_edit`]).
        self.pool[a].unjudged = false;
        self.pool[b].unjudged = false;
        let random_check = match self.pending_checks.iter().position(|k| *k == key) {
            Some(i) => {
                self.pending_checks.remove(i);
                true
            }
            None => false,
        };
        if let Some(p_a) = self.predict_duel(a, b) {
            self.forecasts.push(Forecast {
                p_a,
                chose_a,
                random_check,
                provenance,
            });
        }
        let raw = Feedback::Duel {
            a: self.pool[a].features.phi(),
            b: self.pool[b].features.phi(),
            chose_a,
        };
        let std = Feedback::Duel {
            a: self.pool[a].phi_std.clone(),
            b: self.pool[b].phi_std.clone(),
            chose_a,
        };
        self.observe_as(raw, std, provenance);
    }

    /// Record a heard comparison between two patches that need not be in the
    /// pool — PERFORM's sound and an offer grown from it — as a duel tagged
    /// `provenance`. Returns whether it was recorded.
    ///
    /// The same forecast-then-observe path as a dealt duel: both are
    /// featurized through the render memo (an offer already was, when it was
    /// grown), the model's forecast is scored *before* the answer joins the
    /// log, and the observation enters the likelihood exactly as a duel does.
    /// Nothing is inserted into the pool — a performance's passing sounds are
    /// evidence, not candidates. Not recorded (`false`) before a standardizer
    /// exists, when either patch fails vetting, or when the two are the same
    /// patch: an answer to "which of these identical sounds is better" is a
    /// row of noise.
    ///
    /// A recorded answer is a pick for a pool member whose tree is either
    /// side: one kept as new competes from then on ([`Engine::mark_judged`]).
    /// For an answer given a while before it is recorded, see
    /// [`Engine::record_tree_duel_as_of`].
    pub fn record_tree_duel(
        &mut self,
        a: &PatchTree,
        b: &PatchTree,
        chose_a: bool,
        provenance: Provenance,
    ) -> bool {
        self.record_tree_duel_as_of(a, b, chose_a, provenance, u64::MAX)
    }

    /// [`Engine::record_tree_duel`] for an answer given when `as_of` was the
    /// newest pool id the player could have seen, and recorded later: it is
    /// a pick only for members that were already in the pool then (id at
    /// most `as_of`; ids are issued in order).
    ///
    /// PERFORM holds a Take for eight seconds before recording it, so that
    /// DON'T COUNT IT can drop it. In that window the player can take the
    /// offer onto the bench and keep it as new; the answer, recorded after,
    /// has the kept sound on its B side, and without the bound it would end
    /// the protection that sound was given after the answer was made
    /// ([`Candidate::unjudged`]).
    pub fn record_tree_duel_as_of(
        &mut self,
        a: &PatchTree,
        b: &PatchTree,
        chose_a: bool,
        provenance: Provenance,
        as_of: u64,
    ) -> bool {
        if a == b {
            return false;
        }
        let Some(sz) = self.standardizer.clone() else {
            return false;
        };
        let phi = |t: &PatchTree| {
            featurize_memo(t, &self.cfg.phrase, &self.memo, false)
                .ok()
                .map(|(cf, _)| cf.features.phi())
        };
        let (Some(ra), Some(rb)) = (phi(a), phi(b)) else {
            return false;
        };
        let (sa, sb) = (sz.transform(&ra), sz.transform(&rb));
        // A sound of the pool's on either side has been in a pick, if it was
        // in the pool when the answer was given.
        self.mark_judged(a, as_of);
        self.mark_judged(b, as_of);
        if let Some(p) = &self.posterior {
            self.forecasts.push(Forecast {
                p_a: p.prob_prefers(&sa, &sb),
                chose_a,
                random_check: false,
                provenance,
            });
        }
        self.observe_as(
            Feedback::Duel {
                a: ra,
                b: rb,
                chose_a,
            },
            Feedback::Duel {
                a: sa,
                b: sb,
                chose_a,
            },
            provenance,
        );
        true
    }

    /// Record a keep/kill decision on a pool member (by pool index).
    ///
    /// A cut (`kept: false`) is an answer about the sound: one kept as new
    /// competes from then on, like any cut sound ([`Candidate::unjudged`]).
    pub fn record_keep(&mut self, idx: usize, kept: bool) {
        if !kept {
            self.pool[idx].unjudged = false;
        }
        let raw = Feedback::KeepKill {
            x: self.pool[idx].features.phi(),
            kept,
        };
        let std = Feedback::KeepKill {
            x: self.pool[idx].phi_std.clone(),
            kept,
        };
        self.observe(raw, std);
    }

    /// Record a star rating on a pool member (by pool index).
    pub fn record_stars(&mut self, idx: usize, rating: u8) {
        let raw = Feedback::Stars {
            x: self.pool[idx].features.phi(),
            rating,
        };
        let std = Feedback::Stars {
            x: self.pool[idx].phi_std.clone(),
            rating,
        };
        self.observe(raw, std);
    }

    /// Prequential calibration over every duel forecast so far.
    pub fn calibration(&self) -> Calibration {
        calibration(&self.forecasts)
    }

    /// Exact per-feature decomposition of a candidate's utility under the lens
    /// that claims it (B9 — see [`Explanation`]).
    pub fn explain(&self, id: u64) -> Option<Explanation> {
        let i = self.find(id)?;
        self.explain_std(id, &self.pool[i].phi_std.clone())
    }

    /// The same decomposition for a φ that is **not** a pool member — the
    /// workbench, which is a patch under the player's hands and not a
    /// candidate until they commit it.
    ///
    /// This is what makes the readout above the rack honest. The WHY line used
    /// to be fetched once, for the candidate that was loaded, and then went on
    /// describing it through any number of edits: it named features of a patch
    /// the player had already edited away. The bench re-featurizes on every
    /// edit anyway, so the true decomposition is a dot product away — there
    /// was never a cost reason for the stale one.
    ///
    /// Takes **raw** φ and standardizes here, because raw is what the
    /// featurizer produces and what the log stores; θ is denominated in the
    /// standardizer, so the transform is not optional.
    pub fn explain_phi(&self, phi_raw: &[f64]) -> Option<Explanation> {
        let sz = self.standardizer.as_ref()?;
        self.explain_std(0, &sz.transform(phi_raw))
    }

    fn explain_std(&self, id: u64, phi: &[f64]) -> Option<Explanation> {
        let p = self.posterior.as_ref()?;
        if phi.is_empty() {
            return None;
        }
        let responsibilities = p.responsibilities(phi);
        let style = responsibilities
            .iter()
            .enumerate()
            .max_by(|(_, x), (_, y)| x.total_cmp(y))
            .map(|(k, _)| k)
            .unwrap_or(0);
        let theta = p.theta_mean(style);
        let names = phi_names();
        let mut contributions: Vec<Contribution> = names
            .iter()
            .zip(&theta)
            .zip(phi)
            .map(|((name, t), x)| Contribution {
                name: name.clone(),
                theta: *t,
                phi_std: *x,
                contribution: t * x,
            })
            .collect();
        contributions.sort_by(|a, b| b.contribution.abs().total_cmp(&a.contribution.abs()));
        // `utility`/`utility_std` describe the lens quantity the contributions
        // sum to; `mix_utility` is what the bank is sorted by. Both are
        // returned because they are genuinely different claims and the caller
        // needs to know which one it is drawing.
        let (utility, utility_std) = p.utility(phi, style);
        Some(Explanation {
            id,
            style,
            style_name: self.style_names.get(style).cloned().unwrap_or_default(),
            utility,
            utility_std,
            mix_utility: p.utility_mix(phi).0,
            responsibility: responsibilities.get(style).copied().unwrap_or(0.0),
            contributions,
        })
    }

    /// Musical display names for the whole pool, unique across it. Keyed by
    /// candidate id; a user-given name always wins.
    ///
    /// User and preset names are claimed **first and through the same
    /// registry** as generated ones. Substituting them afterwards, as this
    /// once did, let a preset called `Glass Pad` and a generated `Glass Pad`
    /// both survive into the bank: the preset occupied the name without ever
    /// competing for it.
    ///
    /// Generated names are the ones [`Engine::fix_names`] kept, read back as
    /// they were given. This used to read every one afresh off the pool's
    /// terciles on each call, so a generation that replaced nine patches
    /// renamed patches that had not changed: the one on the bench went from
    /// `Soft Drone` to `Soft Lead` as the generation landed, and numerals
    /// shifted when the name they counted from left. Only a patch not yet
    /// named (the bank not yet handed over, or handed over with fewer than
    /// [`NAME_FLOOR`] sounds in it) gets a provisional name, read off the pool
    /// as it stands.
    pub fn display_names(&self) -> HashMap<u64, String> {
        let mut taken: HashSet<String> = HashSet::new();
        let mut out: HashMap<u64, String> = HashMap::new();

        // Explicit names first — they are not negotiable, so they get to
        // reserve their spelling before anything is generated.
        for c in &self.pool {
            if let Some(name) = &c.name {
                out.insert(c.id, claim_name(name, &mut taken));
            }
        }
        // Then generated ones, in id order: a patch's numeral must not
        // reshuffle when the pool is re-ranked underneath it. Kept names are
        // claimed as given (unique when given, so they come back unchanged
        // unless a user name has since taken the spelling)…
        let mut rest: Vec<&Candidate> = self.pool.iter().filter(|c| c.name.is_none()).collect();
        rest.sort_by_key(|c| c.id);
        for c in &rest {
            if let Some(name) = &c.auto_name {
                out.insert(c.id, claim_name(name, &mut taken));
            }
        }
        // …and any patch not yet named reads a provisional one off the pool.
        if rest.iter().any(|c| c.auto_name.is_none()) {
            let scale = NameScale::fit(self.pool.iter().map(|c| &c.features));
            for c in rest.iter().filter(|c| c.auto_name.is_none()) {
                out.insert(c.id, claim_name(&scale.name(&c.features), &mut taken));
            }
        }
        out
    }

    /// Give every patch without a name its generated one, **kept from then
    /// on**: read off the pool it joins ([`NameScale`]), claimed against every
    /// name already held, and never read again. A patch's name says what it
    /// sounds like next to the bank it arrived in; recomputing it as the bank
    /// moved renamed patches that had not changed.
    ///
    /// Names start being kept once the bank is handed over — a standardizer
    /// exists: the fill has finished, or a progressive boot made the partial
    /// pool duel-able ([`Engine::standardize_now`]) — which is when a player
    /// first sees them. Called wherever the pool grows after that.
    ///
    /// Which name a patch gets depends only on the patches and the order the
    /// engine took them in, never on when a frontend asked (ADR-001). The
    /// handover is a when: a progressive boot hands the bank over at the
    /// first batch of farm results that reaches its threshold, so the bank it
    /// holds then can be 8 sounds on one run and more on the next. Reading
    /// every name off that bank named one seeded pool differently from run to
    /// run (#154). So the first names wait for [`NAME_FLOOR`] sounds (or a fill
    /// that can add no more), and each patch is read off the members that
    /// joined no later than it, and at least the first `NAME_FLOOR`: ids are
    /// handed out in the order patches join, which in a fill is the seed's
    /// draw order. A handover at 8, at 15 or at the end of the fill gives the
    /// same names, and so does a fill folded in one at a time or two at a
    /// time. A patch that joins after the fill has the newest id, so it is
    /// read off the whole pool, and so is a patch named out of joining order:
    /// a bank restored from a session saved before names were kept (a
    /// restore is not a fill, and is named as one bank, as it always was),
    /// and a sound whose own name was cleared and that never had a generated
    /// one.
    fn fix_names(&mut self) {
        if self.standardizer.is_none()
            || self
                .pool
                .iter()
                .all(|c| c.name.is_some() || c.auto_name.is_some())
        {
            return;
        }
        // The fill's first names: this engine's own fill has folded draws in
        // and nothing is named yet. They wait for a bank the seed decides,
        // not the one the handover happened to catch. A restore is not a
        // fill (its cursor has not moved), so a bank saved before names were
        // kept is named as it was before: all at once, off the whole bank.
        let newest_kept = self
            .pool
            .iter()
            .filter(|c| c.auto_name.is_some())
            .map(|c| c.id)
            .max();
        let fill_first = newest_kept.is_none() && self.draw_cursor > 0;
        let floor = NAME_FLOOR.min(self.cfg.pool_size).max(1);
        let fill_spent = self.draw_cursor >= self.cfg.max_draws as u64;
        if fill_first && self.pool.len() < floor && !fill_spent {
            return;
        }
        // The newest member a fresh patch is read against. One named in
        // joining order (the fill's first names, or newer than every kept
        // name): itself, the bank as it stood when it joined, or the
        // `floor`-th to join, whichever came later. Any other (a restored
        // bank saved before names were kept, a sound whose own name was
        // cleared and that never had a generated one): the whole pool, as it
        // stands.
        let floor_id = {
            let mut ids: Vec<u64> = self.pool.iter().map(|c| c.id).collect();
            ids.sort_unstable();
            ids[floor.min(ids.len()) - 1]
        };
        let in_order = |id: u64| fill_first || newest_kept.is_some_and(|kept| id > kept);
        let reach = |id: u64| {
            if in_order(id) {
                id.max(floor_id)
            } else {
                u64::MAX
            }
        };
        let mut taken: HashSet<String> = self
            .pool
            .iter()
            .filter_map(|c| c.name.clone().or_else(|| c.auto_name.clone()))
            .collect();
        let mut fresh: Vec<usize> = (0..self.pool.len())
            .filter(|&i| self.pool[i].name.is_none() && self.pool[i].auto_name.is_none())
            .collect();
        fresh.sort_by_key(|&i| self.pool[i].id);
        let mut scale: Option<(u64, NameScale)> = None;
        for i in fresh {
            let upto = reach(self.pool[i].id);
            if scale.as_ref().map(|(u, _)| *u) != Some(upto) {
                let joined = self.pool.iter().filter(|c| c.id <= upto);
                scale = Some((upto, NameScale::fit(joined.map(|c| &c.features))));
            }
            let (_, by) = scale.as_ref().expect("fit above");
            let name = claim_name(&by.name(&self.pool[i].features), &mut taken);
            self.pool[i].auto_name = Some(name);
        }
    }

    /// Name (or rename; empty clears) a candidate.
    pub fn set_name(&mut self, id: u64, name: &str) {
        if let Some(i) = self.find(id) {
            let trimmed = name.trim();
            self.pool[i].name = (!trimmed.is_empty()).then(|| trimmed.chars().take(40).collect());
            // A name cleared hands the patch back to a generated one, kept like
            // any other.
            self.fix_names();
        }
    }

    /// How many patches may be pinned at once: a quarter of the pool.
    ///
    /// The pool is the model's *working set*, not storage — duel pairing is
    /// uniform over it and refinement seeds from the top of `ranked()` — so
    /// pins are spent capacity, and the only wholly wasted duel is one where
    /// both sides are pinned. At a quarter of the pool that is ~6% of pairs,
    /// with three quarters of the pool still free to churn; at half it is 25%.
    /// A quarter buys the user far more than they lose.
    ///
    /// The cap also keeps "everything is pinned" unreachable, which matters
    /// because that state has no honest report: it surfaces as
    /// [`Engine::insert_candidate`] returning `None`, which every caller
    /// already renders as "no proposal beat its parent" — a statement about
    /// the search that would then be a lie about storage.
    pub fn pin_cap(&self) -> usize {
        (self.cfg.pool_size / 4).max(1)
    }

    /// How many pool members are currently pinned.
    pub fn pinned_count(&self) -> usize {
        self.pool.iter().filter(|c| c.pinned).count()
    }

    /// Pin or unpin a patch against eviction. Returns `false` when the id is
    /// unknown, or when pinning would exceed [`Engine::pin_cap`] — callers are
    /// expected to say which, rather than letting the control fail silently.
    ///
    /// Records **no observation**: a pin says what the user wants to keep, not
    /// what they think of it. See [`Candidate::pinned`].
    pub fn set_pinned(&mut self, id: u64, pinned: bool) -> bool {
        let Some(i) = self.find(id) else {
            return false;
        };
        if pinned && !self.pool[i].pinned && self.pinned_count() >= self.pin_cap() {
            return false;
        }
        self.pool[i].pinned = pinned;
        if !pinned {
            // Unsaved, a sound kept as new counts toward the cap again.
            self.bound_unjudged();
        }
        true
    }

    /// Insert a named preset into the pool (protected from immediate
    /// eviction pressure only by its utility, like any candidate; the member
    /// it displaces is the lowest one not kept, [`Candidate::kept`]). Returns
    /// the new id.
    pub fn insert_preset(&mut self, tree: PatchTree, name: &str) -> Option<u64> {
        if let Some(existing) = self.pool.iter().find(|c| c.tree == tree) {
            return Some(existing.id);
        }
        let id = self.insert_candidate(tree, Origin::Preset, None)?;
        self.set_name(id, name);
        Some(id)
    }

    /// Export the portable profile (log + standardizer, which only mean
    /// anything together).
    pub fn export_profile(&self) -> Profile {
        Profile {
            log: self.log.clone(),
            standardizer: self.standardizer.as_deref().cloned(),
        }
    }

    /// Export the full session (profile + bank + lineage) for persistence.
    /// Renders and features are intentionally omitted — trees re-featurize
    /// deterministically on import.
    pub fn export_state(&self) -> SessionState {
        SessionState {
            profile: self.export_profile(),
            bank: self
                .pool
                .iter()
                .map(|c| BankEntry {
                    id: c.id,
                    tree: c.tree.clone(),
                    origin: c.origin,
                    name: c.name.clone(),
                    pinned: c.pinned,
                    auto_name: c.auto_name.clone(),
                    unjudged: c.unjudged,
                })
                // Held sounds go back as they came, after the pool: a restore
                // holds them again until their take is replaced.
                .chain(self.held.iter().cloned())
                .collect(),
            lineage: self.lineage.clone(),
            generation: self.generation,
            style_names: self.style_names.clone(),
            events: self.events.clone(),
            forecasts: self.forecasts.clone(),
            style_shares: self.style_shares.clone(),
            map_axes: self.drawn_axes().clone(),
            audition_clip: self
                .cfg
                .phrase
                .clip
                .as_ref()
                .and_then(|c| serde_json::to_value(c).ok()),
            own_sound: self.own.clone(),
        }
    }

    /// Restore a saved session, replacing pool, log, standardizer, lineage,
    /// and id allocation. Each bank tree is re-featurized (and re-rendered
    /// when `keep_renders`); entries that no longer vet are dropped. Returns
    /// how many bank entries were restored.
    pub fn import_state(&mut self, state: SessionState) -> usize {
        let want_audio = self.wants_admitted_audio();
        let bank = self.import_state_deferred(state);
        for entry in bank {
            let Ok((cached, audition)) =
                featurize_memo(&entry.tree, &self.cfg.phrase, &self.memo, want_audio)
            else {
                continue;
            };
            let pre = PreFeaturized {
                tree: entry.tree.clone(),
                cached,
                audition,
            };
            self.absorb_bank_entry(entry, pre);
        }
        self.finish_restore()
    }

    /// Restore a saved session **without rendering the bank**: everything
    /// [`Engine::import_state`] does except the per-entry featurize, returning
    /// the bank entries for off-engine work, in bank order.
    ///
    /// Restore is the returning user's boot and today it is *worse* than a
    /// cold one — a full bank of serial re-renders behind a bar that cannot
    /// move, because nothing lands until all of it finishes. This is the seam
    /// that lets the farm do it: each entry comes back through
    /// [`Engine::absorb_bank_entry`] and [`Engine::finish_restore`] closes the
    /// restore, and the three together are exactly `import_state`.
    ///
    /// Profile-then-clear ordering is preserved from `import_state`:
    /// [`Engine::import_profile`] may re-fit a standardizer over the *current*
    /// pool, so clearing before it would change the scale a restore lands on.
    pub fn import_state_deferred(&mut self, state: SessionState) -> Vec<BankEntry> {
        // The clip first: every bank entry that listens is measured with it.
        self.restore_clip(state.audition_clip);
        self.import_profile(state.profile);
        self.lineage = state.lineage;
        self.generation = state.generation;
        self.style_names = state.style_names;
        self.events = state.events;
        self.forecasts = state.forecasts;
        self.style_shares = state.style_shares;
        *self.drawn_axes() = state.map_axes;
        self.own = state.own_sound;
        // The implicit stream stores raw φ on both sides of a hand edit, so it
        // is the fourth carrier of the corruption after the pool, the log and
        // the HELD tray — and the only one nothing reads yet, which is exactly
        // why it would have been the one still poisoned on the day it was
        // first fitted on.
        let names = phi_names();
        for e in &mut self.events {
            self.repaired_cells +=
                crate::migrate::repair_phi_pair(&mut e.phi_before, &mut e.phi_after, &names);
        }
        // A generation open over the old bank has nothing left to absorb into,
        // and neither has a ⚡ walk from it.
        self.open = None;
        self.evolving.clear();
        self.pool.clear();
        self.audio_lru.clear();
        self.shown_pairs.clear();
        self.shown_candidates.clear();
        self.dealt_unshown.clear();
        self.bound_events();
        // Every saved term, repaired on the way in. This is the *only* place a
        // tree written by an older build enters the engine, and a bank entry
        // carrying a knob outside its range would otherwise be quarantined by
        // the featurizer a few lines later and silently disappear from the
        // player's bank — losing four patches to fix a bug in one number.
        // Repair keeps the patch and loses only the corruption, which is the
        // standing rule for saved state: migration, never deletion.
        //
        // A CAPTURE whose saved take could not be read is the same rule: the
        // sound came back whole with that take empty (`Take`'s loader never
        // fails the term). Whether it is *repaired* or *held* depends on
        // whether it still renders, which the caller finds out: one that lands
        // in the pool counts as repaired (`absorb_bank_entry`), one that does
        // not is held (`finish_restore`). Kept as loaded, before the clamp,
        // which rebuilds a term it mends and so forgets which take was
        // unreadable, and whose rebuild would drop the take's saved text.
        self.held.clear();
        self.pending_held.clear();
        let mut bank = state.bank;
        for entry in &mut bank {
            let lost = (entry.tree.lost_takes() > 0).then(|| entry.clone());
            let clamped = entry.tree.clamp_domains() > 0;
            if clamped {
                self.repaired_terms += 1;
            }
            if let Some(original) = lost {
                self.pending_held
                    .entry(entry.id)
                    .or_default()
                    .push(PendingHeld {
                        original,
                        clamped,
                        restored: entry.tree.clone(),
                    });
            }
        }
        bank
    }

    /// Install a session's saved clip, or the reference when there is none
    /// or it cannot be read (and remember why, for
    /// [`Engine::audition_clip_status`]).
    fn restore_clip(&mut self, saved: Option<serde_json::Value>) {
        self.clip_unreadable = None;
        self.cfg.phrase.clip = match saved {
            None => None,
            Some(v) => match serde_json::from_value::<SavedClip>(v)
                .map_err(|e| e.to_string())
                .and_then(|s| AuditionClip::from_saved(&s).map_err(|e| e.to_string()))
            {
                Ok(clip) => Some(clip.at_rate(self.cfg.phrase.sample_rate)),
                Err(why) => {
                    self.clip_unreadable = Some(why);
                    None
                }
            },
        };
    }

    /// Measure the patches that listen with `clip` from now on (`None`: the
    /// built-in reference), and measure again the pool members that listen.
    ///
    /// Only those: a patch that does not listen measures the same under any
    /// clip, and its render key does not carry one. A member that no longer
    /// vets under the new clip keeps the measurement it had and is reported
    /// in [`ClipChange::unmeasured`]; a clip change never deletes a patch
    /// (and a silent clip, the likely way to fail every one at once, cannot
    /// be made). A generation open over the old clip is not disturbed: its
    /// children's keys name the old clip, and admission measures them again.
    pub fn set_audition_clip(&mut self, clip: Option<AuditionClip>) -> ClipChange {
        let clip = clip.map(|c| c.at_rate(self.cfg.phrase.sample_rate));
        self.clip_unreadable = None;
        if self.cfg.phrase.clip == clip {
            return ClipChange::default();
        }
        self.cfg.phrase.clip = clip;
        let want_audio = self.wants_admitted_audio();
        let mut change = ClipChange::default();
        for i in 0..self.pool.len() {
            if !self.pool[i].tree.listens() {
                continue;
            }
            let id = self.pool[i].id;
            let Ok((cached, audition)) =
                featurize_memo(&self.pool[i].tree, &self.cfg.phrase, &self.memo, want_audio)
            else {
                change.unmeasured.push(id);
                continue;
            };
            let phi_std = self
                .standardizer
                .as_ref()
                .map(|sz| sz.transform(&cached.features.phi()))
                .unwrap_or_default();
            let render = self.admitted_render(&self.pool[i].tree, &cached.features, audition);
            let c = &mut self.pool[i];
            c.features = cached.features;
            c.phi_std = phi_std;
            c.key = cached.key;
            c.render = render;
            change.remeasured.push(id);
        }
        change
    }

    /// Which clip the patches that listen are measured with, and, after a
    /// restore whose clip could not be read, why it is the reference.
    pub fn audition_clip_status(&self) -> ClipStatus {
        let clip = self.cfg.phrase.audition_clip();
        ClipStatus {
            source: clip.source(),
            id: clip.id().to_string(),
            seconds: clip.seconds(),
            channels: clip.channel_count(),
            unreadable: self.clip_unreadable.clone(),
        }
    }

    /// How many saved terms, log cells and whole observations the last
    /// [`Engine::import_state_deferred`] had to repair. All three are zero for
    /// a session written by a build that has this gate, except that a term
    /// counts as repaired when a CAPTURE's saved take could not be read (it
    /// loads empty; see `auracle_grammar::Take`), which a file damaged after
    /// it was written can cause under any build.
    ///
    /// Reported rather than logged because the frontend is the only thing that
    /// can tell the player their profile was mended, and a silent repair of the
    /// evidence a model is fitted on is exactly the kind of quiet the rest of
    /// this app was built to stop.
    pub fn repair_report(&self) -> (usize, usize, usize) {
        (
            self.repaired_terms,
            self.repaired_cells,
            self.dropped_observations,
        )
    }

    /// Reinstate one restored bank entry with its saved identity, from a
    /// featurization performed off-engine.
    ///
    /// Bypasses the pool-size and novelty checks, as `import_state`'s push
    /// does: a bank is a bank, not a candidate competition. `entry` supplies
    /// the identity (id, origin, name) and the term; `pre` supplies φ.
    pub fn absorb_bank_entry(&mut self, entry: BankEntry, pre: PreFeaturized) {
        let PreFeaturized {
            tree: _,
            cached,
            audition,
        } = pre;
        self.memo.put(cached.clone(), audition.clone());
        let phi_std = self
            .standardizer
            .as_ref()
            .map(|sz| sz.transform(&cached.features.phi()))
            .unwrap_or_default();
        let render = self.admitted_render(&entry.tree, &cached.features, audition);
        // A sound whose unreadable take was not its only source: it renders
        // without it, so it is repaired, not held.
        if let Some(waiting) = self.pending_held.get_mut(&entry.id) {
            // The one this is, by content; a repeated id cannot make another
            // entry's record stand in for it.
            let at = waiting
                .iter()
                .position(|p| p.restored == entry.tree)
                .unwrap_or(0);
            if !waiting.remove(at).clamped {
                self.repaired_terms += 1;
            }
            if waiting.is_empty() {
                self.pending_held.remove(&entry.id);
            }
        }
        // `saturating_add`: a hostile `u64::MAX` in a shared file must not wrap
        // the allocator back to 0 and start reissuing live ids.
        self.next_id = self.next_id.max(entry.id.saturating_add(1));
        self.pool.push(Candidate {
            id: entry.id,
            tree: settled(entry.tree),
            features: cached.features,
            phi_std,
            key: cached.key,
            render,
            origin: entry.origin,
            name: entry.name,
            auto_name: entry.auto_name,
            pinned: entry.pinned,
            unjudged: entry.unjudged,
        });
    }

    /// Close a deferred restore once every entry that was going to land has.
    /// Returns the restored bank size.
    ///
    /// The standardizer normally comes from the profile; a session saved
    /// before the first fit completes has none — fit one from the restored
    /// bank so φ isn't left raw. Idempotent, and safe on an empty pool.
    pub fn finish_restore(&mut self) -> usize {
        // Whatever had an unreadable take and never landed did not render
        // without it: held, not dropped, and reported apart from the repairs
        // (one also mended by the clamp is uncounted there again).
        let mut held: Vec<(BankEntry, bool)> = self
            .pending_held
            .drain()
            .flat_map(|(_, v)| v)
            .map(|p| (p.original, p.clamped))
            .collect();
        held.sort_by_key(|(e, _)| e.id);
        for (mut entry, clamped) in held {
            if clamped {
                self.repaired_terms = self.repaired_terms.saturating_sub(1);
            }
            entry.tree.keep_unreadable_takes();
            self.next_id = self.next_id.max(entry.id.saturating_add(1));
            self.held.push(entry);
        }
        if self.standardizer.is_none() && !self.pool.is_empty() {
            let rows: Vec<Vec<f64>> = self.pool.iter().map(|c| c.features.phi()).collect();
            let sz = Arc::new(Standardizer::fit(&rows));
            for c in &mut self.pool {
                c.phi_std = sz.transform(&c.features.phi());
            }
            self.standardizer = Some(sz);
        }
        // A session saved before names were kept is named here, once,
        // against the whole bank it restored: a restore is not a fill, so
        // the fill's joining order does not apply (`fix_names`).
        self.fix_names();
        // A file can claim more sounds kept as new than the cap allows (an
        // engine with a smaller pool, or a hand edit): the bound holds anyway.
        self.bound_unjudged();
        self.pool.len()
    }

    /// The sounds the last restore held back because a CAPTURE's take could
    /// not be read and the sound did not render without it ("its recording
    /// couldn't be read"), in id order. Not in the pool: nothing deals, fits,
    /// maps, wires or walks them until [`Engine::readmit_held`].
    pub fn held(&self) -> &[BankEntry] {
        &self.held
    }

    /// Bring a held sound back with a readable take in place of the one that
    /// could not be read: the take goes on its first unreadable CAPTURE (any
    /// other unreadable take is cleared), and the sound is measured as a new
    /// one and joins the pool under its own id, name and origin. If it still
    /// does not vet it stays held. Returns its id.
    pub fn readmit_held(&mut self, id: u64, take: Take) -> Result<u64, ReadmitError> {
        let at = self
            .held
            .iter()
            .position(|e| e.id == id)
            .ok_or(ReadmitError::NotHeld)?;
        if take.is_empty() || take.unreadable().is_some() {
            return Err(ReadmitError::NoTake);
        }
        let mut entry = self.held[at].clone();
        if !entry.tree.replace_lost_take(&take) {
            return Err(ReadmitError::NothingToReplace);
        }
        entry.tree.clamp_domains();
        let want_audio = self.wants_admitted_audio();
        let (cached, audition) =
            featurize_memo(&entry.tree, &self.cfg.phrase, &self.memo, want_audio)
                .map_err(|e| ReadmitError::DoesNotVet(e.to_string()))?;
        self.held.remove(at);
        let pre = PreFeaturized {
            tree: entry.tree.clone(),
            cached,
            audition,
        };
        self.absorb_bank_entry(entry, pre);
        self.fix_names();
        self.bound_unjudged();
        Ok(id)
    }

    /// Import a profile: replaces the log and re-establishes a standardizer
    /// for it.
    ///
    /// A profile written before raw-φ logging carries *standardized* vectors,
    /// which are only interpretable through the standardizer that shipped with
    /// them — so that pairing is exactly what makes the migration possible
    /// ([`crate::migrate`]): invert the transform, convert the coordinates
    /// whose units changed, and the log becomes raw evidence again. Its
    /// standardizer is then obsolete by construction (it has the wrong
    /// dimension for the current feature set) and a fresh one is fit from the
    /// migrated data. A same-schema profile keeps its standardizer, so
    /// imported θ geometry stays valid until the next fit refreshes it.
    pub fn import_profile(&mut self, profile: Profile) {
        self.log = profile.log;
        // A fresh restore reports on *itself*. `import_state_deferred` runs
        // this first and then counts the bank, so clearing all three here is
        // also what keeps a standalone "load taste profile" from inheriting the
        // patch count of whatever was loaded before it.
        self.repaired_terms = 0;
        self.repaired_cells = 0;
        self.dropped_observations = 0;
        let names = phi_names();
        if let Some(sz) = &profile.standardizer {
            if crate::migrate::needs_migration(&self.log) {
                // Schema-1 values were measured under the v1 stimulus, so
                // they land on the v1 names — FitSet::build keeps their
                // structural coordinates and imputes today's stimulus-tagged
                // audio coordinates at "no evidence" (migrate::v1_names).
                crate::migrate::migrate_log(
                    &mut self.log,
                    sz,
                    &crate::migrate::v1_names(),
                    self.cfg.phrase.sample_rate / 2.0,
                );
            }
        }
        // Before stamping: a coordinate that was renamed since this profile
        // was written still holds the right *value*, and `FitSet::build`
        // matches by name — so the rename has to be applied to the stored
        // names or the evidence is imputed away as "no opinion".
        crate::migrate::apply_renames(&mut self.log);
        crate::migrate::stamp_names(&mut self.log, &names);
        // After the names are stamped, because the repair is by name — and
        // before the standardizer is adopted, because a standardizer fitted
        // over a poisoned column is itself poisoned. When anything was
        // repaired the saved one is *discarded* and re-fitted from the
        // repaired rows plus the pool: keeping it would mean the load re-read
        // its own corruption back out of the scale it set.
        let (clamped, dropped) = crate::migrate::repair_log(&mut self.log);
        self.repaired_cells = clamped;
        self.dropped_observations = dropped;
        // Sessions too short to have earned a τ of their own — the residue of
        // every reload opening one before `begin_session` learned to wait —
        // are folded into the session before them. A migration like the
        // others here: applied on load, and the log written back is the
        // merged one.
        crate::migrate::merge_short_sessions(&mut self.log, MIN_SESSION_OBS);
        let poisoned = clamped > 0 || dropped > 0;
        match profile.standardizer {
            Some(sz) if sz.dimension() == names.len() && !poisoned => {
                let sz = Arc::new(sz);
                for c in &mut self.pool {
                    c.phi_std = sz.transform(&c.features.phi());
                }
                self.standardizer = Some(sz);
            }
            _ => {
                self.standardizer = None;
                self.refit_standardizer();
            }
        }
        self.session = self.log.n_sessions();
        self.posterior = None;
    }
}

#[cfg(test)]
mod tests;
