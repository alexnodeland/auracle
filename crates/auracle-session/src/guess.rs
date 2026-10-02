//! The model's guess: the module it guesses you would add next to the patch
//! in hand (Plan-005 task 9d, RFC-006 Open 2).
//!
//! The design is the note's recommendation, as the maintainer decided it
//! (`docs/notes/suggest-2026-10/README.md`, section 9):
//!
//! - **The candidates are the output's.** Every module the grammar allows
//!   at the output (a processor into the wire before the amp), on the root's
//!   modulation slot, and in every empty socket, each kept only if it passes
//!   `validate_tree` and adds without taking anything away
//!   ([`guess_candidates`]). A patch that does not sound takes sources only.
//!   A deeper socket is ranked only when asked for by its key (`at`).
//! - **Each is rendered on the audition phrase** and scored by the
//!   posterior's draws of its gain over the patch, `u(cand) − u(patch)`; a
//!   patch that does not sound is compared with the pool's average sound,
//!   z = 0. **Ranked by the lower bound,** mean − 1 sd, best first: the
//!   criterion that did best at the warm start and after 78 picks. There is
//!   no trust region: the lower bound is the guard.
//! - **Renders in the structural design's order** ([`Engine::guess_plan`]):
//!   by the posterior mean of the patch's audio φ beside the candidate's
//!   structural φ, so a crew that stops early has rendered the likeliest.
//!   With no farm, [`GUESS_FLOOR`] of them (the note's dout8).
//! - **Nothing before the warm start.** With no posterior (no fit yet) there
//!   is nothing to guess from, and the plan says so (`no_taste`).
//! - **A skip** keeps that module's **family** away from that **socket**
//!   for this patch ([`GuessMemory`]): the model cannot tell a wavefolder
//!   from a bitcrusher, so after skipping one it would only offer the other.
//!   Undoing a taken guess counts as a skip. Neither a take nor a skip is
//!   evidence: a skip is logged, as a revert is, and stays out of the
//!   likelihood.
//! - **Pure.** The plan and the ranking are functions of the tree, the
//!   posterior, the standardizer, the skips and which renders failed; the
//!   memo only saves renders (a hit is bit-identical to a miss). They draw
//!   no randomness (ADR-001), so a seeded session guesses the same.
//! - **Recomputed** on a structural edit, a refit, or the player asking,
//!   never per knob step: a turned knob changes every candidate's render.
//!
//! Each guess carries why ([`GuessWhy`]): the part of its gain, under the
//! style most responsible for it, that is largest — one of PERFORM's six
//! directions, named by the end word it moves toward, or one structural
//! coordinate. The app writes the line in the model's italic.

use std::collections::{HashMap, HashSet};

use auracle_features::{render_key, struct_features, AudioFeatures, Features, StructFeatures};
use auracle_grammar::{
    apply_struct_op, validate_tree, AudioNode, ModKind, ModNode, NodeKind, PatchTree, StructOp,
};
use serde::{Deserialize, Serialize};

use crate::engine::Engine;
use crate::perform::{direction, CONTROLS};

/// How many candidates a guess renders with no render crew (or a crew of
/// one or two): the first eight in the structural order, the note's dout8,
/// which matched rendering all of them at both stages measured.
pub const GUESS_FLOOR: usize = 8;

/// How long a guess may take once the patch has settled, in ms: the budget
/// an offer has (the interaction review's "within 3 s").
pub const GUESS_BUDGET_MS: u32 = 3_000;

/// The socket of the output: the wire into the amp.
pub const OUTPUT_SOCKET: &str = "out";

/// Modulation sources a slot with nothing in it can take.
const MOD_SOURCES: [ModKind; 6] = [
    ModKind::Lfo,
    ModKind::Env,
    ModKind::Rand,
    ModKind::Follow,
    ModKind::Euclid,
    ModKind::Steps,
];

