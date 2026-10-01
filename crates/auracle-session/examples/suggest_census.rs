//! How could the model suggest the next module in an empty or growing patch,
//! and what would each way cost? The measurement behind the design note
//! `docs/notes/suggest-2026-10/README.md` (RFC-006, Open question 2).
//!
//! Nothing here changes the engine. Every design is built from what exists:
//! the grammar's structural edits (`apply_struct_op`), φ (`featurize_memo`,
//! `struct_features`), the posterior's draws, and the walk's tilted prior
//! (`Engine::walk_context`) and offer (`Engine::offer`).
//!
//! ## The candidates
//!
//! For a patch, every structural edit that only adds: a processor inserted
//! into every wire (`StructOp::Insert` at every node key, for every
//! non-source kind), a source in every empty socket (`Replace` of a `Silence`
//! leaf), a modulator in every empty mod slot and a shaper on every filled
//! one (`SetMod`). Each is kept only if it passes `validate_tree` and every
//! module of the patch survives it. Every `Insert` keeps the chain it lands
//! on now; the note's `census.txt` predates that, when a vocoder's insert
//! dropped the chain and so never qualified. A patch with no sounding
//! source takes sources only: a processor over an empty socket is silent.
//!
//! ## The designs
//!
//! - **a, structural:** φ' is the patch's own audio φ (the pool's mean for a
//!   patch that does not sound) beside the candidate's structural φ. Ranked
//!   by the posterior mean of the utility. No render.
//! - **b, render and score:** the candidate is rendered on the phrase and
//!   ranked by a criterion over the posterior's draws of its gain over the
//!   patch (an empty patch is compared with the pool's average sound, z = 0):
//!   `mean`, `ucb` (mean + sd), `lcb` (mean − sd), or `p`, the forecast that
//!   you'd pick it over the patch (`TastePosterior::prob_prefers`). `b-full`
//!   renders every candidate; `b-out` only the ones at the output (`node`),
//!   in the empty sockets and in the root's mod slot.
//! - **c-tilt, the walk's proposal:** the kind's probability under the prior
//!   the walks use, tilted by taste (`walk_context().prior`). No render.
//!   `catalog` is the same with the untilted prior: a suggestion that ignores
//!   taste.
//! - **c-walk, the offer's walk:** `Engine::offer` (`OFFER_STEPS` steps) from
//!   the patch, `--walks` times; what its children added (timed only).
//! - **d, hybrid:** a's top `m`, rendered and re-ranked by a b criterion.
//!   `dout` is the same over b-out's candidates only: what a render crew
//!   that runs out of time leaves if it renders them in a's order.
//!
//! ## The taste profiles
//!
//! The app's pool (`POOL` draws from `SEED`), then a teacher:
//!
//! - `dark` and `bright` run the warm start (nine presets, one per family;
//!   the three you'd reach for beat the other six: 18 picks, one lens),
//!   picking the three darkest or the three brightest by centroid.
//! - `--listeners` synthetic listeners (`offer_census`'s, then random ones)
//!   run the same warm start, picking their own three, and are scored there
//!   (`warm`); then each teaches `TEACH_MORE` more random pairs, refit every
//!   six picks as the app does, and is scored again (`taught`, four lenses).
//!   Their true utility grades every design.
//!
//! cargo run -p auracle-session --example suggest_census --release -- \
//!     [--threads 8] [--walks 3] [--listeners 7] [--say "b-out lcb"] [--ops FILE]
//!
//! Costs are this thread's CPU time, so a busy machine does not inflate them;
//! the wall clock's ratio to it is printed beside them. `--say` names the
//! design whose one line is printed. `--ops FILE` writes each patch and its
//! b-out edits as JSON, for the wasm twin
//! (`crates/auracle-wasm/examples/suggest_cost.mjs`).
use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use auracle_features::{
    featurize_memo, struct_features, AudioFeatures, Features, RenderMemo, StructFeatures,
};
use auracle_grammar::{
    apply_struct_op, preset_bank, validate_tree, AudioNode, ModKind, ModNode, NodeKind,
    PatchGrammarPrior, PatchTree, StructOp,
};
use auracle_session::perform::{direction, CONTROLS};
use auracle_session::{Engine, SessionConfig};
use auracle_taste::{SyntheticUser, TastePosterior};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

/// The app's pool size (`WasmEngine::new(seed, 40)` in `main.js`'s boot).
const POOL: usize = 40;
/// `shipped::boot`'s seed: the session PERFORM's wirings are measured in.
const SEED: u64 = 20_260_928;
/// PERFORM's offer walk length.
const OFFER_STEPS: usize = 20;
/// Pairs a listener teaches after the warm start: 18 + 60 = 78 picks, so
/// K = 1 + 78/20 = 4 lenses.
const TEACH_MORE: usize = 60;
/// The app refits every sixth pick (`FIT_EVERY` in `main.js`).
const FIT_EVERY: usize = 6;
/// Shortlist sizes for the hybrid's recall.
const SHORTLIST: [usize; 5] = [1, 2, 4, 8, 16];
/// The warm start's nine: the first preset of each family, then the second
/// keys and the second pad (the app fills the last two at random).
const WARM: [&str; 9] = [
    "First Bass",
    "Folded Lead",
    "Pluck",
    "Cathedral",
    "Noise Wash",
    "Flint",
    "Two Minds",
    "Bell Jar",
    "Glass Pad",
];
/// The patches suggestions are made for: the second preset of each family.
const PATCHES: [&str; 7] = [
    "Sub & Sparkle",
    "Hornet",
    "Tine",
    "Detune Dream",
    "Dub Echo",
    "Deadfall",
    "Ceiling",
];
/// The criteria b and d rank by.
const CRITERIA: [&str; 4] = ["mean", "ucb", "lcb", "p"];

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Sort {
    Source,
    Processor,
    Modulator,
}

struct Cand {
    op: StructOp,
    /// The module kind, as the rack names it (`filter`, `lfo`).
    kind: String,
    sort: Sort,
    key: String,
    tree: PatchTree,
    sf: StructFeatures,
}

impl Cand {
    fn label(&self) -> String {
        match self.sort {
            Sort::Modulator => format!("{} on {}", self.kind, self.key),
            Sort::Source => format!("{} in {}", self.kind, self.key),
            Sort::Processor if self.key == "node" => format!("{} at the output", self.kind),
            Sort::Processor => format!("{} at {}", self.kind, self.key),
        }
    }
    /// Shown by b-out: at the output, in an empty socket, or on the root.
    fn at_output(&self) -> bool {
        self.key == "node" || self.sort == Sort::Source
    }
}

