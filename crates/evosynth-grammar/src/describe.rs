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

use crate::term::{AudioNode, FilterKind, ModNode, NoiseColor, PatchTree, Waveform};

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
    /// Trace key of the node (`node`, `node/0`, `node/0/m`, `amp`).
    pub key: String,
    /// Machine kind tag (`vco`, `filter`, `lfo`, `amp`, …).
    pub kind: String,
    /// Silkscreen title.
    pub title: String,
    /// Distance from the root (root = 0); layout hint for column placement.
    pub column: usize,
    /// True for modulation-sort modules (LFO / mod envelope).
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

fn describe_mod(
    m: &ModNode,
    key: &str,
    parent_key: &str,
    column: usize,
    out: &mut RackDescription,
    parent_structural: &mut Vec<String>,
) {
    match m {
        ModNode::None => {
            // The empty slot's choice site belongs to the parent: locking the
            // parent pins "no modulation" in place.
            parent_structural.push(format!("{key}#mod"));
        }
        ModNode::Lfo { wave, rate } => {
            out.modules.push(RackModule {
                key: key.into(),
                kind: "lfo".into(),
                title: "lfo".into(),
                column,
                is_mod: true,
                knobs: vec![
                    knob_e(key, "wave", "wave", wave.index(), waveform_options()),
                    knob_c(key, "rate", "rate", *rate),
                ],
                structural_addrs: vec![format!("{key}#mod")],
            });
            out.wires.push(Wire {
                from: key.into(),
                to: parent_key.into(),
                kind: "mod".into(),
            });
        }
        ModNode::Env { attack, decay } => {
            out.modules.push(RackModule {
                key: key.into(),
                kind: "modenv".into(),
                title: "mod env".into(),
                column,
                is_mod: true,
                knobs: vec![
                    knob_c(key, "att", "attack", *attack),
                    knob_c(key, "dec", "decay", *decay),
                ],
                structural_addrs: vec![format!("{key}#mod")],
            });
            out.wires.push(Wire {
                from: key.into(),
                to: parent_key.into(),
                kind: "mod".into(),
            });
        }
        ModNode::Rand { rate } => {
            out.modules.push(RackModule {
                key: key.into(),
                kind: "rand".into(),
                title: "s&h rand".into(),
                column,
                is_mod: true,
                knobs: vec![knob_c(key, "rate", "rate", *rate)],
                structural_addrs: vec![format!("{key}#mod")],
            });
            out.wires.push(Wire {
                from: key.into(),
                to: parent_key.into(),
                kind: "mod".into(),
            });
        }
    }
}