/// Shapers and combiners a filled slot can take (each keeps what is there).
const MOD_SHAPERS: [ModKind; 10] = [
    ModKind::Quantize,
    ModKind::Slew,
    ModKind::Rectify,
    ModKind::Hold,
    ModKind::Min,
    ModKind::Max,
    ModKind::And,
    ModKind::Or,
    ModKind::Xor,
    ModKind::Switch,
];

/// The family a module kind is counted in by φ (`n_<family>`), which is all
/// the model can tell of it: a drive is a fold, a distortion, a bitcrush or a
/// ring mod. `mix` is its own family and no coordinate of φ
/// (`auracle-features/src/structural.rs`; `families_are_phis` holds the two
/// together).
pub fn node_family(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Vco => "vco",
        NodeKind::Supersaw => "supersaw",
        NodeKind::Noise => "noise",
        NodeKind::Wavetable => "wavetable",
        NodeKind::Pluck => "pluck",
        NodeKind::Formant => "formant",
        NodeKind::Silence => "silence",
        NodeKind::Mix => "mix",
        NodeKind::Filter | NodeKind::Eq | NodeKind::Vocoder => "filter",
        NodeKind::Fold | NodeKind::Distortion | NodeKind::Bitcrush | NodeKind::RingMod => "drive",
        NodeKind::Delay | NodeKind::Granular | NodeKind::Shift => "time",
        NodeKind::Chorus
        | NodeKind::Phaser
        | NodeKind::Flanger
        | NodeKind::Tremolo
        | NodeKind::Vibrato => "mod_fx",
        NodeKind::Reverb => "reverb",
        NodeKind::Comp | NodeKind::Duck | NodeKind::Gate => "dynamics",
    }
}

/// [`node_family`] for a modulator.
pub fn mod_family(kind: ModKind) -> &'static str {
    match kind {
        ModKind::None => "none",
        ModKind::Lfo => "lfo",
        ModKind::Env => "env",
        ModKind::Rand | ModKind::Steps => "rand",
        ModKind::Follow => "follow",
        ModKind::Quantize | ModKind::Slew | ModKind::Rectify | ModKind::Hold => "mod_shape",
        ModKind::Euclid
        | ModKind::Min
        | ModKind::Max
        | ModKind::And
        | ModKind::Or
        | ModKind::Xor
        | ModKind::Switch => "mod_logic",
    }
}

fn name_of<T: Serialize>(k: &T) -> String {
    serde_json::to_value(k)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// One module the model could guess, and the tree with it placed.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct GuessCandidate {
    /// The edit that places it: what TRY applies.
    pub op: StructOp,
    /// The module's kind, by its serde name (`filter`, `lfo`).
    pub kind: String,
    /// Its family ([`node_family`], [`mod_family`]): what a skip covers.
    pub family: String,
    /// Where it goes, in terms that outlive other edits: [`OUTPUT_SOCKET`],
    /// `mod:<uid>` (the slot of the module with that uid), `in:<uid>` (the
    /// empty socket with that uid) or `wire:<uid>` (the wire above the
    /// module with that uid, a deeper socket asked for by key). A node not
    /// yet given a uid is named by its key instead (`mod:k<key>`).
    pub socket: String,
    /// The render memo's key of `tree` under the engine's phrase.
    pub key: String,
    /// The patch with the module placed.
    #[serde(skip)]
    pub tree: PatchTree,
}

/// A skip: that family kept away from that socket, for one patch.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct GuessSkip {
    /// [`GuessCandidate::socket`].
    pub socket: String,
    /// [`GuessCandidate::family`].
    pub family: String,
}

impl GuessCandidate {
    /// The skip that covers this candidate.
    pub fn skip(&self) -> GuessSkip {
        GuessSkip {
            socket: self.socket.clone(),
            family: self.family.clone(),
        }
    }
}

/// Why there is no guess to make.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GuessRefusal {
    /// No posterior yet: nothing before the warm start's fit.
    NoTaste,
    /// Nothing more fits: every placement breaks a ceiling, or takes a
    /// module away.
    Full,
    /// The patch itself has not been measured; [`Engine::guess_plan`] owes
    /// its render first.
    Unmeasured,
}

