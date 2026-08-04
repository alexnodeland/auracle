//! Musical names for patches, read off the measured features.
//!
//! A patch's topology signature (`ssaw·lp·ladr`, `noiz`) is precise and
//! useless as a *name*: it describes the circuit, not the sound, and it
//! collides constantly — a pool of prior draws produces six consecutive
//! `noiz` rows, which is six rows the user cannot tell apart or refer to.
//! Names are how people hold a bank of sounds in their head, and every synth
//! that has ever shipped knows it: *First Bass*, *Cathedral*, *Glass Pad*.
//!
//! So a name here is `<character> <role>` — read off the extracted features
//! and the amp envelope, not off the module list. `Bright Pluck` is a claim
//! about the render the user can check with their ears; it stays true if the
//! same sound is reached by a different circuit, and it changes when the sound
//! changes. The signature stays available as separate metadata for anyone who
//! wants the circuit.
//!
//! ## Why the buckets are quantiles and not thresholds
//!
//! The obvious implementation — a ladder of `if` tests against absolute
//! feature values, first match wins — was measured in the running app and
//! **concentrated catastrophically**: 13 of 40 bank rows came out `Glass Pad`,
//! with numerals running to `Glass Pad 12`. Two independent causes, both
//! structural rather than a matter of picking better constants:
//!
//! - The first test in the ladder claimed roughly half the pool by itself.
//!   Attack time is close to log-uniform over 1 ms–10 s, so *any* fixed attack
//!   threshold in the middle of that range splits the pool about evenly, and
//!   whichever branch is tested first swallows half the alphabet's traffic.
//! - The standard audition phrase deliberately changes register (C4→Eb4→C3),
//!   which moves the spectral centroid of almost any un-lowpassed patch by
//!   roughly the amount an early `centroid_std` test was keyed to. That test
//!   matched nearly everything, so every character below it was unreachable.
//!
//! A nominal alphabet of ~110 names was delivering an effective 8–12. The fix
//! is not better constants — any fixed constant is wrong for a pool that
//! drifts as evolution concentrates it. Each axis is bucketed by **terciles of
//! the pool's own distribution** ([`NameScale`]), so a bucket is one third of
//! whatever the pool happens to be and the marginals stay flat however the
//! pool moves. Role and character are then a 3×3 grid each: 81 names with
//! uniform marginals by construction, instead of a ladder whose branches race.
//!
//! This makes a name *relative* to the bank it lives in — the same patch can
//! be `Bright Pluck` in a dark bank and `Warm Pluck` in a bright one. That is
//! the right trade: a name earns its keep by telling apart the patches in
//! front of you, not by being a global coordinate. The topology signature is
//! still there for anyone who wants an absolute one.
//!
//! ## Why quantiles alone would lie
//!
//! Terciles put a third of the pool in each bucket **whatever the pool is**.
//! That is the property that fixes the concentration bug, and it is also a
//! way to lie: hand this scheme forty patches that genuinely all sound like
//! the same pad and it will still deal out thirty distinct names and tell the
//! user they are thirty different things. "Thirteen of these are the same
//! kind of pad" was bad UI when the old thresholds said it by accident, but
//! it may well have been *true*.
//!
//! So each axis also carries a **just-noticeable difference** ([`Jnd`]): if
//! the pool's own tercile cuts fall closer together than a listener could
//! plausibly hear, that axis collapses to a single bucket and stops
//! contributing to the name. A genuinely varied bank gets its full alphabet;
//! a genuinely uniform one gets `Warm Pad`, `Warm Pad 2`, `Warm Pad 3`, which
//! is the honest report. The numeral then carries real information — it says
//! *these are variations of one thing*, not *the namer ran out of ideas*.
//!
//! These floors are the one place absolute constants belong here. They encode
//! perception, which does not move when the pool does — unlike the thresholds
//! this module started with, which were absolute claims about *pool
//! structure* and were wrong the moment the pool drifted.

use auracle_features::Features;
use std::collections::HashSet;

/// Role grid, indexed `[attack tercile][sustain tercile]` — articulation is
/// what decides what you would reach for a sound *to do*.
const ROLES: [[&str; 3]; 3] = [
    ["Pluck", "Stab", "Lead"], // fast attack
    ["Bell", "Key", "Drone"],  // medium attack
    ["Swell", "Pad", "Wash"],  // slow attack
];

/// Character grid, indexed `[centroid tercile][flatness tercile]` — the
/// adjective a musician reaches for first is brightness crossed with grit.
const CHARACTERS: [[&str; 3]; 3] = [
    ["Warm", "Round", "Murky"],   // dark
    ["Fat", "Soft", "Gritty"],    // mid
    ["Glass", "Bright", "Noisy"], // bright
];