fn name_of<T: serde::Serialize>(k: &T) -> String {
    serde_json::to_value(k)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn keys<'a>(n: &'a AudioNode, key: String, out: &mut Vec<(String, &'a AudioNode)>) {
    for (i, c) in n.children().into_iter().enumerate() {
        keys(c, format!("{key}/{i}"), out);
    }
    out.push((key, n));
}

/// Every raw module count except holes: a candidate that lowers any of them
/// took a module away.
fn counts(s: &StructFeatures) -> [f64; 42] {
    [
        s.n_vco,
        s.n_supersaw,
        s.n_noise,
        s.n_wavetable,
        s.n_pluck,
        s.n_formant,
        s.n_mix,
        s.n_ringmod,
        s.n_filter,
        s.n_eq,
        s.n_fold,
        s.n_distortion,
        s.n_bitcrush,
        s.n_delay,
        s.n_granular,
        s.n_shift,
        s.n_comp,
        s.n_duck,
        s.n_gate,
        s.n_vocoder,
        s.n_chorus,
        s.n_phaser,
        s.n_flanger,
        s.n_tremolo,
        s.n_vibrato,
        s.n_reverb,
        s.n_lfo,
        s.n_env,
        s.n_rand,
        s.n_follow,
        s.n_euclid,
        s.n_steps,
        s.n_quantize,
        s.n_slew,
        s.n_rectify,
        s.n_hold,
        s.n_min,
        s.n_max,
        s.n_and,
        s.n_or,
        s.n_xor,
        s.n_switch,
    ]
}

/// Names for [`counts`], in its order.
const COUNT_NAMES: [&str; 42] = [
    "vco",
    "supersaw",
    "noise",
    "wavetable",
    "pluck",
    "formant",
    "mix",
    "ringmod",
    "filter",
    "eq",
    "fold",
    "distortion",
    "bitcrush",
    "delay",
    "granular",
    "shift",
    "comp",
    "duck",
    "gate",
    "vocoder",
    "chorus",
    "phaser",
    "flanger",
    "tremolo",
    "vibrato",
    "reverb",
    "lfo",
    "env",
    "rand",
    "follow",
    "euclid",
    "steps",
    "quantize",
    "slew",
    "rectify",
    "hold",
    "min",
    "max",
    "and",
    "or",
    "xor",
    "switch",
];

fn sounds(n: &AudioNode) -> bool {
    match n {
        AudioNode::Silence { .. } => false,
        n if n.children().is_empty() => true,
        n => n.children().into_iter().any(sounds),
    }
}

const MOD_SOURCES: [ModKind; 6] = [
    ModKind::Lfo,
    ModKind::Env,
    ModKind::Rand,
    ModKind::Follow,
    ModKind::Euclid,
    ModKind::Steps,
];
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

/// Every legal edit that adds a module and removes none, and how many edits
/// were tried.
fn candidates(tree: &PatchTree) -> (Vec<Cand>, usize) {
    let base = counts(&struct_features(tree));
    let base_sum: f64 = base.iter().sum();
    let mut nodes = Vec::new();
    keys(&tree.root, "node".into(), &mut nodes);
    let empty = !sounds(&tree.root);
    let mut ops: Vec<(StructOp, String, Sort, String)> = Vec::new();
    for (key, n) in &nodes {
        if matches!(n, AudioNode::Silence { .. }) {
            // Not AUDIO IN either: the input is the player's to plug in, not a
            // timbre the model could suggest.
            for k in NodeKind::ALL
                .iter()
                .filter(|k| k.is_source() && !matches!(**k, NodeKind::Silence | NodeKind::AudioIn))
            {
                ops.push((
                    StructOp::Replace {
                        key: key.clone(),
                        kind: *k,
                    },
                    name_of(k),
                    Sort::Source,
                    key.clone(),
                ));
            }
        }
        if empty {
            continue;
        }
        for k in NodeKind::ALL.iter().filter(|k| !k.is_source()) {
            ops.push((
                StructOp::Insert {
                    key: key.clone(),
                    kind: *k,
                },
                name_of(k),
                Sort::Processor,
                key.clone(),
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
                    Sort::Modulator,
                    key.clone(),
                ));
            }
        }
    }
    let tried = ops.len();
    let mut out = Vec::new();
    for (op, kind, sort, key) in ops {
        let Ok(t) = apply_struct_op(tree, &op) else {
            continue;
        };
        if validate_tree(&t).is_err() {
            continue;
        }
        let sf = struct_features(&t);
        let c = counts(&sf);
        let keeps = c.iter().zip(&base).all(|(x, y)| x >= y);
        if !keeps || c.iter().sum::<f64>() <= base_sum {
            continue;
        }
        out.push(Cand {
            op,
            kind,
            sort,
            key,
            tree: t,
            sf,
        });
    }
    // The output first, then shallower keys: the order ties break in.
    out.sort_by_key(|c| (c.key.len(), c.key.clone()));
    (out, tried)
}

/// What a walk's child added and removed, by module kind.
fn diff(before: &PatchTree, after: &PatchTree) -> (Vec<&'static str>, usize) {
    let (a, b) = (
        counts(&struct_features(before)),
        counts(&struct_features(after)),
    );
    let added = COUNT_NAMES
        .iter()
        .zip(a.iter().zip(&b))
        .filter(|(_, (x, y))| y > x)
        .map(|(n, _)| *n)
        .collect();
    let removed = a.iter().zip(&b).filter(|(x, y)| y < x).count();
    (added, removed)
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

struct Profile {
    name: String,
    engine: Engine,
    truth: Option<SyntheticUser>,
}

fn boot(memo: &RenderMemo) -> Engine {
    let cfg = SessionConfig {
        pool_size: POOL,
        ..Default::default()
    };
    let mut e = Engine::new(PatchGrammarPrior::default(), cfg);
    e.set_memo(memo.clone());
    e.begin_session();
    e.fill_pool(&mut StdRng::seed_from_u64(SEED));
    e.restandardize_if_untaught();
    e
}

/// The warm start as the worker runs it (`warm_start` in `worker.js`): the
/// three picks go in first and saved, then each of the other six, and each
/// pick beats it. Then one fit. `pick` chooses three of the nine from their
/// features, under the boot's standardizer.
fn warm_start(
    memo: &RenderMemo,
    pick: impl Fn(&Engine, &[Features]) -> Vec<usize>,
) -> (Engine, Vec<&'static str>) {
    let mut e = boot(memo);
    let bank = preset_bank();
    let nine: Vec<_> = WARM
        .iter()
        .map(|n| bank.iter().find(|p| p.name == *n).expect("preset"))
        .collect();
    let feats: Vec<Features> = nine
        .iter()
        .map(|p| {
            featurize_memo(&p.tree, &e.cfg.phrase, memo, false)
                .expect("vets")
                .0
                .features
        })
        .collect();
    let picked = pick(&e, &feats);
    let mut ids = Vec::new();
    for &i in &picked {
        let id = e
            .insert_preset(nine[i].tree.clone(), nine[i].name)
            .expect("insert");
        e.set_pinned(id, true);
        ids.push(id);
    }
    for (i, p) in nine.iter().enumerate() {
        if picked.contains(&i) {
            continue;
        }
        let Some(id) = e.insert_preset(p.tree.clone(), p.name) else {
            continue;
        };
        for &w in &ids {
            if let (Some(a), Some(b)) = (e.find(w), e.find(id)) {
                e.record_duel(a, b, true);
            }
        }
    }
    e.fit_posterior(&mut StdRng::seed_from_u64(SEED ^ 0x51));
    let names = picked.iter().map(|&i| nine[i].name).collect();
    (e, names)
}

fn by_centroid(darkest: bool) -> impl Fn(&Engine, &[Features]) -> Vec<usize> {
    move |_, feats| {
        let mut v: Vec<(f64, usize)> = feats
            .iter()
            .enumerate()
            .map(|(i, f)| (f.audio.centroid_mean, i))
            .collect();
        v.sort_by(|a, b| a.0.total_cmp(&b.0));
        if !darkest {
            v.reverse();
        }
        v[..3].iter().map(|x| x.1).collect()
    }
}

fn by_truth(user: &SyntheticUser) -> impl Fn(&Engine, &[Features]) -> Vec<usize> + '_ {
    move |e, feats| {
        let sz = e.standardizer().expect("standardizer");
        let mut v: Vec<(f64, usize)> = feats
            .iter()
            .enumerate()
            .map(|(i, f)| (user.utility(&sz.transform(&f.phi())), i))
            .collect();
        v.sort_by(|a, b| b.0.total_cmp(&a.0));
        v[..3].iter().map(|x| x.1).collect()
    }
}

/// More random pairs from the pool, answered by the listener, refit every
/// sixth pick, then once more.
fn teach(e: &mut Engine, user: &SyntheticUser, n: usize, seed: u64) {
    let mut rng = StdRng::seed_from_u64(seed);
    for _ in 0..n {
        let Some((a, b)) = e.next_duel(&mut rng) else {
            break;
        };
        let chose_a = user.duel(&mut rng, &e.pool[a].phi_std, &e.pool[b].phi_std);
        e.record_duel(a, b, chose_a);
        if e.log.len().is_multiple_of(FIT_EVERY) {
            e.fit_posterior(&mut rng);
        }
    }
    e.fit_posterior(&mut rng);
}

fn theta_of(pairs: &[(&str, f64)]) -> Vec<f64> {
    let names = Features::phi_names();
    let mut theta = vec![0.0; names.len()];
    for (name, w) in pairs {
        if let Some(i) = names
            .iter()
            .position(|n| n.split(':').next() == Some(*name))
        {
            theta[i] = *w;
        }
    }
    theta
}

