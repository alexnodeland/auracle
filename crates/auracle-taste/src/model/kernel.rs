//! The fit's MH kernel: fugue-ppl 0.2.3's adaptive single-site chain
//! (`adaptive_mcmc_chain_with_overrides_thinned`, no overrides), run over an
//! array of the sites' values instead of a rebuilt program.
//!
//! Every step here is fugue's step, drawn from the stream in fugue's order,
//! so a seed deals the same draws as fugue's driver, bit for bit:
//!
//! 1. the site, `gen_range(0..n as u64)` over the sites in the trace's
//!    (`BTreeMap`) order (fugue's `gen_index`);
//! 2. its scale from fugue's own `DiminishingAdaptation(0.44, 0.7)`;
//! 3. the proposal `x + scale·z`, `z` by fugue's Box–Muller (`gaussian_z`):
//!    every site's prior is a `Normal`, whose support is the real line, so
//!    fugue's proposal is its Gaussian walk;
//! 4. the proposal's log-weight, the trace's: the log-prior summed from 0 in
//!    execution order, plus the factor with a NaN read as −∞;
//! 5. fugue's accept test (`mh_accept`), and in warmup only the adaptation's
//!    update.
//!
//! fugue's log-ratio also carries `(log q_rev − log q_fwd) + dim_term`. For
//! this program both are exactly +0.0: a Gaussian walk's proposal densities
//! are 0.0 each way, and a fixed structure makes `dim_term` `ln n − ln n`.
//! Adding +0.0 changes a number only from −0.0 to +0.0, which the test
//! (`log_alpha >= 0.0`, then `exp`) cannot tell apart, so they are left out.
//! fugue's trace also adds a zero log-likelihood and starts the factor sum
//! at zero: the same +0.0, and the same reasoning.
//!
//! # A step recomputes only what its site reaches
//!
//! The likelihood is a sum over rows, and each row reads its candidates'
//! lens utilities `θ_k · φ`. The chain keeps, for the current state, every
//! candidate's utility under every lens and every row's weighted term
//! ([`Scored`]), and a proposal recomputes only what its site moves
//! ([`Reach`]): a θ_k coordinate moves lens k's utility of every candidate,
//! and so every row; a τ_s moves session s's keep/kill rows; a cut raw
//! moves every later cut, and so every star row; a μ moves only the prior.
//! Each recomputed number comes from the code `Evidence::loglik` runs (the
//! same `dot`, the same `Evidence::term`), and the total is the terms summed
//! in row order as it sums them. The prior is kept the same way: each
//! site's term, a move recomputing its own (and a μ's, those of the θ drawn
//! about it), all of them summed from 0 in execution order as the trace sums
//! them. So the proposal's log-weight is the number the whole program would
//! give, bit for bit (a running total updated by differences would not be).

use fugue::core::numerical::nan_to_neg_inf;
use fugue::runtime::handler::run;
use fugue::runtime::interpreters::PriorHandler;
use fugue::{Address, DiminishingAdaptation, Trace};
use rand::{Rng, RngCore};
use std::collections::HashMap;
use std::sync::Arc;

use super::{dot, prior_total, Evidence, Layout, SiteAddrs, SitePrior, TasteModel, TasteSample};
use crate::observe::{Feedback, FitSet};

/// Run the chain: `n_warmup` adapting steps, then `n_samples` with the
/// scales frozen, keeping the state after sampling steps `0, stride,
/// 2·stride, …`.
pub(super) fn chain<R: Rng>(
    model: &TasteModel,
    rng: &mut R,
    data: &FitSet,
    n_samples: usize,
    n_warmup: usize,
    stride: usize,
) -> Vec<TasteSample> {
    let addrs = Arc::new(SiteAddrs::new(&model.cfg, data.n_sessions().max(1)));
    let layout = Arc::new(Layout::new(&model.cfg, &addrs));
    let evidence = Arc::new(Evidence::new(&model.cfg, data));
    // The start is the program's own prior run, which draws the stream as
    // fugue's driver does.
    let (_, start) = run(
        PriorHandler {
            rng: &mut *rng,
            trace: Trace::default(),
        },
        model.model_at(&evidence, &addrs, &layout),
    );
    let mut chain = Chain::new(&layout, &evidence, &addrs, &start);
    let mut kept = Vec::with_capacity(n_samples.div_ceil(stride));
    for _ in 0..n_warmup {
        chain.step(rng, true);
    }
    for i in 0..n_samples {
        chain.step(rng, false);
        if i % stride == 0 {
            kept.push(chain.cur_s.clone());
        }
    }
    kept
}

