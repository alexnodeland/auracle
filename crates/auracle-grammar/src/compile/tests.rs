use super::*;
use crate::term::{AmpEnv, DriveMode, FilterKind, ModNode, NoiseColor, TableShape, Uid, Waveform};

use crate::term;
use crate::tests::{captured, frequency, listening, patch, sine_vco, stream_of, tone, tracked};
use crate::PARAM_MAX;

const SR: f64 = 44_100.0;

/// Quiver's generator seed for a test that ticks audio and has no reason to
/// pick its own: noise, S&H and the analog models draw from it, and unseeded
/// it starts from the clock.
const SEED: u64 = 0x5EED_C0DE;

/// The compiler's recursion stays cheap per level. A wavetable under a
/// sixteen-deep filter stack (over twice the depth ceiling) compiles on a
/// 512 KiB thread. While `Wavetable` and `PitchShifter` were built inside
/// `build_node`, every level of the recursion reserved over 256 KiB and
/// eight levels overflowed a 2 MiB test thread; now a level is ~2.5 KiB.
#[test]
fn deep_trees_compile_on_a_small_stack() {
    let mut root = AudioNode::Wavetable {
        table: TableShape::Sine,
        octave: 0,
        morph: 0.3,
        mod_depth: 0.0,
        modulation: ModNode::None,
        uid: Uid::NEW,
    };
    for _ in 0..16 {
        root = AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::SvfLp,
            cutoff: 0.6,
            resonance: 0.2,
            mod_depth: 0.0,
            input: Box::new(root),
            modulation: ModNode::None,
        };
    }
    let tree = sustained(root);
    let ok = std::thread::Builder::new()
        .stack_size(512 * 1024)
        .spawn(move || compile(&tree, SR).is_ok())
        .unwrap()
        .join()
        .expect("compile overflowed a 512 KiB stack");
    assert!(ok, "the deep tree should compile");
}

fn sustained(root: AudioNode) -> PatchTree {
    PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 1.0,
            release: 0.3,
        },
        root,
    }
}

fn saw() -> AudioNode {
    AudioNode::Vco {
        uid: Uid::NEW,
        wave: Waveform::Saw,
        octave: 0,
        detune: 0.5,
        mod_depth: 0.0,
        modulation: ModNode::None,
    }
}

/// Overwrite one of the compiler's baked constants — a `set_param_by_id`
/// default on the named node's port — in an already compiled voice
/// (quiver writes it straight into the compiled routing plan, and the next
/// tick reads it; no recompile). Every wiring decision in this
/// module that is *not* a knob is such a constant, so this renders the
/// exact counterfactual — the identical graph with one pinned value
/// neutralized.
fn set_constant(v: &mut CompiledVoice, node: &str, port: &str, value: f64) {
    let id = v
        .patch
        .get_node_id_by_name(node)
        .unwrap_or_else(|| panic!("no node `{node}`"));
    assert!(
        v.patch.set_param_by_id(id, port, value),
        "no control port `{port}` on `{node}`"
    );
}

/// A module whose own parameter setter refuses every value. No quiver
/// module refuses a value for a parameter it has today, so this stands in
/// for the third reason a pin cannot take.
struct Refuses(PortSpec);
impl GraphModule for Refuses {
    fn port_spec(&self) -> &PortSpec {
        &self.0
    }
    fn tick(&mut self, _: &PortValues, _: &mut PortValues) {}
    fn reset(&mut self) {}
    fn set_sample_rate(&mut self, _: f64) {}
    fn introspect(&self) -> Option<&dyn quiver::introspection::ModuleIntrospection> {
        Some(self)
    }
    fn introspect_mut(&mut self) -> Option<&mut dyn quiver::introspection::ModuleIntrospection> {
        Some(self)
    }
}
impl quiver::introspection::ModuleIntrospection for Refuses {
    fn param_infos(&self) -> Vec<quiver::introspection::ParamInfo> {
        vec![quiver::introspection::ParamInfo::new("depth", "Depth")]
    }
    fn set_param_by_id(&mut self, _: &str, _: f64) -> bool {
        false
    }
}

/// A pin that cannot take says why, because each cause is a different
/// compiler mistake: a cable already on the control input (quiver 0.4.0
/// refuses the pin rather than letting the cable shadow it), an id that
/// is not a control input and that the module's own setter refuses, or no
/// such input or parameter at all.
#[test]
fn a_pin_that_cannot_take_says_why() {
    let mut patch = Patch::new(SR);
    let gate = patch.add(
        "io:gate",
        ExternalInput::gate(Arc::new(AtomicF64::new(0.0))),
    );
    let pitch = patch.add(
        "io:pitch",
        ExternalInput::voct(Arc::new(AtomicF64::new(0.0))),
    );
    let mut c = Compiler {
        patch,
        pitch_out: pitch.out("out"),
        gate_out: gate.out("out"),
        params: HashMap::new(),
        taps: Vec::new(),
        input: None,
        track_gates: Vec::new(),
        records: HashMap::new(),
        follow: false,
        track_feeds: HashMap::new(),
        pins: Vec::new(),
    };
    let adsr = c.patch.add("t:adsr", Adsr::new(SR));
    c.constant(0.5, adsr.id(), "sustain")
        .expect("an unpatched control input takes a pin");
    c.patch.connect(c.gate_out, adsr.in_("release")).unwrap();
    let err = c.constant(0.5, adsr.id(), "release").unwrap_err();
    assert!(
        matches!(&err, PatchError::CompilationFailed(m) if m.contains("shadowed")),
        "a cabled input: {err}"
    );
    let refuses = c.patch.add(
        "t:refuses",
        Refuses(PortSpec {
            inputs: Vec::new(),
            outputs: Vec::new(),
        }),
    );
    let err = c.constant(0.5, refuses.id(), "depth").unwrap_err();
    assert!(
        matches!(&err, PatchError::CompilationFailed(m) if m.contains("refused")),
        "a parameter its module refuses: {err}"
    );
    let err = c.constant(0.5, adsr.id(), "no_such_input").unwrap_err();
    assert!(
        matches!(err, PatchError::InvalidPort { .. }),
        "no such input: {err}"
    );
}

fn hold(v: &mut CompiledVoice, voct: f64, n: usize) -> Vec<(f64, f64)> {
    v.pitch.set(voct);
    v.gate.set(5.0);
    (0..n).map(|_| v.patch.tick()).collect()
}

fn rms(buf: &[(f64, f64)]) -> f64 {
    (buf.iter().map(|(l, _)| l * l).sum::<f64>() / buf.len() as f64).sqrt()
}

/// Every term node gets a tap, each tap names a port that resolves, and
/// the taps read *different* signals from each other.
///
/// The last clause is the one with teeth. A map that pointed every key at
/// the root's output would satisfy "resolves and is nonzero" while being
/// useless — the flow animation would show one number on every wire. So
/// the fixture crossfades a saw against silence-adjacent noise and asserts
/// the two branches read apart from each other, which only holds if each
/// key resolved to the node that actually ends *its* chain.
#[test]
fn taps_name_a_live_port_on_every_term_node() {
    let tree = sustained(AudioNode::Mix {
        uid: Uid::NEW,
        balance: 0.5,
        a: Box::new(saw()),
        b: Box::new(AudioNode::Noise {
            uid: Uid::NEW,
            color: NoiseColor::White,
        }),
    });
    // The noise draws from quiver's generator: seeded, the render is the
    // same on every run.
    quiver::rng::seed(0x7A95_5EED);
    let mut v = compile(&tree, SR).expect("compiles");

    for key in ["node", "node/0", "node/1"] {
        assert!(v.taps.contains_key(key), "no tap recorded for `{key}`");
    }
    assert_eq!(v.taps.len(), 3, "one tap per term node, no more");

    // Read each tap while the voice sounds. Reading through the same
    // `get_output_value` path the observer uses keeps the test honest
    // about what a subscription would actually see.
    let read = |v: &CompiledVoice, key: &str| -> f64 {
        let (name, port) = v.taps.get(key).expect("tap");
        let id = v
            .patch
            .get_node_id_by_name(name)
            .unwrap_or_else(|| panic!("tap `{key}` names `{name}`, which is not in the patch"));
        v.patch.get_output_value(id, *port).expect("port resolves")
    };

    let mut saw_trace = Vec::new();
    let mut noise_trace = Vec::new();
    v.pitch.set(0.0);
    v.gate.set(5.0);
    for _ in 0..2048 {
        v.patch.tick();
        saw_trace.push(read(&v, "node/0"));
        noise_trace.push(read(&v, "node/1"));
    }

    let energy = |t: &[f64]| (t.iter().map(|s| s * s).sum::<f64>() / t.len() as f64).sqrt();
    assert!(energy(&saw_trace) > 0.0, "the saw branch reads silent");
    assert!(energy(&noise_trace) > 0.0, "the noise branch reads silent");
    // A saw is periodic and noise is not, so per-sample equality across a
    // 2048-sample window would take a coincidence that cannot happen.
    assert!(
        saw_trace
            .iter()
            .zip(&noise_trace)
            .any(|(a, b)| (a - b).abs() > 1e-9),
        "both branches read the same signal — the taps are not per-node"
    );
}

/// Filter keytracking is wired and follows the keyboard. White noise is a
/// pitch-independent source, so *any* change of level with pitch through a
/// fixed-cutoff lowpass is the keytrack and nothing else — and with
/// `keytrack_amt` neutralized the level must stop moving entirely.
#[test]
fn filter_tracks_the_keyboard() {
    let tree = sustained(AudioNode::Filter {
        uid: Uid::NEW,
        kind: FilterKind::SvfLp,
        cutoff: 0.3,
        resonance: 0.0,
        mod_depth: 0.0,
        input: Box::new(AudioNode::Noise {
            uid: Uid::NEW,
            color: NoiseColor::White,
        }),
        modulation: ModNode::None,
    });
    let level = |amt: Option<f64>, voct: f64| {
        let mut v = compile(&tree, SR).expect("compiles");
        if let Some(a) = amt {
            set_constant(&mut v, "node:svf", "keytrack_amt", a);
        }
        // Every leg hears the *same* noise. quiver's noise draws from a
        // thread-local RNG seeded from the system clock, so without this
        // each measurement gets a different realisation — and the patch
        // ends in a limiter, whose gain reduction tracks peak statistics
        // rather than RMS, so the difference between two realisations is
        // far larger than sampling error. Measured over 120 unseeded runs
        // the flat-control ratio spread from 0.0000 to 0.1332 against a
        // 0.1 tolerance: a 1.7%-per-run CI failure that says nothing about
        // keytracking. Seeded, both legs differ only by the thing under
        // test, which is also why the tolerance below can be tight.
        quiver::rng::seed(0x5EED_1E55);
        let out = hold(&mut v, voct, 88_200);
        rms(&out[44_100..])
    };
    let (low, mid, high) = (level(None, -2.0), level(None, 0.0), level(None, 2.0));
    assert!(
        low < mid && mid < high && high > low * 1.8,
        "cutoff does not follow pitch: C2 {low:.4}, C4 {mid:.4}, C6 {high:.4}"
    );
    // Counterfactual: amount 0 is quiver's default, i.e. the old behaviour.
    let (flat_low, flat_high) = (level(Some(0.0), -2.0), level(Some(0.0), 2.0));
    assert!(
        (flat_high / flat_low - 1.0).abs() < 0.01,
        "control is not flat, so the test proves nothing: \
         C2 {flat_low:.4}, C6 {flat_high:.4}"
    );
}

