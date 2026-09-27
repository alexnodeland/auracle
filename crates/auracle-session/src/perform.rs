//! Performance: named controls wired through a patch's own Jacobian, and a
//! knob-only walk on the taste target.
//!
//! ## Named controls
//!
//! A performer reaches for *brighter*, not for `node/0#cut`. A **named
//! control** is a fixed direction `d` in standardized audio-φ space — *Bright*
//! is `+centroid_mean +rolloff_mean`, *Snap* is `−attack_s +crest`, and so
//! on — with a name that means the same thing on every patch. What it moves
//! differs per patch, and is found by measurement rather than by a table:
//!
//! 1. [`jacobian`] renders the patch once per continuous knob, nudged, and
//!    records `J = ∂z/∂p` — how each knob moves each standardized audio
//!    coordinate.
//! 2. [`wire`] solves `min ‖J x − d‖² + λ‖x‖²` for the knob move `x` that best
//!    produces the named direction, keeps the [`MAX_KNOBS`] largest entries,
//!    and re-solves on that support. A control value `c ∈ [−1, 1]` then moves
//!    the patch to `p₀ + c·α·x`, with `α` set so no knob travels more than
//!    [`MAX_TRAVEL`] of its range.
//!
//! Why measured, and not a table of "what a cutoff knob usually does": the
//! `jacobian_probe` example measured both over the 61 presets. Wired from each
//! patch's own Jacobian, the median purity (cosine between the φ movement
//! achieved and the direction asked for) was 0.61 for Bright, 0.77 for Snap and
//! 0.75 for Motion. Wired from the best leave-one-out table of per-site-kind
//! averages it was 0.23, 0.16 and 0.09: the same knob does different things in
//! different patches, which is the whole reason the grammar exists.
//!
//! **A control the patch cannot reach is not faked.** Grit and Space measured
//! a median purity of ~0 by knobs alone, because most patches contain no drive
//! or reverb to turn. [`Wiring::search`] marks such a control; the instrument
//! then offers a structural variant in that direction instead of moving knobs
//! that do not do what the label says.
//!
//! ## Drift and offers
//!
//! [`Engine::drift`] is the same locked Metropolis–Hastings walk refinement
//! uses, on the same Boltzmann target `π_β ∝ p_grammar · exp(β·E[u])`, with
//! every non-continuous site locked. Structure therefore cannot change under
//! the player's hands — only knob values — and because locking is exact
//! conditioning (see [`crate::engine`]), the walk is still a sampler of the
//! target restricted to this patch's shape. Nothing is inserted into the pool:
//! a performance gesture is not a candidate until the player keeps it.
//! [`Engine::offer`] is the same walk with only the player's locks, so it may
//! change structure; its result is heard through a crossfade, never a jump.

use std::collections::HashSet;

use auracle_features::{featurize_memo, AudioFeatures, PhraseSpec, RenderMemo};
use auracle_grammar::edit::{set_param, ParamValue};
use auracle_grammar::PatchTree;
use auracle_taste::Standardizer;
use fugue_evo::genome::trace_genome::{ChoiceValue, TraceGenome};
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::engine::Engine;
use crate::surrogate::QUARANTINE_FITNESS;

/// The fitness of a taste model that has seen nothing: zero for every patch
/// that vets, quarantine for one that does not. Under it the Boltzmann target
/// is the grammar prior restricted to listenable patches, which is what the
/// posterior *is* before any evidence — so an offer or a drift made before the
/// first pick is exploration by the grammar, stated as such, rather than
/// nothing at all.
#[derive(Clone, Debug)]
pub struct VetOnlyFitness {
    /// The audition stimulus the vet is run under.
    pub phrase: PhraseSpec,
    /// The engine's featurization memo.
    pub memo: RenderMemo,
}

impl fugue_evo::fitness::traits::Fitness for VetOnlyFitness {
    type Genome = PatchTree;
    type Value = f64;

    fn evaluate(&self, genome: &PatchTree) -> f64 {
        match featurize_memo(genome, &self.phrase, &self.memo, false) {
            Ok(_) => 0.0,
            Err(_) => QUARANTINE_FITNESS,
        }
    }
}

