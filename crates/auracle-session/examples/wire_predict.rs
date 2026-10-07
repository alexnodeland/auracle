//! Can PERFORM wire a sound before it has rendered anything (#290)?
//!
//! A first measurement is one render per continuous knob and four per
//! reachable control, seconds even on a fast laptop, and the controls do
//! nothing until it lands. This census asks how good a wiring predicted from
//! the tree alone would be: a table of how each kind of module's knob moves
//! φ, learned from measured Jacobians, run through the same solve
//! ([`wire_set`]) on the predicted Jacobian, and judged against each sound's
//! own measured Jacobian, held out.
//!
//! ```bash
//! cargo run -p auracle-session --example wire_predict --release -- \
//!     [cache.json] [seeds=6] [threads=8]
//! ```
//!
//! First run: fills a pool of 40 for each of `seeds` session seeds (the
//! app's size, each under its own standardizer, untaught), measures the
//! Jacobian of every pool sound and of every preset (presets under the first
//! seed's standardizer), and writes each column in raw φ units per unit of
//! knob travel to `cache.json` with what the knob is (its module's kind, its
//! site, whether it modulates and what, its value). Later runs read the
//! cache and only evaluate.
//!
//! Evaluated: every pool sound of each seed with the table learned from the
//! presets and the *other* seeds' pools (a sound the table never saw, from a
//! session it never saw), and every preset leave-one-out. Per control:
//! how often the measured wiring reaches it, how often the prediction wires
//! it, and of those, how often turning it up moves the sound the labeled way
//! (true `along > 0`), by at least half the reach floor, its true purity, and
//! whether it turns the measured wiring's knobs (then the measurement lands in
//! place, `applyRechecked` in perform.js, and the control does not re-centre).
//!
//! ```bash
//! cargo run -p auracle-session --example wire_predict --release -- --shipped [seed=77] [threads=8]
//! ```
//!
//! `--shipped` judges what the app plays instead, by ear: the knob table in
//! `apps/web/perform-wirings.json` on a fresh session's pool of 40, each
//! control the gated prediction wires (`Engine::wire_predicted`) rendered
//! turned fully up and fully down (as verification renders a measured one),
//! against the sound's own measurement (`Engine::wire_named`). "Up" is the sound moving toward the control's high
//! word when turned up, "both" moving the named way at both ends, "audible"
//! by at least half the reach floor.
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use auracle_features::{AudioFeatures, RenderMemo};
use auracle_grammar::edit::{set_param, ParamValue};
use auracle_grammar::{describe, preset_bank, PatchGrammarPrior, PatchTree};
use auracle_session::perform::{
    apply, direction, jacobian, purity_basis, separate, standardized_audio, wire_set, Jacobian,
    Wiring, CONTROLS, PALETTE, PURITY_FLOOR, REACH_FLOOR, SEMANTIC_RIDGE,
};
use auracle_session::predict::KnobTable;
use auracle_session::{Engine, SessionConfig};
use rand::SeedableRng;
use serde::{Deserialize, Serialize};

/// One knob of one measured sound.
#[derive(Clone, Serialize, Deserialize)]
struct Knob {
    addr: String,
    value: f64,
    kind: String,
    site: String,
    is_mod: bool,
    /// The kind of the module a modulator's chain drives ("" in the audio path).
    dest: String,
    /// ∂φ_audio/∂p in raw units.
    raw: Vec<f64>,
}

/// One measured sound: its knobs, its standardized audio φ, and the
/// standardizer (audio coordinates) it was measured under.
#[derive(Clone, Serialize, Deserialize)]
struct Sound {
    group: String,
    name: String,
    z: Vec<f64>,
    std: Vec<f64>,
    knobs: Vec<Knob>,
}

fn knob_facts(tree: &PatchTree) -> HashMap<String, (String, bool, String)> {
    let rack = describe(tree);
    let kind_at: HashMap<&str, &str> = rack
        .modules
        .iter()
        .map(|m| (m.key.as_str(), m.kind.as_str()))
        .collect();
    let mut out = HashMap::new();
    for m in &rack.modules {
        let dest = if m.is_mod {
            let slot = m.key.split("/m").next().unwrap_or(&m.key);
            kind_at.get(slot).copied().unwrap_or("?").to_string()
        } else {
            String::new()
        };
        for k in &m.knobs {
            out.insert(k.addr.clone(), (m.kind.clone(), m.is_mod, dest.clone()));
        }
    }
    out
}

