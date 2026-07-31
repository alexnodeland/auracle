//! `φ_struct`: render-free descriptors of the term itself.
//!
//! These cost nothing (no compile, no render), which is what makes the
//! screening cascade work: a struct-only surrogate prunes candidates before
//! the expensive render path. They also capture taste axes audio features
//! can't fully separate ("likes supersaws", "likes deep modulated chains").
//!
//! **`size`, `n_mix` and `depth` are deliberately not in φ.** Every audio node increments exactly
//! one of `n_vco … n_reverb`, so `size ≡ Σ n_*` — *exactly*, for every tree.
//! Including it makes the design matrix rank-deficient: the Gaussian prior
//! keeps the posterior proper, but there is an unidentified ridge along which
//! the MH chain random-walks forever. That wrecks mixing, splits each
//! coefficient arbitrarily between `size` and the counts (so the per-feature
//! weights shown in the Styles tab mean nothing individually), and poisons the
//! taste→grammar proposal tilt, which reads exactly those nine coefficients.
//! `size − depth` would be no better: it is still an exact linear combination
//! of coordinates already present. The field is kept for display and naming;
//! it just never reaches the model.
//!
//! Dropping `size` alone was **not enough**, which a VIF sweep over 300 prior
//! draws caught (`cargo run -p ricercar-features --example pipeline_stats
//! --release -- 300`). `Mix` is this grammar's only binary node and every
//! other operator is unary, so in any tree the leaf count exceeds the branch
//! count by exactly one:
//!
//! ```text
//! n_vco + n_supersaw + n_noise − n_mix = 1     (exactly, for every tree)
//! ```
//!
//! — a second exact dependency, reported as VIF ≈ 10⁹ on all four. `n_mix` is
//! the redundant one (it is determined by the sources, not the reverse), so it
//! leaves φ and the source counts stay.
//!
//! `depth` goes too, on a weaker but real argument: VIF ≈ 21.7. Not exact —
//! the posterior stays proper — but a coefficient that unstable is not
//! individually meaningful, and the Styles tab renders these per-feature
//! weights as if they were.
//!
//! Still standing, and deliberately: `rolloff_mean` ≈ 24.7, `zcr_mean` ≈ 16.6
//! against `centroid_mean` ≈ 6.6. That is the brightness cluster — three
//! genuine measurements of one perceptual thing. Dropping any of them discards
//! real signal rather than redundancy, so the right fix is a shared/fused
//! prior over the cluster, which is a modelling change rather than a feature
//! change and is not in this pass.

use ricercar_grammar::term::{AudioNode, ModNode, PatchTree};
use serde::{Deserialize, Serialize};

/// Named structural descriptors. `to_vec` order matches [`StructFeatures::NAMES`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct StructFeatures {
    /// Number of Vco sources.
    pub n_vco: f64,
    /// Number of Supersaw sources.
    pub n_supersaw: f64,
    /// Number of noise sources.
    pub n_noise: f64,
    /// Number of Mix nodes. **Not a φ coordinate** — exactly one less than
    /// the number of sources, since Mix is the only branching node; see the
    /// module doc. Kept for display and for the proposal tilt.
    pub n_mix: f64,
    /// Number of filters.
    pub n_filter: f64,
    /// Number of wavefolders.
    pub n_fold: f64,
    /// Number of delays.
    pub n_delay: f64,
    /// Number of choruses.
    pub n_chorus: f64,
    /// Number of reverbs.
    pub n_reverb: f64,
    /// Number of LFO modulators.
    pub n_lfo: f64,
    /// Number of envelope modulators.
    pub n_env: f64,
    /// Number of S&H random modulators.
    pub n_rand: f64,
    /// Tree depth. **Not a φ coordinate** — VIF ≈ 21.7 against the module
    /// counts; see the module doc. Kept for display.
    pub depth: f64,
    /// Tree size (audio nodes). **Not a φ coordinate** — it is exactly the sum
    /// of the nine `n_*` counts above; see the module doc. Kept for display.
    pub size: f64,
    /// Fraction of modulation slots actually filled.
    pub mod_density: f64,
    /// Amp attack (normalized).
    pub amp_attack: f64,
    /// Amp sustain (normalized).
    pub amp_sustain: f64,
    /// Amp release (normalized).
    pub amp_release: f64,
}