/// Listener 0 is `offer_census`'s: bright, snappy, full and far, no noise,
/// fond of filters. The rest are random: three audio qualities and two
/// structural ones, each liked or disliked.
fn listener_user(i: u64) -> SyntheticUser {
    let theta = if i == 0 {
        theta_of(&[
            ("centroid_mean", 2.0),
            ("flatness_mean", -1.5),
            ("attack_s", -1.5),
            ("bass_fraction", 1.0),
            ("n_filter", 0.8),
            ("tail_ratio", 0.6),
        ])
    } else {
        let audio = [
            "centroid_mean",
            "flatness_mean",
            "attack_s",
            "bass_fraction",
            "tail_ratio",
            "motion_mid",
            "held_centroid_std",
            "crest",
            "rms_std",
        ];
        let structural = [
            "n_filter",
            "n_drive",
            "n_time",
            "n_mod_fx",
            "n_reverb",
            "n_lfo",
            "n_supersaw",
            "n_pluck",
            "amp_attack",
            "amp_release",
        ];
        let mut rng = StdRng::seed_from_u64(SEED ^ (0xA11CE + i));
        let mut pairs: Vec<(&str, f64)> = Vec::new();
        let mut take = |from: &[&'static str], n: usize, lo: f64, hi: f64| {
            let mut left: Vec<&'static str> = from.to_vec();
            for _ in 0..n {
                let k = rng.gen_range(0..left.len());
                let sign = if rng.gen::<bool>() { 1.0 } else { -1.0 };
                pairs.push((left.remove(k), sign * rng.gen_range(lo..hi)));
            }
        };
        take(&audio, 3, 1.0, 2.0);
        take(&structural, 2, 0.5, 1.0);
        theta_of(&pairs)
    };
    SyntheticUser {
        theta,
        tau: 0.0,
        cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
    }
}

fn describe_user(u: &SyntheticUser) -> String {
    Features::phi_names()
        .iter()
        .zip(&u.theta)
        .filter(|(_, w)| **w != 0.0)
        .map(|(n, w)| format!("{} {w:+.1}", n.split(':').next().unwrap_or(n)))
        .collect::<Vec<_>>()
        .join(", ")
}

fn posterior(p: &Profile) -> &TastePosterior {
    p.engine.posterior.as_deref().expect("fitted")
}

fn wmean_sd(post: &TastePosterior, xs: &[f64]) -> (f64, f64) {
    let m: f64 = xs.iter().enumerate().map(|(i, x)| post.weight(i) * x).sum();
    let v: f64 = xs
        .iter()
        .enumerate()
        .map(|(i, x)| post.weight(i) * (x - m) * (x - m))
        .sum();
    (m, v.sqrt())
}

fn draws(post: &TastePosterior, z: &[f64]) -> Vec<f64> {
    post.samples.iter().map(|s| s.utility_mix(z)).collect()
}

/// The pool's spread of posterior-mean ratings: the unit regrets are in.
fn pool_spread(p: &Profile) -> f64 {
    let post = posterior(p);
    let us: Vec<f64> = p
        .engine
        .pool
        .iter()
        .filter(|c| !c.phi_std.is_empty())
        .map(|c| post.utility_mix(&c.phi_std).0)
        .collect();
    sd(&us)
}

fn truth_spread(p: &Profile) -> f64 {
    let Some(u) = &p.truth else { return 1.0 };
    let us: Vec<f64> = p
        .engine
        .pool
        .iter()
        .filter(|c| !c.phi_std.is_empty())
        .map(|c| u.utility(&c.phi_std))
        .collect();
    sd(&us)
}