/// Finite-difference step on a knob's normalized range. Large enough to move
/// φ past its numerical floor on a 5 s render, small enough to stay local;
/// the same step the `jacobian_probe` measurements used.
pub const JACOBIAN_STEP: f64 = 0.08;
/// Ridge on the wiring solve, in the units of `z` per unit knob.
pub const RIDGE: f64 = 0.05;
/// Share of [`RIDGE`] a semantically named knob pays ([`NamedControl::sites`]).
/// In Bayesian terms the wiring is the posterior mean under a Gaussian prior
/// on the knob move, and a named knob's prior variance is `1 / 0.25 = 4×`
/// wider: it is *expected* to matter, but its sign still comes from the data.
pub const SEMANTIC_RIDGE: f64 = 0.25;
/// Most knobs one named control may move. Four carried a median 68% of a
/// preset's audible leverage (`leverage_probe`); more makes a control that
/// is hard to hear as one gesture.
pub const MAX_KNOBS: usize = 4;
/// Largest share of a knob's range a full turn of a named control may move it.
pub const MAX_TRAVEL: f64 = 0.5;
/// Largest value [`apply`] writes. fugue's `Uniform(0, 1)` is half-open, so a
/// knob at exactly 1.0 has log-prior −∞ and makes the patch un-evolvable; a
/// performance gesture must never be the thing that does that.
pub const KNOB_MAX: f64 = 1.0 - 1.0e-6;
/// Below this purity a control is a *search* control on this patch.
pub const PURITY_FLOOR: f64 = 0.35;
/// Largest reversal, in σ of the session's spread, the performance gate
/// tolerates between verified points — two orders of magnitude under any
/// audible difference, and above the numerical noise of a 5 s render.
pub const MONO_TOL: f64 = 0.05;
/// Below this reach (σ of the named direction at a full turn) likewise. The
/// σ is the session pool's spread, which is wider than a curated library's,
/// so a floor set against the presets (0.25σ) hid controls that are plainly
/// audible on a live patch.
pub const REACH_FLOOR: f64 = 0.15;

/// A named performance control: a fixed direction in audio-φ.
#[derive(Clone, Copy, Debug)]
pub struct NamedControl {
    /// The control's name, the same on every patch.
    pub name: &'static str,
    /// What the low end of the control sounds like.
    pub low: &'static str,
    /// What the high end sounds like.
    pub high: &'static str,
    /// The direction, as `(audio φ name without its stimulus tag, weight)`.
    pub axis: &'static [(&'static str, f64)],
    /// Knob sites a musician would reach for to do this, by trace site name
    /// (`cut`, `attack`, `rmix`, …). A prior, not a mapping: these knobs get a
    /// wider prior in the wiring solve ([`SEMANTIC_RIDGE`]), so where the
    /// measurement is ambiguous the knob that says what it does wins — and
    /// where the measurement disagrees, it does not.
    pub sites: &'static [&'static str],
}

/// The six measured controls, in panel order. Blend and Wander are not
/// directions in φ and live in the instrument, not here.
pub const CONTROLS: [NamedControl; 6] = [
    NamedControl {
        name: "Bright",
        low: "dark",
        high: "bright",
        axis: &[("centroid_mean", 1.0), ("rolloff_mean", 1.0)],
        sites: &[
            "cut", "bright", "tone", "high", "thresh", "drive", "morph", "vowel",
        ],
    },
    NamedControl {
        name: "Snap",
        low: "bloom",
        high: "snap",
        axis: &[("attack_s", -1.0), ("crest", 1.0)],
        sites: &["attack", "att", "decay", "dec", "sustain"],
    },
    NamedControl {
        name: "Motion",
        low: "still",
        high: "restless",
        axis: &[
            ("held_centroid_std", 1.0),
            ("motion_slow", 1.0),
            ("motion_mid", 1.0),
            ("motion_fast", 1.0),
        ],
        sites: &[
            "mdepth", "rate", "crate", "cdepth", "prate", "pdepth", "trate", "tdepth", "vrate",
            "vdepth", "frate", "fdepth", "erate", "hrate", "glide",
        ],
    },
    NamedControl {
        name: "Body",
        low: "thin",
        high: "full",
        axis: &[("bass_fraction", 1.0)],
        sites: &["det", "smix", "low", "bal", "cut"],
    },
    NamedControl {
        name: "Grit",
        low: "smooth",
        high: "rough",
        axis: &[("flatness_mean", 1.0)],
        sites: &["drive", "bits", "dsamp", "thresh", "res"],
    },
    NamedControl {
        name: "Space",
        low: "close",
        high: "far",
        axis: &[("tail_ratio", 1.0)],
        sites: &["rmix", "rsize", "rdamp", "time", "fb", "dmix", "release"],
    },
];

