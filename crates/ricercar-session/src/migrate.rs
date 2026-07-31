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
//!   nine module counts). Dropped here too.
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

/// Convert one schema-1 raw vector onto `target` — the *current* φ names, in
/// their current order.
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
            .position(|n| *n == name)
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
/// profile carries) and `names` the current φ names, which the result is
/// projected onto. Returns how many observations were migrated;
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
