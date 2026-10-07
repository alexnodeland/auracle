use super::*;
use auracle_grammar::{PatchGrammarPrior, Uid};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

fn tree_json(rng: &mut StdRng) -> String {
    serde_json::to_string(&PatchGrammarPrior::default().sample_with_rng(rng)).unwrap()
}

/// A plain saw → lowpass voice with a **percussive** amp envelope: fast
/// attack, medium decay, sustain 0. Once the decay has run the voice is
/// silent while its gate is still high, which makes an envelope retrigger
/// unmistakable — with one, a stolen voice speaks; without one, it cannot.
fn plucked_json() -> String {
    use auracle_grammar::term::{AmpEnv, FilterKind, Waveform};
    use auracle_grammar::{AudioNode, ModNode, PatchTree};
    serde_json::to_string(&PatchTree {
        amp: AmpEnv {
            attack: 0.2,  // ≈6 ms
            decay: 0.45,  // ≈63 ms
            sustain: 0.0, // the whole point
            release: 0.3, // ≈16 ms
        },
        root: AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::SvfLp,
            cutoff: 0.7,
            resonance: 0.1,
            mod_depth: 0.0,
            input: Box::new(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Saw,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            }),
            modulation: ModNode::None,
        },
    })
    .unwrap()
}

fn peak(buf: &[f32]) -> f32 {
    buf.iter().fold(0.0f32, |m, s| m.max(s.abs()))
}

fn energy(buf: &[f32]) -> f64 {
    buf.iter().map(|s| (*s as f64) * (*s as f64)).sum()
}

/// Native smoke: a prior patch plays a note (finite, audible), rings a
/// tail after release, and eventually parks its voices.
#[test]
fn live_poly_plays_and_parks() {
    quiver::rng::seed(7);
    let mut rng = StdRng::seed_from_u64(0x11FE);
    let json = tree_json(&mut rng);
    let mut poly = LivePoly::new(&json, 44_100.0, 4).expect("compiles");

    poly.note_on(60, 1.0);
    poly.note_on(64, 1.0);
    let mut held = 0.0f64;
    for _ in 0..40 {
        let out = poly.process(512);
        assert!(out.iter().all(|s| s.is_finite()));
        held += energy(&out);
    }
    assert!(held > 1e-6, "held notes produced silence");

    poly.note_off(60);
    poly.note_off(64);
    let tail = energy(&poly.process(128));
    assert!(tail > 0.0, "the released notes stopped dead");
    for _ in 0..900 {
        poly.process(512);
        if poly.voices.iter().all(|v| !v.running) {
            break;
        }
    }
    assert!(
        poly.voices.iter().all(|v| !v.running),
        "voices never parked after release"
    );
}

/// Live params: a knob written mid-note ramps to its mapped target, the
/// value the voice reads moving part of the way each quantum and never in
/// one jump, and the change is heard; it does not reset the voice: a
/// plucked note that has decayed to silence stays silent through the write,
/// where a retrigger would sound it again. Enum sites are refused.
#[test]
fn live_params_ramp_without_retrigger() {
    quiver::rng::seed(7);
    let json = first_bass();
    let mut a = LivePoly::new(&json, 44_100.0, 1).unwrap();
    let mut b = LivePoly::new(&json, 44_100.0, 1).unwrap();
    a.note_on(48, 1.0);
    b.note_on(48, 1.0);
    let _ = a.process(2048);
    let _ = b.process(2048);
    let cut = |p: &LivePoly| p.voices[0].voice.params["node#cut"].value.get();
    let start = cut(&a);
    assert!(a.set_param("node#cut", 1.0), "cutoff handle missing");
    assert!(
        !a.set_param("node#wave", 0.5),
        "enum sites must not be live"
    );
    let mut path = vec![start];
    for _ in 0..64 {
        let _ = a.process(128);
        path.push(cut(&a));
    }
    let end = *path.last().unwrap();
    assert!((end - 1.0).abs() < 1e-3, "smoother never converged: {end}");
    assert!(
        path[1] > start && path[1] < end - 0.1 * (end - start),
        "the first quantum jumped: {start} -> {} of {end}",
        path[1]
    );
    assert!(
        path.windows(2).all(|w| w[1] >= w[0]),
        "the ramp went back: {path:?}"
    );
    let out_a = a.process(4096);
    let out_b = b.process(4096);
    let diff: f64 = out_a
        .iter()
        .zip(&out_b)
        .map(|(x, y)| ((x - y) as f64).abs())
        .sum();
    assert!(diff > 1e-3, "cutoff change was inaudible (diff {diff})");
    assert!(energy(&out_a) > 1e-8, "voice died on param change");

    // No retrigger: a pluck decayed to silence, its gate still high.
    let mut pluck = LivePoly::new(&plucked_json(), 44_100.0, 1).unwrap();
    pluck.note_on(60, 1.0);
    for _ in 0..40 {
        let _ = pluck.process(512);
    }
    let decayed = energy(&pluck.process(4096));
    assert!(pluck.set_param("node#cut", 1.0));
    let after = energy(&pluck.process(4096));
    assert!(
        after <= decayed.max(1e-12) * 4.0,
        "a knob write sounded a decayed note again: {after:.3e} after, {decayed:.3e} before"
    );
}

/// Patch swap: the output fades out into the silent rebuild and back in
/// out of it, never cut hard at either edge, and the swap completes with an
/// event. (That a held note comes back at its level is
/// `a_held_pad_keeps_its_envelope_across_a_patch_swap`.)
#[test]
fn a_patch_swap_fades_out_and_in_around_its_silent_rebuild() {
    quiver::rng::seed(7);
    let mut rng = StdRng::seed_from_u64(0x5A5A);
    let mut poly = LivePoly::new(&tree_json(&mut rng), 44_100.0, 4).unwrap();
    poly.note_on(57, 1.0);
    for _ in 0..20 {
        let _ = poly.process(128);
    }
    assert!(poly.set_patch(&tree_json(&mut rng)));
    assert!(!poly.set_patch("not json"));

    // Drive through the whole transition, collecting the peak of every
    // quantum. Click-freeness = the quanta bordering the silent rebuild
    // gap are faded to (near) zero — the waveform never truncates hard.
    let mut quanta: Vec<(f32, f32, f32)> = Vec::new(); // (peak, first, last)
    let mut patched = false;
    for _ in 0..200 {
        let out = poly.process(128);
        assert!(out.iter().all(|s| s.is_finite()));
        let peak = out.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        quanta.push((peak, out[0].abs(), out[out.len() - 2].abs()));
        if poly.poll_event() == EVENT_PATCHED {
            patched = true;
        }
    }
    assert!(patched, "swap never completed");
    let silent: Vec<usize> = (0..quanta.len()).filter(|&i| quanta[i].0 == 0.0).collect();
    assert!(!silent.is_empty(), "no silent rebuild gap observed");
    let (first, last) = (silent[0], *silent.last().unwrap());
    assert!(first > 0, "the swap fell silent with no fade out");
    assert!(last + 1 < quanta.len(), "the swap never came back");
    // The final sample before the gap must have been faded to ~0, and the
    // first after it starts from ~0 (the fade in).
    assert!(
        quanta[first - 1].2 < 0.02,
        "hard cut into silence: boundary sample {}",
        quanta[first - 1].2
    );
    assert!(
        quanta[last + 1].1 < 0.02,
        "hard jump out of silence: boundary sample {}",
        quanta[last + 1].1
    );
    assert!(
        quanta[first - 1].0 > 0.0 && quanta[last + 1].0 > 0.0,
        "the held note sounded on neither side of the gap"
    );
}

/// A pad with a long release, so a trill's let-go notes are still ringing
/// when the next note is pressed.
fn long_tail_json() -> String {
    let mut tree: auracle_grammar::PatchTree = serde_json::from_str(&pad_json()).unwrap();
    tree.amp.release = 0.85;
    serde_json::to_string(&tree).unwrap()
}

/// Notes held under a trill stay held. Two keys down, and a fast trill on
/// two others: each trill note is let go with its release still ringing
/// when the next is pressed, so every voice is busy and each press has to
/// steal. It must steal a ringing tail, never a held note. By press age
/// alone it took the held notes first, and they dropped out under the
/// player's hands while the trill played on.
#[test]
fn held_notes_survive_a_trill_over_them() {
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(&long_tail_json(), 44_100.0, 4).unwrap();
    poly.note_on(48, 1.0);
    poly.note_on(52, 1.0);
    poly.process(512);
    let mut steals = 0;
    for i in 0..48 {
        let n = if i % 2 == 0 { 67 } else { 71 };
        if poly.voices.iter().all(|v| v.running) {
            steals += 1;
        }
        poly.note_on(n, 0.8);
        poly.process(256);
        poly.note_off(n);
        poly.process(256);
        let held: Vec<u8> = poly.voices.iter().filter_map(|v| v.note).collect();
        assert!(
            held.contains(&48) && held.contains(&52),
            "press {i}: the trill stole a held note (held now {held:?})"
        );
    }
    assert!(
        steals > 0,
        "the trill never filled the voices, so nothing was tested"
    );
}

/// When every voice is under a finger, a new note still sounds: the oldest
/// held note gives way to it.
#[test]
fn a_note_past_the_polyphony_takes_the_oldest_held() {
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(&long_tail_json(), 44_100.0, 4).unwrap();
    for n in [48, 52, 55, 59] {
        poly.note_on(n, 1.0);
        poly.process(64);
    }
    poly.note_on(62, 1.0);
    let held: Vec<u8> = poly.voices.iter().filter_map(|v| v.note).collect();
    assert!(held.contains(&62), "the new note did not sound: {held:?}");
    assert!(
        !held.contains(&48),
        "a newer held note was stolen instead of the oldest: {held:?}"
    );
}

/// A pad: slow attack (≈100 ms), full sustain, so the envelope's position
/// is legible in the output level and a restart is unmissable.
fn pad_json() -> String {
    use auracle_grammar::term::{AmpEnv, Waveform};
    use auracle_grammar::{AudioNode, ModNode, PatchTree};
    serde_json::to_string(&PatchTree {
        amp: AmpEnv {
            attack: 0.5,
            decay: 0.3,
            sustain: 1.0,
            release: 0.4,
        },
        root: AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Saw,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
        },
    })
    .unwrap()
}

/// A tempo change changes speed, not position. Two minutes in at 120
/// BPM, a nudge to 121 used to throw every synced sequencer four 16ths
/// forward (position was elapsed samples × the current rate); integrated
/// beats move on by exactly one block's worth. The nudges land mid-step. At
/// 121 and 126, where the division holds, each moves the sequencer forward
/// by one block's travel at most. At 140 the snapped division itself
/// changes, and the sequencer keeps the step it is on and takes the new
/// division's phase within it (`drive_sync`): never off its step.
#[test]
fn a_tempo_change_does_not_jump_the_sequencers() {
    quiver::rng::seed(7);
    let (_, tree) = auracle_grammar::presets()
        .into_iter()
        .find(|(n, _)| *n == "Loom")
        .expect("Loom exists");
    let json = serde_json::to_string(&tree).unwrap();
    let sr = 48_000.0;
    let mut p = LivePoly::new(&json, sr, 2).expect("compiles");
    p.set_arp(false, 0, 4.0, 120.0, 0.5, 1, 0.0);
    p.set_sync(true);
    // Key sync, then the key let go: the voices park (two minutes of them
    // cost what the test is not about), and the transport runs on.
    p.note_on(60, 0.8);
    p.process(128);
    p.note_off(60);
    let slot = p.sync_lanes[0].sync_slot;
    let pos = |p: &LivePoly| p.param_slots[slot].values[0].get();
    // Two minutes and a third of a beat: mid-step.
    for _ in 0..(120 * 48_000 + 8_000) / 128 {
        p.process(128);
    }
    assert!(p.voices.iter().all(|v| !v.running), "the voices parked");
    let before = pos(&p);
    assert!(
        (0.2..0.8).contains(&before.fract()),
        "fixture: mid-step ({before:.3})"
    );
    for bpm in [121.0, 126.0] {
        let before = pos(&p);
        let block = 128.0 * bpm / 60.0 / sr * p.sync_lanes[0].div;
        p.set_arp(false, 0, 4.0, bpm, 0.5, 1, 0.0);
        p.process(128);
        let moved = pos(&p) - before;
        assert!(
            moved > 0.0 && moved <= block + 1e-9,
            "{bpm} BPM moved the sequencer {moved:.4} steps, a block is {block:.4}"
        );
    }
    let div = p.sync_lanes[0].div;
    let before = pos(&p);
    p.set_arp(false, 0, 4.0, 140.0, 0.5, 1, 0.0);
    p.process(128);
    let after = pos(&p);
    assert_ne!(
        p.sync_lanes[0].div, div,
        "fixture: 140 BPM snaps another division"
    );
    assert_eq!(
        after.floor(),
        before.floor(),
        "140 BPM moved the sequencer off its step: {before:.3} -> {after:.3}"
    );
}

/// Tempo sync snaps a sequencer to the musical division nearest its own
/// rate: 3.7 steps/s at 120 BPM (2 beats/s) is 16ths, 4 steps/s.
#[test]
fn sync_snaps_to_the_nearest_division() {
    use auracle_grammar::steps::{rate_hz, rate_site};
    let x = snap_rate(rate_site(3.7), 120.0);
    assert!((rate_hz(x) - 4.0).abs() < 1e-9, "{}", rate_hz(x));
    // A slow patch goes to a slow division, not the nearest fast one.
    let x = snap_rate(rate_site(0.9), 120.0);
    assert!((rate_hz(x) - 1.0).abs() < 1e-9, "{}", rate_hz(x));
    // Tempo changes move the division with it: at 90 BPM, 3.7 steps/s
    // is nearer triplet 8ths (4.5) than straight 8ths (3), in octaves.
    let x = snap_rate(rate_site(3.7), 90.0);
    assert!((rate_hz(x) - 4.5).abs() < 1e-9, "{}", rate_hz(x));
}

/// With sync on, every voice's sequencer reads one transport, the first
/// key down restarts it, a gesture on the rate knob stays on the grid,
/// and sync off returns every sequencer to free-running at its own rate.
#[test]
fn sync_drives_every_voice_from_one_transport() {
    use auracle_grammar::steps::{rate_hz, SYNC_FREE};
    quiver::rng::seed(7);
    let (_, tree) = auracle_grammar::presets()
        .into_iter()
        .find(|(n, _)| *n == "Loom")
        .expect("Loom exists");
    let json = serde_json::to_string(&tree).unwrap();
    let mut p = LivePoly::new(&json, 44_100.0, 4).expect("compiles");
    assert_eq!(p.sync_lanes.len(), 1, "Loom has one sequencer");
    let lane = (p.sync_lanes[0].sync_slot, p.sync_lanes[0].rate_slot);
    let free = p.sync_lanes[0].free;
    p.set_arp(false, 0, 2.0, 120.0, 0.5, 1, 0.0);
    p.set_sync(true);
    p.process(128);
    p.note_on(60, 0.8);
    p.process(128);
    let at = |p: &LivePoly| -> Vec<f64> {
        p.param_slots[lane.0]
            .values
            .iter()
            .map(|v| v.get())
            .collect()
    };
    let first = at(&p);
    assert!(
        first.iter().all(|v| *v == first[0]),
        "voices disagree: {first:?}"
    );
    assert_eq!(first[0], 0.0, "the first key down restarts the transport");
    for _ in 0..100 {
        p.process(128);
    }
    let later = at(&p);
    let hz = rate_hz(snap_rate(free, 120.0));
    let want = 100.0 * 128.0 * hz / 44_100.0;
    assert!(
        later.iter().all(|v| (v - want).abs() < 1e-9),
        "{later:?} vs {want}"
    );
    // A drag of the rate knob moves the division, not off the grid.
    let rate_addr = p.param_slots[lane.1].addr.clone();
    assert!(p.set_param(&rate_addr, 0.93));
    let r = rate_hz(p.param_slots[lane.1].values[0].get());
    let beat = 2.0;
    assert!(
        SYNC_DIVISIONS.iter().any(|d| (r - beat * d).abs() < 1e-9),
        "{r} is off the grid"
    );
    p.set_sync(false);
    assert!(
        at(&p).iter().all(|v| *v == SYNC_FREE),
        "sync off must free-run"
    );
    assert!(
        (p.param_slots[lane.1].values[0].get() - 0.93).abs() < 1e-12,
        "free rate restored"
    );
}