/// The DC blocker removes the ladder's saturation offset. `diode_sat` is
/// deliberately asymmetric and audio reaches it at nominal ±5 V, so without
/// the blocker the amp envelope multiplies a standing offset into a thump
/// on every note.
#[test]
fn dc_blocker_removes_the_ladder_offset() {
    quiver::rng::seed(SEED);
    let tree = sustained(AudioNode::Filter {
        uid: Uid::NEW,
        kind: FilterKind::Ladder,
        cutoff: 0.35,
        resonance: 0.3,
        mod_depth: 0.0,
        input: Box::new(saw()),
        modulation: ModNode::None,
    });
    let mut v = compile(&tree, SR).expect("compiles");
    let n = (SR * 5.0) as usize;
    let out = hold(&mut v, -2.0, n);
    let tail = &out[n / 2..];
    let dc = tail.iter().map(|(l, _)| l).sum::<f64>() / tail.len() as f64;
    let level = rms(tail);
    assert!(level > 0.1, "patch was silent, nothing to measure");
    assert!(
        dc.abs() / level < 2.0e-3,
        "standing DC offset {dc:.6} against {level:.4} rms"
    );
}

/// Reverb and chorus keep both tanks all the way to the stereo output, and
/// a mono tree still normals right to left rather than going silent.
#[test]
fn stereo_tanks_reach_the_output() {
    quiver::rng::seed(SEED);
    let mut wide = compile(
        &sustained(AudioNode::Reverb {
            uid: Uid::NEW,
            size: 0.7,
            damp: 0.4,
            mix: 0.6,
            mod_depth: 0.0,
            modulation: ModNode::None,
            input: Box::new(saw()),
        }),
        SR,
    )
    .expect("compiles");
    let out = hold(&mut wide, 0.0, 44_100);
    let tail = &out[22_050..];
    let width: f64 = tail.iter().map(|(l, r)| (l - r).abs()).sum::<f64>() / tail.len() as f64;
    assert!(
        width > 1.0e-2,
        "reverb collapsed to mono (width {width:.5})"
    );

    let mut narrow = compile(&sustained(saw()), SR).expect("compiles");
    let out = hold(&mut narrow, 0.0, 4_410);
    assert!(
        out.iter().all(|(l, r)| l == r) && rms(&out) > 1.0e-3,
        "mono tree lost its right channel"
    );
}

/// The wavefolder's `#thresh` knob is live *while the fold is modulated*.
/// `Wavefolder::new` only sets port 1's default, and quiver ignores a
/// default the moment any cable lands on the port — so the knob used to go
/// silently dead exactly when a mod source was attached.
#[test]
fn fold_threshold_stays_live_under_modulation() {
    quiver::rng::seed(SEED);
    let tree = sustained(AudioNode::Fold {
        uid: Uid::NEW,
        threshold: 0.5,
        mod_depth: 0.6,
        input: Box::new(saw()),
        modulation: ModNode::Lfo {
            uid: Uid::NEW,
            wave: Waveform::Sine,
            rate: 0.4,
        },
    });
    let at = |thresh: f64| {
        let mut v = compile(&tree, SR).expect("compiles");
        v.params
            .get("node#thresh")
            .expect("fold threshold has no live handle")
            .set_normalized(thresh);
        let out = hold(&mut v, 0.0, 44_100);
        rms(&out[22_050..])
    };
    let (hard, soft) = (at(0.0), at(1.0));
    assert!(
        (hard - soft).abs() / soft.max(1.0e-9) > 0.05,
        "fold threshold knob is inaudible: {hard:.4} vs {soft:.4}"
    );
    // The mod depth advertised by `describe.rs` is a live handle too, so
    // dragging it no longer forces a whole-patch recompile.
    assert!(
        tree_params(&tree).contains(&"node#mdepth".to_string()),
        "mod depth has no live handle"
    );
}

/// Zero crossings per window, over `windows` equal slices of `buf`.
///
/// A sine's crossing count is a direct read of its instantaneous
/// frequency and is blind to amplitude, so this survives the amp envelope
/// and the limiter sitting between the oscillator and the measurement.
fn crossings_per_window(buf: &[(f64, f64)], windows: usize) -> Vec<usize> {
    let w = buf.len() / windows;
    (0..windows)
        .map(|i| {
            buf[i * w..(i + 1) * w]
                .windows(2)
                .filter(|p| (p[0].0 < 0.0) != (p[1].0 < 0.0))
                .count()
        })
        .collect()
}

/// Pitch modulation is **in octaves**, and the taper's full depth is
/// exactly ±0.5 of one.
///
/// This is the wave-2A capability nothing else in the grammar offers, and
/// the arithmetic behind it is a three-step chain that is easy to get
/// wrong by a factor of five: the [`Attenuverter`]'s gain is `level / 5`,
/// its ±5 V source therefore arrives at `±level` **volts**, and the
/// [`Offset`] it lands on is V/Oct — so the level *is* the octave depth.
/// At `mod_depth` 1.0 that is ±0.5 octave, i.e. the fastest moment of the
/// sweep is a full **2×** the slowest. Asserting the ratio rather than
/// "something moved" is what makes this a test of the mapping instead of
/// a test that a cable exists.
///
/// The LFO runs one full cycle across the render, so the measurement does
/// not depend on where its phase starts.
#[test]
fn pitch_modulation_spans_exactly_one_octave_at_full_depth() {
    quiver::rng::seed(SEED);
    let vco = |mod_depth: f64| AudioNode::Vco {
        uid: Uid::NEW,
        wave: Waveform::Sine,
        octave: 0,
        detune: 0.5,
        mod_depth,
        modulation: ModNode::Lfo {
            uid: Uid::NEW,
            wave: Waveform::Sine,
            // 0.01·3000^x Hz ⇒ 0.5 Hz, one cycle in the 2 s rendered.
            rate: 0.4886,
        },
    };
    // Held two octaves up: a 100 ms window then spans ~420 crossings, so
    // the ±1 quantization of counting them is 0.2% rather than the 4% it
    // would be at C4 — which is the difference between "the depth-0 leg is
    // inert" being a measurement and being a hope.
    let span = |mod_depth: f64| {
        let mut v = compile(&sustained(vco(mod_depth)), SR).expect("compiles");
        let out = hold(&mut v, 2.0, 88_200);
        let counts = crossings_per_window(&out, 20);
        let hi = *counts.iter().max().expect("windows") as f64;
        let lo = *counts.iter().min().expect("windows") as f64;
        hi / lo.max(1.0)
    };

    let full = span(1.0);
    assert!(
        (1.8..2.2).contains(&full),
        "full pitch depth spans {full:.3}× in frequency, not the 2.0× that \
         ±0.5 octave means — the attenuverter/V-Oct arithmetic is off"
    );
    // A tenth of the knob is the vibrato corner: ±0.05 octave ≈ ±60 cents,
    // so the span is 2^0.1 ≈ 1.072. Linear taper, so this follows from the
    // number above — and would not if the taper were square-law.
    let tenth = span(0.1);
    assert!(
        (1.03..1.12).contains(&tenth),
        "pitch depth 0.1 spans {tenth:.4}×, not the ~1.072× a linear taper gives"
    );
    // And the cable is inert at zero depth rather than merely quiet.
    let none = span(0.0);
    assert!(
        none < 1.02,
        "an empty pitch depth still moved the pitch by {none:.4}×"
    );
}

/// The EQ's modulation slot lands on a **volt-scaled** port, and is taken
/// to that port's own scale rather than the normalized one.
///
/// quiver reads `ParametricEq`'s bands as `cv/5 · 12` dB. The taper every
/// other slot in this grammar uses is sized for a 0..1 CV — half of full
/// scale, i.e. ±0.5 V — which on this port is **±1.2 dB at full depth**,
/// about the level JND. That is a mod slot that does nothing across its
/// entire travel, and it reviews as correct because the cable is there.
/// `DepthScale::Gain` reaches the port's own ±5 V, so full depth is a
/// ±12 dB pump.
///
/// The two tapers differ by exactly 10×, which is what makes this
/// measurable rather than arguable: **`mod_depth` 0.1 under the gain taper
/// is precisely what `mod_depth` 1.0 would have been under the normalized
/// one**, so the same render measures both designs. A sine parked on the
/// bell's centre (≈1.26 kHz, i.e. 2.27 octaves above C4) makes the band's
/// gain the whole signal's gain; the voice limiter clips the boost half,
/// so what the swing reports is the cut half reaching its full −12 dB.
#[test]
fn eq_modulation_reaches_the_bands_own_volt_scale() {
    quiver::rng::seed(SEED);
    let eq = |mod_depth: f64| AudioNode::Eq {
        uid: Uid::NEW,
        low: 0.5,
        mid: 0.5,
        high: 0.5,
        mod_depth,
        input: Box::new(AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Sine,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
        }),
        modulation: ModNode::Lfo {
            uid: Uid::NEW,
            wave: Waveform::Sine,
            rate: 0.4886, // 0.5 Hz — one cycle in the 2 s rendered
        },
    };
    let swing = |mod_depth: f64| {
        let mut v = compile(&sustained(eq(mod_depth)), SR).expect("compiles");
        let out = hold(&mut v, 2.27, 88_200);
        let w = out.len() / 20;
        let levels: Vec<f64> = (0..20).map(|i| rms(&out[i * w..(i + 1) * w])).collect();
        let hi = levels.iter().cloned().fold(0.0_f64, f64::max);
        let lo = levels.iter().cloned().fold(f64::MAX, f64::min);
        hi / lo.max(1.0e-12)
    };

    // −12 dB is 3.98×; anything near it means the cable reached the port.
    let full = swing(1.0);
    assert!(
        full > 3.5,
        "eq modulation swings the level only {full:.3}× at full depth, not \
         the ~4× that ±12 dB on the mid band means"
    );
    // The counterfactual: the normalized taper's entire travel, which is
    // a hair over the level JND and 4% of the swing above.
    let as_normalized = swing(0.1);
    assert!(
        as_normalized < 1.25,
        "the normalized taper reaches {as_normalized:.3}× here — if that is \
         no longer ~1.15× the 10× ratio between the two tapers has moved"
    );
    // And the cable is inert at zero depth rather than merely quiet.
    let none = swing(0.0);
    assert!(
        none < 1.05,
        "an empty eq mod depth still moved the level by {none:.3}×"
    );
}

/// Magnitude of `buf` at `hz`, normalized by length — a one-bin DFT.
///
/// The pitch shifter's output is a windowed sum of two resampled grains,
/// so counting zero crossings measures the grain boundaries as much as the
/// pitch. Correlating against the tone being looked for does not.
fn tone_mag(buf: &[(f64, f64)], hz: f64, sr: f64) -> f64 {
    let (mut re, mut im) = (0.0, 0.0);
    for (n, (l, _)) in buf.iter().enumerate() {
        let w = std::f64::consts::TAU * hz * n as f64 / sr;
        re += l * w.cos();
        im += l * w.sin();
    }
    (re * re + im * im).sqrt() / buf.len() as f64
}

