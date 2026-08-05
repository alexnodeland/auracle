//! Calibration: run the featurize pipeline over many prior draws and report
//! what the first generation is actually *made of*, what the vetting gate
//! silences, and how collinear φ is. Informs the vet-threshold open question
//! in the reference's *Open questions*, and the production-weight one in the
//! same section.
//!
//! ```bash
//! # render sample (default 200), then a cheap composition sample (default 2000)
//! cargo run -p auracle-features --example pipeline_stats --release -- 200
//! cargo run -p auracle-features --example pipeline_stats --release -- 300 2000
//! ```
//!
//! Four sections, in the order a palette change should be read:
//!
//! 1. **Composition** — the empirical distribution over source / op / mod
//!    kinds under the default prior, plus mean term size, depth and **trace
//!    site count**. The op distribution is the one that has to be checked by
//!    eye after any palette change: the production weights are a claim about
//!    what generation one sounds like, and a uniform-ish pad over ten
//!    operators cashes out as bitcrushed ring-mod mush. The site count is the
//!    MH proposal surface — `adaptive_single_site_mh` picks one site uniformly
//!    per step, so a term with more sites needs proportionally more steps to
//!    give any *given* site the same chance of moving, which is what sets
//!    `SessionConfig::refine_steps`.
//! 2. **Quarantine, per kind** — the aggregate pass rate, then, for each
//!    module kind, the quarantine rate over the draws that *contain* one.
//!    A kind quarantined far above base rate never reaches the taste model:
//!    the user is never played it, so no vote is ever cast about it, so its
//!    coefficient stays at the prior forever.
//! 3. **Feature ranges** — min/mean/max per φ coordinate.
//! 4. **VIF** — collinearity; see [`auracle_features::structural`].

use auracle_features::{
    featurize, struct_features, Features, FeaturizeError, PhraseSpec, StructFeatures, VetFailure,
};
use auracle_grammar::PatchGrammarPrior;
use fugue::runtime::handler::run;
use fugue::runtime::interpreters::PriorHandler;
use fugue::Trace;
use fugue_evo::inference::prior::GenomePrior;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// How to read one module kind's count off [`StructFeatures`].
type Counter = fn(&StructFeatures) -> f64;

/// The per-kind counters, in the order the report prints them. Named here
/// rather than derived from φ, because φ collapses several of these into
/// families and this report is exactly the place you want them apart.
const KINDS: [(&str, Counter); 41] = [
    ("vco", |f| f.n_vco),
    ("supersaw", |f| f.n_supersaw),
    ("noise", |f| f.n_noise),
    ("wavetable", |f| f.n_wavetable),
    ("pluck", |f| f.n_pluck),
    ("formant", |f| f.n_formant),
    ("mix", |f| f.n_mix),
    ("filter", |f| f.n_filter),
    ("fold", |f| f.n_fold),
    ("delay", |f| f.n_delay),
    ("chorus", |f| f.n_chorus),
    ("reverb", |f| f.n_reverb),
    ("distortion", |f| f.n_distortion),
    ("bitcrush", |f| f.n_bitcrush),
    ("phaser", |f| f.n_phaser),
    ("ringmod", |f| f.n_ringmod),
    ("flanger", |f| f.n_flanger),
    ("tremolo", |f| f.n_tremolo),
    ("vibrato", |f| f.n_vibrato),
    ("eq", |f| f.n_eq),
    ("granular", |f| f.n_granular),
    ("shift", |f| f.n_shift),
    ("comp", |f| f.n_comp),
    ("duck", |f| f.n_duck),
    ("gate", |f| f.n_gate),
    ("vocoder", |f| f.n_vocoder),
    ("lfo", |f| f.n_lfo),
    ("env", |f| f.n_env),
    ("rand", |f| f.n_rand),
    ("follow", |f| f.n_follow),
    ("euclid", |f| f.n_euclid),
    ("quantize", |f| f.n_quantize),
    ("slew", |f| f.n_slew),
    ("rectify", |f| f.n_rectify),
    ("hold", |f| f.n_hold),
    ("min", |f| f.n_min),
    ("max", |f| f.n_max),
    ("and", |f| f.n_and),
    ("or", |f| f.n_or),
    ("xor", |f| f.n_xor),
    ("switch", |f| f.n_switch),
];