/// `∂z/∂p` for one patch: how each continuous knob moves each standardized
/// audio coordinate.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Jacobian {
    /// Knob addresses, column order.
    pub addrs: Vec<String>,
    /// The knobs' current normalized values.
    pub values: Vec<f64>,
    /// Audio φ names (with their stimulus tag), row order.
    pub names: Vec<String>,
    /// The patch's own standardized audio φ.
    pub z: Vec<f64>,
    /// One column per knob: `∂z/∂p`, per unit of normalized knob travel.
    pub cols: Vec<Vec<f64>>,
}

/// How one named control is wired on one patch.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Wiring {
    /// The control's name.
    pub name: String,
    /// Low-end word.
    pub low: String,
    /// High-end word.
    pub high: String,
    /// `(address, knob travel at a full turn)`; add `c ×` this to each knob.
    pub knobs: Vec<(String, f64)>,
    /// Cosine between the φ movement this wiring predicts and the direction
    /// asked for. 1 is a pure move along the named axis.
    pub purity: f64,
    /// Predicted movement along the named axis at a full turn, in σ.
    pub reach: f64,
    /// Where the patch measures on this axis now, in σ.
    pub position: f64,
    /// True when the knobs cannot honestly produce this control, and turning
    /// it should ask for a structural offer instead.
    pub search: bool,
    /// Measured movement along the axis at `c = +1`, in σ, from a real render
    /// (see [`verify`]). `None` until verified.
    #[serde(default)]
    pub up: Option<f64>,
    /// Measured movement along the axis at `c = −1`, in σ (positive means the
    /// sound moved toward the low word, as asked).
    #[serde(default)]
    pub down: Option<f64>,
}

impl Wiring {
    /// The range of control values this wiring honestly supports: a half the
    /// verification did not confirm is closed. An unverified wiring is taken
    /// at the Jacobian's word.
    pub fn range(&self) -> (f64, f64) {
        if self.search {
            return (0.0, 0.0);
        }
        let ok = |m: Option<f64>| m.is_none_or(|v| v >= REACH_FLOOR * 0.5);
        (
            if ok(self.down) { -1.0 } else { 0.0 },
            if ok(self.up) { 1.0 } else { 0.0 },
        )
    }
}

/// The unit direction for `control` over `names` (tagged φ names).
pub fn direction(control: &NamedControl, names: &[String]) -> Vec<f64> {
    let mut d: Vec<f64> = names
        .iter()
        .map(|n| {
            let bare = n.split(':').next().unwrap_or(n);
            control
                .axis
                .iter()
                .find(|(a, _)| *a == bare)
                .map_or(0.0, |(_, w)| *w)
        })
        .collect();
    let norm = d.iter().map(|x| x * x).sum::<f64>().sqrt();
    if norm > 0.0 {
        d.iter_mut().for_each(|x| *x /= norm);
    }
    d
}

/// The continuous knobs of `tree`, as `(address, value)` in trace order.
pub fn continuous_knobs(tree: &PatchTree) -> Vec<(String, f64)> {
    tree.to_trace()
        .choices
        .iter()
        .filter_map(|(a, c)| match c.value {
            ChoiceValue::F64(v) => Some((a.to_string(), v)),
            _ => None,
        })
        .collect()
}

/// Every address of `tree` that is **not** a continuous knob: structure and
/// categorical choices. Locking these makes a walk knob-only.
pub fn structural_addrs(tree: &PatchTree) -> Vec<String> {
    tree.to_trace()
        .choices
        .iter()
        .filter(|(_, c)| !matches!(c.value, ChoiceValue::F64(_)))
        .map(|(a, _)| a.to_string())
        .collect()
}

