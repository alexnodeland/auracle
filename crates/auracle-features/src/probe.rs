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
mod tests {
    use super::*;
    use crate::phrase::Note;
    use crate::render_phrase;
    use auracle_grammar::term::{AmpEnv, AudioNode, FilterKind, ModNode, Uid, Waveform};

    /// One held note, no chord: a level a test can work out by hand.
    fn mono() -> PhraseSpec {
        PhraseSpec {
            notes: vec![Note {
                voct: 0.0,
                on_s: 0.5,
                off_s: 0.1,
                chord: Vec::new(),
            }],
            ..PhraseSpec::default()
        }
    }

    fn amp() -> AmpEnv {
        AmpEnv {
            attack: 0.01,
            decay: 0.2,
            sustain: 0.8,
            release: 0.1,
        }
    }

    fn saw() -> AudioNode {
        AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Saw,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
        }
    }

    fn level<'a>(p: &'a CableProbe, from: &str) -> &'a CableLevel {
        p.cables
            .iter()
            .find(|c| c.from == from)
            .unwrap_or_else(|| panic!("no cable from `{from}`"))
    }

    /// **A known patch reads its known level.** A lone saw VCO swings ±5 V,
    /// so its RMS is 5/√3 V (9.2 dB re 1 V) and its peak 5 V (14.0 dB);
    /// band-limiting rounds the corners and moves both a little. Under a
    /// lowpass closed to the bottom of its range the same saw reads far
    /// lower, and an empty socket reads the floor.
    #[test]
    fn a_known_patch_reads_its_known_level() {
        let spec = mono();
        let alone = cable_levels(
            &PatchTree {
                amp: amp(),
                root: saw(),
            },
            &spec,
        )
        .expect("renders");
        assert_eq!(alone.cables.len(), 1);
        let c = &alone.cables[0];
        assert_eq!((c.from.as_str(), c.to.as_str()), ("node", "amp"));
        let rms = 20.0 * (5.0 / 3f64.sqrt()).log10();
        assert!(
            (c.rms_db - rms).abs() < 0.5,
            "a ±5 V saw reads {:.2} dB RMS, not {rms:.2}",
            c.rms_db
        );
        assert!(
            (c.peak_db - 20.0 * 5f64.log10()).abs() < 1.0,
            "a ±5 V saw peaks at {:.2} dB",
            c.peak_db
        );
        assert_eq!(alone.samples, spec.total_samples());

        let filtered = PatchTree {
            amp: amp(),
            root: AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::SvfLp,
                cutoff: 0.0,
                resonance: 0.0,
                mod_depth: 0.0,
                input: Box::new(saw()),
                modulation: ModNode::None,
            },
        };
        let p = cable_levels(&filtered, &spec).expect("renders");
        assert_eq!(p.cables.len(), 2);
        let (out, into) = (level(&p, "node"), level(&p, "node/0"));
        assert!(
            (into.rms_db - c.rms_db).abs() < 1e-9,
            "the saw under the filter reads what the saw alone reads"
        );
        assert!(
            out.rms_db < into.rms_db - 12.0,
            "a closed lowpass passes {:.1} dB of a saw's {:.1}",
            out.rms_db,
            into.rms_db
        );

        let empty = PatchTree {
            amp: amp(),
            root: AudioNode::Silence { uid: Uid::NEW },
        };
        let p = cable_levels(&empty, &spec).expect("renders");
        assert_eq!(p.cables[0].rms_db, PROBE_FLOOR_DB);
        assert_eq!(p.cables[0].peak_db, PROBE_FLOOR_DB);
    }

    /// **The probe does not change the render,** bit for bit, on every
    /// preset, under the standard phrase (chords included).
    #[test]
    fn the_probe_does_not_change_the_render() {
        let spec = PhraseSpec::default();
        for (name, tree) in auracle_grammar::presets().iter().step_by(4) {
            let plain = render_phrase(tree, &spec).expect("renders").samples;
            let (probed, levels) = probe_cables(tree, &spec).expect("renders");
            assert!(
                plain.len() == probed.samples.len()
                    && plain
                        .iter()
                        .zip(&probed.samples)
                        .all(|(a, b)| a.to_bits() == b.to_bits()),
                "{name}: the probed render differs from the plain one"
            );
            assert!(
                levels.cables.iter().any(|c| c.rms_db > PROBE_FLOOR_DB),
                "{name}: no cable carries anything"
            );
        }
    }

    /// **The cables are the rack's:** one per audio wire of `describe`, in
    /// its order, with the keys PATCH draws them by and the uids its cable
    /// identity is made of; every one is measured (a tap resolves for every
    /// `from`); and a second probe of the same tree reads the same.
    #[test]
    fn the_cables_are_the_racks() {
        let spec = mono();
        for (name, tree) in auracle_grammar::presets().iter().step_by(3) {
            let mut tree = tree.clone();
            tree.ensure_uids();
            let rack = describe(&tree);
            let wires: Vec<_> = rack.wires.iter().filter(|w| w.kind == "audio").collect();
            let p = cable_levels(&tree, &spec).expect("renders");
            assert_eq!(p.cables.len(), wires.len(), "{name}");
            let voice = auracle_grammar::compile(&tree, spec.sample_rate).expect("compiles");
            for (c, w) in p.cables.iter().zip(&wires) {
                assert_eq!((&c.from, &c.to), (&w.from, &w.to), "{name}");
                let uid = |k: &str| rack.modules.iter().find(|m| m.key == k).unwrap().uid;
                assert_eq!(c.from_uid, uid(&c.from), "{name}");
                assert_eq!(c.to_uid, uid(&c.to), "{name}");
                assert_ne!(c.from_uid, 0, "{name}: a settled module has a uid");
                assert!(
                    voice.taps.contains_key(&c.from),
                    "{name}: `{}` has no tap",
                    c.from
                );
            }
            assert_eq!(p, cable_levels(&tree, &spec).expect("renders"), "{name}");
        }
    }
}
