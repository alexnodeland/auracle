use super::*;
use crate::{describe, presets, term};

// ---------- node identity ----------

/// Uids must be invisible to every system that reasons about *content*.
///
/// Three of those, and all three would break loudly: the engine's pool
/// dedup and refinement's own "did the walk move" test are both
/// `PatchTree` equality, and the render memo is a hash of the tree's JSON.
/// If a fresh identity could make two identical patches differ, evolution
/// would admit duplicates forever and every refinement step would miss a
/// cache it had just filled.
#[test]
fn uid_is_invisible_to_content() {
    let mut a = presets::presets()[0].1.clone();
    let mut b = a.clone();
    a.ensure_uids();
    b.ensure_uids();
    assert_ne!(
        a.root.uid().0,
        b.root.uid().0,
        "two settlings must mint different identities, or the test is vacuous"
    );
    assert_eq!(a, b, "patches that differ only in uid are the same patch");

    // The render memo's content address is `canonical_tree_json`, which
    // clears identities first; the half of that contract this crate can
    // state is that clearing lands both trees on the same term. The JSON
    // itself is pinned in `auracle_features::cache`, where the key lives.
    let (mut ca, mut cb) = (a.clone(), b.clone());
    ca.clear_uids();
    cb.clear_uids();
    assert!(ca.root.uid().is_new() && cb.root.uid().is_new());
    assert_eq!(ca, cb);
}

/// A restored save carries identities the mint has never issued, and the
/// mint must not issue them again.
///
/// The counter is per-process and a page reload starts it at 1, while the
/// save it restores is full of ids from the session that wrote it. Without
/// this, inserting one module into a restored patch would hand out an id
/// that patch already uses and two nodes would answer to one lock — the
/// exact confusion identities exist to end, arriving only for the returning
/// user, only after a reload.
#[test]
fn settling_pushes_the_mint_past_what_it_has_seen() {
    // Stand in for a save written by an older session: a tree whose
    // identities are far above anything this process has minted.
    let mut restored = presets::presets()[0].1.clone();
    restored.ensure_uids();
    let high = term::Uid(9_000_000);
    restored.root.set_uid(high);
    restored.ensure_uids();
    assert_eq!(
        restored.root.uid().0,
        high.0,
        "a set identity is not reissued"
    );

    let mut fresh = presets::presets()[0].1.clone();
    fresh.ensure_uids();
    assert!(
        fresh.root.uid().0 > high.0,
        "the mint reissued an identity a restored patch is already using"
    );
}

/// A duplicated subtree brings its original's identities with it in the
/// copy, and two nodes claiming one identity is worse than none: a lock on
/// either would light both. Settling breaks the tie.
#[test]
fn settling_breaks_duplicate_identities() {
    let mut inner = presets::presets()[0].1.clone();
    inner.ensure_uids();
    let mut tree = inner.clone();
    tree.root = term::AudioNode::Mix {
        uid: Uid::NEW,
        balance: 0.5,
        a: Box::new(inner.root.clone()),
        b: Box::new(inner.root.clone()),
    };
    tree.ensure_uids();
    let d = describe::describe(&tree);
    let mut seen = std::collections::HashSet::new();
    for m in d.modules.iter().filter(|m| m.key != "amp") {
        assert_ne!(m.uid, 0, "{} was left without an identity", m.key);
        assert!(seen.insert(m.uid), "{} shares an identity", m.key);
    }
}