/// Sources and ops, split out so each can be reported as a share of its own
/// categorical rather than of all nodes.
const SOURCE_KINDS: [&str; 6] = ["vco", "supersaw", "noise", "wavetable", "pluck", "formant"];
const OP_KINDS: [&str; 20] = [
    "mix",
    "filter",
    "fold",
    "delay",
    "chorus",
    "reverb",
    "distortion",
    "bitcrush",
    "phaser",
    "ringmod",
    "flanger",
    "tremolo",
    "vibrato",
    "eq",
    "granular",
    "shift",
    "comp",
    "duck",
    "gate",
    "vocoder",
];
/// The `#mod` categorical's five filled leaf kinds plus its two recursive
/// productions — the histogram a palette change has to be read against.
const MOD_KINDS: [&str; 7] = ["lfo", "env", "rand", "follow", "euclid", "op", "pair"];
/// `#modop`, in categorical index order.
const MODOP_KINDS: [&str; 4] = ["quantize", "slew", "rectify", "hold"];
/// `#pairop`, in categorical index order.
const PAIROP_KINDS: [&str; 6] = ["min", "max", "and", "or", "xor", "switch"];

fn count(f: &StructFeatures, kind: &str) -> f64 {
    // `op` and `pair` are not raw counters — they are the two recursive
    // productions, and what a `#mod` histogram wants is how often each was
    // *drawn*, which is the sum over the kinds it can expand into.
    match kind {
        "op" => return MODOP_KINDS.iter().map(|k| count(f, k)).sum(),
        "pair" => return PAIROP_KINDS.iter().map(|k| count(f, k)).sum(),
        _ => {}
    }
    KINDS
        .iter()
        .find(|(n, _)| *n == kind)
        .map(|(_, g)| g(f))
        .unwrap_or(0.0)
}

/// Composition of the first generation: no compile, no render, so this can
/// afford a far bigger sample than the pipeline section.
fn composition(prior: &PatchGrammarPrior, n: usize) {
    let mut rng = StdRng::seed_from_u64(0xC0FFEE);
    let mut fs: Vec<StructFeatures> = Vec::with_capacity(n);
    let mut sites: Vec<f64> = Vec::with_capacity(n);
    for _ in 0..n {
        let (tree, trace) = run(
            PriorHandler {
                rng: &mut rng,
                trace: Trace::default(),
            },
            prior.model(),
        );
        fs.push(struct_features(&tree));
        sites.push(trace.choices.len() as f64);
    }
    let mean =
        |g: &dyn Fn(&StructFeatures) -> f64| fs.iter().map(&g).sum::<f64>() / fs.len() as f64;

    println!("== composition over {n} prior draws (no render) ==");
    println!(
        "mean size {:.2}   mean depth {:.2}   mean trace sites {:.1}   \
         mean mod slots filled {:.1}%",
        mean(&|f| f.size),
        mean(&|f| f.depth),
        sites.iter().sum::<f64>() / sites.len() as f64,
        100.0 * mean(&|f| f.mod_density),
    );
    // Modulation is a recursive sort as of wave 2C, so its chain length is a
    // number the palette has to be read against in its own right: this is the
    // quantity `max_mod_depth` bounds, averaged over the slots that carry a
    // term at all.
    let modulated: Vec<&StructFeatures> = fs.iter().filter(|f| f.mod_depth_mean > 0.0).collect();
    println!(
        "mean mod-tree depth {:.3} (over filled slots)   \
         patches with a shaped mod term {:.1}%",
        modulated.iter().map(|f| f.mod_depth_mean).sum::<f64>() / modulated.len().max(1) as f64,
        100.0
            * fs.iter()
                .filter(|f| f.n_mod_shape() + f.n_mod_logic() > 0.0)
                .count() as f64
            / fs.len() as f64,
    );
    println!();

    for (label, kinds, total) in [
        (
            "source",
            &SOURCE_KINDS[..],
            SOURCE_KINDS
                .iter()
                .map(|k| mean(&|f| count(f, k)))
                .sum::<f64>(),
        ),
        (
            "op",
            &OP_KINDS[..],
            OP_KINDS.iter().map(|k| mean(&|f| count(f, k))).sum::<f64>(),
        ),
        (
            "mod",
            &MOD_KINDS[..],
            MOD_KINDS
                .iter()
                .map(|k| mean(&|f| count(f, k)))
                .sum::<f64>(),
        ),
        (
            "modop",
            &MODOP_KINDS[..],
            MODOP_KINDS
                .iter()
                .map(|k| mean(&|f| count(f, k)))
                .sum::<f64>(),
        ),
        (
            "pairop",
            &PAIROP_KINDS[..],
            PAIROP_KINDS
                .iter()
                .map(|k| mean(&|f| count(f, k)))
                .sum::<f64>(),
        ),
    ] {
        println!(
            "{:<11} {:>9} {:>9} {:>11}",
            format!("{label} kind"),
            "per patch",
            "share",
            "in ≥1 patch"
        );
        for k in kinds {
            let m = mean(&|f| count(f, k));
            let present = fs.iter().filter(|f| count(f, k) > 0.0).count() as f64 / fs.len() as f64;
            println!(
                "  {k:<9} {m:>9.3} {:>8.1}% {:>10.1}%",
                100.0 * m / total.max(1e-12),
                100.0 * present
            );
        }
        println!("  {:<9} {total:>9.3}", "(total)");
        println!();
    }
}

