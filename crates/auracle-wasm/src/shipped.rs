//! What PERFORM's shipped wirings were measured from.
//!
//! The app ships a measurement of every preset (`apps/web/perform-wirings.json`,
//! written by the `preset_wirings` example, `make perform-wirings`), so a
//! preset's named controls work the moment it lands instead of after the
//! eleven-odd seconds of renders a first measurement costs in the browser. A
//! shipped wiring is a starting point, not the last word: it was taken under a
//! standardizer fitted natively, not this session's, and the app re-measures
//! it in the background as it does any stale wiring.
//!
//! What can go stale without anyone noticing is the file itself: a preset
//! edited, added or renamed, or the phrase or the controls changed, and the
//! file would still describe the old ones. So the file carries a fingerprint
//! of each preset's content and one of the measurement's inputs, both made
//! here, and `tests/shipped_wirings.rs` fails when either no longer matches
//! what the code builds today. Neither renders anything.

use auracle_features::{AudioFeatures, PhraseSpec};
use auracle_grammar::PatchTree;
use auracle_session::perform;

/// FNV-1a, 64 bit, as 16 hex digits: stable across platforms and runs, which
/// `std`'s hasher does not promise.
fn fnv(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Drop every node uid: they are minted per process, and two trees that
/// differ only in uids are the same patch (as the app's `wireKey` treats them).
fn strip_uids(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::Object(m) => {
            m.remove("uid");
            m.values_mut().for_each(strip_uids);
        }
        serde_json::Value::Array(xs) => xs.iter_mut().for_each(strip_uids),
        _ => {}
    }
}

/// A preset's content, uids aside: its name and its tree.
pub fn preset_source(name: &str, tree: &PatchTree) -> String {
    let mut v = serde_json::to_value(tree).unwrap_or(serde_json::Value::Null);
    strip_uids(&mut v);
    fnv(format!("{name}\n{v}").as_bytes())
}

/// The measurement's inputs other than the patch: the audition phrase, the
/// feature names the controls' directions are read in, the controls
/// themselves and the constants that shape a wiring.
pub fn measurement_fingerprint(phrase: &PhraseSpec) -> String {
    let consts = [
        perform::JACOBIAN_STEP,
        perform::COLLINEAR,
        perform::RIDGE,
        perform::SEMANTIC_RIDGE,
        perform::MAX_KNOBS as f64,
        perform::MAX_TRAVEL,
        perform::PURITY_FLOOR,
        perform::MONO_TOL,
        perform::REACH_FLOOR,
    ];
    let text = format!(
        "{}\n{:?}\n{:?}\n{:?}",
        serde_json::to_string(phrase).unwrap_or_default(),
        AudioFeatures::NAMES,
        perform::CONTROLS,
        consts,
    );
    fnv(text.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_source_ignores_uids_and_sees_everything_else() {
        let bank = auracle_grammar::preset_bank();
        let p = &bank[0];
        let mut again = p.tree.clone();
        again.ensure_uids();
        assert_eq!(
            preset_source(p.name, &p.tree),
            preset_source(p.name, &again)
        );
        assert_ne!(
            preset_source(p.name, &p.tree),
            preset_source("renamed", &p.tree)
        );
        assert_ne!(
            preset_source(p.name, &p.tree),
            preset_source(p.name, &bank[1].tree)
        );
    }
}
