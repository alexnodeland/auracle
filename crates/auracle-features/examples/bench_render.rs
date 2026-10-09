//! What one phrase render costs, natively: the render benchmark
//! (`make bench-render`), and where a render's time goes.
//!
//! ```bash
//! cargo run -p auracle-features --example bench_render --release            # the bench
//! cargo run -p auracle-features --example bench_render --release -- --stages
//! cargo run -p auracle-features --example bench_render --release -- --bank   # every preset
//! ```
//!
//! **The set** is fixed, in `examples/bench_render.json` beside this file:
//! the six presets PERFORM's own tests play (`auracle-session`'s
//! `perform/tests.rs`: First Bass, Ceiling, Detune Dream, Long Way Down,
//! Glass Pad, Choirboy) and twelve vetted draws from the grammar's prior,
//! frozen as trees so that a change to a preset or to the prior does not move
//! the bench. `--write-set` writes it again from today's presets and prior
//! (and says so in the commit that does). Its wasm twin,
//! `auracle-wasm/examples/bench_render.mjs`, renders the same trees through
//! `farm_render`.
//!
//! **What a render is here** is the farm's job: [`featurize_memo`] with no
//! memo and no audio, the function `farm_render` and every featurization in
//! the engine run: compile, render the phrase, vet, normalize, φ, the face.
//!
//! **What is measured** is this thread's CPU time (`CLOCK_THREAD_CPUTIME_ID`),
//! not the wall clock, and the least of `--reps` repeats of each tree: a busy
//! machine stretches a render's wall time by however long the thread waited
//! for a core, and does not stretch its CPU time. Under load, an efficiency
//! core or a contended cache still slows the CPU time, so the least of the
//! repeats is the figure to read, and every table prints the load average it
//! ran under.
//!
//! Flags:
//!
//! - `--reps=N` (5): repeats of each tree; the least is reported.
//! - `--stages`: each tree's render split into its stages, each timed on its
//!   own (least of `--reps`): the term's domain check, compiling the main
//!   voice (and the chord voice), the DSP (the phrase's ticks: the render
//!   less its compiles), vetting, loudness normalization, φ's audio and
//!   structural features, the face, the f32 audition copy, the memo key.
//! - `--bank`: every preset instead of the set (with `--stages` too).
//! - `--loop=N`: render the set N times and print nothing per tree; what a
//!   sampling profiler is pointed at (`docs/notes/render-cost-2026-10/`).
//! - `--digest`: each tree's φ, vetting report and face as one FNV-1a hash,
//!   and one over the set: two builds whose digests agree measured the same
//!   numbers, bit for bit.
//! - `--allocs`: what one render allocates (a counting allocator wraps the
//!   system's for every mode; one relaxed atomic add per allocation): the
//!   compile, the render's ticks per sample, and the analysis.
//! - `--phi`: each tree's φ as JSON (`{"names": […], "rows": [{"name", "phi"}]}`),
//!   for `docs/notes/render-cost-2026-10/phi_moves.py` to say how far a
//!   change that moves the sound moves φ.
//! - `--write-set`: write the set file again from today's presets and prior.
use std::fmt::Write as _;
use std::path::PathBuf;

use auracle_features::{
    audio_features, featurize, featurize_memo, normalize_to, render_key, render_phrase,
    struct_features, vet, Face, PhraseSpec, RenderMemo, VetConfig, TARGET_LUFS,
};
use auracle_grammar::{
    compile_follower, compile_follower_for_render, compile_for_render, compile_with_input,
    PatchGrammarPrior, PatchTree,
};
use rand::rngs::StdRng;
use rand::SeedableRng;
use serde::{Deserialize, Serialize};

/// The system allocator, counting: how many allocations and how many bytes,
/// for `--allocs`.
struct Counting;
static ALLOCS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
static BYTES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
// SAFETY: every call is forwarded to the system allocator unchanged.
unsafe impl std::alloc::GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        BYTES.fetch_add(layout.size(), std::sync::atomic::Ordering::Relaxed);
        std::alloc::System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        std::alloc::System.dealloc(ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, size: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        BYTES.fetch_add(size, std::sync::atomic::Ordering::Relaxed);
        std::alloc::System.realloc(ptr, layout, size)
    }
}
#[global_allocator]
static GLOBAL: Counting = Counting;

