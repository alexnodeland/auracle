//! Rack description: a frontend-facing view of a [`PatchTree`] as modules,
//! knobs, and wires.
//!
//! Every knob carries the **trace address** of the choice site it displays
//! (`node/0#cut`, `amp#attack`, …) — the same addresses the grammar samples,
//! [`crate::genome`] encodes, and MH proposes over. That makes the panel a
//! *direct* view of the genome: turning a knob is an edit at that address
//! ([`crate::edit::set_param`]) and locking a knob is a constraint on that
//! address during refinement.

use serde::{Deserialize, Serialize};

use crate::term::{
    quant_root_index, quant_scale_index, rect_mode_index, AudioNode, DriveMode, FilterKind,
    ModNode, ModOp, NoiseColor, PatchTree, TableShape, Waveform, QUANT_ROOTS, QUANT_SCALES,
    RECT_MODES,
};

/// What kind of control a knob is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum KnobKind {
    /// Continuous parameter, normalized `[0, 1]` (an `F64` trace site).
    Continuous,
    /// A small enum selector (a `Usize` trace site); `value` is the index.
    Enum {
        /// Display names, in categorical index order.
        options: Vec<String>,
    },
    /// Octave selector: `Usize` site `0..=4`, displayed as `−2..=+2`.
    Octave,
}

/// One knob on a module faceplate.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Knob {
    /// Full trace address (`key#site`).
    pub addr: String,
    /// Silkscreen label.
    pub label: String,
    /// Current value: normalized `[0,1]` for continuous, index for enums.
    pub value: f64,
    /// Control kind.
    pub kind: KnobKind,
}

/// One module faceplate in the rack.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RackModule {
    /// Trace key of the node (`node`, `node/0`, `node/0/m`, `node/0/m/0`,
    /// `amp`). A modulation chain's stages nest under the slot with the same
    /// `/0`, `/1` child convention the audio tree uses.
    pub key: String,
    /// Machine kind tag (`vco`, `filter`, `lfo`, `amp`, …).
    pub kind: String,
    /// Silkscreen title.
    pub title: String,
    /// Distance from the root (root = 0); layout hint for column placement.
    pub column: usize,
    /// True for modulation-sort modules — the ones that live at or below a
    /// `<key>/m` slot rather than in the audio path.
    ///
    /// As of wave 2C that is a whole sort rather than four leaves: the
    /// generators (lfo, mod env, s&h rand, follower, euclid), the CV
    /// processors that wrap them (quantize, slew, rectify, hold) and the
    /// combiners that join two (min, max, and, or, xor, switch). A chain is
    /// drawn as a run of modules with `mod` wires between them, each one
    /// column further from the destination.
    pub is_mod: bool,
    /// The knobs, in faceplate order.
    pub knobs: Vec<Knob>,
    /// Structural choice addresses owned by this module (`#leaf`, `#src`,
    /// `#op`, `#mod`, and any *empty* mod slot it guards). Locking the module
    /// means locking these plus all knob addresses — evolution can then not
    /// replace or restructure it.
    pub structural_addrs: Vec<String>,
}

/// A patch cable between two modules.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Wire {
    /// Source module key.
    pub from: String,
    /// Destination module key.
    pub to: String,
    /// `"audio"` or `"mod"`.
    pub kind: String,
}

/// The full rack view of one patch.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RackDescription {
    /// Modules, root-first depth-first.
    pub modules: Vec<RackModule>,
    /// Patch cables.
    pub wires: Vec<Wire>,
}

/// Display names for the waveform categorical, in index order.
pub fn waveform_options() -> Vec<String> {
    Waveform::ALL.iter().map(|w| w.port_name().into()).collect()
}

/// Display names for the noise-color categorical, in index order.
pub fn noise_options() -> Vec<String> {
    NoiseColor::ALL
        .iter()
        .map(|c| c.port_name().into())
        .collect()
}