fn main() {
    let n: usize = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(200);
    let n_compose: usize = std::env::args()
        .nth(2)
        .and_then(|a| a.parse().ok())
        .unwrap_or(2000);
    let spec = PhraseSpec::default();
    let prior = PatchGrammarPrior::default();

    composition(&prior, n_compose);

    let mut rng = StdRng::seed_from_u64(0xCA11B);
    let (mut ok, mut silent, mut over, mut dc, mut nonfinite) = (0, 0, 0, 0, 0);
    let mut phis: Vec<Vec<f64>> = Vec::new();
    // Per kind: (draws containing it, of those, draws quarantined).
    let mut seen = [0usize; KINDS.len()];
    let mut lost = [0usize; KINDS.len()];
    for _ in 0..n {
        let (tree, _) = run(
            PriorHandler {
                rng: &mut rng,
                trace: Trace::default(),
            },
            prior.model(),
        );
        let sf = struct_features(&tree);
        let quarantined = match featurize(&tree, &spec) {
            Ok(v) => {
                ok += 1;
                phis.push(v.features.phi());
                false
            }
            Err(FeaturizeError::Quarantined(f)) => {
                match f {
                    VetFailure::Silent { .. } => silent += 1,
                    VetFailure::Overlevel { .. } => over += 1,
                    VetFailure::DcDominated { .. } => dc += 1,
                    VetFailure::NonFinite => nonfinite += 1,
                }
                true
            }
            Err(e) => panic!("unexpected: {e}"),
        };
        for (i, (_, g)) in KINDS.iter().enumerate() {
            if g(&sf) > 0.0 {
                seen[i] += 1;
                lost[i] += usize::from(quarantined);
            }
        }
    }

    println!("== pipeline over {n} prior draws ==");
    println!("featurized:    {ok} ({:.0}%)", 100.0 * ok as f64 / n as f64);
    println!("quarantined:   silent={silent} overlevel={over} dc={dc} nonfinite={nonfinite}");
    let base = 100.0 * (n - ok) as f64 / n as f64;
    println!("base quarantine rate: {base:.1}%");
    println!();
    println!(
        "{:<12} {:>9} {:>13} {:>10}",
        "kind", "in N draws", "quarantined", "vs base"
    );
    for (i, (name, _)) in KINDS.iter().enumerate() {
        if seen[i] == 0 {
            println!("{name:<12} {:>9} {:>13} {:>10}", 0, "—", "—");
            continue;
        }
        let rate = 100.0 * lost[i] as f64 / seen[i] as f64;
        println!(
            "{name:<12} {:>9} {rate:>12.1}% {:>+9.1}{}",
            seen[i],
            rate - base,
            if rate - base > 10.0 {
                "  <-- silenced"
            } else {
                ""
            }
        );
    }
    println!();
    let names = Features::phi_names();
    println!("{:<16} {:>9} {:>9} {:>9}", "feature", "min", "mean", "max");
    for (i, name) in names.iter().enumerate() {
        let col: Vec<f64> = phis.iter().map(|p| p[i]).collect();
        let mean = col.iter().sum::<f64>() / col.len().max(1) as f64;
        let min = col.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = col.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        println!("{name:<16} {min:>9.3} {mean:>9.3} {max:>9.3}");
    }

    // Collinearity. The taste model is linear in φ, so a coordinate that is
    // nearly a linear combination of the others has an unstable, individually
    // meaningless coefficient — which defeats the per-feature explanations the
    // Styles tab renders — and inflates posterior variance along the shared
    // direction, lengthening the cold start. VIF = 1/(1−R²) of each column
    // regressed on all the others; >10 is the conventional alarm.
    println!();
    println!("{:<16} {:>9}", "feature", "VIF");
    let mut vifs: Vec<(f64, &str)> = names
        .iter()
        .enumerate()
        .map(|(i, name)| (vif(&phis, i), *name))
        .collect();
    vifs.sort_by(|a, b| b.0.total_cmp(&a.0));
    for (v, name) in vifs {
        let flag = if v > 10.0 { "  <-- collinear" } else { "" };
        println!("{name:<16} {v:>9.1}{flag}");
    }
}