/// The chain's state: the current values, their draw, likelihood and
/// log-weight, and a proposal's buffers, which equal the current ones
/// between steps.
struct Chain<'a> {
    layout: &'a Layout,
    evidence: &'a Evidence,
    /// Which rows and candidates each site reaches.
    rows: Rows<'a>,
    /// Each site's address (adaptation is keyed by it) and its slot in the
    /// values, in the trace's order: the order fugue picks a site from.
    sites: Vec<(Address, usize)>,
    adaptation: DiminishingAdaptation,
    cur: Vec<f64>,
    cur_s: TasteSample,
    cur_scored: Scored,
    cur_lw: f64,
    prop: Vec<f64>,
    prop_s: TasteSample,
    prop_scored: Scored,
}

/// A state's log-weight in its parts.
#[derive(Clone, Debug)]
struct Scored {
    /// Every site's log-prior, in execution order (`Layout::prior_term`).
    prior: Vec<f64>,
    /// The prior's terms summed (`prior_total`).
    lp: f64,
    /// Every candidate's utility under every lens, `[c·K + k]`, candidates
    /// in row order (a duel's `a` then `b`).
    dots: Vec<f64>,
    /// Every row's weighted log-likelihood (`Evidence::term`).
    terms: Vec<f64>,
    /// The terms summed, as `Evidence::loglik` sums them.
    ll: f64,
}

/// The evidence's rows as the kernel walks them, built once per chain.
struct Rows<'a> {
    /// K.
    k: usize,
    /// Each candidate's φ, in row order.
    phis: Vec<&'a [f64]>,
    /// Row `r`'s candidates are `cands[r]..cands[r + 1]`.
    cands: Vec<usize>,
    /// Each session's keep/kill rows.
    keeps: Vec<Vec<usize>>,
    /// The star rows.
    stars: Vec<usize>,
    /// For each μ (by its slot), the slots of the θ drawn about it.
    about: Vec<Vec<usize>>,
}

/// What moving one site changes of the likelihood.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Reach {
    /// A μ: nothing; it enters only the prior of the θ about it.
    Nothing,
    /// A coordinate of lens k: that lens's utility of every candidate, and
    /// so every row.
    Lens(usize),
    /// Session s's τ: its keep/kill rows.
    Session(usize),
    /// A cut raw: every star row (the cuts decode cumulatively).
    Cuts,
}

impl Layout {
    /// What moving the site at `slot` reaches.
    fn reach(&self, slot: usize) -> Reach {
        if slot < self.theta_at {
            Reach::Nothing
        } else if slot < self.tau_at {
            Reach::Lens((slot - self.theta_at) / self.n_features)
        } else if slot < self.cut_at {
            Reach::Session(slot - self.tau_at)
        } else {
            Reach::Cuts
        }
    }
}

impl<'a> Rows<'a> {
    fn new(layout: &Layout, evidence: &'a Evidence) -> Self {
        let mut rows = Self {
            k: layout.k_styles,
            phis: Vec::new(),
            cands: vec![0],
            keeps: vec![Vec::new(); layout.cut_at - layout.tau_at],
            stars: Vec::new(),
            about: vec![Vec::new(); layout.theta_at],
        };
        for (slot, prior) in layout.priors.iter().enumerate() {
            if let SitePrior::About { mu, .. } = prior {
                rows.about[*mu].push(slot);
            }
        }
        for (r, (o, session)) in evidence.rows.iter().enumerate() {
            match o {
                Feedback::Duel { a, b, .. } => rows.phis.extend([&a[..], &b[..]]),
                Feedback::KeepKill { x, .. } => {
                    rows.phis.push(x);
                    rows.keeps[*session].push(r);
                }
                Feedback::Stars { x, .. } => {
                    rows.phis.push(x);
                    rows.stars.push(r);
                }
            }
            rows.cands.push(rows.phis.len());
        }
        rows
    }