/// Allocations and bytes `f` made.
fn counted<T>(f: impl FnOnce() -> T) -> (usize, usize, T) {
    let (a, b) = (
        ALLOCS.load(std::sync::atomic::Ordering::Relaxed),
        BYTES.load(std::sync::atomic::Ordering::Relaxed),
    );
    let out = f();
    (
        ALLOCS.load(std::sync::atomic::Ordering::Relaxed) - a,
        BYTES.load(std::sync::atomic::Ordering::Relaxed) - b,
        out,
    )
}

/// What one render of each tree allocates: compiling its voices, the
/// render's ticks (the render less its compiles, per sample), and the
/// analysis (vetting, loudness, φ, the face).
fn allocs(set: &[Entry], spec: &PhraseSpec) {
    let samples = spec.total_samples();
    let chords: usize = spec.notes.iter().map(|n| n.chord.len()).sum();
    println!(
        "{:<20} {:>10} {:>12} {:>14} {:>12} {:>12}",
        "tree", "compile", "compile KB", "ticks/sample", "analysis", "analysis KB"
    );
    for e in set {
        let (ca, cb, _) = counted(|| compile_for_render(&e.tree, spec.sample_rate, None));
        let (fa, fb, _) = counted(|| compile_follower_for_render(&e.tree, spec.sample_rate, None));
        let (ra, _, r) = counted(|| render_phrase(&e.tree, spec).expect("renders"));
        let compiles = ca + fa * chords;
        let ticks = ra.saturating_sub(compiles);
        let (aa, ab, _) = counted(|| {
            let mut x = r.clone();
            let cfg = VetConfig::for_spec(spec);
            let _ = vet(&x.samples, &cfg);
            normalize_to(&mut x.samples, x.sample_rate, TARGET_LUFS);
            (audio_features(&x), Face::of_f64(&x.samples, x.sample_rate))
        });
        println!(
            "{:<20} {:>10} {:>12.0} {:>14.5} {:>12} {:>12.0}",
            truncate(&e.name, 20),
            compiles,
            (cb + fb * chords) as f64 / 1024.0,
            ticks as f64 / samples as f64,
            aa,
            ab as f64 / 1024.0
        );
    }
}

/// PERFORM's sounds: the presets `auracle-session`'s PERFORM tests play.
const PERFORM_SIX: [&str; 6] = [
    "First Bass",
    "Ceiling",
    "Detune Dream",
    "Long Way Down",
    "Glass Pad",
    "Choirboy",
];
/// Vetted prior draws in the set, and the seed they are drawn from.
const POOL: usize = 12;
const POOL_SEED: u64 = 20_261_006;

#[derive(Serialize, Deserialize)]
struct Entry {
    name: String,
    tree: PatchTree,
}

#[derive(Serialize, Deserialize)]
struct BenchSet {
    about: String,
    trees: Vec<Entry>,
}

fn set_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("examples/bench_render.json")
}

/// This thread's CPU time, in ms.
fn cpu_ms() -> f64 {
    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `ts` is a valid, writable timespec for the call's duration.
    let rc = unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut ts) };
    assert_eq!(rc, 0, "clock_gettime(CLOCK_THREAD_CPUTIME_ID) failed");
    ts.tv_sec as f64 * 1e3 + ts.tv_nsec as f64 / 1e6
}

/// The least CPU time of `reps` runs of `f`, in ms.
fn least<T>(reps: usize, mut f: impl FnMut() -> T) -> f64 {
    let mut best = f64::INFINITY;
    for _ in 0..reps.max(1) {
        let t = cpu_ms();
        std::hint::black_box(f());
        best = best.min(cpu_ms() - t);
    }
    best
}