/// Standardized audio φ of `tree`, or `None` if it does not vet.
fn audio_z(
    tree: &PatchTree,
    spec: &PhraseSpec,
    memo: &RenderMemo,
    std: &Standardizer,
) -> Option<Vec<f64>> {
    let (cf, _) = featurize_memo(tree, spec, memo, false).ok()?;
    let raw = cf.features.audio.to_vec();
    Some(
        raw.iter()
            .enumerate()
            .map(|(i, x)| (x - std.mean[i]) / std.std[i])
            .collect(),
    )
}

/// Measure the audio Jacobian of `tree` by one-sided finite differences,
/// stepping each knob toward the interior of its range. `n + 1` renders for
/// `n` knobs, all through the memo. Knobs whose nudge fails to vet get a zero
/// column: the wiring then simply cannot use them.
///
/// `std` must be the standardizer the session's φ lives under; the audio
/// coordinates are the first [`AudioFeatures::NAMES`] entries of it.
pub fn jacobian(
    tree: &PatchTree,
    spec: &PhraseSpec,
    memo: &RenderMemo,
    std: &Standardizer,
) -> Option<Jacobian> {
    let z = audio_z(tree, spec, memo, std)?;
    let knobs = continuous_knobs(tree);
    let mut cols = Vec::with_capacity(knobs.len());
    for (addr, v) in &knobs {
        let h = if *v < 0.5 {
            JACOBIAN_STEP
        } else {
            -JACOBIAN_STEP
        };
        let col = set_param(tree, addr, ParamValue::Continuous(v + h))
            .ok()
            .and_then(|t| audio_z(&t, spec, memo, std))
            .map(|zn| zn.iter().zip(&z).map(|(a, b)| (a - b) / h).collect())
            .unwrap_or_else(|| vec![0.0; z.len()]);
        cols.push(col);
    }
    Some(Jacobian {
        addrs: knobs.iter().map(|(a, _)| a.clone()).collect(),
        values: knobs.iter().map(|(_, v)| *v).collect(),
        names: AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect(),
        z,
        cols,
    })
}

/// Solve the symmetric positive-definite system `M x = b` (Gaussian
/// elimination with partial pivoting; the systems here are at most a few
/// dozen square).
fn solve(mut m: Vec<Vec<f64>>, mut b: Vec<f64>) -> Vec<f64> {
    let n = b.len();
    for c in 0..n {
        let p = (c..n)
            .max_by(|&i, &j| m[i][c].abs().total_cmp(&m[j][c].abs()))
            .unwrap_or(c);
        m.swap(c, p);
        b.swap(c, p);
        let piv = m[c][c];
        if piv.abs() < 1e-12 {
            continue;
        }
        let pivot_row = m[c].clone();
        for r in (c + 1)..n {
            let f = m[r][c] / piv;
            if f == 0.0 {
                continue;
            }
            for (x, p) in m[r][c..].iter_mut().zip(&pivot_row[c..]) {
                *x -= f * p;
            }
            b[r] -= f * b[c];
        }
    }
    let mut x = vec![0.0; n];
    for c in (0..n).rev() {
        let s: f64 = ((c + 1)..n).map(|k| m[c][k] * x[k]).sum();
        x[c] = if m[c][c].abs() < 1e-12 {
            0.0
        } else {
            (b[c] - s) / m[c][c]
        };
    }
    x
}

/// Weighted ridge least squares over the columns in `support`:
/// `(AᵀA + λ·diag(w))⁻¹ Aᵀ d`, with `w` the per-column penalty share.
fn ridge(cols: &[Vec<f64>], support: &[usize], d: &[f64], w: &[f64]) -> Vec<f64> {
    let k = support.len();
    let mut m = vec![vec![0.0; k]; k];
    let mut b = vec![0.0; k];
    for (i, &ci) in support.iter().enumerate() {
        b[i] = cols[ci].iter().zip(d).map(|(a, x)| a * x).sum();
        for (j, &cj) in support.iter().enumerate() {
            m[i][j] = cols[ci].iter().zip(&cols[cj]).map(|(a, x)| a * x).sum();
        }
        m[i][i] += RIDGE * w[ci];
    }
    solve(m, b)
}

