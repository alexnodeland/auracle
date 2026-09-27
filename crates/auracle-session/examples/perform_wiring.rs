//! Print how the named controls wire onto a few presets: which knobs, how
//! purely, how far. The table behind `auracle_session::perform`'s claims.
//!
//! ```bash
//! cargo run -p auracle-session --example perform_wiring --release -- "Ceiling" "First Bass"
//! ```
use auracle_features::{featurize, PhraseSpec, RenderMemo};
use auracle_grammar::preset_bank;
use auracle_session::perform::{jacobian, wire};
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