/// A saw into a ladder lowpass, its cutoff at 0.5 and its resonance at 0.3:
/// the patch the touch tests wire velocity to.
fn ladder_json() -> String {
    use auracle_grammar::term::{AmpEnv, FilterKind, Waveform};
    use auracle_grammar::{AudioNode, ModNode, PatchTree};
    serde_json::to_string(&PatchTree {
        amp: AmpEnv {
            attack: 0.01,
            decay: 0.3,
            sustain: 0.8,
            release: 0.3,
        },
        root: AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::Ladder,
            cutoff: 0.5,
            resonance: 0.3,
            mod_depth: 0.0,
            input: Box::new(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Saw,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            }),
            modulation: ModNode::None,
        },
    })
    .unwrap()
}

/// What the voice sounding `note` holds at the knob `addr`, in the knob's
/// own units.
fn knob_on(poly: &LivePoly, note: u8, addr: &str) -> f64 {
    let v = poly
        .voices
        .iter()
        .find(|v| v.note == Some(note))
        .expect("voice");
    v.voice.params[addr].value.get()
}

/// Where the knob `addr` sits at the normalized value `x`, in its own units.
fn knob_at(poly: &LivePoly, addr: &str, x: f64) -> f64 {
    poly.voices[0].voice.params[addr].map.apply(x)
}

/// **Touch.** Velocity reaches timbre, per voice: two notes of one chord
/// at different velocities leave their own voices' wired knob at
/// different values, in the direction asked, and a mezzo note leaves it
/// exactly where the knob is, wherever the knob has moved to. Touch off is
/// off, however it was turned off: the next note plays the knob, on a voice
/// a note with touch on had offset (#223).
#[test]
fn velocity_touch_offsets_its_own_voice_only() {
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(&ladder_json(), 44_100.0, 4).unwrap();
    let wired = r#"[["node#cut", 0.3, 0.5]]"#;
    assert!(poly.set_touch(wired, 1.0));
    let cut = |poly: &LivePoly, note: u8| knob_on(poly, note, "node#cut");
    poly.note_on(60, 1.0);
    poly.note_on(64, 0.2);
    poly.note_on(67, TOUCH_MEZZO);
    let (loud, soft, mezzo) = (cut(&poly, 60), cut(&poly, 64), cut(&poly, 67));
    assert!(
        loud > mezzo && mezzo > soft,
        "loud {loud} mezzo {mezzo} soft {soft}"
    );
    let home = knob_at(&poly, "node#cut", 0.5);
    // Relative: velocity crosses an f32 on the way in (0.6 is not exact
    // there), and the cutoff map is exponential, so the leftover is a few
    // parts per million of the value rather than zero.
    assert!(
        (mezzo - home).abs() < 1e-5 * home.abs(),
        "mezzo moved the knob"
    );
    // Off is off: no offset on the next note, whether turned off by an
    // empty list, by a depth of zero or one that is not a number, or by
    // input that does not read (rather than half-applying it). Each time on
    // this one instrument, after a loud chord has left every voice bright,
    // so whichever voice the note takes, touch offset it (#223: the note
    // played that offset).
    for (off, depth) in [
        ("[]", 1.0),
        (wired, 0.0),
        (wired, f64::NAN),
        ("not json", 1.0),
    ] {
        assert!(poly.set_touch(wired, 1.0));
        poly.all_off();
        for n in [72, 74, 76, 77] {
            poly.note_on(n, 1.0);
        }
        assert!(
            poly.voices
                .iter()
                .all(|v| v.voice.params["node#cut"].value.get() > home),
            "the chord left a voice where the knob is"
        );
        poly.all_off();
        assert_eq!(poly.set_touch(off, depth), off != "not json");
        poly.note_on(79, 1.0);
        assert!((cut(&poly, 79) - home).abs() < 1e-9, "{off} at {depth}");
    }
    // The knob moves under touch (`set_touch_base`): a mezzo note plays
    // its new value. A base that is not a number, or a site past the list,
    // moves nothing.
    assert!(poly.set_touch(wired, 1.0));
    poly.set_touch_base(0, 0.7);
    poly.set_touch_base(0, f64::NAN);
    poly.set_touch_base(1, 0.1);
    poly.all_off();
    poly.note_on(60, TOUCH_MEZZO);
    let moved = knob_at(&poly, "node#cut", 0.7);
    assert!(
        (cut(&poly, 60) - moved).abs() < 1e-5 * moved.abs(),
        "the mezzo note is not on the moved knob"
    );
}

