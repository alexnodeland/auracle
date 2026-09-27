//! Print how the named controls wire onto a few presets: which knobs, how
//! purely, how far. The table behind `auracle_session::perform`'s claims.
//!
//! ```bash
//! cargo run -p auracle-session --example perform_wiring --release -- "Ceiling" "First Bass"
//! cargo run -p auracle-session --example perform_wiring --release -- --prior-ab
//! ```
//!
//! `--prior-ab` wires every preset with and without the semantic prior and
//! prints, per control, the median purity and how often the knob with the
//! largest gain is one the control names (`NamedControl::sites`).
use auracle_features::{featurize, PhraseSpec, RenderMemo};
use auracle_grammar::preset_bank;
use auracle_session::perform::{jacobian, wire, wire_with, CONTROLS, SEMANTIC_RIDGE};
use auracle_taste::Standardizer;

fn main() {
    let spec = PhraseSpec::default();
    let bank = preset_bank();
    let rows: Vec<Vec<f64>> = bank
        .iter()
        .filter_map(|p| featurize(&p.tree, &spec).ok())
        .map(|v| v.features.phi())
        .collect();
    let std = Standardizer::fit(&rows);
    let memo = RenderMemo::default();
    let names: Vec<String> = std::env::args().skip(1).collect();
    if names.iter().any(|n| n == "--prior-ab") {
        prior_ab(&bank, &spec, &memo, &std);
        return;
    }
    for p in bank
        .iter()
        .filter(|p| names.is_empty() || names.iter().any(|n| n == p.name))
    {
        let Some(jac) = jacobian(&p.tree, &spec, &memo, &std) else {
            println!("{}: does not vet", p.name);
            continue;
        };
        println!("\n{} ({} knobs)", p.name, jac.addrs.len());
        for w in wire(&jac) {
            println!(
                "  {:<7} purity {:>5.2}  reach {:>5.2}σ  at {:>+5.2}σ  {}  {}",
                w.name,
                w.purity,
                w.reach,
                w.position,
                if w.search { "SEARCH" } else { "      " },
                w.knobs
                    .iter()
                    .map(|(a, g)| format!("{a} {g:+.2}"))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
    }
}

fn median(mut v: Vec<f64>) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}

fn prior_ab(
    bank: &[auracle_grammar::Preset],
    spec: &PhraseSpec,
    memo: &RenderMemo,
    std: &Standardizer,
) {
    let jacs: Vec<_> = bank
        .iter()
        .filter_map(|p| jacobian(&p.tree, spec, memo, std))
        .collect();
    println!("{} presets", jacs.len());
    println!(
        "{:<7} {:>14} {:>14} {:>16} {:>16}",
        "control", "purity (none)", "purity (prior)", "named top (none)", "named top (prior)"
    );
    for (k, c) in CONTROLS.iter().enumerate() {
        let mut row = Vec::new();
        for share in [1.0, SEMANTIC_RIDGE] {
            let mut pur = Vec::new();
            let mut named = 0usize;
            let mut n = 0usize;
            for jac in &jacs {
                let w = &wire_with(jac, share)[k];
                if w.knobs.is_empty() {
                    continue;
                }
                pur.push(w.purity);
                n += 1;
                let top = w
                    .knobs
                    .iter()
                    .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
                    .map(|(a, _)| a.rsplit('#').next().unwrap_or(a).to_string())
                    .unwrap_or_default();
                if c.sites.contains(&top.as_str()) {
                    named += 1;
                }
            }
            row.push((median(pur), named as f64 / n.max(1) as f64));
        }
        println!(
            "{:<7} {:>14.2} {:>14.2} {:>15.0}% {:>15.0}%",
            c.name,
            row[0].0,
            row[1].0,
            100.0 * row[0].1,
            100.0 * row[1].1
        );
    }
}
