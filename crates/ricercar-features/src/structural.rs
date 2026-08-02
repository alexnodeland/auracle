//! `φ_struct`: render-free descriptors of the term itself.
//!
//! These cost nothing (no compile, no render), which is what makes the
//! screening cascade work: a struct-only surrogate prunes candidates before
//! the expensive render path. They also capture taste axes audio features
//! can't fully separate ("likes supersaws", "likes deep modulated chains").
//!
//! # φ carries **families**, not one column per module
//!
//! [`StructFeatures`] keeps a raw counter per kind — the Styles tab and the
//! auto-namer both want "two filters", not "two subtractive stages" — but
//! [`StructFeatures::NAMES`] and [`StructFeatures::to_vec`] collapse the
//! forty-one module kinds into fourteen family counts plus five term-level
//! numbers. Two reasons, and the second is the load-bearing one:
//!
//! - **Nothing meaningful distinguishes them.** `n_fold`, `n_distortion` and
//!   `n_bitcrush` all answer "how much nonlinear colour"; `n_chorus`,
//!   `n_phaser`, `n_flanger`, `n_tremolo` and `n_vibrato` all answer "how much
//!   periodic movement". A user who likes drive does not first decide *which*
//!   drive.
//! - **Per-kind columns arrive as near-indicator variables.** The prior draws
//!   bitcrush at 2.5%, ring mod at 2% and granular at 1.5%, so those columns
//!   are zero in ~19 of every 20 pool members. A coefficient fitted on a
//!   column that is almost always zero is estimated from a handful of rows,
//!   and the Styles tab renders it beside coefficients fitted on hundreds.
//!   Sixteen sparse columns also cost sixteen dimensions of posterior variance
//!   for the cold start to pay down before the model says anything at all.
//!   Five of wave 2A's six newcomers would have arrived under 3% prevalence,
//!   and *all five* of wave 2B's do. Wave 2C is the extreme case: measured
//!   over 1200 draws, each of its four CV processors appears in under 4% of
//!   patches and each of its six combiners in under 1% — a column that is
//!   zero in 99 rows of every 100, which is not a coefficient, it is a
//!   rounding error with a name in the Styles tab.
//!
//! # What is deliberately *not* in φ
//!
//! **`size`, `depth` and `n_mix`.** Every audio node increments
//! exactly one raw counter, so `size ≡ Σ n_*` — *exactly*, for every tree.
//! Including it makes the design matrix rank-deficient: the Gaussian prior
//! keeps the posterior proper, but there is an unidentified ridge along which
//! the MH chain random-walks forever. That wrecks mixing, splits each
//! coefficient arbitrarily between `size` and the counts (so the per-feature
//! weights shown in the Styles tab mean nothing individually), and poisons the
//! taste→grammar proposal tilt, which reads exactly those coefficients.
//! `size − depth` would be no better: it is still an exact linear combination
//! of coordinates already present. The field is kept for display and naming;
//! it just never reaches the model.
//!
//! Dropping `size` alone was **not enough**, which a VIF sweep over 300 prior
//! draws caught (`cargo run -p ricercar-features --example pipeline_stats
//! --release -- 300`). A tree is a forest of source leaves joined by
//! productions that each take some number of audio children, so the leaf count
//! exceeds the *total* branch count by exactly one. Wave 2B is where that stops
//! being a two-term statement — the compressor, ducker, gate and vocoder each
//! take two audio subterms, exactly as mix and ring mod do — so the identity
//! generalizes to:
//!
//! ```text
//! n_vco + n_supersaw + n_noise + n_wavetable + n_pluck + n_formant
//!     − n_mix − n_ringmod − n_comp − n_duck − n_gate − n_vocoder = 1
//!                                            (exactly, for every tree)
//! ```
//!
//! (Wave 2A added one source and five unary operators, so it only moved a
//! source term. Wave 2B's `Shift` is unary too and does not appear here.)
//!
//! — a second exact dependency, reported as VIF ≈ 10⁹ on every column in it.
//!
//! That is **one** equation, so exactly **one** column has to go, and dropping
//! more would remove real dimensions rather than redundant ones: with both
//! binary counts gone, φ could not tell a crossfade from a ring modulator at
//! all, which are about as different as two nodes in this grammar get. `n_mix`
//! leaves (it is the one determined by the others, and its proposal tilt is
//! recovered from the source coefficients in `ricercar_session`'s
//! `biased_prior`); the other five stay, but **never as columns of their own**:
//! ring mod lives inside `n_drive`, the vocoder inside `n_filter`, and the
//! compressor, ducker and gate inside `n_dynamics`.
//!
//! That last one is the case worth checking rather than assuming, because
//! `n_dynamics` is *exactly* `n_comp + n_duck + n_gate` and it is a **retained**
//! column — the only family in φ whose members are all on the wrong side of the
//! identity. It is still safe, and the reason is that the identity needs each
//! binary count *separately*: `n_ringmod` is only ever visible summed with
//! folds, distortions and bitcrushers, and `n_vocoder` only summed with filters
//! and eqs, so no linear combination of the retained columns isolates either
//! and the equation cannot be reconstructed. `n_dynamics` on its own supplies
//! three of the six binary terms and nothing supplies the other three.
//! Confirmed empirically, not just argued: on a 1200-draw sweep every
//! structural coordinate came back well under 10, with `n_dynamics` at 1.9.
//!
//! The prevalence argument points the same way independently: the prior draws
//! ring mod into ~3.5% of patches and each of the four 2B binaries into fewer,
//! so any of them as a standalone column would be the near-indicator variable
//! this whole section exists to avoid.
//!
//! `depth` goes too, on a weaker but real argument: VIF ≈ 21.7. Not exact —
//! the posterior stays proper — but a coefficient that unstable is not
//! individually meaningful, and the Styles tab renders these per-feature
//! weights as if they were.
//!
//! Still standing, and deliberately: `rolloff_mean` ≈ 18.4, `zcr_mean` ≈ 10.4
//! against `centroid_mean` ≈ 5.9 (re-measured over 1200 draws of the 2C
//! prior; they were 19.4 / 11.4 / 5.9 under 2B, 19.8 / 12.0 / 8.2 under 2A
//! and 24.7 / 16.6 / 6.6 under v1). That is the brightness cluster — three
//! genuine measurements of one perceptual thing. Dropping any of them
//! discards real signal rather than redundancy, so the right fix is a
//! shared/fused prior over the cluster, which is a modelling change rather
//! than a feature change and is not in this pass.
//!
//! Every family coordinate came back under 4 on that sweep, the highest being
//! `mod_depth_mean` at 3.8 — which is the whole reason the families exist.
//! Forty separate module columns is the design that would not have. The three
//! wave-2C additions specifically: `n_mod_shape` 1.6, `n_mod_logic` 1.3,
//! `mod_depth_mean` 3.8, with `mod_density` rising from 2.7 to 4.1 as the one
//! visible cost of adding a second modulation-shape coordinate beside it.
//!
//! # The families, and why each one is one column
//!
//! - `n_filter` = filter + eq + vocoder. Spectral tilt: a resonant filter and
//!   a tone control are the same question at different sharpnesses, and a
//!   vocoder is that question with the curve drawn by a signal.
//! - `n_drive` = fold + distortion + bitcrush + ring mod. Nonlinear colour.
//! - `n_time` = delay + granular + pitch shift. Smearing a signal in time.
//!   **Renamed** from `n_delay` in wave 2A, because the column now counts
//!   three ways of doing it and a name that says "delay" while counting
//!   granulators is a lie the Styles tab would render as if it meant
//!   something.
//! - `n_mod_fx` = chorus + phaser + flanger + tremolo + vibrato. Periodic
//!   movement — an LFO on a short delay, an allpass chain or a gain.
//! - `n_dynamics` = compressor + ducker + gate. Level shaped by a second
//!   signal. The one family whose members all sit inside the binary-node
//!   identity above, which is why that paragraph checks it rather than
//!   assuming it.
//! - `n_mod_shape` = quantizer + slew + rectifier + clocked hold. CV that has
//!   been worked on before it lands.
//! - `n_mod_logic` = euclid + min + max + and + or + xor + switch. Gate and
//!   decision CV. See below for why the euclid is counted here rather than
//!   with the other modulation leaves.
//!
//! # Wave 2C: the modulation sort has its own identity, and it is not exact
//!
//! Modulation became a recursive sort, so a patch now carries a *forest* of
//! modulation terms as well as one audio tree — and forests have the same
//! kind of leaf-versus-branch identity the audio tree does. With `f` filled
//! slots, `p` binary combiners and `u` unary processors, the forest has
//! exactly `f + p` leaves:
//!
//! ```text
//! n_lfo + n_env + n_rand + n_follow + n_euclid
//!     = filled_slots + (n_min + n_max + n_and + n_or + n_xor + n_switch)
//! ```
//!
//! Two things stop that reaching φ as a dependency. `filled_slots` is not a
//! coordinate — `mod_density` is `filled/slots`, a *ratio*, and no linear
//! combination recovers the numerator without the denominator. And the euclid
//! is summed into `n_mod_logic` **with** the combiners rather than sitting
//! with the other leaves, so the two sides of the equation are not separately
//! visible: what φ carries is `n_euclid + Σcombiners`, and the identity needs
//! them with opposite signs. Grouping it there is also the honest reading —
//! what a euclidean generator emits is a gate, which is what the logic ops
//! consume and produce — but the identity is the reason it is not a
//! judgement call.
//!
//! `mod_depth_mean` is the new term-level number, and it is the coordinate
//! that actually says "this person likes modulation that has been *shaped*":
//! the counts say how many processors are in the patch, the mean depth says
//! how deep the chains they sit in are, and a patch with four one-deep
//! modulators is a different animal from one with a single three-deep chain.
//! It is averaged over the *filled* slots only, so it is not a second reading
//! of `mod_density` — measured, the two come back at 3.8 and 4.1 rather than
//! at the double figures a restatement would give.