    /// Score a state, its values `vals` and its draw `s`, from nothing.
    fn score(&self, layout: &Layout, evidence: &Evidence, vals: &[f64], s: &TasteSample) -> Scored {
        let prior: Vec<f64> = (0..vals.len())
            .map(|slot| layout.prior_term(slot, vals))
            .collect();
        let mut scored = Scored {
            lp: prior_total(prior.iter().copied()),
            prior,
            dots: self
                .phis
                .iter()
                .flat_map(|phi| s.theta.iter().map(move |t| dot(t, phi)))
                .collect(),
            terms: vec![0.0; self.cands.len() - 1],
            ll: 0.0,
        };
        for r in 0..scored.terms.len() {
            scored.terms[r] = self.term(evidence, s, &scored.dots, r);
        }
        scored.ll = scored.terms.iter().sum();
        scored
    }

    /// Row `r`'s term under `s`, from the utilities in `dots`.
    fn term(&self, evidence: &Evidence, s: &TasteSample, dots: &[f64], r: usize) -> f64 {
        let (c, end) = (self.cands[r], self.cands[r + 1]);
        let first = &dots[c * self.k..(c + 1) * self.k];
        let second = &dots[(c + 1) * self.k..end * self.k];
        evidence.term(r, s, first.iter().copied(), second.iter().copied())
    }

    /// Rescore `scored`, a score of the state before the site at `slot`
    /// moved, for the state after it (its values `vals` and its draw `s`):
    /// only the site's prior (and, for a μ, the prior of each θ drawn about
    /// it), and the likelihood's parts the site reaches.
    fn rescore(
        &self,
        layout: &Layout,
        evidence: &Evidence,
        vals: &[f64],
        s: &TasteSample,
        slot: usize,
        scored: &mut Scored,
    ) {
        scored.prior[slot] = layout.prior_term(slot, vals);
        for &theta in self.about.get(slot).map_or(&[][..], Vec::as_slice) {
            scored.prior[theta] = layout.prior_term(theta, vals);
        }
        scored.lp = prior_total(scored.prior.iter().copied());
        let rows: &[usize] = match layout.reach(slot) {
            Reach::Nothing => return,
            Reach::Lens(k) => {
                for (c, phi) in self.phis.iter().enumerate() {
                    scored.dots[c * self.k + k] = dot(&s.theta[k], phi);
                }
                for r in 0..scored.terms.len() {
                    scored.terms[r] = self.term(evidence, s, &scored.dots, r);
                }
                scored.ll = scored.terms.iter().sum();
                return;
            }
            Reach::Session(session) => &self.keeps[session],
            Reach::Cuts => &self.stars,
        };
        for &r in rows {
            scored.terms[r] = self.term(evidence, s, &scored.dots, r);
        }
        scored.ll = scored.terms.iter().sum();
    }

    /// Make `to` equal `from` again after the site at `slot` moved.
    fn sync(&self, layout: &Layout, slot: usize, from: &Scored, to: &mut Scored) {
        to.prior[slot] = from.prior[slot];
        for &theta in self.about.get(slot).map_or(&[][..], Vec::as_slice) {
            to.prior[theta] = from.prior[theta];
        }
        to.lp = from.lp;
        let rows: &[usize] = match layout.reach(slot) {
            Reach::Nothing => return,
            Reach::Lens(k) => {
                for c in 0..self.phis.len() {
                    to.dots[c * self.k + k] = from.dots[c * self.k + k];
                }
                to.terms.copy_from_slice(&from.terms);
                to.ll = from.ll;
                return;
            }
            Reach::Session(session) => &self.keeps[session],
            Reach::Cuts => &self.stars,
        };
        for &r in rows {
            to.terms[r] = from.terms[r];
        }
        to.ll = from.ll;
    }
}

impl<'a> Chain<'a> {
    fn new(layout: &'a Layout, evidence: &'a Evidence, addrs: &SiteAddrs, start: &Trace) -> Self {
        let slot_of: HashMap<&Address, usize> = addrs
            .in_program_order()
            .enumerate()
            .map(|(slot, a)| (a, slot))
            .collect();
        let mut cur = vec![0.0; slot_of.len()];
        let sites = start
            .choices
            .iter()
            .map(|(a, choice)| {
                let slot = slot_of[a];
                cur[slot] = choice.value.as_f64().expect("every site is an f64");
                (a.clone(), slot)
            })
            .collect();
        Self::at(layout, evidence, sites, cur)
    }

