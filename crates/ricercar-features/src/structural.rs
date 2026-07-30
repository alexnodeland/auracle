//! `φ_struct`: render-free descriptors of the term itself.
//!
//! These cost nothing (no compile, no render), which is what makes the
//! screening cascade work: a struct-only surrogate prunes candidates before
//! the expensive render path. They also capture taste axes audio features
//! can't fully separate ("likes supersaws", "likes deep modulated chains").

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
    /// Number of Mix nodes.
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
    /// Tree depth.
    pub depth: f64,
    /// Tree size (audio nodes).
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
    pub const NAMES: [&'static str; 18] = [
        "n_vco",
        "n_supersaw",
        "n_noise",
        "n_mix",
        "n_filter",
        "n_fold",
        "n_delay",
        "n_chorus",
        "n_reverb",
        "n_lfo",
        "n_env",
        "n_rand",
        "depth",
        "size",
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
            self.n_mix,
            self.n_filter,
            self.n_fold,
            self.n_delay,
            self.n_chorus,
            self.n_reverb,
            self.n_lfo,
            self.n_env,
            self.n_rand,
            self.depth,
            self.size,
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
