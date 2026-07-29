//! User-driven structural edits: create, delete, replace, and rewire nodes
//! in a patch tree — the "reconnect anything" surface of the workbench.
//!
//! Because the genome is a *typed tree*, rewiring is expressed as a small
//! vocabulary of operations that are type-safe by construction (an LFO can
//! never end up in an audio slot; a filter always has exactly one audio
//! input): replace a node, insert a node into a wire, delete/splice a node,
//! change a modulation source, swap a mixer's inputs. These are the same
//! moves evolution's structural proposals make — hand edits and MH walk the
//! same lattice.
//!
//! Nodes are addressed by their trace **key** (`node`, `node/0`, `node/0/1`,
//! `node/0/m` for mod slots — see [`crate::genome`]).

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::term::{AudioNode, FilterKind, ModNode, NoiseColor, PatchTree, Waveform};

/// Hard ceilings on hand-built patches (protects the realtime voice and the
/// feature pipeline; evolution's own prior rarely exceeds these).
pub const MAX_SIZE: usize = 24;
/// Maximum tree depth for hand-built patches.
pub const MAX_DEPTH: usize = 9;

/// The buildable node palette (everything quiver exposes through the v1
/// grammar).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    /// Band-limited oscillator.
    Vco,
    /// Seven-voice detuned saw stack.
    Supersaw,
    /// Noise source.
    Noise,
    /// Equal-power crossfade.
    Mix,
    /// SVF / ladder filter.
    Filter,
    /// Wavefolder.
    Fold,
    /// Delay line.
    Delay,
    /// Chorus.
    Chorus,
}

impl NodeKind {
    /// Is this a source (leaf) kind?
    pub fn is_source(self) -> bool {
        matches!(self, NodeKind::Vco | NodeKind::Supersaw | NodeKind::Noise)
    }
}

/// A modulation choice for [`StructOp::SetMod`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModKind {
    /// No modulation.
    None,
    /// LFO.
    Lfo,
    /// Attack/decay envelope.
    Env,
}

/// One structural edit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum StructOp {
    /// Replace the node at `key` with a `kind` (subtrees preserved where the
    /// sorts allow; replacing a source with a processor wraps the source).
    Replace {
        /// Node key.
        key: String,
        /// New kind.
        kind: NodeKind,
    },
    /// Insert a processor/mix between the node at `key` and its parent
    /// (i.e., into the wire toward the output).
    Insert {
        /// Node key.
        key: String,
        /// Inserted kind (must not be a source).
        kind: NodeKind,
    },
    /// Delete the node at `key`, splicing its (primary) input up.
    Delete {
        /// Node key.
        key: String,
    },
    /// Set the modulation slot of the filter/fold at `key`.
    SetMod {
        /// Node key.
        key: String,
        /// New modulation kind.
        kind: ModKind,
    },
    /// Swap the two inputs of the mixer at `key`.
    SwapMix {
        /// Node key.
        key: String,
    },
    /// Replace the subtree at `key` with an explicit fragment (the wire
    /// gesture "plug this staged chain in here, discard what was there" —
    /// callers park the old subtree client-side).
    ReplaceTree {
        /// Node key.
        key: String,
        /// The fragment to install.
        node: AudioNode,
    },
    /// Insert an explicit processor/mix fragment into the wire between
    /// `key` and its parent; the old subtree becomes the fragment's primary
    /// input (a Mix keeps its own `b` branch).
    InsertTree {
        /// Node key.
        key: String,
        /// The fragment to graft in (must not be a source).
        node: AudioNode,
    },
    /// Install an explicit modulation fragment on the filter/fold at `key`.
    SetModTree {
        /// Node key.
        key: String,
        /// The modulation term.
        m: ModNode,
    },
}

/// Why a structural edit was rejected.
#[derive(Debug, Error)]
pub enum StructError {
    /// No node at that key.
    #[error("no node at {0}")]
    NoSuchNode(String),
    /// The operation does not apply to this node kind.
    #[error("{0}")]
    Invalid(String),
    /// The edit would exceed the size/depth ceilings.
    #[error("patch would exceed limits ({0} nodes max, depth {1})")]
    TooBig(usize, usize),
}

