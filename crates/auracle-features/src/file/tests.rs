use super::*;

fn tone(hz: f64, sr: f64, seconds: f64, amp: f64) -> Vec<f32> {
    (0..(seconds * sr) as usize)
        .map(|i| (amp * (std::f64::consts::TAU * hz * i as f64 / sr).sin()) as f32)
        .collect()
}

/// Every name in the mask is a coordinate of φ: a renamed feature would
/// otherwise slip out of the mask and be believed on a file.
#[test]
fn masked_names_are_coordinates_of_phi() {
    for n in FILE_MASKED {
        assert!(AudioFeatures::NAMES.contains(&n), "φ has no {n}");
    }
    let observed = file_observed();
    assert_eq!(observed.len(), Features::phi_names().len());
    let audio = AudioFeatures::NAMES.len();
    assert!(
        observed[audio..].iter().all(|o| !o),
        "a structural coordinate is observed"
    );
    assert_eq!(
        observed.iter().filter(|o| !**o).count(),
        FILE_MASKED.len() + structural_len()
    );
    assert_eq!(
        file_masked_names().len(),
        FILE_MASKED.len() + structural_len()
    );
}

/// The bounds hold, each with its own flag.
#[test]
fn bounds_are_flags() {
    let ok = tone(220.0, 44_100.0, 1.0, 0.3);
    assert!(featurize_file(&ok, 44_100.0).is_ok());
    assert_eq!(
        featurize_file(&ok, 4_000.0).unwrap_err(),
        FileError::BadRate
    );
    assert_eq!(
        featurize_file(&ok, 400_000.0).unwrap_err(),
        FileError::BadRate
    );
    let long = vec![0.1f32; (FILE_INPUT_MAX_SECONDS * 8_000.0) as usize + 1];
    assert_eq!(
        featurize_file(&long, 8_000.0).unwrap_err(),
        FileError::TooLong
    );
    let mut nan = ok.clone();
    nan[100] = f32::NAN;
    assert_eq!(
        featurize_file(&nan, 44_100.0).unwrap_err(),
        FileError::NonFinite
    );
    assert_eq!(
        featurize_file(&vec![0.0; 44_100], 44_100.0).unwrap_err(),
        FileError::Silent
    );
    let short = tone(220.0, 44_100.0, 0.3, 0.3);
    assert_eq!(
        featurize_file(&short, 44_100.0).unwrap_err(),
        FileError::TooShort
    );
    assert_eq!(FileError::TooShort.code(), "too_short");
}

/// Silence around a sound is not part of it: padding a tone with two
/// seconds of nothing either side measures the same file, and a long
/// one is cut at the cap.
#[test]
fn trimming_and_the_cap() {
    let sr = 44_100.0;
    let t = tone(330.0, sr, 1.5, 0.25);
    let mut padded = vec![0.0f32; 2 * sr as usize];
    padded.extend_from_slice(&t);
    padded.extend(std::iter::repeat_n(0.0f32, 2 * sr as usize));
    let a = featurize_file(&t, sr).unwrap();
    let b = featurize_file(&padded, sr).unwrap();
    assert!(
        (a.seconds - b.seconds).abs() < 0.011,
        "{} vs {}",
        a.seconds,
        b.seconds
    );
    for (x, y) in a.audio.to_vec().iter().zip(b.audio.to_vec()) {
        assert!((x - y).abs() < 1e-6, "{x} vs {y}");
    }
    let long = tone(330.0, 8_000.0, FILE_MAX_SECONDS + 5.0, 0.25);
    let c = featurize_file(&long, 8_000.0).unwrap();
    assert!(c.truncated);
    assert!((c.seconds - FILE_MAX_SECONDS).abs() < 0.01);
}

/// The same sound at 48 kHz and at 44.1 kHz measures the same: the
/// resampler puts every log-frequency coordinate on the render's axis.
#[test]
fn a_rate_change_does_not_move_phi() {
    let mk = |sr: f64| -> Vec<f32> {
        (0..(2.0 * sr) as usize)
            .map(|i| {
                let t = i as f64 / sr;
                let saw: f64 = (1..30)
                    .map(|h| (std::f64::consts::TAU * 110.0 * h as f64 * t).sin() / h as f64)
                    .sum();
                (0.2 * saw * (1.0 - (-t * 8.0).exp())) as f32
            })
            .collect()
    };
    let a = featurize_file(&mk(44_100.0), 44_100.0).unwrap().audio;
    let b = featurize_file(&mk(48_000.0), 48_000.0).unwrap().audio;
    for ((n, x), y) in AudioFeatures::NAMES.iter().zip(a.to_vec()).zip(b.to_vec()) {
        assert!((x - y).abs() < 0.02 * (1.0 + x.abs()), "{n}: {x} vs {y}");
    }
}

