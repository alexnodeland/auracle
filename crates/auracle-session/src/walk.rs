//! A generation's walks as data: the jobs, the context they share, and the
//! walk itself as a pure function ([RFC-001], [ADR-007]).
//!
//! A refinement walk reads the engine and changes nothing; only admitting its
//! child changes the pool. So a generation splits into two halves:
//!
//! - **Jobs**, run anywhere. [`crate::Engine::refine_jobs`] opens a generation
//!   and hands back one [`WalkContext`] (what every walk of the generation
//!   shares: the tilted prior, the posterior, the standardizer, the phrase, β
//!   and the keep rule) and one [`WalkJob`] per parent (its seed, locks, step
//!   budget and RNG seed). [`run_walk`] turns a job into a [`WalkResult`], on
//!   the engine's thread or on a render-farm worker, in any order.
//! - **Absorption**, in the engine, in job order.
//!   [`crate::Engine::refine_absorb`] folds each result in exactly as the
//!   serial path always did: the novelty check, admission, lineage.
//!
//! ## Why a result cannot depend on where it ran
//!
//! Each job carries its own RNG seed, derived from **one** draw of the
//! caller's `refine` stream per generation ([`walk_seed`]), so no walk reads
//! a generator another walk advanced ([ADR-001]). The memo a walk consults
//! only ever saves renders — a hit is bit-identical to a miss — so a farm
//! worker's cold memo and the engine's warm one produce the same child. And
//! the engine refuses a result that is not the next one in job order
//! ([`crate::RefineOutcome::Stale`]), so which worker finished first cannot
//! reorder admissions. The serial path ([`crate::Engine::refine`]) runs these
//! same jobs through this same function, which is what the equivalence test
//! pins.
//!
//! [RFC-001]: ../../../docs/proposals/001-evolve-pool-parallel-walks.md
//! [ADR-007]: ../../../docs/decisions/007-generations-breed-in-parallel.md
//! [ADR-001]: ../../../docs/decisions/001-one-random-stream-per-consumer.md

use std::collections::HashSet;
use std::sync::Arc;

use auracle_features::{featurize_memo, CachedFeatures, PhraseSpec, RenderMemo};
use auracle_grammar::{PatchGrammarPrior, PatchTree};
use auracle_taste::{Standardizer, TastePosterior};
use fugue::Trace;
use fugue_evo::inference::likelihood::FactorFitness;
use fugue_evo::inference::mh::EvolutionChain;
use fugue_evo::inference::model::EvolutionModel;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde::{Deserialize, Serialize};

use crate::engine::{RefineKeep, RefineOutcome};
use crate::farm::draw_seed;
use crate::surrogate::SurrogateFitness;

/// Ceiling on the step-count compensation for locked sites — the most a locked
/// refinement walk may cost relative to an unlocked one.
///
/// 4× fully compensates a walk with three quarters of its sites pinned, which is
/// already a heavier lock than the hand-build → pin → breed loop produces. Past
/// that the walk is deliberately under-compensated, because `⚡ evolve from
/// this` is a button press with a person waiting behind it and a 90%-locked
/// patch would otherwise ask for ten times the budget. See the note at the use
/// site in [`walk_on`] for what that costs.
pub const LOCK_SCALE_CAP: f64 = 4.0;

/// The largest integer a JavaScript number holds exactly, `2⁵³ − 1`.
const JS_SAFE: u64 = (1 << 53) - 1;

/// Job `index`'s RNG seed within a generation whose base is `base`.
///
/// The farm's index function ([`draw_seed`], splitmix64), so neighbouring jobs
/// get unrelated streams, **masked to 53 bits**. A job crosses the wasm
/// boundary as JSON and the web worker may parse it: a full 64-bit seed would
/// come back from `JSON.parse` rounded to a double and silently name another
/// walk. 53 bits of seed is still far more walks than a session will run.
pub fn walk_seed(base: u64, index: u64) -> u64 {
    draw_seed(base, index) & JS_SAFE
}