fn load() -> String {
    let mut avg = [0f64; 3];
    // SAFETY: `avg` holds the three doubles getloadavg writes.
    let n = unsafe { libc::getloadavg(avg.as_mut_ptr(), 3) };
    if n < 1 {
        return "unknown".into();
    }
    format!("{:.0} {:.0} {:.0}", avg[0], avg[1], avg[2])
}

fn cores() -> usize {
    std::thread::available_parallelism().map_or(0, |n| n.get())
}

fn fnv(state: u64, bytes: &[u8]) -> u64 {
    bytes.iter().fold(state, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}
const FNV0: u64 = 0xcbf2_9ce4_8422_2325;

fn write_set() {
    let bank = auracle_grammar::preset_bank();
    let mut trees = Vec::new();
    for name in PERFORM_SIX {
        let p = bank
            .iter()
            .find(|p| p.name == name)
            .unwrap_or_else(|| panic!("no preset named {name}"));
        trees.push(Entry {
            name: name.to_string(),
            tree: p.tree.clone(),
        });
    }
    let spec = PhraseSpec::default();
    let prior = PatchGrammarPrior::default();
    let mut rng = StdRng::seed_from_u64(POOL_SEED);
    let mut drawn = 0;
    while trees.len() < PERFORM_SIX.len() + POOL {
        let tree = prior.sample_with_rng(&mut rng);
        drawn += 1;
        if featurize(&tree, &spec).is_ok() {
            trees.push(Entry {
                name: format!("draw {drawn}"),
                tree,
            });
        }
    }
    let set = BenchSet {
        about: format!(
            "The render benchmark's fixed set (crates/auracle-features/examples/bench_render.rs): \
             the six presets PERFORM's tests play, then the first {POOL} vetted draws of \
             PatchGrammarPrior::default().sample_with_rng(StdRng::seed_from_u64({POOL_SEED})), \
             frozen as trees. Written by --write-set."
        ),
        trees,
    };
    let text = serde_json::to_string_pretty(&set).expect("the set serializes");
    std::fs::write(set_path(), text + "\n").expect("the set is written");
    println!(
        "wrote {} ({} trees, {drawn} draws for {POOL} vetted)",
        set_path().display(),
        set.trees.len()
    );
}

fn read_set() -> Vec<Entry> {
    let text = std::fs::read_to_string(set_path())
        .unwrap_or_else(|e| panic!("{}: {e} (run with --write-set)", set_path().display()));
    let set: BenchSet = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("{}: {e} (run with --write-set)", set_path().display()));
    set.trees
}

fn bank() -> Vec<Entry> {
    auracle_grammar::preset_bank()
        .into_iter()
        .map(|p| Entry {
            name: p.name.to_string(),
            tree: p.tree,
        })
        .collect()
}

/// The farm's job on `tree`: what `farm_render` runs, without the JSON.
fn farm_job(tree: &PatchTree, spec: &PhraseSpec) -> bool {
    featurize_memo(tree, spec, &RenderMemo::disabled(), false).is_ok()
}