/// **Touch off under a held note.** A note held while velocity stops
/// playing a knob keeps the sound it was struck with until it is let go,
/// and every note struck after the change plays the knob: on the voice a
/// loud note left bright, and on the held note's own voice once it is let
/// go and taken again. Turning touch off moves nothing under a finger
/// (#223).
#[test]
fn a_note_held_through_touch_off_keeps_its_touch_until_let_go() {
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(&ladder_json(), 44_100.0, 2).unwrap();
    let cut = |poly: &LivePoly, note: u8| knob_on(poly, note, "node#cut");
    let voice = |poly: &LivePoly, note: u8| poly.voices.iter().position(|v| v.note == Some(note));
    let home = knob_at(&poly, "node#cut", 0.5);
    assert!(poly.set_touch(r#"[["node#cut", 0.3, 0.5]]"#, 1.0));
    poly.note_on(60, 0.2);
    poly.note_on(64, 1.0);
    poly.note_off(64);
    let dark = cut(&poly, 60);
    assert!(dark < home, "the held note is not dark");
    let held = voice(&poly, 60).expect("the held note's voice");
    assert!(poly.set_touch("[]", 1.0));
    for _ in 0..8 {
        let _ = poly.process(128);
    }
    assert_eq!(cut(&poly, 60), dark, "turning touch off moved a held note");
    // The voice the loud note rang out on.
    poly.note_on(67, 1.0);
    assert_ne!(voice(&poly, 67), Some(held));
    assert!(
        (cut(&poly, 67) - home).abs() < 1e-9,
        "the next note played the loud note's touch"
    );
    assert_eq!(cut(&poly, 60), dark, "a press moved the held note");
    poly.note_off(60);
    assert_eq!(
        poly.voices[held].voice.params["node#cut"].value.get(),
        dark,
        "letting go moved its tail"
    );
    // The held note's own voice, taken again.
    poly.note_on(72, 0.2);
    assert_eq!(voice(&poly, 72), Some(held));
    assert!(
        (cut(&poly, 72) - home).abs() < 1e-9,
        "the voice kept the held note's touch"
    );
}

/// **Touch off in unison.** A unison note strikes every voice, so after
/// touch goes off the next one plays the knob on all of them (#223: each
/// kept the soft note's dark).
#[test]
fn touch_off_in_unison_puts_back_every_voice() {
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(&ladder_json(), 44_100.0, 4).unwrap();
    let home = knob_at(&poly, "node#cut", 0.5);
    let cuts = |poly: &LivePoly| -> Vec<f64> {
        poly.voices
            .iter()
            .map(|v| v.voice.params["node#cut"].value.get())
            .collect()
    };
    poly.set_unison(true, 0.5, 0.5);
    assert!(poly.set_touch(r#"[["node#cut", 0.3, 0.5]]"#, 1.0));
    poly.note_on(48, 0.1);
    assert!(
        cuts(&poly).iter().all(|c| *c < home),
        "the stack is not dark"
    );
    poly.note_off(48);
    assert!(poly.set_touch("[]", 1.0));
    poly.note_on(50, 0.1);
    assert!(
        cuts(&poly).iter().all(|c| (c - home).abs() < 1e-9),
        "{:?} is not the knob",
        cuts(&poly)
    );
}

/// **Touch moved to another control.** Switching what velocity plays from
/// one knob to another puts the first back on the next note while the
/// second takes the touch; switched back, the second plays where it has
/// been turned to since, not where touch left it (#223: a knob touch let
/// go of stayed where the last note on its voice had put it).
#[test]
fn switching_what_touch_plays_puts_the_first_knob_back() {
    quiver::rng::seed(7);
    // One voice: every note is on the voice touch offset.
    let mut poly = LivePoly::new(&ladder_json(), 44_100.0, 1).unwrap();
    let (cut, res) = ("node#cut", "node#res");
    let home_cut = knob_at(&poly, cut, 0.5);
    let home_res = knob_at(&poly, res, 0.3);
    let to_cut = r#"[["node#cut", 0.3, 0.5]]"#;
    assert!(poly.set_touch(to_cut, 1.0));
    poly.note_on(60, 0.2);
    assert!(
        knob_on(&poly, 60, cut) < home_cut,
        "touch did not reach cut"
    );
    poly.note_off(60);
    assert!(poly.set_touch(r#"[["node#res", 0.3, 0.3]]"#, 1.0));
    poly.note_on(62, 0.2);
    assert!(
        (knob_on(&poly, 62, cut) - home_cut).abs() < 1e-9,
        "cut kept the touch it was switched away from"
    );
    assert!(
        knob_on(&poly, 62, res) < home_res,
        "touch did not reach res"
    );
    poly.note_off(62);
    // Res turned, then touch back on cut: the next note plays res where
    // it was turned to.
    assert!(poly.set_param(res, 0.6));
    for _ in 0..200 {
        if poly.smoothers.is_empty() {
            break;
        }
        let _ = poly.process(128);
    }
    assert!(poly.smoothers.is_empty(), "the turn never landed");
    assert!(poly.set_touch(to_cut, 1.0));
    poly.note_on(64, 0.2);
    let turned = knob_at(&poly, res, 0.6);
    assert!(
        (knob_on(&poly, 64, res) - turned).abs() < 1e-9,
        "res is not where it was turned"
    );
    assert!(
        knob_on(&poly, 64, cut) < home_cut,
        "touch did not reach cut"
    );
}

/// **The envelope carry.** Swapping the patch under a held pad used to
/// re-press every held note on the new voices, which restarts their ADSRs
/// from zero — so every structural edit made the pad swell in again from
/// nothing, and the edit was audible as an event of its own rather than as
/// a change to the sound.
///
/// The patch swapped in here is the *same* tree, so the only thing that can
/// move the level is the envelope. 23 ms of silence across the rebuild is
/// expected and accepted (R3); coming back at a fraction of the level is
/// not.
#[test]
fn a_held_pad_keeps_its_envelope_across_a_patch_swap() {
    quiver::rng::seed(7);
    let json = pad_json();
    let mut poly = LivePoly::new(&json, 44_100.0, 4).unwrap();
    poly.note_on(60, 1.0);
    // ~1.2 s: past a 100 ms attack and its decay, sitting on sustain. The
    // level is measured over 16 quanta, not one — a saw at 262 Hz does not
    // fit a whole number of periods into 128 frames, so a single quantum's
    // energy swings ±40% for reasons that have nothing to do with an
    // envelope.
    let mut warm: Vec<f64> = Vec::new();
    for _ in 0..400 {
        warm.push(energy(&poly.process(128)));
    }
    let mean = |w: &[f64]| w.iter().sum::<f64>() / w.len() as f64;
    let before = mean(&warm[384..]);
    assert!(before > 1.0e-4, "the pad never spoke: {before}");

    assert!(poly.set_patch(&json));
    let mut after: Vec<f64> = Vec::new();
    let mut patched_at = None;
    for i in 0..200 {
        let e = energy(&poly.process(128));
        after.push(e);
        if poly.poll_event() == EVENT_PATCHED && patched_at.is_none() {
            patched_at = Some(i);
        }
    }
    let at: usize = patched_at.expect("swap never completed");
    // Four quanta past the swap the ~6 ms fade-in is over. Without the
    // carry the envelope is ~12 ms into a 100 ms exponential attack —
    // about a tenth of the level it left with, climbing.
    let resumed = mean(&after[at + 4..at + 20]);
    assert!(
        resumed > before * 0.85,
        "the pad re-attacked: {resumed:.3e} against {before:.3e} before the \
         swap ({:.1}% of it)",
        100.0 * resumed / before
    );
    // …and it does not overshoot either, which is what parking a
    // mid-envelope note on the sustain shelf would look like from here.
    assert!(
        mean(&after[at + 4..at + 20]) < before * 1.15,
        "the level jumped after the swap: {resumed:.3e} against {before:.3e}"
    );
}

/// A held pad, on four voices with the leveler off, past its attack: the
/// level a swap's tests measure against.
fn steady_pad(makeup: f64) -> LivePoly {
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(&pad_json(), 44_100.0, 4).unwrap();
    poly.set_leveler(false);
    poly.set_makeup(makeup);
    poly.note_on(60, 1.0);
    for _ in 0..400 {
        let _ = poly.process(128);
    }
    poly
}

/// The loudest sample over the next `quanta` quanta, and how many of them
/// ended a swap (`EVENT_PATCHED`) or failed one (`EVENT_PATCH_ERROR`).
fn swap_quanta(poly: &mut LivePoly, quanta: usize) -> (f32, usize, usize) {
    let (mut loud, mut patched, mut failed) = (0.0f32, 0, 0);
    for _ in 0..quanta {
        loud = loud.max(peak(&poly.process(128)));
        match poly.poll_event() {
            EVENT_PATCHED => patched += 1,
            EVENT_PATCH_ERROR => failed += 1,
            _ => {}
        }
    }
    (loud, patched, failed)
}

/// **A patch that does not compile keeps the voices playing.** It parses,
/// so `set_patch` takes it and the swap fades out; the rebuild fails, says
/// why (`EVENT_PATCH_ERROR`, `last_error`), and fades the old voices back
/// in, the held note at the level it had, and the makeup sent with the
/// failed patch is dropped with it.
#[test]
fn a_patch_that_does_not_compile_keeps_the_voices_playing() {
    quiver::rng::seed(7);
    let mut poly = steady_pad(0.5);
    let (before, _, _) = swap_quanta(&mut poly, 16);
    assert_eq!(poly.last_error(), "", "no error before one");
    let deep = serde_json::to_string(&crate::tests::too_deep()).unwrap();
    assert!(poly.set_patch(&deep), "it parses, so the swap begins");
    poly.set_makeup(1.0);
    let (_, patched, failed) = swap_quanta(&mut poly, 60);
    assert_eq!((patched, failed), (0, 1), "one failed swap");
    assert!(
        poly.last_error().contains("nests"),
        "the reason is the compiler's: {}",
        poly.last_error()
    );
    let (after, _, _) = swap_quanta(&mut poly, 16);
    assert!(
        (after - before).abs() < before * 0.05,
        "the old voices came back at {after} against {before}, at the old makeup"
    );
}

/// **An instrument that cannot be built says why**, as the host shows it
/// (`String(err)`): text that is not a patch, and a patch the compiler
/// refuses. Natively the reason is the same `String`.
#[test]
fn an_instrument_that_cannot_be_built_says_why() {
    quiver::rng::seed(7);
    let unread = LivePoly::new("not json", 44_100.0, 4).err().unwrap();
    assert!(unread.contains("expected"), "serde's reason: {unread}");
    let deep = serde_json::to_string(&crate::tests::too_deep()).unwrap();
    let refused = LivePoly::new(&deep, 44_100.0, 4).err().unwrap();
    assert!(
        refused.contains("nests"),
        "the compiler's reason: {refused}"
    );
}

/// **Rapid swaps coalesce.** A swap sent while the last one is rebuilding
/// restarts the rebuild with the newer patch: one swap lands, and it is the
/// newest (its filter's cutoff is a live knob; the pad has none).
#[test]
fn a_swap_sent_during_a_rebuild_lands_instead_of_it() {
    quiver::rng::seed(7);
    let mut poly = steady_pad(0.5);
    assert!(!poly.set_param("node#cut", 0.5), "the pad has no filter");
    assert!(poly.set_patch(&pad_json()));
    // Into the rebuild's silence: four voices take four quanta.
    let mut quanta = 0;
    while peak(&poly.process(128)) > 0.0 {
        quanta += 1;
        assert!(quanta < 60, "the swap never fell silent");
    }
    assert_eq!(poly.poll_event(), EVENT_NONE, "one voice of four is built");
    assert!(poly.set_patch(&plucked_json()));
    let (_, patched, failed) = swap_quanta(&mut poly, 60);
    assert_eq!((patched, failed), (1, 0), "one swap landed");
    assert!(poly.set_param("node#cut", 0.5), "the newest patch landed");
}

/// **A makeup sent with a swap waits for it.** The outgoing patch fades out
/// at its own level, and the new one plays at the new makeup.
#[test]
fn a_makeup_sent_with_a_swap_waits_for_it() {
    quiver::rng::seed(7);
    let mut poly = steady_pad(0.25);
    let (before, _, _) = swap_quanta(&mut poly, 16);
    assert!(poly.set_patch(&pad_json()));
    poly.set_makeup(0.5);
    let fading = peak(&poly.process(128));
    assert!(
        fading <= before * 1.01,
        "the outgoing patch was heard at the new makeup: {fading} against {before}"
    );
    let (_, patched, _) = swap_quanta(&mut poly, 60);
    assert_eq!(patched, 1);
    let (after, _, _) = swap_quanta(&mut poly, 16);
    assert!(
        (after / before - 2.0).abs() < 0.1,
        "the new patch plays at twice the makeup: {after} against {before}"
    );
}

/// Below sustain the envelope is unambiguously still in Attack, and the
/// seeder has to leave it there rather than parking it on the sustain
/// shelf: a note swapped 30 ms into a 1 s attack must keep rising.
#[test]
fn a_mid_attack_note_resumes_its_attack_rather_than_jumping_to_sustain() {
    use auracle_grammar::term::{AmpEnv, Waveform};
    use auracle_grammar::{AudioNode, ModNode, PatchTree};
    quiver::rng::seed(7);
    let json = serde_json::to_string(&PatchTree {
        amp: AmpEnv {
            attack: 0.75, // ≈1 s
            decay: 0.3,
            sustain: 1.0,
            release: 0.4,
        },
        root: AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Saw,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
        },
    })
    .unwrap();
    let mut poly = LivePoly::new(&json, 44_100.0, 4).unwrap();
    poly.note_on(60, 1.0);
    for _ in 0..20 {
        let _ = poly.process(128);
    }
    let phase_before = poly.voices[0].voice.env_phase();
    assert!(
        phase_before > 0.01 && phase_before < 0.3,
        "the probe note is not mid-attack: {phase_before}"
    );

    assert!(poly.set_patch(&json));
    let mut patched = false;
    for _ in 0..60 {
        let _ = poly.process(128);
        patched |= poly.poll_event() == EVENT_PATCHED;
    }
    assert!(patched, "swap never completed");
    let phase_after = poly.voices[0].voice.env_phase();
    assert!(
        phase_after > phase_before * 0.8 && phase_after < 0.5,
        "a mid-attack note came back at {phase_after} from {phase_before} — \
         either restarted or parked on the sustain shelf"
    );
    // It is still climbing, which is the half a level check cannot see.
    for _ in 0..60 {
        let _ = poly.process(128);
    }
    assert!(
        poly.voices[0].voice.env_phase() > phase_after * 1.2,
        "the envelope stopped rising after the swap"
    );
}

/// The two categorical sites that went live are reachable through the live
/// path at their *own* domain — an index, not a 0..1 knob — and neither
/// forces a recompile: the note never falls into a swap's silence, and no
/// swap is reported.
#[test]
fn table_and_oct_are_live_at_index_scale() {
    use auracle_grammar::term::{AmpEnv, TableShape, Waveform};
    use auracle_grammar::{AudioNode, ModNode, PatchTree};
    quiver::rng::seed(7);
    let tree = |root| PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 1.0,
            release: 0.3,
        },
        root,
    };
    let wt = serde_json::to_string(&tree(AudioNode::Wavetable {
        uid: Uid::NEW,
        table: TableShape::Sine,
        octave: 0,
        morph: 0.0,
        mod_depth: 0.0,
        modulation: ModNode::None,
    }))
    .unwrap();
    let mut poly = LivePoly::new(&wt, 44_100.0, 1).unwrap();
    poly.note_on(60, 1.0);
    for _ in 0..40 {
        let _ = poly.process(128);
    }
    // Table 7 is the last of eight; the old blanket clamp to 0..1 would
    // have written table 1.
    assert!(poly.set_param("node#table", 7.0), "`table` has no handle");
    // No swap: a swap would fade to a silent rebuild and say it patched.
    let unswapped = |poly: &mut LivePoly, quanta: usize| {
        for q in 0..quanta {
            assert!(peak(&poly.process(128)) > 0.0, "quantum {q} fell silent");
            assert_eq!(poly.poll_event(), EVENT_NONE, "a live index write swapped");
        }
    };
    unswapped(&mut poly, 40);
    let cv = poly.voices[0].voice.params["node#table"].value.get();
    assert!(
        (cv - 1.0).abs() < 1.0e-3,
        "table 7 should land on cv 1.0, not {cv}"
    );

    let vco = serde_json::to_string(&tree(AudioNode::Vco {
        uid: Uid::NEW,
        wave: Waveform::Saw,
        octave: 0,
        detune: 0.5,
        mod_depth: 0.0,
        modulation: ModNode::None,
    }))
    .unwrap();
    let mut poly = LivePoly::new(&vco, 44_100.0, 1).unwrap();
    poly.note_on(60, 1.0);
    for _ in 0..40 {
        let _ = poly.process(128);
    }
    // Index 4 is +2 octaves; the compiled octave is 0, so the trim is +2.
    assert!(poly.set_param("node#oct", 4.0), "`oct` has no handle");
    unswapped(&mut poly, 60);
    let cv = poly.voices[0].voice.params["node#oct"].value.get();
    assert!(
        (cv - 2.0).abs() < 1.0e-3,
        "oct +2 should land on a 2 V trim, not {cv}"
    );
}

/// "First Bass": the sustained preset the velocity and arp tests play.
fn first_bass() -> String {
    let (_, tree) = auracle_grammar::presets()
        .into_iter()
        .find(|(n, _)| *n == "First Bass")
        .expect("preset exists");
    serde_json::to_string(&tree).unwrap()
}

/// Velocity scales the level: the same note played soft is quieter than
/// played hard.
#[test]
fn velocity_scales_the_level() {
    quiver::rng::seed(7);
    let json = first_bass();
    let energy_at = |vel: f64| {
        let mut p = LivePoly::new(&json, 44_100.0, 1).unwrap();
        p.note_on(60, vel);
        (0..20).map(|_| energy(&p.process(512))).sum::<f64>()
    };
    let (soft, hard) = (energy_at(0.15), energy_at(1.0));
    assert!(
        soft < hard * 0.5,
        "velocity had no effect: soft {soft}, hard {hard}"
    );
}

/// The arpeggiator steps through a held chord on its own clock, one gated
/// note at a time, and turning it off presses the held chord again.
#[test]
fn the_arp_cycles_a_held_chord_and_off_re_presses_it() {
    quiver::rng::seed(7);
    let json = first_bass();
    let mut p = LivePoly::new(&json, 44_100.0, 4).unwrap();
    p.set_arp(true, 0, 4.0, 240.0, 0.5, 1, 0.0); // 16ths at 240 BPM ≈ 16 steps/s
    p.note_on(48, 1.0);
    p.note_on(52, 1.0);
    p.note_on(55, 1.0);
    let mut seen = std::collections::HashSet::new();
    for _ in 0..400 {
        let out = p.process(128);
        assert!(out.iter().all(|s| s.is_finite()));
        for v in &p.voices {
            if let Some(n) = v.note {
                seen.insert(n);
            }
        }
        // At any instant the arp holds at most one gated note.
        let gated = p.voices.iter().filter(|v| v.note.is_some()).count();
        assert!(gated <= 1, "arp gated {gated} notes at once");
    }
    assert!(
        seen.len() >= 3,
        "arp never cycled the chord: pressed {seen:?}"
    );
    p.set_arp(false, 0, 4.0, 240.0, 0.5, 1, 0.0);
    let mut gated: Vec<_> = p.voices.iter().filter_map(|v| v.note).collect();
    gated.sort_unstable();
    assert_eq!(
        gated,
        vec![48, 52, 55],
        "chord not re-pressed after arp off"
    );
}

/// The master bus holds a full chord inside full scale. Four voices sum to
/// ~4× one voice, and before the master limiter existed a four-note chord
/// sat exactly on the rail — hard-clipped, and clipped again by the device
/// conversion because the old ceiling was above 1.0.
#[test]
fn chord_never_exceeds_full_scale() {
    quiver::rng::seed(7);
    let mut rng = StdRng::seed_from_u64(0xC401);
    for i in 0..8 {
        let json = tree_json(&mut rng);
        let mut poly = LivePoly::new(&json, 44_100.0, 4).unwrap();
        for n in [48, 55, 60, 64] {
            poly.note_on(n, 1.0);
        }
        let mut hottest = 0.0f32;
        for _ in 0..60 {
            let out = poly.process(512);
            assert!(out.iter().all(|s| s.is_finite()), "patch {i}: non-finite");
            hottest = hottest.max(peak(&out));
        }
        assert!(
            hottest <= 1.0,
            "patch {i}: four-note chord peaked at {hottest}"
        );
        // And it is limited, not clipped: the brickwall lands on the
        // ceiling, so nothing should be sitting above it.
        assert!(
            hottest <= MASTER_CEILING + 1e-6,
            "patch {i}: output ran past the ceiling into the clamp ({hottest})"
        );
    }
}

/// A stolen voice retriggers its amp envelope. On a percussive patch the
/// voice is silent at sustain 0 by the time it is stolen, so the second note
/// on a one-voice instrument is *only* audible if the ADSR sees a real
/// falling-then-rising gate edge.
#[test]
fn stolen_voice_retriggers_its_envelope() {
    quiver::rng::seed(7);
    let json = plucked_json();
    let mut poly = LivePoly::new(&json, 44_100.0, 1).unwrap();
    poly.note_on(60, 1.0);
    // Run past the decay: the note has fallen to sustain 0 and is silent
    // even though its gate is still high.
    for _ in 0..40 {
        let _ = poly.process(512);
    }
    let decayed = energy(&poly.process(4096));
    // Steal the (still-held) voice with a new note.
    poly.note_on(67, 1.0);
    let after_steal = energy(&poly.process(4096));
    assert!(
        after_steal > decayed * 100.0 && after_steal > 1e-4,
        "stolen voice did not retrigger: {decayed:.3e} decayed vs \
         {after_steal:.3e} after the steal"
    );
}

/// The arp over two held keys for `quanta` quanta at `bpm` and `div` steps
/// a beat: the sample each step was heard to start at (the end of the
/// quantum its note went on in), and the share of quanta a note sounded.
fn arp_run(
    json: &str,
    div: f64,
    bpm: f64,
    gate: f64,
    swing: f64,
    quanta: usize,
) -> (Vec<f64>, f64) {
    let mut p = LivePoly::new(json, 44_100.0, 4).unwrap();
    p.set_arp(true, 0, div, bpm, gate, 1, swing);
    p.note_on(48, 1.0);
    p.note_on(52, 1.0);
    let (mut starts, mut on) = (Vec::new(), 0);
    let mut prev = None;
    for q in 0..quanta {
        let _ = p.process(128);
        if p.arp_note.is_some() {
            on += 1;
            if prev.is_none() {
                starts.push((q * 128) as f64);
            }
        }
        prev = p.arp_note;
    }
    (starts, on as f64 / quanta as f64)
}

/// The arp's controls each do their documented thing, and the arp keeps
/// time. An octave range reaches pitches nobody is holding. A short gate
/// shortens the note without moving the step clock: the steps start where
/// a long gate's do. Straight 16ths at 120 BPM start every 5512.5 samples,
/// each within the quantum it falls in, after 27 steps as after one: a step
/// that dropped its overshoot past the block boundary ran 2.2% slow, a
/// whole step behind in under six seconds. Swing makes consecutive steps
/// unequal.
#[test]
fn arp_gate_octaves_and_swing() {
    quiver::rng::seed(7);
    let json = plucked_json();
    // Octave range: hold one key, span three octaves, collect the pitches
    // the scheduler actually presses.
    let mut p = LivePoly::new(&json, 44_100.0, 4).unwrap();
    p.set_arp(true, 0, 4.0, 240.0, 0.5, 3, 0.0);
    p.note_on(48, 1.0);
    let mut seen = std::collections::HashSet::new();
    for _ in 0..400 {
        let _ = p.process(128);
        if let Some(n) = p.arp_note {
            seen.insert(n);
        }
    }
    assert_eq!(
        seen,
        [48u8, 60, 72].into_iter().collect(),
        "octave range did not transpose the pattern: {seen:?}"
    );

    // Gate length: staccato sounds for a smaller share of the step than
    // legato, on the same step clock.
    let (short_starts, staccato) = arp_run(&json, 2.0, 120.0, 0.1, 0.0, 600);
    let (long_starts, legato) = arp_run(&json, 2.0, 120.0, 0.9, 0.0, 600);
    assert!(
        staccato < legato * 0.5,
        "gate length had no effect: {staccato:.2} staccato vs {legato:.2} legato"
    );
    assert_eq!(short_starts, long_starts, "the gate moved the step clock");

    // The clock: straight 16ths at 120 BPM, 5512.5 samples a step.
    let (straight, _) = arp_run(&json, 4.0, 120.0, 0.5, 0.0, 1200);
    assert!(straight.len() > 25, "arp never stepped: {straight:?}");
    for (k, t) in straight.iter().enumerate() {
        let due = straight[0] + k as f64 * 5512.5;
        assert!(
            (0.0..128.0).contains(&(t - due)),
            "step {k} started at {t}, due at {due}"
        );
    }

    // Swing: the sample distance between consecutive note-ons.
    let gaps = |starts: &[f64]| -> Vec<f64> { starts.windows(2).map(|w| w[1] - w[0]).collect() };
    let swung = gaps(&arp_run(&json, 4.0, 120.0, 0.5, 0.6, 1200).0);
    let spread = |g: &[f64]| {
        g.iter().cloned().fold(f64::MIN, f64::max) - g.iter().cloned().fold(f64::MAX, f64::min)
    };
    assert!(swung.len() > 3, "arp never stepped");
    assert!(
        spread(&swung) > spread(&gaps(&straight)) + 2000.0,
        "swing did not stagger the steps: straight {straight:?}, swung {swung:?}"
    );
}

/// Unison detune reaches supersaw width (±60 cents at full travel) and
/// spreads the voices non-uniformly.
#[test]
fn unison_detune_is_wide_and_non_uniform() {
    quiver::rng::seed(7);
    let json = plucked_json();
    let mut p = LivePoly::new(&json, 44_100.0, 4).unwrap();
    p.set_unison(true, 1.0, 0.5);
    p.note_on(60, 1.0);
    let mut cents: Vec<f64> = p.voices.iter().map(|v| v.pitch_tgt * 1200.0).collect();
    cents.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert!(
        (cents[0] + 60.0).abs() < 1.0 && (cents[3] - 60.0).abs() < 1.0,
        "unison spread is not ±60 cents: {cents:?}"
    );
    // Non-uniform: the inner pair sits far closer to centre than an even
    // split across four voices (±20 c) would put it.
    assert!(
        cents[1].abs() < 15.0,
        "detune curve is still linear: {cents:?}"
    );
}

/// Chaos: random notes, knob writes (real and junk addresses), patch swaps
/// (to patches that listen and track too), and every other call the
/// worklet makes on the render thread (sync, the transport, touch, the
/// meter, the open voice, RECORD's gate, the input written and cleared),
/// with garbage among the arguments — output must stay finite forever, no
/// panics. A panic in any of them poisons the worklet's `LivePoly`.
#[test]
fn live_stress_survives_chaos() {
    quiver::rng::seed(7);
    let mut rng = StdRng::seed_from_u64(0xC405);
    let mut poly = LivePoly::new(&tree_json(&mut rng), 44_100.0, 4).unwrap();
    let sites = [
        "node#cut",
        "node#res",
        "node#fb",
        "node#time",
        "amp#attack",
        "amp#sustain",
        "node/0#cut",
        "node/0/1#bal",
        "bogus#x",
        "",
    ];
    let patches = [input_patch(), tracked_patch(), capture_patch()];
    for i in 0..600 {
        match rng.gen_range(0..18) {
            0 | 1 => poly.note_on(rng.gen_range(36..85), rng.gen_range(0.0..1.2)),
            2 => poly.note_off(rng.gen_range(36..85)),
            3 => {
                let _ = poly.set_param(
                    sites[rng.gen_range(0..sites.len())],
                    rng.gen_range(-1.0..2.0),
                );
            }
            4 if i % 37 == 0 => {
                let _ = poly.set_patch(&tree_json(&mut rng));
            }
            4 if i % 41 == 0 => {
                let _ = poly.set_patch(&patches[rng.gen_range(0..patches.len())]);
            }
            5 if i % 97 == 0 => poly.all_off(),
            6 => poly.set_bend(rng.gen_range(-30.0..30.0)),
            7 if i % 11 == 0 => poly.set_arp(
                rng.gen_bool(0.5),
                rng.gen_range(0..5),
                rng.gen_range(0.25..9.0),
                rng.gen_range(20.0..400.0),
                rng.gen_range(-0.5..1.5),
                rng.gen_range(0..7),
                rng.gen_range(-0.5..1.5),
            ),
            8 if i % 13 == 0 => {
                poly.set_unison(rng.gen_bool(0.5), rng.gen(), rng.gen());
                poly.set_glide(rng.gen_range(-0.5..1.5));
                poly.set_makeup(rng.gen_range(0.0..10.0));
            }
            9 => poly.set_sync(rng.gen_bool(0.5)),
            10 => poly.set_transport_beats(rng.gen_range(-8.0..64.0)),
            11 if i % 7 == 0 => poly.restart_transport(),
            12 => {
                let site = sites[rng.gen_range(0..sites.len())];
                let json = format!(
                    "[[\"{site}\", {}, {}]]",
                    rng.gen_range(-1.0..1.0),
                    rng.gen::<f64>()
                );
                let _ = poly.set_touch(&json, rng.gen_range(-0.5..1.5));
                poly.set_touch_base(rng.gen_range(0..3), rng.gen_range(-1.0..2.0));
            }
            13 => {
                let _ = poly.set_meter(rng.gen_bool(0.5));
            }
            14 => poly.set_open(rng.gen_bool(0.5)),
            15 => {
                let _ = poly.set_record("node", rng.gen_bool(0.5));
            }
            16 if i % 5 == 0 => poly.clear_input(),
            17 => poly.set_leveler(rng.gen_bool(0.5)),
            _ => {}
        }
        // The worklet writes the input before every quantum, any channel
        // count it is handed.
        let frames = rng.gen_range(0..=poly.input_capacity() + 64);
        let at = poly.input_ptr();
        let buf = unsafe { std::slice::from_raw_parts_mut(at, LIVE_INPUT_FRAMES * 2) };
        for x in buf.iter_mut() {
            *x = rng.gen_range(-1.0..1.0);
        }
        poly.write_input(frames, rng.gen_range(0..4));
        // A third of the quanta rested, as B rests at a mix of 0, in runs:
        // a wake is started, cut short and started again.
        if i % 9 < 3 {
            poly.rest(128);
        } else {
            let out = poly.process(128);
            assert!(
                out.iter().all(|s| s.is_finite() && s.abs() <= 1.5),
                "iteration {i}: bad sample"
            );
        }
        let _ = poly.poll_event();
    }
    // On whatever patch the chaos ended on, touch on every live knob and a
    // note on each voice at a velocity of its own, so every voice carries an
    // offset of its own; then touch off. Every note struck after it starts
    // from the knobs: with one on each voice again, every voice (and the
    // open voice, which touch never reaches) holds the same value at every
    // knob (#223: each kept the offset its last note had).
    poly.set_arp(false, 0, 2.0, 120.0, 0.5, 1, 0.0);
    poly.set_unison(false, 0.0, 0.0);
    poly.all_off();
    for _ in 0..400 {
        if matches!(poly.stage, Stage::Run) && !poly.resting() {
            break;
        }
        let _ = poly.process(128);
    }
    assert!(
        matches!(poly.stage, Stage::Run),
        "the last swap never landed"
    );
    assert!(!poly.resting(), "the last wake never ended");
    let n = poly.voices.len();
    let every: Vec<(&str, f64, f64)> = poly
        .param_slots
        .iter()
        .map(|p| (p.addr.as_str(), 0.4, 0.5))
        .collect();
    assert!(poly.set_touch(&serde_json::to_string(&every).unwrap(), 1.0));
    for (k, note) in (0..n).zip(40u8..) {
        poly.note_on(note, k as f64 / n as f64);
    }
    poly.all_off();
    assert!(poly.set_touch("[]", 1.0));
    for (k, note) in (0..n).zip(60u8..) {
        poly.note_on(note, k as f64 / n as f64);
    }
    assert!(
        poly.voices.iter().all(|v| v.note.is_some()),
        "a voice unstruck"
    );
    for p in &poly.param_slots {
        let knob = p.values[0].get();
        assert!(
            p.values.iter().all(|v| v.get() == knob),
            "{} differs between voices",
            p.addr
        );
    }
}

/// Glide has to be audible on the thing portamento is *for*: a melody.
/// Voice assignment prefers a free voice, so a line rotates through voices
/// that were never sounding — with per-voice-only portamento every note of
/// a tune started dead on pitch and the fader did nothing you could hear.
#[test]
fn glide_slides_a_line_but_not_a_chord() {
    quiver::rng::seed(7);
    let json = plucked_json();

    // A line: press, release, press. The second note starts an octave
    // below its target and slides up.
    let mut p = LivePoly::new(&json, 44_100.0, 4).unwrap();
    p.set_glide(0.5);
    p.note_on(60, 1.0);
    let _ = p.process(256);
    p.note_off(60);
    let _ = p.process(256);
    p.note_on(72, 1.0);
    let v = p.voices.iter().find(|v| v.note == Some(72)).unwrap();
    assert!(
        (v.pitch_tgt - 1.0).abs() < 1.0e-9,
        "second note should target C6: {}",
        v.pitch_tgt
    );
    assert!(
        v.pitch_cur < 0.1,
        "second note of a line must start back at the first note, not on \
         pitch (pitch_cur={})",
        v.pitch_cur
    );

    // ...and it actually arrives.
    let _ = p.process(44_100 * 4);
    let v = p.voices.iter().find(|v| v.note == Some(72)).unwrap();
    assert!(
        (v.pitch_cur - 1.0).abs() < 1.0e-3,
        "glide never reached its target: {}",
        v.pitch_cur
    );

    // A chord: the second note is pressed while the first is still held,
    // so it speaks on pitch. Portamento must not scramble a chord.
    let mut q = LivePoly::new(&json, 44_100.0, 4).unwrap();
    q.set_glide(0.5);
    q.note_on(60, 1.0);
    let _ = q.process(64);
    q.note_on(64, 1.0);
    let v = q.voices.iter().find(|v| v.note == Some(64)).unwrap();
    assert!(
        (v.pitch_cur - v.pitch_tgt).abs() < 1.0e-9,
        "a chord tone must start on pitch: cur={} tgt={}",
        v.pitch_cur,
        v.pitch_tgt
    );

    // The very first note of the session has nothing to glide from.
    let mut r = LivePoly::new(&json, 44_100.0, 4).unwrap();
    r.set_glide(1.0);
    r.note_on(48, 1.0);
    let v = r.voices.iter().find(|v| v.note == Some(48)).unwrap();
    assert!(
        (v.pitch_cur - v.pitch_tgt).abs() < 1.0e-9,
        "the first note ever played swooped in from C4: {}",
        v.pitch_cur
    );

    // Glide off: nothing slides, however the line is played.
    let mut o = LivePoly::new(&json, 44_100.0, 4).unwrap();
    o.note_on(60, 1.0);
    let _ = o.process(256);
    o.note_off(60);
    let _ = o.process(256);
    o.note_on(72, 1.0);
    let v = o.voices.iter().find(|v| v.note == Some(72)).unwrap();
    assert!(
        (v.pitch_cur - v.pitch_tgt).abs() < 1.0e-9,
        "glide is off; this must start on pitch: {}",
        v.pitch_cur
    );
}

/// The meter reads a real level off each interior port, and reads the
/// mixer's two branches *apart* from the mix.
///
/// A crossfader at balance 0 passes branch `a` and mutes branch `b`. Here
/// `a` is a saw and `b` the same saw through a lowpass far under its
/// fundamental, so the three taps carry three levels: the mix is `a`'s, and
/// `b` is well under both. A meter that copied one port's level into every
/// tap, or read the mix for its branches, fails. Read as the worklet reads
/// it, through `meter_ptr` and `meter_len`.
#[test]
fn meter_reads_levels_off_interior_ports() {
    use auracle_grammar::term::{AmpEnv, FilterKind, Waveform};
    use auracle_grammar::{AudioNode, ModNode, PatchTree};
    quiver::rng::seed(7);
    let saw = || AudioNode::Vco {
        uid: Uid::NEW,
        wave: Waveform::Saw,
        octave: 0,
        detune: 0.5,
        mod_depth: 0.0,
        modulation: ModNode::None,
    };
    let json = serde_json::to_string(&PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 1.0,
            release: 0.3,
        },
        root: AudioNode::Mix {
            uid: Uid::NEW,
            balance: 0.0, // hard over to `a`
            a: Box::new(saw()),
            b: Box::new(AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::SvfLp,
                cutoff: 0.0,
                resonance: 0.1,
                mod_depth: 0.0,
                input: Box::new(saw()),
                modulation: ModNode::None,
            }),
        },
    })
    .unwrap();

    let mut poly = LivePoly::new(&json, 44_100.0, 4).expect("compiles");
    assert_eq!(poly.meter_len(), 0, "metering must be off until asked for");

    let n = poly.set_meter(true);
    assert_eq!(n, 4, "one tap per term node");
    assert_eq!(poly.meter_len(), n);
    let keys: Vec<String> = serde_json::from_str(&poly.meter_keys()).unwrap();
    assert_eq!(keys, vec!["node", "node/0", "node/1", "node/1/0"]);

    poly.note_on(60, 1.0);
    // Long enough for the 128-sample level buffers to fill several times.
    for _ in 0..16 {
        let _ = poly.process(512);
    }
    // The worklet's view of wasm memory.
    let db = unsafe { std::slice::from_raw_parts(poly.meter_ptr(), poly.meter_len()) };
    let level = |k: &str| db[keys.iter().position(|key| key == k).unwrap()];
    assert!(db.iter().all(|d| d.is_finite()), "levels: {db:?}");
    let (mix, a, b) = (level("node"), level("node/0"), level("node/1"));
    assert!(
        (mix - a).abs() < 1.0,
        "the mix is `a`'s: {mix} against {a} dB"
    );
    assert!(
        mix - b > 6.0,
        "`b` reads apart, under the mix: {b} against {mix} dB"
    );
    assert!(
        level("node/1/0") - b > 6.0,
        "the filter reads under its own input"
    );

    // Off again clears the subscriptions and the buffer with them.
    assert_eq!(poly.set_meter(false), 0);
    assert_eq!(poly.meter_len(), 0);
}