/// Variance inflation factor of column `target`: regress it on every other
/// column (with intercept) by ridge-stabilized normal equations and return
/// `1/(1−R²)`.
fn vif(rows: &[Vec<f64>], target: usize) -> f64 {
    let d = rows[0].len();
    let cols: Vec<usize> = (0..d).filter(|&c| c != target).collect();
    let k = cols.len() + 1; // + intercept
    let n = rows.len();
    // Normal equations XᵀX b = Xᵀy.
    let x = |r: &Vec<f64>, j: usize| if j == 0 { 1.0 } else { r[cols[j - 1]] };
    let mut ata = vec![vec![0.0f64; k]; k];
    let mut aty = vec![0.0f64; k];
    for r in rows {
        for a in 0..k {
            let xa = x(r, a);
            for (b, cell) in ata[a].iter_mut().enumerate() {
                *cell += xa * x(r, b);
            }
            aty[a] += xa * r[target];
        }
    }
    for (a, row) in ata.iter_mut().enumerate() {
        row[a] += 1e-8; // keep the solve well-posed on exact duplicates
    }
    // Gaussian elimination with partial pivoting.
    let mut m = ata;
    let mut v = aty;
    for c in 0..k {
        let piv = (c..k)
            .max_by(|&i, &j| m[i][c].abs().total_cmp(&m[j][c].abs()))
            .unwrap();
        m.swap(c, piv);
        v.swap(c, piv);
        let p = m[c][c];
        if p.abs() < 1e-12 {
            continue;
        }
        for r in (c + 1)..k {
            let f = m[r][c] / p;
            let pivot_row: Vec<f64> = m[c][c..k].to_vec();
            for (cc, pv) in pivot_row.iter().enumerate() {
                m[r][c + cc] -= f * pv;
            }
            v[r] -= f * v[c];
        }
    }
    let mut beta = vec![0.0f64; k];
    for c in (0..k).rev() {
        if m[c][c].abs() < 1e-12 {
            continue;
        }
        let mut acc = v[c];
        for (cc, bv) in beta.iter().enumerate().skip(c + 1) {
            acc -= m[c][cc] * bv;
        }
        beta[c] = acc / m[c][c];
    }
    let ybar = rows.iter().map(|r| r[target]).sum::<f64>() / n as f64;
    let mut ss_res = 0.0;
    let mut ss_tot = 0.0;
    for r in rows {
        let pred: f64 = (0..k).map(|j| beta[j] * x(r, j)).sum();
        ss_res += (r[target] - pred).powi(2);
        ss_tot += (r[target] - ybar).powi(2);
    }
    if ss_tot <= 1e-12 {
        return 1.0;
    }
    let r2 = (1.0 - ss_res / ss_tot).clamp(0.0, 1.0 - 1e-9);
    1.0 / (1.0 - r2)
}
