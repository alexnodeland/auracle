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
//! 3. The gate asks whether the move is *this* control: [`Wiring::purity`] is
//!    the cosine with `d` inside the subspace of the six named axes, so a
//!    brightening that also raises the zero-crossing rate is still Bright,
//!    and one that also slows the attack is not. [`separate`] makes sure no
//!    two controls are one gesture, and [`verify`] checks each half on real
//!    renders.
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
//! [`Engine::drift`] samples the same Boltzmann target refinement uses,
//! `π_β ∝ p_grammar · exp(β·E[u])`, but with its own kernel: a local
//! Metropolis walk (a reflected Gaussian step, `sigma` from the Wander dial)
//! over the patch's [`live_knobs`] only. Everything else — structure,
//! categorical choices, sites without a live handle, the player's locks — is
//! held fixed, which is exact conditioning, so structure cannot change under
//! the player's hands. Nothing is inserted into the pool: a performance
//! gesture is not a candidate until the player keeps it.
//! [`Engine::offer`] is the same walk with only the player's locks, so it may
//! change structure; its result is heard through a crossfade, never a jump.

use std::collections::HashSet;

use auracle_features::{featurize_memo, AudioFeatures, PhraseSpec, RenderMemo};
use auracle_grammar::edit::{set_param, ParamValue};
use auracle_grammar::term::{AudioNode, ModNode, Uid};
use auracle_grammar::PatchTree;
use auracle_grammar::{apply_struct_op, StructOp};
use auracle_taste::Standardizer;
use fugue_evo::genome::trace_genome::{ChoiceValue, TraceGenome};
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::engine::{Engine, RefineOutcome};
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
/// Two reachable controls whose predicted movements are this collinear
/// (|cos| above it) are one gesture with two names; the later control in
/// [`CONTROLS`] order becomes a search control ([`separate`]).
pub const COLLINEAR: f64 = 0.8;
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
    /// How much of the predicted movement is this control rather than the
    /// **other named controls**: the cosine with the control's axis within
    /// the subspace the six named axes span. 1 moves none of the others;
    /// the search gate reads it ([`PURITY_FLOOR`]).
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
    /// The predicted φ movement per unit turn, unit length — kept only to
    /// tell two controls apart ([`separate`]); not sent to the page.
    #[serde(skip, default)]
    pub moved: Vec<f64>,
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

/// The module PERFORM grafts onto the output of a patch whose knobs cannot
/// reach control `k` ([`CONTROLS`] order), so the control has something to
/// turn: a neutral EQ, for Bright and Body. At 0 dB on all three bands it is
/// transparent, and its high and low shelves are the knobs a player would
/// name for either. `examples/perform_inserts.rs` measures both claims.
///
/// `None` for everything else, each for a measured reason:
///
/// * **Snap, Motion** — no single module answers them.
/// * **Grit** — its axis is spectral flatness, and a drive adds harmonics
///   (which is Bright), not noise. A crusher is transparent only at 16 bits,
///   where its slope is zero so the local measurement cannot see it, and it
///   clips anything hotter than its ±5 V window.
/// * **Space** — every effect sits before the voice's amp envelope, so a
///   reverb's tail is cut at note-off: on First Bass with a reverb grafted,
///   ∂(Space)/∂mix measured −0.04 and ∂/∂release +3.65. What gives a patch
///   space here is its release, which [`graft_for`] lengthens instead.
///
/// The fragment's input is a placeholder; `StructOp::InsertTree` replaces it
/// with the patch it wraps.
pub fn insert_for(k: usize) -> Option<AudioNode> {
    match CONTROLS.get(k)?.name {
        "Bright" | "Body" => Some(AudioNode::Eq {
            uid: Uid::NEW,
            low: 0.5,
            mid: 0.5,
            high: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
            input: Box::new(AudioNode::Silence { uid: Uid::NEW }),
        }),
        _ => None,
    }
}