/// `plucked_json`'s saw → lowpass at full sustain: a held note settles at
/// one level and stays there.
fn sustained_json() -> String {
    let mut tree: PatchTree = serde_json::from_str(&plucked_json()).unwrap();
    tree.amp.sustain = 0.999;
    serde_json::to_string(&tree).unwrap()
}

/// Hold C4 on a fresh four-voice instrument for `secs`; the mono mix.
fn held(json: &str, makeup: f64, leveler: bool, secs: f64) -> Vec<f64> {
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(json, 44_100.0, 4).expect("compiles");
    poly.set_leveler(leveler);
    poly.set_makeup(makeup);
    poly.note_on(60, 1.0);
    let quanta = (secs * 44_100.0 / 128.0) as usize;
    (0..quanta)
        .flat_map(|_| poly.process(128))
        .collect::<Vec<f32>>()
        .chunks_exact(2)
        .map(|f| (f64::from(f[0]) + f64::from(f[1])) * 0.5)
        .collect()
}

/// **The swell, held down.** A note whose makeup carries it far past the
/// target — what a makeup fitted on the phrase does to a patch that keeps
/// rising after the phrase's 1.8 s note ends — settles at the leveler's
/// ceiling instead of at the brickwall.
#[test]
fn a_held_note_past_the_ceiling_settles_at_it() {
    use auracle_features::{integrated_lufs, TARGET_LUFS};
    quiver::rng::seed(7);
    let json = sustained_json();
    let settled = |leveler: bool| {
        let mono = held(&json, 10f64.powf(30.0 / 20.0), leveler, 6.0);
        integrated_lufs(&mono[mono.len() - 88_200..], 44_100.0).expect("not silent")
    };
    let ceiling = TARGET_LUFS + LEVELER_OVER_TARGET_LU;
    let (on, off) = (settled(true), settled(false));
    assert!(
        off > ceiling + 4.0,
        "the fixture never gets past the ceiling ({off:.1} LUFS), so it tests nothing"
    );
    assert!(
        (on - ceiling).abs() < 1.0,
        "held at {on:.1} LUFS, ceiling {ceiling} (unlevelled: {off:.1})"
    );
}

/// Below its ceiling the leveler is not there at all: the same note with it
/// on and off is the same samples.
#[test]
fn a_note_under_the_leveler_ceiling_is_untouched() {
    quiver::rng::seed(7);
    let json = sustained_json();
    let (on, off) = (held(&json, 0.1, true, 2.0), held(&json, 0.1, false, 2.0));
    assert!(on.iter().any(|s| s.abs() > 1e-3), "the note is silent");
    assert_eq!(on, off);
}

/// The leveler's K-weighting is a copy of `auracle_features::loudness`'s,
/// and has to stay one: its ceiling is a loudness the audition target is
/// stated in. A steady three-tone signal reads the same through both.
#[test]
fn the_leveler_reads_the_loudness_the_audition_was_normalized_in() {
    use auracle_features::integrated_lufs;
    let sr = 48_000.0;
    let x: Vec<f64> = (0..(3.0 * sr) as usize)
        .map(|i| {
            let t = std::f64::consts::TAU * i as f64 / sr;
            0.3 * (60.0 * t).sin() + 0.2 * (1_000.0 * t).sin() + 0.1 * (6_000.0 * t).sin()
        })
        .collect();
    let mut lv = Leveler::new(sr);
    for s in &x {
        lv.tick(*s as f32, *s as f32);
    }
    let ours = -0.691 + 10.0 * lv.energy.log10();
    let theirs = integrated_lufs(&x, sr).expect("not silent");
    assert!(
        (ours - theirs).abs() < 0.05,
        "leveler reads {ours:.3} LUFS, the featurizer {theirs:.3}"
    );
}

