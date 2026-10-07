//! A seed deals the same session on every target: the same pool, and from
//! it the same PERFORM offer, taste fit and ⚡ walk.
//!
//! The page's engine is wasm and the diagnostics, the tests and the shipped
//! wirings are native, so "seeded means reproducible" has to hold across the
//! two. It did not: rand 0.8 draws a `usize` from `next_u32` on wasm32 and
//! `next_u64` on a 64-bit machine, so the grammar's prior, which picks module
//! kinds by index, dealt a different tree on each from the same seed, and the
//! wasm session's pool, standardizer and PERFORM wirings parted from the
//! natively measured file. [`auracle_grammar::rng::gen_index`] pins the draw.
//! `fugue-ppl` made the same draw for the site each Metropolis step moves, in
//! a fit's chain and at every step of a walk or an offer, until 0.2.3, which
//! draws it as a `u64` too.
//!
//! `shipped::boot_probe` is what both targets run: the digest of the first
//! 400 draws of the fill stream, a small pool filled from the shipped seed
//! and its first duels, then an offer from that pool, the taste fitted from
//! the duels' picks and a walk from the member it ranks best. This test pins
//! its native output to `tests/boot_probe.json`;
//! `tests/web/boot_agrees.spec.js` runs it in the built wasm under Node and
//! requires the same file. The two together are the cross-target check.
//!
//! If this fails after a change that should move what a seed deals (the
//! prior's draws, vetting, the features, the standardizer fit, the taste
//! model, a walk's kernel), regenerate the file and commit it with the
//! change, and owe what a moved pool owes (`make revalidate`,
//! `make perform-wirings`) or a moved search owes (`make climb`):
//!
//! ```bash
//! UPDATE_BOOT_PROBE=1 cargo test -p auracle-wasm --profile test-fast --test boot_agrees
//! ```
//!
//! If the spec fails and this does not, the two targets deal differently. The
//! spec's message names the first field that differs: a draw's digest means the
//! stream itself reads differently (a draw whose width depends on the target),
//! `kept` or `draws_consumed` means a render or a vetting decision did, and
//! `spread` alone means the features differ in the last digits. In `offer`,
//! `taste` or `walk` (each of which the pool feeds, so read them after it), a
//! number just past the tolerance is the arithmetic, a last digit grown; a
//! `shape`, or a number far off, means a chain drew otherwise. The taste has
//! no `shape`, so a fit whose chain chose another site shows only as a
//! utility far off (a member read 0.487 natively and −0.644 in wasm on
//! `fugue-ppl` 0.2.2). The offer reads no taste, so an offer that parts is
//! the walk's kernel, not the fit.

use auracle_wasm::shipped::{boot_probe, boot_probe_difference};

const PINNED: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/boot_probe.json");

#[test]
fn the_shipped_seed_deals_the_pinned_session() {
    if std::env::var_os("UPDATE_BOOT_PROBE").is_some() {
        let probe: serde_json::Value = serde_json::from_str(&boot_probe()).unwrap();
        let text = serde_json::to_string_pretty(&probe).unwrap() + "\n";
        std::fs::write(PINNED, text).unwrap();
        return;
    }
    let pinned = std::fs::read_to_string(PINNED)
        .unwrap_or_else(|e| panic!("{PINNED}: {e} — run with UPDATE_BOOT_PROBE=1"));
    let difference = boot_probe_difference(&pinned);
    assert!(
        difference.is_empty(),
        "the shipped seed no longer deals the pinned session ({difference}). If a change meant \
         to move it, regenerate with UPDATE_BOOT_PROBE=1 and owe `make revalidate` and \
         `make perform-wirings` for a moved pool, `make climb` for a moved walk; if not, a \
         draw now depends on something other than the seed"
    );
}

/// A pinned file that is not JSON is said to be so, before the probe is
/// rendered at all. Here, beside the comparison itself, so the one build of
/// `boot_probe_difference` the gate measures runs both of its answers.
#[test]
fn a_pinned_probe_that_is_not_json_says_so() {
    assert_eq!(
        boot_probe_difference("{ not json"),
        "the pinned probe is not JSON"
    );
}
