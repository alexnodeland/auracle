//! Structural/parameter diff between two patch trees, in trace-address terms.
//!
//! Used to make evolution legible: "what did this MH step / generation
//! actually do" rendered as knob moves, module swaps, and added or removed
//! subtrees.

use fugue_evo::genome::trace_genome::{ChoiceValue, TraceGenome};
use serde::{Deserialize, Serialize};

use crate::edit::split_addr;
use crate::term::PatchTree;

/// One changed choice site.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DiffEntry {
    /// Full trace address (`key#site`).
    pub addr: String,
    /// Display value before (`None` if the site was added).
    pub before: Option<String>,
    /// Display value after (`None` if the site was removed).
    pub after: Option<String>,
}

fn display_value(site: &str, v: &ChoiceValue) -> String {
    match v {
        ChoiceValue::F64(x) => format!("{x:.2}"),
        ChoiceValue::Bool(b) => if *b { "source" } else { "processor" }.into(),
        ChoiceValue::Usize(i) => {
            let name = |names: &[&str]| names.get(*i).map(|s| s.to_string());
            match site {
                "wave" => name(&["sin", "tri", "saw", "sqr"]),
                "color" => name(&["white", "pink"]),
                "fkind" => name(&["svf lp", "svf bp", "svf hp", "ladder"]),
                // These three are the grammar's categoricals, in the index
                // order `crate::genome` persists. They used to be spelled out
                // here and fell out of date *twice* — the second time for
                // exactly the newest productions (`silence`, the four
                // dynamics ops and the vocoder, `euclid`/`op`/`pair`), which
                // showed up as an evolution diff reporting a raw index —
                // "op: 3 → 11" instead of "delay → tremolo" — precisely where
                // the point of the view is legibility. Now they are read from
                // `crate::prior`'s tables, whose lengths are the arity
                // constants, so a production cannot be added without a label.
                "src" => name(&crate::prior::SOURCE_LABELS),
                "op" => name(&crate::prior::OP_LABELS),
                "mod" => name(&crate::prior::MOD_LABELS),
                "table" => name(&[
                    "sine",
                    "tri",
                    "saw",
                    "square",
                    "pulse 25",
                    "pulse 12",
                    "formant a",
                    "formant o",
                ]),
                "dmode" => name(&["soft", "hard", "tube"]),
                "oct" => Some(format!("{:+}", *i as i8 - 2)),
                // An AUDIO IN's input is numbered from one, as the rack's
                // selector shows it, and its channel by name.
                "input" => Some((i + 1).to_string()),
                "channel" => name(&["left", "right", "both"]),
                _ => None,
            }
            .unwrap_or_else(|| i.to_string())
        }
        other => format!("{other:?}"),
    }
}

/// Diff two trees by their canonical trace encodings.
///
/// Entries are sorted by address; a structural move shows up as a cluster of
/// removed/added sites under the rewritten keys.
pub fn tree_diff(before: &PatchTree, after: &PatchTree) -> Vec<DiffEntry> {
    let ta = before.to_trace();
    let tb = after.to_trace();
    let mut out = Vec::new();
    for (addr, ca) in &ta.choices {
        let site = split_addr(addr).1;
        match tb.choices.get(addr) {
            Some(cb) if cb.value == ca.value => {}
            Some(cb) => out.push(DiffEntry {
                addr: addr.to_string(),
                before: Some(display_value(site, &ca.value)),
                after: Some(display_value(site, &cb.value)),
            }),
            None => out.push(DiffEntry {
                addr: addr.to_string(),
                before: Some(display_value(site, &ca.value)),
                after: None,
            }),
        }
    }
    for (addr, cb) in &tb.choices {
        if !ta.choices.contains_key(addr) {
            let site = split_addr(addr).1;
            out.push(DiffEntry {
                addr: addr.to_string(),
                before: None,
                after: Some(display_value(site, &cb.value)),
            });
        }
    }
    out.sort_by(|x, y| x.addr.cmp(&y.addr));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prior::{N_MODS, N_OPS, N_SOURCES};

    /// The newest production of every categorical has a name in the diff
    /// view, and the last index of each table is the last kind. This is the
    /// test that was missing both times the tables went stale.
    #[test]
    fn every_categorical_index_has_a_label() {
        let u = |i: usize| ChoiceValue::Usize(i);
        assert_eq!(display_value("src", &u(N_SOURCES - 1)), "audio in");
        assert_eq!(display_value("src", &u(6)), "silence");
        assert_eq!(display_value("input", &u(0)), "1");
        assert_eq!(display_value("channel", &u(2)), "both");
        assert_eq!(display_value("op", &u(N_OPS - 1)), "vocoder");
        assert_eq!(display_value("op", &u(15)), "shift");
        assert_eq!(display_value("mod", &u(N_MODS - 1)), "steps");
        assert_eq!(display_value("mod", &u(7)), "pair");
        assert_eq!(display_value("mod", &u(5)), "euclid");
        // One past the end still degrades to the index rather than panicking.
        assert_eq!(display_value("src", &u(N_SOURCES)), N_SOURCES.to_string());
    }
}