    /// A chain over `sites` (each site's address and slot, in the trace's
    /// order) that starts at the values `cur`.
    fn at(
        layout: &'a Layout,
        evidence: &'a Evidence,
        sites: Vec<(Address, usize)>,
        cur: Vec<f64>,
    ) -> Self {
        let mut cur_s = TasteSample {
            theta: Vec::new(),
            tau: Vec::new(),
            cuts: Vec::new(),
        };
        layout.decode_into(&cur, &mut cur_s);
        let rows = Rows::new(layout, evidence);
        let cur_scored = rows.score(layout, evidence, &cur, &cur_s);
        let cur_lw = log_weight(&cur_scored);
        Self {
            layout,
            evidence,
            rows,
            sites,
            adaptation: DiminishingAdaptation::new(0.44, 0.7),
            prop: cur.clone(),
            prop_s: cur_s.clone(),
            prop_scored: cur_scored.clone(),
            cur,
            cur_s,
            cur_scored,
            cur_lw,
        }
    }

    /// One transition, fugue's `single_site_mh_step`. There is always a site
    /// to move: every program has at least one τ.
    fn step<R: Rng>(&mut self, rng: &mut R, adapt: bool) {
        let site = gen_index(rng, self.sites.len());
        let slot = self.sites[site].1;
        let scale = self.adaptation.get_scale(&self.sites[site].0);
        let x = self.cur[slot];
        let prop_lw = self.propose(slot, x + scale * gaussian_z(rng));
        let accept = mh_accept(rng, prop_lw - self.cur_lw, self.cur_lw, prop_lw);
        if adapt {
            self.adaptation.update(&self.sites[site].0, accept);
        }
        self.settle(slot, accept, prop_lw);
    }

    /// Move the proposal's site at `slot` to `value` and score it: its
    /// log-weight. Recomputes only the likelihood's parts the site reaches.
    fn propose(&mut self, slot: usize, value: f64) -> f64 {
        self.prop[slot] = value;
        self.layout.decode_into(&self.prop, &mut self.prop_s);
        self.rows.rescore(
            self.layout,
            self.evidence,
            &self.prop,
            &self.prop_s,
            slot,
            &mut self.prop_scored,
        );
        log_weight(&self.prop_scored)
    }

    /// Take the proposal at `slot` (log-weight `prop_lw`) or leave it, and
    /// bring the proposal's buffers back to the current state's.
    fn settle(&mut self, slot: usize, accept: bool, prop_lw: f64) {
        if accept {
            self.cur[slot] = self.prop[slot];
            std::mem::swap(&mut self.cur_s, &mut self.prop_s);
            std::mem::swap(&mut self.cur_scored, &mut self.prop_scored);
            self.cur_lw = prop_lw;
        } else {
            self.prop[slot] = self.cur[slot];
        }
        self.rows
            .sync(self.layout, slot, &self.cur_scored, &mut self.prop_scored);
    }
}

/// A state's log-weight as the program's trace totals it: the log-prior in
/// execution order, plus the factor, a NaN read as −∞ (module doc).
fn log_weight(scored: &Scored) -> f64 {
    scored.lp + nan_to_neg_inf(scored.ll)
}

/// fugue's `gen_index` (`pub(crate)` there): an index drawn over `u64`, so
/// it reads the stream the same on every target.
fn gen_index<R: Rng>(rng: &mut R, n: usize) -> usize {
    rng.gen_range(0u64..n as u64) as usize
}

/// fugue's `gaussian_z` (private there): a standard normal by Box–Muller.
fn gaussian_z<R: RngCore>(rng: &mut R) -> f64 {
    let u1: f64 = rng.gen::<f64>().max(1e-10); // avoid ln(0)
    let u2: f64 = rng.gen();
    (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
}

/// fugue's `mh_accept` (`pub(crate)` there): from a state of no mass, move
/// to any proposal with a finite log-weight; else `min(1, e^{log α})`, with
/// a uniform drawn only when `log α < 0`.
fn mh_accept<R: Rng>(rng: &mut R, log_alpha: f64, current_lw: f64, prop_lw: f64) -> bool {
    if !current_lw.is_finite() {
        return prop_lw.is_finite();
    }
    log_alpha >= 0.0 || rng.gen::<f64>() < log_alpha.exp()
}

#[cfg(test)]
mod tests;