/// `lowpass_response` is what a compiled lowpass does on the held note:
/// a sine at C4 through a compiled `SvfLp` comes out scaled by the
/// response's gain at C4, at a corner above, near and below the note,
/// with and without resonance. Every case keeps C4 at or under unity: the
/// voice's limiter holds a full-scale sine at 5 V, so a resonant peak on
/// the note would measure the limiter, not the filter.
#[test]
fn lowpass_response_is_the_compiled_filter() {
    quiver::rng::seed(SEED);
    let c4 = 261.625_565;
    let gain_at = |h: &[f64], hz: f64| {
        let (mut re, mut im) = (0.0, 0.0);
        for (n, x) in h.iter().enumerate() {
            let w = std::f64::consts::TAU * hz * n as f64 / SR;
            re += x * w.cos();
            im -= x * w.sin();
        }
        (re * re + im * im).sqrt()
    };
    let through = |cutoff: f64, res: f64| {
        let tree = sustained(AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::SvfLp,
            cutoff,
            resonance: res,
            mod_depth: 0.0,
            input: Box::new(sine_src()),
            modulation: ModNode::None,
        });
        let mut v = compile(&tree, SR).expect("compiles");
        let out = hold(&mut v, 0.0, 88_200);
        tone_mag(&out[44_100..], c4, SR)
    };
    let dry = {
        let mut v = compile(&sustained(sine_src()), SR).expect("compiles");
        let out = hold(&mut v, 0.0, 88_200);
        tone_mag(&out[44_100..], c4, SR)
    };
    for (hz, res) in [(2_000.0, 0.0), (300.0, 0.345), (120.0, 0.345), (150.0, 0.8)] {
        let cutoff = (hz / 20.0_f64).ln() / 1000.0_f64.ln();
        assert!((cutoff_hz(cutoff) - hz).abs() < 1e-6);
        let want = gain_at(&lowpass_response(cutoff, res, SR, 16_384), c4);
        let got = through(cutoff, res) / dry;
        assert!(
            (20.0 * (got / want).log10()).abs() < 0.25,
            "a {hz} Hz lowpass (res {res}) passed C4 at {got:.4}, its response says {want:.4}"
        );
    }
}

/// The semitone offset (over `range`) whose tone is strongest in `buf`,
/// relative to `base_hz`.
fn dominant_semitone(buf: &[(f64, f64)], base_hz: f64, range: i32) -> i32 {
    (-range..=range)
        .max_by(|a, b| {
            let m = |k: &i32| tone_mag(buf, base_hz * 2f64.powf(*k as f64 / 12.0), SR);
            m(a).total_cmp(&m(b))
        })
        .expect("non-empty range")
}

fn sine_src() -> AudioNode {
    AudioNode::Vco {
        uid: Uid::NEW,
        wave: Waveform::Sine,
        octave: 0,
        detune: 0.5,
        mod_depth: 0.0,
        modulation: ModNode::None,
    }
}

/// A plucked string, the default key/sidechain branch — and the quietest
/// source in the palette, which is the whole reason the threshold knobs
/// are geometric.
fn pluck_key() -> AudioNode {
    AudioNode::Pluck {
        uid: Uid::NEW,
        octave: -1,
        damping: 0.4,
        brightness: 0.7,
        mod_depth: 0.0,
        modulation: ModNode::None,
    }
}

/// Per-window RMS over `n` equal slices, with quiver's noise RNG seeded.
///
/// The seed is not optional here: every one of these patches is keyed from
/// a Karplus-Strong string, whose excitation is drawn from a clock-seeded
/// thread-local RNG — so an unseeded run measures a different string each
/// time, and a gate's close *time* moves by hundreds of milliseconds
/// between realisations.
fn window_rms(tree: &PatchTree, voct: f64, n: usize) -> Vec<f64> {
    quiver::rng::seed(0x2B_5EED);
    let mut v = compile(tree, SR).expect("compiles");
    let out = hold(&mut v, voct, 44_100);
    let w = out.len() / n;
    (0..n).map(|i| rms(&out[i * w..(i + 1) * w])).collect()
}

/// The pitch shifter's `#semis` knob is in **semitones**, on quiver's own
/// scale, with unison at knob centre.
///
/// quiver reads the port as `cv/5 · 24` semitones and hard-clamps at ±24
/// (`PitchShifter`, nonlinear.rs), so this is the third member of the
/// family of errors wave 2A kept making: a control that reviews as correct
/// because the cable exists and is off by a factor. Passing the raw 0..1
/// knob would have given 0..+4.8 semitones with **no downward shift at
/// all** — a "pitch shift" that can only go up, and only by a third.
///
/// Measured as a one-bin DFT rather than by counting zero crossings,
/// because the output is a windowed sum of two resampled grains: the grain
/// boundaries cross zero too.
#[test]
fn pitch_shift_lands_on_quivers_semitone_scale() {
    quiver::rng::seed(SEED);
    // C4 held two octaves up, so a 1 s window resolves the interval and
    // the grain-rate sidebands sit further from the fundamental.
    let base = 261.625_565 * 4.0;
    let at = |semis: f64| {
        let tree = sustained(AudioNode::Shift {
            uid: Uid::NEW,
            semis,
            window: 0.5,
            mix: 1.0, // fully wet: the dry copy would win every bin
            mod_depth: 0.0,
            input: Box::new(sine_src()),
            modulation: ModNode::None,
        });
        let mut v = compile(&tree, SR).expect("compiles");
        let out = hold(&mut v, 2.0, 88_200);
        dominant_semitone(&out[44_100..], base, 14)
    };
    for (knob, want) in [(0.0, -12), (0.5, 0), (1.0, 12)] {
        let got = at(knob);
        assert!(
            (got - want).abs() <= 1,
            "shift knob {knob} transposes {got:+} semitones, not {want:+} — \
             the ±12-at-the-ends, unison-at-centre map is off"
        );
    }
}

/// ...and its modulation slot lands on that same semitone scale rather
/// than on the normalized one every other slot in the grammar uses.
///
/// The two tapers differ by exactly 5× (`SHIFT_PEAK_V` 2.5 V against
/// `PEAK_NORMALIZED` 0.5), which is what makes this measurable rather than
/// arguable: **`mod_depth` 0.2 under the shift taper is precisely what
/// `mod_depth` 1.0 would have been under the normalized one**, so the same
/// render measures both designs.
#[test]
fn pitch_shift_modulation_reaches_the_ports_own_semitone_scale() {
    quiver::rng::seed(SEED);
    let base = 261.625_565 * 4.0;
    let span = |mod_depth: f64| {
        let tree = sustained(AudioNode::Shift {
            uid: Uid::NEW,
            semis: 0.5,
            window: 0.5,
            mix: 1.0,
            mod_depth,
            input: Box::new(sine_src()),
            modulation: ModNode::Lfo {
                uid: Uid::NEW,
                wave: Waveform::Triangle,
                rate: 0.4886, // ≈0.5 Hz — one cycle in the 2 s rendered
            },
        });
        let mut v = compile(&tree, SR).expect("compiles");
        let out = hold(&mut v, 2.0, 88_200);
        let w = out.len() / 16;
        let ks: Vec<i32> = (0..16)
            .map(|i| dominant_semitone(&out[i * w..(i + 1) * w], base, 14))
            .collect();
        ks.iter().max().expect("windows") - ks.iter().min().expect("windows")
    };

    let full = span(1.0);
    assert!(
        full >= 18,
        "full shift depth sweeps only {full} semitones, not the ~24 that \
         ±12 means — the attenuverter arithmetic is off"
    );
    // The counterfactual: the normalized taper's *entire* travel.
    let as_normalized = span(0.2);
    assert!(
        as_normalized <= 8,
        "the normalized taper sweeps {as_normalized} semitones here — if \
         that is no longer ~5 the 5× ratio between the two tapers has moved"
    );
    assert_eq!(span(0.0), 0, "an empty shift depth still moved the pitch");
}

/// The three dynamics thresholds are **geometric over 0.05–5 V**, and they
/// have to be, because this instrument's sources are not on one level.
///
/// quiver reads all three as a plain `cv · 5` volts against a smoothed
/// `|x|` detector, so passing the raw knob through is the obvious thing —
/// and it produces a gate that never opens. Measured mean `|x|` on a held
/// note: sine vco 3.18 V, plucked string 0.14 V. The pluck is what a gate
/// or a ducker is usually keyed from, and under the linear map its whole
/// useful range sat below knob position 0.1.
///
/// The arithmetic first, then the behaviour it buys: with the default key
/// branch the gate must both **open** on the pluck's attack and **shut**
/// again as the string decays, inside one held note.
#[test]
fn the_dynamics_threshold_knob_spans_the_levels_the_palette_produces() {
    let volts = |x: f64| map::detector_threshold(x) * 5.0;
    assert!((volts(0.0) - 0.05).abs() < 1e-9, "bottom of the knob moved");
    assert!((volts(1.0) - 5.0).abs() < 1e-9, "top of the knob moved");
    // Geometric: the midpoint is the geometric mean, not the arithmetic
    // one (which would be 2.5 V and put every non-oscillator off the dial).
    assert!((volts(0.5) - 0.5).abs() < 1e-3, "the knob is not geometric");
    assert!(
        volts(0.35) < 0.3,
        "knob 0.35 asks for {:.3} V — under the linear map it asked for \
         1.75 V, which no key in the palette ever reaches",
        volts(0.35)
    );

    // The behaviour. `range` 0.7 means a shut gate passes 0.3 of the
    // signal, so open and shut differ by ~10 dB and are unmistakable.
    let gated = sustained(AudioNode::Gate {
        uid: Uid::NEW,
        threshold: 0.45,
        range: 0.7,
        release: 0.3,
        mod_depth: 0.0,
        input: Box::new(sine_src()),
        sidechain: Box::new(pluck_key()),
        modulation: ModNode::None,
    });
    let levels = window_rms(&gated, 0.0, 20);
    let (hi, lo) = (
        levels.iter().cloned().fold(0.0_f64, f64::max),
        levels.iter().cloned().fold(f64::MAX, f64::min),
    );
    assert!(
        hi / lo.max(1e-12) > 2.5,
        "the gate never changes state across a held note: {levels:?}"
    );
    // ...and in that order: open on the transient, shut on the decay.
    assert!(
        levels[1] > 2.0 * levels[19],
        "the gate did not open on the attack and shut on the decay: {levels:?}"
    );
}

/// The ducker's two knobs are **offsets from quiver's own knob base**, not
/// plain CVs — and getting that wrong is a control that is at full depth
/// across its entire travel.
///
/// `Ducker` reads `amount` and `threshold` through a `ModulatedParam`
/// (`base + cv/5`, dynamics.rs) whose base is set in `Ducker::new` and is
/// reachable only from Rust, not from a port. `amount`'s base is **1.0**,
/// so passing the raw 0..1 knob would have run the parameter from 1.0 to
/// 1.2 and clamped: full ducking at every knob position, including zero.
#[test]
fn the_ducker_knob_offsets_quivers_own_base() {
    let ducked = |amount: f64| {
        let tree = sustained(AudioNode::Duck {
            uid: Uid::NEW,
            amount,
            threshold: 0.4,
            release: 0.35,
            mod_depth: 0.0,
            input: Box::new(sine_src()),
            key: Box::new(pluck_key()),
            modulation: ModNode::None,
        });
        let levels = window_rms(&tree, 0.0, 10);
        // The key decays, so the deepest duck is at the start.
        levels[0]
    };
    let (open, deep) = (ducked(0.0), ducked(1.0));
    assert!(
        deep < open * 0.5,
        "full duck depth only reaches {deep:.3} against {open:.3} unducked"
    );
    // The end that the raw-knob bug would have destroyed: at zero the
    // module must be a wire.
    let dry = window_rms(&sustained(sine_src()), 0.0, 10)[0];
    assert!(
        (open - dry).abs() / dry < 0.02,
        "a ducker at amount 0 is not a wire: {open:.3} against {dry:.3}"
    );
    // Monotone in between, so the knob is a depth and not a switch.
    let mid = ducked(0.5);
    assert!(
        deep < mid && mid < open,
        "duck depth is not monotone: {deep:.3} {mid:.3} {open:.3}"
    );
}

