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
//! Snap are reliable, Motion and Body are not. So the prediction is **gated
//! per control** ([`KnobTable::passes`]): the table carries how often it turned
//! each control the named way on the pool sounds it was learned from, each
//! held out in turn ([`KnobTable::agreement`]), and a control is wired from it
//! only where that agrees well enough ([`PREDICT_GATE`]). The rest wait for
//! the measurement, as they always did. A predicted wiring is unverified
//! ([`Wiring::up`] and [`Wiring::down`] are `None`) and the page says it is not
//! measured yet.
use std::collections::BTreeMap;
use std::collections::HashMap;

use auracle_features::{render_key, AudioFeatures};
use auracle_grammar::{describe, PatchTree};
use fugue_evo::genome::trace_genome::{ChoiceValue, TraceGenome};
use serde::{Deserialize, Serialize};

use crate::engine::Engine;
use crate::perform::{
    direction, live_knobs, standardized_audio, wire_set, Jacobian, NamedControl, Wiring,
    SEMANTIC_RIDGE,
};

/// Fewest measured columns a key needs to stand for its knobs in the table.
/// Below it a key says more about one patch than about its kind of knob, and
/// the knob is looked up by a coarser key. The census
/// (`examples/wire_predict.rs`) measured three against one and two.
pub const TABLE_MIN: usize = 3;

/// Lowest agreement ([`Agreement::lower_bound`]) at which a control is wired
/// from the prediction. The maintainer heard the prediction's Bright (69% of
/// its turns went the named way by ear, 78% on the measured Jacobians the
/// gate is judged on) and accepted it, and its Motion (42% by ear, 62% on
/// the Jacobians) and did not (#290). 0.70 is between the two in the gate's
/// own units: more than two turns in three go the named way, after the bound
/// has paid for how few turns it saw. On the shipped table, Bright's 82% of
/// 139 turns reads 0.746 and Snap's 83% of 231 reads 0.776.
pub const PREDICT_GATE: f64 = 0.70;

/// The bound's width, in standard errors: z of the Wilson score interval
/// [`Agreement::lower_bound`] takes the lower end of. At two, a control
/// passes on at least ten turns, all the named way (n of n reads n/(n+4)), or
/// on more with some wrong, and a control seen a couple of hundred times
/// gives up five to eight points. At one, three turns in three passed: the
/// shipped table wired Grit on 5 pool sounds of 240, all the named way, and
/// it passed on that.
pub const GATE_Z: f64 = 2.0;

/// How often the prediction turned one control the named way: of the pool
/// sounds it was judged on, each held out of the table in turn, how many it
/// wired the control on (`wired`) and how many of those moved along the
/// control's direction on the sound's own measured Jacobian (`right`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Agreement {
    /// Held-out sounds the prediction wired the control on.
    pub wired: u32,
    /// Of those, the ones it turned the named way.
    pub right: u32,
}

impl Agreement {
    /// The lower end of the Wilson score interval at [`GATE_Z`] around
    /// `right / wired`: the share of turns that go the named way, less what
    /// so few turns cannot vouch for. 0 for a control never wired.
    pub fn lower_bound(&self) -> f64 {
        if self.wired == 0 {
            return 0.0;
        }
        let (n, z) = (f64::from(self.wired), GATE_Z);
        let p = f64::from(self.right) / n;
        let centre = p + z * z / (2.0 * n);
        let spread = z * (p * (1.0 - p) / n + z * z / (4.0 * n * n)).sqrt();
        (centre - spread) / (1.0 + z * z / n)
    }
}