fn describe_node(n: &AudioNode, key: &str, column: usize, out: &mut RackDescription) {
    let leaf_src = vec![format!("{key}#leaf"), format!("{key}#src")];
    let leaf_op = vec![format!("{key}#leaf"), format!("{key}#op")];
    match n {
        AudioNode::Vco {
            wave,
            octave,
            detune,
        } => out.modules.push(RackModule {
            key: key.into(),
            kind: "vco".into(),
            title: "vco".into(),
            column,
            is_mod: false,
            knobs: vec![
                knob_e(key, "wave", "wave", wave.index(), waveform_options()),
                knob_oct(key, *octave),
                knob_c(key, "det", "detune", *detune),
            ],
            structural_addrs: leaf_src,
        }),
        AudioNode::Supersaw {
            octave,
            detune,
            mix,
        } => out.modules.push(RackModule {
            key: key.into(),
            kind: "supersaw".into(),
            title: "supersaw".into(),
            column,
            is_mod: false,
            knobs: vec![
                knob_oct(key, *octave),
                knob_c(key, "det", "detune", *detune),
                knob_c(key, "smix", "mix", *mix),
            ],
            structural_addrs: leaf_src,
        }),
        AudioNode::Noise { color } => out.modules.push(RackModule {
            key: key.into(),
            kind: "noise".into(),
            title: "noise".into(),
            column,
            is_mod: false,
            knobs: vec![knob_e(
                key,
                "color",
                "color",
                color.index(),
                noise_options(),
            )],
            structural_addrs: leaf_src,
        }),
        AudioNode::Mix { balance, a, b } => {
            out.modules.push(RackModule {
                key: key.into(),
                kind: "mix".into(),
                title: "mix".into(),
                column,
                is_mod: false,
                knobs: vec![knob_c(key, "bal", "balance", *balance)],
                structural_addrs: leaf_op,
            });
            let (ka, kb) = (format!("{key}/0"), format!("{key}/1"));
            for k in [&ka, &kb] {
                out.wires.push(Wire {
                    from: k.clone(),
                    to: key.into(),
                    kind: "audio".into(),
                });
            }
            describe_node(a, &ka, column + 1, out);
            describe_node(b, &kb, column + 1, out);
        }
        AudioNode::Filter {
            kind,
            cutoff,
            resonance,
            mod_depth,
            input,
            modulation,
        } => {
            let mut structural = leaf_op;
            let title = match kind {
                FilterKind::Ladder => "ladder",
                _ => "filter",
            };
            let idx = out.modules.len();
            out.modules.push(RackModule {
                key: key.into(),
                kind: "filter".into(),
                title: title.into(),
                column,
                is_mod: false,
                knobs: vec![
                    knob_e(key, "fkind", "mode", kind.index(), filter_options()),
                    knob_c(key, "cut", "cutoff", *cutoff),
                    knob_c(key, "res", "resonance", *resonance),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                structural_addrs: Vec::new(),
            });
            let child = format!("{key}/0");
            out.wires.push(Wire {
                from: child.clone(),
                to: key.into(),
                kind: "audio".into(),
            });
            describe_mod(
                modulation,
                &format!("{key}/m"),
                key,
                column + 1,
                out,
                &mut structural,
            );
            out.modules[idx].structural_addrs = structural;
            describe_node(input, &child, column + 1, out);
        }
        AudioNode::Fold {
            threshold,
            mod_depth,
            input,
            modulation,
        } => {
            let mut structural = leaf_op;
            let idx = out.modules.len();
            out.modules.push(RackModule {
                key: key.into(),
                kind: "fold".into(),
                title: "wavefolder".into(),
                column,
                is_mod: false,
                knobs: vec![
                    knob_c(key, "thresh", "fold", *threshold),
                    knob_c(key, "mdepth", "mod depth", *mod_depth),
                ],
                structural_addrs: Vec::new(),
            });
            let child = format!("{key}/0");
            out.wires.push(Wire {
                from: child.clone(),
                to: key.into(),
                kind: "audio".into(),
            });
            describe_mod(
                modulation,
                &format!("{key}/m"),
                key,
                column + 1,
                out,
                &mut structural,
            );
            out.modules[idx].structural_addrs = structural;
            describe_node(input, &child, column + 1, out);
        }
        AudioNode::Delay {
            time,
            feedback,
            mix,
            input,
        } => {
            out.modules.push(RackModule {
                key: key.into(),
                kind: "delay".into(),
                title: "delay".into(),
                column,
                is_mod: false,
                knobs: vec![
                    knob_c(key, "time", "time", *time),
                    knob_c(key, "fb", "feedback", *feedback),
                    knob_c(key, "dmix", "mix", *mix),
                ],
                structural_addrs: leaf_op,
            });
            let child = format!("{key}/0");
            out.wires.push(Wire {
                from: child.clone(),
                to: key.into(),
                kind: "audio".into(),
            });
            describe_node(input, &child, column + 1, out);
        }
        AudioNode::Chorus {
            rate,
            depth,
            mix,
            input,
        } => {
            out.modules.push(RackModule {
                key: key.into(),
                kind: "chorus".into(),
                title: "chorus".into(),
                column,
                is_mod: false,
                knobs: vec![
                    knob_c(key, "crate", "rate", *rate),
                    knob_c(key, "cdepth", "depth", *depth),
                    knob_c(key, "cmix", "mix", *mix),
                ],
                structural_addrs: leaf_op,
            });
            let child = format!("{key}/0");
            out.wires.push(Wire {
                from: child.clone(),
                to: key.into(),
                kind: "audio".into(),
            });
            describe_node(input, &child, column + 1, out);
        }
        AudioNode::Reverb {
            size,
            damp,
            mix,
            input,
        } => {
            out.modules.push(RackModule {
                key: key.into(),
                kind: "reverb".into(),
                title: "reverb".into(),
                column,
                is_mod: false,
                knobs: vec![
                    knob_c(key, "rsize", "size", *size),
                    knob_c(key, "rdamp", "damp", *damp),
                    knob_c(key, "rmix", "mix", *mix),
                ],
                structural_addrs: leaf_op,
            });
            let child = format!("{key}/0");
            out.wires.push(Wire {
                from: child.clone(),
                to: key.into(),
                kind: "audio".into(),
            });
            describe_node(input, &child, column + 1, out);
        }
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