/// The stages of one render, each the least of `reps`, in ms, in the order
/// [`STAGES`] names them.
fn stages(tree: &PatchTree, spec: &PhraseSpec, reps: usize) -> [f64; 13] {
    let sr = spec.sample_rate;
    let chord_voices: usize = spec.notes.iter().map(|n| n.chord.len()).sum();
    let domain = least(reps, || tree.domain_violations());
    let compile = least(reps, || compile_with_input(tree, sr, None).is_ok());
    let follower = least(reps, || compile_follower(tree, sr, None).is_ok()) * chord_voices as f64;
    let render = least(reps, || render_phrase(tree, spec).is_ok());
    let rendered = render_phrase(tree, spec).expect("a tree of the set compiles");
    let cfg = VetConfig::for_spec(spec);
    let vetting = least(reps, || vet(&rendered.samples, &cfg).is_ok());
    let normalize = least(reps, || {
        let mut s = rendered.samples.clone();
        normalize_to(&mut s, rendered.sample_rate, TARGET_LUFS)
    });
    let mut normalized = rendered.clone();
    normalize_to(&mut normalized.samples, normalized.sample_rate, TARGET_LUFS);
    let audio = least(reps, || audio_features(&normalized));
    let structural = least(reps, || struct_features(tree));
    let face = least(reps, || {
        Face::of_f64(&normalized.samples, normalized.sample_rate)
    });
    let audition = least(reps, || normalized.to_audition());
    let key = least(reps, || render_key(tree, spec));
    // The farm's JSON: the tree parsed from what the worker posts, and the
    // reply (`CachedFeatures`) written for it.
    let text = serde_json::to_string(tree).expect("serializes");
    let (cached, _) = featurize_memo(tree, spec, &RenderMemo::disabled(), false)
        .expect("a tree of the set renders");
    let wire = least(reps, || {
        let t: PatchTree = serde_json::from_str(&text).expect("parses");
        (t, serde_json::to_string(&cached).expect("serializes"))
    });
    let total = least(reps, || farm_job(tree, spec));
    [
        total,
        domain,
        compile,
        follower,
        (render - compile - follower).max(0.0),
        vetting,
        normalize,
        audio,
        structural,
        face,
        audition,
        key,
        wire,
    ]
}

const STAGES: [&str; 13] = [
    "farm job",
    "domain",
    "compile",
    "chord cmp",
    "DSP",
    "vet",
    "normalize",
    "φ audio",
    "φ struct",
    "face",
    "f32 copy",
    "memo key",
    "json",
];

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |name: &str| args.iter().any(|a| a == name);
    let value = |name: &str| {
        args.iter()
            .find_map(|a| a.strip_prefix(&format!("{name}=")).map(str::to_string))
    };
    if flag("--write-set") {
        write_set();
        return;
    }
    let reps: usize = value("--reps").map_or(5, |v| v.parse().expect("--reps=N"));
    let set = if flag("--bank") { bank() } else { read_set() };
    let spec = PhraseSpec::default();
    let seconds = spec.total_seconds();

    if let Some(n) = value("--loop") {
        let n: usize = n.parse().expect("--loop=N");
        let t = cpu_ms();
        for _ in 0..n {
            for e in &set {
                std::hint::black_box(farm_job(&e.tree, &spec));
            }
        }
        let ms = cpu_ms() - t;
        println!(
            "{} renders, {:.1} ms CPU each (mean), load {}",
            n * set.len(),
            ms / (n * set.len()) as f64,
            load()
        );
        return;
    }

    if flag("--kinds") || value("--kinds").is_some() {
        kinds(reps, value("--kinds"));
        return;
    }

    if let Some(n) = value("--census") {
        census(n.parse().expect("--census=N"), &spec);
        return;
    }

    if flag("--nodes") {
        nodes(&set, &spec);
        return;
    }

    if flag("--allocs") {
        allocs(&set, &spec);
        return;
    }

    if flag("--phi") {
        #[derive(Serialize)]
        struct Row<'a> {
            name: &'a str,
            phi: Option<Vec<f64>>,
        }
        let rows: Vec<Row> = set
            .iter()
            .map(|e| Row {
                name: &e.name,
                phi: featurize(&e.tree, &spec).ok().map(|v| v.features.phi()),
            })
            .collect();
        #[derive(Serialize)]
        struct Phi<'a> {
            names: Vec<&'static str>,
            rows: Vec<Row<'a>>,
        }
        let out = Phi {
            names: auracle_features::Features::phi_names(),
            rows,
        };
        println!("{}", serde_json::to_string(&out).expect("serializes"));
        return;
    }

    if flag("--digest") {
        let mut all = FNV0;
        for e in &set {
            let line = match featurize_memo(&e.tree, &spec, &RenderMemo::disabled(), false) {
                Ok((cached, _)) => {
                    serde_json::to_string(&(&cached.features, &cached.face, &cached.note_onsets))
                        .expect("features serialize")
                }
                Err(err) => format!("refused: {err}"),
            };
            let h = fnv(FNV0, line.as_bytes());
            all = fnv(all, &h.to_le_bytes());
            println!("{:016x}  {}", h, e.name);
        }
        println!("{all:016x}  the set");
        return;
    }

    println!(
        "bench_render (native): {} trees, the standard phrase ({seconds:.2} s at {} Hz), \
         least of {reps}, this thread's CPU ms",
        set.len(),
        spec.sample_rate
    );
    println!("load average {} on {} cores, before", load(), cores());
    if flag("--stages") {
        let mut head = format!("{:<16}", "tree");
        for s in STAGES {
            let _ = write!(head, "{s:>10}");
        }
        println!("{head}");
        let mut sums = [0.0f64; 13];
        for e in &set {
            let row = stages(&e.tree, &spec, reps);
            let mut line = format!("{:<16}", truncate(&e.name, 16));
            for (s, v) in sums.iter_mut().zip(row) {
                *s += v;
                let _ = write!(line, "{v:>10.2}");
            }
            println!("{line}");
        }
        let mut line = format!("{:<16}", "sum");
        for v in sums {
            let _ = write!(line, "{v:>10.1}");
        }
        println!("{line}");
        let mut line = format!("{:<16}", "share of job");
        for v in sums {
            let _ = write!(line, "{:>9.1}%", 100.0 * v / sums[0]);
        }
        println!("{line}");
        let staged: f64 = sums[1..].iter().sum();
        println!(
            "the stages but json sum to {:.1}% of the farm job (the rest: seeding, the phrase \
             loop's bookkeeping, the vet config, allocation of the memo entry); json is the \
             farm's, on top of the job",
            100.0 * (staged - sums[12]) / sums[0]
        );
    } else {
        println!("{:<20} {:>9} {:>14}", "tree", "ms", "ms per s audio");
        let mut ms = Vec::new();
        for e in &set {
            let t = least(reps, || farm_job(&e.tree, &spec));
            println!(
                "{:<20} {:>9.1} {:>14.1}",
                truncate(&e.name, 20),
                t,
                t / seconds
            );
            ms.push(t);
        }
        summary(&mut ms);
    }
    println!("load average {}, after", load());
}

