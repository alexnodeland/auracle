//! Migrating profiles written before raw-φ logging.
//!
//! A schema-1 log stored *standardized* φ under a 30-coordinate feature set,
//! with no names. That is recoverable, because the profile persisted the
//! standardizer alongside it: `raw = z·σ + μ` inverts the transform exactly,
//! and the schema-1 coordinate order is known and fixed ([`SCHEMA1_NAMES`]).
//!
//! What is *not* a pure re-labelling is that two of the current coordinates
//! changed units. Those conversions are applied here rather than being
//! papered over, because a value silently carried across a unit change is
//! worse than a dropped one — it is evidence pointing the wrong way:
//!
//! - `centroid_mean`, `rolloff_mean`, `zcr_mean` moved from a linear-Hz
//!   fraction of Nyquist to the octave axis. Exact: recover the frequency,
//!   re-map it.
//! - `centroid_std` was the spread of a linear-Hz quantity and is now the
//!   spread of a log one. There is no exact inverse for a spread, so it goes
//!   through the delta method — the local derivative of the axis map at the
//!   observation's own centroid. First-order, and honest about it.
//! - `crest`, `tail_ratio`, `attack_s` are now logged. Exact.
//! - `size` was dropped from φ entirely (it was exactly collinear with the
//!   module counts). Dropped here too.
//! - `n_mix`, `n_fold` and `n_chorus` no longer exist as φ coordinates: the
//!   first left for the same collinearity reason as `size`, and the other two
//!   were folded into the `n_drive` / `n_mod_fx` families. A schema-1 vote
//!   carries no value for a family coordinate — it was never measured — so
//!   they are imputed at the mean like any other absent coordinate, rather
//!   than being re-derived from a count that answered a different question.
//!
//! A φ coordinate that is *renamed* rather than dropped is a third case, and
//! the one that fails silently if nobody handles it. Both the schema-1 table
//! and every raw-φ observation already on disk store their coordinate names,
//! and [`FitSet::build`](ricercar_taste::FitSet::build) matches on those names
//! — so renaming `n_delay` to `n_time` in wave 2A would have quietly imputed
//! that column at the mean for every vote ever cast, which reads as "this user
//! has no opinion about delays" rather than as a rename.
//!
//! [`RENAMES`] carries the value across instead. That is exact, not a
//! convenience: `n_time` counts delays *and* granulators, and no observation
//! predating this wave can contain a granulator, so the old `n_delay` count
//! **is** the new coordinate's value for every row being migrated.
//!
//! Anything the migration cannot place is left at the new standardizer's mean
//! by [`FitSet::build`](ricercar_taste::FitSet::build), which standardizes to
//! zero: "this vote says nothing about that axis".

use ricercar_taste::{ObservationLog, Standardizer, PHI_SCHEMA};

/// φ coordinate names as of schema 1, in vector order.
pub const SCHEMA1_NAMES: [&str; 30] = [
    "centroid_mean",
    "centroid_std",
    "rolloff_mean",
    "flatness_mean",
    "flux_mean",
    "zcr_mean",
    "rms_mean",
    "rms_std",
    "crest",
    "attack_s",
    "tail_ratio",
    "bass_fraction",
    "n_vco",
    "n_supersaw",
    "n_noise",
    "n_mix",
    "n_filter",
    "n_fold",
    "n_delay",
    "n_chorus",
    "n_reverb",
    "n_lfo",
    "n_env",
    "n_rand",
    "depth",
    "size",
    "mod_density",
    "amp_attack",
    "amp_sustain",
    "amp_release",
];

/// φ coordinates that were renamed, as `(old name, current name)`.
///
/// A rename is not a drop: the stored value is still the right value for the
/// new coordinate, so a log written under the old name must be read under the
/// new one rather than imputed away. See the module doc for why each entry is
/// exact rather than approximate.
pub const RENAMES: [(&str, &str); 1] = [
    // Wave 2A: the column counts delays and granulators, so a name that says
    // "delay" would be a lie. No pre-2A patch can hold a granulator, so the
    // old count is the new count.
    ("n_delay", "n_time"),
];

/// The current name for a possibly-renamed φ coordinate.
fn renamed(name: &str) -> &str {
    RENAMES
        .iter()
        .find(|(old, _)| *old == name)
        .map_or(name, |(_, new)| *new)
}

/// The audio φ names as of the **v1 stimulus** (no stimulus tag), in order.
const V1_AUDIO_NAMES: [&str; 12] = [
    "centroid_mean",
    "centroid_std",
    "rolloff_mean",
    "flatness_mean",
    "flux_mean",
    "zcr_mean",
    "rms_mean",
    "rms_std",
    "crest",
    "attack_s",
    "tail_ratio",
    "bass_fraction",
];

/// φ names as of the v1 stimulus: the 12 un-tagged audio coordinates plus the
/// current (stimulus-independent) structural set.
///
/// Schema-1 values were measured under the v1 phrase, so migration must land
/// them **here** — never on the current stimulus-tagged audio names, which
/// would launder old-stimulus evidence into coordinates it was never
/// commensurable with. `FitSet::build` then carries the structural
/// coordinates forward by name and imputes the current audio coordinates at
/// "no evidence", which is the honest reading of a vote about a stimulus
/// that no longer exists.
pub fn v1_names() -> Vec<String> {
    use ricercar_features::StructFeatures;
    V1_AUDIO_NAMES
        .iter()
        .chain(StructFeatures::NAMES.iter())
        .map(|s| s.to_string())
        .collect()
}

