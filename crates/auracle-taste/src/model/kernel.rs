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

use fugue::core::numerical::nan_to_neg_inf;
use fugue::runtime::handler::run;
use fugue::runtime::interpreters::PriorHandler;
use fugue::{Address, DiminishingAdaptation, Trace};
use rand::{Rng, RngCore};
use std::collections::HashMap;
use std::sync::Arc;

use super::{Evidence, Layout, SiteAddrs, TasteModel, TasteSample};
use crate::observe::FitSet;

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

/// The chain's state: the current values and their draw and log-weight, and
/// a proposal buffer that equals the current values between steps.
struct Chain<'a> {
    layout: &'a Layout,
    evidence: &'a Evidence,
    /// Each site's address (adaptation is keyed by it) and its slot in the
    /// values, in the trace's order: the order fugue picks a site from.
    sites: Vec<(Address, usize)>,
    adaptation: DiminishingAdaptation,
    cur: Vec<f64>,
    cur_s: TasteSample,
    cur_lw: f64,
    prop: Vec<f64>,
    prop_s: TasteSample,
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
        let mut cur_s = TasteSample {
            theta: Vec::new(),
            tau: Vec::new(),
            cuts: Vec::new(),
        };
        layout.decode_into(&cur, &mut cur_s);
        let cur_lw = log_weight(layout, evidence, &cur, &cur_s);
        Self {
            layout,
            evidence,
            sites,
            adaptation: DiminishingAdaptation::new(0.44, 0.7),
            prop: cur.clone(),
            prop_s: cur_s.clone(),
            cur,
            cur_s,
            cur_lw,
        }
    }

    /// One transition, fugue's `single_site_mh_step`. There is always a site
    /// to move: every program has at least one τ.
    fn step<R: Rng>(&mut self, rng: &mut R, adapt: bool) {
        let (addr, slot) = &self.sites[gen_index(rng, self.sites.len())];
        let slot = *slot;
        let scale = self.adaptation.get_scale(addr);
        let x = self.cur[slot];
        self.prop[slot] = x + scale * gaussian_z(rng);
        self.layout.decode_into(&self.prop, &mut self.prop_s);
        let prop_lw = log_weight(self.layout, self.evidence, &self.prop, &self.prop_s);
        let accept = mh_accept(rng, prop_lw - self.cur_lw, self.cur_lw, prop_lw);
        if adapt {
            self.adaptation.update(addr, accept);
        }
        if accept {
            self.cur[slot] = self.prop[slot];
            std::mem::swap(&mut self.cur_s, &mut self.prop_s);
            self.cur_lw = prop_lw;
        } else {
            self.prop[slot] = x;
        }
    }
}

/// A state's log-weight as the program's trace totals it: the log-prior in
/// execution order, plus the factor, a NaN read as −∞ (module doc).
fn log_weight(layout: &Layout, evidence: &Evidence, vals: &[f64], s: &TasteSample) -> f64 {
    layout.log_prior(vals) + nan_to_neg_inf(evidence.loglik(s))
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
