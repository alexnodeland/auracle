use super::*;

const SR: f64 = 44_100.0;
const N: usize = 222_705; // the standard phrase's length

fn sine(hz: f64) -> Vec<f64> {
    (0..N)
        .map(|i| 0.5 * (std::f64::consts::TAU * hz * i as f64 / SR).sin())
        .collect()
}

/// Deterministic white noise (a xorshift, uniform in ±0.5).
fn noise() -> Vec<f64> {
    let mut s = 0x9E37_79B9_7F4A_7C15u64;
    (0..N)
        .map(|_| {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            (s >> 11) as f64 / (1u64 << 53) as f64 - 0.5
        })
        .collect()
}

fn band_of(hz: f64) -> usize {
    let e = band_edges_hz();
    (0..FACE_BANDS)
        .find(|&b| hz >= e[b] && hz < e[b + 1])
        .unwrap()
}

#[test]
fn a_sine_lights_one_band() {
    for hz in [220.0, 1000.0, 4400.0] {
        let f = Face::of_f64(&sine(hz), SR);
        let ltas = f.ltas_db();
        let lit = band_of(hz);
        assert_eq!(ltas[lit], 0.0, "{hz} Hz: its own band is the loudest");
        for (b, v) in ltas.iter().enumerate() {
            if b.abs_diff(lit) >= 3 {
                assert!(*v <= -40.0, "{hz} Hz lights band {b} at {v} dB");
            }
        }
        // Every slice is the same steady tone.
        for t in 0..FACE_SLICES {
            assert_eq!(f.slice_db(t)[lit], 0.0);
        }
        assert!(
            f.loud_db().iter().all(|l| *l > -1.0),
            "a steady tone is as loud in every slice"
        );
    }
}

#[test]
fn noise_lights_every_band() {
    let f = Face::of_f64(&noise(), SR);
    let ltas = f.ltas_db();
    let lo = ltas.iter().cloned().fold(f64::INFINITY, f64::min);
    assert!(
        lo >= -3.0,
        "white noise reads within 3 dB in every band: {ltas:?}"
    );
}

#[test]
fn slices_follow_time_and_loudness() {
    // A 220 Hz tone for the first half, then a 4.4 kHz tone 20 dB down.
    let a = sine(220.0);
    let b = sine(4400.0);
    let x: Vec<f64> = (0..N)
        .map(|i| if i < N / 2 { a[i] } else { 0.1 * b[i] })
        .collect();
    let f = Face::of_f64(&x, SR);
    assert_eq!(f.slice_db(0)[band_of(220.0)], 0.0);
    assert_eq!(f.slice_db(11)[band_of(4400.0)], 0.0);
    let loud = f.loud_db();
    assert_eq!(loud[0], 0.0);
    assert!(
        (loud[11] + 20.0).abs() <= 1.0,
        "the quiet half reads 20 dB down: {loud:?}"
    );
}

#[test]
fn a_face_is_a_pure_function_of_the_audition() {
    let x = noise();
    let as_f32: Vec<f32> = x.iter().map(|s| *s as f32).collect();
    assert_eq!(Face::of_f64(&x, SR), Face::of_f64(&x, SR));
    assert_eq!(Face::of_f64(&x, SR), Face::of_f32(&as_f32, SR));
}

#[test]
fn silence_and_short_buffers_floor_without_panicking() {
    let f = Face::of_f64(&vec![0.0; N], SR);
    assert!(f.bytes().iter().all(|b| *b == 0));
    assert_eq!(Face::of_f64(&[0.1, -0.1, 0.2], SR).bytes().len(), FACE_LEN);
    assert_eq!(Face::of_f64(&[], SR).bytes().len(), FACE_LEN);
}

#[test]
fn it_round_trips_as_one_string() {
    let f = Face::of_f64(&sine(440.0), SR);
    let text = serde_json::to_string(&f).unwrap();
    assert!(text.len() < 760, "{} bytes", text.len());
    let back: Face = serde_json::from_str(&text).unwrap();
    assert_eq!(back, f);
    assert!(serde_json::from_str::<Face>("\"AAAA\"").is_err());
    for n in 0..7 {
        let bytes: Vec<u8> = (0..n).map(|i| (i * 37 + 11) as u8).collect();
        assert_eq!(b64_decode(&b64_encode(&bytes)).unwrap(), bytes);
    }
}

/// The fixture `apps/web/tests/fixtures/live-frame-face.json`: one frame
/// of [`FRAME`] samples (a C3 sawtooth, the note the stage read worst
/// through an analyser's Blackman window) and the face the engine takes
/// of exactly those samples. One frame is one slice (its center is in
/// slice 6) and the whole long-term spectrum, so the app's live meter
/// (`faces.js` `createLiveMeter`), fed the same samples, must read the
/// same bands. Fails when the analysis has moved and the fixture has
/// not; `AURACLE_UPDATE_FIXTURES=1` rewrites it.
#[test]
fn the_live_frame_fixture_is_current() {
    let hz = 130.812_782_650_299_3; // C3
    let x: Vec<f32> = (0..FRAME)
        .map(|i| {
            let phase = (i as f64 * hz / SR).fract();
            (0.4 * (2.0 * phase - 1.0)) as f32
        })
        .collect();
    let face = Face::of_f32(&x, SR);
    assert_eq!(
        face.slice_db(6),
        face.ltas_db(),
        "one frame is its own long-term spectrum"
    );
    let samples: Vec<f64> = x.iter().map(|s| f64::from(*s)).collect();
    let json = serde_json::to_string(&serde_json::json!({
        "about": "One frame of a C3 sawtooth and the face the engine takes of it. Written by auracle-features' face::tests::the_live_frame_fixture_is_current; do not edit.",
        "sample_rate": SR,
        "samples": samples,
        "face": face,
    }))
    .unwrap();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/web/tests/fixtures/live-frame-face.json");
    if std::env::var_os("AURACLE_UPDATE_FIXTURES").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, format!("{json}\n")).unwrap();
    }
    let have = std::fs::read_to_string(&path).unwrap_or_default();
    assert_eq!(
        have.trim_end(),
        json,
        "the fixture is stale: run with AURACLE_UPDATE_FIXTURES=1"
    );
}

#[test]
fn the_bands_span_the_range_in_equal_steps() {
    let e = band_edges_hz();
    assert_eq!(e.len(), FACE_BANDS + 1);
    assert!((e[0] - FACE_LO_HZ).abs() < 1e-9 && (e[FACE_BANDS] - FACE_HI_HZ).abs() < 1e-6);
    // Every band has weight: none is empty, however narrow.
    assert!(band_weights(SR).iter().all(|w| !w.is_empty()));
}
