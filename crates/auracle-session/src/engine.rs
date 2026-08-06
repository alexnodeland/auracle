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
    featurize_memo, render_playback, Audition, Features, PhraseSpec, RenderMemo,
};
use auracle_grammar::prior::N_OPS;
use auracle_grammar::{tree_diff, DiffEntry, PatchGrammarPrior, PatchTree};
use auracle_taste::{
    Feedback, FitSet, Observation, ObservationLog, Provenance, Standardizer, TasteConfig,
    TasteModel, TastePosterior,
};
use fugue::Trace;
use fugue_evo::inference::mh::EvolutionChain;
use fugue_evo::inference::model::EvolutionModel;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde::{Deserialize, Serialize};

use crate::calib::{calibration, Calibration, Forecast};
use crate::farm::{draw_seed, Draw, PreFeaturized};
use crate::naming::{claim_name, NameScale};
use crate::surrogate::SurrogateFitness;

/// Ceiling on the step-count compensation for locked sites — the most a locked
/// refinement walk may cost relative to an unlocked one.
///
/// 4× fully compensates a walk with three quarters of its sites pinned, which is
/// already a heavier lock than the hand-build → pin → breed loop produces. Past
/// that the walk is deliberately under-compensated, because `⚡ evolve from
/// this` is a button press with a person waiting behind it and a 90%-locked
/// patch would otherwise ask for ten times the budget. See the note at the use
/// site in `refine_one` for what that costs.
const LOCK_SCALE_CAP: f64 = 4.0;

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
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
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
    /// `d·K + n_sessions + 5` — at today's d = 40, that is 46 at K = 1 and
    /// **206 at K = 5** (printed by `fit_bench`, so it moves with φ). Two
    /// consequences, both measured by `auracle-taste/examples/fit_bench.rs`:
    /// the fit is ~4× slower at the cap than at the first fit, and the step
    /// budget is *fixed*, so a mature fit gets ~4× fewer sweeps per site than
    /// an early one — growing K makes the fit both slower and statistically
    /// thinner.
    ///
    /// **Open option, deliberately not taken here: cap this at 3** (sites
    /// 206 → 126, a ~1.6× mature-fit win at no engineering cost). It is left
    /// open because unlike the address hoist and the budget cut it is not a
    /// pure efficiency change — it removes model *capacity*, and capacity is
    /// the whole point of the mixture (a user with four islands of taste
    /// cannot be represented by three lenses). Take it only on evidence:
    /// [`TastePosterior::style_share`](auracle_taste::TastePosterior::style_share)
    /// reports what fraction of the pool each lens claims, and if lenses 4
    /// and 5 sit near zero share across real sessions they are paying 54
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
    /// buy draws — it buys **sweeps per site**, and at K = 5 (206 sites) even
    /// 10 000 steps is only ~49 sweeps.
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
    /// Strength of the taste→grammar proposal tilt (0 disables): structural
    /// θ components multiply the grammar's kind weights by
    /// `exp(η·θ)` during refinement.
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
    /// Show one uniformly-random "check" duel every N duels. An
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
/// taken — cap K at 3, taking the fit from 206 sites to 126 for a ~1.6×
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
    /// `"random"` (no posterior), `"check"`, or `"bald"`.
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
    let s1 = &posterior.samples[rng.gen_range(0..n)];
    let s2 = &posterior.samples[rng.gen_range(0..n)];
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

/// Unordered key for a candidate pair.
fn pair_key(a: u64, b: u64) -> (u64, u64) {
    if a <= b {
        (a, b)
    } else {
        (b, a)
    }
}