use ricercar_grammar::term::{AudioNode, ModNode, ModOp, PairOp, PatchTree};
use serde::{Deserialize, Serialize};

/// Named structural descriptors. `to_vec` order matches [`StructFeatures::NAMES`].
///
/// The `n_*` fields are raw per-kind counts for display; several of them are
/// summed into families before they reach φ (see the module doc).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct StructFeatures {
    /// Number of Vco sources.
    pub n_vco: f64,
    /// Number of Supersaw sources.
    pub n_supersaw: f64,
    /// Number of noise sources.
    pub n_noise: f64,
    /// Number of wavetable oscillators.
    pub n_wavetable: f64,
    /// Number of plucked strings.
    pub n_pluck: f64,
    /// Number of formant oscillators.
    pub n_formant: f64,
    /// Number of Mix nodes. **Not a φ coordinate** — see the module doc's
    /// exact identity. Kept for display.
    pub n_mix: f64,
    /// Number of ring modulators. Not a φ coordinate on its own — it is
    /// counted inside the `n_drive` family, which is both what keeps it out
    /// of the binary-node identity and what stops a 3.5%-prevalence column
    /// reaching the model as a near-indicator variable.
    pub n_ringmod: f64,
    /// Number of filters.
    pub n_filter: f64,
    /// Number of EQs. Folded into the `n_filter` family in φ — both answer
    /// "how much is the spectrum being tilted".
    pub n_eq: f64,
    /// Number of wavefolders. Folded into the `n_drive` family in φ.
    pub n_fold: f64,
    /// Number of distortions. Folded into the `n_drive` family in φ.
    pub n_distortion: f64,
    /// Number of bitcrushers. Folded into the `n_drive` family in φ.
    pub n_bitcrush: f64,
    /// Number of delays. Folded into the `n_time` family in φ.
    pub n_delay: f64,
    /// Number of granulators. Folded into the `n_time` family in φ.
    pub n_granular: f64,
    /// Number of pitch shifters. Folded into the `n_time` family in φ.
    pub n_shift: f64,
    /// Number of compressors. Folded into the `n_dynamics` family in φ.
    pub n_comp: f64,
    /// Number of duckers. Folded into the `n_dynamics` family in φ.
    pub n_duck: f64,
    /// Number of gates. Folded into the `n_dynamics` family in φ.
    pub n_gate: f64,
    /// Number of vocoders. Folded into the `n_filter` family in φ — a vocoder
    /// is a filter bank whose curve is drawn by a second signal.
    pub n_vocoder: f64,
    /// Number of choruses. Folded into the `n_mod_fx` family in φ.
    pub n_chorus: f64,
    /// Number of phasers. Folded into the `n_mod_fx` family in φ.
    pub n_phaser: f64,
    /// Number of flangers. Folded into the `n_mod_fx` family in φ.
    pub n_flanger: f64,
    /// Number of tremolos. Folded into the `n_mod_fx` family in φ.
    pub n_tremolo: f64,
    /// Number of vibratos. Folded into the `n_mod_fx` family in φ.
    pub n_vibrato: f64,
    /// Number of reverbs.
    pub n_reverb: f64,
    /// Number of LFO modulators.
    pub n_lfo: f64,
    /// Number of envelope modulators.
    pub n_env: f64,
    /// Number of S&H random modulators.
    pub n_rand: f64,
    /// Number of envelope followers.
    pub n_follow: f64,
    /// Number of euclidean gate patterns. Folded into the `n_mod_logic`
    /// family in φ.
    pub n_euclid: f64,
    /// Number of scale quantizers in modulation chains. `n_mod_shape` family.
    pub n_quantize: f64,
    /// Number of slew limiters in modulation chains. `n_mod_shape` family.
    pub n_slew: f64,
    /// Number of rectifiers in modulation chains. `n_mod_shape` family.
    pub n_rectify: f64,
    /// Number of clocked sample-and-holds in modulation chains.
    /// `n_mod_shape` family.
    pub n_hold: f64,
    /// Number of CV minimum combiners. `n_mod_logic` family.
    pub n_min: f64,
    /// Number of CV maximum combiners. `n_mod_logic` family.
    pub n_max: f64,
    /// Number of gate ANDs. `n_mod_logic` family.
    pub n_and: f64,
    /// Number of gate ORs. `n_mod_logic` family.
    pub n_or: f64,
    /// Number of gate XORs. `n_mod_logic` family.
    pub n_xor: f64,
    /// Number of CV switches. `n_mod_logic` family.
    pub n_switch: f64,
    /// Mean nesting depth of the *filled* modulation slots (1 for a bare
    /// modulator, 2 for one wrapped in a processor, …); 0 when nothing is
    /// modulated.
    pub mod_depth_mean: f64,
    /// Tree depth. **Not a φ coordinate** — VIF ≈ 21.7 against the module
    /// counts; see the module doc. Kept for display.
    pub depth: f64,
    /// Tree size (audio nodes). **Not a φ coordinate** — it is exactly the sum
    /// of the raw `n_*` module counts above; see the module doc. Kept for
    /// display.
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
    pub const NAMES: [&'static str; 23] = [
        "n_vco",
        "n_supersaw",
        "n_noise",
        "n_wavetable",
        "n_pluck",
        "n_formant",
        "n_filter",
        "n_drive",
        "n_time",
        "n_mod_fx",
        "n_reverb",
        "n_dynamics",
        "n_lfo",
        "n_env",
        "n_rand",
        "n_follow",
        "n_mod_shape",
        "n_mod_logic",
        "mod_density",
        "mod_depth_mean",
        "amp_attack",
        "amp_sustain",
        "amp_release",
    ];

    /// Nonlinear colour: wavefolder + distortion + bitcrusher + ring mod.
    pub fn n_drive(&self) -> f64 {
        self.n_fold + self.n_distortion + self.n_bitcrush + self.n_ringmod
    }

    /// Spectral tilt: filter + EQ + vocoder. A tone control and a resonant
    /// filter are the same question asked at different sharpnesses — "how much
    /// is this patch's balance being reshaped" — and a vocoder is that
    /// question again with the curve drawn by a signal instead of by a knob.
    /// Each of the three arrives at well under 3% prevalence, which is exactly
    /// the near-indicator column the family scheme exists to keep out of φ.
    pub fn n_filter_family(&self) -> f64 {
        self.n_filter + self.n_eq + self.n_vocoder
    }

    /// Smearing in time: delay + granular + pitch shift. Named `n_time`
    /// rather than `n_delay` because the column counts three ways of doing it,
    /// and a name that says "delay" while counting granulators is the kind of
    /// quiet dishonesty the Styles tab would render as if it meant something.
    /// The pitch shifter belongs here on mechanism *and* on sound: it is a
    /// rolling buffer read at the wrong rate, and what it produces is the
    /// smeared, grainy artefact family the other two produce.
    pub fn n_time(&self) -> f64 {
        self.n_delay + self.n_granular + self.n_shift
    }

    /// Level shaped by a second signal: compressor + ducker + gate.
    ///
    /// One column for the three, on the usual family argument — a user who
    /// likes a pumping patch does not first decide whether the pump comes from
    /// a ratio, a duck depth or a gate range. It is also the *only* safe way
    /// to carry them: see the module doc's generalized identity, which these
    /// three are on the wrong side of.
    pub fn n_dynamics(&self) -> f64 {
        self.n_comp + self.n_duck + self.n_gate
    }

    /// Periodic movement: chorus + phaser + flanger + tremolo + vibrato.
    /// Each is an LFO applied to *something* — a short delay, an allpass
    /// chain, a gain — against or instead of the dry signal. The delay line,
    /// the granulator and the reverb are not here because they place a sound
    /// in a space rather than move it.
    pub fn n_mod_fx(&self) -> f64 {
        self.n_chorus + self.n_phaser + self.n_flanger + self.n_tremolo + self.n_vibrato
    }

    /// CV that has been **shaped** before it lands: quantizer + slew +
    /// rectifier + clocked hold.
    ///
    /// Two columns for eleven modules, not eleven, on exactly the argument
    /// that produced `n_drive` and `n_mod_fx` — and here the prevalence case
    /// is stronger still, since the prior draws the whole `Op` production into
    /// 4% of slots and each of the four then takes a quarter of that. What the
    /// column asks is "does this person like modulation that has been worked
    /// on", which is one question.
    pub fn n_mod_shape(&self) -> f64 {
        self.n_quantize + self.n_slew + self.n_rectify + self.n_hold
    }

    /// Gate and decision CV: euclid + min + max + and + or + xor + switch.
    ///
    /// The euclidean generator belongs with the combiners rather than with the
    /// other leaves because what it produces is a *gate*, which is what the
    /// six combiners consume and (for three of them) emit. It also has to be
    /// here for an identity reason: a modulation forest of `f` filled slots
    /// with `p` binary combiners has exactly `f + p` leaves, so a φ that
    /// carried the combiners apart from the euclid would let that equation be
    /// reconstructed from `n_lfo`, `n_env`, `n_rand`, `n_follow` and
    /// `mod_density`. Summing the two sides into one column breaks it.
    pub fn n_mod_logic(&self) -> f64 {
        self.n_euclid
            + self.n_min
            + self.n_max
            + self.n_and
            + self.n_or
            + self.n_xor
            + self.n_switch
    }

    /// Flatten to a vector in [`Self::NAMES`] order.
    pub fn to_vec(&self) -> Vec<f64> {
        vec![
            self.n_vco,
            self.n_supersaw,
            self.n_noise,
            self.n_wavetable,
            self.n_pluck,
            self.n_formant,
            self.n_filter_family(),
            self.n_drive(),
            self.n_time(),
            self.n_mod_fx(),
            self.n_reverb,
            self.n_dynamics(),
            self.n_lfo,
            self.n_env,
            self.n_rand,
            self.n_follow,
            self.n_mod_shape(),
            self.n_mod_logic(),
            self.mod_density,
            self.mod_depth_mean,
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
    let mut depth_sum = 0usize;
    walk(
        &tree.root,
        &mut f,
        &mut ModTally {
            slots: &mut mod_slots,
            filled: &mut mod_filled,
            depth_sum: &mut depth_sum,
        },
    );
    f.mod_density = if mod_slots > 0 {
        mod_filled as f64 / mod_slots as f64
    } else {
        0.0
    };
    // Averaged over the **filled** slots, not over all of them: an empty slot
    // has no modulation term whose depth could be measured, and folding a zero
    // in for it would make the coordinate a second, noisier reading of
    // `mod_density`.
    f.mod_depth_mean = if mod_filled > 0 {
        depth_sum as f64 / mod_filled as f64
    } else {
        0.0
    };
    f
}

/// The three running numbers a walk collects about modulation slots.
///
/// A struct rather than three `&mut usize` parameters because `walk` threads
/// them through twenty-six arms and a transposed pair of `usize`s at one call
/// site would be silent.
struct ModTally<'a> {
    /// Modulation slots seen (one per module that owns one).
    slots: &'a mut usize,
    /// Of those, the ones carrying a term.
    filled: &'a mut usize,
    /// Sum of those terms' nesting depths.
    depth_sum: &'a mut usize,
}