fn measure(group: &str, name: &str, tree: &PatchTree, eng: &Engine) -> Option<Sound> {
    let std = eng.standardizer()?;
    let memo = RenderMemo::default();
    let jac = jacobian(tree, &eng.cfg.phrase, &memo, std)?;
    let n_audio = AudioFeatures::NAMES.len();
    let sd: Vec<f64> = std.std[..n_audio].to_vec();
    let facts = knob_facts(tree);
    let knobs = jac
        .addrs
        .iter()
        .zip(&jac.values)
        .zip(&jac.cols)
        .map(|((a, v), col)| {
            let (kind, is_mod, dest) = facts
                .get(a)
                .cloned()
                .unwrap_or_else(|| ("?".into(), false, String::new()));
            Knob {
                addr: a.clone(),
                value: *v,
                kind,
                site: a.rsplit('#').next().unwrap_or(a).to_string(),
                is_mod,
                dest,
                raw: col.iter().zip(&sd).map(|(c, s)| c * s).collect(),
            }
        })
        .collect();
    Some(Sound {
        group: group.into(),
        name: name.into(),
        z: jac.z.clone(),
        std: sd,
        knobs,
    })
}

fn build(seeds: usize, threads: usize) -> Vec<Sound> {
    let mut engines = Vec::new();
    for s in 0..seeds {
        let mut rng = rand::rngs::StdRng::seed_from_u64(1000 + s as u64);
        let cfg = SessionConfig {
            pool_size: 40,
            ..SessionConfig::default()
        };
        let mut e = Engine::new(PatchGrammarPrior::default(), cfg);
        e.begin_session();
        e.fill_pool(&mut rng);
        eprintln!("seed {s}: pool of {}", e.pool.len());
        engines.push(e);
    }
    let mut jobs: Vec<(String, String, PatchTree, usize)> = Vec::new();
    for p in preset_bank() {
        jobs.push(("preset".into(), p.name.to_string(), p.tree.clone(), 0));
    }
    for (s, e) in engines.iter().enumerate() {
        for c in &e.pool {
            jobs.push((format!("seed{s}"), format!("{}", c.id), c.tree.clone(), s));
        }
    }
    let total = jobs.len();
    let next = Mutex::new(0usize);
    let out: Mutex<Vec<Sound>> = Mutex::new(Vec::new());
    let t0 = std::time::Instant::now();
    std::thread::scope(|sc| {
        for _ in 0..threads {
            sc.spawn(|| loop {
                let i = {
                    let mut n = next.lock().unwrap();
                    let i = *n;
                    *n += 1;
                    i
                };
                let Some((g, name, tree, s)) = jobs.get(i) else {
                    return;
                };
                if let Some(snd) = measure(g, name, tree, &engines[*s]) {
                    out.lock().unwrap().push(snd);
                }
                if i % 20 == 0 {
                    eprintln!("{i}/{total} in {:.0} s", t0.elapsed().as_secs_f64());
                }
            });
        }
    });
    let mut v = out.into_inner().unwrap();
    v.sort_by(|a, b| (a.group.as_str(), a.name.as_str()).cmp(&(b.group.as_str(), b.name.as_str())));
    v
}

/// A table level: what a knob is keyed by.
#[derive(Clone, Copy, Debug)]
enum Level {
    Site,
    KindSite,
    KindSiteDest,
    KindSiteDestBin,
}

fn key(k: &Knob, l: Level) -> String {
    let bin = (k.value * 3.0).floor().clamp(0.0, 2.0) as u8;
    match l {
        Level::Site => k.site.clone(),
        Level::KindSite => format!("{}#{}", k.kind, k.site),
        Level::KindSiteDest => format!("{}#{}>{}", k.kind, k.site, k.dest),
        Level::KindSiteDestBin => format!("{}#{}>{}@{bin}", k.kind, k.site, k.dest),
    }
}

/// A table: per key, the per-coordinate statistic of the raw columns.
struct Table {
    levels: Vec<Level>,
    /// Per level, per key: the column, and per control how many of the
    /// training columns agree on which way it moves the control's axis (the
    /// majority's share).
    by: Vec<HashMap<String, Entry>>,
}

