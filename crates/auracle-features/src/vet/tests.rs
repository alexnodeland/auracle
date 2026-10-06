use super::*;
use crate::phrase::{Note, PhraseSpec};

const SR: f64 = 44_100.0;

/// One second of a 220 Hz sine at `amp`, riding `offset`.
fn tone(amp: f64, offset: f64) -> Vec<f64> {
    (0..SR as usize)
        .map(|i| offset + amp * (std::f64::consts::TAU * 220.0 * i as f64 / SR).sin())
        .collect()
}

/// The standard phrase with every chord taken out, or given `extra` voices.
fn with_voices(extra: usize) -> PhraseSpec {
    let mut spec = PhraseSpec::default();
    for n in &mut spec.notes {
        n.chord.clear();
    }
    spec.notes.push(Note {
        voct: 0.0,
        on_s: 0.5,
        off_s: 0.2,
        chord: (0..extra).map(|k| (k + 1) as f64 / 12.0).collect(),
    });
    spec
}

/// **A playable render is admitted, and its report says what was measured.**
/// A sine at half scale: peak 0.5, RMS 0.5/√2, no offset, and the fraction of
/// samples within 2 % of the peak that a sine spends at its crests.
#[test]
fn a_clean_tone_passes_with_its_measurements() {
    let r = vet(&tone(0.5, 0.0), &VetConfig::default()).expect("a clean tone vets");
    assert!((r.peak - 0.5).abs() < 1e-6, "peak {}", r.peak);
    assert!((r.rms - 0.5 / 2f64.sqrt()).abs() < 1e-4, "rms {}", r.rms);
    assert!(r.dc_ratio < 1e-3, "dc ratio {}", r.dc_ratio);
    // |sin| ≥ 0.98 for 2·acos(0.98)/π of the time, about 13 %.
    assert!(
        (0.10..0.16).contains(&r.pinned_fraction),
        "{}",
        r.pinned_fraction
    );
}

/// **Every refusal the films and the reference name, each by its class**:
/// a sample that is not a number, silence, a runaway peak, and a signal
/// dominated by DC. The thresholds are the config's, so each case sits on the
/// far side of one threshold and inside the others.
#[test]
fn each_pathology_is_refused_by_its_class() {
    let cfg = VetConfig::default();

    let mut nan = tone(0.5, 0.0);
    nan[1000] = f64::NAN;
    assert_eq!(vet(&nan, &cfg), Err(VetFailure::NonFinite));
    let mut inf = tone(0.5, 0.0);
    inf[0] = f64::INFINITY;
    assert_eq!(vet(&inf, &cfg), Err(VetFailure::NonFinite));

    assert_eq!(vet(&[], &cfg), Err(VetFailure::Silent { rms: 0.0 }));
    let hiss = tone(cfg.rms_floor / 10.0, 0.0);
    assert!(
        matches!(vet(&hiss, &cfg), Err(VetFailure::Silent { rms }) if rms < cfg.rms_floor),
        "a tone a tenth of the floor is silence"
    );

    let runaway = tone(cfg.peak_ceiling + 0.5, 0.0);
    match vet(&runaway, &cfg) {
        Err(VetFailure::Overlevel { peak }) => assert!(peak > cfg.peak_ceiling, "peak {peak}"),
        other => panic!("a peak over the ceiling was not refused as runaway: {other:?}"),
    }

    // A ±0.2 tone riding +0.7: |mean|/rms = 0.7/√(0.49 + 0.02) ≈ 0.98, and
    // its peak (0.9) is well under the ceiling.
    let offset = tone(0.2, 0.7);
    match vet(&offset, &cfg) {
        Err(VetFailure::DcDominated { dc_ratio }) => {
            assert!((dc_ratio - 0.7 / 0.51f64.sqrt()).abs() < 1e-3, "{dc_ratio}");
        }
        other => panic!("a tone on a 0.7 offset was not refused as DC: {other:?}"),
    }
}

/// **The ceiling makes room for each voice the phrase stacks.** One voice is
/// allowed 2.0, and each chord voice adds one voice's worth (1.5), so a peak
/// that two honest voices reach together passes a dyad's phrase and is
/// refused as runaway on a mono one.
#[test]
fn the_ceiling_grows_with_the_phrases_voices() {
    let ceilings: Vec<f64> = (0..3)
        .map(|extra| VetConfig::for_spec(&with_voices(extra)).peak_ceiling)
        .collect();
    assert_eq!(ceilings, [2.0, 3.5, 5.0]);
    assert_eq!(
        VetConfig::for_spec(&with_voices(0)).peak_ceiling,
        VetConfig::default().peak_ceiling,
        "a mono phrase is the default config"
    );
    let stacked = tone(3.0, 0.0);
    assert!(vet(&stacked, &VetConfig::for_spec(&with_voices(1))).is_ok());
    assert!(matches!(
        vet(&stacked, &VetConfig::for_spec(&with_voices(0))),
        Err(VetFailure::Overlevel { .. })
    ));
}