/// The ducker's modulation slot lands on a `ModulatedParam` port, which
/// costs **ten times** the volts a normalized port does for the same
/// musical depth.
///
/// `PEAK_PARAM_CV` is 2.5 V against `PEAK_NORMALIZED`'s 0.5, so — as with
/// the eq — `mod_depth` 0.2 here is exactly what `mod_depth` 1.0 would
/// have been under the normalized taper, and one pair of renders measures
/// both designs.
#[test]
fn duck_modulation_reaches_the_param_cv_scale() {
    let swing = |mod_depth: f64| {
        let tree = sustained(AudioNode::Duck {
            uid: Uid::NEW,
            // Mid depth, so the cable has room to move it both ways.
            amount: 0.5,
            threshold: 0.2,
            release: 0.35,
            mod_depth,
            input: Box::new(sine_src()),
            key: Box::new(pluck_key()),
            modulation: ModNode::Lfo {
                uid: Uid::NEW,
                wave: Waveform::Sine,
                rate: 0.5595, // ≈0.9 Hz — a full cycle inside the render
            },
        });
        let levels = window_rms(&tree, 0.0, 20);
        let hi = levels.iter().cloned().fold(0.0_f64, f64::max);
        let lo = levels.iter().cloned().fold(f64::MAX, f64::min);
        hi / lo.max(1e-12)
    };
    let full = swing(1.0);
    assert!(
        full > 2.0,
        "duck modulation swings the level only {full:.3}× at full depth"
    );
    let as_normalized = swing(0.2);
    assert!(
        as_normalized < full * 0.6,
        "the normalized taper reaches {as_normalized:.3}× against the \
         gain taper's {full:.3}× — the 5× ratio between them has moved"
    );
}

/// A vocoder emits no DC, so `makes_dc` is right to refuse it a blocker.
///
/// The argument is that every band on both sides is a Chamberlin SVF
/// *bandpass*, which has an exact zero at DC — so the carrier's offset is
/// annihilated in the filter bank and the modulator's never reaches the
/// output at all. That is a claim about quiver's arithmetic, and this
/// measures it on the module rather than trusting it: a ladder in the
/// carrier is the palette's own DC generator, and the ladder alone would
/// fail the vetting gate's `|mean|/rms` test without a blocker.
#[test]
fn a_vocoder_annihilates_its_carriers_dc() {
    let tree = sustained(AudioNode::Vocoder {
        uid: Uid::NEW,
        bands: 0.6,
        attack: 0.25,
        release: 0.3,
        mod_depth: 0.0,
        carrier: Box::new(AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::Ladder,
            cutoff: 0.6,
            resonance: 0.4,
            mod_depth: 0.0,
            modulation: ModNode::None,
            input: Box::new(saw()),
        }),
        modulator: Box::new(AudioNode::Formant {
            uid: Uid::NEW,
            vowel: 0.3,
            shift: 0.5,
            octave: 0,
            mod_depth: 0.0,
            modulation: ModNode::None,
        }),
        modulation: ModNode::None,
    });
    assert!(
        !makes_dc(&tree.root),
        "a vocoder must not buy the voice a DC blocker"
    );
    quiver::rng::seed(0x2B_5EED);
    let mut v = compile(&tree, SR).expect("compiles");
    let out = hold(&mut v, 0.0, 44_100);
    let tail = &out[22_050..];
    let dc = tail.iter().map(|(l, _)| l).sum::<f64>() / tail.len() as f64;
    let level = rms(tail);
    assert!(level > 1e-3, "the vocoder was silent, nothing to measure");
    assert!(
        dc.abs() / level < 2.0e-3,
        "standing DC offset {dc:.6} against {level:.4} rms — the bandpass \
         zero this skips the blocker for is not where it was thought to be"
    );
}

fn tree_params(tree: &PatchTree) -> Vec<String> {
    compile(tree, SR)
        .expect("compiles")
        .params
        .keys()
        .cloned()
        .collect()
}

/// Amp envelope and VCA run exponential, not linear. Measured as the
/// convexity of the decay: a linear contour through a linear VCA is a
/// straight line to the sustain floor, so it sits at exactly half its
/// starting level halfway through the decay.
#[test]
fn amp_contour_is_exponential() {
    quiver::rng::seed(SEED);
    let tree = PatchTree {
        amp: AmpEnv {
            attack: 0.0,
            decay: 0.7, // ≈630 ms
            sustain: 0.0,
            release: 0.3,
        },
        root: saw(),
    };
    let half_life = |exp: bool| {
        let mut v = compile(&tree, SR).expect("compiles");
        if !exp {
            // The gate is baked on both `Adsr.shape` and `Vca.response`.
            set_constant(&mut v, "voice:adsr", "shape", GATE_FALSE);
            set_constant(&mut v, "voice:vca", "response", GATE_FALSE);
        }
        let out = hold(&mut v, 0.0, (SR * 0.7) as usize);
        // Peak amplitude in each 10 ms window, as an envelope follower.
        let win = (SR * 0.01) as usize;
        let env: Vec<f64> = out
            .chunks(win)
            .map(|c| c.iter().fold(0.0f64, |m, (l, _)| m.max(l.abs())))
            .collect();
        let start = env[2];
        env.iter()
            .position(|&e| e < start * 0.5)
            .unwrap_or(env.len()) as f64
            * 0.01
    };
    let (exp, lin) = (half_life(true), half_life(false));
    assert!(
        exp < lin * 0.8,
        "decay is not exponential: half-life {exp:.2}s exp vs {lin:.2}s linear"
    );
}

/// Tube drive rectifies, and `makes_dc` is right to buy a blocker for it.
///
/// The premise first, measured on quiver's module rather than asserted: a
/// zero-mean sine through the asymmetric curve comes out with a standing
/// offset, while the two symmetric curves leave it at zero (the ~0.0015
/// floor below is the window's own partial cycle, not a signal).
///
/// The offset is largest at *low* drive — 7.7% of RMS at drive 0.05,
/// falling to 1.0% at drive 1.0 — because `1 − e^{−x}` and `tanh(x)` both
/// saturate to ±1, so heavy drive is nearly symmetric and it is the gentle
/// settings, the ones a patch is most likely to use, that rectify. −22 dB
/// of DC multiplied by the amp envelope is an audible per-note thump, and
/// one whose spectrum reaches far above the offset itself.
#[test]
fn dc_blocker_removes_the_tube_distortion_offset() {
    quiver::rng::seed(SEED);
    let raw_offset = |mode_cv: f64| {
        let mut p = Patch::new(SR);
        p.set_validation_mode(ValidationMode::Warn);
        let osc = p.add("osc", Vco::new(SR));
        let d = p.add("d", Distortion::new(SR));
        p.connect(osc.out("sin"), d.in_("in")).expect("wires");
        // Tone wide open, so nothing but the shaper is being measured.
        for (port, v) in [
            ("drive", 0.1),
            ("tone", 1.0),
            ("mode", mode_cv),
            ("mix", 1.0),
        ] {
            assert!(p.set_param_by_id(d.id(), port, v), "no port {port}");
        }
        let out = p.add("out", StereoOutput::new());
        p.connect(d.out("out"), out.in_("left")).expect("wires");
        p.set_output(out.id());
        p.compile().expect("compiles");
        let buf: Vec<f64> = (0..(SR as usize)).map(|_| p.tick().0).collect();
        let tail = &buf[SR as usize / 2..];
        let mean = tail.iter().sum::<f64>() / tail.len() as f64;
        let rms = (tail.iter().map(|x| x * x).sum::<f64>() / tail.len() as f64).sqrt();
        mean.abs() / rms.max(1.0e-12)
    };
    let (soft, hard, tube) = (
        raw_offset(map::drive_mode_cv(0)),
        raw_offset(map::drive_mode_cv(1)),
        raw_offset(map::drive_mode_cv(2)),
    );
    assert!(
        tube > 0.05 && soft < 5.0e-3 && hard < 5.0e-3,
        "the asymmetry premise is wrong: soft {soft:.5}, hard {hard:.5}, tube {tube:.5}"
    );

    // ...and the compiled voice has none of it left. Sustain is well
    // under the limiter: clipping an asymmetric waveform is itself a
    // rectifier, downstream of the blocker, and it would be measured here
    // as a failure of a stage that cannot see it.
    let tree = PatchTree {
        amp: AmpEnv {
            attack: 0.05,
            decay: 0.3,
            sustain: 0.35,
            release: 0.3,
        },
        root: AudioNode::Distortion {
            uid: Uid::NEW,
            drive: 0.15,
            tone: 0.7,
            mode: DriveMode::Tube,
            mod_depth: 0.0,
            input: Box::new(saw()),
            modulation: ModNode::None,
        },
    };
    assert!(makes_dc(&tree.root), "tube drive must buy a blocker");
    let mut v = compile(&tree, SR).expect("compiles");
    let n = (SR * 3.0) as usize;
    let out = hold(&mut v, -1.0, n);
    let tail = &out[n / 2..];
    let dc = tail.iter().map(|(l, _)| l).sum::<f64>() / tail.len() as f64;
    let level = rms(tail);
    assert!(level > 0.1, "patch was silent, nothing to measure");
    assert!(
        dc.abs() / level < 2.0e-3,
        "standing DC offset {dc:.6} against {level:.4} rms"
    );
    // The symmetric modes pay nothing for it.
    for mode in [DriveMode::Soft, DriveMode::Hard] {
        let clean = sustained(AudioNode::Distortion {
            uid: Uid::NEW,
            drive: 0.15,
            tone: 0.7,
            mode,
            mod_depth: 0.0,
            input: Box::new(saw()),
            modulation: ModNode::None,
        });
        assert!(!makes_dc(&clean.root), "{mode:?} must not buy a blocker");
    }
}

/// The envelope follower rides the owning module's *own* input, and
/// degrades to silence rather than to a panic where there is no input.
#[test]
fn the_follower_reads_the_signal_below_it() {
    quiver::rng::seed(SEED);
    // A lowpass whose cutoff is opened by the level of what it is
    // filtering. Playing louder is not available, so the counterfactual is
    // the same tree with the depth knob at zero: identical graph, one
    // attenuverter neutralized.
    let tree = |depth: f64| {
        sustained(AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::SvfLp,
            cutoff: 0.25,
            resonance: 0.0,
            mod_depth: depth,
            input: Box::new(saw()),
            modulation: ModNode::Follow {
                uid: Uid::NEW,
                sens: 0.8,
                release: 0.3,
            },
        })
    };
    let level = |depth: f64| {
        let mut v = compile(&tree(depth), SR).expect("compiles");
        let out = hold(&mut v, 0.0, 44_100);
        rms(&out[22_050..])
    };
    let (off, on) = (level(0.0), level(0.9));
    assert!(
        on > off * 1.05,
        "the follower is inaudible: {off:.4} closed vs {on:.4} open"
    );

    // A source's slot has nothing to tap. That must compile and stay
    // silent on the cable, because both the prior and the panel can put a
    // follower there.
    let lone = sustained(AudioNode::Wavetable {
        uid: Uid::NEW,
        table: crate::term::TableShape::Saw,
        octave: 0,
        morph: 0.4,
        mod_depth: 0.8,
        modulation: ModNode::Follow {
            uid: Uid::NEW,
            sens: 0.8,
            release: 0.3,
        },
    });
    let mut v = compile(&lone, SR).expect("a follower on a source must still compile");
    assert!(
        rms(&hold(&mut v, 0.0, 22_050)) > 1.0e-3,
        "the wavetable went silent"
    );
}

