//! The cable probe: how much signal each audio cable of a patch carries,
//! measured while the patch plays the phrase (Plan-005 task 9e).
//!
//! PATCH draws every audio cable with light by its signal. While notes sound
//! the live voices meter their interior ports (`LivePoly::set_meter` in
//! `auracle-wasm`); at rest there was nothing to read, and the cables fell
//! back to an estimate of reach. This is the measured level at rest: one
//! render of the phrase with every audio cable read after every tick.
//!
//! - **The cables are the rack's.** One row per audio wire of
//!   [`auracle_grammar::describe`], in its order, with its `from` and `to`
//!   module keys (what PATCH's `data-from` and `data-to` carry) and both
//!   modules' uids (what PATCH's cable identity, `midOf(from)>midOf(to)`, is
//!   made of; the amp's uid is 0). A module's output feeds exactly one
//!   parent, so a cable's level is its `from` module's output: the port
//!   [`auracle_grammar::CompiledVoice::taps`] names. Modulation cables are
//!   not measured: the compiler taps audio nodes only, and PATCH draws a
//!   modulation cable by its rate, not its level.
//! - **The scale is the live meter's:** dB re 1 V of the raw port value
//!   (quiver's `calculate_rms_db`, which `LivePoly`'s meter reports), so one
//!   mapping serves the measured and the live level. A cable that carries
//!   nothing at all reads [`PROBE_FLOOR_DB`].
//! - **One voice, the whole phrase.** The levels are the main voice's, the
//!   one that plays every note of the phrase, over every sample of it, gaps
//!   included (the live meter also reads one voice). A chord's extra voices
//!   are not measured. A source keeps running while its gate is closed, and
//!   the amp, which closes it, comes after every cable, so a cable's level is
//!   what reaches the amp, not what leaves it.
//! - **It does not change the audio.** The probe reads each port's last
//!   value through the routing's slot and writes nothing, so a render it
//!   watches is the render it would have been, bit for bit
//!   (`the_probe_does_not_change_the_render`). It is not φ either: nothing
//!   here reaches the featurizer.
//!
//! It costs one render of the phrase and a read per cable per sample (the
//! `cable_probe` example measures both).

use auracle_grammar::{describe, CompiledVoice, PatchTree};
use quiver::PatchError;
use serde::{Deserialize, Serialize};

use crate::phrase::PhraseSpec;
use crate::render::{render_phrase_observed, RenderedPhrase, VoiceObserver};

/// The level a cable that carries nothing reads, in dB re 1 V: far below
/// anything audible, and finite, so it crosses JSON as a number.
pub const PROBE_FLOOR_DB: f64 = -120.0;

/// One audio cable's level over the phrase.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CableLevel {
    /// The module the cable leaves (its key, as the rack names it).
    pub from: String,
    /// The module it enters (`"amp"` for the output stage).
    pub to: String,
    /// `from`'s uid (0 when the tree is not settled).
    pub from_uid: u64,
    /// `to`'s uid (0 for the amp, and when the tree is not settled).
    pub to_uid: u64,
    /// RMS over the phrase, dB re 1 V, floored at [`PROBE_FLOOR_DB`].
    pub rms_db: f64,
    /// Peak over the phrase, dB re 1 V, floored at [`PROBE_FLOOR_DB`].
    pub peak_db: f64,
}

/// Every audio cable of a patch, measured on one render of the phrase.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CableProbe {
    /// The rack's audio cables, in [`describe`]'s order.
    pub cables: Vec<CableLevel>,
    /// How many samples each level is taken over.
    pub samples: usize,
}

fn db(x: f64) -> f64 {
    if x > 0.0 {
        (20.0 * x.log10()).max(PROBE_FLOOR_DB)
    } else {
        PROBE_FLOOR_DB
    }
}

/// The observer: each cable's routing slot on the main voice, and its
/// running sum of squares and peak.
struct Probe {
    /// Each cable's tap key (its `from`), in cable order.
    keys: Vec<String>,
    /// Each cable's routing slot, resolved once when the voice is compiled.
    slots: Vec<Option<usize>>,
    sum_sq: Vec<f64>,
    peak: Vec<f64>,
    n: usize,
}

impl VoiceObserver for Probe {
    fn start(&mut self, voice: &CompiledVoice) {
        // The slot, not `get_output_value`, per sample: the latter hashes the
        // port on every call, and this reads every cable every sample.
        self.slots = self
            .keys
            .iter()
            .map(|key| {
                let (name, port) = voice.taps.get(key)?;
                let node = voice.patch.get_node_id_by_name(name)?;
                voice.patch.output_slot(node, *port)
            })
            .collect();
    }

    #[inline]
    fn tick(&mut self, voice: &CompiledVoice) {
        for (i, slot) in self.slots.iter().enumerate() {
            let Some(v) = slot.and_then(|s| voice.patch.output_value_at(s)) else {
                continue;
            };
            self.sum_sq[i] += v * v;
            let a = v.abs();
            if a > self.peak[i] {
                self.peak[i] = a;
            }
        }
        self.n += 1;
    }
}

/// Render `tree` on `spec` and measure every audio cable while it plays.
///
/// The render is [`crate::render_phrase`]'s, bit for bit; the levels ride
/// beside it.
pub fn probe_cables(
    tree: &PatchTree,
    spec: &PhraseSpec,
) -> Result<(RenderedPhrase, CableProbe), PatchError> {
    let rack = describe(tree);
    let uid_of = |key: &str| {
        rack.modules
            .iter()
            .find(|m| m.key == key)
            .map_or(0, |m| m.uid)
    };
    let wires: Vec<_> = rack.wires.iter().filter(|w| w.kind == "audio").collect();
    let mut probe = Probe {
        keys: wires.iter().map(|w| w.from.clone()).collect(),
        slots: Vec::new(),
        sum_sq: vec![0.0; wires.len()],
        peak: vec![0.0; wires.len()],
        n: 0,
    };
    let render = render_phrase_observed(tree, spec, &mut probe)?;
    let n = probe.n.max(1) as f64;
    let cables = wires
        .iter()
        .enumerate()
        .map(|(i, w)| CableLevel {
            from: w.from.clone(),
            to: w.to.clone(),
            from_uid: uid_of(&w.from),
            to_uid: uid_of(&w.to),
            rms_db: db((probe.sum_sq[i] / n).sqrt()),
            peak_db: db(probe.peak[i]),
        })
        .collect();
    Ok((
        render,
        CableProbe {
            cables,
            samples: probe.n,
        },
    ))
}

/// [`probe_cables`]'s levels alone.
pub fn cable_levels(tree: &PatchTree, spec: &PhraseSpec) -> Result<CableProbe, PatchError> {
    probe_cables(tree, spec).map(|(_, p)| p)
}

#[cfg(test)]
mod tests;