impl GuessRefusal {
    /// The code the app reads.
    pub fn code(self) -> &'static str {
        match self {
            GuessRefusal::NoTaste => "no_taste",
            GuessRefusal::Full => "full",
            GuessRefusal::Unmeasured => "unmeasured",
        }
    }
}

/// One render a guess owes.
#[derive(Clone, Debug, PartialEq)]
pub struct GuessJob {
    /// The memo's key ([`render_key`] under the engine's phrase).
    pub key: String,
    /// What to render.
    pub tree: PatchTree,
}

/// What a guess still owes, in the order to render it.
#[derive(Clone, Debug, PartialEq)]
pub struct GuessPlan {
    /// Renders not yet in the memo: the patch alone, when it is unmeasured
    /// (the order depends on it), else the planned candidates not yet
    /// rendered, likeliest first.
    pub jobs: Vec<GuessJob>,
    /// Candidates after skips.
    pub total: usize,
    /// How many of them the guess ranks: `total`, or the limit asked for.
    pub planned: usize,
    /// Candidates a skip keeps out.
    pub skipped: usize,
}

/// Why a guess leads: the largest part of its gain under its style.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct GuessWhy {
    /// The style most responsible for the guess's sound (an aligned lens
    /// index, as `belief`'s `style`).
    pub style: usize,
    /// One of PERFORM's six controls (`Bright`), when a direction carries
    /// the part; `None` for a structural coordinate.
    pub control: Option<&'static str>,
    /// The control's end word the guess moves toward (`dark`).
    pub word: Option<&'static str>,
    /// The structural coordinate (`n_drive`), when one carries the part.
    pub coordinate: Option<&'static str>,
    /// How far the guess moves along it, in standardized units: positive
    /// toward the control's high word, or more of the coordinate.
    pub moved: f64,
    /// That part of the gain, `θ · Δz` over its coordinates. Positive: your
    /// picks lean the way it moves.
    pub part: f64,
}

/// A ranked guess.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Guess {
    /// The edit that places it.
    pub op: StructOp,
    /// [`GuessCandidate::kind`].
    pub kind: String,
    /// [`GuessCandidate::family`].
    pub family: String,
    /// [`GuessCandidate::socket`].
    pub socket: String,
    /// What it is ranked by: `mean − sd` of the gain.
    pub lcb: f64,
    /// The gain's posterior mean, `u(cand) − u(patch)`.
    pub mean: f64,
    /// Its posterior standard deviation.
    pub sd: f64,
    /// The pick forecast: how likely you'd pick the patch with it over the
    /// patch (or over the pool's average, `against` = `pool`). The app shows
    /// it with its sure word.
    pub p: f64,
    /// Why, when some part of the gain leans your way; `None` when none does.
    pub why: Option<GuessWhy>,
}

/// The guesses for a patch, best first.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct GuessRanking {
    /// Rendered candidates that vet, by the lower bound, best first; ties in
    /// the candidates' order.
    pub guesses: Vec<Guess>,
    /// How many of the planned candidates are rendered (vetted or not).
    pub rendered: usize,
    /// How many are planned ([`GuessPlan::planned`]).
    pub planned: usize,
    /// Candidates after skips.
    pub total: usize,
    /// Candidates a skip keeps out.
    pub skipped: usize,
    /// `patch`: gains are over the patch; `pool`: the patch does not sound,
    /// and gains are over the pool's average sound.
    pub against: &'static str,
    /// The observations the posterior holds: a refit moves it, and a guess
    /// from before one is stale.
    pub observations: usize,
}

fn keys<'a>(n: &'a AudioNode, key: String, out: &mut Vec<(String, &'a AudioNode)>) {
    out.push((key.clone(), n));
    for (i, c) in n.children().into_iter().enumerate() {
        keys(c, format!("{key}/{i}"), out);
    }
}

