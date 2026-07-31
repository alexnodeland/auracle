//! Calibration: run the featurize pipeline over many prior draws and report
//! pass/quarantine statistics plus feature ranges. Informs the vet-threshold
//! open question in DESIGN.md §6.
//!
//! ```bash
//! cargo run -p ricercar-features --example pipeline_stats --release -- 200
//! ```

use fugue::runtime::handler::run;
use fugue::runtime::interpreters::PriorHandler;
use fugue::Trace;
use fugue_evo::inference::prior::GenomePrior;
use rand::rngs::StdRng;
use rand::SeedableRng;
use ricercar_features::{featurize, Features, FeaturizeError, PhraseSpec, VetFailure};
use ricercar_grammar::PatchGrammarPrior;

fn main() {
    let n: usize = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(200);
    let spec = PhraseSpec::default();
    let prior = PatchGrammarPrior::default();
    let mut rng = StdRng::seed_from_u64(0xCA11B);

    let (mut ok, mut silent, mut over, mut dc, mut nonfinite) = (0, 0, 0, 0, 0);
    let mut phis: Vec<Vec<f64>> = Vec::new();
    for _ in 0..n {
        let (tree, _) = run(
            PriorHandler {
                rng: &mut rng,
                trace: Trace::default(),
            },
            prior.model(),
        );
        match featurize(&tree, &spec) {
            Ok(v) => {
                ok += 1;
                phis.push(v.features.phi());
            }
            Err(FeaturizeError::Quarantined(f)) => match f {
                VetFailure::Silent { .. } => silent += 1,
                VetFailure::Overlevel { .. } => over += 1,
                VetFailure::DcDominated { .. } => dc += 1,
                VetFailure::NonFinite => nonfinite += 1,
            },
            Err(e) => panic!("unexpected: {e}"),
        }
    }

    println!("prior draws:   {n}");
    println!("featurized:    {ok} ({:.0}%)", 100.0 * ok as f64 / n as f64);
    println!("quarantined:   silent={silent} overlevel={over} dc={dc} nonfinite={nonfinite}");
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