/// Wire every [`CONTROLS`] entry onto the patch `jac` was measured on.
pub fn wire(jac: &Jacobian) -> Vec<Wiring> {
    wire_with(jac, SEMANTIC_RIDGE)
}

/// [`wire`] with the semantic prior's penalty share given explicitly: 1.0 is
/// no prior at all. For measuring what the prior costs and buys.
pub fn wire_with(jac: &Jacobian, semantic: f64) -> Vec<Wiring> {
    CONTROLS
        .iter()
        .map(|c| wire_one(c, jac, semantic))
        .collect()
}

fn wire_one(control: &NamedControl, jac: &Jacobian, semantic: f64) -> Wiring {
    let d = direction(control, &jac.names);
    let position: f64 = d.iter().zip(&jac.z).map(|(a, b)| a * b).sum();
    let n = jac.cols.len();
    let mut out = Wiring {
        name: control.name.into(),
        low: control.low.into(),
        high: control.high.into(),
        knobs: Vec::new(),
        purity: 0.0,
        reach: 0.0,
        position,
        search: true,
        up: None,
        down: None,
    };
    if n == 0 {
        return out;
    }
    let all: Vec<usize> = (0..n).collect();
    let w: Vec<f64> = jac
        .addrs
        .iter()
        .map(|a| {
            let site = a.rsplit('#').next().unwrap_or(a);
            if control.sites.contains(&site) {
                semantic
            } else {
                1.0
            }
        })
        .collect();
    let x = ridge(&jac.cols, &all, &d, &w);
    let mut support: Vec<usize> = all.clone();
    support.sort_by(|&a, &b| x[b].abs().total_cmp(&x[a].abs()));
    support.truncate(MAX_KNOBS);
    support.retain(|&i| x[i].abs() > 1e-9);
    if support.is_empty() {
        return out;
    }
    let xs = ridge(&jac.cols, &support, &d, &w);
    // The φ movement this wiring predicts, per unit of x.
    let m = jac.names.len();
    let mut moved = vec![0.0; m];
    for (i, &ci) in support.iter().enumerate() {
        for (mv, j) in moved.iter_mut().zip(&jac.cols[ci]) {
            *mv += j * xs[i];
        }
    }
    let along: f64 = moved.iter().zip(&d).map(|(a, b)| a * b).sum();
    let norm = moved.iter().map(|v| v * v).sum::<f64>().sqrt();
    if norm <= 1e-12 || along <= 0.0 {
        return out;
    }
    let peak = xs.iter().fold(0.0f64, |p, v| p.max(v.abs()));
    let alpha = MAX_TRAVEL / peak.max(1e-12);
    out.purity = along / norm;
    out.reach = alpha * along;
    out.knobs = support
        .iter()
        .zip(&xs)
        .map(|(&ci, v)| (jac.addrs[ci].clone(), alpha * v))
        .collect();
    out.search = out.purity < PURITY_FLOOR || out.reach < REACH_FLOOR;
    out
}

/// Apply named-control settings `c` (one per wiring, each in `[−1, 1]`) to
/// the knob values the Jacobian was measured at. Returns `(address, value)`
/// for every knob that moved, clamped into the knob domain.
pub fn apply(jac: &Jacobian, wiring: &[Wiring], c: &[f64]) -> Vec<(String, f64)> {
    let mut vals = jac.values.clone();
    let mut touched = vec![false; vals.len()];
    for (w, &ci) in wiring.iter().zip(c) {
        if w.search || ci == 0.0 {
            continue;
        }
        let (lo, hi) = w.range();
        let ci = ci.clamp(lo, hi);
        for (addr, gain) in &w.knobs {
            if let Some(k) = jac.addrs.iter().position(|a| a == addr) {
                vals[k] += ci * gain;
                touched[k] = true;
            }
        }
    }
    jac.addrs
        .iter()
        .zip(vals)
        .zip(touched)
        .filter(|(_, t)| *t)
        .map(|((a, v), _)| (a.clone(), v.clamp(0.0, KNOB_MAX)))
        .collect()
}