/// A patch that is its input through the voice stage.
fn input_patch() -> String {
    use auracle_grammar::term::{AmpEnv, AudioNode, InputChannel};
    serde_json::to_string(&PatchTree {
        amp: AmpEnv {
            attack: 0.0,
            decay: 0.2,
            sustain: auracle_grammar::PARAM_MAX,
            release: 0.0,
        },
        root: AudioNode::AudioIn {
            uid: Uid::NEW,
            input: 0,
            gain: auracle_grammar::INPUT_GAIN_UNITY,
            channel: InputChannel::Left,
        },
    })
    .unwrap()
}

/// Write one quantum of input (a tone on the left, the right silent) and
/// render it.
fn quantum_with_input(poly: &mut LivePoly, t0: usize, write: bool) -> f32 {
    const Q: usize = 128;
    if write {
        let at = poly.input_ptr();
        // The worklet's side of the contract: write wasm memory directly.
        let buf = unsafe { std::slice::from_raw_parts_mut(at, Q * 2) };
        for f in 0..Q {
            let x = ((t0 + f) as f32 * 330.0 / 44_100.0 * std::f32::consts::TAU).sin();
            buf[f * 2] = 0.5 * x;
            buf[f * 2 + 1] = 0.0;
        }
        poly.write_input(Q, 2);
    }
    let out = poly.process(Q);
    out.iter().fold(0.0f32, |m, s| m.max(s.abs()))
}

/// **The live voice hears its input.** An AUDIO IN patch played from the
/// keys plays the quantum written into it, every held voice reads the same
/// block (the cursor stream fans one capture out), and a quantum with no
/// write is silent: quiver never repeats a block, so a stalled capture
/// falls silent rather than looping.
#[test]
fn the_live_voice_hears_its_input() {
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(&input_patch(), 44_100.0, 4).expect("compiles");
    assert!(poly.input_capacity() >= 128);
    poly.set_leveler(false);
    poly.note_on(60, 1.0);
    let mut heard = 0.0f32;
    for q in 0..40 {
        heard = heard.max(quantum_with_input(&mut poly, q * 128, true));
    }
    assert!(heard > 0.05, "the input is heard ({heard})");
    // The input's DC blocker rings down for a few quanta after the last
    // write; past that, a replayed block would still be at full level.
    for q in 40..48 {
        quantum_with_input(&mut poly, q * 128, false);
    }
    let mut quiet = 0.0f32;
    for q in 48..56 {
        quiet = quiet.max(quantum_with_input(&mut poly, q * 128, false));
    }
    assert!(
        quiet < heard / 100.0,
        "a quantum with no input written replayed one ({quiet} against {heard})"
    );

    // Two held voices read the same block: twice the one voice.
    let mut one = LivePoly::new(&input_patch(), 44_100.0, 4).unwrap();
    let mut two = LivePoly::new(&input_patch(), 44_100.0, 4).unwrap();
    for p in [&mut one, &mut two] {
        p.set_leveler(false);
        p.note_on(60, 1.0);
    }
    two.note_on(67, 1.0);
    let (mut a, mut b) = (0.0f32, 0.0f32);
    for q in 0..40 {
        a = a.max(quantum_with_input(&mut one, q * 128, true));
        b = b.max(quantum_with_input(&mut two, q * 128, true));
    }
    assert!(
        b > 1.5 * a,
        "the second voice did not hear the block: one voice {a}, two voices {b}"
    );
}

/// The loudest sample over `quanta` quanta of input, starting at quantum
/// `from`.
fn loudest_with_input(poly: &mut LivePoly, from: usize, quanta: usize) -> f32 {
    (from..from + quanta).fold(0.0f32, |m, q| {
        m.max(quantum_with_input(poly, q * 128, true))
    })
}

/// **A patch that listens sounds with no key down while it is held open.**
/// Closed, the amp envelope keeps the input out however loud it is. Open,
/// the open voice plays it through the whole patch; no key, chord or
/// `all_off` takes it; a knob reaches it; a swap keeps it open; and
/// closing it lets it ring out and park.
#[test]
fn the_open_voice_plays_the_input_with_no_key() {
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(&input_patch(), 44_100.0, 4).expect("compiles");
    poly.set_leveler(false);
    let closed = loudest_with_input(&mut poly, 0, 20);
    assert!(closed < 1.0e-6, "no key and not open, yet heard ({closed})");
    assert!(!poly.open_sounding());

    poly.set_open(true);
    let open = loudest_with_input(&mut poly, 20, 40);
    assert!(open > 0.05, "held open, the input is heard ({open})");
    assert!(poly.open_sounding());

    // Five keys on four voices, then everything released: the open voice
    // is not one of the four, so it is still sounding, and still heard.
    for n in [62, 64, 67, 71, 74] {
        poly.note_on(n, 1.0);
    }
    loudest_with_input(&mut poly, 60, 10);
    poly.all_off();
    loudest_with_input(&mut poly, 70, 60);
    assert!(
        poly.open_sounding(),
        "a key or all_off closed the open voice"
    );
    let after_keys = loudest_with_input(&mut poly, 130, 20);
    assert!(
        (after_keys - open).abs() < open * 0.05,
        "the open voice alone after the keys: {after_keys} against {open}"
    );

    // A knob reaches it: the input's gain down to its floor (−24 dB).
    assert!(poly.set_param("node#gain", 0.0));
    loudest_with_input(&mut poly, 150, 40);
    let turned = loudest_with_input(&mut poly, 190, 20);
    assert!(
        turned < open / 8.0,
        "the gain knob did not reach the open voice: {turned} against {open}"
    );
    assert!(poly.set_param("node#gain", auracle_grammar::INPUT_GAIN_UNITY));
    loudest_with_input(&mut poly, 210, 40);

    // A swap to the same patch keeps it open and heard.
    assert!(poly.set_patch(&input_patch()));
    loudest_with_input(&mut poly, 250, 40);
    let swapped = loudest_with_input(&mut poly, 290, 20);
    assert!(
        swapped > open * 0.9,
        "the open voice did not survive a swap: {swapped} against {open}"
    );

    // Closed: it rings out and parks.
    poly.set_open(false);
    loudest_with_input(&mut poly, 310, 80);
    assert!(!poly.open_sounding(), "a closed open voice never parked");
    let shut = loudest_with_input(&mut poly, 390, 10);
    assert!(shut < 1.0e-6, "closed, yet heard ({shut})");
}

/// **A patch that does not listen has no open voice.** Holding it open
/// plays nothing (no drone from a patch with no input), and a swap to a
/// patch that listens opens one, which a swap away lets go.
#[test]
fn only_a_patch_that_listens_is_held_open() {
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(&pad_json(), 44_100.0, 4).expect("compiles");
    poly.set_leveler(false);
    poly.set_open(true);
    let drone = loudest_with_input(&mut poly, 0, 40);
    assert!(
        drone < 1.0e-6,
        "a patch with no input droned when held open ({drone})"
    );
    assert!(!poly.open_sounding());

    assert!(poly.set_patch(&input_patch()));
    loudest_with_input(&mut poly, 40, 40);
    let heard = loudest_with_input(&mut poly, 80, 20);
    assert!(
        heard > 0.05,
        "a swap to a patch that listens did not open it ({heard})"
    );

    assert!(poly.set_patch(&pad_json()));
    loudest_with_input(&mut poly, 100, 120);
    assert!(
        !poly.open_sounding(),
        "a swap away left the open voice sounding"
    );
    let quiet = loudest_with_input(&mut poly, 220, 10);
    assert!(quiet < 1.0e-6, "the pad droned after the swap ({quiet})");
}

/// A patch a TRACK plays: a sine VCO played by the pitch of input 1.
fn tracked_patch() -> String {
    use auracle_grammar::term::{AmpEnv, AudioNode, InputChannel, PitchBand, Waveform};
    use auracle_grammar::ModNode;
    serde_json::to_string(&PatchTree {
        amp: AmpEnv {
            attack: 0.0,
            decay: 0.2,
            sustain: auracle_grammar::PARAM_MAX,
            release: 0.05,
        },
        root: AudioNode::Track {
            uid: Uid::NEW,
            band: PitchBand::Mid,
            sensitivity: auracle_grammar::TRACK_SENSITIVITY_DEFAULT,
            dynamics: 0.0,
            input: Box::new(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Sine,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            }),
            listen: Box::new(AudioNode::AudioIn {
                uid: Uid::NEW,
                input: 0,
                gain: auracle_grammar::INPUT_GAIN_UNITY,
                channel: InputChannel::Left,
            }),
        },
    })
    .unwrap()
}

/// `json` (a patch a TRACK plays) on four voices, monitored (its open
/// voice leading), leveler off and well under the master ceiling, so five
/// voices read as five, with the input written for long enough that the
/// tracker has settled.
fn tracked_open(json: &str) -> LivePoly {
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(json, 44_100.0, 4).expect("compiles");
    poly.set_leveler(false);
    poly.set_makeup(0.06);
    poly.set_open(true);
    loudest_with_input(&mut poly, 0, 120);
    poly
}

/// **A tracked patch has one tracked voice, and the keys do not stack
/// on it.** Monitored, the open voice leads: it tracks the input and
/// sounds while the input does, with no key down. The keys' voices
/// follow it and stop with their keys: once four keys are let go and
/// their tails have died, the output is the lead's alone again. (Before
/// the lead, each key's voice tracked the input itself and its tracker's
/// gate held its amp open after the key was let go, so the voices stayed
/// and the level stood at five voices'.)
#[test]
fn a_tracked_patch_has_one_tracked_voice_and_the_keys_do_not_stack() {
    quiver::rng::seed(7);
    let mut poly = tracked_open(&tracked_patch());
    let alone = loudest_with_input(&mut poly, 120, 40);
    assert!(
        alone > 0.02,
        "the tracked voice is silent with the input sounding ({alone})"
    );
    for n in [60, 64, 67, 71] {
        poly.note_on(n, 1.0);
    }
    loudest_with_input(&mut poly, 160, 20);
    let chord = loudest_with_input(&mut poly, 180, 20);
    assert!(
        chord > alone * 1.5,
        "the keys add nothing over the lead: {chord} against {alone}"
    );
    for n in [60, 64, 67, 71] {
        poly.note_off(n);
    }
    loudest_with_input(&mut poly, 200, 200);
    let after = loudest_with_input(&mut poly, 400, 40);
    assert!(
        after < alone * 1.2,
        "the keys' voices stayed after their keys: {after} against the lead's {alone}"
    );
    assert!(
        poly.voices.iter().all(|v| !v.running),
        "a released key's voice is still running"
    );
    // Unmonitored, the worklet writes no input (and clears it), so the
    // lead's tracker lets go, and it rings out and parks.
    poly.set_open(false);
    poly.clear_input();
    let mut unmonitored = 0.0f32;
    for q in 440..640 {
        unmonitored = quantum_with_input(&mut poly, q * 128, false);
    }
    assert!(!poly.open_sounding(), "the lead still sounds unmonitored");
    assert!(
        unmonitored < 1.0e-6,
        "still sounding unmonitored ({unmonitored})"
    );
}

/// One quantum's left channel, the input (330 Hz) written first.
fn left_with_input(poly: &mut LivePoly, from: usize, quanta: usize) -> Vec<f32> {
    let mut x = Vec::with_capacity(quanta * 128);
    for q in from..from + quanta {
        quantum_with_input(poly, q * 128, true);
        // `quantum_with_input` rendered into `out_buf`; read it back.
        x.extend(poly.out_buf[..256].chunks(2).map(|lr| lr[0]));
    }
    x
}

/// The magnitude of `x` at `hz` (one DFT bin, Hann-windowed), at 44.1 kHz.
fn level_at(x: &[f32], hz: f64) -> f64 {
    let n = x.len() as f64;
    let (mut re, mut im) = (0.0f64, 0.0f64);
    for (i, s) in x.iter().enumerate() {
        let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n).cos();
        let ph = std::f64::consts::TAU * hz * i as f64 / 44_100.0;
        re += w * *s as f64 * ph.cos();
        im -= w * *s as f64 * ph.sin();
    }
    (re * re + im * im).sqrt() / n
}

/// The keys held over a tracked patch: C4, D4 and G4 (none near 330 Hz).
const CHORD: [u8; 3] = [60, 62, 67];

/// Every held key's voice is fed the lead's tracked pitch and gate: the
/// input's 330 Hz (log2(330 / C4) V), not its own key.
fn assert_followers_fed(poly: &LivePoly, when: &str) {
    let want = (330.0f64 / 261.625_565).log2();
    let held: Vec<&Voice> = poly.voices.iter().filter(|v| v.note.is_some()).collect();
    assert_eq!(held.len(), CHORD.len(), "{when}: the chord's voices");
    for v in held {
        let feed = v
            .voice
            .track_feeds
            .values()
            .next()
            .expect("a follower has a feed");
        let (voct, gate) = (feed.voct.get(), feed.gate.get());
        assert!(
            (voct - want).abs() < 0.03 && gate >= 2.5,
            "{when}: key {:?}'s voice is fed {voct:.3} V, gate {gate:.1}, not the input's {want:.3} V",
            v.note
        );
    }
}

/// The chord's pitches are absent from the output and the input's is
/// there: every key plays the tracked note.
fn assert_plays_the_input(x: &[f32], when: &str) {
    let at = level_at(x, 330.0);
    assert!(
        at > 1.0e-3,
        "{when}: nothing at the input's 330 Hz ({at:.2e})"
    );
    for n in CHORD {
        let hz = 440.0 * 2f64.powf((n as f64 - 69.0) / 12.0);
        let own = level_at(x, hz);
        assert!(
            own < 0.02 * at,
            "{when}: key {n} plays its own {hz:.1} Hz ({own:.2e} against {at:.2e} at 330 Hz)"
        );
    }
}

/// **A chord under TRACK plays the input's pitch.** Monitored, the open
/// voice leads and hands its tracked pitch to every key's voice frame by
/// frame (`Tracks::Follow`): each is fed 330 Hz, and the output has the
/// input's pitch and none of the keys' own (C4, D4, G4). Without the feed
/// a key's voice is never given a pitch or a gate.
#[test]
fn a_chord_under_track_plays_the_inputs_pitch() {
    quiver::rng::seed(7);
    let mut poly = tracked_open(&tracked_patch());
    for n in CHORD {
        poly.note_on(n, 1.0);
    }
    loudest_with_input(&mut poly, 120, 40);
    assert_followers_fed(&poly, "held");
    let x = left_with_input(&mut poly, 160, 64);
    assert_plays_the_input(&x, "held");
}

/// **A tracked, monitored patch swaps with keys held.** The new patch's
/// open voice leads again, the held keys are re-pressed as followers of
/// it, and they still play the input's pitch, not their own; let go,
/// they stop, and the lead alone sounds, as loud as the new patch's lead
/// alone on an instrument of its own.
#[test]
fn a_tracked_patch_swaps_with_keys_held_and_they_still_follow() {
    quiver::rng::seed(7);
    // The same patch with a saw for the sine: a structural swap.
    let swapped = tracked_patch().replace("\"Sine\"", "\"Saw\"");
    assert_ne!(swapped, tracked_patch());
    let alone = loudest_with_input(&mut tracked_open(&swapped), 120, 40);
    let mut poly = tracked_open(&tracked_patch());
    for n in CHORD {
        poly.note_on(n, 1.0);
    }
    loudest_with_input(&mut poly, 120, 40);
    assert!(poly.set_patch(&swapped));
    loudest_with_input(&mut poly, 160, 120);
    assert!(poly.open_sounding(), "the swap closed the lead");
    assert_followers_fed(&poly, "after the swap");
    let x = left_with_input(&mut poly, 280, 64);
    assert_plays_the_input(&x, "after the swap");
    for n in CHORD {
        poly.note_off(n);
    }
    loudest_with_input(&mut poly, 344, 200);
    let alone_after = loudest_with_input(&mut poly, 544, 40);
    assert!(
        (alone_after - alone).abs() < 0.1 * alone,
        "the lead alone after the keys: {alone_after} against {alone}"
    );
    assert!(
        poly.voices.iter().all(|v| !v.running),
        "a released key's voice is still running after the swap"
    );
}