fn default_node(kind: NodeKind, input: Option<AudioNode>) -> AudioNode {
    let boxed = |n: Option<AudioNode>| {
        Box::new(n.unwrap_or(AudioNode::Vco {
            wave: Waveform::Saw,
            octave: 0,
            detune: 0.5,
        }))
    };
    match kind {
        NodeKind::Vco => AudioNode::Vco {
            wave: Waveform::Saw,
            octave: 0,
            detune: 0.5,
        },
        NodeKind::Supersaw => AudioNode::Supersaw {
            octave: 0,
            detune: 0.35,
            mix: 0.5,
        },
        NodeKind::Noise => AudioNode::Noise {
            color: NoiseColor::White,
        },
        NodeKind::Mix => AudioNode::Mix {
            balance: 0.5,
            a: boxed(input),
            b: Box::new(AudioNode::Vco {
                wave: Waveform::Triangle,
                octave: 0,
                detune: 0.5,
            }),
        },
        NodeKind::Filter => AudioNode::Filter {
            kind: FilterKind::SvfLp,
            cutoff: 0.6,
            resonance: 0.3,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Fold => AudioNode::Fold {
            threshold: 0.5,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Delay => AudioNode::Delay {
            time: 0.35,
            feedback: 0.35,
            mix: 0.35,
            input: boxed(input),
        },
        NodeKind::Chorus => AudioNode::Chorus {
            rate: 0.3,
            depth: 0.4,
            mix: 0.35,
            input: boxed(input),
        },
    }
}

fn primary_input(n: AudioNode) -> Option<AudioNode> {
    match n {
        AudioNode::Vco { .. } | AudioNode::Supersaw { .. } | AudioNode::Noise { .. } => None,
        AudioNode::Mix { a, .. } => Some(*a),
        AudioNode::Filter { input, .. }
        | AudioNode::Fold { input, .. }
        | AudioNode::Delay { input, .. }
        | AudioNode::Chorus { input, .. } => Some(*input),
    }
}

/// Parse a node key (`node`, `node/0`, `node/0/1`) into a child-index path.
fn parse_key(key: &str) -> Option<Vec<usize>> {
    let rest = key.strip_prefix("node")?;
    if rest.is_empty() {
        return Some(Vec::new());
    }
    rest.strip_prefix('/')?
        .split('/')
        .map(|s| s.parse::<usize>().ok())
        .collect()
}

fn child_mut(n: &mut AudioNode, i: usize) -> Option<&mut AudioNode> {
    match n {
        AudioNode::Mix { a, b, .. } => match i {
            0 => Some(a),
            1 => Some(b),
            _ => None,
        },
        AudioNode::Filter { input, .. }
        | AudioNode::Fold { input, .. }
        | AudioNode::Delay { input, .. }
        | AudioNode::Chorus { input, .. } => (i == 0).then_some(input),
        _ => None,
    }
}

fn node_at_mut<'a>(root: &'a mut AudioNode, path: &[usize]) -> Option<&'a mut AudioNode> {
    let mut cur = root;
    for &i in path {
        cur = child_mut(cur, i)?;
    }
    Some(cur)
}

fn take(n: &mut AudioNode) -> AudioNode {
    std::mem::replace(
        n,
        AudioNode::Noise {
            color: NoiseColor::White,
        },
    )
}