/// `table_cv` has to land each table on an *exact* integer position in
/// quiver's stack, because the port is a crossfade, not a selector: quiver
/// takes `idx = floor(cv·7)` and blends table `idx` into `idx+1` by
/// `frac + morph`. Any non-zero `frac` both mis-names the table on the
/// plate and eats the top of the morph knob's travel, and neither symptom
/// is visible in a diff — this is the guard that makes it visible.
#[test]
fn every_wavetable_shape_lands_on_its_own_table() {
    for i in 0..TableShape::ALL.len() {
        let pos = map::table_cv(i as f64) * 7.0;
        let frac = pos - pos.floor();
        assert!(
            frac < 1e-12 || (1.0 - frac) < 1e-12,
            "table {i} lands at {pos} — fraction {frac} blends it into its neighbour"
        );
        // …and inside the stack, so no shape is unreachable.
        assert!(
            (0.0..=7.0).contains(&pos),
            "table {i} maps outside the stack"
        );
    }
    // Distinct tables, in order: the plate's index IS the table you hear.
    let cvs: Vec<f64> = (0..TableShape::ALL.len())
        .map(|i| map::table_cv(i as f64))
        .collect();
    assert!(
        cvs.windows(2).all(|w| w[1] > w[0]),
        "table CVs are not monotonic"
    );
}

/// ...and it is not a bass cut. A DC blocker that audits as "thin" has
/// traded one defect for a worse one, so the passband is pinned where the
/// instrument actually plays.
#[test]
fn dc_blocker_keeps_the_bass() {
    quiver::rng::seed(SEED);
    let tree = PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 0.3, // well under the limiter, so gains are readable
            release: 0.3,
        },
        // A ladder, so the patch actually receives a blocker; a sine
        // through it stays a sine, so output level reads as filter gain.
        root: AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::Ladder,
            cutoff: 1.0,
            resonance: 0.0,
            mod_depth: 0.0,
            input: Box::new(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Sine,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            }),
            modulation: ModNode::None,
        },
    };
    let at = |voct: f64| {
        let mut v = compile(&tree, SR).expect("compiles");
        let out = hold(&mut v, voct, 44_100);
        rms(&out[22_050..])
    };
    let reference = at(0.0); // C4
                             // C2 (65 Hz) within 1 dB, C3 within 0.5 dB.
    assert!(at(-2.0) > reference * 0.89, "C2 lost more than 1 dB");
    assert!(at(-1.0) > reference * 0.945, "C3 lost more than 0.5 dB");
}

// ---------------------------------------------------------------------
// Wave 2C: modulation as a sort.
//
// Every test below measures the *scale* of a control rather than the
// presence of a cable, because four palette waves running the presence
// check let four dead controls through.
// ---------------------------------------------------------------------

/// A sine oscillator whose **pitch** is driven by `m`.
///
/// Pitch is the measuring destination for the whole of this wave: it is
/// the only mod target whose value can be read straight out of the
/// rendered audio, by counting zero crossings, without a spectral estimate
/// in the way.
fn pitch_modulated(m: ModNode, mod_depth: f64) -> PatchTree {
    sustained(AudioNode::Vco {
        uid: Uid::NEW,
        wave: Waveform::Sine,
        octave: 0,
        detune: 0.5,
        mod_depth,
        modulation: m,
    })
}

/// A slow triangle LFO: 0.125 Hz on quiver's `0.01·3000^cv` map, so one
/// cycle takes 8 s and a 4 s render sweeps up and back down once.
const SLOW_LFO_RATE: f64 = 0.3155;

/// Semitone offsets of each window relative to the lowest, read off the
/// zero-crossing count. At C6 a 100 ms window holds ~209 crossings, so the
/// ±1 count quantization is 0.08 of a semitone — fine enough to say
/// whether a pitch landed on the 12-TET grid.
fn semitone_track(out: &[(f64, f64)], windows: usize) -> Vec<f64> {
    let counts = crossings_per_window(out, windows);
    let lo = *counts.iter().min().expect("windows") as f64;
    counts
        .iter()
        .map(|c| 12.0 * (*c as f64 / lo.max(1.0)).log2())
        .collect()
}

/// Transitions of more than a semitone between adjacent windows — how a
/// gate arriving on a pitch cable reads.
fn gate_edges(out: &[(f64, f64)], windows: usize) -> usize {
    let t = semitone_track(out, windows);
    t.windows(2).filter(|w| (w[0] - w[1]).abs() > 1.0).count()
}

/// The quantizer snaps a modulator onto the **12-TET grid**, and the grid
/// is sized so a fully-modulated pitch cable lands on whole semitones.
///
/// This is the one module in the wave whose musical claim is arithmetic
/// rather than taste, and it is arithmetic in three stages that multiply.
/// `ScaleQuantizer` snaps in V/Oct on a fixed 1/12 V grid, so handed a
/// modulator at its native ±5 V it emits 121 steps across ±60 semitones —
/// a "quantizer" whose output is finer than the ear and, after the mod
/// cable's own 0.1 gain, finer than a tenth of a semitone.
/// [`QUANTIZE_IN_LEVEL`] scales the input into a ±6 semitone window and
/// its inverse scales the output back out, so the *grid* is resized and
/// the cable's gain is not.
///
/// Both halves are asserted: that the modulation still spans its full
/// ±0.5 octave (the round trip is unity, not an attenuation), and that
/// what it visits on the way is a staircase on the semitone grid rather
/// than a ramp.
#[test]
fn the_quantizer_lands_a_pitch_cable_on_whole_semitones() {
    quiver::rng::seed(SEED);
    let lfo = || ModNode::Lfo {
        uid: Uid::NEW,
        wave: Waveform::Triangle,
        rate: SLOW_LFO_RATE,
    };
    let track = |m: ModNode| {
        let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
        // Two octaves up, for the crossing-count resolution the grid
        // check needs.
        let out = hold(&mut v, 2.0, (SR * 4.0) as usize);
        semitone_track(&out, 40)
    };
    let quantized = track(ModNode::Op {
        uid: Uid::NEW,
        kind: ModOp::Quantize,
        p0: 0.0, // root C
        p1: 0.0, // chromatic — every semitone is reachable
        input: Box::new(lfo()),
    });
    let plain = track(lfo());

    // 1. The round trip is transparent: a triangle sweeping the full
    //    ±0.5 octave still spans an octave after being quantized.
    let span = |t: &[f64]| t.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let (qs, ps) = (span(&quantized), span(&plain));
    assert!(
        ps > 8.0,
        "the control sweep is too small to measure: {ps:.2}"
    );
    assert!(
        (qs - ps).abs() < 1.5,
        "quantizing changed the modulation's range: {qs:.2} vs {ps:.2} \
         semitones — the input and output levels do not cancel"
    );

    // 2. It is a staircase. Adjacent windows land on the *same* pitch far
    //    more often than a continuous sweep ever does…
    let plateaus = |t: &[f64]| {
        t.windows(2).filter(|w| (w[0] - w[1]).abs() < 0.05).count() as f64 / (t.len() - 1) as f64
    };
    let (qp, pp) = (plateaus(&quantized), plateaus(&plain));
    assert!(
        qp > 0.3 && qp > pp + 0.15,
        "quantized pitch is not stepped: {:.0}% of windows held, against \
         {:.0}% for the unquantized control",
        100.0 * qp,
        100.0 * pp
    );
    // …and every pitch it holds is on the grid, which is the claim about
    // the grid's *size* rather than about its existence.
    let off_grid = |t: &[f64]| {
        let mut d: Vec<f64> = t.iter().map(|s| (s - s.round()).abs()).collect();
        d.sort_by(f64::total_cmp);
        d[d.len() / 2]
    };
    let (qg, pg) = (off_grid(&quantized), off_grid(&plain));
    assert!(
        qg < 0.15 && qg < pg * 0.7,
        "quantized pitch sits {qg:.3} semitones off the grid (control \
         {pg:.3}) — QUANTIZE_IN_LEVEL is not sizing the grid to the \
         destination"
    );
}

/// A euclidean pattern's clock spans the tempo the port actually offers.
///
/// `Clock`'s `bpm` port is `CvUnipolar`, which in quiver is **0–10 V and
/// not 0–1**: `cv_to_bpm` is `20·15^(cv/10)`, so passing the raw knob
/// through would have given 20 BPM at one end of the control and 21.4 at
/// the other — a rate knob with a 7% range. `ParamMap::ClockRate` spans
/// the port, and the ratio asserted here is most of the 15× the map can
/// produce.
#[test]
fn the_euclid_clock_spans_the_ports_own_tempo_range() {
    quiver::rng::seed(SEED);
    let edges = |rate: f64| {
        let m = ModNode::Euclid {
            uid: Uid::NEW,
            rate,
            steps: 0.3,
            pulses: 0.6,
        };
        let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
        let out = hold(&mut v, 2.0, (SR * 8.0) as usize);
        gate_edges(&out, 400)
    };
    let (slow, fast) = (edges(0.0), edges(1.0));
    assert!(slow > 0, "the slowest clock never fired at all");
    assert!(
        fast as f64 / slow as f64 > 5.0,
        "the euclid rate knob spans only {:.1}× ({slow} to {fast} edges in \
         8 s) — the bpm port is 0–10 V, not 0–1",
        fast as f64 / slow as f64
    );
}

/// Neither end of the euclid's `pulses` knob is a dead cable, at either
/// end of its `steps` knob.
///
/// quiver takes `pulses = (cv · steps) as usize`, so a raw knob emits
/// nothing at all below `1/steps` — about one uniform draw in seven — and
/// a solid gate at exactly 1.0. `ParamMap::EuclidSteps` gives up the two
/// shortest patterns so that one CV floor can serve every step count, and
/// this checks all four corners.
#[test]
fn every_corner_of_the_euclid_knobs_still_makes_a_rhythm() {
    quiver::rng::seed(SEED);
    let edges = |steps: f64, pulses: f64| {
        let m = ModNode::Euclid {
            uid: Uid::NEW,
            rate: 1.0,
            steps,
            pulses,
        };
        let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
        let out = hold(&mut v, 2.0, (SR * 8.0) as usize);
        gate_edges(&out, 400)
    };
    for (steps, pulses) in [(0.0, 0.0), (0.0, 1.0), (1.0, 0.0), (1.0, 1.0)] {
        assert!(
            edges(steps, pulses) > 0,
            "euclid at steps {steps} / pulses {pulses} emits a constant"
        );
    }
}

/// A saw through a lowpass whose cutoff is driven by `m` at full depth.
fn stepped_filter(m: ModNode) -> PatchTree {
    sustained(AudioNode::Filter {
        uid: Uid::NEW,
        kind: FilterKind::SvfLp,
        cutoff: 0.5,
        resonance: 0.1,
        mod_depth: 1.0,
        input: Box::new(saw()),
        modulation: m,
    })
}

/// Two steps, dark and bright, at 2 steps a second (`0.5·2^(5·0.4)`).
fn dark_bright(slew: f64) -> ModNode {
    ModNode::Steps {
        uid: Uid::NEW,
        rate: 0.4,
        length: 0.0,
        slew,
        values: [0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0],
    }
}

