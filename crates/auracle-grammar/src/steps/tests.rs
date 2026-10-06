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

/// `rate_site` is `rate_hz`'s inverse across the knob, so a rate snapped to
/// the tempo lands on the knob position that plays it; a rate past either
/// end lands on that end, and one that is not a rate at all (zero,
/// negative, not finite) on the slowest.
#[test]
fn rate_site_is_the_rate_maps_inverse() {
    for i in 0..=100 {
        let x = i as f64 / 100.0;
        assert!((rate_site(rate_hz(x)) - x).abs() < 1e-12, "at {x}");
    }
    assert_eq!(rate_site(0.1), 0.0);
    assert_eq!(rate_site(100.0), 1.0);
    for nonsense in [0.0, -2.0, f64::NAN, f64::INFINITY] {
        assert_eq!(rate_site(nonsense), 0.0, "{nonsense}");
    }
}

/// A host rate that is not one (zero, negative, not finite), at
/// construction or later, plays as 44.1 kHz rather than stopping the clock
/// or dividing by zero.
#[test]
fn a_host_rate_that_makes_no_sense_plays_at_44_1_khz() {
    let play = |mut m: StepsCv| {
        let mut inp = PortValues::new();
        inp.set(PORT_RATE, 0.4);
        inp.set(PORT_LENGTH, 0.0);
        inp.set(PORT_S0 + 1, 1.0);
        let mut out = PortValues::new();
        (0..44_100)
            .map(|_| {
                m.tick(&inp, &mut out);
                out.get(PORT_OUT).unwrap()
            })
            .collect::<Vec<_>>()
    };
    let at_44_1 = play(StepsCv::new(44_100.0));
    // Two steps a second: both values play within the second.
    assert!(at_44_1.contains(&5.0) && at_44_1.contains(&0.0));
    for bad in [0.0, -48_000.0, f64::NAN] {
        assert_eq!(play(StepsCv::new(bad)), at_44_1, "new({bad})");
        let mut m = StepsCv::new(44_100.0);
        m.set_sample_rate(bad);
        assert_eq!(play(m), at_44_1, "set_sample_rate({bad})");
    }
    let mut m = StepsCv::new(44_100.0);
    m.set_sample_rate(22_050.0);
    assert_ne!(play(m), at_44_1, "a real rate is taken");
}

/// Turning `length` down past the step that is playing wraps the pattern
/// at once: the next sample is step 0, not the rest of a step the player
/// just removed.
#[test]
fn shortening_the_pattern_past_the_playing_step_wraps_at_once() {
    let sr = 48_000.0;
    let mut m = StepsCv::new(sr);
    let mut inp = PortValues::new();
    inp.set(PORT_RATE, 0.4); // 2 Hz
    inp.set(PORT_LENGTH, 1.0); // all eight
    inp.set(PORT_SLEW, 0.0);
    for i in 0..8 {
        inp.set(PORT_S0 + i, i as f64 / 7.0);
    }
    let mut out = PortValues::new();
    // 2.75 s at two steps a second: the middle of step 5.
    for _ in 0..(2.75 * sr) as usize {
        m.tick(&inp, &mut out);
    }
    assert_eq!(out.get(PORT_OUT), Some(step_volts(5.0 / 7.0)));
    inp.set(PORT_LENGTH, 0.0); // two steps
    m.tick(&inp, &mut out);
    assert_eq!(out.get(PORT_OUT), Some(step_volts(0.0)));
}

/// A transport position on another step re-seats the pattern there, and
/// with glide on, the output glides to it from wherever it was rather than
/// jumping: the sample after the re-seat is the sample before it, and the
/// new step's value arrives by the end of the glide.
#[test]
fn a_reseat_on_another_step_glides_from_where_the_output_was() {
    let sr = 48_000.0;
    let mut m = StepsCv::new(sr);
    let mut inp = PortValues::new();
    inp.set(PORT_RATE, 0.4); // 2 Hz
    inp.set(PORT_LENGTH, 1.0);
    inp.set(PORT_SLEW, 0.5); // the first half of each step glides
    for i in 0..8 {
        inp.set(PORT_S0 + i, i as f64 / 7.0);
    }
    let mut out = PortValues::new();
    // The middle of step 1, its glide done.
    for _ in 0..(0.85 * sr) as usize {
        m.tick(&inp, &mut out);
    }
    let before = out.get(PORT_OUT).unwrap();
    assert_eq!(before, step_volts(1.0 / 7.0));
    inp.set(PORT_SYNC, 6.0); // step 6, at its start
    m.tick(&inp, &mut out);
    assert_eq!(out.get(PORT_OUT), Some(before), "the re-seat jumped");
    // Half a step (a quarter second) later the glide has arrived.
    for _ in 0..(0.25 * sr) as usize {
        m.tick(&inp, &mut out);
    }
    assert!((out.get(PORT_OUT).unwrap() - step_volts(6.0 / 7.0)).abs() < 1e-9);
}

/// A host so slow that one sample is several steps (4 Hz against 16 steps a
/// second) still plays the pattern, a step per sample, rather than stalling
/// on one. With glide on, which is where the old post-wrap guard reset the
/// phase into the glide every sample and froze the output on its first
/// value.
#[test]
fn a_host_slower_than_the_steps_still_plays_the_pattern() {
    let mut m = StepsCv::new(4.0);
    let mut inp = PortValues::new();
    inp.set(PORT_RATE, 1.0); // 16 Hz
    inp.set(PORT_LENGTH, 1.0);
    inp.set(PORT_SLEW, 0.5);
    for i in 0..8 {
        inp.set(PORT_S0 + i, i as f64 / 7.0);
    }
    let mut out = PortValues::new();
    let played: Vec<f64> = (0..16)
        .map(|_| {
            m.tick(&inp, &mut out);
            out.get(PORT_OUT).unwrap()
        })
        .collect();
    let want: Vec<f64> = (0..16).map(|i| step_volts((i % 8) as f64 / 7.0)).collect();
    assert_eq!(played, want);
}

/// The sequencer names itself in quiver's views of a patch (its debug
/// listing, a saved patch definition), rather than as quiver's `unknown`.
#[test]
fn the_sequencer_names_itself_to_quiver() {
    let mut patch = quiver::prelude::Patch::new(48_000.0);
    patch.add("seq", StepsCv::new(48_000.0));
    let listing = format!("{patch:?}");
    assert!(listing.contains("seq (auracle_steps)"), "{listing}");
}
