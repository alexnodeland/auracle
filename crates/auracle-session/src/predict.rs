//! A wiring before the measurement (#290): PERFORM's controls play the moment
//! a sound is taken, on a wiring borrowed from a measured relative or
//! predicted from the tree alone, and the measurement refines it when it
//! lands.
//!
//! A measurement ([`Engine::wire_named`]) is one render per continuous knob
//! and four per reachable control: 8 to 71 renders on a pool sound, 14 s of
//! CPU on average in wasm on a fast laptop and four times that on a slow one
//! (`auracle-wasm`'s `examples/wire_cost.mjs`). Nothing a render pays for can
//! be instant, so this module pays for none:
//!
//! * **Borrowed.** A relative that was measured and has the same structure
//!   (a bred child whose walk moved only knobs, the source of a knob edit or
//!   of a taken offer that kept the structure) has the same knobs at the same
//!   addresses. [`shape_of`] is that structure as a key: the trace's
//!   choices other than the continuous ones. The page keeps it beside every
//!   wiring it caches and plays a relative's wiring on this tree's values.
//! * **Predicted.** Otherwise, [`KnobTable`] says how each kind of module's
//!   knob moves φ: the median, per audio coordinate, of measured Jacobian
//!   columns in raw units, keyed by the module's kind, the knob's site, what a
//!   modulator drives and which third of its range the knob sits in, backing
//!   off to coarser keys where the finer one was measured too rarely
//!   ([`TABLE_MIN`]). [`Engine::wire_predicted`] standardizes the predicted
//!   columns with this session's standardizer and runs the measurement's own
//!   solve ([`wire_set`]) on them: arithmetic and a compile, no render.
//!
//! How good a predicted wiring is, `examples/wire_predict.rs` measured on 240
//! pool sounds held out by session: from the presets and one session's pool,
//! 76% of the controls it wires turn the way their name says on the sound's
//! own Jacobian, and it covers 56% of what the measurement reaches; Space and
//! Snap are reliable, Motion and Body are not. The reference's older table
//! (keyed by the bare site name, and judged by purity) is why the measurement
//! stays the truth: a predicted wiring is unverified ([`Wiring::up`] and
//! [`Wiring::down`] are `None`) and the page draws it as a guess.
use std::collections::BTreeMap;
use std::collections::HashMap;

use auracle_features::{render_key, AudioFeatures};
use auracle_grammar::{describe, PatchTree};
use fugue_evo::genome::trace_genome::{ChoiceValue, TraceGenome};
use serde::{Deserialize, Serialize};

use crate::engine::Engine;
use crate::perform::{
    live_knobs, standardized_audio, wire_set, Jacobian, NamedControl, Wiring, SEMANTIC_RIDGE,
};

/// Fewest measured columns a key needs to stand for its knobs in the table.
/// Below it a key says more about one patch than about its kind of knob, and
/// the knob is looked up by a coarser key. The census
/// (`examples/wire_predict.rs`) measured three against one and two.
pub const TABLE_MIN: usize = 3;

/// How each kind of module's knob moves φ: per key ([`knob_keys`]), the
/// median of measured `∂φ_audio/∂p` columns in raw audio-φ units per unit of
/// knob travel.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct KnobTable {
    /// The audio φ names the columns run over ([`AudioFeatures::NAMES`] when
    /// the table was learned). A table over other names predicts nothing.
    pub names: Vec<String>,
    /// Key → column, every level of [`knob_keys`] in one map.
    pub cols: BTreeMap<String, Vec<f64>>,
}

/// One measured sound, as [`KnobTable::learn`] takes it: the tree, its
/// Jacobian (standardized columns) and the audio standardizer's spreads the
/// columns were standardized with.
pub struct Measured<'a> {
    /// The measured tree.
    pub tree: &'a PatchTree,
    /// Its Jacobian, standardized.
    pub jac: &'a Jacobian,
    /// The standardizer's spread for each audio coordinate.
    pub spread: &'a [f64],
}

/// The keys `addr` (a continuous knob of `tree` at `value`) is looked up by,
/// finest first: the module's kind, the knob's site, what a modulator drives
/// (empty in the audio path) and which third of its range the knob sits in;
/// then without the third; then without the target; then the site alone.
/// The module comes from the rack's description ([`describe`]), so a knob
/// the rack does not show has only its site.
pub fn knob_keys(tree: &PatchTree, knobs: &[(String, f64)]) -> Vec<[String; 4]> {
    let rack = describe(tree);
    let kind_at: HashMap<&str, &str> = rack
        .modules
        .iter()
        .map(|m| (m.key.as_str(), m.kind.as_str()))
        .collect();
    let mut module: HashMap<&str, (&str, &str)> = HashMap::new();
    for m in &rack.modules {
        // A modulator lives under its target's `/m` slot.
        let dest = if m.is_mod {
            let slot = m.key.split("/m").next().unwrap_or(&m.key);
            kind_at.get(slot).copied().unwrap_or("?")
        } else {
            ""
        };
        for k in &m.knobs {
            module.insert(k.addr.as_str(), (m.kind.as_str(), dest));
        }
    }
    knobs
        .iter()
        .map(|(addr, value)| {
            let site = addr.rsplit('#').next().unwrap_or(addr);
            let (kind, dest) = module.get(addr.as_str()).copied().unwrap_or(("?", ""));
            let third = (value * 3.0).floor().clamp(0.0, 2.0) as u8;
            [
                format!("{kind}#{site}>{dest}@{third}"),
                format!("{kind}#{site}>{dest}"),
                format!("{kind}#{site}"),
                site.to_string(),
            ]
        })
        .collect()
}