/// A table's entry: the column, and the controls' sign agreement.
type Entry = (Vec<f64>, [f64; 6]);
/// Training columns with their sounds' standardizers.
type Cols<'a> = Vec<(&'a Vec<f64>, &'a Vec<f64>)>;

/// The majority's share of `cols` (each with its sound's standardizer) on
/// the sign of each control's axis.
fn agreement(cols: &[(&Vec<f64>, &Vec<f64>)]) -> [f64; 6] {
    let names = names();
    let mut out = [0.0; 6];
    for (c, o) in out.iter_mut().enumerate() {
        let d = direction(&CONTROLS[c], &names);
        let pos = cols
            .iter()
            .filter(|(raw, sd)| {
                raw.iter()
                    .zip(sd.iter())
                    .zip(&d)
                    .map(|((r, s), w)| r / s * w)
                    .sum::<f64>()
                    > 0.0
            })
            .count();
        let n = cols.len().max(1);
        *o = pos.max(n - pos) as f64 / n as f64;
    }
    out
}

fn stat(cols: &[&Vec<f64>], median: bool) -> Vec<f64> {
    let m = cols[0].len();
    (0..m)
        .map(|j| {
            let mut xs: Vec<f64> = cols.iter().map(|c| c[j]).collect();
            if median {
                xs.sort_by(f64::total_cmp);
                xs[xs.len() / 2]
            } else {
                xs.iter().sum::<f64>() / xs.len() as f64
            }
        })
        .collect()
}

impl Table {
    fn learn(train: &[&Sound], levels: &[Level], min: usize, median: bool) -> Table {
        let by = levels
            .iter()
            .map(|&l| {
                let mut g: HashMap<String, Cols> = HashMap::new();
                for s in train {
                    for k in &s.knobs {
                        g.entry(key(k, l)).or_default().push((&k.raw, &s.std));
                    }
                }
                g.into_iter()
                    .filter(|(_, v)| v.len() >= min)
                    .map(|(k, v)| {
                        let cols: Vec<&Vec<f64>> = v.iter().map(|(r, _)| *r).collect();
                        (k, (stat(&cols, median), agreement(&v)))
                    })
                    .collect()
            })
            .collect();
        Table {
            levels: levels.to_vec(),
            by,
        }
    }
    /// The finest level that knows this knob, or none.
    fn col(&self, k: &Knob) -> Option<&Entry> {
        self.levels
            .iter()
            .zip(&self.by)
            .rev()
            .find_map(|(&l, t)| t.get(&key(k, l)))
    }
}

fn names() -> Vec<String> {
    AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect()
}

fn jac_of(s: &Sound, cols: Vec<Vec<f64>>) -> Jacobian {
    Jacobian {
        addrs: s.knobs.iter().map(|k| k.addr.clone()).collect(),
        values: s.knobs.iter().map(|k| k.value).collect(),
        names: names(),
        z: s.z.clone(),
        cols,
    }
}

fn true_jac(s: &Sound) -> Jacobian {
    jac_of(
        s,
        s.knobs
            .iter()
            .map(|k| k.raw.iter().zip(&s.std).map(|(r, sd)| r / sd).collect())
            .collect(),
    )
}

/// The Jacobian the table predicts for `s`; with `gate` `(control, share)`,
/// only the knobs whose training columns agree on that control's sign by at
/// least `share`.
fn predicted_jac(s: &Sound, t: &Table, gate: Option<(usize, f64)>) -> Jacobian {
    jac_of(
        s,
        s.knobs
            .iter()
            .map(|k| match t.col(k) {
                Some((c, agree)) if gate.is_none_or(|(i, share)| agree[i] >= share) => {
                    c.iter().zip(&s.std).map(|(r, sd)| r / sd).collect()
                }
                _ => vec![0.0; s.std.len()],
            })
            .collect(),
    )
}

/// What wiring `w` really does on the sound whose true Jacobian is `j`:
/// (along, purity), from the true movement at a full turn.
fn truth(w: &Wiring, j: &Jacobian, c: usize) -> (f64, f64) {
    let d = direction(&CONTROLS[c], &j.names);
    let mut moved = vec![0.0; j.names.len()];
    for (a, g) in &w.knobs {
        if let Some(i) = j.addrs.iter().position(|x| x == a) {
            for (m, v) in moved.iter_mut().zip(&j.cols[i]) {
                *m += v * g;
            }
        }
    }
    let along: f64 = moved.iter().zip(&d).map(|(a, b)| a * b).sum();
    let off: f64 = purity_basis(&d, &j.names)
        .iter()
        .skip(1)
        .map(|b| {
            b.iter()
                .zip(&moved)
                .map(|(x, y)| x * y)
                .sum::<f64>()
                .powi(2)
        })
        .sum();
    (along, along / (along * along + off).sqrt().max(1e-12))
}

