//! PERFORM's walks as jobs that can be paused: an offer, an aimed offer and a
//! drift, each a walk the caller advances a few steps at a time.
//!
//! A step of these walks is one proposal, so at most one phrase render, and a
//! render is the unit the web worker can be interrupted at. (Starting the next
//! walk of an aimed offer scores where the last one ended, which the memo
//! holds, so the pause between walks costs a lookup, not a render.) An offer is
//! twenty steps, or up to eighty with locks, or up to three such walks when it
//! is aimed, and
//! as one call it kept the worker deaf to the player for the whole of it
//! (`docs/architecture/web-runtime.md`). As a [`PerformJob`] the worker
//! advances it one step per turn and answers the player between steps, the way
//! it renders a measurement one tree at a time.
//!
//! ## Why cutting a walk up cannot change it
//!
//! A [`PerformJob`] holds everything the walk carries (the chain and its
//! adaptation, the trace, the best state so far, the budget left, the fitness
//! it was built with) and nothing borrowed from the engine, and [`step`]
//! draws from the generator it is handed. [`Engine::offer`], [`Engine::offer_aimed`]
//! and [`Engine::drift`] are this job run to the end, so the pause
//! points are the only difference between them and a stepped job, and the
//! chunking test pins that for several chunk sizes (`a_stepped_walk_is_the_walk`).
//!
//! What the job reads of the engine it reads **when it is made**: the tilted
//! prior, the posterior and standardizer (shared, not copied), β and the keep
//! rule. Something the player does meanwhile (a pick recorded between two
//! steps, a refit, an import) leaves the walk on the target it began on, which
//! is what it would have had if that had waited for the end. The render memo is
//! the exception in form only: it is a shared, bounded cache, so it keeps
//! changing under the job, but it only saves renders (a hit is bit-identical to
//! a miss), so it is not part of the target. For an aimed offer, how far it
//! `moved` is measured under the standardizer it began with too
//! ([`PerformJob::finish_moved`]).
//!
//! [`step`]: PerformJob::step
//! [`Engine::offer`]: crate::Engine::offer
//! [`Engine::offer_aimed`]: crate::Engine::offer_aimed
//! [`Engine::drift`]: crate::Engine::drift

use std::collections::HashSet;

use auracle_grammar::{PatchGrammarPrior, PatchTree};
use fugue_evo::inference::likelihood::FactorFitness;
use fugue_evo::inference::model::EvolutionModel;
use rand::{Rng, RngCore};

use crate::engine::RefineOutcome;
use crate::perform::{TiltedFitness, REACH_FLOOR};
use crate::walk::WalkRun;

/// A walk the job can start from any tree: how a fresh walk is set up on the
/// target the job was made with (the same prior, fitness, locks and budget).
type Start = Box<dyn Fn(&PatchTree) -> Result<Box<dyn Stepper>, RefineOutcome> + Send + Sync>;

/// How to start a locked walk of `steps` on the target `prior`, `beta`,
/// `keep` and `fitness` make, from any tree ([`WalkRun::begin`]).
pub(crate) fn starter<F>(
    prior: PatchGrammarPrior,
    beta: f64,
    keep: crate::engine::RefineKeep,
    fitness: F,
    locked: HashSet<String>,
    steps: usize,
) -> Start
where
    F: fugue_evo::fitness::traits::Fitness<Genome = PatchTree, Value = f64>
        + Clone
        + Send
        + Sync
        + 'static,
{
    Box::new(move |from| {
        WalkRun::begin(
            prior.clone(),
            beta,
            keep,
            fitness.clone(),
            from,
            &locked,
            steps,
        )
        .map(|w| Box::new(w) as Box<dyn Stepper>)
    })
}

/// How to start a knob-only drift of `steps` proposals of size `sigma` over
/// the `free` knobs, on the target `prior`, `beta` and `fitness` make.
pub(crate) fn drifter<F>(
    prior: PatchGrammarPrior,
    beta: f64,
    fitness: F,
    free: Vec<String>,
    steps: usize,
    sigma: f64,
) -> Start
where
    F: fugue_evo::fitness::traits::Fitness<Genome = PatchTree, Value = f64>
        + Clone
        + Send
        + Sync
        + 'static,
{
    let model = EvolutionModel::new(prior, fitness).with_beta(beta);
    Box::new(move |from| {
        let w = model.score(from).1.total_log_weight();
        if !w.is_finite() {
            return Err(RefineOutcome::OutsideSupport);
        }
        Ok(Box::new(DriftRun {
            model: model.clone(),
            seed: from.clone(),
            cur: from.clone(),
            w,
            free: free.clone(),
            sigma,
            left: steps,
        }) as Box<dyn Stepper>)
    })
}

/// One walk, with its fitness erased.
pub(crate) trait Stepper: Send + Sync {
    fn left(&self) -> usize;
    fn step(&mut self, rng: &mut dyn RngCore);
    fn finish(self: Box<Self>) -> Result<PatchTree, RefineOutcome>;
}

