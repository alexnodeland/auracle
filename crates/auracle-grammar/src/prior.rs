//! The patch prior: a typed PCFG over [`PatchTree`] terms as a fugue program.
//!
//! Every node at tree path `p` (root key `"node"`, children `"node/0"`,
//! `"node/0/1"`, …; a processor's modulation slot at `"<p>/m"`) emits real
//! probabilistic choices at path-keyed addresses:
//!
//! | Site | Address | Distribution |
//! |---|---|---|
//! | source-vs-processor | `<p>#leaf` | `Bernoulli(source_prob)` (forced at max depth) |
//! | source kind | `<p>#src` | `Categorical(source_weights)` |
//! | processor kind | `<p>#op` | `Categorical(op_weights)` |
//! | modulation kind | `<p>/m#mod` | `Categorical(mod_weights)` (leaves only at max mod depth; never empty below a processor) |
//! | CV-processor kind | `<p>/m#modop` | uniform over [`ModOp::ALL`] |
//! | CV-combiner kind | `<p>/m#pairop` | uniform over [`PairOp::ALL`] |
//!
//! Modulation is a **recursive sort** as of wave 2C: a term's subterms live at
//! `<p>/m/0` and `<p>/m/1`, the same child convention the audio tree uses and
//! unambiguous because every modulation key sits below a `/m`. Its parsimony
//! pressure is [`PatchGrammarPrior::max_mod_depth`] — see
//! [`PatchGrammarPrior::mod_weights_at`], which is where both of the sort's
//! renormalizations happen.
//!
//! A modulation slot hangs off every module that has somewhere to send it.
//! As of wave 2B the exceptions are `Noise` (its only site is a colour switch)
//! and `Mix`/`RingMod` (both inputs are audio, and the one knob is the blend).
//! Having two audio children is *not* an exception: the four 2B dynamics
//! productions take two subterms and carry a slot as well.
//! | discrete params | `<p>#wave` / `#oct` / `#color` / `#fkind` / `#table` / `#dmode` | uniform categoricals |
//! | continuous params | `<p>#det`, `#cut`, `#res`, … | `Uniform(0, 1)` |
//!
//! The amplitude envelope lives at `amp#attack` … `amp#release`.
//!
//! Because the structure of an execution is encoded in its own choices, the
//! generic trace machinery (subtree regeneration MH, subtree-swap crossover)
//! applies unchanged — this mirrors fugue-evo's `ArithmeticGrammarPrior`
//! design, with quiver signal sorts in place of arithmetic types.
//!
//! Deeper patches pay more prior mass by construction: parsimony pressure is
//! the grammar itself, not an ad-hoc penalty.

use fugue::{addr, sample, Bernoulli, Categorical, Model, ModelExt, Uniform};
use fugue_evo::inference::prior::GenomePrior;
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::rng::gen_index;
use crate::term::{
    AmpEnv, AudioNode, DriveMode, FilterKind, InputChannel, ModNode, ModOp, NoiseColor, PairOp,
    PatchTree, TableShape, Uid, Waveform, INPUT_SLOTS,
};

/// Source-kind categorical order: Vco, Supersaw, Noise, Wavetable, Pluck,
/// Formant, Silence, AudioIn.
///
/// These three counts are the **persisted wire format** — [`crate::genome`]
/// writes the chosen index into the trace — so the orders are append-only.
pub const N_SOURCES: usize = 8;
/// Processor-kind categorical order: Mix, Filter, Fold, Delay, Chorus,
/// Reverb, Distortion, Bitcrush, Phaser, RingMod, Flanger, Tremolo, Vibrato,
/// Eq, Granular, Shift, Comp, Duck, Gate, Vocoder.
pub const N_OPS: usize = 20;
/// Modulation-kind categorical order: None, Lfo, Env, Rand, Follow, Euclid,
/// Op, Pair, Steps.
///
/// `Euclid`, `Op` and `Pair` arrived in wave 2C, when modulation became a
/// recursive sort: `Euclid` is a fifth leaf, `Op` wraps one modulation term
/// and `Pair` two. `Steps` is a sixth leaf, and it sits **after** the two
/// branches rather than beside the other leaves because the order is the wire
/// format — so leaf-ness is a predicate ([`mod_kind_is_leaf`]), not a range.
pub const N_MODS: usize = 9;
/// Unary CV-processor categorical order — [`ModOp::ALL`].
pub const N_MOD_OPS: usize = 4;
/// Binary CV-combiner categorical order — [`PairOp::ALL`].
pub const N_PAIR_OPS: usize = 6;
/// `#mod` index of [`ModNode::Op`], the unary recursive production.
const MOD_OP: usize = 6;
/// `#mod` index of [`ModNode::Pair`], the binary recursive production.
const MOD_PAIR: usize = 7;
/// `#mod` index of [`ModNode::Steps`], the step-sequencer leaf.
const MOD_STEPS: usize = 8;

/// The trace sites of a [`ModNode::Steps`], in draw (and encode) order: rate,
/// length, glide, then the eight latent step values.
pub const STEPS_SITES: &[&str] = &[
    "srate", "slen", "sslew", "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
];

/// Whether `#mod` index `kind` is a **leaf** — a kind that bottoms a term out
/// rather than recursing into another one.
///
/// This used to be a range (`kind < 6`), which was true only as long as every
/// leaf happened to be declared before the two branches. The categorical is
/// append-only, so the first leaf added after wave 2C (`Steps`, index 8)
/// broke it: at the depth bound the range would have zeroed the new leaf
/// along with the branches it was never one of, and a slot forced to bottom
/// out could not have drawn it. `None` (index 0) counts as a leaf here — it
/// does not recurse — and is governed by the separate "never empty below a
/// processor" rule in [`PatchGrammarPrior::mod_weights_at`].
pub fn mod_kind_is_leaf(kind: usize) -> bool {
    !matches!(kind, MOD_OP | MOD_PAIR)
}

/// Display labels for the `#src` categorical, in index order — the one table
/// the diff view reads, sized by [`N_SOURCES`] so a new production cannot be
/// added to the grammar without being added here.
pub const SOURCE_LABELS: [&str; N_SOURCES] = [
    "vco",
    "supersaw",
    "noise",
    "wavetable",
    "pluck",
    "formant",
    "silence",
    "audio in",
];

