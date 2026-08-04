//! Can the MH kernel seat a continuous site outside its declared range?
//!
//! ```bash
//! cargo run -p auracle-grammar --example mh_escape --release
//! cargo run -p auracle-grammar --example mh_escape --release -- 100000  # steps per chain
//! ```
//!
//! Written for the closing panel's M1 — an `amp.sustain = 1e30` that reached
//! the faceplate, the exported PNG and the persisted observation log — and kept
//! because it is the only thing that turns "the mutation path cannot do this"
//! from an argument into a number.
//!
//! ## The argument
//!
//! Every continuous site in [`PatchGrammarPrior`] is sampled from `Uniform(0,1)`,
//! whose `log_prob` is `−∞` outside the unit interval. fugue's single-site
//! kernel scores each proposal through the *whole* target program, so a
//! proposal that leaves the domain contributes `−∞` to `log_prior`, giving
//! `log α = −∞`, and `accept = log_alpha >= 0.0 || rng < log_alpha.exp()` is
//! false for both `−∞` and the `NaN` that `−∞ − −∞` produces. The chain
//! therefore cannot leave the support it started in.
//!
//! There is one thing in that chain worth naming, because it is the part a
//! reader would go looking for: fugue routes a site to a **log-space** walk
//! when its density is `−∞` at −1, which is true of `Uniform(0,1)` — so every
//! knob in this grammar is proposed as `exp(ln x + s·z)`, which is unbounded
//! *above*. Proposals above 1 are made constantly. They are all rejected. That
//! costs acceptance rate near the top of the range; it does not cost
//! correctness, and this example is what says so.
//!
//! ## The measurement
//!
//! Eight chains from eight prior draws, `steps` transitions each, checking
//! **every** F64 site of the accepted trace after **every** transition — not a
//! sample of them, because the failure being ruled out is rare by hypothesis.
//! A constant fitness keeps the target proper and the run cheap (no render,
//! no featurizer), which is what makes 160 000 fully-checked transitions a
//! ten-second job rather than an afternoon.
//!
//! Result, at the shipped `fugue-ppl` 0.2.1 / `fugue-evo` 0.3.1:
//!
//! ```text
//! 8 chains × 20000 steps = 160000 transitions, 0 out-of-domain sites observed
//! ```

use auracle_grammar::{in_domain, PatchGrammarPrior, PatchTree};
use fugue::runtime::trace::ChoiceValue;
use fugue_evo::fitness::traits::Fitness;
use fugue_evo::inference::mh::EvolutionChain;
use fugue_evo::inference::model::EvolutionModel;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// A flat target: the chain then samples the prior itself, which is the
/// distribution whose support is under test.
#[derive(Clone)]
struct Flat;
impl Fitness for Flat {
    type Genome = PatchTree;
    type Value = f64;
    fn evaluate(&self, _g: &PatchTree) -> f64 {
        0.0
    }
}

const CHAINS: u64 = 8;

fn main() {
    let steps: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(20_000);
    let prior = PatchGrammarPrior::default();
    let mut escapes = 0usize;
    let mut worst: Option<(String, f64)> = None;

    for seed in 0..CHAINS {
        let mut rng = StdRng::seed_from_u64(seed);
        let model = EvolutionModel::new(prior.clone(), Flat);
        let mut chain = EvolutionChain::new(model);
        let mut trace = chain.init(&mut rng);
        for _ in 0..steps {
            let (_g, next) = chain.step(&mut rng, &trace);
            trace = next;
            for (addr, c) in &trace.choices {
                if let ChoiceValue::F64(v) = c.value {
                    if !in_domain(v) {
                        escapes += 1;
                        if worst.as_ref().is_none_or(|(_, w)| v.abs() > w.abs()) {
                            worst = Some((addr.to_string(), v));
                        }
                    }
                }
            }
        }
    }

    let total = CHAINS as usize * steps;
    println!("{CHAINS} chains × {steps} steps = {total} transitions, {escapes} out-of-domain sites observed");
    if let Some((addr, v)) = worst {
        println!("worst: {addr} = {v:e}");
        std::process::exit(1);
    }
}