#[derive(Default, Clone)]
struct Tally {
    sounds: usize,
    measured: [usize; 6],
    wired: [usize; 6],
    right_way: [usize; 6],
    audible: [usize; 6],
    honest: [usize; 6],
    false_reach: [usize; 6],
    same_knobs: [usize; 6],
    covered: [usize; 6],
    purity: [Vec<f64>; 6],
    reach_ratio: [Vec<f64>; 6],
}

fn median(v: &[f64]) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    let mut v = v.to_vec();
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}

fn judge(s: &Sound, t: &Table, gate: Option<f64>, tally: &mut Tally) {
    let tj = true_jac(s);
    let measured = wire_set(&tj, &CONTROLS, SEMANTIC_RIDGE);
    let predicted = match gate {
        None => wire_set(&predicted_jac(s, t, None), &CONTROLS, SEMANTIC_RIDGE),
        Some(share) => {
            let mut w: Vec<Wiring> = (0..6)
                .map(|c| {
                    let j = predicted_jac(s, t, Some((c, share)));
                    wire_set(&j, &CONTROLS[c..=c], SEMANTIC_RIDGE).remove(0)
                })
                .collect();
            separate(&mut w);
            w
        }
    };
    tally.sounds += 1;
    for c in 0..6 {
        let (m, p) = (&measured[c], &predicted[c]);
        if !m.search {
            tally.measured[c] += 1;
        }
        if p.search {
            continue;
        }
        tally.wired[c] += 1;
        let (along, purity) = truth(p, &tj, c);
        if along > 0.0 {
            tally.right_way[c] += 1;
        }
        if along >= REACH_FLOOR * 0.5 {
            tally.audible[c] += 1;
            if !m.search {
                tally.covered[c] += 1;
            }
        }
        if along >= REACH_FLOOR * 0.5 && purity >= PURITY_FLOOR {
            tally.honest[c] += 1;
        }
        if m.search {
            tally.false_reach[c] += 1;
        } else {
            fn ks(w: &Wiring) -> Vec<&str> {
                let mut v: Vec<&str> = w.knobs.iter().map(|(a, _)| a.as_str()).collect();
                v.sort();
                v
            }
            if ks(m) == ks(p) {
                tally.same_knobs[c] += 1;
            }
            tally.reach_ratio[c].push(along / m.reach.max(1e-9));
        }
        tally.purity[c].push(purity);
    }
}

fn report(label: &str, t: &Tally) {
    println!("\n{label}: {} sounds", t.sounds);
    println!(
        "{:<7} {:>9} {:>7} {:>10} {:>9} {:>8} {:>8} {:>9} {:>8} {:>10} {:>8}",
        "control",
        "measured",
        "wired",
        "right way",
        "audible",
        "honest",
        "purity",
        "false",
        "same",
        "reach/msr",
        "covered"
    );
    let pc = |a: usize, b: usize| {
        if b == 0 {
            "   -".to_string()
        } else {
            format!("{:>3.0}%", 100.0 * a as f64 / b as f64)
        }
    };
    let (mut w, mut r, mut h, mut tot, mut cov) = (0, 0, 0, 0, 0);
    for (c, control) in CONTROLS.iter().enumerate() {
        println!(
            "{:<7} {:>9} {:>7} {:>10} {:>9} {:>8} {:>8.2} {:>9} {:>8} {:>10.2} {:>8}",
            control.name,
            pc(t.measured[c], t.sounds),
            pc(t.wired[c], t.sounds),
            pc(t.right_way[c], t.wired[c]),
            pc(t.audible[c], t.wired[c]),
            pc(t.honest[c], t.wired[c]),
            median(&t.purity[c]),
            pc(t.false_reach[c], t.wired[c]),
            pc(t.same_knobs[c], t.wired[c] - t.false_reach[c]),
            median(&t.reach_ratio[c]),
            pc(t.covered[c], t.measured[c]),
        );
        w += t.wired[c];
        r += t.right_way[c];
        h += t.honest[c];
        tot += t.measured[c];
        cov += t.covered[c];
    }
    println!(
        "all     measured reaches {tot}; predicted wires {w}: right way {}, honest {}; covers {} of what the measurement reaches",
        pc(r, w),
        pc(h, w),
        pc(cov, tot)
    );
}