/// Convert one schema-1 raw vector onto `target` — the *v1-stimulus* φ names
/// ([`v1_names`]), in their order.
///
/// Projecting onto the live feature set rather than "schema 1 minus whatever
/// we dropped" is what keeps a migrated vote first-class: `raw_rows` matches
/// on the exact name list, so a vote carrying a stale ordering would still
/// fit the model (`FitSet::build` maps by name) but would be silently skipped
/// when the standardizer is fit. Coordinates that did not exist in schema 1
/// come back `None` and are left for `FitSet::build` to impute at the mean.
fn convert(raw: &[f64], nyquist: f64, target: &[String]) -> Vec<f64> {
    use ricercar_features::audio::log_axis;
    let get = |name: &str| {
        SCHEMA1_NAMES
            .iter()
            .position(|n| renamed(n) == name)
            .and_then(|i| raw.get(i).copied())
    };
    let centroid_hz = get("centroid_mean").unwrap_or(0.0) * nyquist;

    target
        .iter()
        .map(|name| {
            let Some(v) = get(name) else {
                return 0.0;
            };
            match name.as_str() {
                "centroid_mean" | "rolloff_mean" => log_axis(v * nyquist, nyquist),
                // zcr was a fraction of sample *pairs*; two crossings a cycle.
                "zcr_mean" => log_axis(v * nyquist, nyquist),
                // Delta method: dv_log = dv_lin · d(log_axis)/df at the
                // observation's own centroid.
                "centroid_std" => {
                    let span = (nyquist / 20.0).log2();
                    let f = centroid_hz.max(20.0);
                    v * nyquist / (f * std::f64::consts::LN_2 * span)
                }
                "crest" => v.max(1e-6).ln(),
                // Floors, not just offsets: a schema-1 vector reconstructed
                // from a standardizer can land slightly negative on a
                // non-negative quantity, and NaN in a migrated profile is a
                // silently dead log.
                "attack_s" => (v + 0.005).max(1e-6).ln(),
                "tail_ratio" => (v + 1e-3).max(1e-6).ln(),
                _ => v,
            }
        })
        .collect()
}

/// Rewrite a schema-1 log into the current schema, in place.
///
/// `sz` must be the standardizer the log was written under (the one the
/// profile carries) and `names` the φ names of the stimulus the log was
/// *recorded* under — [`v1_names`] for every schema-1 log, since raw-φ
/// logging and the v2 stimulus both postdate schema 1. Returns how many
/// observations were migrated;
/// observations already in the current schema are left alone, and the whole
/// thing is a no-op if the standardizer's dimension doesn't match schema 1 (in
/// which case we genuinely cannot recover the raw values, and pretending
/// otherwise would corrupt the profile).
pub fn migrate_log(
    log: &mut ObservationLog,
    sz: &Standardizer,
    names: &[String],
    nyquist: f64,
) -> usize {
    if sz.dimension() != SCHEMA1_NAMES.len() {
        return 0;
    }

    let mut migrated = 0;
    for o in &mut log.observations {
        if o.is_raw() {
            continue;
        }
        // Only re-label what was actually converted. Stamping the new names
        // and schema onto a vector we could not convert is a *crash*, not a
        // cosmetic slip: the observation then claims to be raw φ of the
        // current width, `raw_rows` hands it to `Standardizer::fit`, and the
        // ragged-row assertion there takes the whole app down on load. A vote
        // we cannot interpret must stay marked as one we cannot interpret.
        if o.feedback
            .phis()
            .iter()
            .any(|z| z.len() != SCHEMA1_NAMES.len())
        {
            continue;
        }
        o.feedback = o
            .feedback
            .map_phi(|z| convert(&sz.inverse(z), nyquist, names));
        o.feature_names = names.to_vec();
        o.schema_version = PHI_SCHEMA;
        migrated += 1;
    }
    migrated
}

/// True when the log holds anything written before raw-φ logging.
pub fn needs_migration(log: &ObservationLog) -> bool {
    log.observations.iter().any(|o| !o.is_raw())
}

/// Stamp current-schema observations that carry no names with `names` — the
/// synthetic-user and headless paths log raw φ without them, and a named log
/// is what makes the next feature-set change survivable.
pub fn stamp_names(log: &mut ObservationLog, names: &[String]) {
    for o in &mut log.observations {
        if o.feature_names.is_empty() && o.is_raw() {
            o.feature_names = names.to_vec();
        }
    }
}

/// Rewrite [`RENAMES`]'d coordinate names in a log's stored name lists.
///
/// Cheap, idempotent, and the difference between a renamed coordinate keeping
/// its evidence and losing it: `FitSet::build` matches an observation's stored
/// names against the live feature set, so a name that moved takes every vote
/// about it along unless someone rewrites it here.
pub fn apply_renames(log: &mut ObservationLog) -> usize {
    let mut touched = 0;
    for o in &mut log.observations {
        let mut hit = false;
        for name in &mut o.feature_names {
            if let Some((_, new)) = RENAMES.iter().find(|(old, _)| old == name) {
                *name = (*new).to_string();
                hit = true;
            }
        }
        touched += usize::from(hit);
    }
    touched
}