/// A CAPTURE of the left input with no take yet, playing it once: what
/// RECORD records into.
fn capture_patch() -> String {
    use auracle_grammar::term::{AmpEnv, AudioNode, CaptureMode, InputChannel};
    serde_json::to_string(&PatchTree {
        amp: AmpEnv {
            attack: 0.0,
            decay: 0.2,
            sustain: auracle_grammar::PARAM_MAX,
            release: 0.0,
        },
        root: AudioNode::Capture {
            uid: Uid::NEW,
            play: CaptureMode::Once,
            input: Box::new(AudioNode::AudioIn {
                uid: Uid::NEW,
                input: 0,
                gain: auracle_grammar::INPUT_GAIN_UNITY,
                channel: InputChannel::Left,
            }),
            take: auracle_grammar::Take::empty(),
        },
    })
    .unwrap()
}

/// **A take rendered off the audio thread is the one recording live
/// makes.** The same input, recorded by a live voice quantum by quantum
/// and handed to `render_take` as one buffer, gives the same take, bit
/// for bit; a key with no CAPTURE renders none.
#[test]
fn a_take_rendered_from_the_recorded_input_is_the_live_take() {
    quiver::rng::seed(7);
    let tree = capture_patch();
    // Live: a key held at C4, the gate raised, 100 quanta of the tone.
    let mut live = LivePoly::new(&tree, 44_100.0, 1).expect("compiles");
    live.set_leveler(false);
    live.note_on(OPEN_NOTE, 1.0);
    assert!(live.set_record("node", true));
    let mut input = Vec::new();
    for q in 0..100 {
        quantum_with_input(&mut live, q * 128, true);
        input.extend_from_slice(&live.input_buf[..256]);
    }
    live.set_record("node", false);
    let recorded = live.take_json("node");
    // Off the audio thread, from the same input.
    let rendered = render_take(&tree, "node", &input, 2, 44_100.0);
    assert!(!rendered.is_empty(), "no take rendered");
    assert_eq!(rendered, recorded, "the rendered take is not the live one");
    assert_eq!(render_take(&tree, "node/9", &input, 2, 44_100.0), "");
    assert_eq!(render_take("not a tree", "node", &input, 2, 44_100.0), "");
}

/// **A CAPTURE records what is patched into it and reads it back.** With
/// a key held on one voice, the record gate raised records the input;
/// dropped, the take reads back as its saved JSON, as long as it ran, and
/// not silent. A key with no capture records nothing.
#[test]
fn a_capture_records_and_reads_back_its_take() {
    quiver::rng::seed(7);
    let tree = capture_patch();
    let mut poly = LivePoly::new(&tree, 44_100.0, 1).expect("compiles");
    assert!(
        !poly.set_record("node/9", true),
        "a capture where there is none"
    );
    poly.note_on(60, 1.0);
    assert!(poly.set_record("node", true));
    loudest_with_input(&mut poly, 0, 100);
    assert!(poly.set_record("node", false));
    let json = poly.take_json("node");
    let take: auracle_grammar::Take = serde_json::from_str(&json).expect("a take");
    assert!(take.unreadable().is_none(), "{json:.80}");
    let want = 100 * 128;
    assert!(
        take.len() + 256 >= want && take.len() <= want,
        "the take is {} samples, the press {want}",
        take.len()
    );
    let peak = take.samples().iter().fold(0.0f32, |m, x| m.max(x.abs()));
    assert!(peak > 0.05, "the take is silent ({peak})");
    assert_eq!(poly.take_json("node/9"), "");
}

/// Loom (a patch with a sequencer) on four voices at 48 kHz, tempo sync on.
fn loom_synced() -> LivePoly {
    quiver::rng::seed(7);
    let (_, tree) = auracle_grammar::presets()
        .into_iter()
        .find(|(n, _)| *n == "Loom")
        .expect("Loom exists");
    let mut p = LivePoly::new(&serde_json::to_string(&tree).unwrap(), 48_000.0, 4).unwrap();
    p.set_sync(true);
    p
}

/// The arp notes one instrument plays over `quanta` quanta, in order, a
/// note entered once per step.
fn arp_notes(p: &mut LivePoly, quanta: usize) -> Vec<u8> {
    let mut notes = Vec::new();
    let mut prev = None;
    for _ in 0..quanta {
        let _ = p.process(128);
        if let Some(n) = p.arp_note.filter(|_| p.arp_note != prev) {
            notes.push(n);
        }
        prev = p.arp_note;
    }
    notes
}

/// An arp over the chord C3, E3, G3 in `mode`, 16ths at 240 BPM.
fn chord_arp(mode: u32, gate: f64) -> LivePoly {
    quiver::rng::seed(7);
    let mut p = LivePoly::new(&plucked_json(), 44_100.0, 4).unwrap();
    p.set_arp(true, mode, 4.0, 240.0, gate, 1, 0.0);
    for n in [48, 52, 55] {
        p.note_on(n, 1.0);
    }
    p
}

/// The meter reads levels and nothing else: an update of another kind off
/// the same observer (a scope's, on the same port) is not a tap's, and the
/// taps read what they read without it.
#[test]
fn the_meter_reads_levels_and_nothing_else() {
    let read = |scope: bool| {
        quiver::rng::seed(7);
        let mut poly = LivePoly::new(&pad_json(), 44_100.0, 1).unwrap();
        assert_eq!(poly.set_meter(true), 1);
        if scope {
            let (node, port) = poly.meter.ports[0].clone();
            poly.meter
                .observer
                .add_subscriptions(vec![SubscriptionTarget::Scope {
                    node_id: node,
                    port_id: port,
                    buffer_size: 64,
                }]);
        }
        poly.note_on(60, 1.0);
        for _ in 0..8 {
            let _ = poly.process(512);
        }
        poly.meter.levels.clone()
    };
    let levels = read(false);
    assert!(levels[0] > -60.0, "the tap read nothing: {levels:?}");
    assert_eq!(read(true), levels);
}

/// With no key sounding, the meter follows the open voice, so the rack's
/// levels follow the input; with the meter off, nothing is read.
#[test]
fn the_meter_follows_the_open_voice_when_no_key_sounds() {
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(&input_patch(), 44_100.0, 4).unwrap();
    poly.set_leveler(false);
    poly.set_open(true);
    let n = poly.set_meter(true);
    assert!(n > 0);
    loudest_with_input(&mut poly, 0, 40);
    assert!(poly.voices.iter().all(|v| !v.running), "no key sounds");
    let db = unsafe { std::slice::from_raw_parts(poly.meter_ptr(), poly.meter_len()) };
    assert!(
        db.iter().all(|d| *d > -60.0),
        "the open voice's taps read silent: {db:?}"
    );
}

/// The transport restarts on a MIDI start: the sequencers go back to step 0
/// and a held chord's arp fires on that same block. Another instrument
/// joins its grid at its position (`set_transport_beats`), and a position
/// that is no position (below 0, not a number) changes nothing.
#[test]
fn the_transport_restarts_and_another_instrument_joins_it() {
    quiver::rng::seed(7);
    let mut a = loom_synced();
    a.set_arp(true, 0, 4.0, 120.0, 0.5, 1, 0.0);
    a.note_on(60, 0.8);
    for _ in 0..300 {
        let _ = a.process(128);
    }
    assert!(a.transport_beats() > 1.0);
    a.restart_transport();
    assert_eq!(a.transport_beats(), 0.0);
    // Mid-step a moment ago: the arp fires again in the restart's block.
    let _ = a.process(128);
    assert!(
        a.arp_note.is_some(),
        "the arp did not restart with the transport"
    );
    let slot = a.sync_lanes[0].sync_slot;
    assert_eq!(
        a.param_slots[slot].values[0].get(),
        0.0,
        "the sequencer is at step 0"
    );
    let mut b = loom_synced();
    b.set_transport_beats(a.transport_beats());
    assert_eq!(b.transport_beats(), a.transport_beats());
    for nonsense in [-1.0, f64::NAN, f64::INFINITY] {
        b.set_transport_beats(nonsense);
        assert_eq!(b.transport_beats(), a.transport_beats(), "{nonsense}");
    }
}

/// Unison on a one-voice instrument is the note itself: no detune and the
/// voice in the middle.
#[test]
fn unison_on_one_voice_is_the_note() {
    quiver::rng::seed(7);
    let mut p = LivePoly::new(&plucked_json(), 44_100.0, 1).unwrap();
    p.set_unison(true, 1.0, 1.0);
    p.note_on(67, 1.0);
    let v = &p.voices[0];
    assert!((v.pitch_tgt - 7.0 / 12.0).abs() < 1e-12, "{}", v.pitch_tgt);
    assert!((v.pan_l - v.pan_r).abs() < 1e-6, "{} {}", v.pan_l, v.pan_r);
}

/// A bend or a makeup that is not a number is no gesture: the pitch and the
/// level stay where they were.
#[test]
fn a_bend_or_makeup_that_is_not_a_number_changes_nothing() {
    quiver::rng::seed(7);
    let mut p = LivePoly::new(&pad_json(), 44_100.0, 1).unwrap();
    p.set_leveler(false);
    p.note_on(60, 1.0);
    p.set_bend(2.0);
    for _ in 0..200 {
        let _ = p.process(128);
    }
    let pitch = p.voices[0].voice.pitch.get();
    assert!((pitch - 2.0 / 12.0).abs() < 1e-6, "{pitch}");
    let level = peak(&p.process(512));
    p.set_bend(f64::NAN);
    p.set_makeup(f64::NAN);
    for _ in 0..20 {
        let _ = p.process(128);
    }
    assert_eq!(p.voices[0].voice.pitch.get(), pitch);
    let after = peak(&p.process(512));
    assert!(
        (after - level).abs() < level * 0.05,
        "{after} against {level}"
    );
}

/// An arp gate or swing that is not a number is the default (half the
/// step, no swing): the steps start where they would and sound as long.
#[test]
fn an_arp_gate_or_swing_that_is_not_a_number_is_the_default() {
    quiver::rng::seed(7);
    let json = plucked_json();
    assert_eq!(
        arp_run(&json, 4.0, 120.0, f64::NAN, f64::NAN, 600),
        arp_run(&json, 4.0, 120.0, 0.5, 0.0, 600)
    );
}

/// Turning the arp on hands the held chord to the scheduler: the chord's
/// voices are let go at once, and from the next step one note sounds at a
/// time. Turning it off just after a step lets go of the arp's note, an
/// octave up the chord, and presses the chord again.
#[test]
fn the_arp_takes_the_chord_and_gives_it_back() {
    quiver::rng::seed(7);
    let mut p = LivePoly::new(&first_bass(), 44_100.0, 4).unwrap();
    for n in [48, 52, 55] {
        p.note_on(n, 1.0);
    }
    let _ = p.process(128);
    let gated = |p: &LivePoly| -> Vec<u8> {
        let mut g: Vec<u8> = p.voices.iter().filter_map(|v| v.note).collect();
        g.sort_unstable();
        g
    };
    assert_eq!(gated(&p), vec![48, 52, 55]);
    p.set_arp(true, 0, 4.0, 240.0, 0.9, 2, 0.0);
    assert!(gated(&p).is_empty(), "the chord was not handed over");
    let _ = p.process(128);
    assert_eq!(gated(&p).len(), 1);
    // Step until the arp plays the chord an octave up, then stop it there.
    let mut steps = 0;
    while p.arp_note.is_none_or(|n| n < 60) {
        let _ = p.process(128);
        steps += 1;
        assert!(steps < 400, "the arp never climbed an octave");
    }
    p.set_arp(false, 0, 4.0, 240.0, 0.9, 2, 0.0);
    assert_eq!(gated(&p), vec![48, 52, 55], "not the chord again");
}

/// The arp's patterns: up climbs the chord, down descends it, up and down
/// bounces, and one note bounces on itself; random plays only the chord,
/// every note of it in time, in an order of its own that two instruments
/// play alike (no clock reaches the audio thread).
#[test]
fn the_arp_plays_its_patterns() {
    quiver::rng::seed(7);
    let up = arp_notes(&mut chord_arp(0, 0.5), 600);
    assert_eq!(&up[..6], &[52, 55, 48, 52, 55, 48], "{up:?}");
    let down = arp_notes(&mut chord_arp(1, 0.5), 600);
    assert_eq!(&down[..6], &[55, 52, 48, 55, 52, 48], "{down:?}");
    let bounce = arp_notes(&mut chord_arp(2, 0.5), 600);
    assert_eq!(&bounce[..6], &[52, 55, 52, 48, 52, 55], "{bounce:?}");
    let mut one = LivePoly::new(&plucked_json(), 44_100.0, 4).unwrap();
    one.set_arp(true, 2, 4.0, 240.0, 0.5, 1, 0.0);
    one.note_on(50, 1.0);
    let lone = arp_notes(&mut one, 300);
    assert!(lone.len() > 3 && lone.iter().all(|n| *n == 50), "{lone:?}");
    let random = arp_notes(&mut chord_arp(3, 0.5), 1200);
    assert_eq!(random, arp_notes(&mut chord_arp(3, 0.5), 1200));
    assert!(
        random.iter().all(|n| [48, 52, 55].contains(n)),
        "{random:?}"
    );
    for n in [48, 52, 55] {
        assert!(random.contains(&n), "{n} never played: {random:?}");
    }
    assert_ne!(&random[..6], &up[..6], "random played the up pattern");
}

/// A tied arp (gate at or past 0.95) slides one sounding voice from pitch
/// to pitch: its gate never falls between steps, so no other voice is
/// pressed and the amp envelope keeps its place. With glide off the slide
/// lands on its pitch at once; with glide up it portamentos there.
#[test]
fn a_tied_arp_slides_one_voice() {
    quiver::rng::seed(7);
    for glide in [0.0, 0.2] {
        let mut p = chord_arp(0, 1.0);
        p.set_glide(glide);
        let _ = p.process(128);
        let sounding = p.voices.iter().position(|v| v.note.is_some()).unwrap();
        let mut pitches = std::collections::HashSet::new();
        let mut landed = true;
        let mut prev = p.voices[sounding].note;
        for _ in 0..400 {
            let _ = p.process(128);
            let gated: Vec<usize> = (0..4).filter(|&i| p.voices[i].note.is_some()).collect();
            assert_eq!(gated, vec![sounding], "the tie moved to another voice");
            let v = &p.voices[sounding];
            if v.note != prev {
                landed &= v.pitch_cur == v.pitch_tgt;
            }
            prev = v.note;
            pitches.insert(v.note.unwrap());
        }
        assert_eq!(pitches.len(), 3, "the tie never moved: {pitches:?}");
        assert_eq!(landed, glide == 0.0, "glide {glide}");
    }
}