/// One way of building the table, as the census tries it.
struct Variant {
    label: &'static str,
    levels: Vec<Level>,
    /// The fewest training columns a key needs to be kept.
    min: usize,
    /// Each coordinate's median over the key's columns, or else the mean.
    median: bool,
    /// Keep a knob for a control only where this share of its columns agree
    /// on the control's sign.
    gate: Option<f64>,
    /// Learned from the presets alone, as `make perform-wirings` would.
    presets_only: bool,
    /// Learned from the presets and one other session's pool: what `make
    /// perform-wirings` could learn from, since it boots the standard pool.
    one_pool: bool,
}

impl Variant {
    fn new(label: &'static str, levels: Vec<Level>, min: usize, median: bool) -> Self {
        Variant {
            label,
            levels,
            min,
            median,
            gate: None,
            presets_only: false,
            one_pool: false,
        }
    }
    fn gate(self, share: f64) -> Self {
        Variant {
            gate: Some(share),
            ..self
        }
    }
    fn one_pool(self) -> Self {
        Variant {
            one_pool: true,
            ..self
        }
    }
    fn presets(self) -> Self {
        Variant {
            presets_only: true,
            ..self
        }
    }
}

/// The shipped table's predictions on a fresh pool, by ear (`--shipped`).
fn shipped(seed: u64, threads: usize) {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/web/perform-wirings.json"
    );
    let file: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("the shipped wirings"))
            .expect("JSON");
    let table: KnobTable = serde_json::from_value(file["knobs"].clone()).expect("a knob table");
    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
    let cfg = SessionConfig {
        pool_size: 40,
        ..SessionConfig::default()
    };
    let mut e = Engine::new(PatchGrammarPrior::default(), cfg);
    e.begin_session();
    e.fill_pool(&mut rng);
    let trees: Vec<PatchTree> = e.pool.iter().map(|c| c.tree.clone()).collect();
    println!(
        "seed {seed}: {} pool sounds, the shipped table's {} keys",
        trees.len(),
        table.cols.len()
    );
    // Per control: [predicted wired, up, both, audible both, measured reaches, measured reaches & predicted wired]
    let tally = Mutex::new([[0usize; 6]; 6]);
    let next = Mutex::new(0usize);
    let (e, spec) = (&e, e.cfg.phrase.clone());
    let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
    let names = &names;
    std::thread::scope(|sc| {
        for _ in 0..threads {
            sc.spawn(|| loop {
                let i = {
                    let mut n = next.lock().unwrap();
                    *n += 1;
                    *n - 1
                };
                let Some(tree) = trees.get(i) else { return };
                let std = e.standardizer().expect("a standardizer");
                // The gated prediction: only the controls the table may wire.
                let predicted = e.wire_predicted(tree, &CONTROLS, &table);
                let measured = e
                    .wire_named(tree, &CONTROLS, &HashSet::new())
                    .map(|(_, w)| w);
                let along = |t: &PatchTree, c: usize| -> Option<f64> {
                    let (cf, _) =
                        auracle_features::featurize_memo(t, &spec, e.memo(), false).ok()?;
                    let z = standardized_audio(&cf.features, std);
                    Some(
                        direction(&CONTROLS[c], names)
                            .iter()
                            .zip(&z)
                            .map(|(a, b)| a * b)
                            .sum(),
                    )
                };
                let base = along(tree, 0).map(|_| ());
                let mut rows = [[0usize; 6]; 6];
                for c in 0..6 {
                    let reaches = measured.as_ref().is_some_and(|m| !m[c].search);
                    if reaches {
                        rows[c][4] += 1;
                    }
                    let Some((jac, wiring)) = predicted.as_ref() else {
                        continue;
                    };
                    let Some(k) = wiring.iter().position(|w| w.name == CONTROLS[c].name) else {
                        continue;
                    };
                    if base.is_none() {
                        continue;
                    }
                    rows[c][0] += 1;
                    if reaches {
                        rows[c][5] += 1;
                    }
                    let at = |turn: f64| -> Option<f64> {
                        let mut cs = vec![0.0; wiring.len()];
                        cs[k] = turn;
                        let mut t = tree.clone();
                        for (a, v) in apply(jac, wiring, &cs) {
                            t = set_param(&t, &a, ParamValue::Continuous(v)).ok()?;
                        }
                        along(&t, c)
                    };
                    let (Some(mid), Some(up), Some(down)) = (along(tree, c), at(1.0), at(-1.0))
                    else {
                        continue;
                    };
                    let (u, d) = (up - mid, mid - down);
                    if u > 0.0 {
                        rows[c][1] += 1;
                    }
                    if u > 0.0 && d > 0.0 {
                        rows[c][2] += 1;
                    }
                    if u >= REACH_FLOOR * 0.5 && d >= REACH_FLOOR * 0.5 {
                        rows[c][3] += 1;
                    }
                }
                let mut t = tally.lock().unwrap();
                for (a, b) in t.iter_mut().zip(rows) {
                    for (x, y) in a.iter_mut().zip(b) {
                        *x += y;
                    }
                }
            });
        }
    });
    let t = tally.into_inner().unwrap();
    println!(
        "{:<7} {:>8} {:>6} {:>6} {:>9} {:>9}",
        "control", "wired", "up", "both", "audible", "measured"
    );
    let pc = |a: usize, b: usize| {
        if b == 0 {
            "   -".to_string()
        } else {
            format!("{:>3.0}%", 100.0 * a as f64 / b as f64)
        }
    };
    let mut sum = [0usize; 6];
    for (c, row) in t.iter().enumerate() {
        println!(
            "{:<7} {:>8} {:>6} {:>6} {:>9} {:>9}",
            CONTROLS[c].name,
            row[0],
            pc(row[1], row[0]),
            pc(row[2], row[0]),
            pc(row[3], row[0]),
            row[4]
        );
        for (s, v) in sum.iter_mut().zip(row) {
            *s += v;
        }
    }
    println!(
        "all     {:>8} {:>6} {:>6} {:>9} {:>9}; of what the measurement reaches, predicted wires {}",
        sum[0],
        pc(sum[1], sum[0]),
        pc(sum[2], sum[0]),
        pc(sum[3], sum[0]),
        sum[4],
        pc(sum[5], sum[4])
    );
}

