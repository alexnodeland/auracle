//! The audio thread allocates nothing per quantum.
//!
//! `crates/auracle-wasm/AGENTS.md` says it and `live.rs` promises it: the
//! worklet renders every 2.9 ms on the thread every other sound of the page
//! renders on, and an allocation there is a lock and an unbounded wait. The
//! arpeggiator reuses two buffers sized for a full keyboard, the knob
//! smoothers index a table of handles rebuilt only by a swap, the output and
//! the live input go through buffers kept between quanta. Nothing else
//! checks it: every other test renders through `process`, which copies its
//! output and so allocates on every call.
//!
//! This counts every allocation the test's thread makes while the
//! instruments play: each quantum's input written and `process_ptr` called,
//! as the worklet does, with notes pressed and let go (each press putting
//! its voice's knobs back and, with velocity playing a knob, offsetting
//! it), knobs, the knob under velocity and the bend moved between quanta
//! (the port handler's messages during play), and a patch swap's audible
//! quanta, its fade out and its fade in. Every path is played once first,
//! so what is counted is the steady state, not a first use. What allocates
//! by design is left out: a swap's silent rebuild (it compiles the new
//! voices), the meter while it is on, RECORD, and the settings a player
//! changes between phrases rather than during one (`set_sync`, `set_arp`,
//! `set_touch`).
//!
//! One test in this file, so no other test's thread allocates beside it.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::atomic::{AtomicUsize, Ordering};

use auracle_grammar::term::{AmpEnv, AudioNode, FilterKind, InputChannel, Waveform};
use auracle_grammar::{ModNode, PatchTree, Uid, INPUT_GAIN_UNITY};
use auracle_wasm::LivePoly;

/// Allocations made on a thread while it counts.
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

thread_local! {
    static COUNTING: Cell<bool> = const { Cell::new(false) };
}

fn note() {
    if COUNTING.try_with(Cell::get).unwrap_or(false) {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
    }
}