/// The session engine.
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
    /// Duels offered this run (not the same as observations recorded — the
    /// user may skip). Paces the random check duels.
    duels_shown: usize,
    /// The most recently offered *check* pair, so the forecast it produces can
    /// be tagged as unbiased even though the frontend records it like any
    /// other duel.
    last_check_pair: Option<(u64, u64)>,
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
            last_check_pair: None,
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
        }
    }

    /// Replace the featurization memo every featurize in this engine consults
    /// — fill, insert, restore, and the refinement surrogate.
    ///
    /// Shared rather than owned so a frontend can pre-load one and read back
    /// what the engine learned. Refinement captures it by clone at
    /// [`Engine::refine_one`] time, so swapping it mid-generation is not
    /// something to do.
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
    pub fn begin_session(&mut self) -> usize {
        if !self.log.is_empty() {
            self.session = self.log.n_sessions();
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
            let want_audio = self.wants_admitted_audio();
            if let Ok((cached, audition)) =
                featurize_memo(&tree, &self.cfg.phrase, &self.memo, want_audio)
            {
                self.push_prior(PreFeaturized {
                    tree,
                    cached,
                    audition,
                });
                added += 1;
            }
        }
        self.standardize_pool();
        added
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
        let mut id = None;
        if let Some(pre) = pre {
            if !self.pool.iter().any(|c| c.tree == pre.tree) {
                id = Some(self.push_prior(pre));
            }
        }
        self.standardize_pool();
        id
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
            pinned: false,
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
        let k = (1 + self.log.len() / 20).min(self.cfg.k_styles).max(1);
        let mut taste_cfg = TasteConfig::mixture(d, k);
        taste_cfg.recency_half_life = self.cfg.recency_half_life;
        let model = TasteModel::new(taste_cfg);
        let data = FitSet::build(&self.log, &names, &sz);
        let posterior = model.fit(rng, &data, self.cfg.mcmc_samples, self.cfg.mcmc_warmup);
        let posterior = Arc::new(posterior.aligned());
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
        if locked.is_empty() {
            return false;
        }
        for (addr, c) in &prev.choices {
            if locked.contains(&**addr) {
                match next.choices.get(addr) {
                    Some(n) if n.value == c.value => {}
                    _ => return true,
                }
            }
        }
        for addr in next.choices.keys() {
            if locked.contains(&**addr) && !prev.choices.contains_key(addr) {
                return true;
            }
        }
        false
    }

    /// Grammar prior with kind-weights tilted toward the fitted taste: each
    /// structural θ component (share-weighted across styles) multiplies its
    /// kind's proposal weight by `exp(η·θ)`. This is θ_struct → grammar
    /// feedback — refinement *proposes* toward the user instead of merely
    /// filtering, which is where visible directionality comes from.
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
    fn biased_prior(&self) -> PatchGrammarPrior {
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
        let binary_tilt = sources.iter().sum::<f64>() / sources.len() as f64;
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
        let (shape, logic) = (g("n_mod_shape"), g("n_mod_logic"));
        let md = tilt_weights(
            &prior.mod_weights,
            &[
                0.0,
                g("n_lfo"),
                g("n_env"),
                g("n_rand"),
                g("n_follow"),
                logic, // euclid — counted inside n_mod_logic
                shape, // op
                logic, // pair
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

    /// Run locked MH refinement from one seed. Returns the end state if it
    /// differs from the seed.
    fn refine_one<R: Rng>(
        &self,
        rng: &mut R,
        seed: &PatchTree,
        locked: &HashSet<String>,
        steps: usize,
    ) -> Option<PatchTree> {
        let (posterior, standardizer) = match (&self.posterior, &self.standardizer) {
            (Some(p), Some(s)) => (Arc::clone(p), Arc::clone(s)),
            _ => return None,
        };
        let fitness = SurrogateFitness {
            posterior,
            standardizer,
            phrase: self.cfg.phrase.clone(),
            memo: self.memo.clone(),
        };
        let model = EvolutionModel::new(self.biased_prior(), fitness).with_beta(self.cfg.beta);
        let mut chain = EvolutionChain::new(model);
        let mut trace = chain.init_from(seed)?;

        // Scale steps for proposals wasted on locked sites. The kernel picks a
        // target site uniformly over all of them, so with a fraction `f` free
        // only `f` of the proposals can be accepted and the walk needs `1/f`
        // times as many steps to travel as far.
        //
        // **The cap is a cost bound, not a correction**, and it is stated
        // rather than left silent. Past 75% of sites locked, `LOCK_SCALE_CAP`
        // stops the compensation short — a patch with 90% of its sites pinned
        // would otherwise ask for ten times the budget, and a `⚡ evolve from
        // this` on a heavily-pinned patch is a button press with a person
        // waiting behind it. So a very heavily locked walk *does* explore less
        // than the config nominally buys. That is the intended trade; the thing
        // to avoid is believing otherwise.
        let total_sites = trace.choices.len().max(1);
        let locked_present = trace
            .choices
            .keys()
            .filter(|a| locked.contains(&***a))
            .count();
        let free = total_sites.saturating_sub(locked_present).max(1);
        let factor = (total_sites as f64 / free as f64).min(LOCK_SCALE_CAP);
        let steps = ((steps as f64) * factor).ceil() as usize;

        let mut current = seed.clone();
        // The elite archive, and it is **free**.
        //
        // Every trace the kernel hands back is already scored under the target
        // program, so `total_log_weight()` *is* `log π_β = log p_grammar +
        // β·E[u]` for the state it accompanies — no extra model execution, no
        // extra featurization, one f64 compare per step.
        //
        // Scored on the target rather than on fitness alone, which is the
        // choice worth stating. Taking the argmax of `E[u]` would discard the
        // parsimony half of the very distribution the walk is sampling, and it
        // would do so with a bias: a bigger term has more modules to score
        // well with, so fitness-argmax systematically returns the largest tree
        // the walk touched. `log π_β` is what the walk is climbing, so it is
        // what "the best point this walk found" has to mean.
        //
        // The seed is in the archive. A walk that never improves on where it
        // started therefore returns the seed and is filtered to `None` below,
        // instead of injecting whatever it happened to be standing on at step
        // 40 — which is what `Last` does, and is the thing being A/B'd.
        let mut best: Option<(f64, PatchTree)> = match self.cfg.refine_keep {
            RefineKeep::Last => None,
            RefineKeep::Best => Some((trace.total_log_weight(), seed.clone())),
        };
        for _ in 0..steps {
            let (g, t) = chain.step(rng, &trace);
            if Self::violates_locks(&trace, &t, locked) {
                continue; // reject outside the kernel; stay at `trace`
            }
            if let Some((best_w, best_tree)) = &mut best {
                let w = t.total_log_weight();
                if w > *best_w {
                    *best_w = w;
                    *best_tree = g.clone();
                }
            }
            current = g;
            trace = t;
        }
        if let Some((_, best_tree)) = best {
            current = best_tree;
        }
        // The mutation boundary, and the reason the clamp is *here* rather than
        // at the knob that draws the number: everything downstream of this line
        // — φ, the observation log, the faceplate, the exported PNG — takes the
        // term as given, so a value that leaves this function wrong is wrong in
        // six places by the time anyone can see it.
        //
        // The kernel should never produce one. Every continuous site is
        // `Uniform(0,1)`, whose `log_prob` is −∞ outside the unit interval, so
        // a proposal that escapes scores `log α = −∞` and is rejected — and
        // that is measured, not assumed: `auracle-grammar --example
        // mh_escape` runs 8 chains × 20 000 single-site transitions through
        // this exact kernel and observes zero escapes. So this is a belt on a
        // proven brace, costing one trace walk per accepted child, and its real
        // job is to be the line that has to be deleted before the invariant can
        // be broken again.
        debug_assert_eq!(
            current.domain_violations().len(),
            0,
            "MH seated an out-of-domain site: {:?}",
            current.domain_violations()
        );
        current.clamp_domains();
        (current != *seed).then_some(current)
    }

    /// Insert a candidate (evicting the worst if full, never `protect`).
    /// Returns the new id, or `None` if the newcomer ranks below the evictee.
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
        let mean_new = self.utility_of(&phi_std);
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
                .filter(|(_, c)| Some(c.id) != protect && !c.pinned)
                .min_by(|(_, x), (_, y)| {
                    let (sx, ux) = rank(x);
                    let (sy, uy) = rank(y);
                    sx.cmp(&sy).then(ux.total_cmp(&uy))
                })
                .map(|(i, c)| (i, self.utility_of(&c.phi_std)));
            match worst {
                Some((worst_idx, worst_mean)) => {
                    // Hand edits always land (the user asked for them);
                    // refined candidates must earn their slot.
                    if origin == Origin::Refined && mean_new <= worst_mean {
                        return None;
                    }
                    self.pool.swap_remove(worst_idx);
                }
                None => return None,
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
            origin,
            name: None,
            pinned: false,
        });
        Some(id)
    }

    /// Taste-guided refinement: run fugue-evo typed MH on the Boltzmann
    /// target from each of the top seeds, and add improved, vetted, novel
    /// candidates to the pool (evicting the worst if full). Each injection
    /// is recorded as a lineage event.
    pub fn refine<R: Rng>(&mut self, rng: &mut R) {
        for parent_id in self.refine_begin() {
            self.refine_seed(rng, parent_id);
        }
    }

    /// Open a generation and return the parent ids it will refine from, best
    /// first. Empty if there is nothing to refine toward yet (no posterior),
    /// in which case the generation counter is **not** advanced.
    ///
    /// This exists so a caller can drive refinement one seed at a time and
    /// report progress between seeds. A whole generation is tens of seconds of
    /// render-bound work — running it as one opaque call is what made the app
    /// look hung.
    pub fn refine_begin(&mut self) -> Vec<u64> {
        if self.posterior.is_none() || self.standardizer.is_none() {
            return Vec::new();
        }
        self.generation += 1;
        self.ranked()
            .iter()
            .take(self.cfg.refine_seeds)
            .map(|&(i, _, _)| self.pool[i].id)
            .collect()
    }

    /// Refine from one seed of the open generation. Returns the injected child
    /// id, or `None` if the walk was rejected or landed on a patch the pool
    /// already holds.
    pub fn refine_seed<R: Rng>(&mut self, rng: &mut R, parent_id: u64) -> Option<u64> {
        let seed = self.pool[self.find(parent_id)?].tree.clone();
        let no_locks = HashSet::new();
        let end = self.refine_one(rng, &seed, &no_locks, self.cfg.refine_steps)?;
        if self.pool.iter().any(|c| c.tree == end) {
            return None;
        }
        self.record_child(parent_id, &seed, end, "refine", None)
    }

    /// Locked refinement from one explicit seed candidate: evolve everything
    /// *except* the locked addresses. Returns the injected child id.
    pub fn refine_from<R: Rng>(
        &mut self,
        rng: &mut R,
        seed_id: u64,
        locked: &[String],
    ) -> Option<u64> {
        let seed = self.pool[self.find(seed_id)?].tree.clone();
        let locked: HashSet<String> = locked.iter().cloned().collect();
        self.generation += 1;
        let end = self.refine_one(rng, &seed, &locked, self.cfg.refine_steps)?;
        if self.pool.iter().any(|c| c.tree == end) {
            return None;
        }
        self.record_child(seed_id, &seed, end, "refine", Some(seed_id))
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
        Some(child_id)
    }

    fn record_child(
        &mut self,
        parent_id: u64,
        seed: &PatchTree,
        mut end: PatchTree,
        kind: &str,
        protect: Option<u64>,
    ) -> Option<u64> {
        // The one place a refined child meets its seed, and therefore the one
        // place its node identities can be recovered.
        //
        // `refine_one` runs typed MH over the *trace*, and every accepted step
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
        let child_id = self.insert_candidate(end, Origin::Refined, protect)?;
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
        // Un-standardized candidates score utility exactly 0 (`dot` over an
        // empty vector), which beats every real utility once a user has killed
        // enough patches — they must not be selectable, the same guard
        // `ranked()` applies.
        let cands: Vec<usize> = (0..self.pool.len())
            .filter(|&i| !self.pool[i].phi_std.is_empty())
            .collect();
        if cands.len() < 2 {
            return None;
        }
        let uniform = |rng: &mut R| -> (usize, usize) {
            let i = rng.gen_range(0..cands.len());
            let mut j = rng.gen_range(0..cands.len() - 1);
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
            (Some(_), false) if self.cfg.acquisition == Acquisition::Random => {
                let (a, b) = uniform(rng);
                DuelChoice {
                    a,
                    b,
                    info_gain: 0.0,
                    random_check: true,
                    method: "random",
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

        self.duels_shown += 1;
        let key = pair_key(self.pool[choice.a].id, self.pool[choice.b].id);
        *self.shown_pairs.entry(key).or_insert(0) += 1;
        *self.shown_candidates.entry(key.0).or_insert(0) += 1;
        *self.shown_candidates.entry(key.1).or_insert(0) += 1;
        self.last_check_pair = choice.random_check.then_some(key);
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
            let i = rng.gen_range(0..cands.len());
            let mut j = rng.gen_range(0..cands.len() - 1);
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
        if let Some(p_a) = self.predict_duel(a, b) {
            let key = pair_key(self.pool[a].id, self.pool[b].id);
            self.forecasts.push(Forecast {
                p_a,
                chose_a,
                random_check: self.last_check_pair == Some(key),
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

    /// Record a keep/kill decision on a pool member (by pool index).
    pub fn record_keep(&mut self, idx: usize, kept: bool) {
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
    pub fn display_names(&self) -> HashMap<u64, String> {
        let scale = NameScale::fit(self.pool.iter().map(|c| &c.features));
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
        // reshuffle when the pool is re-ranked underneath it.
        let mut rest: Vec<&Candidate> = self.pool.iter().filter(|c| c.name.is_none()).collect();
        rest.sort_by_key(|c| c.id);
        for c in rest {
            out.insert(c.id, claim_name(&scale.name(&c.features), &mut taken));
        }
        out
    }

    /// Name (or rename; empty clears) a candidate.
    pub fn set_name(&mut self, id: u64, name: &str) {
        if let Some(i) = self.find(id) {
            let trimmed = name.trim();
            self.pool[i].name = (!trimmed.is_empty()).then(|| trimmed.chars().take(40).collect());
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
        true
    }

    /// Insert a named preset into the pool (protected from immediate
    /// eviction pressure only by its utility, like any candidate). Returns
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
                })
                .collect(),
            lineage: self.lineage.clone(),
            generation: self.generation,
            style_names: self.style_names.clone(),
            events: self.events.clone(),
            forecasts: self.forecasts.clone(),
            style_shares: self.style_shares.clone(),
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
        self.import_profile(state.profile);
        self.lineage = state.lineage;
        self.generation = state.generation;
        self.style_names = state.style_names;
        self.events = state.events;
        self.forecasts = state.forecasts;
        self.style_shares = state.style_shares;
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
        self.pool.clear();
        self.audio_lru.clear();
        // Every saved term, repaired on the way in. This is the *only* place a
        // tree written by an older build enters the engine, and a bank entry
        // carrying a knob outside its range would otherwise be quarantined by
        // the featurizer a few lines later and silently disappear from the
        // player's bank — losing four patches to fix a bug in one number.
        // Repair keeps the patch and loses only the corruption, which is the
        // standing rule for saved state: migration, never deletion.
        let mut bank = state.bank;
        for entry in &mut bank {
            if entry.tree.clamp_domains() > 0 {
                self.repaired_terms += 1;
            }
        }
        bank
    }

    /// How many saved terms, log cells and whole observations the last
    /// [`Engine::import_state_deferred`] had to repair. All three are zero for
    /// a session written by a build that has this gate.
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
        self.next_id = self.next_id.max(entry.id + 1);
        self.pool.push(Candidate {
            id: entry.id,
            tree: settled(entry.tree),
            features: cached.features,
            phi_std,
            key: cached.key,
            render,
            origin: entry.origin,
            name: entry.name,
            pinned: entry.pinned,
        });
    }

    /// Close a deferred restore once every entry that was going to land has.
    /// Returns the restored bank size.
    ///
    /// The standardizer normally comes from the profile; a session saved
    /// before the first fit completes has none — fit one from the restored
    /// bank so φ isn't left raw. Idempotent, and safe on an empty pool.
    pub fn finish_restore(&mut self) -> usize {
        if self.standardizer.is_none() && !self.pool.is_empty() {
            let rows: Vec<Vec<f64>> = self.pool.iter().map(|c| c.features.phi()).collect();
            let sz = Arc::new(Standardizer::fit(&rows));
            for c in &mut self.pool {
                c.phi_std = sz.transform(&c.features.phi());
            }
            self.standardizer = Some(sz);
        }
        self.pool.len()
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