fn sd(xs: &[f64]) -> f64 {
    let n = xs.len().max(1) as f64;
    let m = xs.iter().sum::<f64>() / n;
    (xs.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / n).sqrt()
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/// One candidate under one profile.
#[derive(Clone, Default)]
struct Score {
    /// a: posterior-mean utility of the patch's audio φ beside the
    /// candidate's structural φ.
    a: f64,
    /// b criteria over the rendered candidate's gain (`None`: it does not
    /// vet): mean, mean + sd, mean − sd, and the pick forecast.
    mean: Option<f64>,
    ucb: Option<f64>,
    lcb: Option<f64>,
    p: Option<f64>,
    /// The listener's true gain over the patch, and the probability it would
    /// pick the candidate over the patch.
    truth: Option<f64>,
    truth_p: Option<f64>,
    /// c-tilt: the kind's probability under the walks' tilted prior.
    tilt: f64,
    /// catalog: the same under the untilted prior.
    catalog: f64,
}

impl Score {
    fn crit(&self, c: &str) -> Option<f64> {
        match c {
            "mean" => self.mean,
            "ucb" => self.ucb,
            "lcb" => self.lcb,
            _ => self.p,
        }
    }
}

fn kind_weight(prior: &PatchGrammarPrior, c: &Cand) -> f64 {
    let norm = |w: &[f64], i: usize| w[i] / w.iter().sum::<f64>().max(1e-12);
    match (&c.op, c.sort) {
        (StructOp::Replace { kind, .. }, Sort::Source) => {
            // The prior's `#src` order (`prior.rs`).
            let order = [
                NodeKind::Vco,
                NodeKind::Supersaw,
                NodeKind::Noise,
                NodeKind::Wavetable,
                NodeKind::Pluck,
                NodeKind::Formant,
                NodeKind::Silence,
                NodeKind::AudioIn,
            ];
            let j = order.iter().position(|k| k == kind).unwrap_or(0);
            norm(&prior.source_weights, j)
        }
        (StructOp::Insert { kind, .. }, _) => {
            // The prior's `#op` order.
            let order = [
                NodeKind::Mix,
                NodeKind::Filter,
                NodeKind::Fold,
                NodeKind::Delay,
                NodeKind::Chorus,
                NodeKind::Reverb,
                NodeKind::Distortion,
                NodeKind::Bitcrush,
                NodeKind::Phaser,
                NodeKind::RingMod,
                NodeKind::Flanger,
                NodeKind::Tremolo,
                NodeKind::Vibrato,
                NodeKind::Eq,
                NodeKind::Granular,
                NodeKind::Shift,
                NodeKind::Comp,
                NodeKind::Duck,
                NodeKind::Gate,
                NodeKind::Vocoder,
            ];
            let j = order.iter().position(|k| k == kind).unwrap_or(0);
            norm(&prior.op_weights, j)
        }
        (StructOp::SetMod { kind, .. }, _) => {
            // The prior's `#mod` order; a shaper is an `Op` (four kinds) or a
            // `Pair` (six), drawn uniformly.
            let w = &prior.mod_weights;
            match kind {
                ModKind::Lfo => norm(w, 1),
                ModKind::Env => norm(w, 2),
                ModKind::Rand => norm(w, 3),
                ModKind::Follow => norm(w, 4),
                ModKind::Euclid => norm(w, 5),
                ModKind::Steps => norm(w, 8),
                ModKind::Quantize | ModKind::Slew | ModKind::Rectify | ModKind::Hold => {
                    norm(w, 6) / 4.0
                }
                _ => norm(w, 7) / 6.0,
            }
        }
        _ => 0.0,
    }
}

/// a's φ': the patch's audio half (or the pool's mean) and the candidate's
/// structural half.
fn struct_only(p: &Profile, cur: Option<&[f64]>, c: &Cand) -> Vec<f64> {
    let sz = p.engine.standardizer().expect("standardizer");
    let n = AudioFeatures::NAMES.len();
    let mut raw: Vec<f64> = match cur {
        Some(phi) => phi[..n].to_vec(),
        None => sz.mean[..n].to_vec(),
    };
    raw.extend(c.sf.to_vec());
    raw
}

fn score_a(p: &Profile, cur: Option<&[f64]>, c: &Cand) -> f64 {
    let sz = p.engine.standardizer().expect("standardizer");
    posterior(p)
        .utility_mix(&sz.transform(&struct_only(p, cur, c)))
        .0
}

/// The patch in z: its own, or the pool's average sound for one that does
/// not sound.
fn z_cur(p: &Profile, cur: Option<&[f64]>) -> Vec<f64> {
    let sz = p.engine.standardizer().expect("standardizer");
    match cur {
        Some(phi) => sz.transform(phi),
        None => vec![0.0; sz.mean.len()],
    }
}

/// The two priors c-tilt and catalog read.
struct Priors {
    tilted: PatchGrammarPrior,
    untilted: PatchGrammarPrior,
}

fn score(
    p: &Profile,
    priors: &Priors,
    cur: Option<&[f64]>,
    c: &Cand,
    phi: Option<&Vec<f64>>,
) -> Score {
    let sz = p.engine.standardizer().expect("standardizer");
    let post = posterior(p);
    let mut s = Score {
        a: score_a(p, cur, c),
        tilt: kind_weight(&priors.tilted, c),
        catalog: kind_weight(&priors.untilted, c),
        ..Default::default()
    };
    if let Some(phi) = phi {
        let z = sz.transform(phi);
        let zc = z_cur(p, cur);
        let gain: Vec<f64> = draws(post, &z)
            .iter()
            .zip(draws(post, &zc))
            .map(|(x, y)| x - y)
            .collect();
        let (m, sd_g) = wmean_sd(post, &gain);
        s.mean = Some(m);
        s.ucb = Some(m + sd_g);
        s.lcb = Some(m - sd_g);
        s.p = Some(post.prob_prefers(&z, &zc));
        if let Some(u) = &p.truth {
            let g = u.utility(&z) - u.utility(&zc);
            s.truth = Some(g);
            s.truth_p = Some(1.0 / (1.0 + (-g).exp()));
        }
    }
    s
}

fn evaluate(
    p: &Profile,
    untilted: &PatchGrammarPrior,
    all: &[(Vec<Cand>, usize)],
    cur_phi: &[Option<Vec<f64>>],
    cand_phi: &[Vec<Option<Vec<f64>>>],
) -> Vec<Vec<Score>> {
    let priors = Priors {
        tilted: p.engine.walk_context().expect("fitted").prior,
        untilted: untilted.clone(),
    };
    all.iter()
        .enumerate()
        .map(|(pi, (c, _))| {
            c.iter()
                .enumerate()
                .map(|(ci, cand)| {
                    score(
                        p,
                        &priors,
                        cur_phi[pi].as_deref(),
                        cand,
                        cand_phi[pi][ci].as_ref(),
                    )
                })
                .collect()
        })
        .collect()
}

/// Indices sorted by `f`, best first; `None` scores are left out. Ties keep
/// the candidates' order (the output first).
fn rank(n: usize, f: impl Fn(usize) -> Option<f64>) -> Vec<usize> {
    let mut v: Vec<(usize, f64)> = (0..n).filter_map(|i| f(i).map(|x| (i, x))).collect();
    v.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    v.into_iter().map(|x| x.0).collect()
}

/// Each design's name and its ranking of one patch's candidates, best first.
type Ranking = Vec<(String, Vec<usize>)>;

/// Every design's ranking of one patch's candidates under one profile.
fn rankings(c: &[Cand], s: &[Score]) -> Ranking {
    let n = c.len();
    let by_a = rank(n, |i| Some(s[i].a));
    let mut out = vec![("a".to_string(), by_a.clone())];
    for crit in CRITERIA {
        out.push((format!("b-full {crit}"), rank(n, |i| s[i].crit(crit))));
        out.push((
            format!("b-out {crit}"),
            rank(n, |i| {
                if c[i].at_output() {
                    s[i].crit(crit)
                } else {
                    None
                }
            }),
        ));
        for m in [4usize, 8] {
            let mut top: Vec<usize> = by_a.iter().take(m).copied().collect();
            top.sort_by(|&x, &y| {
                let f = |i: usize| s[i].crit(crit).unwrap_or(f64::NEG_INFINITY);
                f(y).total_cmp(&f(x)).then(x.cmp(&y))
            });
            out.push((format!("d{m} {crit}"), top));
        }
    }
    // b-out, anytime: the output's candidates rendered in a's order and the
    // first m re-ranked by lcb, as a crew that runs out of time would leave
    // them.
    let out_by_a: Vec<usize> = by_a.iter().copied().filter(|&i| c[i].at_output()).collect();
    for m in [4usize, 8, 12] {
        let mut top: Vec<usize> = out_by_a.iter().take(m).copied().collect();
        top.sort_by(|&x, &y| {
            let f = |i: usize| s[i].lcb.unwrap_or(f64::NEG_INFINITY);
            f(y).total_cmp(&f(x)).then(x.cmp(&y))
        });
        out.push((format!("dout{m} lcb"), top));
    }
    out.push(("c-tilt".into(), rank(n, |i| Some(s[i].tilt))));
    out.push(("catalog".into(), rank(n, |i| Some(s[i].catalog))));
    out
}

fn spearman(a: &[f64], b: &[f64]) -> f64 {
    // Average ranks, so ties (the unplaced tail) do not invent an order.
    let ranks = |x: &[f64]| {
        let mut idx: Vec<usize> = (0..x.len()).collect();
        idx.sort_by(|&i, &j| x[i].total_cmp(&x[j]));
        let mut r = vec![0.0; x.len()];
        let mut k = 0;
        while k < idx.len() {
            let mut j = k;
            while j + 1 < idx.len() && x[idx[j + 1]] == x[idx[k]] {
                j += 1;
            }
            let avg = (k + j) as f64 / 2.0;
            for &i in &idx[k..=j] {
                r[i] = avg;
            }
            k = j + 1;
        }
        r
    };
    let (ra, rb) = (ranks(a), ranks(b));
    let n = ra.len() as f64;
    if n < 2.0 {
        return f64::NAN;
    }
    let ma = ra.iter().sum::<f64>() / n;
    let mb = rb.iter().sum::<f64>() / n;
    let cov: f64 = ra.iter().zip(&rb).map(|(x, y)| (x - ma) * (y - mb)).sum();
    let va: f64 = ra.iter().map(|x| (x - ma) * (x - ma)).sum();
    let vb: f64 = rb.iter().map(|y| (y - mb) * (y - mb)).sum();
    cov / (va * vb).sqrt().max(1e-12)
}

fn jaccard(a: &[usize], b: &[usize]) -> f64 {
    let inter = a.iter().filter(|x| b.contains(x)).count() as f64;
    let union = (a.len() + b.len()) as f64 - inter;
    if union == 0.0 {
        1.0
    } else {
        inter / union
    }
}

// ---------------------------------------------------------------------------
// The one line a suggestion says
// ---------------------------------------------------------------------------

fn sure_word(p: f64) -> &'static str {
    let d = (p * 100.0 - 50.0).abs();
    if d < 5.0 {
        "a hunch"
    } else if d < 20.0 {
        "leaning"
    } else {
        "fairly sure"
    }
}

