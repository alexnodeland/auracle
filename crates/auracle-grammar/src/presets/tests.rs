use super::*;
use crate::mutate::{ModKind, NodeKind};
use std::collections::HashSet;

/// `0.01·3000^x` Hz, the LFO/S&H rate map (quiver `oscillators.rs`), as
/// the compiled LFO plays it (`the_rate_map_is_the_one_the_lfo_plays`).
fn mod_hz(cv: f64) -> f64 {
    0.01 * 3000f64.powf(cv)
}

/// The library's modulation floor: every rate it ships is at least this
/// fast (`every_modulation_source_is_audible_within_one_note` says why).
const FLOOR_HZ: f64 = 0.2;

/// The rates of the four LFOs and S&Hs the library first shipped, each too
/// slow to move inside a note: what the floor has to catch.
const ORIGINAL_OFFENDERS: [f64; 4] = [0.15, 0.20, 0.35, 0.35];

/// `0.1·50^x` Hz — the chorus runs its own, much narrower map, which is
/// why it needs its own conversion rather than sharing the LFO's. Missing
/// this is how `Inside Out` ended up with a 0.18 Hz chorus: slower than
/// any LFO in the library, and slower than the floor the library enforces
/// on LFOs, while sitting outside the test that enforces it.
fn chorus_hz(cv: f64) -> f64 {
    0.1 * 50f64.powf(cv)
}

fn hz_of(kind: &str, cv: f64) -> f64 {
    match kind {
        "chorus" => chorus_hz(cv),
        // A step sequence changes value once per step, so the step rate is
        // the rate at which it is heard to move — `0.5·2^(5x)`, whose
        // floor is already above this file's 0.2 Hz gate.
        "steps" => crate::steps::rate_hz(cv),
        _ => mod_hz(cv),
    }
}