/// Display names for the filter-kind categorical, in index order.
pub fn filter_options() -> Vec<String> {
    ["svf lp", "svf bp", "svf hp", "ladder"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// Display names for the wavetable categorical, in index order.
pub fn table_options() -> Vec<String> {
    TableShape::ALL.iter().map(|t| t.label().into()).collect()
}

/// Display names for the distortion-mode categorical, in index order.
pub fn drive_mode_options() -> Vec<String> {
    DriveMode::ALL.iter().map(|m| m.label().into()).collect()
}

fn knob_c(key: &str, site: &str, label: &str, value: f64) -> Knob {
    Knob {
        addr: format!("{key}#{site}"),
        label: label.into(),
        value,
        kind: KnobKind::Continuous,
    }
}

fn knob_e(key: &str, site: &str, label: &str, index: usize, options: Vec<String>) -> Knob {
    Knob {
        addr: format!("{key}#{site}"),
        label: label.into(),
        value: index as f64,
        kind: KnobKind::Enum { options },
    }
}

fn knob_oct(key: &str, octave: i8) -> Knob {
    Knob {
        addr: format!("{key}#oct"),
        label: "octave".into(),
        value: (octave + 2) as f64,
        kind: KnobKind::Octave,
    }
}

/// Describe a modulation term as a **chain** of modules feeding `parent_key`.
///
/// Modulation is a recursive sort as of wave 2C, so this walks the term the
/// way `describe_node` walks the audio tree: the processor is pushed first,
/// then a `mod` wire from each of its subterms, then the subterms themselves
/// at the next column. `structural_addrs` names both `#mod` and the op's own
/// `#modop`/`#pairop`, so locking a shaper pins what it is as well as that it
/// is there.
fn describe_mod(
    m: &ModNode,
    key: &str,
    parent_key: &str,
    column: usize,
    out: &mut RackDescription,
    parent_structural: &mut Vec<String>,
) {
    let mut structural = vec![format!("{key}#mod")];
    // The recursive arms push their own module and then recurse, so they
    // return early rather than falling through to the leaf tail.
    match m {
        ModNode::None => {
            // The empty slot's choice site belongs to the parent: locking the
            // parent pins "no modulation" in place.
            parent_structural.push(format!("{key}#mod"));
            return;
        }
        ModNode::Op {
            kind,
            p0,
            p1,
            input,
        } => {
            structural.push(format!("{key}#modop"));
            let sites = kind.param_sites();
            let knobs = match kind {
                ModOp::Quantize => vec![
                    // Both plates carry their current selection, because the
                    // sites behind them are continuous: quiver reads `root`
                    // and `scale` as `(cv·11.99)` and `(cv·6.99)` quantized
                    // *inside the module*, so the genome site is an f64 and a
                    // bare number on the faceplate would tell the player
                    // nothing about which scale they are in.
                    knob_c(
                        key,
                        "qroot",
                        &format!("root · {}", QUANT_ROOTS[quant_root_index(*p0)]),
                        *p0,
                    ),
                    knob_c(
                        key,
                        "qscale",
                        &format!("scale · {}", QUANT_SCALES[quant_scale_index(*p1)]),
                        *p1,
                    ),
                ],
                ModOp::Slew => vec![
                    knob_c(key, "rise", "rise", *p0),
                    knob_c(key, "fall", "fall", *p1),
                ],
                ModOp::Rectify => vec![knob_c(
                    key,
                    "rmode",
                    &format!("mode · {}", RECT_MODES[rect_mode_index(*p0)]),
                    *p0,
                )],
                ModOp::Hold => vec![knob_c(key, sites[0], "rate", *p0)],
            };
            out.modules.push(RackModule {
                key: key.into(),
                kind: kind.label().into(),
                title: kind.label().into(),
                column,
                is_mod: true,
                knobs,
                structural_addrs: structural,
            });
            out.wires.push(Wire {
                from: key.into(),
                to: parent_key.into(),
                kind: "mod".into(),
            });
            let child = format!("{key}/0");
            out.wires.push(Wire {
                from: child.clone(),
                to: key.into(),
                kind: "mod".into(),
            });
            let mut ignored = Vec::new();
            describe_mod(input, &child, key, column + 1, out, &mut ignored);
            return;
        }
        ModNode::Pair { kind, a, b } => {
            structural.push(format!("{key}#pairop"));
            out.modules.push(RackModule {
                key: key.into(),
                kind: kind.label().into(),
                title: kind.label().into(),
                column,
                is_mod: true,
                knobs: Vec::new(),
                structural_addrs: structural,
            });
            out.wires.push(Wire {
                from: key.into(),
                to: parent_key.into(),
                kind: "mod".into(),
            });
            let (ka, kb) = (format!("{key}/0"), format!("{key}/1"));
            for k in [&ka, &kb] {
                out.wires.push(Wire {
                    from: k.clone(),
                    to: key.into(),
                    kind: "mod".into(),
                });
            }
            let mut ignored = Vec::new();
            describe_mod(a, &ka, key, column + 1, out, &mut ignored);
            describe_mod(b, &kb, key, column + 1, out, &mut ignored);
            return;
        }
        _ => {}
    }
    let (kind, title, knobs) = match m {
        // Handled above; the compiler cannot see that.
        ModNode::None | ModNode::Op { .. } | ModNode::Pair { .. } => return,
        ModNode::Lfo { wave, rate } => (
            "lfo",
            "lfo",
            vec![
                knob_e(key, "wave", "wave", wave.index(), waveform_options()),
                knob_c(key, "rate", "rate", *rate),
            ],
        ),
        ModNode::Env { attack, decay } => (
            "modenv",
            "mod env",
            vec![
                knob_c(key, "att", "attack", *attack),
                knob_c(key, "dec", "decay", *decay),
            ],
        ),
        ModNode::Rand { rate, glide } => (
            "rand",
            "s&h rand",
            vec![
                knob_c(key, "rate", "rate", *rate),
                knob_c(key, "glide", "glide", *glide),
            ],
        ),
        ModNode::Follow { sens, release } => (
            "follow",
            "follower",
            vec![
                knob_c(key, "sens", "sens", *sens),
                knob_c(key, "rel", "release", *release),
            ],
        ),
        ModNode::Euclid {
            rate,
            steps,
            pulses,
        } => (
            "euclid",
            "euclid",
            vec![
                knob_c(key, "erate", "rate", *rate),
                knob_c(key, "esteps", "steps", *steps),
                knob_c(key, "epulses", "pulses", *pulses),
            ],
        ),
    };
    out.modules.push(RackModule {
        key: key.into(),
        kind: kind.into(),
        title: title.into(),
        column,
        is_mod: true,
        knobs,
        structural_addrs: structural,
    });
    out.wires.push(Wire {
        from: key.into(),
        to: parent_key.into(),
        kind: "mod".into(),
    });
}

/// Push a module that owns a modulation slot, then its slot, then its audio
/// input (`None` for a source, which has a slot but no input).
///
/// The slot has to be described *after* the module is pushed — an empty one
/// contributes its `#mod` address to the owner's `structural_addrs`, so the
/// owner's entry is patched once the slot is known — and *before* the input
/// subtree, so the rack stays root-first depth-first. Getting that order
/// right in eleven places by hand is how it goes wrong in one of them.
fn push_modulated(
    out: &mut RackDescription,
    mut module: RackModule,
    input: Option<&AudioNode>,
    modulation: &ModNode,
) {
    let key = module.key.clone();
    let column = module.column;
    let mut structural = std::mem::take(&mut module.structural_addrs);
    let idx = out.modules.len();
    out.modules.push(module);

    let child = format!("{key}/0");
    if input.is_some() {
        out.wires.push(Wire {
            from: child.clone(),
            to: key.clone(),
            kind: "audio".into(),
        });
    }
    describe_mod(
        modulation,
        &format!("{key}/m"),
        &key,
        column + 1,
        out,
        &mut structural,
    );
    out.modules[idx].structural_addrs = structural;
    if let Some(input) = input {
        describe_node(input, &child, column + 1, out);
    }
}

/// Push a binary node (`mix`, `ringmod`) and recurse into both branches.
fn push_binary(out: &mut RackDescription, module: RackModule, a: &AudioNode, b: &AudioNode) {
    push_binary_with(out, module, a, b, None);
}

/// [`push_binary`] for a binary node that *also* owns a modulation slot — the
/// wave-2B dynamics family, whose `/1` branch is a control signal and whose
/// slot reaches a real parameter besides.
///
/// Kept separate from [`push_modulated`] rather than generalizing it, because
/// the two differ in more than a branch count: `push_modulated` draws the
/// input wire only when there *is* one (a source has a slot and no input),
/// while every node here has exactly two.
fn push_binary_modulated(
    out: &mut RackDescription,
    module: RackModule,
    a: &AudioNode,
    b: &AudioNode,
    modulation: &ModNode,
) {
    push_binary_with(out, module, a, b, Some(modulation));
}

fn push_binary_with(
    out: &mut RackDescription,
    mut module: RackModule,
    a: &AudioNode,
    b: &AudioNode,
    modulation: Option<&ModNode>,
) {
    let (key, column) = (module.key.clone(), module.column);
    let mut structural = std::mem::take(&mut module.structural_addrs);
    let idx = out.modules.len();
    out.modules.push(module);
    let (ka, kb) = (format!("{key}/0"), format!("{key}/1"));
    for k in [&ka, &kb] {
        out.wires.push(Wire {
            from: k.clone(),
            to: key.clone(),
            kind: "audio".into(),
        });
    }
    // Same ordering rule as `push_modulated`: the slot is described after the
    // module is pushed (an empty one hands its `#mod` address back to the
    // owner) and before the branches, so the rack stays root-first
    // depth-first.
    if let Some(m) = modulation {
        describe_mod(
            m,
            &format!("{key}/m"),
            &key,
            column + 1,
            out,
            &mut structural,
        );
    }
    out.modules[idx].structural_addrs = structural;
    describe_node(a, &ka, column + 1, out);
    describe_node(b, &kb, column + 1, out);
}

fn describe_node(n: &AudioNode, key: &str, column: usize, out: &mut RackDescription) {
    let leaf_src = vec![format!("{key}#leaf"), format!("{key}#src")];
    let leaf_op = vec![format!("{key}#leaf"), format!("{key}#op")];
    // Every module below shares everything but its kind, title and knobs.
    let module = |kind: &str, title: &str, knobs: Vec<Knob>, structural: Vec<String>| RackModule {
        key: key.into(),
        kind: kind.into(),
        title: title.into(),
        column,
        is_mod: false,
        knobs,
        structural_addrs: structural,
    };
    match n {
        AudioNode::Vco {
            wave,
            octave,
            detune,
            mod_depth,
            modulation,
        } => push_modulated(
            out,
            module(
                "vco",
                "vco",
                vec![
                    knob_e(key, "wave", "wave", wave.index(), waveform_options()),
                    knob_oct(key, *octave),
                    knob_c(key, "det", "detune", *detune),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_src,
            ),
            // A source has a modulation slot but no audio input to show — and
            // on the two oscillators that slot reaches *pitch*.
            None,
            modulation,
        ),
        AudioNode::Supersaw {
            octave,
            detune,
            mix,
            mod_depth,
            modulation,
        } => push_modulated(
            out,
            module(
                "supersaw",
                "supersaw",
                vec![
                    knob_oct(key, *octave),
                    knob_c(key, "det", "detune", *detune),
                    knob_c(key, "smix", "mix", *mix),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_src,
            ),
            None,
            modulation,
        ),
        AudioNode::Formant {
            vowel,
            shift,
            octave,
            mod_depth,
            modulation,
        } => push_modulated(
            out,
            module(
                "formant",
                "formant",
                vec![
                    knob_c(key, "vowel", "vowel", *vowel),
                    knob_c(key, "fshift", "shift", *shift),
                    knob_oct(key, *octave),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_src,
            ),
            None,
            modulation,
        ),
        AudioNode::Noise { color } => out.modules.push(module(
            "noise",
            "noise",
            vec![knob_e(
                key,
                "color",
                "color",
                color.index(),
                noise_options(),
            )],
            leaf_src,
        )),
        AudioNode::Wavetable {
            table,
            octave,
            morph,
            mod_depth,
            modulation,
        } => push_modulated(
            out,
            module(
                "wavetable",
                "wavetable",
                vec![
                    knob_e(key, "table", "table", table.index(), table_options()),
                    knob_oct(key, *octave),
                    knob_c(key, "morph", "morph", *morph),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_src,
            ),
            // A source has a modulation slot but no audio input to show.
            None,
            modulation,
        ),
        AudioNode::Pluck {
            octave,
            damping,
            brightness,
            mod_depth,
            modulation,
        } => push_modulated(
            out,
            module(
                "pluck",
                "pluck",
                vec![
                    knob_oct(key, *octave),
                    // Labelled "decay", not "damping". quiver's port opens the
                    // loop filter as it rises ("higher damping = brighter",
                    // oscillators.rs), so it lengthens and brightens the
                    // string — which is the opposite of what every synthesist
                    // means by damping. Naming it for what it does beats
                    // inverting it and then having to invert the mod cable to
                    // match.
                    knob_c(key, "damp", "decay", *damping),
                    knob_c(key, "bright", "brightness", *brightness),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_src,
            ),
            None,
            modulation,
        ),
        AudioNode::Mix { balance, a, b } => push_binary(
            out,
            module(
                "mix",
                "mix",
                vec![knob_c(key, "bal", "balance", *balance)],
                leaf_op,
            ),
            a,
            b,
        ),
        AudioNode::RingMod { mix, a, b } => push_binary(
            out,
            module(
                "ringmod",
                "ring mod",
                vec![knob_c(key, "rgmix", "mix", *mix)],
                leaf_op,
            ),
            a,
            b,
        ),
        AudioNode::Filter {
            kind,
            cutoff,
            resonance,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "filter",
                // The ladder is a different circuit with a different
                // reputation; the panel says so even though the kind is one
                // enum site.
                match kind {
                    FilterKind::Ladder => "ladder",
                    _ => "filter",
                },
                vec![
                    knob_e(key, "fkind", "mode", kind.index(), filter_options()),
                    knob_c(key, "cut", "cutoff", *cutoff),
                    knob_c(key, "res", "resonance", *resonance),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Fold {
            threshold,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "fold",
                "wavefolder",
                vec![
                    knob_c(key, "thresh", "fold", *threshold),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Delay {
            time,
            feedback,
            mix,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "delay",
                "delay",
                vec![
                    knob_c(key, "time", "time", *time),
                    knob_c(key, "fb", "feedback", *feedback),
                    knob_c(key, "dmix", "mix", *mix),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Chorus {
            rate,
            depth,
            mix,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "chorus",
                "chorus",
                vec![
                    knob_c(key, "crate", "rate", *rate),
                    knob_c(key, "cdepth", "depth", *depth),
                    knob_c(key, "cmix", "mix", *mix),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Reverb {
            size,
            damp,
            mix,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "reverb",
                "reverb",
                vec![
                    knob_c(key, "rsize", "size", *size),
                    knob_c(key, "rdamp", "damp", *damp),
                    knob_c(key, "rmix", "mix", *mix),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Distortion {
            drive,
            tone,
            mode,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "distortion",
                "distortion",
                vec![
                    knob_c(key, "drive", "drive", *drive),
                    knob_c(key, "tone", "tone", *tone),
                    knob_e(key, "dmode", "mode", mode.index(), drive_mode_options()),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Bitcrush {
            bits,
            downsample,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "bitcrush",
                "bitcrush",
                vec![
                    knob_c(key, "bits", "bits", *bits),
                    knob_c(key, "dsamp", "rate", *downsample),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Phaser {
            rate,
            depth,
            feedback,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "phaser",
                "phaser",
                vec![
                    knob_c(key, "prate", "rate", *rate),
                    knob_c(key, "pdepth", "depth", *depth),
                    knob_c(key, "pfb", "feedback", *feedback),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Flanger {
            rate,
            depth,
            feedback,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "flanger",
                "flanger",
                vec![
                    knob_c(key, "frate", "rate", *rate),
                    knob_c(key, "fdepth", "depth", *depth),
                    knob_c(key, "ffb", "feedback", *feedback),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Tremolo {
            rate,
            depth,
            shape,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "tremolo",
                "tremolo",
                vec![
                    knob_c(key, "trate", "rate", *rate),
                    knob_c(key, "tdepth", "depth", *depth),
                    knob_c(key, "tshape", "shape", *shape),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Vibrato {
            rate,
            depth,
            mix,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "vibrato",
                "vibrato",
                vec![
                    knob_c(key, "vrate", "rate", *rate),
                    knob_c(key, "vdepth", "depth", *depth),
                    knob_c(key, "vmix", "mix", *mix),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Eq {
            low,
            mid,
            high,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "eq",
                "eq",
                vec![
                    knob_c(key, "low", "low", *low),
                    knob_c(key, "mid", "mid", *mid),
                    knob_c(key, "high", "high", *high),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Granular {
            position,
            size,
            density,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "granular",
                "granular",
                vec![
                    knob_c(key, "gpos", "position", *position),
                    knob_c(key, "gsize", "size", *size),
                    knob_c(key, "gdens", "density", *density),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        AudioNode::Shift {
            semis,
            window,
            mix,
            mod_depth,
            input,
            modulation,
        } => push_modulated(
            out,
            module(
                "shift",
                "pitch shift",
                vec![
                    knob_c(key, "semis", "shift", *semis),
                    knob_c(key, "window", "window", *window),
                    knob_c(key, "smix", "mix", *mix),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            Some(input),
            modulation,
        ),
        // The four binary dynamics modules. Their `/0` and `/1` child keys are
        // what the frontend hangs its per-module jack labels off (`in`/`key`,
        // `carrier`/`modulator`, …), so neither the order nor the spelling can
        // move without renaming those.
        AudioNode::Comp {
            threshold,
            ratio,
            makeup,
            mod_depth,
            input,
            sidechain,
            modulation,
        } => push_binary_modulated(
            out,
            module(
                "comp",
                "compressor",
                vec![
                    knob_c(key, "thresh", "threshold", *threshold),
                    knob_c(key, "ratio", "ratio", *ratio),
                    knob_c(key, "makeup", "makeup", *makeup),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            input,
            sidechain,
            modulation,
        ),
        AudioNode::Duck {
            amount,
            threshold,
            release,
            mod_depth,
            input,
            key: key_input,
            modulation,
        } => push_binary_modulated(
            out,
            module(
                "duck",
                "ducker",
                vec![
                    knob_c(key, "amount", "amount", *amount),
                    knob_c(key, "dthresh", "threshold", *threshold),
                    knob_c(key, "drel", "release", *release),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            input,
            key_input,
            modulation,
        ),
        AudioNode::Gate {
            threshold,
            range,
            release,
            mod_depth,
            input,
            sidechain,
            modulation,
        } => push_binary_modulated(
            out,
            module(
                "gate",
                "gate",
                vec![
                    knob_c(key, "gthresh", "threshold", *threshold),
                    knob_c(key, "range", "range", *range),
                    knob_c(key, "grel", "release", *release),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            input,
            sidechain,
            modulation,
        ),
        AudioNode::Vocoder {
            bands,
            attack,
            release,
            mod_depth,
            carrier,
            modulator,
            modulation,
        } => push_binary_modulated(
            out,
            module(
                "vocoder",
                "vocoder",
                vec![
                    knob_c(key, "bands", "bands", *bands),
                    knob_c(key, "vatt", "attack", *attack),
                    knob_c(key, "vrel", "release", *release),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                leaf_op,
            ),
            carrier,
            modulator,
            modulation,
        ),
    }
}

/// Describe a patch as a rack of modules, knobs, and wires.
///
/// The amp/VCA stage (mandatory on every voice) appears as an `amp` module at
/// column 0 with the audio root wired into it.
pub fn describe(tree: &PatchTree) -> RackDescription {
    let mut out = RackDescription {
        modules: Vec::new(),
        wires: Vec::new(),
    };
    out.modules.push(RackModule {
        key: "amp".into(),
        kind: "amp".into(),
        title: "env / out".into(),
        column: 0,
        is_mod: false,
        knobs: vec![
            knob_c("amp", "attack", "attack", tree.amp.attack),
            knob_c("amp", "decay", "decay", tree.amp.decay),
            knob_c("amp", "sustain", "sustain", tree.amp.sustain),
            knob_c("amp", "release", "release", tree.amp.release),
        ],
        structural_addrs: Vec::new(),
    });
    out.wires.push(Wire {
        from: "node".into(),
        to: "amp".into(),
        kind: "audio".into(),
    });
    describe_node(&tree.root, "node", 1, &mut out);
    out
}