/// Why, from the exact decomposition of the gain under the candidate's lens:
/// the named direction (PERFORM's six) or the structural coordinate that
/// carries most of it, and the forecast.
fn because(p: &Profile, cur: Option<&[f64]>, c: &Cand, phi: &[f64]) -> String {
    let sz = p.engine.standardizer().expect("standardizer");
    let post = posterior(p);
    let z = sz.transform(phi);
    let zc = z_cur(p, cur);
    let dz: Vec<f64> = z.iter().zip(&zc).map(|(a, b)| a - b).collect();
    let resp = post.responsibilities(&z);
    let lens = (0..resp.len())
        .max_by(|&i, &j| resp[i].total_cmp(&resp[j]))
        .unwrap_or(0);
    let theta = post.theta_mean(lens);
    let names: Vec<String> = Features::phi_names()
        .into_iter()
        .map(String::from)
        .collect();
    let n_audio = AudioFeatures::NAMES.len();
    let mut best: Option<(f64, String)> = None;
    for ctl in &CONTROLS {
        let e = direction(ctl, &names);
        let on: Vec<usize> = (0..n_audio).filter(|&j| e[j] != 0.0).collect();
        let gain: f64 = on.iter().map(|&j| theta[j] * dz[j]).sum();
        let moved: f64 = on.iter().map(|&j| e[j] * dz[j]).sum();
        let word = if moved >= 0.0 { ctl.high } else { ctl.low };
        let line = format!("it moves toward {word} ({moved:+.2}σ), as your picks lean");
        if best.as_ref().is_none_or(|b| gain > b.0) {
            best = Some((gain, line));
        }
    }
    for j in n_audio..names.len() {
        let gain = theta[j] * dz[j];
        if dz[j] != 0.0 && best.as_ref().is_none_or(|b| gain > b.0) {
            let what = names[j].trim_start_matches("n_");
            let more = if dz[j] > 0.0 { "more" } else { "less" };
            best = Some((gain, format!("your picks lean toward {more} {what}")));
        }
    }
    let why = best.map(|b| b.1).unwrap_or_default();
    let pp = post.prob_prefers(&z, &zc);
    let against = if cur.is_some() {
        "over the patch"
    } else {
        "over your pool's average"
    };
    format!(
        "{}: {why} · {:.0}% {against} · {}",
        c.label(),
        pp * 100.0,
        sure_word(pp)
    )
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/// Render every tree once, on `threads` threads, into `memo`; φ by index.
fn render_all(
    trees: &[&PatchTree],
    e: &Engine,
    memo: &RenderMemo,
    threads: usize,
) -> Vec<Option<Vec<f64>>> {
    let next = AtomicUsize::new(0);
    let out: Mutex<Vec<Option<Vec<f64>>>> = Mutex::new(vec![None; trees.len()]);
    let phrase = e.cfg.phrase.clone();
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= trees.len() {
                    break;
                }
                let phi = featurize_memo(trees[i], &phrase, memo, false)
                    .ok()
                    .map(|(cf, _)| cf.features.phi());
                out.lock().expect("lock")[i] = phi;
            });
        }
    });
    out.into_inner().expect("lock")
}

// ---------------------------------------------------------------------------
// Timing, serial and cold, as the engine worker would pay it
// ---------------------------------------------------------------------------

/// This thread's CPU time, in ms: the work a design costs, which a busy
/// machine does not inflate the way it inflates the wall clock.
fn cpu_ms() -> f64 {
    #[repr(C)]
    struct Timespec {
        sec: i64,
        nsec: i64,
    }
    extern "C" {
        fn clock_gettime(clock: i32, tp: *mut Timespec) -> i32;
    }
    #[cfg(target_os = "macos")]
    const THREAD_CPUTIME: i32 = 16;
    #[cfg(not(target_os = "macos"))]
    const THREAD_CPUTIME: i32 = 3;
    let mut t = Timespec { sec: 0, nsec: 0 };
    // SAFETY: `clock_gettime` writes one `timespec` (two 64-bit fields on
    // every 64-bit target this runs on) into memory we own.
    let ok = unsafe { clock_gettime(THREAD_CPUTIME, &mut t) } == 0;
    if ok {
        t.sec as f64 * 1e3 + t.nsec as f64 * 1e-6
    } else {
        f64::NAN
    }
}

/// A start on both clocks.
#[derive(Clone, Copy)]
struct Clock {
    wall: Instant,
    cpu: f64,
}

impl Clock {
    fn start() -> Self {
        Self {
            wall: Instant::now(),
            cpu: cpu_ms(),
        }
    }
    /// `(cpu, wall)` ms since the start.
    fn read(&self) -> (f64, f64) {
        (cpu_ms() - self.cpu, self.wall.elapsed().as_secs_f64() * 1e3)
    }
}

#[derive(Default, Clone)]
struct Timing {
    /// CPU ms.
    ms: f64,
    /// Wall ms, on the machine as it was.
    wall: f64,
    renders: u64,
}

impl Timing {
    fn since(c: Clock, renders: u64) -> Self {
        let (ms, wall) = c.read();
        Self { ms, wall, renders }
    }
    fn plus(mut self, o: &Timing) -> Self {
        self.ms += o.ms;
        self.wall += o.wall;
        self
    }
}

fn misses(m: &RenderMemo) -> u64 {
    m.stats().misses
}

/// A memo that has measured the patch and nothing else, as the app has.
fn cold(e: &Engine, tree: &PatchTree) -> (RenderMemo, Option<Vec<f64>>) {
    let m = RenderMemo::default();
    let phi = featurize_memo(tree, &e.cfg.phrase, &m, false)
        .ok()
        .map(|(cf, _)| cf.features.phi());
    (m, phi)
}

struct Timed {
    enumerate: Timing,
    a: Timing,
    b_out: Timing,
    b_out_per: Vec<f64>,
    tilt: Timing,
    walk: Timing,
    walk_diffs: Vec<(Vec<&'static str>, usize)>,
    d: Vec<(usize, Timing)>,
}

/// Each design from a cold memo, scored with the `p` criterion.
fn time_designs(p: &mut Profile, tree: &PatchTree, walks: usize) -> Timed {
    let (memo, cur) = cold(&p.engine, tree);
    let sz = p.engine.standardizer().expect("standardizer").clone();
    let post = p.engine.posterior.clone().expect("fitted");
    let zc = z_cur(p, cur.as_deref());

    let t = Clock::start();
    let (cands, _) = candidates(tree);
    let te = Timing::since(t, 0);

    // a: the structure measured with the enumeration; score.
    let t = Clock::start();
    let a: Vec<f64> = cands
        .iter()
        .map(|c| score_a(p, cur.as_deref(), c))
        .collect();
    let ranked_a = rank(cands.len(), |i| Some(a[i]));
    let ta = Timing::since(t, 0).plus(&te);

    // c-tilt: the tilted prior once, then a lookup per candidate.
    let t = Clock::start();
    let w = p.engine.walk_context().map(|w| w.prior);
    let tilt: Vec<f64> = cands
        .iter()
        .map(|c| w.as_ref().map(|w| kind_weight(w, c)).unwrap_or(0.0))
        .collect();
    std::hint::black_box(rank(cands.len(), |i| Some(tilt[i])));
    let tt = Timing::since(t, 0).plus(&te);

    // b-out: render each candidate at the output, score.
    let m0 = misses(&memo);
    let t = Clock::start();
    let mut per = Vec::new();
    let mut best = f64::NEG_INFINITY;
    for c in cands.iter().filter(|c| c.at_output()) {
        let t1 = Clock::start();
        if let Ok((cf, _)) = featurize_memo(&c.tree, &p.engine.cfg.phrase, &memo, false) {
            best = best.max(post.prob_prefers(&sz.transform(&cf.features.phi()), &zc));
        }
        per.push(t1.read().0);
    }
    std::hint::black_box(best);
    let tb = Timing::since(t, misses(&memo) - m0).plus(&te);

    // d: a's top m, rendered and re-ranked. Each m from a cold memo.
    let mut d = Vec::new();
    for &m in &[4usize, 8] {
        let (memo, _) = cold(&p.engine, tree);
        let m0 = misses(&memo);
        let t = Clock::start();
        let mut top = f64::NEG_INFINITY;
        for &i in ranked_a.iter().take(m) {
            if let Ok((cf, _)) = featurize_memo(&cands[i].tree, &p.engine.cfg.phrase, &memo, false)
            {
                top = top.max(post.prob_prefers(&sz.transform(&cf.features.phi()), &zc));
            }
        }
        std::hint::black_box(top);
        d.push((m, Timing::since(t, misses(&memo) - m0).plus(&ta)));
    }

    // c-walk: the offer's walk, `walks` times, from a memo that knows the
    // patch.
    let (memo, _) = cold(&p.engine, tree);
    p.engine.set_memo(memo.clone());
    let m0 = misses(&memo);
    let t = Clock::start();
    let mut walk_diffs = Vec::new();
    for i in 0..walks {
        let mut rng = StdRng::seed_from_u64(SEED ^ ((i as u64) << 8));
        match p.engine.offer(&mut rng, tree, &[], OFFER_STEPS) {
            Ok(child) => walk_diffs.push(diff(tree, &child)),
            Err(_) => walk_diffs.push((Vec::new(), 0)),
        }
    }
    let tw = Timing::since(t, misses(&memo) - m0);
    Timed {
        enumerate: te,
        a: ta,
        b_out: tb,
        b_out_per: per,
        tilt: tt,
        walk: tw,
        walk_diffs,
        d,
    }
}

fn median(mut v: Vec<f64>) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}