fn sounds(n: &AudioNode) -> bool {
    match n {
        AudioNode::Silence { .. } => false,
        n if n.children().is_empty() => true,
        n => n.children().into_iter().any(sounds),
    }
}

/// Every module count φ_struct keeps raw, empty sockets aside: a candidate
/// that lowers one took a module away.
fn counts(s: &StructFeatures) -> Vec<(String, f64)> {
    let Ok(serde_json::Value::Object(m)) = serde_json::to_value(s) else {
        return Vec::new();
    };
    m.into_iter()
        .filter(|(k, _)| k.starts_with("n_") && k != "n_silence")
        .filter_map(|(k, v)| v.as_f64().map(|v| (k, v)))
        .collect()
}

fn socket_of(prefix: &str, n: &AudioNode, key: &str) -> String {
    let uid = n.uid();
    if uid.is_new() {
        format!("{prefix}:k{key}")
    } else {
        format!("{prefix}:{}", uid.0)
    }
}

/// The modules the model could guess for `tree`, each placed and validated:
/// at the output, on the root's slot and in every empty socket (`at` =
/// `None`), or at the module with key `at` (its wire, its slot, and itself if
/// it is an empty socket). Each passes `validate_tree` and adds a module
/// without taking any away. A patch that does not sound takes sources only.
/// In a fixed order: by key, shallower first, then the kinds' order.
/// `key` is filled in by [`Engine`], which knows the phrase.
pub fn guess_candidates(tree: &PatchTree, at: Option<&str>) -> Vec<GuessCandidate> {
    let base = counts(&struct_features(tree));
    let base_sum: f64 = base.iter().map(|x| x.1).sum();
    let mut nodes = Vec::new();
    keys(&tree.root, "node".into(), &mut nodes);
    let empty = !sounds(&tree.root);
    let mut ops: Vec<(StructOp, String, String, String)> = Vec::new();
    for (key, n) in &nodes {
        let here = at.is_none_or(|a| a == key);
        if !here {
            continue;
        }
        if matches!(n, AudioNode::Silence { .. }) {
            for k in NodeKind::ALL
                .iter()
                .filter(|k| k.is_source() && **k != NodeKind::Silence)
            {
                ops.push((
                    StructOp::Replace {
                        key: key.clone(),
                        kind: *k,
                    },
                    name_of(k),
                    node_family(*k).into(),
                    socket_of("in", n, key),
                ));
            }
        }
        // The output's own placements are on the root; a deeper socket's
        // only when asked for.
        if empty || (at.is_none() && key != "node") {
            continue;
        }
        let wire = if key == "node" {
            OUTPUT_SOCKET.to_string()
        } else {
            socket_of("wire", n, key)
        };
        for k in NodeKind::ALL.iter().filter(|k| !k.is_source()) {
            ops.push((
                StructOp::Insert {
                    key: key.clone(),
                    kind: *k,
                },
                name_of(k),
                node_family(*k).into(),
                wire.clone(),
            ));
        }
        if let Some(m) = n.modulation() {
            let kinds: &[ModKind] = if matches!(m, ModNode::None) {
                &MOD_SOURCES
            } else {
                &MOD_SHAPERS
            };
            for k in kinds {
                ops.push((
                    StructOp::SetMod {
                        key: key.clone(),
                        kind: *k,
                    },
                    name_of(k),
                    mod_family(*k).into(),
                    socket_of("mod", n, key),
                ));
            }
        }
    }
    let mut out = Vec::new();
    for (op, kind, family, socket) in ops {
        let Ok(t) = apply_struct_op(tree, &op) else {
            continue;
        };
        if validate_tree(&t).is_err() {
            continue;
        }
        let c = counts(&struct_features(&t));
        let keeps = c
            .iter()
            .zip(&base)
            .all(|((k, x), (kb, y))| k == kb && x >= y);
        if !keeps || c.iter().map(|x| x.1).sum::<f64>() <= base_sum {
            continue;
        }
        out.push(GuessCandidate {
            op,
            kind,
            family,
            socket,
            key: String::new(),
            tree: t,
        });
    }
    // Shallower sockets first, a stable order ties break in.
    out.sort_by_key(|c| op_key(&c.op).len());
    out
}