/// What each tree compiles to: its nodes (each one a step of quiver's graph
/// walk every sample), how many are live knobs (`ExternalInput`s the panel
/// writes), how many of those feed a port no other cable reaches (a knob a
/// render could pin as a constant), and the module kinds by count.
fn nodes(set: &[Entry], spec: &PhraseSpec) {
    use std::collections::{BTreeMap, HashMap};
    println!(
        "{:<20} {:>6} {:>6} {:>8} {:>7} {:>8}",
        "tree", "nodes", "knobs", "pinnable", "cables", "rendered"
    );
    let mut kinds: BTreeMap<&'static str, usize> = BTreeMap::new();
    let (mut all, mut knobs, mut pinnable) = (0, 0, 0);
    for e in set {
        let voice = compile_with_input(&e.tree, spec.sample_rate, None).expect("compiles");
        let patch = &voice.patch;
        let mut fan_in: HashMap<_, usize> = HashMap::new();
        for c in patch.cables() {
            *fan_in.entry(c.to).or_default() += 1;
        }
        let (mut n, mut k, mut p) = (0, 0, 0);
        for (id, _, m) in patch.nodes() {
            n += 1;
            *kinds.entry(m.type_id()).or_default() += 1;
            if m.type_id() == "external_input" {
                k += 1;
                let alone = patch
                    .cables()
                    .iter()
                    .filter(|c| c.from.node == id)
                    .all(|c| fan_in.get(&c.to) == Some(&1));
                if alone {
                    p += 1;
                }
            }
        }
        // What a measurement render walks: the voice with its knobs folded.
        let rendered = compile_for_render(&e.tree, spec.sample_rate, None)
            .expect("compiles")
            .patch
            .node_count();
        println!(
            "{:<20} {n:>6} {k:>6} {p:>8} {:>7} {rendered:>8}",
            truncate(&e.name, 20),
            patch.cable_count()
        );
        all += n;
        knobs += k;
        pinnable += p;
    }
    println!(
        "set: {all} nodes, {knobs} knobs ({:.0}%), {pinnable} pinnable ({:.0}%)",
        100.0 * knobs as f64 / all as f64,
        100.0 * pinnable as f64 / all as f64
    );
    let mut by: Vec<_> = kinds.into_iter().collect();
    by.sort_by_key(|k| std::cmp::Reverse(k.1));
    for (k, n) in by {
        println!("{n:>6}  {k}");
    }
}