fn mean(v: &[f64]) -> f64 {
    if v.is_empty() {
        f64::NAN
    } else {
        v.iter().sum::<f64>() / v.len() as f64
    }
}

// ---------------------------------------------------------------------------

fn arg<T: std::str::FromStr>(name: &str) -> Option<T> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .and_then(|s| s.parse().ok())
}

/// The longest chain the ceilings allow: a saw under filters until one more
/// insert would break a ceiling.
fn at_the_limit(amp: &PatchTree) -> PatchTree {
    let mut t = PatchTree {
        amp: amp.amp.clone(),
        root: AudioNode::Silence {
            uid: Default::default(),
        },
    };
    t = apply_struct_op(
        &t,
        &StructOp::Replace {
            key: "node".into(),
            kind: NodeKind::Vco,
        },
    )
    .expect("a saw");
    while let Ok(n) = apply_struct_op(
        &t,
        &StructOp::Insert {
            key: "node".into(),
            kind: NodeKind::Filter,
        },
    ) {
        t = n;
    }
    t
}

/// The widest tree the ceilings allow: mixes of saws until one more breaks
/// `MAX_SIZE`.
fn at_the_size_limit(amp: &PatchTree) -> PatchTree {
    let mut t = apply_struct_op(
        &PatchTree {
            amp: amp.amp.clone(),
            root: AudioNode::Silence {
                uid: Default::default(),
            },
        },
        &StructOp::Replace {
            key: "node".into(),
            kind: NodeKind::Vco,
        },
    )
    .expect("a saw");
    // Grow a balanced tree: insert a mix above every leaf, breadth first.
    'grow: loop {
        let mut leaves = Vec::new();
        keys(&t.root, "node".into(), &mut leaves);
        let leaves: Vec<String> = leaves
            .into_iter()
            .filter(|(_, n)| n.children().is_empty())
            .map(|(k, _)| k)
            .collect();
        let mut grew = false;
        for k in leaves {
            match apply_struct_op(
                &t,
                &StructOp::Insert {
                    key: k,
                    kind: NodeKind::Mix,
                },
            ) {
                Ok(n) => {
                    t = n;
                    grew = true;
                }
                Err(_) => continue,
            }
        }
        if !grew {
            break 'grow;
        }
    }
    t
}

/// What the rankings say about one profile, for the tables.
#[derive(Default)]
struct Tally {
    /// Regret against b-full mean, in the pool's spread.
    regret: HashMap<String, Vec<f64>>,
    /// Picks that do not sound.
    silent: HashMap<String, usize>,
    /// True regret, in the listener's pool spread; true pick probability;
    /// true gain above zero.
    t_regret: HashMap<String, Vec<f64>>,
    t_pick: HashMap<String, Vec<f64>>,
    t_up: HashMap<String, Vec<f64>>,
    /// Is b-full p's top in a's top m?
    recall: HashMap<usize, Vec<f64>>,
    /// Distinct top-1 kinds over the patches.
    kinds: HashMap<String, BTreeSet<String>>,
}

fn tally(
    p: &Profile,
    all: &[(Vec<Cand>, usize)],
    scores: &[Vec<Score>],
    t: &mut Tally,
) -> Vec<Ranking> {
    let spread = pool_spread(p);
    let tspread = truth_spread(p);
    let mut out = Vec::new();
    for (pi, (c, _)) in all.iter().enumerate() {
        let s = &scores[pi];
        if c.is_empty() {
            out.push(Vec::new());
            continue;
        }
        let r = rankings(c, s);
        let best_b = r
            .iter()
            .find(|(d, _)| d == "b-full mean")
            .and_then(|(_, v)| v.first())
            .and_then(|&i| s[i].mean);
        let best_t = s
            .iter()
            .filter_map(|x| x.truth)
            .fold(f64::NEG_INFINITY, f64::max);
        for (d, v) in &r {
            let Some(&top) = v.first() else { continue };
            t.kinds
                .entry(d.clone())
                .or_default()
                .insert(c[top].kind.clone());
            match (s[top].mean, best_b) {
                (Some(m), Some(best)) => {
                    t.regret
                        .entry(d.clone())
                        .or_default()
                        .push((best - m) / spread);
                }
                _ => *t.silent.entry(d.clone()).or_default() += 1,
            }
            if let (Some(g), Some(pp)) = (s[top].truth, s[top].truth_p) {
                t.t_regret
                    .entry(d.clone())
                    .or_default()
                    .push((best_t - g) / tspread);
                t.t_pick.entry(d.clone()).or_default().push(pp);
                t.t_up
                    .entry(d.clone())
                    .or_default()
                    .push(if g > 0.0 { 1.0 } else { 0.0 });
            }
        }
        // Random and the truth's own best, for scale.
        let ts: Vec<f64> = s.iter().filter_map(|x| x.truth).collect();
        if !ts.is_empty() {
            let rr: Vec<f64> = ts.iter().map(|g| (best_t - g) / tspread).collect();
            t.t_regret
                .entry("random".into())
                .or_default()
                .push(mean(&rr));
            let ps: Vec<f64> = s.iter().filter_map(|x| x.truth_p).collect();
            t.t_pick.entry("random".into()).or_default().push(mean(&ps));
            let ups: Vec<f64> = ts
                .iter()
                .map(|g| if *g > 0.0 { 1.0 } else { 0.0 })
                .collect();
            t.t_up.entry("random".into()).or_default().push(mean(&ups));
            let bi = (0..s.len())
                .filter(|&i| s[i].truth.is_some())
                .max_by(|&i, &j| {
                    s[i].truth
                        .unwrap_or(0.0)
                        .total_cmp(&s[j].truth.unwrap_or(0.0))
                });
            if let Some(bi) = bi {
                t.t_regret.entry("truth".into()).or_default().push(0.0);
                t.t_pick
                    .entry("truth".into())
                    .or_default()
                    .push(s[bi].truth_p.unwrap_or(0.5));
                t.t_up.entry("truth".into()).or_default().push(
                    if s[bi].truth.unwrap_or(0.0) > 0.0 {
                        1.0
                    } else {
                        0.0
                    },
                );
            }
        }
        let by_a = rank(c.len(), |i| Some(s[i].a));
        if let Some(&top_p) = r
            .iter()
            .find(|(d, _)| d == "b-full p")
            .and_then(|(_, v)| v.first())
        {
            for &m in &SHORTLIST {
                let hit = by_a.iter().take(m).any(|&i| i == top_p);
                t.recall
                    .entry(m)
                    .or_default()
                    .push(if hit { 1.0 } else { 0.0 });
            }
        }
        out.push(r);
    }
    out
}

fn design_names() -> Vec<String> {
    let mut v = vec!["a".to_string()];
    for crit in CRITERIA {
        v.push(format!("b-full {crit}"));
        v.push(format!("b-out {crit}"));
        v.push(format!("d4 {crit}"));
        v.push(format!("d8 {crit}"));
    }
    for m in [4usize, 8, 12] {
        v.push(format!("dout{m} lcb"));
    }
    v.push("c-tilt".into());
    v.push("catalog".into());
    v
}

fn get<'a>(m: &'a HashMap<String, Vec<f64>>, k: &str) -> &'a [f64] {
    m.get(k).map(Vec::as_slice).unwrap_or(&[])
}