/// Walk every modulation source in the library.
fn mod_sources() -> Vec<(&'static str, &'static str, f64)> {
    fn walk(n: &AudioNode, name: &'static str, out: &mut Vec<(&'static str, &'static str, f64)>) {
        // A free function, not a closure over `out`: the chorus arm has
        // to push its own rate *and* note its slot, and a closure holding
        // `out` mutably cannot coexist with that.
        fn note(m: &ModNode, name: &'static str, out: &mut Vec<(&'static str, &'static str, f64)>) {
            match m {
                ModNode::Lfo { rate, .. } => out.push((name, "lfo", *rate)),
                ModNode::Rand { rate, .. } => out.push((name, "s&h", *rate)),
                ModNode::Env { .. } | ModNode::Follow { .. } | ModNode::None => {}
                // A shaper's rate is its subterm's, so recurse rather
                // than reporting the wrapper.
                ModNode::Op { input, .. } => note(input, name, out),
                ModNode::Pair { a, b, .. } => {
                    note(a, name, out);
                    note(b, name, out);
                }
                ModNode::Euclid { rate, .. } => out.push((name, "euclid", *rate)),
                ModNode::Steps { rate, .. } => out.push((name, "steps", *rate)),
            }
        }
        match n {
            AudioNode::Chorus {
                rate,
                modulation,
                input,
                ..
            } => {
                out.push((name, "chorus", *rate));
                note(modulation, name, out);
                walk(input, name, out);
            }
            AudioNode::Filter {
                modulation, input, ..
            }
            | AudioNode::Fold {
                modulation, input, ..
            }
            | AudioNode::Delay {
                modulation, input, ..
            }
            | AudioNode::Reverb {
                modulation, input, ..
            }
            | AudioNode::Distortion {
                modulation, input, ..
            }
            | AudioNode::Bitcrush {
                modulation, input, ..
            }
            | AudioNode::Phaser {
                modulation, input, ..
            }
            | AudioNode::Flanger {
                modulation, input, ..
            }
            | AudioNode::Tremolo {
                modulation, input, ..
            }
            | AudioNode::Vibrato {
                modulation, input, ..
            }
            | AudioNode::Eq {
                modulation, input, ..
            }
            | AudioNode::Granular {
                modulation, input, ..
            }
            | AudioNode::Shift {
                modulation, input, ..
            } => {
                note(modulation, name, out);
                walk(input, name, out);
            }
            // The 2B binaries: a slot *and* two branches, and the control
            // branch's own LFOs are as audible as any other — it drives a
            // detector, and a detector hears everything the ear does.
            AudioNode::Comp {
                modulation,
                input,
                sidechain: other,
                ..
            }
            | AudioNode::Gate {
                modulation,
                input,
                sidechain: other,
                ..
            }
            | AudioNode::Duck {
                modulation,
                input,
                key: other,
                ..
            }
            | AudioNode::Vocoder {
                modulation,
                carrier: input,
                modulator: other,
                ..
            } => {
                note(modulation, name, out);
                walk(input, name, out);
                walk(other, name, out);
            }
            // No slot of their own; their branches can hold one.
            AudioNode::Track { input, listen, .. } => {
                walk(input, name, out);
                walk(listen, name, out);
            }
            AudioNode::Capture { input, .. } => walk(input, name, out),
            // The two oscillators' slots reach *pitch* rather than a
            // timbre parameter, but a rate is a rate: an LFO too slow to
            // complete a cycle inside a note is as inaudible on pitch as
            // it is on a cutoff.
            AudioNode::Wavetable { modulation, .. }
            | AudioNode::Pluck { modulation, .. }
            | AudioNode::Formant { modulation, .. }
            | AudioNode::Vco { modulation, .. }
            | AudioNode::Supersaw { modulation, .. } => note(modulation, name, out),
            AudioNode::Mix { a, b, .. } | AudioNode::RingMod { a, b, .. } => {
                walk(a, name, out);
                walk(b, name, out);
            }
            // None of these has a modulation slot or a child to walk.
            AudioNode::Noise { .. } | AudioNode::Silence { .. } | AudioNode::AudioIn { .. } => {}
        }
    }
    let mut out = Vec::new();
    for p in preset_bank() {
        walk(&p.tree.root, p.name, &mut out);
    }
    out
}

/// The regression this library shipped with for its whole life.
///
/// Every LFO and S&H in the original nine sat between 0.033 Hz and
/// 0.165 Hz — 6 to 30 seconds per cycle — while the audition phrase's
/// longest held note is 1.8 s. Nothing modulated audibly, anywhere, and
/// the warm start taught the model its first eighteen preferences from
/// exactly those patches. The bug was invisible because `rate: 0.15`
/// looks like a slow-ish number rather than a half-minute.
///
/// **The floor is set by the bug it has to catch**, which is the only
/// honest way to pick one. The four original offenders were 0.0332,
/// 0.0496, 0.1648 and 0.1648 Hz; a floor of 0.15 Hz — the first number
/// that "felt slow" — would have waved two of them straight through,
/// while the module doc two hundred lines up calls 0.165 Hz inaudible. A
/// gate that disagrees with its own file is not a gate. 0.2 Hz clears all
/// four with margin and still leaves room for a genuinely slow pad drift,
/// and the gate checks that it still catches every one of them: without
/// that, the floor is a number someone liked rather than one that catches
/// the bug, which is exactly how the first version of it let half of them
/// through.
#[test]
fn every_modulation_source_is_audible_within_one_note() {
    for cv in ORIGINAL_OFFENDERS {
        let f = mod_hz(cv);
        assert!(
            f < FLOOR_HZ,
            "rate {cv} = {f:.4} Hz would now pass the floor it exists to catch"
        );
    }
    let slow: Vec<String> = mod_sources()
        .into_iter()
        .filter(|(_, kind, cv)| hz_of(kind, *cv) < FLOOR_HZ)
        .map(|(name, kind, cv)| {
            let f = hz_of(kind, cv);
            format!(
                "{name} {kind} rate {cv} = {f:.3} Hz ({:.1} s per cycle)",
                1.0 / f
            )
        })
        .collect();
    assert!(
        slow.is_empty(),
        "modulation too slow to hear in a 1.8 s note (floor {FLOOR_HZ} Hz):\n  {}",
        slow.join("\n  ")
    );
}