impl StructFeatures {
    /// Feature names in `to_vec` order.
    pub const NAMES: [&'static str; 15] = [
        "n_vco",
        "n_supersaw",
        "n_noise",
        "n_filter",
        "n_fold",
        "n_delay",
        "n_chorus",
        "n_reverb",
        "n_lfo",
        "n_env",
        "n_rand",
        "mod_density",
        "amp_attack",
        "amp_sustain",
        "amp_release",
    ];

    /// Flatten to a vector in [`Self::NAMES`] order.
    pub fn to_vec(&self) -> Vec<f64> {
        vec![
            self.n_vco,
            self.n_supersaw,
            self.n_noise,
            self.n_filter,
            self.n_fold,
            self.n_delay,
            self.n_chorus,
            self.n_reverb,
            self.n_lfo,
            self.n_env,
            self.n_rand,
            self.mod_density,
            self.amp_attack,
            self.amp_sustain,
            self.amp_release,
        ]
    }
}

/// Extract [`StructFeatures`] from a term (no compile, no render).
pub fn struct_features(tree: &PatchTree) -> StructFeatures {
    let mut f = StructFeatures {
        depth: tree.root.depth() as f64,
        size: tree.root.size() as f64,
        amp_attack: tree.amp.attack,
        amp_sustain: tree.amp.sustain,
        amp_release: tree.amp.release,
        ..Default::default()
    };
    let mut mod_slots = 0usize;
    let mut mod_filled = 0usize;
    walk(&tree.root, &mut f, &mut mod_slots, &mut mod_filled);
    f.mod_density = if mod_slots > 0 {
        mod_filled as f64 / mod_slots as f64
    } else {
        0.0
    };
    f
}

fn count_mod(m: &ModNode, f: &mut StructFeatures, slots: &mut usize, filled: &mut usize) {
    *slots += 1;
    match m {
        ModNode::None => {}
        ModNode::Lfo { .. } => {
            f.n_lfo += 1.0;
            *filled += 1;
        }
        ModNode::Env { .. } => {
            f.n_env += 1.0;
            *filled += 1;
        }
        ModNode::Rand { .. } => {
            f.n_rand += 1.0;
            *filled += 1;
        }
    }
}

fn walk(n: &AudioNode, f: &mut StructFeatures, slots: &mut usize, filled: &mut usize) {
    match n {
        AudioNode::Vco { .. } => f.n_vco += 1.0,
        AudioNode::Supersaw { .. } => f.n_supersaw += 1.0,
        AudioNode::Noise { .. } => f.n_noise += 1.0,
        AudioNode::Mix { a, b, .. } => {
            f.n_mix += 1.0;
            walk(a, f, slots, filled);
            walk(b, f, slots, filled);
        }
        AudioNode::Filter {
            input, modulation, ..
        } => {
            f.n_filter += 1.0;
            count_mod(modulation, f, slots, filled);
            walk(input, f, slots, filled);
        }
        AudioNode::Fold {
            input, modulation, ..
        } => {
            f.n_fold += 1.0;
            count_mod(modulation, f, slots, filled);
            walk(input, f, slots, filled);
        }
        AudioNode::Delay { input, .. } => {
            f.n_delay += 1.0;
            walk(input, f, slots, filled);
        }
        AudioNode::Chorus { input, .. } => {
            f.n_chorus += 1.0;
            walk(input, f, slots, filled);
        }
        AudioNode::Reverb { input, .. } => {
            f.n_reverb += 1.0;
            walk(input, f, slots, filled);
        }
    }
}