fn main() {
    let threads: usize = arg("--threads").unwrap_or(8);
    let walks: usize = arg("--walks").unwrap_or(3);
    let n_listeners: u64 = arg("--listeners").unwrap_or(7);
    let ops_out: Option<String> = arg("--ops");
    // The design whose one line is printed.
    let say: String = arg("--say").unwrap_or_else(|| "b-out lcb".to_string());
    let t0 = Instant::now();
    let memo = RenderMemo::new(16_384, 0);
    let untilted = PatchGrammarPrior::default();

    // The patches.
    let bank = preset_bank();
    let get_tree = |n: &str| {
        bank.iter()
            .find(|p| p.name == n)
            .expect("preset")
            .tree
            .clone()
    };
    let mut patches: Vec<(String, PatchTree)> = PATCHES
        .iter()
        .map(|n| (n.to_string(), get_tree(n)))
        .collect();
    for n in ["Detune Dream", "Sub & Sparkle"] {
        let mut t = get_tree(n);
        t.root = AudioNode::Silence {
            uid: Default::default(),
        };
        patches.push((format!("{n}, cleared"), t));
    }
    let pad_amp = get_tree("Detune Dream");
    let saw = apply_struct_op(
        &PatchTree {
            amp: pad_amp.amp.clone(),
            root: AudioNode::Silence {
                uid: Default::default(),
            },
        },
        &StructOp::Replace {
            key: "node".into(),
            kind: NodeKind::Vco,
        },
    )
    .expect("saw");
    let saw_filter = apply_struct_op(
        &saw,
        &StructOp::Insert {
            key: "node".into(),
            kind: NodeKind::Filter,
        },
    )
    .expect("filter");
    patches.push(("a saw (pad amp)".into(), saw));
    patches.push(("saw → filter".into(), saw_filter));

    // The grammar's ceilings.
    for (what, limit) in [
        ("a saw under filters", at_the_limit(&pad_amp)),
        ("saws under mixes", at_the_size_limit(&pad_amp)),
    ] {
        let (lc, ltried) = candidates(&limit);
        println!(
            "At the ceiling, {what} (size {}, depth {}): {} of {} edits legal \
             ({} processors, {} modulators, {} sources)",
            limit.root.size(),
            limit.root.depth(),
            lc.len(),
            ltried,
            lc.iter().filter(|c| c.sort == Sort::Processor).count(),
            lc.iter().filter(|c| c.sort == Sort::Modulator).count(),
            lc.iter().filter(|c| c.sort == Sort::Source).count(),
        );
    }

    // Candidates, profile-independent.
    let all: Vec<(Vec<Cand>, usize)> = patches.iter().map(|(_, t)| candidates(t)).collect();
    println!("\nCandidates per patch (legal edits that only add):");
    println!(
        "{:<26} {:>5} {:>6} {:>5} {:>5} {:>5} {:>6}",
        "patch", "size", "tried", "legal", "proc", "mod", "b-out"
    );
    for ((name, t), (c, tried)) in patches.iter().zip(&all) {
        println!(
            "{:<26} {:>5} {:>6} {:>5} {:>5} {:>5} {:>6}",
            name,
            t.root.size(),
            tried,
            c.len(),
            c.iter().filter(|c| c.sort == Sort::Processor).count(),
            c.iter().filter(|c| c.sort == Sort::Modulator).count(),
            c.iter().filter(|c| c.at_output()).count()
        );
    }
    if let Some(path) = &ops_out {
        #[derive(serde::Serialize)]
        struct Entry<'a> {
            name: &'a str,
            tree: &'a PatchTree,
            ops: Vec<&'a StructOp>,
        }
        let entries: Vec<Entry> = patches
            .iter()
            .zip(&all)
            .map(|((name, t), (c, _))| Entry {
                name,
                tree: t,
                ops: c.iter().filter(|c| c.at_output()).map(|c| &c.op).collect(),
            })
            .collect();
        std::fs::write(path, serde_json::to_string(&entries).expect("json")).expect("write");
        eprintln!("wrote {path}");
    }

    // Quality: render every candidate once (taste-independent), in parallel.
    // The boot's pool goes into the same memo, so every profile's boot after
    // the first is free.
    let first = boot(&memo);
    let t1 = Instant::now();
    let mut trees: Vec<&PatchTree> = patches.iter().map(|(_, t)| t).collect();
    for (c, _) in &all {
        trees.extend(c.iter().map(|c| &c.tree));
    }
    let phis = render_all(&trees, &first, &memo, threads);
    let n_patches = patches.len();
    let cur_phi: Vec<Option<Vec<f64>>> = phis[..n_patches].to_vec();
    let mut cand_phi: Vec<Vec<Option<Vec<f64>>>> = Vec::new();
    let mut at = n_patches;
    for (c, _) in &all {
        cand_phi.push(phis[at..at + c.len()].to_vec());
        at += c.len();
    }
    let silent_cands = cand_phi.iter().flatten().filter(|x| x.is_none()).count();
    eprintln!(
        "rendered {} trees on {threads} threads in {:.1} s ({silent_cands} candidates do not vet)",
        trees.len(),
        t1.elapsed().as_secs_f64()
    );
    drop(first);

    // The named warm starts.
    let designs = design_names();
    let mut named: Vec<Profile> = Vec::new();
    let mut named_rank: Vec<Vec<Ranking>> = Vec::new();
    let mut named_tally: Vec<Tally> = Vec::new();
    let mut named_scores: Vec<Vec<Vec<Score>>> = Vec::new();
    for (name, darkest) in [("dark", true), ("bright", false)] {
        let (engine, picked) = warm_start(&memo, by_centroid(darkest));
        let p = Profile {
            name: name.into(),
            engine,
            truth: None,
        };
        eprintln!(
            "  {name}: picked {}; K = {}; pool spread {:.3}",
            picked.join(", "),
            posterior(&p).k_styles(),
            pool_spread(&p)
        );
        let s = evaluate(&p, &untilted, &all, &cur_phi, &cand_phi);
        let mut t = Tally::default();
        named_rank.push(tally(&p, &all, &s, &mut t));
        named_tally.push(t);
        named_scores.push(s);
        named.push(p);
    }

    // The listeners: at the warm start, and taught.
    let mut warm_t = Tally::default();
    let mut taught_t = Tally::default();
    let mut timed_listener: Option<Profile> = None;
    let mut listener_lines: Vec<String> = Vec::new();
    for i in 0..n_listeners {
        let user = listener_user(i);
        let (engine, picked) = warm_start(&memo, by_truth(&user));
        let mut p = Profile {
            name: format!("listener {i}"),
            engine,
            truth: Some(user.clone()),
        };
        let s = evaluate(&p, &untilted, &all, &cur_phi, &cand_phi);
        tally(&p, &all, &s, &mut warm_t);
        teach(&mut p.engine, &user, TEACH_MORE, SEED ^ (0x7EAC + i));
        let s = evaluate(&p, &untilted, &all, &cur_phi, &cand_phi);
        let r = tally(&p, &all, &s, &mut taught_t);
        listener_lines.push(format!(
            "  {}: {} · warm start {}; then {} picks, K = {}",
            p.name,
            describe_user(&user),
            picked.join(", "),
            p.engine.log.len(),
            posterior(&p).k_styles()
        ));
        // Two lines a taught listener's suggestion would say.
        for pi in [3usize, 9] {
            if let Some((_, v)) = r[pi].iter().find(|(d, _)| *d == say) {
                if let Some(&top) = v.first() {
                    if let Some(phi) = cand_phi[pi][top].as_ref() {
                        listener_lines.push(format!(
                            "      {} · {}",
                            patches[pi].0,
                            because(&p, cur_phi[pi].as_deref(), &all[pi].0[top], phi)
                        ));
                    }
                }
            }
        }
        if i == 0 {
            timed_listener = Some(p);
        }
    }
    println!("\nThe listeners:");
    for l in &listener_lines {
        println!("{l}");
    }

    // Per named profile and patch: picks and what they would say.
    for (k, p) in named.iter().enumerate() {
        println!("\n[{}] top picks, and what {say} would say", p.name);
        for (pi, (name, _)) in patches.iter().enumerate() {
            let r = &named_rank[k][pi];
            if r.is_empty() {
                continue;
            }
            let c = &all[pi].0;
            let pick = |d: &str| {
                r.iter()
                    .find(|(x, _)| x == d)
                    .and_then(|(_, v)| v.first())
                    .map(|&i| c[i].label())
                    .unwrap_or_else(|| "none".into())
            };
            println!(
                "  {name:<24} a: {} | b-full mean: {} | {say}: {} | c-tilt: {}",
                pick("a"),
                pick("b-full mean"),
                pick(&say),
                pick("c-tilt")
            );
            if let Some((_, v)) = r.iter().find(|(d, _)| *d == say) {
                if let Some(&top) = v.first() {
                    if let Some(phi) = cand_phi[pi][top].as_ref() {
                        println!(
                            "      says: {}",
                            because(p, cur_phi[pi].as_deref(), &c[top], phi)
                        );
                    }
                }
            }
        }
    }

    // Tables.
    println!(
        "\nRegret against the model's own best (b-full mean), in the pool's spread of \
         ratings; mean over patches (silent: picks that do not sound):"
    );
    println!(
        "{:<14} {:>8} {:>8} {:>8} {:>8} {:>7}",
        "design", "dark", "bright", "warm", "taught", "silent"
    );
    for d in &designs {
        let silent: usize = named_tally
            .iter()
            .chain([&warm_t, &taught_t])
            .map(|t| t.silent.get(d).copied().unwrap_or(0))
            .sum();
        println!(
            "{:<14} {:>8.3} {:>8.3} {:>8.3} {:>8.3} {:>7}",
            d,
            mean(get(&named_tally[0].regret, d)),
            mean(get(&named_tally[1].regret, d)),
            mean(get(&warm_t.regret, d)),
            mean(get(&taught_t.regret, d)),
            silent
        );
    }

    println!(
        "\nThe listeners' truth ({n_listeners} listeners × {} patches): regret in each \
         listener's pool spread, the probability it would pick the suggested patch over \
         the patch, and how often the suggestion truly helps:",
        patches.len()
    );
    println!(
        "{:<14} {:>12} {:>9} {:>8}   {:>12} {:>9} {:>8}",
        "design", "warm regret", "pick", "helps", "taught regret", "pick", "helps"
    );
    let mut rows = designs.clone();
    rows.push("random".into());
    rows.push("truth".into());
    for d in &rows {
        println!(
            "{:<14} {:>12.3} {:>9.3} {:>8.2}   {:>12.3} {:>9.3} {:>8.2}",
            d,
            mean(get(&warm_t.t_regret, d)),
            mean(get(&warm_t.t_pick, d)),
            mean(get(&warm_t.t_up, d)),
            mean(get(&taught_t.t_regret, d)),
            mean(get(&taught_t.t_pick, d)),
            mean(get(&taught_t.t_up, d)),
        );
    }

    println!("\nRecall: is b-full p's top pick in a's top m?");
    for &m in &SHORTLIST {
        let r = |t: &Tally| mean(t.recall.get(&m).map(Vec::as_slice).unwrap_or(&[]));
        println!(
            "  m = {m:>2}: dark {:.2}  bright {:.2}  warm {:.2}  taught {:.2}",
            r(&named_tally[0]),
            r(&named_tally[1]),
            r(&warm_t),
            r(&taught_t)
        );
    }

    println!("\nTaste: dark against bright, per design (over the patches):");
    println!(
        "{:<14} {:>13} {:>9} {:>11} {:>15}",
        "design", "top differs", "top-3 J", "spearman ρ", "kinds d / b"
    );
    for d in &designs {
        let mut differs = 0;
        let mut js = Vec::new();
        let mut rhos = Vec::new();
        let mut n = 0;
        for (pi, (c, _)) in all.iter().enumerate() {
            let find = |k: usize| {
                named_rank[k][pi]
                    .iter()
                    .find(|(x, _)| x == d)
                    .map(|(_, v)| v.clone())
            };
            let (Some(x), Some(y)) = (find(0), find(1)) else {
                continue;
            };
            if x.is_empty() || y.is_empty() {
                continue;
            }
            n += 1;
            if x.first() != y.first() {
                differs += 1;
            }
            let top3 = |r: &[usize]| r.iter().take(3).copied().collect::<Vec<_>>();
            js.push(jaccard(&top3(&x), &top3(&y)));
            // Over every candidate; ones a ranking leaves out tie at the
            // bottom.
            let pos = |r: &[usize]| -> Vec<f64> {
                let mut v = vec![-(c.len() as f64); c.len()];
                for (k, &i) in r.iter().enumerate() {
                    v[i] = -(k as f64);
                }
                v
            };
            rhos.push(spearman(&pos(&x), &pos(&y)));
        }
        let kinds = |k: usize| named_tally[k].kinds.get(d).map_or(0, BTreeSet::len);
        println!(
            "{:<14} {:>7} of {:<3} {:>9.2} {:>11.2} {:>9} / {}",
            d,
            differs,
            n,
            mean(&js),
            mean(
                &rhos
                    .into_iter()
                    .filter(|x| x.is_finite())
                    .collect::<Vec<_>>()
            ),
            kinds(0),
            kinds(1)
        );
    }

    // Cost: serial and cold, as the engine worker pays it.
    println!(
        "\nCost, serial from a cold memo (native, CPU ms of this thread; renders in \
         brackets). c-walk is {walks} offer walks of {OFFER_STEPS} steps:"
    );
    println!(
        "{:<11} {:<24} {:>6} {:>6} {:>6} {:>13} {:>12} {:>12} {:>14}",
        "profile", "patch", "enum", "a", "c-tilt", "b-out", "d4", "d8", "c-walk"
    );
    let mut per_render = Vec::new();
    let mut walk_adds = 0;
    let mut walk_one = 0;
    let mut walk_n = 0;
    let (mut cpu_total, mut wall_total) = (0.0, 0.0);
    let mut timers: Vec<Profile> = named.into_iter().take(1).collect();
    timers.extend(timed_listener);
    for p in timers.iter_mut() {
        for (name, tree) in &patches {
            let t = time_designs(p, tree, walks);
            for x in [&t.b_out, &t.walk] {
                cpu_total += x.ms;
                wall_total += x.wall;
            }
            per_render.extend(t.b_out_per.iter().copied());
            for (added, removed) in &t.walk_diffs {
                walk_n += 1;
                if !added.is_empty() {
                    walk_adds += 1;
                }
                if added.len() == 1 && *removed == 0 {
                    walk_one += 1;
                }
            }
            let cell = |t: &Timing| format!("{:.0} [{}]", t.ms, t.renders);
            println!(
                "{:<11} {:<24} {:>6.2} {:>6.2} {:>6.2} {:>13} {:>12} {:>12} {:>14}",
                p.name,
                name,
                t.enumerate.ms,
                t.a.ms,
                t.tilt.ms,
                cell(&t.b_out),
                cell(&t.d[0].1),
                cell(&t.d[1].1),
                cell(&t.walk),
            );
            let added: Vec<String> = t
                .walk_diffs
                .iter()
                .map(|(a, r)| {
                    let a = if a.is_empty() {
                        "nothing".to_string()
                    } else {
                        a.join("+")
                    };
                    if *r > 0 {
                        format!("{a} (−{r})")
                    } else {
                        a
                    }
                })
                .collect();
            println!("{:<36} c-walk added: {}", "", added.join(", "));
        }
    }
    let mut sorted = per_render.clone();
    sorted.sort_by(f64::total_cmp);
    let q = |f: f64| sorted[((sorted.len() - 1) as f64 * f) as usize];
    println!(
        "\nOne candidate's render (b-out, native, CPU): median {:.0} ms (quartiles {:.0}, \
         {:.0}), over {} renders",
        median(per_render.clone()),
        q(0.25),
        q(0.75),
        per_render.len()
    );
    println!(
        "Wall clock over CPU time for the renders above: {:.2} (the machine's load while \
         this ran)",
        wall_total / cpu_total.max(1e-9)
    );
    println!(
        "Offer walks that added a module: {walk_adds} of {walk_n}; that added exactly one \
         and removed none: {walk_one}"
    );
    eprintln!("done in {:.0} s", t0.elapsed().as_secs_f64());
}