/// Display labels for the `#op` categorical, in index order; sized by
/// [`N_OPS`].
pub const OP_LABELS: [&str; N_OPS] = [
    "mix",
    "filter",
    "wavefolder",
    "delay",
    "chorus",
    "reverb",
    "distortion",
    "bitcrush",
    "phaser",
    "ring mod",
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

/// Display labels for the `#mod` categorical, in index order; sized by
/// [`N_MODS`].
pub const MOD_LABELS: [&str; N_MODS] = [
    "no mod", "lfo", "mod env", "s&h rand", "follower", "euclid", "op", "pair", "steps",
];

/// The default prior's [`PatchGrammarPrior::max_depth`]: the audio-tree depth
/// at which `#leaf` is forced true. The deepest term with positive prior mass
/// therefore has `AudioNode::depth() == PRIOR_MAX_DEPTH + 1`, and that is
/// where [`crate::mutate::MAX_DEPTH`] sits — derived from this constant so a
/// hand edit can never build what the prior cannot score.
pub const PRIOR_MAX_DEPTH: usize = 5;

/// The default prior's [`PatchGrammarPrior::max_mod_depth`]: the modulation
/// nesting at which `Op`/`Pair` are zeroed. The deepest mod term with positive
/// mass has `ModNode::depth() == PRIOR_MAX_MOD_DEPTH + 1`, which is
/// [`crate::mutate::MAX_MOD_DEPTH`].
pub const PRIOR_MAX_MOD_DEPTH: usize = 2;

/// The typed PCFG over patch terms.
///
/// Serializable because a refinement walk can run away from the engine that
/// tilted it: a generation's biased prior travels to the render farm inside
/// `auracle_session::WalkContext`, once per worker per generation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PatchGrammarPrior {
    /// Probability that a node (below max depth) is a source leaf.
    pub source_prob: f64,
    /// Maximum tree depth; nodes at this depth are forced to be sources.
    pub max_depth: usize,
    /// Maximum nesting depth of a modulation term: a term at this depth is
    /// forced to be a leaf, exactly as [`Self::max_depth`] forces `#leaf`.
    ///
    /// This is the mod sort's **only** parsimony pressure. The audio tree pays
    /// for its own size in prior mass because every extra node is another
    /// `#leaf`/`#op` draw; a modulation chain pays the same way, but nothing
    /// about the *audio* term's mass objects to a forty-node CV chain that
    /// moves one knob, so the ceiling has to be explicit. 2 means a term may
    /// wrap at most two processors before it bottoms out in a leaf.
    pub max_mod_depth: usize,
    /// Weights over source kinds
    /// `[Vco, Supersaw, Noise, Wavetable, Pluck, Formant, Silence, AudioIn]`.
    pub source_weights: [f64; N_SOURCES],
    /// Weights over processor kinds
    /// `[Mix, Filter, Fold, Delay, Chorus, Reverb, Distortion, Bitcrush,
    /// Phaser, RingMod, Flanger, Tremolo, Vibrato, Eq, Granular, Shift, Comp,
    /// Duck, Gate, Vocoder]`.
    pub op_weights: [f64; N_OPS],
    /// Weights over modulation kinds
    /// `[None, Lfo, Env, Rand, Follow, Euclid, Op, Pair, Steps]`.
    pub mod_weights: [f64; N_MODS],
}

impl Default for PatchGrammarPrior {
    fn default() -> Self {
        Self {
            source_prob: 0.4,
            max_depth: PRIOR_MAX_DEPTH,
            // Two processors above a leaf is already `s&h → quantize → slew`,
            // which is the deepest idiom anyone reaches for; a third adds a
            // stage nobody can hear separately. It is also a *stack* budget:
            // the compiler recurses by value, the wasm build only just fits
            // its 8 MB stack with the audio recursion alone, and every level
            // here is a second recursion sitting on top of that one.
            max_mod_depth: PRIOR_MAX_MOD_DEPTH,
            // Vco stays the staple and supersaw second; wavetable is a real
            // alternative but a new one; noise, pluck and formant are spices —
            // the last two especially, because a plucked string and a vowel
            // are each a whole character rather than a layer inside someone
            // else's patch.
            //
            // `Silence` is last and is not a spice: it is the socket a player
            // left unplugged, and the prior's job with it is only to make it
            // *representable*. At weight zero the grammar gives `p = 0` to any
            // tree containing one, `log p` is −∞, and MH rejects every proposal
            // that touches a hand-made hole — a patch would become un-evolvable
            // by the act of unplugging something. 0.5% keeps `log p` finite
            // while making a prior draw that contains one rare; a tree that is
            // *all* silence renders silent, the vet gate quarantines it, and
            // evolution learns to avoid it. Its real prevalence is set by the
            // player's edits, not by this number, which is unusual among kinds
            // and is the reason a rate this small is not a reason to leave it
            // out of φ.
            //
            // `AudioIn` is last and rare on the same argument. The input is
            // the player's: a node that reads it arrives because a player
            // patched one in, and the prior's job is to keep such a patch
            // scoreable and breedable, not to fill the pool with inputs. At
            // Silence's 0.5% a drawn tree reads an input about one time in a
            // hundred, so a generation can still breed one, and its
            // measurement is the audition clip either way. Like Silence it is
            // not tilted by taste (`Engine::biased_prior`).
            source_weights: [0.34, 0.24, 0.13, 0.13, 0.08, 0.08, 0.005, 0.005],
            // Filter carries subtractive identity and stays dominant — half
            // again the next-largest weight, and three to sixteen times any
            // of the colour and movement modules. Mix keeps branching alive;
            // distortion sits beside the wavefolder.
            //
            // Wave 2A's five newcomers are motion and tone rather than
            // structure, so their mass comes out of the existing time-fx and
            // out of mix, never out of the filter. Granular is the rarest
            // thing in the grammar: it is a texture you reach for
            // deliberately, and a pool full of it is unplayable.
            //
            // Bitcrush, phaser, ring mod and granular are spice and must
            // **stay** spice. A uniform pad across fifteen operators would
            // make the first generation after this update granular ring-mod
            // mush — and, worse, would put the user's entire accumulated
            // taste history off-distribution, since every observation in it
            // was collected under a prior that could not draw those modules
            // at all.
            //
            // Wave 2B's four *binary* newcomers are the structurally
            // significant part of this table, and they are held down for a
            // reason the unary waves did not have: every one of them recurses
            // twice, so their weight buys tree size — which the grammar's
            // parsimony pressure pays for in prior mass and the render budget
            // pays for in seconds. Mix and ring mod were 17.0% of op mass;
            // adding the four at a naive weight would have pushed branching
            // past a quarter of all ops. At these weights it reaches 20.6%,
            // and the measured mean term size moves by a few percent rather
            // than by a factor.
            //
            // Their order among themselves is how often you would reach for
            // one: a pitch shifter is a harmony device (and unary, so it costs
            // nothing structural), a compressor is common, a ducker and a gate
            // are gestures, and a vocoder is a whole patch's identity — the
            // same argument that keeps pluck and formant low among sources.
            //
            // [mix, filter, fold, delay, chorus, reverb, distortion,
            //  bitcrush, phaser, ringmod, flanger, tremolo, vibrato, eq,
            //  granular, shift, comp, duck, gate, vocoder]
            op_weights: [
                0.14, 0.24, 0.075, 0.085, 0.065, 0.055, 0.075, 0.02, 0.02, 0.018, 0.02, 0.028,
                0.028, 0.047, 0.014, 0.022, 0.016, 0.014, 0.010, 0.008,
            ],
            // Most slots stay empty; envelopes still slightly beat LFOs for
            // the filter-sweep idiom; the follower is rarer than either but
            // must be reachable; S&H stays rare.
            //
            // Wave 2C's three are **spice, and have to stay spice**, for a
            // reason the op table does not have: they are the only
            // productions in the grammar that recurse *inside a slot*, so
            // their weight buys mod-chain length rather than variety. A pool
            // in which most modulators arrive wrapped in two processors is a
            // pool of patches that all sound like a sample-and-hold, and the
            // user's whole taste history was collected under a prior that
            // could not draw them at all.
            //
            // The old five keep their relative proportions and are scaled by
            // 0.915 to make room, so nothing already learned about LFOs
            // against envelopes moves. Of the 8.5% that buys: euclid takes
            // the largest share because it is a leaf — it costs one node and
            // is the only rhythmic modulator in the palette; `op` is next
            // because it is the family the whole wave is for; `pair` is the
            // smallest by a wide margin because it is the only production
            // that draws **two** subterms, and at 1.5% a two-branch chain is
            // ~0.6% of filled slots rather than the 4% a naive weight gives.
            //
            // `steps` enters at the euclid's 3%, on the euclid's argument: it
            // is a leaf (one node, no recursion, so its weight buys variety
            // rather than chain length), and it is the palette's second
            // rhythmic modulator — the one whose rhythm moves a *value* rather
            // than opening a gate. Weighting it above the euclid would make
            // step-sequenced timbre the pool's default gesture; well below
            // it, a module a taste history takes hundreds of draws to meet.
            // The table is left summing to 1.03 rather than rescaled by hand:
            // `weighted_cat` divides by the total, so every older kind keeps
            // its exact proportion to every other and each gives up the same
            // 2.9% of its mass — the "nothing already learned moves relative
            // to anything else" rule wave 2C applied with its 0.915.
            //
            // [none, lfo, env, rand, follow, euclid, op, pair, steps]
            mod_weights: [0.40, 0.18, 0.20, 0.055, 0.08, 0.03, 0.04, 0.015, 0.03],
        }
    }
}