/// RMS of consecutive `frame`-sample frames.
fn frame_rms(out: &[(f64, f64)], frame: usize) -> Vec<f64> {
    out.chunks_exact(frame).map(rms).collect()
}

/// A step pattern on a cutoff is **a rhythm in the timbre**: the output
/// alternates dark/bright at the step rate, step for step.
///
/// Measured per step (the middle 400 ms of each 500 ms step, clear of the
/// filter settling on the edge) rather than as "something moved", so the
/// test pins the rate, the order and the depth together: step 0 is `s0`
/// (dark), step 1 is `s1` (bright), and a full-depth cable swings the
/// cutoff across the whole spectrum. The first step is skipped because the
/// amp envelope is still attacking through it.
#[test]
fn a_step_pattern_on_the_cutoff_alternates_at_the_step_rate() {
    quiver::rng::seed(SEED);
    let mut v = compile(&stepped_filter(dark_bright(0.0)), SR).expect("compiles");
    let out = hold(&mut v, 0.0, (SR * 3.0) as usize);
    let step = (SR * 0.5) as usize;
    let per_step: Vec<f64> = (1..6)
        .map(|k| rms(&out[k * step + step / 10..(k + 1) * step - step / 10]))
        .collect();
    for (i, pair) in per_step.windows(2).enumerate() {
        let k = i + 1;
        let (bright, dark) = if k % 2 == 1 {
            (pair[0], pair[1])
        } else {
            (pair[1], pair[0])
        };
        assert!(
            bright > 3.0 * dark,
            "steps {k}/{}: bright {bright:.4} vs dark {dark:.4} — the pattern \
             is not reaching the cutoff ({per_step:?})",
            k + 1
        );
    }
    // …and it changes exactly at the step rate: ten 50 ms frames per
    // step, so over the five measured steps the level crosses its
    // midpoint once per step boundary and nowhere else.
    let frames = frame_rms(&out[step..6 * step], (SR * 0.05) as usize);
    let (lo, hi) = frames
        .iter()
        .fold((f64::MAX, 0.0f64), |(a, b), x| (a.min(*x), b.max(*x)));
    let mid = 0.5 * (lo + hi);
    let flips = frames
        .windows(2)
        .filter(|w| (w[0] > mid) != (w[1] > mid))
        .count();
    assert_eq!(flips, 4, "{flips} level flips in 2.5 s of a 2 Hz pattern");
}

/// Slew turns the steps into glides: at `slew` 1 the level never jumps
/// between adjacent frames the way hard steps do.
///
/// The largest frame-to-frame change is the statistic, for the reason
/// `the_slew_knob_spends_its_travel_on_audible_glide_times` gives: a glide
/// spreads one big jump over many frames, so it lowers the maximum while
/// leaving the total travel alone.
#[test]
fn full_slew_is_smoother_than_hard_steps() {
    quiver::rng::seed(SEED);
    let jump = |slew: f64| {
        let mut v = compile(&stepped_filter(dark_bright(slew)), SR).expect("compiles");
        let out = hold(&mut v, 0.0, (SR * 3.0) as usize);
        let frames = frame_rms(&out[(SR * 0.5) as usize..], (SR * 0.01) as usize);
        frames
            .windows(2)
            .map(|w| (w[1] - w[0]).abs())
            .fold(0.0f64, f64::max)
    };
    let (hard, glided) = (jump(0.0), jump(1.0));
    assert!(hard > 0.0, "the hard steps never moved the level");
    assert!(
        glided < 0.5 * hard,
        "full slew's largest 10 ms jump is {glided:.4} against hard steps' \
         {hard:.4} — the glide is not smoothing the pattern"
    );
}

/// Every one of a `Steps`' eleven sites is a live knob, and moving a step
/// value through its handle changes the sound **in the running voice** —
/// and lands exactly where recompiling the edited tree would have.
///
/// This is the reason the module is not quiver's `StepSequencer`, whose
/// values are internal state: there, a bar drag would be a full patch
/// swap per pointer move.
#[test]
fn every_steps_site_is_live_and_a_step_moves_without_a_recompile() {
    quiver::rng::seed(SEED);
    let tree = stepped_filter(dark_bright(0.0));
    let params = tree_params(&tree);
    for site in STEPS_SITES {
        let addr = format!("node/m#{site}");
        assert!(params.contains(&addr), "{addr} has no live handle");
    }
    assert!(params.contains(&"node#mdepth".to_string()));

    // Two voices from one tree; turn `s0` bright on one of them a quarter
    // of the way into the first (dark) step, without recompiling.
    let mut base = compile(&tree, SR).expect("compiles");
    let mut live = compile(&tree, SR).expect("compiles");
    let quarter = (SR * 0.125) as usize;
    let a = hold(&mut base, 0.0, quarter);
    let b = hold(&mut live, 0.0, quarter);
    assert_eq!(a, b, "two compiles of one tree disagree");
    live.params["node/m#s0"].set_normalized(1.0);
    let dark = rms(&hold(&mut base, 0.0, 3 * quarter)[quarter..]);
    let lit = rms(&hold(&mut live, 0.0, 3 * quarter)[quarter..]);
    assert!(
        lit > 3.0 * dark,
        "setting s0 through its handle did not brighten the step that is \
         playing: {lit:.4} vs {dark:.4}"
    );

    // From the first sample, the handle and a recompile are the same
    // edit, bit for bit.
    let edited =
        crate::edit::set_param(&tree, "node/m#s0", crate::edit::ParamValue::Continuous(1.0))
            .expect("s0 is a knob");
    let mut handled = compile(&tree, SR).expect("compiles");
    handled.params["node/m#s0"].set_normalized(1.0);
    let mut rebuilt = compile(&edited, SR).expect("compiles");
    let n = (SR * 1.2) as usize;
    assert_eq!(
        hold(&mut handled, 0.0, n),
        hold(&mut rebuilt, 0.0, n),
        "the live handle and a recompile disagree about s0"
    );
}

/// The switch hears **both** of its branches.
///
/// quiver's `VcSwitch` needs a third input to choose with and `Pair` has
/// only two to give. The contract proposed the voice gate; that is a
/// control that reviews as correct and does nothing, because the gate is
/// high for the whole of every note and low only between notes when the
/// VCA is shut — so `b` would win every sample anybody hears and `a` would
/// be a module on the rack that is never once audible. Wiring `b` as its
/// own control makes the module "punch `b` in over `a`", and the way to
/// prove `a` is alive is to change only `a`.
#[test]
fn the_switch_is_not_stuck_on_one_branch() {
    quiver::rng::seed(SEED);
    let render = |a_rate: f64| {
        let m = ModNode::Pair {
            uid: Uid::NEW,
            kind: PairOp::Switch,
            a: Box::new(ModNode::Lfo {
                uid: Uid::NEW,
                wave: Waveform::Triangle,
                rate: a_rate,
            }),
            b: Box::new(ModNode::Euclid {
                uid: Uid::NEW,
                rate: 0.7,
                steps: 0.4,
                pulses: 0.5,
            }),
        };
        let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
        let out = hold(&mut v, 2.0, (SR * 2.0) as usize);
        crossings_per_window(&out, 40)
    };
    let (slow, fast) = (render(SLOW_LFO_RATE), render(0.6));
    let moved = slow
        .iter()
        .zip(&fast)
        .filter(|(a, b)| (**a as i64 - **b as i64).abs() > 4)
        .count();
    assert!(
        moved * 4 > slow.len(),
        "changing only the switch's `a` branch moved {moved} of {} windows \
         — that branch is never selected",
        slow.len()
    );
}

/// The slew limiter's useful glide times are on the plate rather than
/// crammed into its first quarter, and its top is a freeze rather than a
/// third of one.
///
/// quiver's own map is `0.001 + cv²·10` seconds — already square-law — so
/// a raw knob puts every glide under 1.5 s below position 0.39 and spends
/// the remaining three fifths of its travel holding the modulator still.
/// `ParamMap::SlewTime` is `0.4·x`, which is measured here at three
/// points: a quarter turn already smooths, and the top of the knob has
/// nearly stopped the modulator.
#[test]
fn the_slew_knob_spends_its_travel_on_audible_glide_times() {
    quiver::rng::seed(SEED);
    // Movement per window: how far the pitch jumps between adjacent
    // 50 ms windows. A stepped source jumps; a slewed one ramps.
    // The *largest* jump between adjacent 50 ms windows, which is the
    // step height a slew limiter exists to soften. A mean would be the
    // wrong statistic: slewing spreads one big jump over several windows,
    // so it moves the mean up while moving the maximum down.
    let jump = |m: ModNode| {
        let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
        let out = hold(&mut v, 2.0, (SR * 4.0) as usize);
        // 25 ms windows: fine enough that a 50 ms glide — a quarter turn
        // of the knob — spreads its step across more than one of them.
        let t = semitone_track(&out, 160);
        t.windows(2)
            .map(|w| (w[0] - w[1]).abs())
            .fold(0.0f64, f64::max)
    };
    let stepped = || ModNode::Euclid {
        uid: Uid::NEW,
        rate: 0.75,
        steps: 0.3,
        pulses: 0.5,
    };
    let slewed = |t: f64| ModNode::Op {
        uid: Uid::NEW,
        kind: ModOp::Slew,
        p0: t,
        p1: t,
        input: Box::new(stepped()),
    };
    let bare = jump(stepped());
    assert!(bare > 3.0, "the control source barely moves: {bare:.3}");
    let quarter = jump(slewed(0.25));
    assert!(
        quarter < bare * 0.75,
        "a quarter turn of slew changed the step height from {bare:.3} to \
         {quarter:.3} — the useful glide times are not on the plate"
    );
    let full = jump(slewed(1.0));
    assert!(
        full < quarter * 0.4,
        "full slew ({full:.3}) is not much slower than a quarter turn \
         ({quarter:.3})"
    );
}

/// The rectifier picks an output **port**, and the three it offers are
/// three different signals.
///
/// quiver's `Rectifier` has no `mode` input at all — it publishes `full`,
/// `half_pos` and `half_neg` simultaneously — so `rmode` chooses a cable
/// at compile time rather than writing a CV, which is also why it is the
/// one 2C knob with no live handle.
#[test]
fn the_three_rectifier_modes_are_three_different_signals() {
    quiver::rng::seed(SEED);
    let track = |mode: f64| {
        let m = ModNode::Op {
            uid: Uid::NEW,
            kind: ModOp::Rectify,
            p0: mode,
            p1: 0.0,
            input: Box::new(ModNode::Lfo {
                uid: Uid::NEW,
                wave: Waveform::Triangle,
                rate: SLOW_LFO_RATE,
            }),
        };
        let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
        let out = hold(&mut v, 2.0, (SR * 4.0) as usize);
        crossings_per_window(&out, 40)
    };
    let differs = |a: &[usize], b: &[usize]| {
        a.iter()
            .zip(b)
            .filter(|(x, y)| (**x as i64 - **y as i64).abs() > 4)
            .count()
    };
    // Cell centres of a three-way split: full / positive / negative.
    let (full, pos, neg) = (track(0.1), track(0.5), track(0.9));
    assert!(
        differs(&full, &pos) * 5 > full.len(),
        "full-wave and positive-half rectification render the same"
    );
    assert!(
        differs(&pos, &neg) * 5 > pos.len(),
        "the two half-wave modes render the same"
    );
    // A full-wave rectified triangle is a triangle at twice the rate and
    // never goes below the base note, so the *lowest* pitch it visits is
    // the unmodulated one — which is what "folded into one polarity"
    // means and what distinguishes it from the bare LFO.
    let bare = {
        let mut v = compile(
            &pitch_modulated(
                ModNode::Lfo {
                    uid: Uid::NEW,
                    wave: Waveform::Triangle,
                    rate: SLOW_LFO_RATE,
                },
                1.0,
            ),
            SR,
        )
        .expect("compiles");
        let out = hold(&mut v, 2.0, (SR * 4.0) as usize);
        crossings_per_window(&out, 40)
    };
    assert!(
        differs(&full, &bare) * 5 > full.len(),
        "rectifying a bipolar LFO changed nothing"
    );
}