/// `mod_hz` is the map the compiled LFO plays, not a copy of quiver's that
/// could drift from it while the gate above kept measuring it. A square LFO
/// on a sine's pitch, at full depth, flips the note between two pitches an
/// octave apart twice a cycle; the time from the first flip to the last
/// gives the rate. Two settings, a second and a sixth of a second per
/// cycle, pin both the map's floor and its span, each within 1 % (they
/// read 0.0 % and 0.2 % off; a 10 ms window over the 3.5 s the flips span
/// can be off by 0.6 %).
#[test]
fn the_rate_map_is_the_one_the_lfo_plays() {
    const SR: f64 = 44_100.0;
    // 10 ms windows: the two pitches cross zero about 15 and 30 times in one.
    const WINDOW: usize = 441;
    for hz in [1.0, 6.0] {
        let cv = (hz / 0.01f64).ln() / 3000f64.ln();
        let tree = PatchTree {
            amp: AmpEnv {
                attack: 0.0,
                decay: 0.0,
                sustain: 1.0,
                release: 0.3,
            },
            root: AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Sine,
                octave: 0,
                detune: 0.5,
                mod_depth: 1.0,
                modulation: ModNode::Lfo {
                    uid: Uid::NEW,
                    wave: Waveform::Square,
                    rate: cv,
                },
            },
        };
        quiver::rng::seed(0x1F0_5EED);
        let mut v = crate::compile(&tree, SR).expect("compiles");
        v.pitch.set(2.0);
        v.gate.set(5.0);
        let out: Vec<f64> = (0..(4.0 * SR) as usize).map(|_| v.patch.tick().0).collect();
        let high: Vec<bool> = out
            .chunks_exact(WINDOW)
            .map(|w| {
                w.windows(2)
                    .filter(|p| (p[0] < 0.0) != (p[1] < 0.0))
                    .count()
                    > 22
            })
            .collect();
        let flips: Vec<usize> = (1..high.len())
            .filter(|&i| high[i] != high[i - 1])
            .collect();
        assert!(flips.len() >= 6, "{hz} Hz: only {} flips", flips.len());
        let span = (flips[flips.len() - 1] - flips[0]) as f64 * WINDOW as f64 / SR;
        let played = (flips.len() - 1) as f64 / (2.0 * span);
        assert!(
            (played / mod_hz(cv) - 1.0).abs() < 0.01,
            "rate {cv:.4} plays at {played:.3} Hz; mod_hz says {:.3}",
            mod_hz(cv)
        );
    }
}

/// What the library exercises, tallied in one place so the walker takes
/// one argument instead of eight.
#[derive(Default)]
struct Coverage {
    waves: HashSet<String>,
    lfo_waves: HashSet<String>,
    kinds: HashSet<String>,
    colors: HashSet<String>,
    tables: HashSet<String>,
    drive_modes: HashSet<String>,
    octaves: HashSet<i8>,
    mods: HashSet<String>,
    nodes: HashSet<String>,
}

impl Coverage {
    fn note_mod(&mut self, m: &ModNode) {
        match m {
            ModNode::None => {
                self.mods.insert("none".into());
            }
            ModNode::Lfo { wave, .. } => {
                self.mods.insert("lfo".into());
                self.lfo_waves.insert(format!("{wave:?}"));
            }
            ModNode::Env { .. } => {
                self.mods.insert("env".into());
            }
            ModNode::Rand { .. } => {
                self.mods.insert("rand".into());
            }
            ModNode::Follow { .. } => {
                self.mods.insert("follow".into());
            }
            ModNode::Euclid { .. } => {
                self.mods.insert("euclid".into());
            }
            ModNode::Steps { .. } => {
                self.mods.insert("steps".into());
            }
            ModNode::Op { kind, input, .. } => {
                self.mods.insert(kind.label().into());
                self.note_mod(input);
            }
            ModNode::Pair { kind, a, b, .. } => {
                self.mods.insert(kind.label().into());
                self.note_mod(a);
                self.note_mod(b);
            }
        };
    }