/// The distribution of an AUDIO IN's `#input` site: which of the player's
/// inputs the node reads.
///
/// Not a choice the grammar makes. The input belongs to the player
/// ([ADR-015](../../../docs/decisions/015-audio-in.md)), so this has two jobs
/// that no stock distribution does together:
///
/// - **A drawn node reads the first input.** `sample` always returns slot 0,
///   so neither a fill nor a node born during a walk ever picks a device.
/// - **Every slot carries the same mass.** `log_prob` is `0` on every slot in
///   `0..INPUT_SLOTS` (and `−∞` outside), so a player's choice of input 3
///   scores exactly as input 0 does: no slot is favoured, no hand-set input
///   puts a patch outside the prior's support, and removing a node reading
///   slot 3 is no cheaper than removing one reading slot 0.
///
/// It is unnormalized (each slot has mass 1), which is harmless: a constant
/// cancels from every ratio the walks and the scoring take. The mismatch
/// between what `sample` draws and what `log_prob` scores matters only to a
/// proposal *on* this site, and a walk never accepts one: it locks every
/// `#input` its seed holds (`auracle_session`'s `walk_on`).
#[derive(Clone, Copy, Debug)]
pub struct PlayerInput;

impl fugue::Distribution<usize> for PlayerInput {
    fn sample(&self, _rng: &mut dyn rand::RngCore) -> usize {
        0
    }

    fn log_prob(&self, x: &usize) -> f64 {
        if *x < INPUT_SLOTS {
            0.0
        } else {
            f64::NEG_INFINITY
        }
    }

    fn clone_box(&self) -> Box<dyn fugue::Distribution<usize>> {
        Box::new(*self)
    }
}

fn child_key(key: &str, i: usize) -> String {
    format!("{key}/{i}")
}

fn mod_key(key: &str) -> String {
    format!("{key}/m")
}

fn u01() -> Uniform {
    Uniform::new(0.0, 1.0).expect("valid unit uniform")
}

fn uniform_cat(n: usize) -> Categorical {
    Categorical::new(vec![1.0 / n as f64; n]).expect("valid uniform categorical")
}

fn weighted_cat(weights: &[f64]) -> Categorical {
    let total: f64 = weights.iter().sum();
    Categorical::new(weights.iter().map(|w| w / total).collect()).expect("valid categorical")
}

/// Sample a run of `Uniform(0,1)` parameter sites at `key`, in order.
///
/// Exactly the hand-nested `bind` chain the older two- and three-parameter
/// arms below spell out — same addresses, same order, same prior mass. It
/// exists because the palette's new processors carry four continuous knobs
/// *plus* a modulation subterm, and six levels of nested closure is a place
/// where a mis-typed address hides rather than shows.
fn u01_seq(key: String, sites: &'static [&'static str]) -> Model<Vec<f64>> {
    match sites.split_first() {
        None => fugue::pure(Vec::new()),
        Some((site, rest)) => sample(addr!(key.clone(), *site), u01()).bind(move |v| {
            u01_seq(key.clone(), rest).map(move |mut tail| {
                tail.insert(0, v);
                tail
            })
        }),
    }
}

impl PatchGrammarPrior {
    fn source_model(&self, key: String) -> Model<AudioNode> {
        let weights = self.source_weights;
        // Five of the eight sources own a modulation slot, so the source model
        // needs the grammar config the processor model already carried.
        let cfg = self.clone();
        sample(addr!(key.clone(), "src"), weighted_cat(&weights)).bind(move |src| match src {
            0 => {
                let k = key.clone();
                let cfg = cfg.clone();
                sample(addr!(k.clone(), "wave"), uniform_cat(Waveform::ALL.len())).bind(move |w| {
                    let k2 = k.clone();
                    let cfg2 = cfg.clone();
                    sample(addr!(k2.clone(), "oct"), uniform_cat(5)).bind(move |o| {
                        let k3 = k2.clone();
                        let cfg3 = cfg2.clone();
                        u01_seq(k3.clone(), &["det", "mdepth"]).bind(move |p| {
                            cfg3.mod_model(mod_key(&k3), 0, true)
                                .map(move |m| AudioNode::Vco {
                                    uid: Uid::NEW,
                                    wave: Waveform::from_index(w),
                                    octave: o as i8 - 2,
                                    detune: p[0],
                                    mod_depth: p[1],
                                    modulation: m,
                                })
                        })
                    })
                })
            }
            1 => {
                let k = key.clone();
                let cfg = cfg.clone();
                sample(addr!(k.clone(), "oct"), uniform_cat(5)).bind(move |o| {
                    let k2 = k.clone();
                    let cfg2 = cfg.clone();
                    u01_seq(k2.clone(), &["det", "smix", "mdepth"]).bind(move |p| {
                        cfg2.mod_model(mod_key(&k2), 0, true)
                            .map(move |m| AudioNode::Supersaw {
                                uid: Uid::NEW,
                                octave: o as i8 - 2,
                                detune: p[0],
                                mix: p[1],
                                mod_depth: p[2],
                                modulation: m,
                            })
                    })
                })
            }
            2 => sample(
                addr!(key.clone(), "color"),
                uniform_cat(NoiseColor::ALL.len()),
            )
            .map(|c| AudioNode::Noise {
                uid: Uid::NEW,
                color: NoiseColor::from_index(c),
            }),
            3 => {
                let k = key.clone();
                let cfg = cfg.clone();
                sample(
                    addr!(k.clone(), "table"),
                    uniform_cat(TableShape::ALL.len()),
                )
                .bind(move |tb| {
                    let k2 = k.clone();
                    let cfg2 = cfg.clone();
                    sample(addr!(k2.clone(), "oct"), uniform_cat(5)).bind(move |o| {
                        let k3 = k2.clone();
                        let cfg3 = cfg2.clone();
                        u01_seq(k3.clone(), &["morph", "mdepth"]).bind(move |p| {
                            cfg3.mod_model(mod_key(&k3), 0, true).map(move |m| {
                                AudioNode::Wavetable {
                                    uid: Uid::NEW,
                                    table: TableShape::from_index(tb),
                                    octave: o as i8 - 2,
                                    morph: p[0],
                                    mod_depth: p[1],
                                    modulation: m,
                                }
                            })
                        })
                    })
                })
            }
            4 => {
                let k = key.clone();
                let cfg = cfg.clone();
                sample(addr!(k.clone(), "oct"), uniform_cat(5)).bind(move |o| {
                    let k2 = k.clone();
                    let cfg2 = cfg.clone();
                    u01_seq(k2.clone(), &["damp", "bright", "mdepth"]).bind(move |p| {
                        cfg2.mod_model(mod_key(&k2), 0, true)
                            .map(move |m| AudioNode::Pluck {
                                uid: Uid::NEW,
                                octave: o as i8 - 2,
                                damping: p[0],
                                brightness: p[1],
                                mod_depth: p[2],
                                modulation: m,
                            })
                    })
                })
            }
            5 => {
                let k = key.clone();
                sample(addr!(k.clone(), "oct"), uniform_cat(5)).bind(move |o| {
                    let k2 = k.clone();
                    let cfg2 = cfg.clone();
                    u01_seq(k2.clone(), &["vowel", "fshift", "mdepth"]).bind(move |p| {
                        cfg2.mod_model(mod_key(&k2), 0, true)
                            .map(move |m| AudioNode::Formant {
                                uid: Uid::NEW,
                                vowel: p[0],
                                shift: p[1],
                                octave: o as i8 - 2,
                                mod_depth: p[2],
                                modulation: m,
                            })
                    })
                })
            }
            // Index 6. It samples no sites at all, which is what makes a hole
            // the cheapest leaf in the grammar.
            6 => fugue::pure(AudioNode::Silence { uid: Uid::NEW }),
            // Index 7. A catch-all rather than `7 =>` because the match is on
            // a `usize` and needs one; `weighted_cat` cannot return anything
            // above `N_SOURCES - 1`, so this arm is reached for 7 and nothing
            // else. `#input` is drawn from `PlayerInput`, which never picks a
            // device: a node the grammar draws reads the first input.
            _ => {
                let k = key.clone();
                sample(addr!(k.clone(), "input"), PlayerInput).bind(move |input| {
                    let k2 = k.clone();
                    sample(addr!(k2.clone(), "gain"), u01()).bind(move |gain| {
                        sample(
                            addr!(k2.clone(), "channel"),
                            uniform_cat(InputChannel::ALL.len()),
                        )
                        .map(move |c| AudioNode::AudioIn {
                            uid: Uid::NEW,
                            input: input as u8,
                            gain,
                            channel: InputChannel::from_index(c),
                        })
                    })
                })
            }
        })
    }