/// What every walk of one generation reads, and nothing a walk may change.
///
/// Sent once per generation per farm worker: the posterior is the bulk of it
/// (every thinned draw of every lens), and `examples/walk_payload.rs`
/// measures how much. Serialized from this struct, in declaration order
/// ([ADR-002](../../../docs/decisions/002-trees-serialize-in-declaration-order.md)).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WalkContext {
    /// The grammar prior tilted toward the fitted taste, computed once when
    /// the generation opened (`Engine::biased_prior`).
    pub prior: PatchGrammarPrior,
    /// The posterior the surrogate averages over.
    pub posterior: Arc<TastePosterior>,
    /// The standardizer the posterior was fitted under.
    pub standardizer: Arc<Standardizer>,
    /// The audition stimulus every proposal is rendered on.
    pub phrase: PhraseSpec,
    /// Boltzmann sharpness β of the target.
    pub beta: f64,
    /// Which state of the walk becomes the child.
    pub refine_keep: RefineKeep,
    /// A sound of your own to breed toward, if this generation does
    /// ([`crate::Engine::refine_toward_jobs`]): every walk's target is then
    /// tilted toward it ([`crate::own::TowardFitness`]). `None` for every
    /// other generation, which walks exactly as before it existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toward: Option<crate::own::Toward>,
}

/// One walk: everything that differs between the walks of a generation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WalkJob {
    /// The generation this job belongs to. For `⚡ evolve from this`, the
    /// generation that was current when the job was made (informational: a
    /// ⚡ result is matched by its seed id, not by generation).
    pub generation: usize,
    /// Position in the generation's job order — the order results are
    /// absorbed in.
    pub index: usize,
    /// The pool id the walk starts from.
    pub parent_id: u64,
    /// That parent's term, as it stood when the job was made.
    pub seed: PatchTree,
    /// Trace addresses the walk may not touch (empty for a pool generation).
    pub locked: Vec<String>,
    /// The step budget before lock compensation.
    pub steps: usize,
    /// This walk's own RNG seed ([`walk_seed`]); 53 bits, JSON-safe.
    pub rng_seed: u64,
}

/// What one walk produced, addressed to the job it answers.
///
/// Carries the child's featurization when the walk had it (it always does:
/// the walk scored the state it ended on), so the engine admits the child
/// without rendering it again. The engine checks the features' content key
/// against the child before trusting them.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WalkResult {
    /// Echo of [`WalkJob::generation`].
    pub generation: usize,
    /// Echo of [`WalkJob::index`].
    pub index: usize,
    /// Echo of [`WalkJob::parent_id`].
    pub parent_id: u64,
    /// The walk's end state, when it differs from the seed.
    pub child: Option<PatchTree>,
    /// Why there is no child (`None` exactly when there is one).
    pub reason: Option<RefineOutcome>,
    /// The child's featurization, as the walk's memo held it.
    pub cached: Option<CachedFeatures>,
}

impl WalkResult {
    /// The walk's verdict: the child, or the reason there is none.
    pub fn walk(&self) -> Result<&PatchTree, RefineOutcome> {
        match &self.child {
            Some(tree) => Ok(tree),
            None => Err(self.reason.unwrap_or(RefineOutcome::NoMove)),
        }
    }
}

/// Run one walk: a pure function of the context and the job.
///
/// `memo` only saves renders (a hit is bit-identical to a miss), so the
/// result does not depend on it — the engine passes its own warm memo on the
/// serial path, a farm worker passes the one it keeps between jobs.
pub fn run_walk(ctx: &WalkContext, job: &WalkJob, memo: &RenderMemo) -> WalkResult {
    let fitness = SurrogateFitness {
        posterior: Arc::clone(&ctx.posterior),
        standardizer: Arc::clone(&ctx.standardizer),
        phrase: ctx.phrase.clone(),
        memo: memo.clone(),
    };
    let locked: HashSet<String> = job.locked.iter().cloned().collect();
    let mut rng = StdRng::seed_from_u64(job.rng_seed);
    let walk = match &ctx.toward {
        None => walk_on(
            ctx.prior.clone(),
            ctx.beta,
            ctx.refine_keep,
            fitness,
            &mut rng,
            &job.seed,
            &locked,
            job.steps,
        ),
        Some(toward) => walk_on(
            ctx.prior.clone(),
            ctx.beta,
            ctx.refine_keep,
            crate::own::TowardFitness {
                inner: fitness,
                toward: toward.clone(),
                standardizer: Arc::clone(&ctx.standardizer),
                phrase: ctx.phrase.clone(),
                memo: memo.clone(),
            },
            &mut rng,
            &job.seed,
            &locked,
            job.steps,
        ),
    };
    let (child, reason, cached) = match walk {
        Ok(tree) => {
            // A memo hit: the walk scored the state it ended on.
            let cached = featurize_memo(&tree, &ctx.phrase, memo, false)
                .ok()
                .map(|(c, _)| c);
            (Some(tree), None, cached)
        }
        Err(reason) => (None, Some(reason), None),
    };
    WalkResult {
        generation: job.generation,
        index: job.index,
        parent_id: job.parent_id,
        child,
        reason,
        cached,
    }
}