/// Count one modulation slot, and every node in the term hanging off it.
///
/// The *slot* is counted once no matter how deep the chain is: `mod_density`
/// answers "how many of this patch's modulation destinations are driven",
/// which is a question about the audio tree's slots, and letting a nested
/// chain inflate the denominator would make a patch with one long chain read
/// as less modulated than one with a single LFO. Depth is the coordinate that
/// carries chain length, and it is separate for that reason.
fn count_mod(m: &ModNode, f: &mut StructFeatures, t: &mut ModTally) {
    *t.slots += 1;
    if matches!(m, ModNode::None) {
        return;
    }
    *t.filled += 1;
    *t.depth_sum += m.depth();
    count_mod_nodes(m, f);
}

/// The per-kind counters for one modulation term, recursing through the
/// shapers.
fn count_mod_nodes(m: &ModNode, f: &mut StructFeatures) {
    match m {
        ModNode::None => {}
        ModNode::Lfo { .. } => f.n_lfo += 1.0,
        ModNode::Env { .. } => f.n_env += 1.0,
        ModNode::Rand { .. } => f.n_rand += 1.0,
        ModNode::Follow { .. } => f.n_follow += 1.0,
        ModNode::Euclid { .. } => f.n_euclid += 1.0,
        ModNode::Op { kind, input, .. } => {
            match kind {
                ModOp::Quantize => f.n_quantize += 1.0,
                ModOp::Slew => f.n_slew += 1.0,
                ModOp::Rectify => f.n_rectify += 1.0,
                ModOp::Hold => f.n_hold += 1.0,
            }
            count_mod_nodes(input, f);
        }
        ModNode::Pair { kind, a, b, .. } => {
            match kind {
                PairOp::Min => f.n_min += 1.0,
                PairOp::Max => f.n_max += 1.0,
                PairOp::And => f.n_and += 1.0,
                PairOp::Or => f.n_or += 1.0,
                PairOp::Xor => f.n_xor += 1.0,
                PairOp::Switch => f.n_switch += 1.0,
            }
            count_mod_nodes(a, f);
            count_mod_nodes(b, f);
        }
    }
}