    /// The `#mod` weights in force at one point in a modulation term.
    ///
    /// Two renormalizations, both by zeroing a weight and letting
    /// [`weighted_cat`] divide by what is left — which keeps the categorical's
    /// **arity at [`N_MODS`] everywhere**, so the value stored in the trace is
    /// always the absolute kind index and [`crate::genome`]'s encoding stays
    /// site-for-site identical to a generative run.
    ///
    /// - **At the depth bound**, `Op` and `Pair` go to zero, so the term is
    ///   forced to bottom out in a leaf. This is exactly how [`Self::max_depth`]
    ///   already forces `#leaf` true in the audio tree.
    /// - **Below a processor**, `None` goes to zero. A quantizer with nothing
    ///   under it emits a constant and a logic gate fed two zeroes is stuck
    ///   low; both are a module on the rack that cannot make a sound. The
    ///   alternative — sample the degenerate term and fold it away — is not
    ///   available here, because the generative model and the trace encoding
    ///   are asserted to emit the same choices and a folded term does not.
    ///   `ModNode::None` therefore stays reachable at the top of every slot,
    ///   which is where it means "no modulation", and nowhere else.
    fn mod_weights_at(&self, depth: usize, root: bool) -> [f64; N_MODS] {
        let mut w = self.mod_weights;
        if !root {
            w[0] = 0.0;
        }
        if depth >= self.max_mod_depth {
            for (kind, slot) in w.iter_mut().enumerate() {
                if !mod_kind_is_leaf(kind) {
                    *slot = 0.0;
                }
            }
        }
        w
    }