/// `tree` changed so named control `k` has something to turn, or `None`:
/// Bright and Body get [`insert_for`]'s EQ on the output, below any stereo
/// effect that ends the chain (unless the patch
/// already has one, or it would break the size ceilings); Space gets its amp
/// release brought up to [`SPACE_RELEASE`] (unless it is already there).
/// Space is only grafted when turned up, so the longer release is what was
/// asked for; the EQ is transparent in either direction.
pub fn graft_for(tree: &PatchTree, k: usize) -> Option<PatchTree> {
    if CONTROLS.get(k)?.name == "Space" {
        if tree.amp.release >= SPACE_RELEASE {
            return None;
        }
        let mut t = tree.clone();
        t.amp.release = SPACE_RELEASE;
        return Some(t);
    }
    let node = insert_for(k)?;
    let same = |n: &AudioNode| std::mem::discriminant(n) == std::mem::discriminant(&node);
    fn any(n: &AudioNode, f: &dyn Fn(&AudioNode) -> bool) -> bool {
        f(n) || n.children().into_iter().any(|c| any(c, f))
    }
    if any(&tree.root, &same) {
        return None;
    }
    // Below any stereo tail, not after it: the EQ is mono, and grafted onto
    // a reverb or chorus at the output it folded the patch to one channel
    // (Ghost Bell moved 0.27σ). The stereo modules have one input, at `/0`.
    let mut key = String::from("node");
    let mut n = &tree.root;
    while matches!(
        n,
        AudioNode::Reverb { .. }
            | AudioNode::Chorus { .. }
            | AudioNode::Phaser { .. }
            | AudioNode::Flanger { .. }
    ) {
        n = n.children()[0];
        key.push_str("/0");
    }
    apply_struct_op(tree, &StructOp::InsertTree { key, node }).ok()
}

/// The amp release a Space graft brings a patch up to: a ≈250 ms time
/// constant (`1 ms·10000^x`), long enough for a tail to exist.
pub const SPACE_RELEASE: f64 = 0.6;

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

/// The continuous knobs of `tree` the voices can take **live**, as
/// `(address, value)` in trace order: those the compiler gave a
/// [`ParamHandle`](auracle_grammar::ParamHandle). Not every continuous site
/// has one — a modulation depth with no modulator compiles to nothing, and a
/// value the compiler bakes into a constant has no atomic to write — and a
/// performance surface must only ever turn knobs it can turn without a
/// recompile. Writing one without a handle is a miss, and the app answers a
/// miss by reloading the patch: mid-phrase, that is a dropout and every
/// pending offer lost. Empty if the tree does not compile.
pub fn live_knobs(tree: &PatchTree, sample_rate: f64) -> Vec<(String, f64)> {
    let Ok(voice) = auracle_grammar::compile(tree, sample_rate) else {
        return Vec::new();
    };
    continuous_knobs(tree)
        .into_iter()
        .filter(|(a, _)| voice.params.contains_key(a))
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
    let knobs = live_knobs(tree, spec.sample_rate);
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
    let mut w: Vec<Wiring> = CONTROLS
        .iter()
        .map(|c| wire_one(c, jac, semantic))
        .collect();
    separate(&mut w);
    w
}

/// Make sure no two reachable controls are the same gesture. When a later
/// control's predicted movement is within [`COLLINEAR`] of an earlier one's
/// (either sign), it cannot honestly claim a direction of its own on this
/// patch and becomes a search control. (Found when a pattern-aimed variant
/// of the wiring put Bright and Body onto the same knobs with opposite signs
/// on 2 of 12 fresh-pool patches; the guard costs nothing where they differ.)
pub fn separate(wiring: &mut [Wiring]) {
    for j in 0..wiring.len() {
        if wiring[j].search || wiring[j].moved.is_empty() {
            continue;
        }
        let clash = (0..j).any(|i| {
            !wiring[i].search
                && wiring[i].moved.len() == wiring[j].moved.len()
                && wiring[i]
                    .moved
                    .iter()
                    .zip(&wiring[j].moved)
                    .map(|(a, b)| a * b)
                    .sum::<f64>()
                    .abs()
                    > COLLINEAR
        });
        if clash {
            wiring[j].search = true;
        }
    }
}