/// **The mask is the measurement.** Half the presets (every other one),
/// rendered on each of [`recording_stimuli`] and measured as files: every
/// coordinate the mask believes must track the phrase on every stimulus
/// ([`SURVIVES_R`], [`SURVIVES_RMSE`]), and every audio coordinate it
/// masks must miss on at least one. A φ change that moved a coordinate
/// across the line fails here until the mask moves with it
/// (`examples/file_phi.rs` prints the table over all of them).
#[test]
fn the_mask_is_what_survives_a_recording() {
    use crate::render::render_phrase;
    let bank: Vec<_> = auracle_grammar::preset_bank()
        .into_iter()
        .step_by(2)
        .collect();
    let stimuli = recording_stimuli();
    let spec = PhraseSpec::default();
    type Row = (Vec<f64>, Vec<Option<Vec<f64>>>);
    let measure = |tree: &auracle_grammar::PatchTree| -> Option<Row> {
        let truth = crate::featurize(tree, &spec).ok()?.features.audio.to_vec();
        let files = stimuli
            .iter()
            .map(|(_, s)| {
                let r = render_phrase(tree, s).ok()?;
                let pcm: Vec<f32> = r.samples.iter().map(|&x| x as f32).collect();
                featurize_file(&pcm, spec.sample_rate)
                    .ok()
                    .map(|f| f.audio.to_vec())
            })
            .collect();
        Some((truth, files))
    };
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    let rows: Vec<Row> = std::thread::scope(|sc| {
        let hs: Vec<_> = bank
            .chunks(bank.len().div_ceil(threads))
            .map(|part| {
                let measure = &measure;
                sc.spawn(move || {
                    part.iter()
                        .filter_map(|p| measure(&p.tree))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        hs.into_iter().flat_map(|h| h.join().unwrap()).collect()
    });
    assert!(rows.len() >= 25, "only {} presets measured", rows.len());
    let n = rows.len() as f64;
    for (j, name) in AudioFeatures::NAMES.iter().enumerate() {
        let m = rows.iter().map(|r| r.0[j]).sum::<f64>() / n;
        let sd = (rows.iter().map(|r| (r.0[j] - m).powi(2)).sum::<f64>() / n).sqrt();
        let sd = if sd < 1e-9 { 1.0 } else { sd };
        let worst = (0..stimuli.len())
            .map(|k| {
                let (a, b): (Vec<f64>, Vec<f64>) = rows
                    .iter()
                    .filter_map(|r| r.1[k].as_ref().map(|f| (r.0[j], f[j])))
                    .unzip();
                let (r, rmse, _) = agreement(&a, &b, sd);
                (stimuli[k].0, r, rmse)
            })
            .collect::<Vec<_>>();
        let survives = worst
            .iter()
            .all(|(_, r, rmse)| *r >= SURVIVES_R && *rmse <= SURVIVES_RMSE);
        let masked = FILE_MASKED.contains(name);
        assert!(
            survives != masked,
            "{name}: masked {masked}, but a recording {} it: {worst:?}",
            if survives {
                "measures"
            } else {
                "does not measure"
            }
        );
    }
}

/// Resampling keeps a tone under the cutoff and removes one above it.
#[test]
fn resampling_is_band_limited() {
    let rms = |v: &[f64]| (v.iter().map(|s| s * s).sum::<f64>() / v.len() as f64).sqrt();
    let to_f64 = |v: Vec<f32>| v.into_iter().map(f64::from).collect::<Vec<_>>();
    let low = resample(
        &to_f64(tone(1_000.0, 96_000.0, 0.5, 0.5)),
        96_000.0,
        44_100.0,
    );
    let high = resample(
        &to_f64(tone(30_000.0, 96_000.0, 0.5, 0.5)),
        96_000.0,
        44_100.0,
    );
    let inner = |v: &Vec<f64>| v[2000..v.len() - 2000].to_vec();
    assert!((rms(&inner(&low)) - 0.5 / 2f64.sqrt()).abs() < 0.01);
    assert!(
        rms(&inner(&high)) < 0.5e-3,
        "a 30 kHz tone survived: {}",
        rms(&high)
    );
    let same = to_f64(tone(500.0, 44_100.0, 0.1, 0.5));
    assert_eq!(resample(&same, 44_100.0, 44_100.0), same);
}