impl<F> Stepper for WalkRun<F>
where
    F: fugue_evo::fitness::traits::Fitness<Genome = PatchTree, Value = f64>
        + Clone
        + Send
        + Sync
        + 'static,
{
    fn left(&self) -> usize {
        WalkRun::left(self)
    }
    fn step(&mut self, rng: &mut dyn RngCore) {
        WalkRun::step(self, rng)
    }
    fn finish(self: Box<Self>) -> Result<PatchTree, RefineOutcome> {
        WalkRun::finish(*self)
    }
}

/// How a search control's offer is aimed: the tilt, where the home patch
/// stands along it, and how many walks it may take to go the asked way.
struct Aim {
    tilt: TiltedFitness<()>,
    home: Option<f64>,
    walks: usize,
}

/// A walk of PERFORM's (an offer, an aimed offer or a drift) that can be
/// advanced a few steps at a time. See the module's notes.
pub struct PerformJob {
    start: Start,
    home: PatchTree,
    aim: Option<Aim>,
    /// The walk running now.
    cur: Option<Box<dyn Stepper>>,
    /// Walks started, an aimed offer's first and any it continued with.
    walked: usize,
    /// An aimed offer's best end state so far ([`RefineOutcome::NoMove`]
    /// until a walk moves).
    grown: Result<PatchTree, RefineOutcome>,
    out: Option<Result<PatchTree, RefineOutcome>>,
}

impl PerformJob {
    /// A job of one walk from `home`.
    pub(crate) fn single(home: PatchTree, start: Start) -> Result<Self, RefineOutcome> {
        Self::make(home, start, None)
    }

    /// A job of up to `walks` walks from `home` on a tilted target, which
    /// keeps walking from where the last stopped until it has moved the way
    /// `tilt` asks by [`REACH_FLOOR`] ([`crate::Engine::offer_aimed`]).
    pub(crate) fn aimed(
        home: PatchTree,
        start: Start,
        tilt: TiltedFitness<()>,
        walks: usize,
    ) -> Result<Self, RefineOutcome> {
        let at = tilt.along(&home);
        Self::make(
            home,
            start,
            Some(Aim {
                tilt,
                home: at,
                walks: walks.max(1),
            }),
        )
    }

    fn make(home: PatchTree, start: Start, aim: Option<Aim>) -> Result<Self, RefineOutcome> {
        let mut job = PerformJob {
            start,
            home,
            aim,
            cur: None,
            walked: 0,
            grown: Err(RefineOutcome::NoMove),
            out: None,
        };
        job.launch();
        match job.out.take() {
            // A patch the prior gives no mass cannot be walked from at all.
            Some(Err(why)) => Err(why),
            out => {
                job.out = out;
                Ok(job)
            }
        }
    }

    /// Start the next walk, from where the last ended (or from `home`).
    fn launch(&mut self) {
        let from = self.grown.as_ref().unwrap_or(&self.home).clone();
        self.walked += 1;
        match (self.start)(&from) {
            Ok(w) => self.cur = Some(w),
            Err(why) => self.settle(Err(why)),
        }
    }

    /// A walk ended (or could not begin): the job's verdict, or the next walk.
    fn settle(&mut self, walk: Result<PatchTree, RefineOutcome>) {
        let Some(aim) = &self.aim else {
            self.out = Some(walk);
            return;
        };
        match walk {
            Ok(t) => self.grown = Ok(t),
            // A patch the prior gives no mass cannot be walked from at all;
            // nothing further will change that.
            Err(RefineOutcome::OutsideSupport) if self.grown.is_err() => {
                self.out = Some(Err(RefineOutcome::OutsideSupport));
                return;
            }
            Err(_) => {}
        }
        let went = match (&self.grown, aim.home) {
            (Ok(t), Some(h)) => aim.tilt.along(t).map(|a| aim.tilt.sign * (a - h)),
            _ => None,
        };
        if went.is_some_and(|m| m >= REACH_FLOOR) || self.walked >= aim.walks {
            self.out = Some(self.grown.clone());
        } else {
            self.launch();
        }
    }

    /// Advance up to `n` steps (a step is one proposal: at most one render). True while
    /// there is more to do. Between two calls the job may sit for as long as
    /// anyone likes; what the steps draw is the only thing they share with
    /// the rest of the world.
    pub fn step(&mut self, rng: &mut dyn RngCore, mut n: usize) -> bool {
        // A job without a verdict is walking, and one with a verdict is not:
        // `settle` either gives the verdict or launches the next walk.
        while n > 0 {
            let Some(w) = self.cur.as_mut() else {
                break;
            };
            if w.left() > 0 {
                w.step(rng);
                n -= 1;
            }
            if self.cur.as_ref().is_some_and(|w| w.left() == 0) {
                if let Some(w) = self.cur.take() {
                    self.settle(w.finish());
                }
            }
        }
        self.out.is_none()
    }

    /// True once the job has its verdict.
    pub fn is_done(&self) -> bool {
        self.out.is_some()
    }

    /// Steps left in the walk running now. An aimed offer that has not yet
    /// gone the asked way may begin another walk when this one ends, so this
    /// is a floor on what is left, not the total.
    pub fn left(&self) -> usize {
        self.cur.as_ref().map_or(0, |w| w.left())
    }