/// Did the step from `prev` to `next` touch any locked address? See
/// `Engine::violates_locks`, which is this function.
pub(crate) fn violates_locks(prev: &Trace, next: &Trace, locked: &HashSet<String>) -> bool {
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

/// The locked walk itself, over any scalar fitness, on the target
/// `π ∝ prior · exp(β·fitness)`. Returns the end state if it differs from the
/// seed, otherwise the reason it does not.
///
/// [`run_walk`] hands it the taste surrogate; the performance surfaces hand it
/// [`crate::perform::VetOnlyFitness`] when no taste has been fitted yet, which
/// makes the target `π ∝ p_grammar` restricted to vetted patches — exactly
/// what the posterior is before it has seen any evidence.
///
/// It is [`WalkRun`] run to the end: begun, stepped until nothing is left,
/// finished. A caller that must be able to stop between two steps (PERFORM's
/// offers, which the web worker cuts into pieces so a pick is answered
/// between them) holds the [`WalkRun`] and gets the same walk, step for step,
/// because this *is* that walk.
#[allow(clippy::too_many_arguments)]
pub(crate) fn walk_on<R, F>(
    prior: PatchGrammarPrior,
    beta: f64,
    keep: RefineKeep,
    fitness: F,
    rng: &mut R,
    seed: &PatchTree,
    locked: &HashSet<String>,
    steps: usize,
) -> Result<PatchTree, RefineOutcome>
where
    R: Rng,
    F: fugue_evo::fitness::traits::Fitness<Genome = PatchTree, Value = f64>
        + Clone
        + Send
        + Sync
        + 'static,
{
    let mut run = WalkRun::begin(prior, beta, keep, fitness, seed, locked, steps)?;
    while run.left() > 0 {
        run.step(rng);
    }
    run.finish()
}

/// A locked walk ([`walk_on`]) in the middle: everything it carries from one
/// step to the next, so it can be paused after any step and go on, however
/// much else happens meanwhile. It holds no borrow of the engine and draws
/// from whatever generator each [`Self::step`] is handed, so the walk it makes
/// is a function of its construction and of the draws it is given, and of
/// nothing about when the steps were taken.
pub(crate) struct WalkRun<F>
where
    F: fugue_evo::fitness::traits::Fitness<Genome = PatchTree, Value = f64>
        + Clone
        + Send
        + Sync
        + 'static,
{
    chain: EvolutionChain<PatchGrammarPrior, FactorFitness<WithTakes<F>>>,
    trace: Trace,
    current: PatchTree,
    best: Option<(f64, PatchTree)>,
    locked: HashSet<String>,
    seed: PatchTree,
    carries: bool,
    left: usize,
}

impl<F> WalkRun<F>
where
    F: fugue_evo::fitness::traits::Fitness<Genome = PatchTree, Value = f64>
        + Clone
        + Send
        + Sync
        + 'static,
{
    /// Set a walk up at `seed`, with its step budget scaled for the locked
    /// sites. [`RefineOutcome::OutsideSupport`] when the prior gives `seed`
    /// no mass: the walk never starts.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn begin(
        prior: PatchGrammarPrior,
        beta: f64,
        keep: RefineKeep,
        fitness: F,
        seed: &PatchTree,
        locked: &HashSet<String>,
        steps: usize,
    ) -> Result<Self, RefineOutcome> {
        // The input a node reads belongs to the player (ADR-015), so every AUDIO
        // IN the seed holds keeps its input and its place: its `#input` is locked
        // exactly as a player's lock is. The kernel proposes on it like any other
        // site (and, the prior's `PlayerInput` being what it is, would propose
        // slot 0 and accept it), and the lock rejects that, and a removal of the
        // node, outside the kernel. A node the walk grows reads slot 0. The lock
        // compensation below counts these sites, since proposals on them are
        // wasted like proposals on any lock.
        //
        // TRACK and CAPTURE are the player's too, so their `#op` is held the same
        // way (`PatchTree::player_sites`): the prior never draws either, so a step
        // that regrew one away could never grow it back, and a capture's take
        // would go with it. Their knobs, and everything around them, stay free.
        let held = seed.player_sites();
        let with_held: HashSet<String>;
        let locked = if held.is_empty() {
            locked
        } else {
            with_held = locked.iter().cloned().chain(held).collect();
            &with_held
        };
        // A take is not a trace site, so every term the kernel decodes comes back
        // with empty captures. The fitness hears each one with the seed's takes
        // carried back (a walk holds every capture where it was, so the match is
        // exact), and so does the term the walk returns, below.
        let carries = seed.has_takes();
        let fitness = WithTakes {
            inner: fitness,
            seed: carries.then(|| Arc::new(seed.clone())),
        };
        let model = EvolutionModel::new(prior, fitness).with_beta(beta);
        let chain = EvolutionChain::new(model);
        // `init_from` is `None` exactly when the seed's total log-weight is not
        // finite. The surrogate fitness is finite by construction (a
        // quarantined render scores `QUARANTINE_FITNESS`, not `−∞`), so the
        // only way to get here is a seed the grammar prior gives zero mass —
        // which is a fact about the patch, and the caller needs to hear it as
        // one rather than as a walk that happened not to move.
        let Some(trace) = chain.init_from(seed) else {
            return Err(RefineOutcome::OutsideSupport);
        };

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

        let current = seed.clone();
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
        let best: Option<(f64, PatchTree)> = match keep {
            RefineKeep::Last => None,
            RefineKeep::Best => Some((trace.total_log_weight(), seed.clone())),
        };
        Ok(Self {
            chain,
            trace,
            current,
            best,
            locked: locked.clone(),
            seed: seed.clone(),
            carries,
            left: steps,
        })
    }

    /// Steps not yet taken.
    pub(crate) fn left(&self) -> usize {
        self.left
    }

    /// One transition of the chain, if any step is left.
    pub(crate) fn step<R: Rng + ?Sized>(&mut self, rng: &mut R) {
        if self.left == 0 {
            return;
        }
        self.left -= 1;
        let mut by_ref = rng;
        let (g, t) = self.chain.step(&mut by_ref, &self.trace);
        if violates_locks(&self.trace, &t, &self.locked) {
            return; // reject outside the kernel; stay at `trace`
        }
        if let Some((best_w, best_tree)) = &mut self.best {
            let w = t.total_log_weight();
            if w > *best_w {
                *best_w = w;
                *best_tree = g.clone();
            }
        }
        self.current = g;
        self.trace = t;
    }

    /// The walk's verdict: its end state if that differs from the seed,
    /// otherwise the reason it does not. Meant for a walk with no steps left;
    /// finishing sooner returns the best of the steps taken so far.
    pub(crate) fn finish(self) -> Result<PatchTree, RefineOutcome> {
        let Self {
            mut current,
            best,
            seed,
            carries,
            ..
        } = self;
        if let Some((_, best_tree)) = best {
            current = best_tree;
        }
        // Before the fixed-point test: a decoded term without its takes would
        // never equal a seed that has them, and a walk that moved nothing would
        // come back as a change.
        if carries {
            current.inherit_takes(&seed);
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
        current.clamp_domains();
        if current == seed {
            Err(RefineOutcome::NoMove)
        } else {
            Ok(current)
        }
    }
}

/// A walk's fitness, hearing every term with the seed's CAPTURE takes carried
/// back onto it ([`PatchTree::inherit_takes`]). `seed` is `None` when the
/// seed holds no take, and then this is the inner fitness exactly.
#[derive(Clone)]
struct WithTakes<F> {
    inner: F,
    seed: Option<Arc<PatchTree>>,
}

impl<F> fugue_evo::fitness::traits::Fitness for WithTakes<F>
where
    F: fugue_evo::fitness::traits::Fitness<Genome = PatchTree, Value = f64>,
{
    type Genome = PatchTree;
    type Value = f64;

    fn evaluate(&self, genome: &PatchTree) -> f64 {
        match &self.seed {
            None => self.inner.evaluate(genome),
            Some(seed) => {
                let mut heard = genome.clone();
                heard.inherit_takes(seed);
                self.inner.evaluate(&heard)
            }
        }
    }
}

#[cfg(test)]
mod tests;