/// The gate's data as `make perform-wirings` can compute it (#290): the table
/// learned from the presets and one session's pool, each pool sound held out
/// in turn, every palette control wired on it alone from the prediction, and
/// how often the control it wires turns the named way on the sound's own
/// Jacobian (`along > 0`). Per seed, so the threshold is read across six
/// pools rather than the one the generator boots.
fn gate_sweep(sounds: &[Sound], groups: &[String]) {
    let levels = vec![
        Level::Site,
        Level::KindSite,
        Level::KindSiteDest,
        Level::KindSiteDestBin,
    ];
    let seeds: Vec<&String> = groups.iter().filter(|g| g.starts_with("seed")).collect();
    print!("{:<9}", "control");
    for g in &seeds {
        print!(" {:>12}", g);
    }
    println!(" {:>12}", "all");
    for (c, control) in PALETTE.iter().enumerate() {
        let mut all = (0usize, 0usize);
        print!("{:<9}", control.name);
        for g in &seeds {
            let mut n = (0usize, 0usize);
            let pool: Vec<&Sound> = sounds.iter().filter(|s| &s.group == *g).collect();
            for held in &pool {
                let train: Vec<&Sound> = sounds
                    .iter()
                    .filter(|s| s.group == "preset" || (&s.group == *g && s.name != held.name))
                    .collect();
                let t = Table::learn(&train, &levels, 3, true);
                let w = wire_set(
                    &predicted_jac(held, &t, None),
                    &PALETTE[c..=c],
                    SEMANTIC_RIDGE,
                )
                .remove(0);
                if w.search {
                    continue;
                }
                let tj = true_jac(held);
                let d = direction(control, &tj.names);
                let mut moved = vec![0.0; tj.names.len()];
                for (a, gain) in &w.knobs {
                    if let Some(i) = tj.addrs.iter().position(|x| x == a) {
                        for (m, v) in moved.iter_mut().zip(&tj.cols[i]) {
                            *m += v * gain;
                        }
                    }
                }
                let along: f64 = moved.iter().zip(&d).map(|(a, b)| a * b).sum();
                n.0 += 1;
                if along > 0.0 {
                    n.1 += 1;
                }
            }
            let _ = c;
            print!(
                " {:>5}/{:<2} {:>3.0}%",
                n.1,
                n.0,
                100.0 * n.1 as f64 / n.0.max(1) as f64
            );
            all.0 += n.0;
            all.1 += n.1;
        }
        println!(
            " {:>5}/{:<3} {:>3.0}%",
            all.1,
            all.0,
            100.0 * all.1 as f64 / all.0.max(1) as f64
        );
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "--shipped") {
        let seed = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(77);
        let threads = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(8);
        shipped(seed, threads);
        return;
    }
    let cache = args
        .first()
        .cloned()
        .unwrap_or_else(|| "wire_predict.json".into());
    let seeds: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(6);
    let threads: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(8);
    let sounds: Vec<Sound> = match std::fs::read_to_string(&cache) {
        Ok(text) => serde_json::from_str(&text).expect("cache"),
        Err(_) => {
            let v = build(seeds, threads);
            std::fs::write(&cache, serde_json::to_string(&v).unwrap()).expect("write cache");
            v
        }
    };
    let groups: Vec<String> = {
        let mut g: Vec<String> = sounds.iter().map(|s| s.group.clone()).collect();
        g.sort();
        g.dedup();
        g
    };
    let knobs: usize = sounds.iter().map(|s| s.knobs.len()).sum();
    println!(
        "{} sounds, {knobs} knobs, groups {:?}",
        sounds.len(),
        groups
    );
    if args.iter().any(|a| a == "--gate") {
        gate_sweep(&sounds, &groups);
        return;
    }
    let fine = || {
        vec![
            Level::Site,
            Level::KindSite,
            Level::KindSiteDest,
            Level::KindSiteDestBin,
        ]
    };
    let coarse = || vec![Level::Site, Level::KindSite];
    let variants = [
        Variant::new("site (the old table)", vec![Level::Site], 1, false),
        Variant::new("kind+site+dest+bin, mean", fine(), 3, false),
        Variant::new("kind+site+dest+bin, median", fine(), 3, true),
        Variant::new("median, signs agreeing 70%", fine(), 3, true).gate(0.7),
        Variant::new("median, signs agreeing 80%", fine(), 3, true).gate(0.8),
        Variant::new("presets only: kind+site+dest+bin, median", fine(), 3, true).presets(),
        Variant::new(
            "presets only: kind+site+dest+bin, median, min 2",
            fine(),
            2,
            true,
        )
        .presets(),
        Variant::new(
            "presets and one pool: kind+site+dest+bin, median",
            fine(),
            3,
            true,
        )
        .one_pool(),
        Variant::new("presets only: kind+site, median", coarse(), 3, true).presets(),
        Variant::new("presets only: kind+site, median, min 1", coarse(), 1, true).presets(),
    ];
    for v in &variants {
        let Variant {
            label,
            levels,
            min,
            median: med,
            gate,
            presets_only,
            one_pool,
        } = v;
        let (min, med, gate) = (*min, *med, *gate);
        let mut pool = Tally::default();
        let seeds: Vec<&String> = groups.iter().filter(|g| g.starts_with("seed")).collect();
        for (i, g) in seeds.iter().enumerate() {
            let other = seeds[(i + 1) % seeds.len()];
            let train: Vec<&Sound> = sounds
                .iter()
                .filter(|s| &s.group != *g && (!presets_only || s.group == "preset"))
                .filter(|s| !one_pool || s.group == "preset" || &s.group == other)
                .collect();
            let t = Table::learn(&train, levels, min, med);
            for s in sounds.iter().filter(|s| &s.group == *g) {
                judge(s, &t, gate, &mut pool);
            }
        }
        let mut presets = Tally::default();
        for s in sounds.iter().filter(|s| s.group == "preset") {
            let train: Vec<&Sound> = sounds
                .iter()
                .filter(|o| !(o.group == "preset" && o.name == s.name))
                .filter(|o| !presets_only || o.group == "preset")
                .filter(|o| !one_pool || o.group == "preset" || o.group == "seed0")
                .collect();
            let t = Table::learn(&train, levels, min, med);
            judge(s, &t, gate, &mut presets);
        }
        println!(
            "\n=== {label} (min {min}, {}) ===",
            if med { "median" } else { "mean" }
        );
        report("pool sounds, held out by session", &pool);
        report("presets, leave-one-out", &presets);
    }
}