/// Apply a structural edit, returning the new tree.
pub fn apply_struct_op(tree: &PatchTree, op: &StructOp) -> Result<PatchTree, StructError> {
    let mut out = tree.clone();
    match op {
        StructOp::Replace { key, kind } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let old = take(slot);
            *slot = if kind.is_source() {
                // Source kinds swap in place; any old subtree is dropped.
                default_node(*kind, None)
            } else {
                // Processor/mix keeps the old primary input; replacing a
                // source wraps that source.
                let input = match primary_input(old.clone()) {
                    Some(i) => Some(i),
                    None => Some(old),
                };
                default_node(*kind, input)
            };
        }
        StructOp::Insert { key, kind } => {
            if kind.is_source() {
                return Err(StructError::Invalid(
                    "sources cannot be inserted into a wire — use replace, or insert a mix".into(),
                ));
            }
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let old = take(slot);
            *slot = default_node(*kind, Some(old));
        }
        StructOp::Delete { key } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            // Deleting a mix branch collapses the mix to the sibling.
            if let Some((&last, parent_path)) = path.split_last() {
                let parent = node_at_mut(&mut out.root, parent_path)
                    .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
                if let AudioNode::Mix { a, b, .. } = parent {
                    let keep = take(if last == 0 { b } else { a });
                    *parent = keep;
                    return finish(out);
                }
            }
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let old = take(slot);
            match primary_input(old) {
                Some(input) => *slot = input,
                None => {
                    return Err(StructError::Invalid(
                        "a lone source cannot be deleted — replace it instead".into(),
                    ))
                }
            }
        }
        StructOp::SetMod { key, kind } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let m = match slot {
                AudioNode::Filter { modulation, .. } | AudioNode::Fold { modulation, .. } => {
                    modulation
                }
                _ => {
                    return Err(StructError::Invalid(
                        "only filters and wavefolders have a modulation slot".into(),
                    ))
                }
            };
            *m = match kind {
                ModKind::None => ModNode::None,
                ModKind::Lfo => ModNode::Lfo {
                    wave: Waveform::Triangle,
                    rate: 0.4,
                },
                ModKind::Env => ModNode::Env {
                    attack: 0.2,
                    decay: 0.5,
                },
            };
        }
        StructOp::SwapMix { key } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            match slot {
                AudioNode::Mix { a, b, balance } => {
                    std::mem::swap(a, b);
                    *balance = 1.0 - *balance;
                }
                _ => return Err(StructError::Invalid("not a mixer".into())),
            }
        }
        StructOp::ReplaceTree { key, node } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            *slot = node.clone();
        }
        StructOp::InsertTree { key, node } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let old = take(slot);
            *slot = graft(node.clone(), old)?;
        }
        StructOp::SetModTree { key, m } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            match slot {
                AudioNode::Filter { modulation, .. } | AudioNode::Fold { modulation, .. } => {
                    *modulation = m.clone();
                }
                _ => {
                    return Err(StructError::Invalid(
                        "only filters and wavefolders have a modulation slot".into(),
                    ))
                }
            }
        }
    }
    finish(out)
}

/// Graft `old` into `frag`'s primary input slot (Mix keeps its `b`).
fn graft(frag: AudioNode, old: AudioNode) -> Result<AudioNode, StructError> {
    match frag {
        AudioNode::Mix { balance, b, .. } => Ok(AudioNode::Mix {
            balance,
            a: Box::new(old),
            b,
        }),
        AudioNode::Filter {
            kind,
            cutoff,
            resonance,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Filter {
            kind,
            cutoff,
            resonance,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Fold {
            threshold,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Fold {
            threshold,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Delay {
            time,
            feedback,
            mix,
            ..
        } => Ok(AudioNode::Delay {
            time,
            feedback,
            mix,
            input: Box::new(old),
        }),
        AudioNode::Chorus {
            rate, depth, mix, ..
        } => Ok(AudioNode::Chorus {
            rate,
            depth,
            mix,
            input: Box::new(old),
        }),
        AudioNode::Vco { .. } | AudioNode::Supersaw { .. } | AudioNode::Noise { .. } => Err(
            StructError::Invalid("a source has no input to splice into".into()),
        ),
    }
}

fn finish(tree: PatchTree) -> Result<PatchTree, StructError> {
    if tree.root.size() > MAX_SIZE || tree.root.depth() > MAX_DEPTH {
        return Err(StructError::TooBig(MAX_SIZE, MAX_DEPTH));
    }
    Ok(tree)
}