/// Check every reachable wiring against real renders: the patch at `c = ±1`
/// on that one control, projected onto the control's own axis.
///
/// The Jacobian is a local, linear claim, and it is wrong exactly where a
/// performer would notice: at a boundary. A patch already as still as it gets
/// cannot be made stiller, and on First Bass turning Motion *down* measurably
/// made it very slightly more restless — the linear prediction said otherwise.
/// So each half is confirmed or closed ([`Wiring::range`]), and a control with
/// neither half confirmed becomes a search control. Four renders per
/// reachable control (±½ and ±1), through the memo.
pub fn verify(
    tree: &PatchTree,
    jac: &Jacobian,
    wiring: &mut [Wiring],
    spec: &PhraseSpec,
    memo: &RenderMemo,
    std: &Standardizer,
) {
    for i in 0..wiring.len() {
        if wiring[i].search {
            continue;
        }
        let d = direction(&CONTROLS[i], &jac.names);
        let along = |z: &[f64]| z.iter().zip(&d).map(|(a, b)| a * b).sum::<f64>();
        let base = along(&jac.z);
        let at = |c: f64| -> Option<f64> {
            let mut cs = vec![0.0; wiring.len()];
            cs[i] = c;
            let unverified: Vec<Wiring> = wiring
                .iter()
                .map(|w| Wiring {
                    up: None,
                    down: None,
                    ..w.clone()
                })
                .collect();
            let mut t = tree.clone();
            for (a, v) in apply(jac, &unverified, &cs) {
                t = set_param(&t, &a, ParamValue::Continuous(v)).ok()?;
            }
            audio_z(&t, spec, memo, std).map(|z| along(&z))
        };
        // A half is confirmed only if the sound moved the asked-for way at
        // both half and full travel; its reach is the full-travel movement.
        // A half that moves at the end but reverses on the way is closed.
        let half = |c: f64| -> f64 {
            let near = at(c * 0.5).map(|v| (v - base) * c).unwrap_or(0.0);
            let far = at(c).map(|v| (v - base) * c).unwrap_or(0.0);
            if near > 0.0 && far > near {
                far
            } else {
                0.0
            }
        };
        let (up, down) = (half(1.0), half(-1.0));
        wiring[i].up = Some(up);
        wiring[i].down = Some(down);
        let (lo, hi) = wiring[i].range();
        if lo == 0.0 && hi == 0.0 {
            wiring[i].search = true;
        }
    }
}

impl Engine {
    /// Measure, wire and verify the named controls on `tree`: [`jacobian`],
    /// [`wire`], then [`verify`]. `None` before a standardizer exists or when
    /// the tree does not vet.
    pub fn wire_controls(&self, tree: &PatchTree) -> Option<(Jacobian, Vec<Wiring>)> {
        let std = self.standardizer.as_deref()?;
        let jac = jacobian(tree, &self.cfg.phrase, self.memo(), std)?;
        let mut wiring = wire(&jac);
        verify(tree, &jac, &mut wiring, &self.cfg.phrase, self.memo(), std);
        Some((jac, wiring))
    }

    /// True once the walks are taste-directed; false while they explore the
    /// vetted grammar prior.
    pub fn has_taste(&self) -> bool {
        self.posterior.is_some() && self.standardizer.is_some()
    }

    /// [`jacobian`] under this session's stimulus, memo and standardizer.
    pub fn jacobian(&self, tree: &PatchTree) -> Option<Jacobian> {
        let std = self.standardizer.as_deref()?;
        jacobian(tree, &self.cfg.phrase, self.memo(), std)
    }

    /// One knob-only drift: the locked MH walk on the taste target with every
    /// structural and categorical site locked, plus the player's own locks.
    /// Nothing enters the pool. Before any taste has been fitted the target is
    /// the vetted grammar prior ([`VetOnlyFitness`]); `None` when the walk
    /// accepted no move.
    pub fn drift<R: Rng>(
        &self,
        rng: &mut R,
        tree: &PatchTree,
        player_locks: &[String],
        steps: usize,
    ) -> Option<PatchTree> {
        let mut locked: HashSet<String> = structural_addrs(tree).into_iter().collect();
        locked.extend(player_locks.iter().cloned());
        self.refine_walk(rng, tree, &locked, steps)
    }

