//! The belief after each pick: what the model makes of every pool member now,
//! and what the next generation would do with that, in the few numbers the
//! app redraws per pick (Plan-005 task 9, RFC-006 Open 3).
//!
//! A pick does not refit. It reweights the posterior's draws by importance
//! sampling (`TastePosterior::reweighted`, from `Engine::observe_as`), and
//! every summary here is taken under those weights, so the numbers are the
//! posterior the engine holds after the pick, not the one the last refit
//! left. They are the numbers a refit's views carry ([`Engine::ranked`],
//! [`Engine::taste_map`]'s pool points), computed the same way; what a refit
//! adds beyond them (names, the map's projection and its history ghosts, the
//! lenses' θ) is either unmoved by a pick or too dear to recompute per pick.
//! `examples/pick_belief.rs` in `auracle-wasm` measures the cost natively, and
//! `pick_belief.mjs` beside it in wasm.

use serde::{Deserialize, Serialize};

use crate::engine::Engine;
use crate::map::most_responsible;

/// One pool member under the posterior as it stands.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BeliefRow {
    /// Candidate id.
    pub id: u64,
    /// Posterior-mean mixture utility: the ranked list's score, the map's
    /// glow (0 with no posterior).
    pub mean: f64,
    /// Its posterior std: the map's dot size (0 with no posterior).
    pub std: f64,
    /// The lens most responsible for it: the map's color (0 with no
    /// posterior or one lens).
    pub style: usize,
}

/// What the model believes about the pool now.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Belief {
    /// Every pool member, best first: [`Engine::ranked`]'s rows and order.
    pub ranked: Vec<BeliefRow>,
    /// The parents a generation opened now would refine from, best first
    /// ([`Engine::next_seeds`]).
    pub seeds: Vec<u64>,
    /// The members a generation opened now could retire, lowest first
    /// ([`Engine::may_replace`]).
    pub may_replace: Vec<u64>,
}

impl Engine {
    /// The belief as it stands: the ranked numbers, each member's lens, the
    /// next generation's seeds and the members it could replace.
    ///
    /// One pass over the draws per member serves the score, its std and its
    /// lens (`TastePosterior::utility_mix_and_responsibilities`), and the
    /// seeds and the eviction order are read off those scores rather than
    /// computed again. While a generation is open with the pool over size,
    /// one more pass ranks what its end would retire, under the posterior it
    /// opened with ([`Engine::retiring`]); at rest there is nothing to rank. Each piece equals its own call ([`Engine::ranked`],
    /// [`Engine::taste_map`]'s pool points, [`Engine::next_seeds`],
    /// [`Engine::may_replace`]) number for number; the tests hold it to that.
    pub fn belief(&self) -> Belief {
        let mut rows: Vec<(usize, f64, f64, usize)> = self
            .pool
            .iter()
            .enumerate()
            .map(|(i, c)| match &self.posterior {
                Some(p) if !c.phi_std.is_empty() => {
                    let ((mean, std), r) = p.utility_mix_and_responsibilities(&c.phi_std);
                    (i, mean, std, most_responsible(&r))
                }
                _ => (i, 0.0, 0.0, 0),
            })
            .collect();
        // `ranked`'s order: best first, equals in pool order (a stable sort).
        rows.sort_by(|a, b| b.1.total_cmp(&a.1));
        let ranked: Vec<(usize, f64, f64)> = rows.iter().map(|&(i, m, s, _)| (i, m, s)).collect();
        let retiring = self.retiring();
        let seeds = self.next_seed_rows(&ranked, &retiring);
        let mut utility = vec![0.0; self.pool.len()];
        for &(i, mean, _, _) in &rows {
            utility[i] = mean;
        }
        let may_replace = self.may_replace_after(retiring, seeds.len(), |i| utility[i]);
        Belief {
            ranked: rows
                .into_iter()
                .map(|(i, mean, std, style)| BeliefRow {
                    id: self.pool[i].id,
                    mean,
                    std,
                    style,
                })
                .collect(),
            seeds,
            may_replace,
        }
    }
}