struct Counting;

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        note();
        unsafe { System.alloc(layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        note();
        unsafe { System.alloc_zeroed(layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        note();
        unsafe { System.realloc(ptr, layout, new_size) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// How many allocations `play` makes on this thread.
fn allocations(play: impl FnOnce()) -> usize {
    let before = ALLOCATIONS.load(Ordering::Relaxed);
    COUNTING.with(|c| c.set(true));
    play();
    COUNTING.with(|c| c.set(false));
    ALLOCATIONS.load(Ordering::Relaxed) - before
}

const Q: usize = 128;
const SR: f64 = 48_000.0;

/// One quantum as the worklet plays it: a tone written into the input,
/// published, then rendered through the pointer the worklet reads. Returns
/// the quantum's loudest sample.
fn quantum(poly: &mut LivePoly, t: &mut usize) -> f32 {
    let at = poly.input_ptr();
    // The worklet's side of the contract: write wasm memory directly.
    let input = unsafe { std::slice::from_raw_parts_mut(at, Q * 2) };
    for (f, lr) in input.chunks_mut(2).enumerate() {
        let x = ((*t + f) as f32 * 0.05).sin() * 0.3;
        lr[0] = x;
        lr[1] = x;
    }
    poly.write_input(Q, 2);
    let out = poly.process_ptr(Q);
    assert!(!out.is_null());
    *t += Q;
    // The worklet's view of the output, as it reads it.
    let out = unsafe { std::slice::from_raw_parts(out, Q * 2) };
    out.iter().fold(0.0f32, |m, s| m.max(s.abs()))
}

/// A phrase of play: `quanta` quanta with a note pressed and let go, a
/// knob turned (and, as PERFORM sends it, the base of the knob velocity
/// plays) and the bend moved between them.
fn phrase(poly: &mut LivePoly, knob: &str, quanta: usize, t: &mut usize) {
    for q in 0..quanta {
        match q % 40 {
            0 => poly.note_on(64, 0.7),
            10 => {
                assert!(poly.set_param(knob, (q % 7) as f64 / 7.0), "{knob}");
                poly.set_touch_base(0, (q % 7) as f64 / 7.0);
            }
            20 => poly.set_bend((q % 5) as f64 - 2.0),
            30 => poly.note_off(64),
            _ => {}
        }
        let _ = quantum(poly, t);
    }
}

fn json(root: AudioNode) -> String {
    serde_json::to_string(&PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 0.8,
            release: 0.3,
        },
        root,
    })
    .unwrap()
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

/// Played with everything on that plays per quantum: a chord under a
/// synced, swung, two-octave up-down arpeggio, tempo-synced sequencers and
/// glide (Loom), velocity playing a knob the arpeggio's presses offset; a
/// unison stack under glide, velocity playing its cutoff; a patch that
/// listens, held open, its input written every quantum, with a key over it;
/// then a swap of the stack under a held note.
#[test]
fn a_quantum_allocates_nothing() {
    quiver::rng::seed(7);
    let (_, loom) = auracle_grammar::presets()
        .into_iter()
        .find(|(n, _)| *n == "Loom")
        .expect("Loom exists");
    // Its sequencer's rate: a knob write with sync on snaps the division.
    let rate = auracle_grammar::describe(&loom)
        .modules
        .iter()
        .flat_map(|m| m.knobs.iter())
        .map(|k| k.addr.clone())
        .find(|a| a.ends_with("#srate"))
        .expect("Loom has a sequencer");
    // Another of its knobs for velocity to play: the arpeggio presses in
    // `process()`, so its touch is written there.
    let touched = auracle_grammar::describe(&loom)
        .modules
        .iter()
        .flat_map(|m| m.knobs.iter())
        .map(|k| k.addr.clone())
        .find(|a| *a != rate)
        .expect("Loom has another knob");
    let mut seq = LivePoly::new(&serde_json::to_string(&loom).unwrap(), SR, 4).expect("compiles");
    assert!(seq.set_touch(&format!(r#"[["{touched}", 0.3, 0.5]]"#), 0.8));
    seq.set_sync(true);
    seq.set_glide(0.4);
    seq.set_arp(true, 2, 4.0, 126.0, 0.5, 2, 0.3);
    for n in [48, 55, 60] {
        seq.note_on(n, 0.9);
    }

    let filtered = json(AudioNode::Filter {
        uid: Uid::NEW,
        kind: FilterKind::SvfLp,
        cutoff: 0.6,
        resonance: 0.2,
        mod_depth: 0.0,
        input: Box::new(saw()),
        modulation: ModNode::None,
    });
    let mut stack = LivePoly::new(&filtered, SR, 4).expect("compiles");
    stack.set_glide(0.3);
    stack.set_unison(true, 0.8, 0.6);
    assert!(stack.set_touch(r#"[["node#cut", 0.3, 0.6]]"#, 0.8));
    stack.note_on(57, 1.0);

    let listens = json(AudioNode::Filter {
        uid: Uid::NEW,
        kind: FilterKind::SvfLp,
        cutoff: 0.6,
        resonance: 0.2,
        mod_depth: 0.0,
        input: Box::new(AudioNode::AudioIn {
            uid: Uid::NEW,
            input: 0,
            gain: INPUT_GAIN_UNITY,
            channel: InputChannel::Both,
        }),
        modulation: ModNode::None,
    });
    let mut open = LivePoly::new(&listens, SR, 4).expect("compiles");
    open.set_open(true);

    let mut t = 0;
    let mut play = |rounds: usize| {
        phrase(&mut seq, &rate, rounds, &mut t);
        phrase(&mut stack, "node#cut", rounds, &mut t);
        phrase(&mut open, "node#cut", rounds, &mut t);
        open.open_sounding()
    };
    // Every path once: buffers grown, smoothers' table filled, the arp's
    // chord and pattern laid out, every voice sounded.
    assert!(play(400), "the open voice is held");
    let n = allocations(|| assert!(play(400)));
    assert_eq!(n, 0, "{n} allocations in 1,200 quanta of play");

    // A swap under a held note: the quanta it fades out through and back
    // in through are heard, and allocate nothing; the silent rebuild between
    // them compiles the new voices, which allocates by design, and is told
    // apart by its silence.
    stack.note_on(60, 1.0);
    for _ in 0..40 {
        let _ = quantum(&mut stack, &mut t);
    }
    assert!(stack.set_patch(&filtered));
    let (mut out, mut silent, mut back, mut patched) = (0, 0, 0, false);
    let mut heard = 0;
    while back < 8 {
        let mut loud = 0.0;
        let n = allocations(|| loud = quantum(&mut stack, &mut t));
        if loud == 0.0 {
            silent += 1;
        } else {
            heard += n;
            if silent == 0 {
                out += 1;
            } else {
                back += 1;
            }
        }
        // 1: the swap is done (`poll_event`).
        patched |= stack.poll_event() == 1;
        assert!(out + silent + back < 200, "the swap never came back");
    }
    assert!(patched && silent > 0, "no swap was heard");
    assert!(out >= 2, "the swap did not fade out ({out} quanta)");
    assert_eq!(heard, 0, "{heard} allocations in the swap's audible quanta");
}