/// A modulation chain compiles as a chain: two processors over a leaf all
/// reach the destination, and every knob in it is a real trace address.
///
/// This is the shape the whole wave exists for — `s&h rand → quantize →
/// slew` — and the thing that would break silently is the recursion
/// dropping a level and wiring the leaf straight to the attenuverter.
#[test]
fn a_two_deep_mod_chain_reaches_the_destination_through_every_stage() {
    quiver::rng::seed(SEED);
    let chain = ModNode::Op {
        uid: Uid::NEW,
        kind: ModOp::Slew,
        p0: 0.3,
        p1: 0.3,
        input: Box::new(ModNode::Op {
            uid: Uid::NEW,
            kind: ModOp::Quantize,
            p0: 0.0,
            p1: 2.5 / 7.0, // minor
            input: Box::new(ModNode::Rand {
                uid: Uid::NEW,
                rate: 0.6,
                glide: 0.0,
            }),
        }),
    };
    // Two processors over a leaf — the deepest term the default prior can
    // draw, so this is the shape the search actually has to survive and
    // not a hand-built extreme.
    assert_eq!(
        chain.depth(),
        1 + crate::PatchGrammarPrior::default().max_mod_depth
    );
    let tree = pitch_modulated(chain, 1.0);
    let v = compile(&tree, SR).expect("compiles");
    // Each stage's knobs live under its own key, one level deeper than
    // its parent's — `node/m` for the slew, `node/m/0` for the quantizer,
    // `node/m/0/0` for the S&H.
    for addr in [
        "node#mdepth",
        "node/m#rise",
        "node/m#fall",
        "node/m/0#qroot",
        "node/m/0#qscale",
        "node/m/0/0#rate",
        "node/m/0/0#glide",
    ] {
        assert!(
            v.params.contains_key(addr),
            "chain stage `{addr}` has no live handle"
        );
    }
    // And the top stage is what reaches the oscillator: a recursion that
    // dropped a level would wire the leaf straight to the attenuverter
    // and leave the hard steps on the pitch.
    //
    // Measured on the same two-deep shape with a **euclidean** leaf
    // rather than the S&H one above, because the comparison has to be
    // controlled: two patches containing a noise generator are two
    // different random signals, and the difference between them would
    // measure the noise rather than the slew.
    let jump = |m: ModNode| {
        let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
        let out = hold(&mut v, 2.0, (SR * 4.0) as usize);
        let t = semitone_track(&out, 160);
        t.windows(2)
            .map(|w| (w[0] - w[1]).abs())
            .fold(0.0f64, f64::max)
    };
    let inner = || ModNode::Op {
        uid: Uid::NEW,
        kind: ModOp::Quantize,
        p0: 0.0,
        p1: 2.5 / 7.0, // minor
        input: Box::new(ModNode::Euclid {
            uid: Uid::NEW,
            rate: 0.75,
            steps: 0.3,
            pulses: 0.5,
        }),
    };
    let raw = jump(inner());
    let slewed = jump(ModNode::Op {
        uid: Uid::NEW,
        kind: ModOp::Slew,
        p0: 1.0,
        p1: 1.0,
        input: Box::new(inner()),
    });
    assert!(raw > 3.0, "the two-stage control barely moves: {raw:.3}");
    assert!(
        slewed < raw * 0.5,
        "the slew stage did not reach the pitch: {slewed:.3} against \
         {raw:.3} without it"
    );
}

/// FNV-1a over the *bits* of every sample a voice renders: 3000 frames
/// with the gate high, then 1096 with it low, at a pitch of `7/12`.
///
/// The pitch is a tempered fifth on purpose. It is not a binary fraction,
/// so `pitch + (oct + detune)` and `(pitch + oct) + detune` disagree in
/// the last bit — any change that reassociates the pitch sum shows up here
/// rather than in someone's ears.
fn render_fingerprint(mut v: CompiledVoice) -> u64 {
    v.pitch.set(7.0 / 12.0);
    v.gate.set(5.0);
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for i in 0..4096u32 {
        if i == 3000 {
            v.gate.set(0.0);
        }
        let (l, r) = v.patch.tick();
        for x in [l, r] {
            h ^= x.to_bits();
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    h
}

/// Put a compiled voice back the way the compiler built it *before*
/// `table` and `oct` were live: pull the two new [`ExternalInput`] cables
/// out and write their values back where they used to be baked.
///
/// This is what makes the regression test a real counterfactual rather
/// than a captured constant. A hard-coded golden vector would pin the
/// render to whichever machine captured it — quiver's transcendentals are
/// a pure-Rust libm, but nothing in this repo guarantees that for every
/// dependency on every target, and a flaky CI golden teaches people to
/// re-baseline it, which is precisely the thing it exists to prevent.
/// Rendering both graphs in the same process compares the arithmetic
/// itself.
///
/// (The stronger check was also run once, by hand, across the two real
/// builds: 16 prior draws plus this corpus, hashed before and after the
/// change, identical — which additionally covers what this cannot, that
/// two extra nodes per source do not reorder the execution of the
/// `NoiseGenerator`s that draw from quiver's shared RNG.)
///
/// Returns how many cables it removed, so a test cannot quietly pass by
/// comparing a patch with nothing in it.
fn unlive_table_and_oct(v: &mut CompiledVoice) -> usize {
    let names: Vec<String> = v.patch.nodes().map(|(_, n, _)| n.to_string()).collect();
    let mut pulled = 0;
    for name in names {
        if let Some(key) = name.strip_suffix(":table!") {
            let src = v.patch.get_handle_by_name(&name).expect("just listed");
            let wt = v
                .patch
                .get_handle_by_name(&format!("{key}:wavetable"))
                .expect("a `table!` knob belongs to a wavetable");
            // The atomic holds exactly what `constant` used to pin.
            let baked = v.params[&format!("{key}#table")].value.get();
            v.patch
                .disconnect_ports(src.out("out"), wt.in_("table"))
                .expect("the cable this stage added");
            assert!(v.patch.set_param_by_id(wt.id(), "table", baked));
            pulled += 1;
        } else if let Some(key) = name.strip_suffix(":oct!") {
            let src = v.patch.get_handle_by_name(&name).expect("just listed");
            let off = v
                .patch
                .get_handle_by_name(&format!("{key}:pitch"))
                .expect("an `oct!` knob belongs to a pitch offset");
            // Nothing to bake back: the trim is zero at compile time and
            // the octave never left the `Offset`. That assertion *is* the
            // bit-exactness argument, so make it out loud.
            assert_eq!(
                v.params[&format!("{key}#oct")].value.get(),
                0.0,
                "{key}: a freshly compiled octave trim must be exactly zero"
            );
            v.patch
                .disconnect_ports(src.out("out"), off.in_("in"))
                .expect("the cable this stage added");
            pulled += 1;
        }
    }
    v.patch.compile().expect("recompiles without the cables");
    pulled
}

/// Every source that has an octave, at a non-zero octave, with something
/// on its modulation slot — the exact shape the pitch sum is fragile in,
/// since a mod cable joins the same gather. Plus one wavetable per table
/// shape, `table` being the other constant that became a cable.
fn pitch_and_table_corpus() -> Vec<PatchTree> {
    let lfo = || ModNode::Lfo {
        uid: Uid::NEW,
        wave: Waveform::Triangle,
        rate: 0.4,
    };
    let mut out = vec![
        sustained(AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Saw,
            octave: -2,
            detune: 0.31,
            mod_depth: 0.6,
            modulation: lfo(),
        }),
        sustained(AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Square,
            octave: 2,
            detune: 0.83,
            mod_depth: 0.0,
            modulation: ModNode::None,
        }),
        sustained(AudioNode::Supersaw {
            uid: Uid::NEW,
            octave: -1,
            detune: 0.4,
            mix: 0.6,
            mod_depth: 0.45,
            modulation: lfo(),
        }),
        sustained(AudioNode::Pluck {
            uid: Uid::NEW,
            octave: 1,
            damping: 0.6,
            brightness: 0.4,
            mod_depth: 0.3,
            modulation: lfo(),
        }),
        sustained(AudioNode::Formant {
            uid: Uid::NEW,
            vowel: 0.3,
            shift: 0.5,
            octave: -1,
            mod_depth: 0.2,
            modulation: lfo(),
        }),
    ];
    for (i, table) in TableShape::ALL.iter().enumerate() {
        out.push(sustained(AudioNode::Wavetable {
            uid: Uid::NEW,
            table: *table,
            octave: (i as i8 % 5) - 2,
            morph: 0.37,
            mod_depth: if i % 2 == 0 { 0.0 } else { 0.55 },
            modulation: if i % 2 == 0 { ModNode::None } else { lfo() },
        }));
    }
    out
}

/// **The standing rule, in CI.** Making `table` and `oct` live must not
/// move one sample of any patch that already exists — a rendered-audio
/// change invalidates the bank's featurisation and the taste posterior,
/// and needs a measured evolution revalidation, not a green `make check`.
///
/// So the claim is checked rather than asserted: every patch is rendered
/// twice in the same process, once through the live cables and once
/// through [`unlive_table_and_oct`], and every bit of every sample must
/// agree. Sixteen prior draws for breadth, then a corpus built to hit
/// every octave-bearing source and every wavetable shape.
#[test]
fn table_and_oct_going_live_moved_no_sample() {
    use crate::prior::PatchGrammarPrior;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    let prior = PatchGrammarPrior::default();
    let mut rng = StdRng::seed_from_u64(0x9E37_79B9_7F4A_7C15);
    let trees: Vec<PatchTree> = (0..16)
        .map(|_| prior.sample_with_rng(&mut rng))
        .chain(pitch_and_table_corpus())
        .collect();

    let mut pulled_total = 0;
    for (i, tree) in trees.iter().enumerate() {
        // Noise draws from quiver's thread-local RNG, so both renders have
        // to start from the same state or the comparison means nothing.
        quiver::rng::seed(0x60_1DE5);
        let live = render_fingerprint(compile(tree, SR).expect("compiles"));

        quiver::rng::seed(0x60_1DE5);
        let mut baked = compile(tree, SR).expect("compiles");
        pulled_total += unlive_table_and_oct(&mut baked);
        let baked = render_fingerprint(baked);

        assert_eq!(
            format!("{live:#018x}"),
            format!("{baked:#018x}"),
            "patch {i} renders differently with `table`/`oct` live:\n{}",
            tree.to_sexpr()
        );
    }
    assert!(
        pulled_total >= trees.len(),
        "only {pulled_total} live cables across {} patches — the corpus is \
         not exercising the sites this test is about",
        trees.len()
    );
}