    /// A structural offer: the same walk with only the player's locks. Like
    /// [`Self::drift`], it inserts nothing, and it too falls back to the
    /// vetted grammar prior before the first fit.
    pub fn offer<R: Rng>(
        &self,
        rng: &mut R,
        tree: &PatchTree,
        player_locks: &[String],
        steps: usize,
    ) -> Option<PatchTree> {
        let locked: HashSet<String> = player_locks.iter().cloned().collect();
        self.refine_walk(rng, tree, &locked, steps)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use auracle_features::featurize;
    use auracle_grammar::preset_bank;

    fn preset_standardizer(spec: &PhraseSpec) -> Standardizer {
        let rows: Vec<Vec<f64>> = preset_bank()
            .iter()
            .filter_map(|p| featurize(&p.tree, spec).ok())
            .map(|v| v.features.phi())
            .collect();
        Standardizer::fit(&rows)
    }

    #[test]
    fn directions_are_unit_and_named_coordinates_exist() {
        let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
        for c in &CONTROLS {
            let d = direction(c, &names);
            let n: f64 = d.iter().map(|x| x * x).sum::<f64>().sqrt();
            assert!(
                (n - 1.0).abs() < 1e-9,
                "{} names a coordinate φ lacks",
                c.name
            );
        }
    }

    #[test]
    fn solve_recovers_a_known_system() {
        let m = vec![vec![4.0, 1.0], vec![1.0, 3.0]];
        let x = solve(m, vec![1.0, 2.0]);
        assert!((x[0] - 1.0 / 11.0).abs() < 1e-12 && (x[1] - 7.0 / 11.0).abs() < 1e-12);
    }

    /// The gate: where a control claims it can reach, turning it moves the
    /// **measured** sound along its axis, in order, on real renders.
    ///
    /// Verification ([`verify`]) opens a half only if the renders at ±½ and ±1
    /// both moved the right way; this checks the claim somewhere verification
    /// did not look — ±¾ — with a stated tolerance of [`MONO_TOL`]σ. No finite
    /// set of samples proves a nonlinear response monotone; this is the
    /// measurable version of the promise. A wiring whose predicted move does not survive the
    /// nonlinearity of a real render is exactly the dishonest control this
    /// module exists to refuse.
    #[test]
    fn named_controls_move_the_sound_they_name() {
        let spec = PhraseSpec::default();
        let std = preset_standardizer(&spec);
        let memo = RenderMemo::default();
        let bank = preset_bank();
        let mut checked = 0;
        for name in ["First Bass", "Ceiling", "Detune Dream", "Long Way Down"] {
            let p = bank.iter().find(|p| p.name == name).expect("preset exists");
            let jac = jacobian(&p.tree, &spec, &memo, &std).expect("preset vets");
            let mut wiring = wire(&jac);
            verify(&p.tree, &jac, &mut wiring, &spec, &memo, &std);
            for (i, w) in wiring.iter().enumerate() {
                let (lo, hi) = w.range();
                if w.search {
                    continue;
                }
                let d = direction(&CONTROLS[i], &jac.names);
                let at = |c: f64| {
                    let mut cs = vec![0.0; wiring.len()];
                    cs[i] = c;
                    let mut t = p.tree.clone();
                    for (a, v) in apply(&jac, &wiring, &cs) {
                        t = set_param(&t, &a, ParamValue::Continuous(v)).unwrap();
                    }
                    let z = audio_z(&t, &spec, &memo, &std).expect("still vets");
                    z.iter().zip(&d).map(|(a, b)| a * b).sum::<f64>()
                };
                let mid = at(0.0);
                if hi > 0.0 {
                    let h = at(0.75);
                    assert!(
                        h > mid - MONO_TOL,
                        "{name}/{} up half: {mid:.3} -> {h:.3}",
                        w.name
                    );
                    checked += 1;
                }
                if lo < 0.0 {
                    let l = at(-0.75);
                    assert!(
                        l < mid + MONO_TOL,
                        "{name}/{} down half: {mid:.3} -> {l:.3}",
                        w.name
                    );
                    checked += 1;
                }
            }
        }
        assert!(checked >= 8, "too few open halves to be a gate: {checked}");
    }
}
