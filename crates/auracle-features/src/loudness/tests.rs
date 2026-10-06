use super::*;

/// A phrase-length buffer at `amp`, with one sample spiked to `peak` — a
/// crest factor built to order.
fn peaky(amp: f64, peak: f64, sr: f64) -> Vec<f64> {
    let n = (2.0 * sr) as usize;
    // A 220 Hz sine, so the K-weighted loudness is a real measurement
    // rather than an artifact of a square or of DC.
    let mut v: Vec<f64> = (0..n)
        .map(|i| amp * (std::f64::consts::TAU * 220.0 * i as f64 / sr).sin())
        .collect();
    v[n / 2] = peak;
    v
}

/// **The defect, as a number.** A quiet, very peaky render asks for tens of
/// dB of makeup; without the ceiling it gets it, and the audition arrives
/// over full scale. The measured worst case over 150 prior draws was 4.06.
#[test]
fn a_peaky_render_never_leaves_above_full_scale() {
    let sr = 44_100.0;
    let mut x = peaky(0.02, 0.5, sr);
    let r = normalize_to(&mut x, sr, -18.0).expect("not silent");
    let peak = x.iter().fold(0.0f64, |p, s| p.max(s.abs()));
    assert!(
        peak <= PEAK_CEILING + 1e-12,
        "normalized peak {peak} is over the ceiling"
    );
    // …and it says so, rather than reading as a patch that is simply quiet.
    assert!(
        r.peak_reduction_db > 0.0,
        "the ceiling bound the gain but reported no reduction"
    );
}

/// **An ordinary render must come out exactly as it did before the ceiling
/// existed.** The ceiling is a fault stop, not a level policy: if it moved
/// the gain of a patch that was never going to clip, it would be quietly
/// re-levelling the whole pool and every audio feature that is not
/// scale-invariant with it.
#[test]
fn a_render_with_headroom_is_untouched_by_the_ceiling() {
    let sr = 44_100.0;
    let mut x = peaky(0.1, 0.1, sr); // crest ≈ √2, nothing to catch
    let r = normalize_to(&mut x, sr, -18.0).expect("not silent");
    assert_eq!(r.peak_reduction_db, 0.0, "the ceiling bound a clean render");
    assert_eq!(
        r.gain_db,
        (-18.0 - r.lufs_before).min(MAX_GAIN_DB),
        "gain moved on a render that had headroom"
    );
}

/// A render that is *already* over the ceiling and also over the loudness
/// target is attenuated by the loudness target, and the ceiling claims no
/// credit for it. The naive `wanted − got` would report a reduction here
/// and make every loud patch look peak-limited.
#[test]
fn attenuation_the_loudness_target_asked_for_is_not_charged_to_the_ceiling() {
    let sr = 44_100.0;
    let mut x = peaky(0.9, 0.95, sr); // loud, but crest ≈ 1.5
    let r = normalize_to(&mut x, sr, -18.0).expect("not silent");
    assert!(r.gain_db < 0.0, "a loud render should be attenuated");
    assert_eq!(
        r.peak_reduction_db, 0.0,
        "loudness attenuation was charged to the peak ceiling"
    );
}