    fn walk(&mut self, n: &AudioNode) {
        match n {
            AudioNode::Vco {
                wave,
                octave,
                modulation,
                ..
            } => {
                self.nodes.insert("vco".into());
                self.waves.insert(format!("{wave:?}"));
                self.octaves.insert(*octave);
                self.note_mod(modulation);
            }
            AudioNode::Supersaw {
                octave, modulation, ..
            } => {
                self.nodes.insert("supersaw".into());
                self.octaves.insert(*octave);
                self.note_mod(modulation);
            }
            AudioNode::Formant {
                octave, modulation, ..
            } => {
                self.nodes.insert("formant".into());
                self.octaves.insert(*octave);
                self.note_mod(modulation);
            }
            AudioNode::Noise { color, .. } => {
                self.nodes.insert("noise".into());
                self.colors.insert(format!("{color:?}"));
            }
            AudioNode::Silence { .. } => {
                self.nodes.insert("silence".into());
            }
            AudioNode::AudioIn { .. } => {
                self.nodes.insert("audio_in".into());
            }
            AudioNode::Wavetable {
                table,
                octave,
                modulation,
                ..
            } => {
                self.nodes.insert("wavetable".into());
                self.tables.insert(format!("{table:?}"));
                self.octaves.insert(*octave);
                self.note_mod(modulation);
            }
            AudioNode::Pluck {
                octave, modulation, ..
            } => {
                self.nodes.insert("pluck".into());
                self.octaves.insert(*octave);
                self.note_mod(modulation);
            }
            AudioNode::Mix { a, b, .. } => {
                self.nodes.insert("mix".into());
                self.walk(a);
                self.walk(b);
            }
            AudioNode::RingMod { a, b, .. } => {
                self.nodes.insert("ringmod".into());
                self.walk(a);
                self.walk(b);
            }
            AudioNode::Filter {
                kind,
                modulation,
                input,
                ..
            } => {
                self.nodes.insert("filter".into());
                self.kinds.insert(format!("{kind:?}"));
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Fold {
                modulation, input, ..
            } => {
                self.nodes.insert("fold".into());
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Delay {
                modulation, input, ..
            } => {
                self.nodes.insert("delay".into());
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Chorus {
                modulation, input, ..
            } => {
                self.nodes.insert("chorus".into());
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Reverb {
                modulation, input, ..
            } => {
                self.nodes.insert("reverb".into());
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Distortion {
                mode,
                modulation,
                input,
                ..
            } => {
                self.nodes.insert("distortion".into());
                self.drive_modes.insert(format!("{mode:?}"));
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Bitcrush {
                modulation, input, ..
            } => {
                self.nodes.insert("bitcrush".into());
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Phaser {
                modulation, input, ..
            } => {
                self.nodes.insert("phaser".into());
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Flanger {
                modulation, input, ..
            } => {
                self.nodes.insert("flanger".into());
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Tremolo {
                modulation, input, ..
            } => {
                self.nodes.insert("tremolo".into());
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Vibrato {
                modulation, input, ..
            } => {
                self.nodes.insert("vibrato".into());
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Eq {
                modulation, input, ..
            } => {
                self.nodes.insert("eq".into());
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Granular {
                modulation, input, ..
            } => {
                self.nodes.insert("granular".into());
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Shift {
                modulation, input, ..
            } => {
                self.nodes.insert("shift".into());
                self.note_mod(modulation);
                self.walk(input);
            }
            AudioNode::Comp {
                modulation,
                input,
                sidechain,
                ..
            } => {
                self.nodes.insert("comp".into());
                self.note_mod(modulation);
                self.walk(input);
                self.walk(sidechain);
            }
            AudioNode::Duck {
                modulation,
                input,
                key,
                ..
            } => {
                self.nodes.insert("duck".into());
                self.note_mod(modulation);
                self.walk(input);
                self.walk(key);
            }
            AudioNode::Gate {
                modulation,
                input,
                sidechain,
                ..
            } => {
                self.nodes.insert("gate".into());
                self.note_mod(modulation);
                self.walk(input);
                self.walk(sidechain);
            }
            AudioNode::Vocoder {
                modulation,
                carrier,
                modulator,
                ..
            } => {
                self.nodes.insert("vocoder".into());
                self.note_mod(modulation);
                self.walk(carrier);
                self.walk(modulator);
            }
            AudioNode::Track { input, listen, .. } => {
                self.nodes.insert("track".into());
                self.walk(input);
                self.walk(listen);
            }
            AudioNode::Capture { input, .. } => {
                self.nodes.insert("capture".into());
                self.walk(input);
            }
        }
    }
}

/// The members of `all` that `used` lacks.
fn unused(all: &[String], used: &HashSet<String>) -> Vec<String> {
    all.iter().filter(|x| !used.contains(*x)).cloned().collect()
}

/// A kind's name on the wire, which is also how the walk above names it.
fn wire_name<T: serde::Serialize>(k: &T) -> String {
    serde_json::to_string(k)
        .expect("a kind serializes")
        .trim_matches('"')
        .to_string()
}

/// The preset library doubles as the instrument's documentation and as the
/// taste model's first evidence, so it has to actually exercise the
/// grammar. Before this it used white noise never, octave ±2 never,
/// `Ladder`/`Rand`/`Fold`/`Mix` once each, and never nested a `Mix`.
#[test]
fn the_library_covers_the_grammar() {
    let mut cov = Coverage::default();
    for p in preset_bank() {
        cov.walk(&p.tree.root);
    }
    let Coverage {
        waves,
        lfo_waves,
        kinds,
        colors,
        tables,
        drive_modes,
        octaves,
        mods,
        nodes,
    } = cov;

    // Each set the library has to cover is read from its type's `ALL`, so a
    // new waveform, filter kind, noise colour, module or modulator that no
    // preset uses fails here, by name.
    let missing = unused(&Waveform::ALL.map(|w| format!("{w:?}")), &waves);
    assert!(
        missing.is_empty(),
        "no preset plays the {missing:?} waveform"
    );
    assert!(
        lfo_waves.len() >= 3,
        "the LFO is only ever run as {lfo_waves:?} — its waveform is a real timbral choice"
    );
    let missing = unused(&FilterKind::ALL.map(|k| format!("{k:?}")), &kinds);
    assert!(missing.is_empty(), "no preset uses the {missing:?} filter");
    let missing = unused(&NoiseColor::ALL.map(|c| format!("{c:?}")), &colors);
    assert!(missing.is_empty(), "no preset plays {missing:?} noise");
    assert!(
        !tables.is_empty(),
        "the wavetable oscillator is never heard"
    );
    assert!(!drive_modes.is_empty(), "the distortion is never heard");
    // Every modulator, the empty slot included: a source no preset
    // demonstrates is a source nobody discovers. The shapers were once held
    // to a weaker bar, as a combinatorial space rather than a list, and the
    // bar passed with `rectify`, `hold` and five of the six combiners in no
    // preset at all, which is that failure exactly (and the bank's
    // auto-namer has no adjectives for a region the library never visits).
    // They are not near-duplicates in practice: `min` and `max` are
    // opposite bargains on the same two modulators, `and` and `or` opposite
    // densities on the same two patterns, and `rectify` is the one that gives
    // a modulator a resting state. If a future one genuinely has nothing of
    // its own to show, the honest move is to cut it from the palette rather
    // than to lower this.
    let missing = unused(&ModKind::ALL.map(|k| wire_name(&k)), &mods);
    assert!(
        missing.is_empty(),
        "no preset uses the {missing:?} modulator"
    );
    // Every module, but the four a player puts in place and the prior never
    // draws: an unplugged socket, AUDIO IN, TRACK and CAPTURE. The library is
    // the warm start's first evidence, so it holds none of those.
    let player = [
        NodeKind::Silence,
        NodeKind::AudioIn,
        NodeKind::Track,
        NodeKind::Capture,
    ];
    let drawn: Vec<String> = NodeKind::ALL
        .iter()
        .filter(|k| !player.contains(k))
        .map(wire_name)
        .collect();
    let missing = unused(&drawn, &nodes);
    assert!(missing.is_empty(), "no preset uses {missing:?}");
    let played = unused(&player.map(|k| wire_name(&k)), &nodes);
    assert_eq!(
        played.len(),
        player.len(),
        "a preset holds a player's module"
    );
    for oct in [-2, -1, 0, 1, 2] {
        assert!(octaves.contains(&oct), "octave {oct} is never used");
    }
}

/// A patch that contains a wavefolder must actually fold.
///
/// `Sour Mash` shipped in the first draft of this library with a folder
/// that did nothing at all: sweeping its threshold across the whole range
/// produced *bit-identical* audio. Quiver's `Wavefolder` folds `x / 5.0`,
/// and `Vco`/`Noise` scale their outputs `* 5.0` while `Supersaw` leaves
/// them at unity — so on a supersaw the signal never reaches the fold
/// threshold and the module is a wire. Nothing caught it: the patch
/// compiled, vetted, rendered, and sounded like a plain supersaw with a
/// confident blurb about hard-switching character.
///
/// So: for every preset with a `Fold` in it, moving the threshold from
/// hard to soft has to move the audio.
#[test]
fn every_wavefolder_actually_folds() {
    fn set_fold(n: &AudioNode, t: f64) -> AudioNode {
        match n {
            // The modulation is deliberately stripped. Sweeping the base
            // threshold while an LFO still rides on it makes the two
            // renders differ for reasons that have nothing to do with
            // folding — which is exactly how the first version of this
            // test passed on the very bug it was written to catch.
            AudioNode::Fold { input, .. } => AudioNode::Fold {
                uid: Uid::NEW,
                threshold: t,
                mod_depth: 0.0,
                modulation: ModNode::None,
                input: Box::new(set_fold(input, t)),
            },
            AudioNode::Filter {
                kind,
                cutoff,
                resonance,
                mod_depth,
                modulation,
                input,
                ..
            } => AudioNode::Filter {
                uid: Uid::NEW,
                kind: *kind,
                cutoff: *cutoff,
                resonance: *resonance,
                mod_depth: *mod_depth,
                modulation: modulation.clone(),
                input: Box::new(set_fold(input, t)),
            },
            AudioNode::Delay {
                time,
                feedback,
                mix,
                mod_depth,
                modulation,
                input,
                ..
            } => AudioNode::Delay {
                uid: Uid::NEW,
                time: *time,
                feedback: *feedback,
                mix: *mix,
                mod_depth: *mod_depth,
                modulation: modulation.clone(),
                input: Box::new(set_fold(input, t)),
            },
            AudioNode::Chorus {
                rate,
                depth,
                mix,
                mod_depth,
                modulation,
                input,
                ..
            } => AudioNode::Chorus {
                uid: Uid::NEW,
                rate: *rate,
                depth: *depth,
                mix: *mix,
                mod_depth: *mod_depth,
                modulation: modulation.clone(),
                input: Box::new(set_fold(input, t)),
            },
            AudioNode::Reverb {
                size,
                damp,
                mix,
                mod_depth,
                modulation,
                input,
                ..
            } => AudioNode::Reverb {
                uid: Uid::NEW,
                size: *size,
                damp: *damp,
                mix: *mix,
                mod_depth: *mod_depth,
                modulation: modulation.clone(),
                input: Box::new(set_fold(input, t)),
            },
            AudioNode::Distortion {
                drive,
                tone,
                mode,
                mod_depth,
                modulation,
                input,
                ..
            } => AudioNode::Distortion {
                uid: Uid::NEW,
                drive: *drive,
                tone: *tone,
                mode: *mode,
                mod_depth: *mod_depth,
                modulation: modulation.clone(),
                input: Box::new(set_fold(input, t)),
            },
            AudioNode::Mix { balance, a, b, .. } => AudioNode::Mix {
                uid: Uid::NEW,
                balance: *balance,
                a: Box::new(set_fold(a, t)),
                b: Box::new(set_fold(b, t)),
            },
            other => other.clone(),
        }
    }
    fn has_fold(n: &AudioNode) -> bool {
        match n {
            AudioNode::Fold { .. } => true,
            AudioNode::Filter { input, .. }
            | AudioNode::Delay { input, .. }
            | AudioNode::Chorus { input, .. }
            | AudioNode::Reverb { input, .. }
            | AudioNode::Distortion { input, .. }
            | AudioNode::Bitcrush { input, .. }
            | AudioNode::Phaser { input, .. } => has_fold(input),
            AudioNode::Mix { a, b, .. } | AudioNode::RingMod { a, b, .. } => {
                has_fold(a) || has_fold(b)
            }
            _ => false,
        }
    }

    const SR: f64 = 44_100.0;
    let render = |tree: &PatchTree| -> f64 {
        quiver::rng::seed(0x0F01_D5EE);
        let mut v = crate::compile(tree, SR).expect("preset compiles");
        v.pitch.set(0.0);
        v.gate.set(5.0);
        let buf: Vec<(f64, f64)> = (0..44_100).map(|_| v.patch.tick()).collect();
        (buf.iter().map(|(l, _)| l * l).sum::<f64>() / buf.len() as f64).sqrt()
    };

    let mut checked = 0;
    for p in preset_bank() {
        if !has_fold(&p.tree.root) {
            continue;
        }
        checked += 1;
        let hard = PatchTree {
            amp: p.tree.amp.clone(),
            root: set_fold(&p.tree.root, 0.2),
        };
        let soft = PatchTree {
            amp: p.tree.amp.clone(),
            root: set_fold(&p.tree.root, 0.95),
        };
        let (a, b) = (render(&hard), render(&soft));
        let rel = (a - b).abs() / a.max(b).max(1e-12);
        assert!(
            rel > 0.02,
            "{}: folding is inert — threshold 0.2 gives rms {a:.6}, 0.95 gives {b:.6} \
             (relative difference {rel:.5}). A `Fold` fed a source that never reaches \
             its threshold is a wire.",
            p.name
        );
    }
    assert!(checked >= 3, "only {checked} folded presets found");
}

/// Categories are what the browser groups by and what the warm start
/// samples across, so a typo'd one would silently create an eighth family
/// of one — and quietly bias the cold start toward it.
#[test]
fn every_preset_declares_a_known_category_and_copy() {
    for p in preset_bank() {
        assert!(
            CATEGORIES.contains(&p.category),
            "{}: unknown category {:?}",
            p.name,
            p.category
        );
        assert!(!p.blurb.is_empty(), "{}: no blurb", p.name);
    }
    for c in CATEGORIES {
        let n = preset_bank().iter().filter(|p| p.category == c).count();
        assert!(
            n >= 3,
            "category {c} has only {n} presets — too thin to sample"
        );
    }
}

/// Names are the handle the user carries back to the bank; two presets
/// with one name is two patches nobody can tell apart.
#[test]
fn preset_names_are_unique() {
    let bank = preset_bank();
    let unique: HashSet<&str> = bank.iter().map(|p| p.name).collect();
    assert_eq!(unique.len(), bank.len(), "duplicate preset name");
}