/// Wire `control`, preferring the knobs a musician would name for it.
///
/// First the solve is restricted to the control's own sites
/// ([`NamedControl::sites`]); if that wiring clears the gate it is the one
/// used, because a player who turns Bright and watches the cutoff move has
/// learned something true about the patch, and one who watches the amp
/// release move has learned nothing. Only when the named knobs cannot do it
/// honestly does the solve range over every live knob — which is how Bright
/// ended up on Acid Line's attack and release. `semantic` is kept as the
/// soft prior inside the unrestricted solve.
fn wire_one(control: &NamedControl, jac: &Jacobian, semantic: f64) -> Wiring {
    let named: Vec<usize> = jac
        .addrs
        .iter()
        .enumerate()
        .filter(|(_, a)| control.sites.contains(&a.rsplit('#').next().unwrap_or(a)))
        .map(|(i, _)| i)
        .collect();
    if !named.is_empty() && named.len() < jac.addrs.len() {
        let w = wire_over(control, jac, semantic, &named);
        if !w.search {
            return w;
        }
    }
    let all: Vec<usize> = (0..jac.cols.len()).collect();
    wire_over(control, jac, semantic, &all)
}

fn wire_over(control: &NamedControl, jac: &Jacobian, semantic: f64, all: &[usize]) -> Wiring {
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
        moved: Vec::new(),
    };
    if n == 0 || all.is_empty() {
        return out;
    }
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
    let x_sub = ridge(&jac.cols, all, &d, &w);
    let mut x = vec![0.0; n];
    for (&i, v) in all.iter().zip(&x_sub) {
        x[i] = *v;
    }
    // Rank by *effect* — coefficient times how much the knob moves φ at all —
    // not by coefficient, and let only the knobs that do real work set the
    // travel scale. A knob that barely moves the sound needs a large
    // coefficient to contribute anything; ranked by coefficient it headed the
    // support, and scaled so the largest coefficient got MAX_TRAVEL it gave
    // the knob doing the work a sliver of a turn. Iron Bass: Bright wired to
    // drive (|∂z| 0.15 per unit) at +0.50 and its cutoff (|∂z| 5.2, +4σ of
    // centroid per unit) barely moved: 0.03σ of reach. Weak knobs are kept —
    // Motion leans on several small ones together, and dropping them cost it
    // a sixth of its patches — but clamped at MAX_TRAVEL instead of setting
    // the scale. (Letting any knob with a quarter of the top effect set it
    // still held Iron Bass's Bright to 0.56σ, via the distortion's tone.)
    let col_norm: Vec<f64> = jac
        .cols
        .iter()
        .map(|c| c.iter().map(|v| v * v).sum::<f64>().sqrt())
        .collect();
    let effect = |i: usize, xi: f64| xi.abs() * col_norm[i];
    let mut support: Vec<usize> = all.to_vec();
    support.sort_by(|&a, &b| effect(b, x[b]).total_cmp(&effect(a, x[a])));
    support.truncate(MAX_KNOBS);
    support.retain(|&i| x[i].abs() > 1e-9);
    if support.is_empty() {
        return out;
    }
    let xs = ridge(&jac.cols, &support, &d, &w);
    // The knob with the largest effect gets the full MAX_TRAVEL; the rest
    // follow in proportion and clamp there.
    let peak = support
        .iter()
        .zip(&xs)
        .max_by(|(&i, &a), (&j, &b)| effect(i, a).total_cmp(&effect(j, b)))
        .map_or(0.0, |(_, v)| v.abs());
    let alpha = MAX_TRAVEL / peak.max(1e-12);
    let travel: Vec<f64> = xs
        .iter()
        .map(|v| (alpha * v).clamp(-MAX_TRAVEL, MAX_TRAVEL))
        .collect();
    // The φ movement this wiring predicts at a full turn.
    let m = jac.names.len();
    let mut moved = vec![0.0; m];
    for (i, &ci) in support.iter().enumerate() {
        for (mv, j) in moved.iter_mut().zip(&jac.cols[ci]) {
            *mv += j * travel[i];
        }
    }
    let along: f64 = moved.iter().zip(&d).map(|(a, b)| a * b).sum();
    let norm = moved.iter().map(|v| v * v).sum::<f64>().sqrt();
    if norm <= 1e-12 || along <= 0.0 {
        return out;
    }
    // Purity is measured where cross-talk is heard: against the other named
    // axes. A real brightening also raises the zero-crossing rate and the
    // high band, and against the full φ those correlates read as impurity
    // (Bright's median cosine with its own axis over a fresh pool is 0.26);
    // what a player hears as "this control does something else" is a move
    // along *another control's* axis — attack when asked for bright.
    let off: f64 = CONTROLS
        .iter()
        .filter(|c| c.name != control.name)
        .map(|c| {
            let a = direction(c, &jac.names);
            a.iter()
                .zip(&moved)
                .map(|(x, y)| x * y)
                .sum::<f64>()
                .powi(2)
        })
        .sum();
    out.purity = along / (along * along + off).sqrt().max(1e-12);
    out.moved = moved.iter().map(|v| v / norm).collect();
    out.reach = along;
    out.knobs = support
        .iter()
        .zip(&travel)
        .map(|(&ci, &v)| (jac.addrs[ci].clone(), v))
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
        let half = |c: f64, scale: f64| -> f64 {
            let near = at(c * scale * 0.5).map(|v| (v - base) * c).unwrap_or(0.0);
            let far = at(c * scale).map(|v| (v - base) * c).unwrap_or(0.0);
            if near > 0.0 && far > near {
                far
            } else {
                0.0
            }
        };
        let (mut up, mut down) = (half(1.0, 1.0), half(-1.0, 1.0));
        // A control that would close at full travel gets one retry at half:
        // the same two-point test over ±¼ and ±½ (±½ is already rendered and
        // memoized). Wiring by effect gives the knob doing the work its whole
        // MAX_TRAVEL, which is where a Motion wiring most often turns back on
        // itself — so it keeps half the turn instead of closing.
        let open = |m: f64| m >= REACH_FLOOR * 0.5;
        if !open(up) && !open(down) {
            let (u2, d2) = (half(1.0, 0.5), half(-1.0, 0.5));
            if open(u2) || open(d2) {
                for (_, g) in wiring[i].knobs.iter_mut() {
                    *g *= 0.5;
                }
                wiring[i].reach *= 0.5;
                (up, down) = (u2, d2);
            }
        }
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

    /// The standardizer this session's φ lives under, once the pool is filled.
    pub fn standardizer(&self) -> Option<&Standardizer> {
        self.standardizer.as_deref()
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

    /// One knob-only drift: a local Metropolis walk ([`Engine::local_walk`],
    /// step `sigma` on the knob's 0–1 range) over the patch's live knobs
    /// minus the player's locks, on the taste target.
    /// Nothing enters the pool. Before any taste has been fitted the target is
    /// the vetted grammar prior ([`VetOnlyFitness`]). The error says why
    /// nothing came back: [`RefineOutcome::NoMove`] for a walk that stayed,
    /// [`RefineOutcome::OutsideSupport`] for a patch the prior gives no mass
    /// (a walk cannot start there at all).
    pub fn drift<R: Rng>(
        &self,
        rng: &mut R,
        tree: &PatchTree,
        player_locks: &[String],
        steps: usize,
        sigma: f64,
    ) -> Result<PatchTree, RefineOutcome> {
        let locked: HashSet<&str> = player_locks.iter().map(String::as_str).collect();
        let free: Vec<String> = live_knobs(tree, self.cfg.phrase.sample_rate)
            .into_iter()
            .map(|(a, _)| a)
            .filter(|a| !locked.contains(a.as_str()))
            .collect();
        self.local_walk(rng, tree, &free, steps, sigma)
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
    ) -> Result<PatchTree, RefineOutcome> {
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

    /// PERFORM only turns knobs the voices can take live. Every live knob has
    /// a compiled handle, and on the shipped presets there are continuous
    /// sites without one (a modulation depth with nothing to modulate): those
    /// are exactly what the old list wrote, missed, and answered with a patch
    /// reload mid-phrase. A drift may move nothing else.
    /// A control the knobs cannot reach may be given something to turn, and
    /// the EQ that does it for Bright and Body is inaudible until turned: on
    /// every preset that has no EQ, the grafted patch vets and its audio φ
    /// stays within a hair of the original (standardized, so "a hair" is in
    /// the units the controls move in). A second EQ is never grafted, and
    /// Space's release graft is a floor, not a reset.
    #[test]
    fn grafts_are_transparent_and_do_not_stack() {
        let spec = PhraseSpec::default();
        let std = preset_standardizer(&spec);
        let n_audio = AudioFeatures::NAMES.len();
        let z = |t: &PatchTree| {
            let v = featurize(t, &spec).expect("grafted patch vets");
            std.transform(&v.features.phi())[..n_audio].to_vec()
        };
        let bright = CONTROLS.iter().position(|c| c.name == "Bright").unwrap();
        let space = CONTROLS.iter().position(|c| c.name == "Space").unwrap();
        let mut grafted = 0;
        let mut worst: f64 = 0.0;
        for p in preset_bank().into_iter().step_by(4) {
            let Some(t) = graft_for(&p.tree, bright) else {
                continue;
            };
            grafted += 1;
            let d = z(&p.tree)
                .iter()
                .zip(z(&t))
                .map(|(a, b)| (a - b).powi(2))
                .sum::<f64>()
                .sqrt();
            worst = worst.max(d);
            assert!(graft_for(&t, bright).is_none(), "{}: a second EQ", p.name);
        }
        assert!(grafted >= 8, "only {grafted} presets took the EQ graft");
        assert!(worst < 0.05, "an EQ graft moved the sound by {worst:.3}σ");

        let mut short = preset_bank()[0].tree.clone();
        short.amp.release = 0.2;
        let long = graft_for(&short, space).expect("a short release grows");
        assert_eq!(long.amp.release, SPACE_RELEASE);
        assert_eq!(long.root, short.root, "Space changes the release only");
        assert!(graft_for(&long, space).is_none(), "already long enough");
        assert!(insert_for(space).is_none() && graft_for(&short, 4).is_none());
    }

    #[test]
    fn performance_touches_live_knobs_only() {
        let sr = PhraseSpec::default().sample_rate;
        let mut excluded = 0;
        for p in preset_bank() {
            let voice = auracle_grammar::compile(&p.tree, sr).expect("presets compile");
            let live = live_knobs(&p.tree, sr);
            for (a, _) in &live {
                assert!(
                    voice.params.contains_key(a),
                    "{}: {a} has no handle",
                    p.name
                );
            }
            excluded += continuous_knobs(&p.tree).len() - live.len();
        }
        assert!(
            excluded > 0,
            "the presets have handle-less sites; this test must see one"
        );
    }

    /// A drift is local and knob-only: it changes no structural or
    /// categorical choice and no knob without a live handle, and the farthest
    /// knob it moves grows with `sigma` — the Wander dial's reach. (The old
    /// walk, fugue's adaptive kernel from a fresh chain, moved some knob by
    /// 0.3–0.85 of its range in eight steps.)
    #[test]
    fn drift_is_local_and_follows_sigma() {
        use crate::engine::{Engine, SessionConfig};
        let engine = Engine::new(
            auracle_grammar::PatchGrammarPrior::default(),
            SessionConfig::default(),
        );
        let sr = engine.cfg.phrase.sample_rate;
        let mut rng = <rand::rngs::StdRng as rand::SeedableRng>::seed_from_u64(11);
        let (mut small, mut large) = (0.0f64, 0.0f64);
        for p in preset_bank().iter().take(6) {
            let before: std::collections::HashMap<String, f64> =
                continuous_knobs(&p.tree).into_iter().collect();
            let live: HashSet<String> = live_knobs(&p.tree, sr)
                .into_iter()
                .map(|(a, _)| a)
                .collect();
            for (sigma, acc) in [(0.03, &mut small), (0.2, &mut large)] {
                let t = engine
                    .drift(&mut rng, &p.tree, &[], 12, sigma)
                    .expect("a vetted preset drifts");
                assert_eq!(
                    structural_addrs(&t),
                    structural_addrs(&p.tree),
                    "{}: structure moved",
                    p.name
                );
                let mut far = 0.0f64;
                for (a, v) in continuous_knobs(&t) {
                    let d = (v - before[&a]).abs();
                    if !live.contains(&a) {
                        assert!(d < 1e-12, "{}: non-live {a} moved", p.name);
                    }
                    far = far.max(d);
                }
                *acc += far;
            }
        }
        assert!(
            small < 0.5 * large,
            "sigma should set the reach: {small:.2} vs {large:.2}"
        );
        assert!(
            small / 6.0 < 0.15,
            "a gentle drift should stay local: mean max {:.2}",
            small / 6.0
        );
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