    /// Walks started so far: 1 for an offer or a drift, up to
    /// [`crate::perform::AIM_WALKS`] for an aimed one.
    pub fn walks(&self) -> usize {
        self.walked
    }

    /// Run to the end on `rng`, as [`crate::Engine::offer`] does.
    pub fn run(mut self, rng: &mut dyn RngCore) -> Result<PatchTree, RefineOutcome> {
        while self.step(rng, usize::MAX) {}
        self.finish()
    }

    /// [`Self::finish`], and for an aimed offer how far it went along the
    /// control's direction, in σ, positive toward the control's high word: the
    /// same number as [`crate::Engine::moved_along`], but under the standardizer
    /// the job began with, so an import or a refit between steps cannot change
    /// it. `None` for an offer or drift that was not aimed, for a walk that did
    /// not move, and when either end does not vet.
    pub fn finish_moved(self) -> (Result<PatchTree, RefineOutcome>, Option<f64>) {
        let moved = match (&self.out, &self.aim) {
            (Some(Ok(t)), Some(aim)) => match (aim.home, aim.tilt.along(t)) {
                (Some(h), Some(a)) => Some(a - h),
                _ => None,
            },
            _ => None,
        };
        (self.finish(), moved)
    }

    /// The verdict: the end state if it differs from where the walk began,
    /// else the reason it does not. A job stopped before its end gives
    /// [`RefineOutcome::NoMove`] (use [`Self::run`], or step until done).
    pub fn finish(self) -> Result<PatchTree, RefineOutcome> {
        self.out.unwrap_or(Err(RefineOutcome::NoMove))
    }
}

/// A knob-only drift in the middle: [`crate::Engine::drift`]'s local
/// Metropolis walk, one proposal per step.
struct DriftRun<F>
where
    F: fugue_evo::fitness::traits::Fitness<Genome = PatchTree, Value = f64>
        + Clone
        + Send
        + Sync
        + 'static,
{
    model: EvolutionModel<PatchGrammarPrior, FactorFitness<F>>,
    seed: PatchTree,
    cur: PatchTree,
    w: f64,
    free: Vec<String>,
    sigma: f64,
    left: usize,
}

impl<F> DriftRun<F>
where
    F: fugue_evo::fitness::traits::Fitness<Genome = PatchTree, Value = f64>
        + Clone
        + Send
        + Sync
        + 'static,
{
    /// One proposal: a free knob, moved by `σ·N(0, 1)` and reflected into
    /// its range. `None` if the knob cannot be read or written, a case folded
    /// into the expression (`?`, `.ok()`) rather than given a branch: no
    /// drift reaches it today, since its free knobs are the tree's live knobs
    /// and a drift turns knobs only.
    fn propose(&self, rng: &mut dyn RngCore) -> Option<PatchTree> {
        let mut rng = rng;
        let rng = &mut rng;
        let addr = &self.free[auracle_grammar::rng::gen_index(rng, self.free.len())];
        let v = crate::perform::continuous_knobs(&self.cur)
            .into_iter()
            .find_map(|(a, v)| (a == *addr).then_some(v))?;
        // Box–Muller: one standard normal from two uniforms.
        let (u1, u2): (f64, f64) = (rng.gen::<f64>().max(1e-300), rng.gen());
        let z = (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos();
        let mut nv = v + self.sigma * z;
        // Reflect into [0, PARAM_MAX]: symmetric, so no Hastings term.
        let top = auracle_grammar::PARAM_MAX;
        for _ in 0..4 {
            if nv < 0.0 {
                nv = -nv;
            } else if nv > top {
                nv = 2.0 * top - nv;
            } else {
                break;
            }
        }
        let nv = auracle_grammar::clamp_param(nv);
        auracle_grammar::set_param(&self.cur, addr, auracle_grammar::ParamValue::Continuous(nv))
            .ok()
    }
}

impl<F> Stepper for DriftRun<F>
where
    F: fugue_evo::fitness::traits::Fitness<Genome = PatchTree, Value = f64>
        + Clone
        + Send
        + Sync
        + 'static,
{
    fn left(&self) -> usize {
        self.left
    }

    fn step(&mut self, rng: &mut dyn RngCore) {
        if self.left == 0 {
            return;
        }
        self.left -= 1;
        let mut rng = rng;
        let rng = &mut rng;
        // Metropolis on the target's weight; a proposal that cannot be made
        // (see `propose`) is no move, like one refused.
        let scored = self.propose(rng).map(|cand| {
            let nw = self.model.score(&cand).1.total_log_weight();
            (cand, nw)
        });
        let w = self.w;
        if let Some((cand, nw)) =
            scored.filter(|(_, nw)| nw.is_finite() && (*nw >= w || rng.gen::<f64>().ln() < nw - w))
        {
            self.cur = cand;
            self.w = nw;
        }
    }

    fn finish(self: Box<Self>) -> Result<PatchTree, RefineOutcome> {
        let Self { mut cur, seed, .. } = *self;
        cur.clamp_domains();
        if cur == seed {
            Err(RefineOutcome::NoMove)
        } else {
            Ok(cur)
        }
    }
}

#[cfg(test)]
mod tests;
