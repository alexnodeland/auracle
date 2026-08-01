//! Address-based knob edits: turning a panel knob is a write at a trace
//! address, so hand edits and MH proposals move through the same encoding
//! and cannot drift from the grammar.

use fugue_evo::genome::trace_genome::{ChoiceValue, TraceGenome};
use thiserror::Error;

use crate::term::PatchTree;

/// A knob-edit value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ParamValue {
    /// Continuous parameter, clamped to `[0, 1]`.
    Continuous(f64),
    /// Enum / octave selector index (clamped to the site's category count).
    Index(usize),
}

/// Why an edit was rejected.
#[derive(Debug, Error)]
pub enum EditError {
    /// The address does not exist in this patch.
    #[error("no such address in patch: {0}")]
    UnknownAddress(String),
    /// The address is a structural choice (`#leaf`/`#src`/`#op`/`#mod`);
    /// structure changes go through evolution, not knob edits.
    #[error("address {0} is structural; knobs cannot rewire the patch")]
    Structural(String),
    /// Value kind does not match the site (continuous vs. enum).
    #[error("value kind mismatch at {0}")]
    KindMismatch(String),
    /// The edited trace failed to decode (should not happen for
    /// parameter-only edits).
    #[error("edited patch failed to decode: {0}")]
    Decode(String),
}

/// Category count for enum sites, by site name.
fn enum_arity(site: &str) -> Option<usize> {
    match site {
        "wave" => Some(4),
        "color" => Some(2),
        "fkind" => Some(4),
        "oct" => Some(5),
        "table" => Some(8),
        "dmode" => Some(3),
        _ => None,
    }
}

fn is_structural(site: &str) -> bool {
    // `modop` and `pairop` joined in wave 2C: which CV processor sits in a mod
    // chain is a production, not a knob, exactly as `#op` is for the audio
    // tree. (`qscale` and `rmode` are *not* here: they select inside a module
    // that is already placed, so they are ordinary continuous sites — see
    // `crate::term::quant_scale_index`.)
    matches!(site, "leaf" | "src" | "op" | "mod" | "modop" | "pairop")
}

/// Split a full address string (`key#site`) into its key and site.
pub fn split_addr(addr: &str) -> (&str, &str) {
    match addr.rsplit_once('#') {
        Some((k, s)) => (k, s),
        None => (addr, ""),
    }
}

/// Return a copy of `tree` with the choice at `addr` set to `value`.
///
/// Continuous values are clamped to `[0, 1]`; enum indices are clamped to the
/// site's arity. Structural sites are rejected — restructuring is evolution's
/// job (or a future explicit structure-edit surface), not a knob gesture.
pub fn set_param(tree: &PatchTree, addr: &str, value: ParamValue) -> Result<PatchTree, EditError> {
    let (_, site) = split_addr(addr);
    if is_structural(site) {
        return Err(EditError::Structural(addr.into()));
    }
    let mut trace = tree.to_trace();
    let a = trace
        .choices
        .keys()
        .find(|k| &***k == addr)
        .cloned()
        .ok_or_else(|| EditError::UnknownAddress(addr.into()))?;
    let slot = trace.choices.get_mut(&a).expect("present");
    match (&slot.value, value) {
        (ChoiceValue::F64(_), ParamValue::Continuous(v)) => {
            slot.value = ChoiceValue::F64(v.clamp(0.0, 1.0));
        }
        (ChoiceValue::Usize(_), ParamValue::Index(i)) => {
            let n = enum_arity(site).unwrap_or(usize::MAX);
            slot.value = ChoiceValue::Usize(i.min(n.saturating_sub(1)));
        }
        _ => return Err(EditError::KindMismatch(addr.into())),
    }
    PatchTree::from_trace(&trace).map_err(|e| EditError::Decode(e.to_string()))
}
