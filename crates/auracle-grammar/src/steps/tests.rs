use super::*;

/// Drive the module directly with fixed port values for `seconds`.
fn run(sr: f64, rate: f64, length: f64, slew: f64, values: [f64; 8], seconds: f64) -> Vec<f64> {
    let mut m = StepsCv::new(sr);
    let mut inp = PortValues::new();
    inp.set(PORT_RATE, rate);
    inp.set(PORT_LENGTH, length);
    inp.set(PORT_SLEW, slew);
    for (i, v) in values.iter().enumerate() {
        inp.set(PORT_S0 + i as PortId, *v);
    }
    let mut out = PortValues::new();
    (0..(sr * seconds) as usize)
        .map(|_| {
            m.tick(&inp, &mut out);
            out.get(PORT_OUT).expect("out is always written")
        })
        .collect()
}

const ALT: [f64; 8] = [0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0];

#[test]
fn the_maps_hit_their_documented_ends() {
    assert!((rate_hz(0.0) - 0.5).abs() < 1e-12);
    assert!((rate_hz(1.0) - 16.0).abs() < 1e-12);
    assert!((rate_hz(0.4) - 2.0).abs() < 1e-12);
    assert_eq!(step_count(0.0), 2);
    assert_eq!(step_count(1.0), 8);
    // Seven equal bins, every count reachable.
    let counts: std::collections::BTreeSet<_> =
        (0..=700).map(|i| step_count(i as f64 / 700.0)).collect();
    assert_eq!(
        counts.into_iter().collect::<Vec<_>>(),
        (2..=8).collect::<Vec<_>>()
    );
    assert_eq!(step_volts(0.0), -5.0);
    assert_eq!(step_volts(1.0), 5.0);
    assert_eq!(step_volts(0.5), 0.0);
}

/// Hard steps at 2 Hz, two of them: ±5 V alternating every half second,
/// starting on `s0`.
#[test]
fn hard_steps_play_the_pattern_at_the_rate() {
    let sr = 48_000.0;
    let out = run(sr, 0.4, 0.0, 0.0, ALT, 2.0);
    for (k, want) in [(0usize, -5.0), (1, 5.0), (2, -5.0), (3, 5.0)] {
        let mid = (k as f64 + 0.5) * 0.5 * sr;
        assert_eq!(out[mid as usize], want, "step {k}");
    }
    // Exactly two values ever appear.
    assert!(out.iter().all(|v| *v == 5.0 || *v == -5.0));
}

/// Only the first `length` values play; the rest are latent.
#[test]
fn length_hides_the_tail_without_forgetting_it() {
    let mut vals = [0.5; 8];
    vals[5] = 1.0; // only reachable at length ≥ 6
    let short = run(48_000.0, 1.0, 0.0, 0.0, vals, 2.0);
    assert!(short.iter().all(|v| *v == 0.0), "a latent step played");
    let long = run(48_000.0, 1.0, 1.0, 0.0, vals, 2.0);
    assert!(long.contains(&5.0), "step 5 never played at length 8");
}

/// Slew is a fraction of the step, so the trajectory is the same curve at
/// any sample rate, and a full slew never jumps.
#[test]
fn slew_is_sample_rate_independent_and_smooth() {
    let a = run(44_100.0, 0.4, 0.0, 0.5, ALT, 2.0);
    let b = run(96_000.0, 0.4, 0.0, 0.5, ALT, 2.0);
    for t in [0.1, 0.3, 0.55, 0.62, 0.9, 1.3, 1.77] {
        let (x, y) = (a[(t * 44_100.0) as usize], b[(t * 96_000.0) as usize]);
        assert!((x - y).abs() < 0.01, "t={t}: {x} at 44.1k vs {y} at 96k");
    }
    let full = run(48_000.0, 0.4, 0.0, 1.0, ALT, 2.0);
    let jump = full
        .windows(2)
        .map(|w| (w[1] - w[0]).abs())
        .fold(0.0, f64::max);
    // 10 V over a half-second glide is 0.0004 V a sample at 48 kHz.
    assert!(jump < 0.001, "a full slew still jumped {jump} V");
}

/// Garbage in is not garbage out: a non-finite port reads as its default
/// and the clock keeps running.
#[test]
fn non_finite_inputs_cannot_latch_the_module() {
    let mut m = StepsCv::new(48_000.0);
    let mut inp = PortValues::new();
    for id in 0..11 {
        inp.set(id, f64::NAN);
    }
    let mut out = PortValues::new();
    for _ in 0..48_000 {
        m.tick(&inp, &mut out);
        assert!(out.get(PORT_OUT).unwrap().is_finite());
    }
    inp.set(PORT_RATE, f64::INFINITY);
    inp.set(PORT_S0, 1.0);
    for _ in 0..1000 {
        m.tick(&inp, &mut out);
        assert!(out.get(PORT_OUT).unwrap().is_finite());
    }
}

/// `reset` puts the module back exactly where `new` did.
#[test]
fn reset_replays_the_same_samples() {
    let mut m = StepsCv::new(48_000.0);
    let mut inp = PortValues::new();
    inp.set(PORT_RATE, 0.8);
    inp.set(PORT_LENGTH, 0.6);
    inp.set(PORT_SLEW, 0.3);
    for i in 0..8 {
        inp.set(PORT_S0 + i, i as f64 / 7.0);
    }
    let mut out = PortValues::new();
    let mut take = |m: &mut StepsCv| {
        (0..30_000)
            .map(|_| {
                m.tick(&inp, &mut out);
                out.get(PORT_OUT).unwrap()
            })
            .collect::<Vec<_>>()
    };
    let first = take(&mut m);
    m.reset();
    assert_eq!(take(&mut m), first);
}

/// Two sequencers with different histories — one started a third of a
/// second earlier, like two voices struck at different times — play the
/// same samples from the moment they are handed the same transport
/// position, and keep agreeing while it advances. Unsynced they would
/// not, and the free-running default is untouched.
#[test]
fn sync_puts_voices_on_one_grid() {
    let sr = 48_000.0;
    let mut inp = PortValues::new();
    inp.set(PORT_RATE, 0.5);
    inp.set(PORT_LENGTH, 0.7);
    inp.set(PORT_SLEW, 0.0);
    for i in 0..8 {
        inp.set(PORT_S0 + i, i as f64 / 7.0);
    }
    let (mut a, mut b) = (StepsCv::new(sr), StepsCv::new(sr));
    let mut out = PortValues::new();
    for _ in 0..16_000 {
        a.tick(&inp, &mut out);
    }
    let hz = rate_hz(0.5);
    let block = 128;
    let mut transport = 0usize;
    for _ in 0..200 {
        inp.set(PORT_SYNC, transport as f64 * hz / sr);
        for _ in 0..block {
            a.tick(&inp, &mut out);
            let va = out.get(PORT_OUT).unwrap();
            b.tick(&inp, &mut out);
            let vb = out.get(PORT_OUT).unwrap();
            assert!(
                (va - vb).abs() < 1e-12,
                "voices left the grid at {transport}"
            );
        }
        transport += block;
    }
}