fn op_key(op: &StructOp) -> &str {
    match op {
        StructOp::Replace { key, .. }
        | StructOp::Insert { key, .. }
        | StructOp::SetMod { key, .. } => key,
        _ => "",
    }
}

/// Where the patch stands for a guess.
enum PatchZ {
    /// Measured: its standardized φ.
    Known(Vec<f64>),
    /// It does not sound, or it does not vet: the pool's average sound.
    Pool,
    /// It sounds and has not been rendered: this job first.
    Owed(GuessJob),
}

/// The candidates in render order, with what the ranking needs.
struct Ordered {
    cands: Vec<GuessCandidate>,
    total: usize,
    skipped: usize,
    patch: PatchZ,
}

impl Engine {
    /// The candidates after skips, keyed under this engine's phrase and in
    /// the structural design's order, and the patch's standing.
    fn guess_order(
        &self,
        tree: &PatchTree,
        at: Option<&str>,
        skips: &[GuessSkip],
        failed: &HashSet<String>,
    ) -> Result<Ordered, GuessRefusal> {
        let (Some(post), Some(sz)) = (self.posterior.as_deref(), self.standardizer.as_deref())
        else {
            return Err(GuessRefusal::NoTaste);
        };
        let phrase = &self.cfg.phrase;
        let all = guess_candidates(tree, at);
        if all.is_empty() {
            return Err(GuessRefusal::Full);
        }
        let skip: HashSet<&GuessSkip> = skips.iter().collect();
        let n_all = all.len();
        let mut cands: Vec<GuessCandidate> = all
            .into_iter()
            .filter(|c| !skip.contains(&c.skip()))
            .map(|mut c| {
                c.key = render_key(&c.tree, phrase);
                c
            })
            .collect();
        let skipped = n_all - cands.len();
        let patch_key = render_key(tree, phrase);
        let n_audio = AudioFeatures::NAMES.len();
        // The structural design's score reads the patch's audio φ beside the
        // candidate's structure: the pool's mean for a patch with none.
        let mut audio: Vec<f64> = sz.mean[..n_audio].to_vec();
        let patch = if !sounds(&tree.root) || failed.contains(&patch_key) {
            PatchZ::Pool
        } else {
            match self.memo().get(&patch_key) {
                Some(hit) => {
                    let phi = hit.features.phi();
                    audio = phi[..n_audio].to_vec();
                    PatchZ::Known(sz.transform(&phi))
                }
                None => PatchZ::Owed(GuessJob {
                    key: patch_key,
                    tree: tree.clone(),
                }),
            }
        };
        let mut scored: Vec<(f64, usize, GuessCandidate)> = cands
            .drain(..)
            .enumerate()
            .map(|(i, c)| {
                let mut raw = audio.clone();
                raw.extend(struct_features(&c.tree).to_vec());
                (post.utility_mix(&sz.transform(&raw)).0, i, c)
            })
            .collect();
        scored.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
        let cands: Vec<GuessCandidate> = scored.into_iter().map(|x| x.2).collect();
        Ok(Ordered {
            total: cands.len(),
            cands,
            skipped,
            patch,
        })
    }