/// An AUDIO IN compiles to quiver's `AudioInput` on the caller's stream:
/// silent unbound, the stream's signal bound, its gain a live knob, and
/// its channel the one it names.
#[test]
fn audio_in_compiles_to_a_bound_input() {
    quiver::rng::seed(SEED);
    use quiver::prelude::AudioInputStream;
    use std::sync::Arc;
    let level = |tree: &PatchTree, stream: Option<&Arc<AudioInputStream>>, gain: Option<f64>| {
        let mut v = compile_with_input(tree, SR, stream).expect("compiles");
        if let Some(g) = gain {
            v.params["node/0#gain"].set_normalized(g);
        }
        v.gate.set(5.0);
        let mut peak = 0.0f64;
        for _ in 0..4096 {
            let (l, _) = v.patch.tick();
            peak = peak.max(l.abs());
            if let Some(s) = stream {
                s.advance();
            }
        }
        peak
    };
    let stream = || {
        let s = Arc::new(AudioInputStream::with_host_clock(2, 4096));
        // Left a 220 Hz tone, right silent.
        let left: Vec<f32> = (0..4096)
            .map(|i| (0.25 * (i as f64 * 220.0 * std::f64::consts::TAU / SR).sin()) as f32)
            .collect();
        s.write(&[&left[..], &[0.0f32; 4096][..]]);
        s
    };
    let left = listening(0, term::InputChannel::Left);
    assert_eq!(level(&left, None, None), 0.0, "an unbound input is silent");
    let heard = level(&left, Some(&stream()), None);
    assert!(heard > 0.1, "a bound input is heard ({heard})");
    let quieter = level(&left, Some(&stream()), Some(0.0));
    assert!(
        quieter < heard * 0.2,
        "the gain knob is live: −24 dB should be far quieter ({quieter} vs {heard})"
    );
    let right = listening(0, term::InputChannel::Right);
    assert!(
        level(&right, Some(&stream()), None) < 1e-6,
        "the right channel of this input is silent"
    );
}

/// **TRACK plays its branch from the input.** A sine VCO under a TRACK,
/// fed a 220 Hz tone with no key held: the VCO sings the tone, within 5
/// cents, so the tracker read it, and the tracked gate opens the voice the
/// way a key does. With the input silent and no key, the voice stays shut. A VCO
/// beside the TRACK is still played by the keys.
#[test]
fn track_plays_its_branch_from_the_input() {
    quiver::rng::seed(SEED);
    use quiver::prelude::AudioInputStream;
    use std::sync::Arc;
    let n = (SR * 0.8) as usize;
    let run_voice = |tree: &PatchTree, input: &[f32], key: Option<f64>| {
        let stream: Arc<AudioInputStream> = stream_of(input);
        let mut v = compile_with_input(tree, SR, Some(&stream)).expect("compiles");
        if let Some(pitch) = key {
            v.pitch.set(pitch);
            v.gate.set(5.0);
        }
        let side = v.taps.get("node/1").cloned();
        let side =
            side.and_then(|(name, port)| v.patch.get_node_id_by_name(&name).map(|id| (id, port)));
        let (mut out, mut beside) = (Vec::new(), Vec::new());
        for _ in 0..n {
            let (l, _) = v.patch.tick();
            stream.advance();
            out.push(l);
            if let Some((id, port)) = side {
                beside.push(v.patch.get_output_value(id, port).unwrap_or(0.0));
            }
        }
        (out, beside)
    };
    let sung = tone(n, 220.0);
    let tree = patch(tracked(term::PitchBand::Mid, 0.0));
    let (out, _) = run_voice(&tree, &sung, None);
    let tail = &out[out.len() / 2..];
    let peak = tail.iter().fold(0.0f64, |m, s| m.max(s.abs()));
    assert!(
        peak > 0.05,
        "the tracked gate did not open the voice ({peak})"
    );
    let hz = frequency(tail).expect("the voice sings");
    assert!(
        (1200.0 * (hz / 220.0).log2()).abs() < 5.0,
        "the branch sings {hz:.2} Hz for a 220 Hz input"
    );
    let (quiet, _) = run_voice(&tree, &vec![0.0; n], None);
    assert!(
        quiet.iter().all(|s| s.abs() < 1e-9),
        "with no input and no key, the voice stays shut"
    );
    // Beside the TRACK, the keys still play: C5 is 523 Hz.
    let both = patch(term::AudioNode::Mix {
        uid: Uid::NEW,
        balance: 0.5,
        a: Box::new(tracked(term::PitchBand::Mid, 0.0)),
        b: Box::new(sine_vco()),
    });
    let (_, beside) = run_voice(&both, &sung, Some(1.0));
    let hz = frequency(&beside[beside.len() / 2..]).expect("the keyed VCO plays");
    assert!(
        (1200.0 * (hz / 523.251_130_601_197_3).log2()).abs() < 5.0,
        "the VCO beside the TRACK plays {hz:.2} Hz, not the key's C5"
    );
}

/// The dynamics knob is live and does what it says: at 0 the input's level
/// is ignored, all the way up a quiet input plays the branch quieter.
#[test]
fn track_dynamics_follow_the_input_level() {
    quiver::rng::seed(SEED);
    use std::sync::Arc;
    let n = (SR * 0.6) as usize;
    let level = |dynamics: f64, amplitude: f32| {
        let quiet: Vec<f32> = tone(n, 220.0)
            .iter()
            .map(|s| (s - 0.3) * amplitude)
            .collect();
        let stream = stream_of(&quiet);
        let tree = patch(tracked(term::PitchBand::Mid, dynamics));
        let mut v = compile_with_input(&tree, SR, Some(&Arc::clone(&stream))).unwrap();
        let mut peak = 0.0f64;
        for i in 0..n {
            let (l, _) = v.patch.tick();
            stream.advance();
            if i > n / 2 {
                peak = peak.max(l.abs());
            }
        }
        peak
    };
    let flat = level(0.0, 0.4);
    let followed = level(PARAM_MAX, 0.4);
    assert!(flat > 0.05);
    assert!(
        followed < flat * 0.6,
        "a quiet input with dynamics up should play quieter ({followed} vs {flat})"
    );
}

/// **CAPTURE records and plays back bit for bit.** Recorded through the
/// record gate from an AUDIO IN, the take is exactly what reached the
/// capture's input; saved and loaded with the patch it is the same take;
/// and a note plays it back sample for sample. A render that never raises
/// the gate leaves the take as it was.
#[test]
fn capture_records_and_plays_back_bit_exactly() {
    quiver::rng::seed(SEED);
    let n = 3_000;
    let x = tone(n, 330.0);
    let stream = stream_of(&x);
    let empty = patch(captured(term::CaptureMode::Once, Take::empty()));
    let mut v = compile_with_input(&empty, SR, Some(&stream)).unwrap();
    let (name, port) = v.taps["node/0"].clone();
    let input = v.patch.get_node_id_by_name(&name).unwrap();
    let record = v.records["node"].clone();
    let (from, to) = (400, 2_400);
    let mut heard = Vec::new();
    for i in 0..n {
        record.set(if (from..to).contains(&i) { 5.0 } else { 0.0 });
        v.patch.tick();
        stream.advance();
        if (from..to).contains(&i) {
            heard.push(v.patch.get_output_value(input, port).unwrap() as f32);
        }
    }
    let take = v.take("node").expect("a capture at the root");
    let bits = |s: &[f32]| s.iter().map(|v| v.to_bits()).collect::<Vec<_>>();
    assert_eq!(take.len(), to - from);
    assert_eq!(
        bits(take.samples()),
        bits(&heard),
        "the take is not what was heard"
    );
    assert_eq!(take.sample_rate(), Some(SR));
    // Saved with the sound, and back.
    let full = patch(captured(term::CaptureMode::Once, take.clone()));
    let back: PatchTree = serde_json::from_str(&serde_json::to_string(&full).unwrap()).unwrap();
    assert_eq!(back, full);
    // A note plays it, sample for sample, at the speed it was recorded.
    let mut p = compile(&back, SR).unwrap();
    let (name, port) = p.taps["node"].clone();
    let out = p.patch.get_node_id_by_name(&name).unwrap();
    p.gate.set(5.0);
    let mut played = Vec::new();
    for _ in 0..take.len() {
        p.patch.tick();
        played.push(p.patch.get_output_value(out, port).unwrap());
    }
    let expected: Vec<f64> = take.samples().iter().map(|s| *s as f64).collect();
    assert_eq!(played, expected, "playback is not the take");
    assert_eq!(p.take("node"), Some(take), "playing moved the take");
}

/// **A recording never outgrows a take.** A 4 s take recorded at 96 kHz,
/// loaded into a capture compiled at 48 kHz, grows its buffer to 8 s at
/// that rate; a 6 s press of the record gate then records 4 s, the bound
/// at 48 kHz, and the take reads back.
#[test]
fn a_long_recording_into_an_enlarged_buffer_stops_at_the_bound() {
    quiver::rng::seed(SEED);
    let hi = 96_000.0;
    let long = Take::from_samples(&tone((TAKE_SECONDS * hi) as usize, 330.0), hi).unwrap();
    let sr = 48_000.0;
    let n = (6.0 * sr) as usize;
    let x: Vec<f32> = (0..n)
        .map(|i| 0.2 + 0.1 * ((i % 97) as f32 / 97.0))
        .collect();
    let stream = stream_of(&x);
    let tree = patch(captured(term::CaptureMode::Once, long));
    let mut v = compile_with_input(&tree, sr, Some(&stream)).unwrap();
    v.records["node"].set(5.0);
    for _ in 0..n {
        v.patch.tick();
        stream.advance();
    }
    let take = v.take("node").expect("the recording reads back as a take");
    assert_eq!(take.len(), (TAKE_SECONDS * sr) as usize);
    assert_eq!(take.sample_rate(), Some(sr));
    assert!(take.seconds() <= TAKE_SECONDS);
}

/// The three ways a note plays a take: once to its end however short the
/// note, held until the note ends, and round and round while held.
#[test]
fn capture_plays_once_hold_and_loop() {
    quiver::rng::seed(SEED);
    let take = Take::from_samples(&tone(1_000, 440.0), SR).unwrap();
    let heard = |play: term::CaptureMode| {
        let mut p = compile(&patch(captured(play, take.clone())), SR).unwrap();
        let (name, port) = p.taps["node"].clone();
        let out = p.patch.get_node_id_by_name(&name).unwrap();
        let mut sounding = Vec::new();
        for i in 0..3_000 {
            // A 300-sample note.
            p.gate.set(if i < 300 { 5.0 } else { 0.0 });
            p.patch.tick();
            sounding.push(p.patch.get_output_value(out, port).unwrap() != 0.0);
        }
        sounding
    };
    let once = heard(term::CaptureMode::Once);
    assert!(
        once[999] && !once[1_000],
        "once plays the whole take, then stops"
    );
    let hold = heard(term::CaptureMode::Hold);
    assert!(hold[299] && !hold[300], "hold stops when the note does");
    let mut long = compile(&patch(captured(term::CaptureMode::Loop, take.clone())), SR).unwrap();
    let (name, port) = long.taps["node"].clone();
    let out = long.patch.get_node_id_by_name(&name).unwrap();
    long.gate.set(5.0);
    let mut last = 0.0;
    for _ in 0..2_500 {
        long.patch.tick();
        last = long.patch.get_output_value(out, port).unwrap();
    }
    assert_ne!(last, 0.0, "loop is still playing past the take's end");
    assert!(take.len() < 2_500);
}