/// One voice of every module kind the grammar has: a saw voice, then each
/// source in its place (`StructOp::Replace`), each processor inserted over it
/// (`StructOp::Insert`, the module a player's insert makes), the ladder (a
/// filter's kind is a knob, not an insert), and each modulation on the saw's
/// slot (`StructOp::SetMod`).
fn kind_trees() -> Vec<(String, PatchTree)> {
    use auracle_grammar::term::{AmpEnv, AudioNode, FilterKind, ModNode, Uid, Waveform};
    use auracle_grammar::{apply_struct_op, ModKind, NodeKind, StructOp};
    let base = PatchTree {
        amp: AmpEnv {
            attack: 0.05,
            decay: 0.3,
            sustain: 0.8,
            release: 0.3,
        },
        root: AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Saw,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.5,
            modulation: ModNode::None,
        },
    };
    let node = "node".to_string();
    let mut out = vec![("saw voice".to_string(), base.clone())];
    for kind in NodeKind::ALL {
        let op = if kind.is_source() {
            StructOp::Replace {
                key: node.clone(),
                kind,
            }
        } else {
            StructOp::Insert {
                key: node.clone(),
                kind,
            }
        };
        let Ok(tree) = apply_struct_op(&base, &op) else {
            continue;
        };
        if let AudioNode::Filter { kind: k, .. } = &tree.root {
            let mut ladder = tree.clone();
            if let AudioNode::Filter { kind, .. } = &mut ladder.root {
                *kind = FilterKind::Ladder;
            }
            out.push((format!("{kind:?} {k:?}"), tree.clone()));
            out.push(("Filter Ladder".to_string(), ladder));
            continue;
        }
        out.push((format!("{kind:?}"), tree));
    }
    for kind in ModKind::ALL.into_iter().skip(1) {
        let op = StructOp::SetMod {
            key: node.clone(),
            kind,
        };
        if let Ok(tree) = apply_struct_op(&base, &op) {
            out.push((format!("mod {kind:?}"), tree));
        }
    }
    out
}