/// Smallest difference on each axis worth giving a different word to.
///
/// Perceptual, not statistical: a pool whose whole spread sits inside one of
/// these is a pool the listener hears as one thing, however cleanly the
/// quantiles slice it.
///
/// - `CENTROID`: the brightness axis is `log_axis`, on which one octave at
///   44.1 kHz is ≈ 0.099. Half an octave is a real timbral step; less is not.
/// - `FLATNESS`: tonal-to-noisy over `[0, 1]`.
/// - `ATTACK`: `ln(attack + 5 ms)`, so this is a ratio — ≈ 1.4× longer.
/// - `SUSTAIN`: normalized envelope sustain over `[0, 1]`.
struct Jnd;
impl Jnd {
    const CENTROID: f64 = 0.05;
    const FLATNESS: f64 = 0.06;
    const ATTACK: f64 = 0.35;
    const SUSTAIN: f64 = 0.12;
}

/// Tercile cut points of one feature over the reference pool, or `None` when
/// the pool's spread on that axis is below hearing.
#[derive(Clone, Copy, Debug, Default)]
struct Cuts {
    lo: f64,
    hi: f64,
    /// False when the pool does not actually vary on this axis.
    active: bool,
}

impl Cuts {
    /// Which third of the pool a value falls in; the middle bucket for
    /// everything when the axis is inactive, so it contributes no word.
    fn bucket(&self, x: f64) -> usize {
        if !self.active {
            1
        } else if x < self.lo {
            0
        } else if x < self.hi {
            1
        } else {
            2
        }
    }
}

fn terciles(mut values: Vec<f64>, jnd: f64) -> Cuts {
    if values.is_empty() {
        return Cuts::default();
    }
    values.sort_by(f64::total_cmp);
    let n = values.len();
    let (lo, hi) = (values[n / 3], values[(2 * n) / 3]);
    // Judge the *whole* span, not the inter-cut gap. Requiring the middle
    // two thirds to be spread as well sounds stricter but is wrong: a pool of
    // mostly-tonal patches with a few genuinely noisy ones has tight terciles
    // and an audible range, and suppressing the axis there would cost the
    // noisy outliers the only word that describes them. Where the span is
    // real but the mass is not, the cuts collapse together on their own and
    // the axis quietly contributes one word to everybody — the same outcome,
    // reached by arithmetic rather than by a second threshold.
    let span = values[n - 1] - values[0];
    Cuts {
        lo,
        hi,
        active: span >= jnd,
    }
}

/// The naming scale: where this pool's terciles actually fall.
///
/// Fit on the bank the names will be shown against, so the alphabet stays
/// populated whatever the pool looks like — see the module doc for why fixed
/// thresholds do not.
#[derive(Clone, Copy, Debug, Default)]
pub struct NameScale {
    attack: Cuts,
    sustain: Cuts,
    centroid: Cuts,
    flatness: Cuts,
}

impl NameScale {
    /// Fit terciles from the pool the names will be shown against.
    pub fn fit<'a>(pool: impl Iterator<Item = &'a Features> + Clone) -> Self {
        Self {
            attack: terciles(
                pool.clone().map(|f| f.audio.attack_s).collect(),
                Jnd::ATTACK,
            ),
            sustain: terciles(
                pool.clone().map(|f| f.structural.amp_sustain).collect(),
                Jnd::SUSTAIN,
            ),
            centroid: terciles(
                pool.clone().map(|f| f.audio.centroid_mean).collect(),
                Jnd::CENTROID,
            ),
            flatness: terciles(pool.map(|f| f.audio.flatness_mean).collect(), Jnd::FLATNESS),
        }
    }

    /// `<character> <role>` for one candidate — e.g. `Bright Pluck`,
    /// `Noisy Wash`, `Warm Drone`, `Glass Lead`.
    ///
    /// Not unique on its own; [`claim_name`] makes a set of them distinct.
    pub fn name(&self, f: &Features) -> String {
        let role = ROLES[self.attack.bucket(f.audio.attack_s)]
            [self.sustain.bucket(f.structural.amp_sustain)];
        let character = CHARACTERS[self.centroid.bucket(f.audio.centroid_mean)]
            [self.flatness.bucket(f.audio.flatness_mean)];
        format!("{character} {role}")
    }
}

/// Take `base` if free, else the first `base N` that is, recording the claim.
///
/// Every name in the bank goes through here — **including user-given and
/// preset ones**. Letting those bypass collision detection while still
/// occupying the name is what allowed two bank rows to both read exactly
/// `Glass Pad`: `Glass Pad` is a preset name, and the generator is entitled to
/// produce it too.
pub fn claim_name(base: &str, taken: &mut HashSet<String>) -> String {
    if taken.insert(base.to_string()) {
        return base.to_string();
    }
    // Start at 2: the unsuffixed name is conceptually "1".
    for k in 2..usize::MAX {
        let candidate = format!("{base} {k}");
        if taken.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!("name space exhausted")
}