/// A knob write that is not a number is refused. A sequencer's rate turned
/// with sync off ramps like any knob; with sync on it snaps to the grid at
/// once, and leaves another knob's ramp running.
#[test]
fn a_rate_knob_ramps_free_and_snaps_synced() {
    use auracle_grammar::steps::rate_hz;
    quiver::rng::seed(7);
    let mut p = loom_synced();
    p.set_sync(false);
    let (rate, sync) = (p.sync_lanes[0].rate_slot, p.sync_lanes[0].sync_slot);
    let rate_addr = p.param_slots[rate].addr.clone();
    let other = (0..p.param_slots.len())
        .find(|&s| s != rate && s != sync)
        .expect("Loom has another knob");
    let other_addr = p.param_slots[other].addr.clone();
    assert!(!p.set_param(&rate_addr, f64::NAN), "a NaN rate was taken");
    let before = p.param_slots[rate].values[0].get();
    assert!(p.set_param(&rate_addr, 0.95));
    let _ = p.process(128);
    let first = p.param_slots[rate].values[0].get();
    assert!(
        first != before && first != p.param_slots[rate].map.apply(0.95),
        "free, the rate ramps: {before} -> {first}"
    );
    p.set_sync(true);
    assert!(p.set_param(&other_addr, 0.9));
    assert!(p.set_param(&rate_addr, 0.3));
    let hz = rate_hz(p.param_slots[rate].values[0].get());
    assert!(
        SYNC_DIVISIONS.iter().any(|d| (hz - 2.0 * d).abs() < 1e-9),
        "synced, the rate is on the grid at once: {hz} Hz"
    );
    assert!(
        p.smoothers.iter().any(|s| s.slot == other),
        "the other knob's ramp was dropped"
    );
}

/// A swap with the arp on hands the new voices to the scheduler, which
/// presses its next step on them; the swap is reported as any is.
#[test]
fn a_swap_under_the_arp_keeps_it_stepping() {
    quiver::rng::seed(7);
    let mut p = chord_arp(0, 0.5);
    let _ = arp_notes(&mut p, 40);
    assert!(p.set_patch(&first_bass()));
    let (mut patched, mut after) = (false, Vec::new());
    for _ in 0..200 {
        let _ = p.process(128);
        patched |= p.poll_event() == EVENT_PATCHED;
        if patched {
            after.extend(p.arp_note);
        }
    }
    assert!(patched, "swap never completed");
    assert!(
        [48, 52, 55].iter().all(|n| after.contains(n)),
        "the arp did not carry on after the swap: {after:?}"
    );
}

/// The envelope carry follows notes, not voices: a held note no voice was
/// sounding before a swap (a unison stack moved every voice to the last
/// key) starts its attack on the new patch, while the note that was
/// sounding comes back where it was.
#[test]
fn a_held_note_no_voice_sounded_starts_fresh_after_a_swap() {
    quiver::rng::seed(7);
    let json = pad_json();
    let mut p = LivePoly::new(&json, 44_100.0, 4).unwrap();
    p.set_unison(true, 0.5, 0.5);
    p.note_on(48, 1.0);
    p.note_on(55, 1.0);
    p.set_unison(false, 0.5, 0.5);
    for _ in 0..200 {
        let _ = p.process(128);
    }
    assert!(p.voices.iter().all(|v| v.note != Some(48)), "fixture");
    let carried = p.voices[0].voice.env_phase();
    assert!(p.set_patch(&json));
    let mut patched = false;
    while !patched {
        let _ = p.process(128);
        patched = p.poll_event() == EVENT_PATCHED;
    }
    let phase = |note: u8| {
        p.voices
            .iter()
            .find(|v| v.note == Some(note))
            .map(|v| v.voice.env_phase())
            .unwrap()
    };
    assert!(
        (phase(55) - carried).abs() < 0.05,
        "{} against {carried}",
        phase(55)
    );
    assert!(
        phase(48) < 0.2 * carried,
        "48 did not start fresh: {}",
        phase(48)
    );
}

/// A host block longer than the lead's buffer still plays every frame: the
/// keys' voices hold the last frame the lead tracked for the rest of it.
#[test]
fn a_block_longer_than_the_lead_buffer_plays_on() {
    quiver::rng::seed(7);
    let mut poly = tracked_open(&tracked_patch());
    for n in CHORD {
        poly.note_on(n, 1.0);
    }
    loudest_with_input(&mut poly, 120, 40);
    let out = poly.process(LIVE_INPUT_FRAMES * 2);
    assert_eq!(out.len(), LIVE_INPUT_FRAMES * 4);
    assert!(out.iter().all(|s| s.is_finite()));
    let tail = peak(&out[LIVE_INPUT_FRAMES * 2..]);
    assert!(tail > 0.01, "the block's second half fell silent ({tail})");
}

// ---- Resting: the B slot at a mix of 0 (#288) ----

/// The context rate the rest tests run at.
const REST_RATE: f64 = 48_000.0;

/// A pad whose attack climbs past its sustain level: an attack of ≈0.25 s
/// time constant (1.7 s to the peak), a decay of ≈0.1 s, a sustain of 0.5.
/// Each stage lasts long enough that a wake can be put inside it.
fn slow_pad_json() -> String {
    use auracle_grammar::term::{AmpEnv, Waveform};
    use auracle_grammar::{AudioNode, ModNode, PatchTree};
    serde_json::to_string(&PatchTree {
        amp: AmpEnv {
            attack: 0.6,
            decay: 0.5,
            sustain: 0.5,
            release: 0.4,
        },
        root: AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Saw,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
        },
    })
    .unwrap()
}

/// Where the amp envelope of the voice holding `note` is.
fn env_of(poly: &LivePoly, note: u8) -> f64 {
    poly.voices
        .iter()
        .find(|v| v.note == Some(note))
        .map(|v| v.voice.env_phase())
        .expect("the note is held")
}

/// One instrument twice over, leveler off: the first to render every
/// quantum (as B always did), the second to rest where the first renders.
fn rest_twins(json: &str, voices: usize) -> (LivePoly, LivePoly) {
    quiver::rng::seed(7);
    let mut a = LivePoly::new(json, REST_RATE, voices).expect("compiles");
    let mut b = LivePoly::new(json, REST_RATE, voices).expect("compiles");
    a.set_leveler(false);
    b.set_leveler(false);
    (a, b)
}

/// `quanta` quanta: the first twin renders them, the second rests.
fn rest_beside(a: &mut LivePoly, b: &mut LivePoly, quanta: usize) {
    for _ in 0..quanta {
        let _ = a.process(128);
        b.rest(128);
    }
}

/// `quanta` quanta that both twins render.
fn render_both(a: &mut LivePoly, b: &mut LivePoly, quanta: usize) {
    for _ in 0..quanta {
        let _ = a.process(128);
        let _ = b.process(128);
    }
}

/// **The rested envelope's level is quiver's.** `held_envelope` mirrors
/// quiver's exponential ADSR to say where a held note's envelope is after
/// any number of samples; here it is held against the envelope itself, tick
/// by tick, through the attack, the moment it snaps to the peak, the decay
/// and the shelf.
#[test]
fn the_held_envelope_is_quivers_tick_by_tick() {
    use auracle_grammar::term::{AmpEnv, Waveform};
    use auracle_grammar::{AudioNode, ModNode, PatchTree};
    quiver::rng::seed(7);
    let json = serde_json::to_string(&PatchTree {
        amp: AmpEnv {
            attack: 0.4, // ≈40 ms
            decay: 0.35, // ≈25 ms
            sustain: 0.6,
            release: 0.4,
        },
        root: AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Saw,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
        },
    })
    .unwrap();
    let mut poly = LivePoly::new(&json, REST_RATE, 1).unwrap();
    let knob = |p: &LivePoly, addr: &str| p.voices[0].voice.params[addr].value.get();
    let (attack, decay, sustain) = (
        knob(&poly, "amp#attack"),
        knob(&poly, "amp#decay"),
        knob(&poly, "amp#sustain"),
    );
    assert_eq!(
        held_envelope(attack, decay, sustain, REST_RATE, 0),
        (true, 0.0)
    );
    poly.note_on(60, 1.0);
    let (mut attacking, mut peaked, mut shelved) = (0, None, None);
    for tick in 1..24_000u64 {
        let _ = poly.process(1);
        let real = poly.voices[0].voice.env_phase();
        let (rising, level) = held_envelope(attack, decay, sustain, REST_RATE, tick);
        assert!(
            (real - level).abs() < 1e-9,
            "tick {tick}: quiver's envelope is at {real}, the mirror says {level}"
        );
        if rising {
            attacking += 1;
        } else if peaked.is_none() {
            peaked = Some((tick, level));
        }
        if shelved.is_none() && !rising && level == sustain {
            shelved = Some(tick);
        }
    }
    // The attack ends on the tick quiver snaps it to the peak, and the
    // decay on the tick it snaps to the shelf.
    let (peak_tick, peak_level) = peaked.expect("the attack ends");
    assert_eq!(peak_tick, attacking + 1, "the attack is one run of ticks");
    assert!(
        (peak_level - 1.0).abs() < 1e-12,
        "it ends at the peak: {peak_level}"
    );
    let shelf = shelved.expect("the decay reaches the shelf");
    assert!(shelf > peak_tick && shelf < 23_000, "{shelf}");
}

/// Both twins render until the second, woken from its rest, is heard again:
/// the quanta that took.
fn wake_beside(a: &mut LivePoly, b: &mut LivePoly) -> usize {
    let mut quanta = 0;
    while b.resting() {
        assert!(quanta < 64, "the wake never ended");
        render_both(a, b, 1);
        quanta += 1;
    }
    quanta
}

/// The most quanta a held note's wake takes in the census below: a note on
/// its shelf is about 630 ticks of pre-roll (five quanta's budget), and one
/// more quantum starts it. Under `WAKE_MAX_QUANTA`, so the bound that ends
/// any wake cannot pass a wake that never arrived.
const CENSUS_WAKE_QUANTA: usize = 8;