impl KnobTable {
    /// Learn the table from measured sounds: every column, put back in raw
    /// units, under each of its knob's keys; a key measured at least
    /// [`TABLE_MIN`] times keeps the median of its columns, coordinate by
    /// coordinate (the census measured the median against the mean: a few
    /// patches where a knob moves φ a long way pulled the mean's prediction
    /// onto every patch).
    pub fn learn(measured: &[Measured]) -> KnobTable {
        let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
        let mut by: BTreeMap<String, Vec<Vec<f64>>> = BTreeMap::new();
        for m in measured {
            let knobs: Vec<(String, f64)> = m
                .jac
                .addrs
                .iter()
                .cloned()
                .zip(m.jac.values.iter().copied())
                .collect();
            for (keys, col) in knob_keys(m.tree, &knobs).into_iter().zip(&m.jac.cols) {
                let raw: Vec<f64> = col.iter().zip(m.spread).map(|(c, s)| c * s).collect();
                for key in keys {
                    by.entry(key).or_default().push(raw.clone());
                }
            }
        }
        let cols = by
            .into_iter()
            .filter(|(_, v)| v.len() >= TABLE_MIN)
            .map(|(k, v)| (k, median_by_coordinate(&v)))
            .collect();
        KnobTable { names, cols }
    }

    /// The column the table holds for a knob, by the finest of its `keys`
    /// that it holds, or `None`.
    pub fn column(&self, keys: &[String; 4]) -> Option<&Vec<f64>> {
        keys.iter().find_map(|k| self.cols.get(k))
    }

    /// The predicted Jacobian columns of `knobs` on `tree`, standardized by
    /// `spread` (the session's audio standardizer): a knob the table does not
    /// know gets a zero column, which the solve then cannot use. `None` when
    /// the table was learned over other audio φ names than today's.
    pub fn predict(
        &self,
        tree: &PatchTree,
        knobs: &[(String, f64)],
        spread: &[f64],
    ) -> Option<Vec<Vec<f64>>> {
        if self.names.len() != AudioFeatures::NAMES.len()
            || self
                .names
                .iter()
                .zip(AudioFeatures::NAMES)
                .any(|(a, b)| a != b)
        {
            return None;
        }
        let n = self.names.len();
        Some(
            knob_keys(tree, knobs)
                .iter()
                .map(|keys| match self.column(keys) {
                    Some(raw) => raw.iter().zip(spread).map(|(r, s)| r / s).collect(),
                    None => vec![0.0; n],
                })
                .collect(),
        )
    }
}

/// The median of each coordinate over `cols` (all the same length, at least
/// one), the upper middle of an even count.
fn median_by_coordinate(cols: &[Vec<f64>]) -> Vec<f64> {
    (0..cols[0].len())
        .map(|j| {
            let mut xs: Vec<f64> = cols.iter().map(|c| c[j]).collect();
            xs.sort_by(f64::total_cmp);
            xs[xs.len() / 2]
        })
        .collect()
}

/// What `tree` is without its knob values: every choice of its trace other
/// than a continuous one (the modules, their places, their selectors), as
/// `addr=value` in trace order, hashed (FNV-1a, 64 bits, as hex) so a page can
/// keep it beside each wiring it caches. Two trees with the same shape have
/// the same continuous knobs at the same addresses, so one's wiring turns the
/// other's knobs.
pub fn shape_of(tree: &PatchTree) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for (addr, c) in tree.to_trace().choices.iter() {
        let v = match &c.value {
            ChoiceValue::F64(_) => continue,
            other => format!("{addr}={other:?};"),
        };
        for b in v.bytes() {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{h:016x}")
}

impl Engine {
    /// `controls` wired onto `tree` from `table`, with no render: its live
    /// knobs (a compile), their columns as the table predicts them under this
    /// session's standardizer, and the measurement's solve ([`wire_set`]) on
    /// those. The wirings are unverified, so each turns both ways. `z` is the
    /// tree's standardized audio φ if the memo holds its render (a pool
    /// sound's does), and empty otherwise, which puts every control's
    /// position at zero. `None` before a standardizer exists, when the tree
    /// has no live knob, or when the table is over other φ names.
    pub fn wire_predicted(
        &self,
        tree: &PatchTree,
        controls: &[NamedControl],
        table: &KnobTable,
    ) -> Option<(Jacobian, Vec<Wiring>)> {
        let std = self.standardizer.as_deref()?;
        let spec = &self.cfg.phrase;
        let knobs = live_knobs(tree, spec.sample_rate);
        if knobs.is_empty() {
            return None;
        }
        let n = AudioFeatures::NAMES.len();
        let cols = table.predict(tree, &knobs, &std.std[..n])?;
        let z = self
            .memo()
            .get(&render_key(tree, spec))
            .map(|cf| standardized_audio(&cf.features, std))
            .unwrap_or_default();
        let jac = Jacobian {
            addrs: knobs.iter().map(|(a, _)| a.clone()).collect(),
            values: knobs.iter().map(|(_, v)| *v).collect(),
            names: AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect(),
            z,
            cols,
        };
        let wiring = wire_set(&jac, controls, SEMANTIC_RIDGE);
        Some((jac, wiring))
    }
}

#[cfg(test)]
mod tests;