    /// What a guess for `tree` still owes: the renders not yet in the memo,
    /// in the order to make them. Renders nothing.
    ///
    /// `at` asks for one deeper socket by its module's key instead of the
    /// output's; `skips` are this patch's ([`GuessMemory::skips`]); `failed`
    /// the memo keys already known not to vet (the memo keeps only
    /// successes); `limit` how many candidates to plan, in order (0 for all;
    /// [`GUESS_FLOOR`] with no farm). A caller renders the jobs (the farm's
    /// `farm_render` and `memo_absorb`, or `memo_render` one per turn), asks
    /// again until no job is left, then ranks ([`Self::guess_rank`]) with
    /// the same arguments. While the patch itself is unmeasured it is the
    /// only job: the order depends on it.
    pub fn guess_plan(
        &self,
        tree: &PatchTree,
        at: Option<&str>,
        skips: &[GuessSkip],
        failed: &HashSet<String>,
        limit: usize,
    ) -> Result<GuessPlan, GuessRefusal> {
        let o = self.guess_order(tree, at, skips, failed)?;
        let planned = if limit == 0 {
            o.total
        } else {
            limit.min(o.total)
        };
        let jobs = match o.patch {
            PatchZ::Owed(job) => vec![job],
            _ => o
                .cands
                .into_iter()
                .take(planned)
                .filter(|c| !failed.contains(&c.key) && self.memo().get(&c.key).is_none())
                .map(|c| GuessJob {
                    key: c.key,
                    tree: c.tree,
                })
                .collect(),
        };
        Ok(GuessPlan {
            jobs,
            total: o.total,
            planned,
            skipped: o.skipped,
        })
    }

    /// The guesses for `tree` from the renders the memo holds, best first by
    /// the lower bound of the gain. Renders nothing; the same arguments as
    /// [`Self::guess_plan`]. A planned candidate the memo does not hold is
    /// not ranked (`rendered` says how many are), and one known not to vet
    /// is left out.
    pub fn guess_rank(
        &self,
        tree: &PatchTree,
        at: Option<&str>,
        skips: &[GuessSkip],
        failed: &HashSet<String>,
        limit: usize,
    ) -> Result<GuessRanking, GuessRefusal> {
        let o = self.guess_order(tree, at, skips, failed)?;
        let (Some(post), Some(sz)) = (self.posterior.as_deref(), self.standardizer.as_deref())
        else {
            return Err(GuessRefusal::NoTaste);
        };
        let (zp, against) = match o.patch {
            PatchZ::Owed(_) => return Err(GuessRefusal::Unmeasured),
            PatchZ::Known(z) => (z, "patch"),
            PatchZ::Pool => (vec![0.0; sz.mean.len()], "pool"),
        };
        let planned = if limit == 0 {
            o.total
        } else {
            limit.min(o.total)
        };
        let up: Vec<f64> = post.samples.iter().map(|s| s.utility_mix(&zp)).collect();
        let mut rendered = 0;
        let mut ranked: Vec<(usize, Guess)> = Vec::new();
        for (i, c) in o.cands.into_iter().take(planned).enumerate() {
            if failed.contains(&c.key) {
                rendered += 1;
                continue;
            }
            let Some(hit) = self.memo().get(&c.key) else {
                continue;
            };
            rendered += 1;
            let z = sz.transform(&hit.features.phi());
            let (mut mean, mut sq) = (0.0, 0.0);
            for (s, (draw, u0)) in post.samples.iter().zip(&up).enumerate() {
                let g = draw.utility_mix(&z) - u0;
                let w = post.weight(s);
                mean += w * g;
                sq += w * g * g;
            }
            let sd = (sq - mean * mean).max(0.0).sqrt();
            ranked.push((
                i,
                Guess {
                    why: guess_why(post, &z, &zp),
                    p: post.prob_prefers(&z, &zp),
                    lcb: mean - sd,
                    mean,
                    sd,
                    op: c.op,
                    kind: c.kind,
                    family: c.family,
                    socket: c.socket,
                },
            ));
        }
        ranked.sort_by(|a, b| b.1.lcb.total_cmp(&a.1.lcb).then(a.0.cmp(&b.0)));
        Ok(GuessRanking {
            guesses: ranked.into_iter().map(|x| x.1).collect(),
            rendered,
            planned,
            total: o.total,
            skipped: o.skipped,
            against,
            observations: self.log.len(),
        })
    }
}