/// **Every preset's held note wakes, soon and where it would be.** The
/// census of the library: each preset with a note held, rested for 16 s
/// (past every preset's attack and decay but the slowest, which are woken
/// where they are), then rendered. Each wake ends by arriving, within
/// `CENSUS_WAKE_QUANTA`, and the note's envelope is within 0.03 of where
/// quiver's would be. A falling envelope's arrival was an exact comparison
/// with a level quiver hands back through its 10 V scale, so on a sustain
/// whose `s × 10 × 0.1` rounds above `s` (0.6, 0.7, 0.85…) it never came,
/// and on 25 of the 62 presets a wake never ended: B stayed silent and cost
/// a render every quantum.
#[test]
fn every_presets_held_note_wakes_soon_and_where_it_would_be() {
    quiver::rng::seed(7);
    let mut wrong = Vec::new();
    for (name, tree) in auracle_grammar::presets() {
        let json = serde_json::to_string(&tree).unwrap();
        let mut b = LivePoly::new(&json, REST_RATE, 4).expect("compiles");
        b.set_leveler(false);
        b.note_on(48, 0.8);
        let _ = b.process(128);
        for _ in 0..6_000 {
            b.rest(128);
        }
        let mut quanta = 0;
        while b.resting() && quanta <= CENSUS_WAKE_QUANTA {
            let _ = b.process(128);
            quanta += 1;
        }
        if b.resting() || quanta > CENSUS_WAKE_QUANTA {
            wrong.push(format!("{name}: still waking after {quanta} quanta"));
            continue;
        }
        let v = b
            .voices
            .iter()
            .find(|v| v.note == Some(48))
            .expect("the note is held");
        let [attack, decay, sustain] = &v.amp;
        let (_, want) = held_envelope(
            attack.get(),
            decay.get(),
            sustain.get(),
            REST_RATE,
            b.clock - v.pressed_at,
        );
        let got = v.voice.env_phase();
        if (want - got).abs() >= 0.03 {
            wrong.push(format!("{name}: woke at {got}, not {want}"));
        }
    }
    assert!(
        wrong.is_empty(),
        "{} of the presets:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}

/// **A wake that cannot arrive still ends.** A wake is bounded, as a swap's
/// carry is (`seed_env_phase` stops at its own bound): after
/// `WAKE_MAX_QUANTA` quanta it ends wherever its voices stand and the
/// instrument fades in, so no envelope that never arrives can keep B silent
/// and costing a render for good. Quanta of no frames give the drive no
/// ticks to spend, so the held note can never get there.
#[test]
fn a_wake_that_cannot_arrive_still_ends() {
    let json = slow_pad_json();
    let (_, mut b) = rest_twins(&json, 4);
    b.note_on(60, 1.0);
    let _ = b.process(128);
    for _ in 0..1_200 {
        b.rest(128);
    }
    let mut quanta = 0;
    while b.resting() {
        assert!(quanta < 2 * WAKE_MAX_QUANTA, "the wake never ended");
        let _ = b.process(0);
        quanta += 1;
    }
    assert_eq!(quanta, WAKE_MAX_QUANTA, "it ended at its bound");
    assert_eq!(b.woke_ticks, 0, "with no frames, nothing was driven");
    assert!(
        b.voices.iter().all(|v| v.seek == Seek::Still),
        "every voice is let be"
    );
    assert!(
        matches!(b.stage, Stage::FadeIn),
        "and the instrument fades in"
    );
}

/// **A rested voice wakes where a rendered one is.** B rests while its
/// mix is 0 and renders again when it moves, and a held note must come back
/// at the level it would have reached had it rendered all along, in the
/// stage it would be in: neither attacking again from silence (a pad would
/// swell in on every Peek) nor parked on the shelf mid-attack. Woken in its
/// attack under the shelf, in its attack past the shelf, in its decay and
/// on the shelf, after being heard for a while first (the Blend was up), the
/// woken envelope is within 0.03 of the rendered one when it is heard again,
/// and 40 quanta later still is, so it is in the same stage too.
#[test]
fn a_rested_voice_wakes_where_a_rendered_one_is() {
    let json = slow_pad_json();
    for (stage, rested) in [
        ("attack, under the shelf", 6),
        ("attack, past the shelf", 150),
        ("decay", 700),
        ("on the shelf", 1_200),
    ] {
        let (mut a, mut b) = rest_twins(&json, 4);
        a.note_on(60, 1.0);
        b.note_on(60, 1.0);
        render_both(&mut a, &mut b, 4);
        rest_beside(&mut a, &mut b, rested);
        assert!(b.resting(), "{stage}: resting");
        wake_beside(&mut a, &mut b);
        let (want, got) = (env_of(&a, 60), env_of(&b, 60));
        assert!(
            (want - got).abs() < 0.03,
            "{stage}: woke at {got}, rendered all along it is at {want}"
        );
        render_both(&mut a, &mut b, 40);
        let (want_later, got_later) = (env_of(&a, 60), env_of(&b, 60));
        assert!(
            (want_later - got_later).abs() < 0.03,
            "{stage}: 40 quanta on, {got_later} against {want_later}"
        );
        // Each stage is where it is said to be: rising, falling or level.
        let moved = want_later - want;
        match stage {
            "decay" => assert!(moved < -0.01, "{stage}: {want} to {want_later}"),
            "on the shelf" => assert!(moved.abs() < 1e-9, "{stage}: {want} to {want_later}"),
            _ => assert!(moved > 0.01, "{stage}: {want} to {want_later}"),
        }
    }
}

/// **A wake costs no more than a render, and is not heard until it is
/// done.** Driving every held note's envelope to its place in one quantum
/// cost about six rendered quanta (a chord on its shelf is some 630 ticks of
/// each voice from silence), a glitch for everything on the render thread at
/// every Blend or Peek. So a wake spends at most a quantum's ticks a voice a
/// quantum, over the few quanta it takes, and is silent until it ends; then
/// the instrument fades in, as after a swap. The rest itself renders no
/// voice at all.
#[test]
fn a_wake_costs_no_more_than_a_render_and_is_silent_until_done() {
    let json = slow_pad_json();
    let (mut a, mut b) = rest_twins(&json, 4);
    for n in [48, 55, 64, 72] {
        a.note_on(n, 1.0);
        b.note_on(n, 1.0);
    }
    render_both(&mut a, &mut b, 4);
    rest_beside(&mut a, &mut b, 1_200);
    assert_eq!(b.woke_ticks, 0, "nothing has woken yet");
    let mut wake = Vec::new();
    while b.resting() {
        assert!(wake.len() < 64, "the wake never ended");
        let out = b.process(128);
        let _ = a.process(128);
        assert!(out.iter().all(|&s| s == 0.0), "heard mid-wake");
        wake.push(b.woke_ticks);
    }
    assert!(
        wake.iter().all(|&t| t <= 4 * 128),
        "a wake quantum spent more than four voices' quantum: {wake:?}"
    );
    // Four notes on the shelf, each about 630 ticks from silence: the work is
    // all there, spread over the quanta.
    let spent: usize = wake.iter().sum();
    assert!(spent > 4 * 500, "{spent} ticks in all: {wake:?}");
    assert!(
        (5..=8).contains(&wake.len()),
        "{} quanta: {wake:?}",
        wake.len()
    );
    let (want, got) = (env_of(&a, 72), env_of(&b, 72));
    assert!((want - got).abs() < 0.03, "woke at {got}, not {want}");
    // Then it is heard, faded in.
    let first = b.process(128);
    let fading = peak(&first[..16]);
    assert!(fading < peak(&first[112..]), "it comes in with a fade");
    assert!(peak(&b.process(128)) > 0.01, "and is heard");
    assert_eq!(
        b.woke_ticks,
        wake[wake.len() - 1],
        "a render spends no wake"
    );
}

/// **A rested instrument follows the hands.** A key pressed during the rest
/// wakes at its own envelope's place, a key let go during it is let go (no
/// tail, as a rewire drops one), and a note that stole the one voice during
/// the rest sounds when it wakes rather than waiting for a gate that never
/// rises.
#[test]
fn a_rested_instrument_follows_the_hands() {
    let json = slow_pad_json();
    let (mut a, mut b) = rest_twins(&json, 4);
    for p in [&mut a, &mut b] {
        p.note_on(60, 1.0);
    }
    render_both(&mut a, &mut b, 4);
    rest_beside(&mut a, &mut b, 20);
    for p in [&mut a, &mut b] {
        p.note_off(60);
        p.note_on(64, 1.0);
    }
    rest_beside(&mut a, &mut b, 30);
    wake_beside(&mut a, &mut b);
    let (want, got) = (env_of(&a, 64), env_of(&b, 64));
    assert!(want > 0.05, "the key pressed in the rest is rising: {want}");
    assert!((want - got).abs() < 0.03, "{got} against {want}");
    let ringing = |p: &LivePoly| p.voices.iter().filter(|v| v.running).count();
    assert_eq!(ringing(&a), 2, "rendered, 60's tail rings beside 64");
    assert_eq!(ringing(&b), 1, "woken, only the held key sounds");

    // One voice: a key pressed over a held one steals it.
    let (mut a, mut b) = rest_twins(&json, 1);
    for p in [&mut a, &mut b] {
        p.note_on(60, 1.0);
    }
    render_both(&mut a, &mut b, 4);
    rest_beside(&mut a, &mut b, 10);
    for p in [&mut a, &mut b] {
        p.note_on(67, 1.0);
    }
    // Long enough for both to reach the shelf: the rendered steal attacks
    // from the level it took over, the woken one from silence at the steal.
    rest_beside(&mut a, &mut b, 1_200);
    wake_beside(&mut a, &mut b);
    let (want, got) = (env_of(&a, 67), env_of(&b, 67));
    assert!(
        (want - 0.5).abs() < 1e-3,
        "the rendered steal is on the shelf: {want}"
    );
    assert!(
        (want - got).abs() < 0.03,
        "the woken steal is at {got}, not {want}"
    );
    assert_eq!(b.voices[0].voice.gate.get(), GATE_ON, "its gate is up");
}

/// **What the hands do while it wakes counts too.** A key pressed during
/// the wake starts its voice from silence, where a rendered one starts its
/// attack; a key let go during it is let go; and a rest between two of its
/// quanta (Blend back to 0 before it was heard) starts the wake again,
/// still landing where the notes would be.
#[test]
fn what_the_hands_do_while_it_wakes_counts() {
    let json = slow_pad_json();
    let (mut a, mut b) = rest_twins(&json, 4);
    for p in [&mut a, &mut b] {
        p.note_on(60, 1.0);
        p.note_on(67, 1.0);
    }
    render_both(&mut a, &mut b, 4);
    rest_beside(&mut a, &mut b, 1_000);
    render_both(&mut a, &mut b, 2);
    assert!(
        b.resting(),
        "two quanta into a wake of a chord on its shelf"
    );
    for p in [&mut a, &mut b] {
        p.note_on(64, 1.0);
        p.note_off(67);
    }
    // Blend back to 0 for a moment, then up again.
    render_both(&mut a, &mut b, 1);
    rest_beside(&mut a, &mut b, 3);
    wake_beside(&mut a, &mut b);
    for n in [60, 64] {
        let (want, got) = (env_of(&a, n), env_of(&b, n));
        assert!((want - got).abs() < 0.03, "{n}: woke at {got}, not {want}");
    }
    assert!(b.voices.iter().all(|v| v.note != Some(67)), "67 was let go");
    let ringing = b.voices.iter().filter(|v| v.running).count();
    assert_eq!(ringing, 2, "only the two held keys sound");
}

/// **A unison note pressed while resting wakes on every voice.** Unison
/// plays one note on all four voices; pressed during the rest, each of them
/// wakes from silence at that note's place, as each would have rendered.
#[test]
fn a_unison_note_pressed_while_resting_wakes_on_every_voice() {
    let json = slow_pad_json();
    let (mut a, mut b) = rest_twins(&json, 4);
    for p in [&mut a, &mut b] {
        p.set_unison(true, 0.3, 0.7);
    }
    render_both(&mut a, &mut b, 4);
    rest_beside(&mut a, &mut b, 10);
    for p in [&mut a, &mut b] {
        p.note_on(60, 1.0);
    }
    assert!(
        b.voices.iter().all(|v| v.seek == Seek::Fresh),
        "each voice wakes from silence"
    );
    rest_beside(&mut a, &mut b, 200);
    wake_beside(&mut a, &mut b);
    for (i, (va, vb)) in a.voices.iter().zip(&b.voices).enumerate() {
        let (want, got) = (va.voice.env_phase(), vb.voice.env_phase());
        assert!(want > 0.3, "voice {i} is rising: {want}");
        assert!(
            (want - got).abs() < 0.03,
            "voice {i}: woke at {got}, not {want}"
        );
    }
}

/// **A held note under a knob turned mid-wake still wakes.** Where the
/// note would be is worked out from the knobs as they are, as if they had
/// stood there since the key went down. An attack slowed to its slowest
/// while the wake drives a note down from its peak (here as velocity's touch
/// writes a voice's knob, at once) says the note would still be attacking,
/// under the shelf: a fall stops at the shelf, which is where the rendered
/// note is, rather than driving at a level a decay cannot reach for the rest
/// of the wake.
#[test]
fn an_attack_slowed_mid_wake_stops_the_fall_at_the_shelf() {
    let json = slow_pad_json();
    let (mut a, mut b) = rest_twins(&json, 1);
    for p in [&mut a, &mut b] {
        p.note_on(60, 1.0);
    }
    render_both(&mut a, &mut b, 1);
    rest_beside(&mut a, &mut b, 1_200);
    // Three quanta: past the peak, falling toward the shelf.
    render_both(&mut a, &mut b, 3);
    assert!(b.resting());
    assert_eq!(b.voices[0].seek, Seek::Fall);
    for p in [&mut a, &mut b] {
        p.voices[0].amp[0].set(1.0);
    }
    // It arrives at the shelf, well inside the bound that would end it
    // anyway (three quanta are gone already).
    let quanta = 3 + wake_beside(&mut a, &mut b);
    assert!(
        quanta <= CENSUS_WAKE_QUANTA,
        "{quanta} quanta: it never arrived"
    );
    let (want, got) = (env_of(&a, 60), env_of(&b, 60));
    assert!(
        (want - 0.5).abs() < 1e-3,
        "the rendered note is on the shelf: {want}"
    );
    assert!((want - got).abs() < 0.03, "woke at {got}, not {want}");
}

/// **A swap made while resting keeps each held note's start.** A new
/// offer can land in B while its mix is 0: the swap's rebuild goes on
/// through the rest and re-presses the held note on the new voices, but the
/// note started before the swap, and wakes where it would be from then, not
/// from the swap.
#[test]
fn a_swap_made_while_resting_keeps_each_notes_start() {
    let json = slow_pad_json();
    let (mut a, mut b) = rest_twins(&json, 4);
    for p in [&mut a, &mut b] {
        p.note_on(60, 1.0);
    }
    render_both(&mut a, &mut b, 4);
    rest_beside(&mut a, &mut b, 1_000);
    assert!(a.set_patch(&json));
    assert!(b.set_patch(&json));
    let mut patched = 0;
    for _ in 0..100 {
        let _ = a.process(128);
        b.rest(128);
        patched += usize::from(b.poll_event() == EVENT_PATCHED);
    }
    assert_eq!(patched, 1, "the swap landed while resting");
    wake_beside(&mut a, &mut b);
    // From the swap, 0.27 s on, it would be attacking past the shelf.
    let (want, got) = (env_of(&a, 60), env_of(&b, 60));
    assert!(
        (want - 0.5).abs() < 1e-3,
        "the rendered note is on the shelf: {want}"
    );
    assert!((want - got).abs() < 0.03, "woke at {got}, not {want}");
}

/// **A swap that lands while it renders asleep wakes the new voices.** A
/// render that finds a swap waiting goes to the rebuild (nobody heard the
/// old voices fade), and the rebuild ends into a wake, not a fade in: the
/// new voices are as far behind as the old ones were.
#[test]
fn a_swap_waiting_at_the_first_render_wakes_the_new_voices() {
    let json = slow_pad_json();
    let (mut a, mut b) = rest_twins(&json, 4);
    for p in [&mut a, &mut b] {
        p.note_on(60, 1.0);
    }
    render_both(&mut a, &mut b, 4);
    rest_beside(&mut a, &mut b, 1_000);
    assert!(a.set_patch(&json));
    assert!(b.set_patch(&json));
    let mut quanta = 0;
    while !matches!(b.stage, Stage::Wake) {
        assert!(quanta < 16, "the rebuild never ended in a wake");
        let out = b.process(128);
        let _ = a.process(128);
        assert!(out.iter().all(|&s| s == 0.0), "heard before the wake");
        quanta += 1;
    }
    assert!(quanta >= 4, "the four voices were rebuilt first");
    wake_beside(&mut a, &mut b);
    let (want, got) = (env_of(&a, 60), env_of(&b, 60));
    assert!((want - got).abs() < 0.03, "woke at {got}, not {want}");
}

/// A patch that listens, with a slow pad's envelope: an attack of ≈0.25 s
/// time constant, a decay of ≈0.1 s, a sustain of 0.5.
fn slow_listening_json() -> String {
    use auracle_grammar::term::{AmpEnv, AudioNode, InputChannel};
    serde_json::to_string(&PatchTree {
        amp: AmpEnv {
            attack: 0.6,
            decay: 0.5,
            sustain: 0.5,
            release: 0.4,
        },
        root: AudioNode::AudioIn {
            uid: Uid::NEW,
            input: 0,
            gain: auracle_grammar::INPUT_GAIN_UNITY,
            channel: InputChannel::Left,
        },
    })
    .unwrap()
}

/// **A swap carries the open voice's envelope, as it carries a held key's.**
/// Monitored, a patch that listens holds its open voice open; a structural
/// edit that keeps it listening re-presses that voice on the new patch, and
/// it goes on from its envelope's place rather than swelling in again from
/// silence. (Rested, it is not seeded at the swap: the wake drives it from
/// its own start, `the_open_voice_wakes_as_a_held_key_does`.)
#[test]
fn a_swap_carries_the_open_voices_envelope() {
    let json = slow_listening_json();
    quiver::rng::seed(7);
    let mut poly = LivePoly::new(&json, REST_RATE, 4).expect("compiles");
    poly.set_leveler(false);
    poly.set_open(true);
    for _ in 0..2_000 {
        let _ = poly.process(128);
    }
    let open = |p: &LivePoly| p.open.as_ref().expect("an open voice").voice.env_phase();
    assert!(
        (open(&poly) - 0.5).abs() < 1e-3,
        "on the shelf: {}",
        open(&poly)
    );
    assert!(poly.set_patch(&json));
    let mut patched = false;
    for _ in 0..40 {
        let _ = poly.process(128);
        patched |= poly.poll_event() == EVENT_PATCHED;
    }
    assert!(patched, "the swap landed");
    let after = open(&poly);
    assert!(
        (after - 0.5).abs() < 0.03,
        "after the swap it is at {after}, not on its shelf"
    );
}

/// **A swap made while resting keeps the open voice's start, as a held
/// key's.** An offer that listens, swapped for another while B rests with
/// its input monitored: the new open voice is not seeded at the swap (no
/// one hears it), and wakes from when the old one opened.
#[test]
fn a_swap_made_while_resting_keeps_the_open_voices_start() {
    let json = slow_listening_json();
    let (mut a, mut b) = rest_twins(&json, 4);
    for p in [&mut a, &mut b] {
        p.set_open(true);
    }
    render_both(&mut a, &mut b, 4);
    rest_beside(&mut a, &mut b, 2_000);
    assert!(a.set_patch(&json));
    assert!(b.set_patch(&json));
    let mut patched = 0;
    for _ in 0..40 {
        let _ = a.process(128);
        b.rest(128);
        patched += usize::from(b.poll_event() == EVENT_PATCHED);
    }
    assert_eq!(patched, 1, "the swap landed while resting");
    let open = |p: &LivePoly| p.open.as_ref().expect("an open voice").voice.env_phase();
    assert_eq!(open(&b), 0.0, "not seeded at the swap");
    wake_beside(&mut a, &mut b);
    let (want, got) = (open(&a), open(&b));
    assert!(
        (want - 0.5).abs() < 1e-3,
        "the rendered open voice is on its shelf: {want}"
    );
    assert!((want - got).abs() < 0.03, "woke at {got}, not {want}");
}

/// **The open voice wakes as a held key does, and a tracked lead keeps its
/// own gate.** Monitored, a patch that listens holds its open voice open
/// with no key; rested and woken, it comes back at its envelope's place
/// (here opened partway through, so its start is not the instrument's).
/// A tracked patch's lead holds no gate (its tracker opens it): the wake
/// leaves it low rather than holding the voice open itself.
#[test]
fn the_open_voice_wakes_as_a_held_key_does() {
    let listens = slow_listening_json();
    let (mut a, mut b) = rest_twins(&listens, 4);
    render_both(&mut a, &mut b, 10);
    a.set_open(true);
    b.rest(128);
    let _ = a.process(128);
    b.set_open(true);
    rest_beside(&mut a, &mut b, 100);
    wake_beside(&mut a, &mut b);
    let open = |p: &LivePoly| p.open.as_ref().expect("an open voice").voice.env_phase();
    let (want, got) = (open(&a), open(&b));
    assert!(want > 0.3, "the open voice is mid-attack: {want}");
    assert!((want - got).abs() < 0.03, "woke at {got}, not {want}");

    let mut lead = tracked_open(&tracked_patch());
    for _ in 0..20 {
        lead.rest(128);
    }
    let mut quanta = 0;
    while lead.resting() {
        assert!(quanta < 16, "the wake never ended");
        let _ = lead.process(128);
        quanta += 1;
    }
    assert_eq!(quanta, 1, "nothing to drive: awake in one quantum");
    let gate = lead.open.as_ref().expect("the lead").voice.gate.get();
    assert_eq!(gate, 0.0, "the lead's gate is its tracker's");
}
