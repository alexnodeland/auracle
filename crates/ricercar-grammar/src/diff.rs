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
                "src" => name(&["vco", "supersaw", "noise"]),
                "op" => name(&["mix", "filter", "fold", "delay", "chorus"]),
                "mod" => name(&["no mod", "lfo", "mod env"]),
                "oct" => Some(format!("{:+}", *i as i8 - 2)),
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
