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
    let mut rng = StdRng::seed_from_u64(0x11FE);
    let json = tree_json(&mut rng);
    let mut poly = LivePoly::new(&json, 44_100.0, 4).expect("compiles");

    poly.note_on(60, 1.0);
    poly.note_on(64, 1.0);
    let mut energy = 0.0f64;
    for _ in 0..40 {
        let out = poly.process(512);
        assert!(out.iter().all(|s| s.is_finite()));
        energy += out.iter().map(|s| (*s as f64) * (*s as f64)).sum::<f64>();
    }
    assert!(energy > 1e-6, "held notes produced silence");

    poly.note_off(60);
    poly.note_off(64);
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
    let (_, tree) = auracle_grammar::presets()
        .into_iter()
        .find(|(n, _)| *n == "First Bass")
        .expect("preset exists");
    let json = serde_json::to_string(&tree).unwrap();
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

/// **Touch.** Velocity reaches timbre, per voice: two notes of one chord
/// at different velocities leave their own voices' wired knob at
/// different values, in the direction asked, and a mezzo note leaves it
/// exactly where the knob is.
#[test]
fn velocity_touch_offsets_its_own_voice_only() {
    use auracle_grammar::term::{AmpEnv, FilterKind, Waveform};
    use auracle_grammar::{AudioNode, ModNode, PatchTree};
    let json = serde_json::to_string(&PatchTree {
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
    .unwrap();
    let mut poly = LivePoly::new(&json, 44_100.0, 4).unwrap();
    assert!(poly.set_touch(r#"[["node#cut", 0.3, 0.5]]"#, 1.0));
    let cut = |poly: &LivePoly, note: u8| {
        let v = poly
            .voices
            .iter()
            .find(|v| v.note == Some(note))
            .expect("voice");
        v.voice.params.get("node#cut").unwrap().value.get()
    };
    poly.note_on(60, 1.0);
    poly.note_on(64, 0.2);
    poly.note_on(67, TOUCH_MEZZO);
    let (loud, soft, mezzo) = (cut(&poly, 60), cut(&poly, 64), cut(&poly, 67));
    assert!(
        loud > mezzo && mezzo > soft,
        "loud {loud} mezzo {mezzo} soft {soft}"
    );
    let home = poly.voices[0]
        .voice
        .params
        .get("node#cut")
        .unwrap()
        .map
        .apply(0.5);
    // Relative: velocity crosses an f32 on the way in (0.6 is not exact
    // there), and the cutoff map is exponential, so the leftover is a few
    // parts per million of the value rather than zero.
    assert!(
        (mezzo - home).abs() < 1e-5 * home.abs(),
        "mezzo moved the knob"
    );
    // Off is off: no offsets on the next note.
    assert!(poly.set_touch("[]", 1.0));
    poly.note_on(72, 1.0);
    assert!((cut(&poly, 72) - home).abs() < 1e-9);
    // Bad input turns touch off rather than half-applying it.
    assert!(!poly.set_touch("not json", 1.0));
    assert!(poly.touch.is_empty());
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
    let mut before = 0.0;
    for _ in 0..20 {
        before = energy(&poly.process(128));
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
    let _ = before;
}

/// The two categorical sites that went live are reachable through the live
/// path at their *own* domain — an index, not a 0..1 knob — and neither
/// forces a recompile.
#[test]
fn table_and_oct_are_live_at_index_scale() {
    use auracle_grammar::term::{AmpEnv, TableShape, Waveform};
    use auracle_grammar::{AudioNode, ModNode, PatchTree};
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
    for _ in 0..40 {
        let _ = poly.process(128);
    }
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
    for _ in 0..60 {
        let _ = poly.process(128);
    }
    let cv = poly.voices[0].voice.params["node#oct"].value.get();
    assert!(
        (cv - 2.0).abs() < 1.0e-3,
        "oct +2 should land on a 2 V trim, not {cv}"
    );
    // No recompile was queued: the swap machinery never woke up.
    assert!(
        matches!(poly.stage, Stage::Run),
        "a live index write started a patch swap"
    );
}

/// The arpeggiator steps through a held chord on its own clock, and
/// velocity scales output level.
#[test]
fn arp_steps_and_velocity_scales() {
    let (_, tree) = auracle_grammar::presets()
        .into_iter()
        .find(|(n, _)| *n == "First Bass")
        .expect("preset exists");
    let json = serde_json::to_string(&tree).unwrap();

    // Velocity: same note, soft vs hard, soft must be quieter.
    let energy_at = |vel: f64| {
        let mut p = LivePoly::new(&json, 44_100.0, 1).unwrap();
        p.note_on(60, vel);
        (0..20)
            .flat_map(|_| p.process(512))
            .map(|s| (s as f64) * (s as f64))
            .sum::<f64>()
    };
    let (soft, hard) = (energy_at(0.15), energy_at(1.0));
    assert!(
        soft < hard * 0.5,
        "velocity had no effect: soft {soft}, hard {hard}"
    );

    // Arp: hold a triad with the arp on; distinct pitches must be
    // pressed over time, and turning it off restores the chord.
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
    }
    assert!(
        seen.len() >= 3,
        "arp never cycled the chord: pressed {seen:?}"
    );
    // At any instant the arp holds at most one gated note.
    let gated = p.voices.iter().filter(|v| v.note.is_some()).count();
    assert!(gated <= 1, "arp gated {gated} notes at once");
    p.set_arp(false, 0, 4.0, 240.0, 0.5, 1, 0.0);
    let gated: Vec<_> = p.voices.iter().filter_map(|v| v.note).collect();
    assert_eq!(gated.len(), 3, "chord not re-pressed after arp off");
}

/// The master bus holds a full chord inside full scale. Four voices sum to
/// ~4× one voice, and before the master limiter existed a four-note chord
/// sat exactly on the rail — hard-clipped, and clipped again by the device
/// conversion because the old ceiling was above 1.0.
#[test]
fn chord_never_exceeds_full_scale() {
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
/// voice is silent at sustain 0 by the time it is stolen, so the fifth note
/// on a four-voice instrument is *only* audible if the ADSR sees a real
/// falling-then-rising gate edge.
#[test]
fn stolen_voice_retriggers_its_envelope() {
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

/// Chaos: random notes, knob writes (real and junk addresses), and
/// patch swaps — output must stay finite forever, no panics.
#[test]
fn live_stress_survives_chaos() {
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
    for i in 0..600 {
        match rng.gen_range(0..10) {
            0 | 1 => poly.note_on(rng.gen_range(36..85), rng.gen_range(0.0..1.2)),
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
            5 if i % 97 == 0 => poly.all_off(),
            _ => {}
        }
        let out = poly.process(128);
        assert!(
            out.iter().all(|s| s.is_finite() && s.abs() <= 1.5),
            "iteration {i}: bad sample"
        );
        let _ = poly.poll_event();
    }
}

/// Glide has to be audible on the thing portamento is *for*: a melody.
/// Voice assignment prefers a free voice, so a line rotates through voices
/// that were never sounding — with per-voice-only portamento every note of
/// a tune started dead on pitch and the fader did nothing you could hear.
#[test]
fn glide_slides_a_line_but_not_a_chord() {
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

/// **A take rendered off the audio thread is the one recording live
/// makes.** The same input, recorded by a live voice quantum by quantum
/// and handed to `render_take` as one buffer, gives the same take, bit
/// for bit; a key with no CAPTURE renders none.
#[test]
fn a_take_rendered_from_the_recorded_input_is_the_live_take() {
    use auracle_grammar::term::{AmpEnv, AudioNode, CaptureMode, InputChannel};
    let tree = serde_json::to_string(&PatchTree {
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
    .unwrap();
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
    use auracle_grammar::term::{AmpEnv, AudioNode, CaptureMode, InputChannel};
    let tree = serde_json::to_string(&PatchTree {
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
    .unwrap();
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