/// The largest part of the gain `θ · (z − zp)` under the style most
/// responsible for `z`: one of PERFORM's six directions (over the audio
/// coordinates it spans) or one structural coordinate. `None` when no part
/// is positive, so nothing leans your way.
fn guess_why(post: &auracle_taste::TastePosterior, z: &[f64], zp: &[f64]) -> Option<GuessWhy> {
    let names: Vec<String> = Features::phi_names()
        .into_iter()
        .map(String::from)
        .collect();
    let dz: Vec<f64> = z.iter().zip(zp).map(|(a, b)| a - b).collect();
    let resp = post.responsibilities(z);
    let style = (0..resp.len())
        .max_by(|&i, &j| resp[i].total_cmp(&resp[j]).then(j.cmp(&i)))
        .unwrap_or(0);
    let theta = post.theta_mean(style);
    let n_audio = AudioFeatures::NAMES.len();
    let mut best: Option<GuessWhy> = None;
    let mut consider = |w: GuessWhy| {
        if w.part > 0.0 && best.as_ref().is_none_or(|b| w.part > b.part) {
            best = Some(w);
        }
    };
    for ctl in &CONTROLS {
        let e = direction(ctl, &names);
        let on: Vec<usize> = (0..n_audio).filter(|&j| e[j] != 0.0).collect();
        let moved: f64 = on.iter().map(|&j| e[j] * dz[j]).sum();
        consider(GuessWhy {
            style,
            control: Some(ctl.name),
            word: Some(if moved >= 0.0 { ctl.high } else { ctl.low }),
            coordinate: None,
            moved,
            part: on.iter().map(|&j| theta[j] * dz[j]).sum(),
        });
    }
    for (j, name) in StructFeatures::NAMES.iter().enumerate() {
        let k = n_audio + j;
        if dz[k] != 0.0 {
            consider(GuessWhy {
                style,
                control: None,
                word: None,
                coordinate: Some(name),
                moved: dz[k],
                part: theta[k] * dz[k],
            });
        }
    }
    best
}

/// A guess taken on a patch: what undoing it looks like.
#[derive(Clone, Debug)]
struct Taken {
    skip: GuessSkip,
    /// The patch before the guess went in.
    before: PatchTree,
}

/// What the guesses remember outside the ranking, per patch: the skips, and
/// the guess last taken, so that undoing it counts as a skip.
///
/// The ranking is a pure function of the tree, so it cannot remember a skip
/// itself; and the tree a taken guess is undone to ranks it first again.
/// Keyed by patch: the pool id the patch in hand was opened from. Not
/// persisted (a reload starts with no skips), and not evidence.
#[derive(Clone, Debug, Default)]
pub struct GuessMemory {
    skips: HashMap<u64, Vec<GuessSkip>>,
    taken: HashMap<u64, Taken>,
}

impl GuessMemory {
    /// The skips of `patch`.
    pub fn skips(&self, patch: u64) -> &[GuessSkip] {
        self.skips.get(&patch).map_or(&[], Vec::as_slice)
    }

    /// Keep `skip`'s family away from its socket on `patch`. False if it
    /// already was.
    pub fn skip(&mut self, patch: u64, skip: GuessSkip) -> bool {
        let v = self.skips.entry(patch).or_default();
        if v.contains(&skip) {
            return false;
        }
        v.push(skip);
        true
    }

    /// A guess was taken on `patch`, which was `before` without it.
    pub fn took(&mut self, patch: u64, skip: GuessSkip, before: PatchTree) {
        self.taken.insert(patch, Taken { skip, before });
    }

    /// The patch in hand is now `tree`. If that is the patch as it was
    /// before its last taken guess (an undo, or the module taken out
    /// again), the guess counts as skipped: returns the skip it recorded.
    /// Compared by content, uids aside, as patches are everywhere.
    pub fn observe(&mut self, patch: u64, tree: &PatchTree) -> Option<GuessSkip> {
        let back = self.taken.get(&patch).is_some_and(|t| t.before == *tree);
        if !back {
            return None;
        }
        let t = self.taken.remove(&patch)?;
        self.skip(patch, t.skip.clone());
        Some(t.skip)
    }
}

#[cfg(test)]
mod tests;