/// How each kind of module's knob moves φ: per key ([`knob_keys`]), the
/// median of measured `∂φ_audio/∂p` columns in raw audio-φ units per unit of
/// knob travel; and per control, how well the table predicted it on sounds it
/// was not learned from ([`KnobTable::passes`]).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct KnobTable {
    /// The audio φ names the columns run over ([`AudioFeatures::NAMES`] when
    /// the table was learned). A table over other names predicts nothing.
    pub names: Vec<String>,
    /// Key → column, every level of [`knob_keys`] in one map.
    pub cols: BTreeMap<String, Vec<f64>>,
    /// Control name → how often the table turned it the named way on held-out
    /// pool sounds ([`KnobTable::agreement`]). A control it does not name, and
    /// every control of a table written before the gate, is never wired from
    /// the prediction.
    #[serde(default)]
    pub gate: BTreeMap<String, Agreement>,
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
        KnobTable {
            names,
            cols,
            gate: BTreeMap::new(),
        }
    }

    /// The gate's data: for each of `held` (indices into `measured`, the pool
    /// sounds), the table learned from every other measured sound, each of
    /// `controls` wired on it alone from the prediction, and whether the
    /// control's knobs, turned up, move the held-out sound along the
    /// control's direction on its own measured Jacobian. The presets train
    /// but are never held out: the app never predicts a preset (its wiring
    /// ships), and held out they flatter the table (Motion read 79 to 88%
    /// on them against 62% on pool sounds).
    pub fn agreement(
        measured: &[Measured],
        held: &[usize],
        controls: &[NamedControl],
    ) -> BTreeMap<String, Agreement> {
        let mut out: BTreeMap<String, Agreement> = controls
            .iter()
            .map(|c| (c.name.to_string(), Agreement::default()))
            .collect();
        let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
        for &h in held {
            let Some(m) = measured.get(h) else { continue };
            let train: Vec<Measured> = measured
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != h)
                .map(|(_, o)| Measured {
                    tree: o.tree,
                    jac: o.jac,
                    spread: o.spread,
                })
                .collect();
            let table = KnobTable::learn(&train);
            let knobs: Vec<(String, f64)> = m
                .jac
                .addrs
                .iter()
                .cloned()
                .zip(m.jac.values.iter().copied())
                .collect();
            let Some(cols) = table.predict(m.tree, &knobs, m.spread) else {
                continue;
            };
            let guess = Jacobian {
                cols,
                ..m.jac.clone()
            };
            for c in controls {
                let w = wire_set(&guess, std::slice::from_ref(c), SEMANTIC_RIDGE).remove(0);
                if w.search {
                    continue;
                }
                let d = direction(c, &names);
                let along: f64 = w
                    .knobs
                    .iter()
                    .filter_map(|(a, g)| {
                        let i = m.jac.addrs.iter().position(|x| x == a)?;
                        Some(
                            g * m.jac.cols[i]
                                .iter()
                                .zip(&d)
                                .map(|(j, e)| j * e)
                                .sum::<f64>(),
                        )
                    })
                    .sum();
                let a = out.entry(c.name.to_string()).or_default();
                a.wired += 1;
                if along > 0.0 {
                    a.right += 1;
                }
            }
        }
        out
    }

    /// Whether `control` may be wired from this table's prediction: its
    /// agreement's lower bound reaches [`PREDICT_GATE`].
    pub fn passes(&self, control: &NamedControl) -> bool {
        self.gate
            .get(control.name)
            .is_some_and(|a| a.lower_bound() >= PREDICT_GATE)
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
    /// The controls of `controls` that `table` may wire ([`KnobTable::passes`])
    /// wired onto `tree` from its prediction, with no render: its live knobs
    /// (a compile), their columns as the table predicts them under this
    /// session's standardizer, and the measurement's solve ([`wire_set`]) on
    /// those, in the order asked. A control the gate keeps out, or that the
    /// prediction cannot reach (it would be a search control: a claim that
    /// the patch *can't*, which a guess may not make), is left out, and the
    /// page has it wait for the measurement. The wirings are unverified, so
    /// each turns both ways. `z` is the tree's standardized audio φ if the
    /// memo holds its render (a pool sound's does), and empty otherwise,
    /// which puts every control's position at zero. `None` before a
    /// standardizer exists, when the tree has no live knob, when the table is
    /// over other φ names, or when no control is left.
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
        let gated: Vec<NamedControl> = controls
            .iter()
            .copied()
            .filter(|c| table.passes(c))
            .collect();
        let wiring: Vec<Wiring> = wire_set(&jac, &gated, SEMANTIC_RIDGE)
            .into_iter()
            .filter(|w| !w.search)
            .collect();
        (!wiring.is_empty()).then_some((jac, wiring))
    }
}

#[cfg(test)]
mod tests;