/// What one voice of each module kind costs: [`kind_trees`], each compiled
/// as the live voice is (every knob live) and as a render's voice is (knobs
/// folded), held on C4 for a second and ticked in 128-frame blocks, in this
/// thread's CPU ms per second of one voice (the least of `reps`), and what it adds to the saw voice it is
/// built on. With `path`, the trees are written there as the set file is,
/// for `auracle-wasm/examples/voice_cost.mjs`.
fn kinds(reps: usize, path: Option<String>) {
    let trees = kind_trees();
    if let Some(path) = path {
        let set = BenchSet {
            about: "One voice of each module kind (bench_render.rs --kinds).".to_string(),
            trees: trees
                .iter()
                .map(|(name, tree)| Entry {
                    name: name.clone(),
                    tree: tree.clone(),
                })
                .collect(),
        };
        let text = serde_json::to_string_pretty(&set).expect("serializes");
        std::fs::write(&path, text + "\n").expect("written");
        println!("wrote {path} ({} trees)", set.trees.len());
        return;
    }
    let sr = 44_100.0;
    let second = |tree: &PatchTree, render: bool| {
        least(reps, || {
            quiver::rng::seed(1);
            let mut v = if render {
                compile_for_render(tree, sr, None)
            } else {
                compile_with_input(tree, sr, None)
            }
            .expect("compiles");
            v.gate.set(5.0);
            // In blocks of the worklet's quantum, as the live voice and a
            // render tick (`tick_block`).
            let (mut l, mut r) = ([0.0; 128], [0.0; 128]);
            let (mut s, mut left) = (0.0, sr as usize);
            while left > 0 {
                let n = left.min(128);
                v.patch.tick_block(&mut l[..n], &mut r[..n]);
                s += l[..n].iter().sum::<f64>();
                left -= n;
            }
            s
        })
    };
    println!(
        "one voice of each module kind, held on C4 for 1 s at {sr} Hz: this thread's CPU ms \
         per voice-second (least of {reps}); load average {} on {} cores",
        load(),
        cores()
    );
    println!(
        "{:<22} {:>6} {:>9} {:>9} {:>9} {:>9}",
        "kind", "nodes", "live", "+ on saw", "render", "+ on saw"
    );
    let (mut base_live, mut base_render) = (0.0, 0.0);
    for (i, (name, tree)) in trees.iter().enumerate() {
        let nodes = compile_with_input(tree, sr, None)
            .expect("compiles")
            .patch
            .node_count();
        let (live, render) = (second(tree, false), second(tree, true));
        if i == 0 {
            (base_live, base_render) = (live, render);
        }
        println!(
            "{:<22} {nodes:>6} {live:>9.1} {:>9.1} {render:>9.1} {:>9.1}",
            truncate(name, 22),
            live - base_live,
            render - base_render
        );
    }
    println!("load average {}, after", load());
}

/// Over `n` draws of the prior (from [`POOL_SEED`]): the nodes a full compile
/// and a render's compile walk, and the draws whose knobs could not be
/// folded without moving the patch's schedule (the render compile fell back
/// to the full voice), with the first few such draws' trees.
fn census(n: usize, spec: &PhraseSpec) {
    let prior = PatchGrammarPrior::default();
    let mut rng = StdRng::seed_from_u64(POOL_SEED);
    let (mut full, mut walked, mut fell, mut knobbed) = (0, 0, 0, 0);
    // Live knobs (the nodes the compiler names `…!`, but for STEPS'
    // transport, `…:sync!`, a live handle that is no knob and is never
    // folded) in the voices a render folds, and how many of them it folded.
    let (mut knobs, mut folded) = (0, 0);
    let knob_count = |p: &quiver::prelude::Patch| {
        p.nodes()
            .filter(|(_, n, _)| n.ends_with('!') && !n.ends_with(":sync!"))
            .count()
    };
    for i in 0..n {
        let tree = prior.sample_with_rng(&mut rng);
        let Ok(voice) = compile_with_input(&tree, spec.sample_rate, None) else {
            continue;
        };
        let render = compile_for_render(&tree, spec.sample_rate, None).expect("compiles");
        let (a, b) = (voice.patch.node_count(), render.patch.node_count());
        full += a;
        walked += b;
        if a == b {
            fell += 1;
            if fell <= 3 {
                println!(
                    "draw {}: left whole: {}",
                    i + 1,
                    serde_json::to_string(&tree).expect("serializes")
                );
            }
        } else {
            knobbed += 1;
            knobs += knob_count(&voice.patch);
            folded += knob_count(&voice.patch) - knob_count(&render.patch);
        }
    }
    println!(
        "{n} draws: {full} nodes compiled, {walked} walked by a render ({:.0}%); \
         {fell} left whole (the fold would have moved the schedule); in the {knobbed} folded, \
         {folded} of {knobs} knobs folded ({:.1}%)",
        100.0 * walked as f64 / full as f64,
        100.0 * folded as f64 / knobs as f64
    );
}

fn summary(ms: &mut [f64]) {
    let n = ms.len();
    let total: f64 = ms.iter().sum();
    ms.sort_by(f64::total_cmp);
    println!(
        "set: {n} renders, {total:.0} ms in all, mean {:.1}, median {:.1}, least {:.1}, most {:.1} ms per render",
        total / n as f64,
        ms[n / 2],
        ms[0],
        ms[n - 1]
    );
}

fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}