    /// A modulation term at nesting `depth`; `root` marks the top of a slot,
    /// the one place an *empty* term is a legal draw.
    fn mod_model(&self, key: String, depth: usize, root: bool) -> Model<ModNode> {
        let weights = self.mod_weights_at(depth, root);
        let cfg = self.clone();
        sample(addr!(key.clone(), "mod"), weighted_cat(&weights)).bind(move |kind| match kind {
            0 => fugue::pure(ModNode::None),
            1 => {
                let k = key.clone();
                sample(addr!(k.clone(), "wave"), uniform_cat(Waveform::ALL.len())).bind(move |w| {
                    sample(addr!(k.clone(), "rate"), u01()).map(move |r| ModNode::Lfo {
                        uid: Uid::NEW,
                        wave: Waveform::from_index(w),
                        rate: r,
                    })
                })
            }
            2 => {
                let k = key.clone();
                sample(addr!(k.clone(), "att"), u01()).bind(move |a| {
                    sample(addr!(k.clone(), "dec"), u01()).map(move |d| ModNode::Env {
                        uid: Uid::NEW,
                        attack: a,
                        decay: d,
                    })
                })
            }
            3 => u01_seq(key.clone(), &["rate", "glide"]).map(|p| ModNode::Rand {
                uid: Uid::NEW,
                rate: p[0],
                glide: p[1],
            }),
            4 => u01_seq(key.clone(), &["sens", "rel"]).map(|p| ModNode::Follow {
                uid: Uid::NEW,
                sens: p[0],
                release: p[1],
            }),
            5 => u01_seq(key.clone(), &["erate", "esteps", "epulses"]).map(|p| ModNode::Euclid {
                uid: Uid::NEW,
                rate: p[0],
                steps: p[1],
                pulses: p[2],
            }),
            // Rate, length, glide, then the eight latent step values — the
            // order `crate::genome` encodes them in.
            MOD_STEPS => u01_seq(key.clone(), STEPS_SITES).map(|p| ModNode::Steps {
                uid: Uid::NEW,
                rate: p[0],
                length: p[1],
                slew: p[2],
                values: [p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10]],
            }),
            // The two recursive arms. Draw order — kind, then the op's own
            // knobs, then the subterms left to right — is the order
            // `crate::genome` encodes them in, and the two must not disagree.
            MOD_OP => {
                let k = key.clone();
                let cfg = cfg.clone();
                sample(addr!(k.clone(), "modop"), uniform_cat(N_MOD_OPS)).bind(move |o| {
                    let kind = ModOp::from_index(o);
                    let k2 = k.clone();
                    let cfg2 = cfg.clone();
                    u01_seq(k2.clone(), kind.param_sites()).bind(move |p| {
                        let p1 = p.get(1).copied().unwrap_or(0.0);
                        let p0 = p[0];
                        cfg2.mod_model(child_key(&k2, 0), depth + 1, false)
                            .map(move |input| ModNode::Op {
                                uid: Uid::NEW,
                                kind,
                                p0,
                                p1,
                                input: Box::new(input),
                            })
                    })
                })
            }
            _ => {
                debug_assert_eq!(kind, MOD_PAIR, "#mod index out of range");
                let k = key.clone();
                let cfg = cfg.clone();
                sample(addr!(k.clone(), "pairop"), uniform_cat(N_PAIR_OPS)).bind(move |o| {
                    let kind = PairOp::from_index(o);
                    let (ka, kb) = (child_key(&k, 0), child_key(&k, 1));
                    let cfg2 = cfg.clone();
                    cfg.mod_model(ka, depth + 1, false).bind(move |a| {
                        cfg2.mod_model(kb.clone(), depth + 1, false)
                            .map(move |b| ModNode::Pair {
                                uid: Uid::NEW,
                                kind,
                                a: Box::new(a.clone()),
                                b: Box::new(b),
                            })
                    })
                })
            }
        })
    }

    fn audio_model(&self, key: String, depth: usize) -> Model<AudioNode> {
        let cfg = self.clone();
        let p_leaf = if depth >= cfg.max_depth {
            1.0
        } else {
            cfg.source_prob
        };
        sample(
            addr!(key.clone(), "leaf"),
            Bernoulli::new(p_leaf).expect("valid leaf probability"),
        )
        .bind(move |is_leaf| {
            if is_leaf {
                cfg.source_model(key.clone())
            } else {
                let cfg2 = cfg.clone();
                let key2 = key.clone();
                sample(addr!(key.clone(), "op"), weighted_cat(&cfg.op_weights))
                    .bind(move |op| cfg2.op_model(key2.clone(), op, depth))
            }
        })
    }

    /// A production with **two** audio subterms *and* a modulation slot — the
    /// wave-2B dynamics family.
    ///
    /// Four continuous sites, then the slot, then `/0` and `/1` in that order,
    /// which is the order [`crate::genome`] encodes them in. Written once
    /// rather than four times for the reason [`u01_seq`] exists: the arms
    /// differ only in which variant they assemble, and five levels of nested
    /// `bind` is where a mis-typed address hides instead of showing.
    fn binary_mod_op<F>(
        &self,
        key: String,
        sites: &'static [&'static str],
        depth: usize,
        build: F,
    ) -> Model<AudioNode>
    where
        F: FnOnce(Vec<f64>, ModNode, AudioNode, AudioNode) -> AudioNode + Send + 'static,
    {
        let (ka, kb) = (child_key(&key, 0), child_key(&key, 1));
        let (cfg_m, cfg_a, cfg_b) = (self.clone(), self.clone(), self.clone());
        u01_seq(key.clone(), sites).bind(move |p| {
            cfg_m.mod_model(mod_key(&key), 0, true).bind(move |m| {
                cfg_a.audio_model(ka, depth + 1).bind(move |a| {
                    cfg_b
                        .audio_model(kb, depth + 1)
                        .map(move |b| build(p, m, a, b))
                })
            })
        })
    }

    fn op_model(&self, key: String, op: usize, depth: usize) -> Model<AudioNode> {
        let cfg = self.clone();
        match op {
            // Mix
            0 => {
                let (ka, kb) = (child_key(&key, 0), child_key(&key, 1));
                let (cfg_a, cfg_b) = (cfg.clone(), cfg.clone());
                sample(addr!(key, "bal"), u01()).bind(move |bal| {
                    let cfg_b = cfg_b.clone();
                    let kb = kb.clone();
                    cfg_a.audio_model(ka.clone(), depth + 1).bind(move |a| {
                        cfg_b
                            .audio_model(kb.clone(), depth + 1)
                            .map(move |b| AudioNode::Mix {
                                uid: Uid::NEW,
                                balance: bal,
                                a: Box::new(a.clone()),
                                b: Box::new(b),
                            })
                    })
                })
            }
            // Filter
            1 => {
                let k = key.clone();
                sample(
                    addr!(k.clone(), "fkind"),
                    uniform_cat(FilterKind::ALL.len()),
                )
                .bind(move |fk| {
                    let k2 = k.clone();
                    let cfg2 = cfg.clone();
                    sample(addr!(k2.clone(), "cut"), u01()).bind(move |cut| {
                        let k3 = k2.clone();
                        let cfg3 = cfg2.clone();
                        sample(addr!(k3.clone(), "res"), u01()).bind(move |res| {
                            let k4 = k3.clone();
                            let cfg4 = cfg3.clone();
                            sample(addr!(k4.clone(), "mdepth"), u01()).bind(move |md| {
                                let k5 = k4.clone();
                                let cfg5 = cfg4.clone();
                                cfg4.mod_model(mod_key(&k5), 0, true).bind(move |m| {
                                    let m = m.clone();
                                    cfg5.audio_model(child_key(&k5, 0), depth + 1).map(
                                        move |input| AudioNode::Filter {
                                            uid: Uid::NEW,
                                            kind: FilterKind::from_index(fk),
                                            cutoff: cut,
                                            resonance: res,
                                            mod_depth: md,
                                            input: Box::new(input),
                                            modulation: m.clone(),
                                        },
                                    )
                                })
                            })
                        })
                    })
                })
            }
            // Fold
            2 => {
                let k = key.clone();
                sample(addr!(k.clone(), "thresh"), u01()).bind(move |t| {
                    let k2 = k.clone();
                    let cfg2 = cfg.clone();
                    sample(addr!(k2.clone(), "mdepth"), u01()).bind(move |md| {
                        let k3 = k2.clone();
                        let cfg3 = cfg2.clone();
                        cfg2.mod_model(mod_key(&k3), 0, true).bind(move |m| {
                            let m = m.clone();
                            cfg3.audio_model(child_key(&k3, 0), depth + 1)
                                .map(move |input| AudioNode::Fold {
                                    uid: Uid::NEW,
                                    threshold: t,
                                    mod_depth: md,
                                    input: Box::new(input),
                                    modulation: m.clone(),
                                })
                        })
                    })
                })
            }
            // Delay
            3 => {
                let k = key.clone();
                u01_seq(k.clone(), &["time", "fb", "dmix", "mdepth"]).bind(move |p| {
                    let (time, fb, mix, md) = (p[0], p[1], p[2], p[3]);
                    let (k2, cfg2) = (k.clone(), cfg.clone());
                    cfg.mod_model(mod_key(&k2), 0, true).bind(move |m| {
                        let m = m.clone();
                        cfg2.audio_model(child_key(&k2, 0), depth + 1)
                            .map(move |input| AudioNode::Delay {
                                uid: Uid::NEW,
                                time,
                                feedback: fb,
                                mix,
                                mod_depth: md,
                                input: Box::new(input),
                                modulation: m.clone(),
                            })
                    })
                })
            }
            // Chorus
            4 => {
                let k = key.clone();
                u01_seq(k.clone(), &["crate", "cdepth", "cmix", "mdepth"]).bind(move |p| {
                    let (rate, dep, mix, md) = (p[0], p[1], p[2], p[3]);
                    let (k2, cfg2) = (k.clone(), cfg.clone());
                    cfg.mod_model(mod_key(&k2), 0, true).bind(move |m| {
                        let m = m.clone();
                        cfg2.audio_model(child_key(&k2, 0), depth + 1)
                            .map(move |input| AudioNode::Chorus {
                                uid: Uid::NEW,
                                rate,
                                depth: dep,
                                mix,
                                mod_depth: md,
                                input: Box::new(input),
                                modulation: m.clone(),
                            })
                    })
                })
            }
            // Reverb
            5 => {
                let k = key.clone();
                u01_seq(k.clone(), &["rsize", "rdamp", "rmix", "mdepth"]).bind(move |p| {
                    let (size, damp, mix, md) = (p[0], p[1], p[2], p[3]);
                    let (k2, cfg2) = (k.clone(), cfg.clone());
                    cfg.mod_model(mod_key(&k2), 0, true).bind(move |m| {
                        let m = m.clone();
                        cfg2.audio_model(child_key(&k2, 0), depth + 1)
                            .map(move |input| AudioNode::Reverb {
                                uid: Uid::NEW,
                                size,
                                damp,
                                mix,
                                mod_depth: md,
                                input: Box::new(input),
                                modulation: m.clone(),
                            })
                    })
                })
            }
            // Distortion
            6 => {
                let k = key.clone();
                sample(addr!(k.clone(), "dmode"), uniform_cat(DriveMode::ALL.len())).bind(
                    move |dm| {
                        let (k2, cfg2) = (k.clone(), cfg.clone());
                        u01_seq(k2.clone(), &["drive", "tone", "mdepth"]).bind(move |p| {
                            let (drive, tone, md) = (p[0], p[1], p[2]);
                            let (k3, cfg3) = (k2.clone(), cfg2.clone());
                            cfg2.mod_model(mod_key(&k3), 0, true).bind(move |m| {
                                let m = m.clone();
                                cfg3.audio_model(child_key(&k3, 0), depth + 1)
                                    .map(move |input| AudioNode::Distortion {
                                        uid: Uid::NEW,
                                        drive,
                                        tone,
                                        mode: DriveMode::from_index(dm),
                                        mod_depth: md,
                                        input: Box::new(input),
                                        modulation: m.clone(),
                                    })
                            })
                        })
                    },
                )
            }
            // Bitcrush
            7 => {
                let k = key.clone();
                u01_seq(k.clone(), &["bits", "dsamp", "mdepth"]).bind(move |p| {
                    let (bits, dsamp, md) = (p[0], p[1], p[2]);
                    let (k2, cfg2) = (k.clone(), cfg.clone());
                    cfg.mod_model(mod_key(&k2), 0, true).bind(move |m| {
                        let m = m.clone();
                        cfg2.audio_model(child_key(&k2, 0), depth + 1)
                            .map(move |input| AudioNode::Bitcrush {
                                uid: Uid::NEW,
                                bits,
                                downsample: dsamp,
                                mod_depth: md,
                                input: Box::new(input),
                                modulation: m.clone(),
                            })
                    })
                })
            }
            // Phaser
            8 => {
                let k = key.clone();
                u01_seq(k.clone(), &["prate", "pdepth", "pfb", "mdepth"]).bind(move |p| {
                    let (rate, dep, fb, md) = (p[0], p[1], p[2], p[3]);
                    let (k2, cfg2) = (k.clone(), cfg.clone());
                    cfg.mod_model(mod_key(&k2), 0, true).bind(move |m| {
                        let m = m.clone();
                        cfg2.audio_model(child_key(&k2, 0), depth + 1)
                            .map(move |input| AudioNode::Phaser {
                                uid: Uid::NEW,
                                rate,
                                depth: dep,
                                feedback: fb,
                                mod_depth: md,
                                input: Box::new(input),
                                modulation: m.clone(),
                            })
                    })
                })
            }
            // Ring mod — the second binary production, so it recurses twice
            // exactly as Mix does.
            9 => {
                let (ka, kb) = (child_key(&key, 0), child_key(&key, 1));
                let (cfg_a, cfg_b) = (cfg.clone(), cfg.clone());
                sample(addr!(key, "rgmix"), u01()).bind(move |mix| {
                    let cfg_b = cfg_b.clone();
                    let kb = kb.clone();
                    cfg_a.audio_model(ka.clone(), depth + 1).bind(move |a| {
                        cfg_b
                            .audio_model(kb.clone(), depth + 1)
                            .map(move |b| AudioNode::RingMod {
                                uid: Uid::NEW,
                                mix,
                                a: Box::new(a.clone()),
                                b: Box::new(b),
                            })
                    })
                })
            }
            10 => {
                let k = key.clone();
                u01_seq(k.clone(), &["frate", "fdepth", "ffb", "mdepth"]).bind(move |p| {
                    let (rate, dep, feedback, md) = (p[0], p[1], p[2], p[3]);
                    let (k2, cfg2) = (k.clone(), cfg.clone());
                    cfg.mod_model(mod_key(&k2), 0, true).bind(move |m| {
                        let m = m.clone();
                        cfg2.audio_model(child_key(&k2, 0), depth + 1)
                            .map(move |input| AudioNode::Flanger {
                                uid: Uid::NEW,
                                rate,
                                depth: dep,
                                feedback,
                                mod_depth: md,
                                input: Box::new(input),
                                modulation: m.clone(),
                            })
                    })
                })
            }
            11 => {
                let k = key.clone();
                u01_seq(k.clone(), &["trate", "tdepth", "tshape", "mdepth"]).bind(move |p| {
                    let (rate, dep, shape, md) = (p[0], p[1], p[2], p[3]);
                    let (k2, cfg2) = (k.clone(), cfg.clone());
                    cfg.mod_model(mod_key(&k2), 0, true).bind(move |m| {
                        let m = m.clone();
                        cfg2.audio_model(child_key(&k2, 0), depth + 1)
                            .map(move |input| AudioNode::Tremolo {
                                uid: Uid::NEW,
                                rate,
                                depth: dep,
                                shape,
                                mod_depth: md,
                                input: Box::new(input),
                                modulation: m.clone(),
                            })
                    })
                })
            }
            12 => {
                let k = key.clone();
                u01_seq(k.clone(), &["vrate", "vdepth", "vmix", "mdepth"]).bind(move |p| {
                    let (rate, dep, mix, md) = (p[0], p[1], p[2], p[3]);
                    let (k2, cfg2) = (k.clone(), cfg.clone());
                    cfg.mod_model(mod_key(&k2), 0, true).bind(move |m| {
                        let m = m.clone();
                        cfg2.audio_model(child_key(&k2, 0), depth + 1)
                            .map(move |input| AudioNode::Vibrato {
                                uid: Uid::NEW,
                                rate,
                                depth: dep,
                                mix,
                                mod_depth: md,
                                input: Box::new(input),
                                modulation: m.clone(),
                            })
                    })
                })
            }
            13 => {
                let k = key.clone();
                u01_seq(k.clone(), &["low", "mid", "high", "mdepth"]).bind(move |p| {
                    let (low, mid, high, md) = (p[0], p[1], p[2], p[3]);
                    let (k2, cfg2) = (k.clone(), cfg.clone());
                    cfg.mod_model(mod_key(&k2), 0, true).bind(move |m| {
                        let m = m.clone();
                        cfg2.audio_model(child_key(&k2, 0), depth + 1)
                            .map(move |input| AudioNode::Eq {
                                uid: Uid::NEW,
                                low,
                                mid,
                                high,
                                mod_depth: md,
                                input: Box::new(input),
                                modulation: m.clone(),
                            })
                    })
                })
            }
            14 => {
                let k = key.clone();
                u01_seq(k.clone(), &["gpos", "gsize", "gdens", "mdepth"]).bind(move |p| {
                    let (position, size, density, md) = (p[0], p[1], p[2], p[3]);
                    let (k2, cfg2) = (k.clone(), cfg.clone());
                    cfg.mod_model(mod_key(&k2), 0, true).bind(move |m| {
                        let m = m.clone();
                        cfg2.audio_model(child_key(&k2, 0), depth + 1)
                            .map(move |input| AudioNode::Granular {
                                uid: Uid::NEW,
                                position,
                                size,
                                density,
                                mod_depth: md,
                                input: Box::new(input),
                                modulation: m.clone(),
                            })
                    })
                })
            }
            // Pitch shift — unary, despite arriving with the binary family.
            15 => {
                let k = key.clone();
                u01_seq(k.clone(), &["semis", "window", "smix", "mdepth"]).bind(move |p| {
                    let (semis, window, mix, md) = (p[0], p[1], p[2], p[3]);
                    let (k2, cfg2) = (k.clone(), cfg.clone());
                    cfg.mod_model(mod_key(&k2), 0, true).bind(move |m| {
                        let m = m.clone();
                        cfg2.audio_model(child_key(&k2, 0), depth + 1)
                            .map(move |input| AudioNode::Shift {
                                uid: Uid::NEW,
                                semis,
                                window,
                                mix,
                                mod_depth: md,
                                input: Box::new(input),
                                modulation: m.clone(),
                            })
                    })
                })
            }
            // The four binary productions: each recurses twice, exactly as
            // Mix and RingMod do, and carries a modulation slot besides.
            16 => self.binary_mod_op(
                key,
                &["thresh", "ratio", "makeup", "mdepth"],
                depth,
                |p, m, input, sidechain| AudioNode::Comp {
                    uid: Uid::NEW,
                    threshold: p[0],
                    ratio: p[1],
                    makeup: p[2],
                    mod_depth: p[3],
                    input: Box::new(input),
                    sidechain: Box::new(sidechain),
                    modulation: m,
                },
            ),
            17 => self.binary_mod_op(
                key,
                &["amount", "dthresh", "drel", "mdepth"],
                depth,
                |p, m, input, key_input| AudioNode::Duck {
                    uid: Uid::NEW,
                    amount: p[0],
                    threshold: p[1],
                    release: p[2],
                    mod_depth: p[3],
                    input: Box::new(input),
                    key: Box::new(key_input),
                    modulation: m,
                },
            ),
            18 => self.binary_mod_op(
                key,
                &["gthresh", "range", "grel", "mdepth"],
                depth,
                |p, m, input, sidechain| AudioNode::Gate {
                    uid: Uid::NEW,
                    threshold: p[0],
                    range: p[1],
                    release: p[2],
                    mod_depth: p[3],
                    input: Box::new(input),
                    sidechain: Box::new(sidechain),
                    modulation: m,
                },
            ),
            _ => self.binary_mod_op(
                key,
                &["bands", "vatt", "vrel", "mdepth"],
                depth,
                |p, m, carrier, modulator| AudioNode::Vocoder {
                    uid: Uid::NEW,
                    bands: p[0],
                    attack: p[1],
                    release: p[2],
                    mod_depth: p[3],
                    carrier: Box::new(carrier),
                    modulator: Box::new(modulator),
                    modulation: m,
                },
            ),
        }
    }

    /// Draw a tree with a plain RNG (no trace) — the classic-layer sampler
    /// mirroring [`Self::model`]. Used by `EvolutionaryGenome::generate`.
    pub fn sample_with_rng<R: Rng>(&self, rng: &mut R) -> PatchTree {
        let amp = AmpEnv {
            attack: rng.gen::<f64>(),
            decay: rng.gen::<f64>(),
            sustain: rng.gen::<f64>(),
            release: rng.gen::<f64>(),
        };
        let root = self.sample_audio(rng, 0);
        PatchTree { amp, root }
    }

    fn sample_audio<R: Rng>(&self, rng: &mut R, depth: usize) -> AudioNode {
        let is_leaf = depth >= self.max_depth || rng.gen_bool(self.source_prob);
        if is_leaf {
            match weighted_choice(rng, &self.source_weights) {
                0 => AudioNode::Vco {
                    uid: Uid::NEW,
                    wave: Waveform::from_index(gen_index(rng, Waveform::ALL.len())),
                    octave: rng.gen_range(0..5) as i8 - 2,
                    detune: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                },
                1 => AudioNode::Supersaw {
                    uid: Uid::NEW,
                    octave: rng.gen_range(0..5) as i8 - 2,
                    detune: rng.gen(),
                    mix: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                },
                2 => AudioNode::Noise {
                    uid: Uid::NEW,
                    color: NoiseColor::from_index(gen_index(rng, NoiseColor::ALL.len())),
                },
                3 => AudioNode::Wavetable {
                    uid: Uid::NEW,
                    table: TableShape::from_index(gen_index(rng, TableShape::ALL.len())),
                    octave: rng.gen_range(0..5) as i8 - 2,
                    morph: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                },
                4 => AudioNode::Pluck {
                    uid: Uid::NEW,
                    octave: rng.gen_range(0..5) as i8 - 2,
                    damping: rng.gen(),
                    brightness: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                },
                5 => AudioNode::Formant {
                    uid: Uid::NEW,
                    vowel: rng.gen(),
                    shift: rng.gen(),
                    octave: rng.gen_range(0..5) as i8 - 2,
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                },
                // Index 6, and only 6 — `weighted_choice` cannot return more.
                // This arm used to read `_ => Formant`, written before
                // `Silence` joined the palette, so the RNG sampler handed the
                // hole's mass to the formant oscillator and could never draw a
                // hole at all while `model()` drew one in 0.5% of leaves. The
                // two samplers are documented as agreeing, and
                // `the_two_samplers_agree_on_kind_frequencies` now holds them
                // to it.
                6 => AudioNode::Silence { uid: Uid::NEW },
                // Index 7, and only 7. No draw for `input`: the prior never
                // chooses a device ([`PlayerInput`]), so neither does this.
                _ => AudioNode::AudioIn {
                    uid: Uid::NEW,
                    input: 0,
                    gain: rng.gen(),
                    channel: InputChannel::from_index(rng.gen_range(0..InputChannel::ALL.len())),
                },
            }
        } else {
            match weighted_choice(rng, &self.op_weights) {
                0 => AudioNode::Mix {
                    uid: Uid::NEW,
                    balance: rng.gen(),
                    a: Box::new(self.sample_audio(rng, depth + 1)),
                    b: Box::new(self.sample_audio(rng, depth + 1)),
                },
                1 => AudioNode::Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::from_index(gen_index(rng, FilterKind::ALL.len())),
                    cutoff: rng.gen(),
                    resonance: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                2 => AudioNode::Fold {
                    uid: Uid::NEW,
                    threshold: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                3 => AudioNode::Delay {
                    uid: Uid::NEW,
                    time: rng.gen(),
                    feedback: rng.gen(),
                    mix: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                4 => AudioNode::Chorus {
                    uid: Uid::NEW,
                    rate: rng.gen(),
                    depth: rng.gen(),
                    mix: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                5 => AudioNode::Reverb {
                    uid: Uid::NEW,
                    size: rng.gen(),
                    damp: rng.gen(),
                    mix: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                6 => AudioNode::Distortion {
                    uid: Uid::NEW,
                    drive: rng.gen(),
                    tone: rng.gen(),
                    mode: DriveMode::from_index(gen_index(rng, DriveMode::ALL.len())),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                7 => AudioNode::Bitcrush {
                    uid: Uid::NEW,
                    bits: rng.gen(),
                    downsample: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                8 => AudioNode::Phaser {
                    uid: Uid::NEW,
                    rate: rng.gen(),
                    depth: rng.gen(),
                    feedback: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                9 => AudioNode::RingMod {
                    uid: Uid::NEW,
                    mix: rng.gen(),
                    a: Box::new(self.sample_audio(rng, depth + 1)),
                    b: Box::new(self.sample_audio(rng, depth + 1)),
                },
                10 => AudioNode::Flanger {
                    uid: Uid::NEW,
                    rate: rng.gen(),
                    depth: rng.gen(),
                    feedback: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                11 => AudioNode::Tremolo {
                    uid: Uid::NEW,
                    rate: rng.gen(),
                    depth: rng.gen(),
                    shape: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                12 => AudioNode::Vibrato {
                    uid: Uid::NEW,
                    rate: rng.gen(),
                    depth: rng.gen(),
                    mix: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                13 => AudioNode::Eq {
                    uid: Uid::NEW,
                    low: rng.gen(),
                    mid: rng.gen(),
                    high: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                14 => AudioNode::Granular {
                    uid: Uid::NEW,
                    position: rng.gen(),
                    size: rng.gen(),
                    density: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                15 => AudioNode::Shift {
                    uid: Uid::NEW,
                    semis: rng.gen(),
                    window: rng.gen(),
                    mix: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                // The draw order below mirrors `op_model`'s: params, slot,
                // `/0`, `/1`. It has to, or the two samplers disagree about
                // which subtree came from which RNG state.
                16 => AudioNode::Comp {
                    uid: Uid::NEW,
                    threshold: rng.gen(),
                    ratio: rng.gen(),
                    makeup: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                    sidechain: Box::new(self.sample_audio(rng, depth + 1)),
                },
                17 => AudioNode::Duck {
                    uid: Uid::NEW,
                    amount: rng.gen(),
                    threshold: rng.gen(),
                    release: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                    key: Box::new(self.sample_audio(rng, depth + 1)),
                },
                18 => AudioNode::Gate {
                    uid: Uid::NEW,
                    threshold: rng.gen(),
                    range: rng.gen(),
                    release: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                    sidechain: Box::new(self.sample_audio(rng, depth + 1)),
                },
                _ => AudioNode::Vocoder {
                    uid: Uid::NEW,
                    bands: rng.gen(),
                    attack: rng.gen(),
                    release: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng, 0, true),
                    carrier: Box::new(self.sample_audio(rng, depth + 1)),
                    modulator: Box::new(self.sample_audio(rng, depth + 1)),
                },
            }
        }
    }

    /// [`Self::mod_model`] with a plain RNG. Same weights, same depth rule,
    /// same draw order — the two samplers must agree on which trees exist.
    fn sample_mod<R: Rng>(&self, rng: &mut R, depth: usize, root: bool) -> ModNode {
        match weighted_choice(rng, &self.mod_weights_at(depth, root)) {
            0 => ModNode::None,
            1 => ModNode::Lfo {
                uid: Uid::NEW,
                wave: Waveform::from_index(gen_index(rng, Waveform::ALL.len())),
                rate: rng.gen(),
            },
            2 => ModNode::Env {
                uid: Uid::NEW,
                attack: rng.gen(),
                decay: rng.gen(),
            },
            3 => ModNode::Rand {
                uid: Uid::NEW,
                rate: rng.gen(),
                glide: rng.gen(),
            },
            4 => ModNode::Follow {
                uid: Uid::NEW,
                sens: rng.gen(),
                release: rng.gen(),
            },
            5 => ModNode::Euclid {
                uid: Uid::NEW,
                rate: rng.gen(),
                steps: rng.gen(),
                pulses: rng.gen(),
            },
            MOD_STEPS => ModNode::Steps {
                uid: Uid::NEW,
                rate: rng.gen(),
                length: rng.gen(),
                slew: rng.gen(),
                values: rng.gen(),
            },
            MOD_OP => {
                let kind = ModOp::from_index(gen_index(rng, N_MOD_OPS));
                let two = kind.param_sites().len() > 1;
                let p0 = rng.gen();
                // The one-parameter ops must not consume a second draw: their
                // `p1` is not a trace site, so drawing one here would put the
                // two samplers on different RNG states.
                let p1 = if two { rng.gen() } else { 0.0 };
                ModNode::Op {
                    uid: Uid::NEW,
                    kind,
                    p0,
                    p1,
                    input: Box::new(self.sample_mod(rng, depth + 1, false)),
                }
            }
            _ => ModNode::Pair {
                uid: Uid::NEW,
                kind: PairOp::from_index(gen_index(rng, N_PAIR_OPS)),
                a: Box::new(self.sample_mod(rng, depth + 1, false)),
                b: Box::new(self.sample_mod(rng, depth + 1, false)),
            },
        }
    }
}

fn weighted_choice<R: Rng>(rng: &mut R, weights: &[f64]) -> usize {
    let total: f64 = weights.iter().sum();
    let mut x = rng.gen::<f64>() * total;
    for (i, w) in weights.iter().enumerate() {
        x -= w;
        if x <= 0.0 {
            return i;
        }
    }
    weights.len() - 1
}

impl GenomePrior for PatchGrammarPrior {
    type Genome = PatchTree;

    fn model(&self) -> Model<PatchTree> {
        let cfg = self.clone();
        sample(addr!("amp", "attack"), u01()).bind(move |a| {
            let cfg = cfg.clone();
            sample(addr!("amp", "decay"), u01()).bind(move |d| {
                let cfg = cfg.clone();
                sample(addr!("amp", "sustain"), u01()).bind(move |s| {
                    let cfg = cfg.clone();
                    sample(addr!("amp", "release"), u01()).bind(move |r| {
                        cfg.audio_model("node".to_string(), 0)
                            .map(move |root| PatchTree {
                                amp: AmpEnv {
                                    attack: a,
                                    decay: d,
                                    sustain: s,
                                    release: r,
                                },
                                root,
                            })
                    })
                })
            })
        })
    }
    // `trace_of` uses the default: it delegates to `TraceGenome::to_trace`,
    // whose canonical encoding (crate::genome) IS this grammar's address
    // scheme — the two cannot drift apart without breaking the round-trip
    // property test.
}

#[cfg(test)]
mod tests {
    use super::*;
    use fugue::runtime::handler::run;
    use fugue::runtime::interpreters::PriorHandler;
    use fugue::Trace;
    use fugue_evo::genome::trace_genome::TraceGenome;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    /// The leaves are exactly the non-recursive kinds, wherever the append-only
    /// order happened to put them.
    #[test]
    fn leafness_is_a_predicate_not_a_range() {
        let leaves: Vec<usize> = (0..N_MODS).filter(|k| mod_kind_is_leaf(*k)).collect();
        assert_eq!(leaves, vec![0, 1, 2, 3, 4, 5, 8]);
        let prior = PatchGrammarPrior::default();
        let at_bound = prior.mod_weights_at(prior.max_mod_depth, false);
        assert_eq!(at_bound[MOD_OP], 0.0, "Op survived the depth bound");
        assert_eq!(at_bound[MOD_PAIR], 0.0, "Pair survived the depth bound");
        assert!(
            at_bound[MOD_STEPS] > 0.0,
            "the depth bound switched off the steps leaf along with the branches"
        );
    }

    /// Every modulation term that reaches the depth bound can still bottom out
    /// in `Steps`.
    ///
    /// The fixture offers the grammar *only* `Pair` and `Steps` below the top
    /// of a slot, so a two-deep pair chain reaches the bound with `Steps` as
    /// the single legal leaf. Under the old `skip(6)` rule the bound zeroed
    /// index 8 too, left the categorical with no mass at all, and the draw
    /// could not complete — which is exactly the regression this pins.
    #[test]
    fn a_max_depth_mod_term_can_still_draw_steps() {
        let prior = PatchGrammarPrior {
            mod_weights: [0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0],
            ..PatchGrammarPrior::default()
        };
        fn leaves_are_steps(m: &ModNode) -> bool {
            match m {
                ModNode::None | ModNode::Steps { .. } => true,
                ModNode::Pair { a, b, .. } => leaves_are_steps(a) && leaves_are_steps(b),
                _ => false,
            }
        }
        fn slots<'a>(n: &'a AudioNode, out: &mut Vec<&'a ModNode>) {
            if let Some(m) = n.modulation() {
                out.push(m);
            }
            for c in n.children() {
                slots(c, out);
            }
        }
        let mut rng = StdRng::seed_from_u64(0x57E95);
        let mut deepest = 0usize;
        for _ in 0..40 {
            let (drawn, _): (PatchTree, Trace) = run(
                PriorHandler {
                    rng: &mut rng,
                    trace: Trace::default(),
                },
                prior.model(),
            );
            let plain = prior.sample_with_rng(&mut rng);
            for t in [&drawn, &plain] {
                let mut ms = Vec::new();
                slots(&t.root, &mut ms);
                for m in ms {
                    assert!(
                        leaves_are_steps(m),
                        "a leaf other than steps: {}",
                        t.to_sexpr()
                    );
                    assert!(m.depth() <= prior.max_mod_depth + 1);
                    deepest = deepest.max(m.depth());
                }
                assert_eq!(&PatchTree::from_trace(&t.to_trace()).unwrap(), t);
            }
        }
        assert_eq!(
            deepest,
            prior.max_mod_depth + 1,
            "no term reached the depth bound, so this proved nothing"
        );
    }
}