fn walk(n: &AudioNode, f: &mut StructFeatures, t: &mut ModTally) {
    // Sources with no slot, then the unary processors, then the six binary
    // nodes — every arm bumps exactly one counter, which is the identity
    // `size ≡ Σ n_*` the module doc rests on. The arms that recurse into two
    // children `return` rather than falling through to the shared tail, so the
    // tail's `(input, modulation)` pair only ever describes a unary node.
    let (input, modulation): (Option<&AudioNode>, Option<&ModNode>) = match n {
        AudioNode::Vco { modulation, .. } => {
            f.n_vco += 1.0;
            (None, Some(modulation))
        }
        AudioNode::Supersaw { modulation, .. } => {
            f.n_supersaw += 1.0;
            (None, Some(modulation))
        }
        AudioNode::Noise { .. } => {
            f.n_noise += 1.0;
            (None, None)
        }
        AudioNode::Wavetable { modulation, .. } => {
            f.n_wavetable += 1.0;
            (None, Some(modulation))
        }
        AudioNode::Pluck { modulation, .. } => {
            f.n_pluck += 1.0;
            (None, Some(modulation))
        }
        AudioNode::Formant { modulation, .. } => {
            f.n_formant += 1.0;
            (None, Some(modulation))
        }
        AudioNode::Filter {
            input, modulation, ..
        } => {
            f.n_filter += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Fold {
            input, modulation, ..
        } => {
            f.n_fold += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Distortion {
            input, modulation, ..
        } => {
            f.n_distortion += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Bitcrush {
            input, modulation, ..
        } => {
            f.n_bitcrush += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Delay {
            input, modulation, ..
        } => {
            f.n_delay += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Chorus {
            input, modulation, ..
        } => {
            f.n_chorus += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Phaser {
            input, modulation, ..
        } => {
            f.n_phaser += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Reverb {
            input, modulation, ..
        } => {
            f.n_reverb += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Flanger {
            input, modulation, ..
        } => {
            f.n_flanger += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Tremolo {
            input, modulation, ..
        } => {
            f.n_tremolo += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Vibrato {
            input, modulation, ..
        } => {
            f.n_vibrato += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Eq {
            input, modulation, ..
        } => {
            f.n_eq += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Granular {
            input, modulation, ..
        } => {
            f.n_granular += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Shift {
            input, modulation, ..
        } => {
            f.n_shift += 1.0;
            (Some(input), Some(modulation))
        }
        AudioNode::Mix { a, b, .. } => {
            f.n_mix += 1.0;
            walk(a, f, t);
            walk(b, f, t);
            return;
        }
        AudioNode::RingMod { a, b, .. } => {
            f.n_ringmod += 1.0;
            walk(a, f, t);
            walk(b, f, t);
            return;
        }
        // The 2B binaries are the shape neither branch above had: two audio
        // children *and* a modulation slot. Counting the slot and then falling
        // through to the `/0` walk (as the unary arms do) would silently drop
        // the whole `/1` subtree from every count, so they walk both children
        // here and return, with the slot counted explicitly first.
        AudioNode::Comp {
            input,
            sidechain,
            modulation,
            ..
        } => {
            f.n_comp += 1.0;
            count_mod(modulation, f, t);
            walk(input, f, t);
            walk(sidechain, f, t);
            return;
        }
        AudioNode::Duck {
            input,
            key,
            modulation,
            ..
        } => {
            f.n_duck += 1.0;
            count_mod(modulation, f, t);
            walk(input, f, t);
            walk(key, f, t);
            return;
        }
        AudioNode::Gate {
            input,
            sidechain,
            modulation,
            ..
        } => {
            f.n_gate += 1.0;
            count_mod(modulation, f, t);
            walk(input, f, t);
            walk(sidechain, f, t);
            return;
        }
        AudioNode::Vocoder {
            carrier,
            modulator,
            modulation,
            ..
        } => {
            f.n_vocoder += 1.0;
            count_mod(modulation, f, t);
            walk(carrier, f, t);
            walk(modulator, f, t);
            return;
        }
    };
    if let Some(m) = modulation {
        count_mod(m, f, t);
    }
    if let Some(i) = input {
        walk(i, f, t);
    }
}
