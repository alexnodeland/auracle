//! Hand-designed preset patches: a starting vocabulary for the bank, and a
//! fast way to seed the taste model ("keep the ones you like").
//!
//! Every preset must compile and pass the vetting gate — pinned by a test in
//! the features crate's dependents (see auracle-wasm tests).
//!
//! # Every parameter here is normalized; none of them are in units
//!
//! A `PatchTree` field is `0.0..=1.0` and the musical meaning lives in the
//! compiler and in quiver. Writing these by feel rather than by the maps is
//! how the first nine went wrong in a way nobody could see: **every modulated
//! preset in the library ran between 0.033 Hz and 0.165 Hz** — six to thirty
//! seconds per cycle — against an audition phrase whose longest held note is
//! 1.8 s. The library demonstrated no audible modulation at all, and since the
//! warm start draws its whole cold-start evidence from these patches, two of
//! the fifteen features the taste model reasons over (`centroid_std`,
//! `flux_mean`) were pinned to the floor for every observation it started
//! from. `Dub Echo`'s `time: 0.45` was likewise 30 ms — a flanger.
//!
//! So: **use the maps.** They are the arithmetic, not a style guide.
//!
//! | field | map | worked examples |
//! |---|---|---|
//! | `Filter.cutoff` | `20·1000^x` Hz | .3→159 · .5→632 · .7→2.5k · .85→7.1k |
//! | `AmpEnv.*`, `Env.*` | `1 ms·10000^x` **time constant** | .0→1 ms · .25→10 ms · .5→100 ms · .75→1 s |
//! | `Lfo.rate`, `Rand.rate` | `0.01·3000^x` Hz | .42→0.29 · .49→0.51 · .58→1.0 · .75→4.05 |
//! | `Delay.time` | `1 ms·2000^x` | .54→60 ms · .63→120 ms · .79→420 ms |
//! | `Chorus.rate` | `0.1·50^x` Hz | .15→0.18 · .25→0.27 · .35→0.39 · .5→0.71 |
//! | `Reverb.size` | Freeverb room `0.28+0.7x` | .9→0.91 |
//! | `Filter.resonance` | `×0.85` | 1.0 is 0.85, never self-oscillation |
//! | `Delay.feedback` | `×0.7` | .62→0.43 — the grammar cannot run away |
//! | `Phaser.rate` | `0.05·100^x` Hz | .25→0.16 · .35→0.25 · .5→0.5 · .7→1.25 |
//! | `Phaser.feedback` | `(2x−1)·0.7` | .5 is *no* feedback; below it the sign flips |
//! | `Bitcrush.bits` | `1 + 15x` bits | .2→4 · .35→6.3 · .6→10 · 1.0→16 (clean) |
//! | `Bitcrush.downsample` | `1 + 63x` × slower | .1→7.3× · .3→20× · .5→33× |
//! | `Follow.release` | `1 + 999x` ms | .2→200 ms · .4→400 ms · .7→700 ms |
//!
//! `AmpEnv.sustain` and every `mix`/`balance`/`depth` are levels, not times.
//!
//! **The envelope map is a time constant, not a duration.** `compile.rs` runs
//! the ADSR in exponential mode, so the mapped value is a one-pole τ: reaching
//! 90% takes ≈2.3 τ and settling takes ≈6.9 τ. `Cathedral`'s attack of `0.75`
//! maps to 1.0 s and *measures* 1.397 s to its knee. Read every envelope
//! number here as "about 1.4× longer than the table says", and remember the
//! phrase's longest note is 1.8 s — an attack much past `0.75` will still be
//! climbing when the note ends.
//!
//! **`Supersaw` is ~14 dB quieter than `Vco`.** Quiver scales `Vco` and
//! `Noise` outputs by 5.0 and leaves `Supersaw` at unity. That is invisible
//! for anything downstream that only cares about relative level, and fatal for
//! `Fold`, which folds `x / 5.0` and therefore never reaches its threshold on
//! a supersaw. Build folded patches on `Vco`.
//!
//! # What the grammar cannot do
//!
//! Worth knowing before designing: there is no FM, no oscillator sync and no
//! PWM. `Vco.detune` on a lone oscillator only transposes the whole patch a
//! few cents sharp; it is only musical inside a `Mix` (or a `RingMod`) of two
//! sources.
//!
//! Pitch modulation **does** exist as of wave 2A — `Vco` and `Supersaw` carry
//! a slot that lands on their pitch offset (±0.5 octave at full depth), which
//! is where vibrato and pitch envelopes come from.
//!
//! What a `ModNode` reaches is one parameter per module, and the choice is
//! the compiler's, not the patch's: `Vco`/`Supersaw` pitch, `Filter.cutoff`,
//! `Fold.threshold`, `Delay.time`, `Chorus.depth`, `Reverb.size`,
//! `Distortion.drive`, `Bitcrush.bits`, `Phaser.depth`, `Flanger.depth`,
//! `Tremolo.depth`, `Vibrato.depth`, `Eq.mid`, `Granular.position`,
//! `Wavetable.morph`, `Pluck.damping`, `Formant.vowel`, `Shift.semis`,
//! `Comp`/`Gate` threshold, `Duck.amount` and `Vocoder.bands`. Only `Mix` and
//! `RingMod` have no slot — both of their inputs are audio and their one knob
//! is the blend.
//!
//! `ModNode::Follow` is the odd one: it listens to the owning module's *own*
//! input, so it only says something on a module whose input has dynamics to
//! follow. On a source's slot it is silence, deliberately.
//!
//! # Levels are not comparable, and the dynamics modules care
//!
//! `Comp`, `Duck` and `Gate` are keyed by a second branch whose **absolute**
//! level decides everything. Measured as mean `|x|` on a held note: a sine
//! vco is 3.18 V, a supersaw ≈0.6 V, a plucked string **0.14 V**. The
//! threshold knobs are geometric over 0.05–5 V (`compile::map::detector_volts`)
//! so all three are reachable, but a key branch swapped from a pluck to a vco
//! moves the useful threshold by 25 dB — about a third of the knob.
//!
//! # The gate is not the constraint
//!
//! Vetting rejects only non-finite output, RMS < 1e-4, peak > 3.5, and
//! `|mean|/rms > 0.6`. It catches pathology, not taste. Design musically and
//! let the gate do its narrow job.
//!
//! # This is also the model's vocabulary lesson
//!
//! The bank's auto-namer (`auracle-session::naming`) fits its adjectives to
//! the pool's *own* spread and suppresses any axis whose range falls below a
//! just-noticeable difference. A library clustered in one corner therefore
//! produces a bank that honestly reports itself as `Soft Lead`, `Soft Lead 2`,
//! `Soft Lead 3`. Coverage here is what gives the whole app its adjectives.

use crate::term::{
    AmpEnv, AudioNode, DriveMode, FilterKind, ModNode, ModOp, NoiseColor, PairOp, PatchTree,
    TableShape, Uid, Waveform,
};

fn amp(attack: f64, decay: f64, sustain: f64, release: f64) -> AmpEnv {
    AmpEnv {
        attack,
        decay,
        sustain,
        release,
    }
}

/// A vco with no pitch modulation — the shape every preset written before
/// wave 2A had. Presets that *want* the pitch slot spell out the full literal,
/// which is also what makes them findable.
fn vco(wave: Waveform, octave: i8, detune: f64) -> AudioNode {
    AudioNode::Vco {
        uid: Uid::NEW,
        wave,
        octave,
        detune,
        mod_depth: 0.0,
        modulation: ModNode::None,
    }
}

/// A supersaw with no pitch modulation.
fn supersaw(octave: i8, detune: f64, mix: f64) -> AudioNode {
    AudioNode::Supersaw {
        uid: Uid::NEW,
        octave,
        detune,
        mix,
        mod_depth: 0.0,
        modulation: ModNode::None,
    }
}

/// What a preset is *for*, so the browser can group them and the warm start
/// can sample across the space instead of down one corner of it.
///
/// A `&'static str` rather than an enum: it exists to be grouped by and shown,
/// it crosses into JS as JSON, and nothing dispatches on it.
pub type Category = &'static str;

/// The categories, in display order.
pub const CATEGORIES: [Category; 7] = ["bass", "lead", "keys", "pad", "texture", "perc", "weird"];

/// One built-in patch, with the copy that makes it findable.
pub struct Preset {
    /// Display name.
    pub name: &'static str,
    /// Which family it belongs to; one of [`CATEGORIES`].
    pub category: Category,
    /// One line on what it sounds like. Shown in the browser row and its
    /// tooltip — the handbook delivered where the user is already looking.
    pub blurb: &'static str,
    /// The patch.
    pub tree: PatchTree,
}

/// The built-in presets, as `(name, tree)` pairs.
///
/// Retained as the compatibility shim over [`preset_bank`]; new callers that
/// want categories or copy should use that instead.
pub fn presets() -> Vec<(&'static str, PatchTree)> {
    preset_bank()
        .into_iter()
        .map(|p| (p.name, p.tree))
        .collect()
}

/// The built-in preset library, in category order.
pub fn preset_bank() -> Vec<Preset> {
    use AudioNode::*;
    vec![
        // ---------------------------------------------------------------
        // BASS
        // ---------------------------------------------------------------
        Preset {
            name: "First Bass",
            category: "bass",
            blurb: "the plain correct one — measure the others against it",
            tree: PatchTree {
                amp: amp(0.03, 0.35, 0.55, 0.2),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::Ladder,
                    cutoff: 0.45,
                    resonance: 0.55,
                    mod_depth: 0.6,
                    modulation: ModNode::Env {
                        uid: Uid::NEW,
                        attack: 0.02,
                        decay: 0.45,
                    },
                    input: Box::new(vco(Waveform::Saw, -1, 0.5)),
                },
            },
        },
        Preset {
            name: "Sub & Sparkle",
            category: "bass",
            blurb: "weight underneath, air above, nothing in the middle",
            tree: PatchTree {
                amp: amp(0.05, 0.35, 0.65, 0.35),
                root: Mix {
                    uid: Uid::NEW,
                    balance: 0.35,
                    a: Box::new(vco(Waveform::Sine, -1, 0.5)),
                    b: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfHp,
                        cutoff: 0.7,
                        resonance: 0.3,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(vco(Waveform::Saw, 1, 0.6)),
                    }),
                },
            },
        },
        Preset {
            name: "Acid Line",
            category: "bass",
            // Ladder at high resonance with a fast env sweep is the 303; the
            // decay (0.30 ≈ 16 ms) is what makes it spit rather than wobble.
            blurb: "a 303 that got out of the cage",
            tree: PatchTree {
                amp: amp(0.0, 0.42, 0.3, 0.3),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::Ladder,
                    cutoff: 0.3,
                    resonance: 0.8,
                    mod_depth: 0.65,
                    modulation: ModNode::Env {
                        uid: Uid::NEW,
                        attack: 0.0,
                        decay: 0.3,
                    },
                    input: Box::new(vco(Waveform::Saw, -1, 0.52)),
                },
            },
        },
        Preset {
            name: "Reese",
            category: "bass",
            // Two saws a hair apart is the only place `detune` is musical —
            // on a lone oscillator it just transposes the patch sharp.
            blurb: "two saws beating against each other, low and wide",
            tree: PatchTree {
                amp: amp(0.02, 0.5, 0.75, 0.35),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfLp,
                    cutoff: 0.45,
                    resonance: 0.35,
                    mod_depth: 0.25,
                    modulation: ModNode::Lfo {
                        uid: Uid::NEW,
                        wave: Waveform::Triangle,
                        rate: 0.49, // 0.5 Hz — one full sweep per held note
                    },
                    input: Box::new(Mix {
                        uid: Uid::NEW,
                        balance: 0.5,
                        a: Box::new(vco(Waveform::Saw, -1, 0.3)),
                        b: Box::new(vco(Waveform::Saw, -1, 0.85)),
                    }),
                },
            },
        },
        Preset {
            name: "Anvil",
            category: "bass",
            blurb: "a square driven into the folder, then hammered flat",
            tree: PatchTree {
                amp: amp(0.0, 0.45, 0.45, 0.3),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::Ladder,
                    cutoff: 0.42,
                    resonance: 0.35,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Fold {
                        uid: Uid::NEW,
                        threshold: 0.35,
                        mod_depth: 0.4,
                        modulation: ModNode::Env {
                            uid: Uid::NEW,
                            attack: 0.0,
                            decay: 0.325,
                        },
                        input: Box::new(vco(Waveform::Square, -1, 0.5)),
                    }),
                },
            },
        },
        Preset {
            name: "Iron Bass",
            category: "bass",
            // Tube drive is the asymmetric shaper, so this patch is also the
            // library's only user of the DC blocker on a non-ladder path.
            // The follower makes the drive track the note's own envelope:
            // hard at the attack, cleaner as it decays, which is what a real
            // overdriven amp does and what a fixed drive knob cannot.
            blurb: "an amp being pushed harder than it wants to go",
            tree: PatchTree {
                amp: amp(0.0, 0.45, 0.6, 0.3),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::Ladder,
                    cutoff: 0.48,
                    resonance: 0.3,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Distortion {
                        uid: Uid::NEW,
                        drive: 0.55,
                        tone: 0.45,
                        mode: DriveMode::Tube,
                        mod_depth: 0.6,
                        modulation: ModNode::Follow {
                            uid: Uid::NEW,
                            sens: 0.55,
                            release: 0.35,
                        },
                        input: Box::new(vco(Waveform::Saw, -1, 0.5)),
                    }),
                },
            },
        },
        Preset {
            name: "Held Under",
            category: "bass",
            // Sidechain compression, which needs two branches and therefore
            // could not be written before wave 2B. The plucked string is
            // never heard; it only tells the detector when to pull the sub
            // down. Threshold 0.3 is ≈0.2 V on the geometric detector map —
            // under the string's envelope peak, so every strike bites.
            blurb: "a sub that gets pushed down every time the string speaks",
            tree: PatchTree {
                amp: amp(0.05, 0.4, 0.8, 0.35),
                root: Comp {
                    uid: Uid::NEW,
                    threshold: 0.3,
                    ratio: 0.7,   // ≈14:1 — limiting, so the pump is not subtle
                    makeup: 0.25, // 1.75×, giving the level back between hits
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.4, // ≈316 Hz
                        resonance: 0.3,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(vco(Waveform::Saw, -1, 0.5)),
                    }),
                    sidechain: Box::new(Pluck {
                        uid: Uid::NEW,
                        octave: 0,
                        damping: 0.3,
                        brightness: 0.8,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                    }),
                },
            },
        },
        // ---------------------------------------------------------------
        // LEAD
        // ---------------------------------------------------------------
        Preset {
            name: "Folded Lead",
            category: "lead",
            blurb: "buzzing, metallic, never quite still",
            tree: PatchTree {
                amp: amp(0.02, 0.3, 0.7, 0.3),
                root: Fold {
                    uid: Uid::NEW,
                    threshold: 0.4,
                    mod_depth: 0.5,
                    modulation: ModNode::Lfo {
                        uid: Uid::NEW,
                        wave: Waveform::Triangle,
                        rate: 0.6, // 1.2 Hz — was 0.35 (0.165 Hz), inaudible
                    },
                    input: Box::new(vco(Waveform::Saw, 0, 0.55)),
                },
            },
        },
        Preset {
            name: "Hornet",
            category: "lead",
            blurb: "nasal and angry; cuts through anything",
            tree: PatchTree {
                amp: amp(0.15, 0.4, 0.65, 0.3),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfBp,
                    cutoff: 0.62,
                    resonance: 0.7,
                    mod_depth: 0.25,
                    modulation: ModNode::Rand {
                        uid: Uid::NEW,
                        rate: 0.62,
                        glide: 0.0,
                    }, // ~1.4 Hz stepping
                    input: Box::new(vco(Waveform::Square, 0, 0.5)),
                },
            },
        },
        Preset {
            name: "Solo Flight",
            category: "lead",
            blurb: "wide enough to sing, not so wide it stops being one voice",
            tree: PatchTree {
                amp: amp(0.3, 0.45, 0.78, 0.45),
                root: Chorus {
                    uid: Uid::NEW,
                    rate: 0.3,
                    depth: 0.35,
                    mix: 0.3,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.72,
                        resonance: 0.3,
                        mod_depth: 0.18,
                        modulation: ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Sine,
                            rate: 0.55, // 0.8 Hz — a slow breath, still audible
                        },
                        input: Box::new(supersaw(0, 0.25, 0.45)),
                    }),
                },
            },
        },
        Preset {
            name: "Telegraph",
            category: "lead",
            blurb: "every note answers itself once and stops",
            tree: PatchTree {
                amp: amp(0.15, 0.45, 0.55, 0.35),
                root: Delay {
                    uid: Uid::NEW,
                    time: 0.63, // 120 ms — a slapback, not a comb
                    feedback: 0.4,
                    mix: 0.32,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.68,
                        resonance: 0.4,
                        mod_depth: 0.35,
                        modulation: ModNode::Env {
                            uid: Uid::NEW,
                            attack: 0.0,
                            decay: 0.42,
                        },
                        input: Box::new(vco(Waveform::Triangle, 1, 0.5)),
                    }),
                },
            },
        },
        Preset {
            name: "Wobble Board",
            category: "lead",
            // The headline of wave 2A: `mod_depth` 0.09 is ±54 cents, which is
            // a singer's vibrato rather than a siren. The taper reaches ±0.5
            // octave at 1.0, so the musical corner is the bottom tenth — small
            // to dial, and the alternative was not having pitch modulation.
            blurb: "a lead that sings — the first patch here that can vibrato",
            tree: PatchTree {
                amp: amp(0.04, 0.4, 0.7, 0.3),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::Ladder,
                    cutoff: 0.55,
                    resonance: 0.4,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Vco {
                        uid: Uid::NEW,
                        wave: Waveform::Saw,
                        octave: 0,
                        detune: 0.5,
                        mod_depth: 0.09,
                        modulation: ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Sine,
                            rate: 0.78, // 5.2 Hz
                        },
                    }),
                },
            },
        },
        Preset {
            name: "Falling Sign",
            category: "lead",
            // The other pitch-slot idiom, and the one that argues for the
            // wide taper: a unipolar mod envelope on pitch starts the note
            // 3.3 semitones sharp and lets it fall in over 63 ms. A ceiling
            // tight enough to make vibrato comfortable would not reach here.
            blurb: "every note drops into tune from a third above",
            tree: PatchTree {
                amp: amp(0.0, 0.45, 0.6, 0.25),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfLp,
                    cutoff: 0.6,
                    resonance: 0.35,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Vco {
                        uid: Uid::NEW,
                        wave: Waveform::Square,
                        octave: 0,
                        detune: 0.5,
                        mod_depth: 0.55,
                        modulation: ModNode::Env {
                            uid: Uid::NEW,
                            attack: 0.0,
                            decay: 0.45, // 63 ms
                        },
                    }),
                },
            },
        },
        Preset {
            name: "Loudhailer",
            category: "lead",
            // The eq's three bands are bipolar: 0.5 is 0 dB, so 0.15 is
            // −8.4 dB and 0.75 is +6 dB. The mod slot reaches the mid gain at
            // its own volt scale, so depth 0.45 is a ±5.4 dB pump — a wah
            // built out of a tone control.
            blurb: "a megaphone with a hand moving over the mouth",
            tree: PatchTree {
                amp: amp(0.02, 0.4, 0.7, 0.25),
                root: Eq {
                    uid: Uid::NEW,
                    low: 0.15,
                    mid: 0.75,
                    high: 0.2,
                    mod_depth: 0.45,
                    modulation: ModNode::Lfo {
                        uid: Uid::NEW,
                        wave: Waveform::Triangle,
                        rate: 0.52, // 0.64 Hz
                    },
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::Ladder,
                        cutoff: 0.55,
                        resonance: 0.5,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(vco(Waveform::Saw, 0, 0.5)),
                    }),
                },
            },
        },
        Preset {
            name: "Fifth Wheel",
            category: "lead",
            // The shifter is 0.79 on a `(2x−1)·2.5 V` knob into quiver's
            // `cv/5·24` semitones: +1.45 V, i.e. +7.0 semitones — a fifth, not
            // an "up a bit". At mix 0.5 both voices are present, which is what
            // makes it a harmony rather than a transposition.
            blurb: "plays a fifth above itself, in parallel, slightly grainy",
            tree: PatchTree {
                amp: amp(0.15, 0.4, 0.7, 0.3),
                root: Shift {
                    uid: Uid::NEW,
                    semis: 0.79,
                    // 41 ms grains: long enough to track the fundamental of a
                    // lead register, short enough that the harmony arrives
                    // with the note rather than behind it.
                    window: 0.35,
                    mix: 0.5,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::Ladder,
                        cutoff: 0.55, // ≈1.2 kHz
                        resonance: 0.45,
                        mod_depth: 0.5,
                        modulation: ModNode::Env {
                            uid: Uid::NEW,
                            attack: 0.05,
                            decay: 0.45, // ≈45 ms
                        },
                        input: Box::new(vco(Waveform::Saw, 0, 0.5)),
                    }),
                },
            },
        },
        // ---------------------------------------------------------------
        // KEYS
        // ---------------------------------------------------------------
        Preset {
            name: "Pluck",
            category: "keys",
            blurb: "woody and dry; gone before you lift the key",
            tree: PatchTree {
                amp: amp(0.0, 0.25, 0.05, 0.25),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfBp,
                    cutoff: 0.6,
                    resonance: 0.45,
                    mod_depth: 0.5,
                    modulation: ModNode::Env {
                        uid: Uid::NEW,
                        attack: 0.0,
                        decay: 0.25,
                    },
                    input: Box::new(vco(Waveform::Triangle, 0, 0.5)),
                },
            },
        },
        Preset {
            name: "Bell Jar",
            category: "keys",
            // Folding a sine is the cheapest way to inharmonic partials in a
            // grammar with no FM and no ring mod.
            blurb: "struck glass, heard from across the room",
            tree: PatchTree {
                amp: amp(0.0, 0.55, 0.0, 0.7),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.7,
                    damp: 0.3,
                    mix: 0.4,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Fold {
                        uid: Uid::NEW,
                        threshold: 0.55,
                        mod_depth: 0.35,
                        modulation: ModNode::Env {
                            uid: Uid::NEW,
                            attack: 0.0,
                            decay: 0.35,
                        },
                        input: Box::new(vco(Waveform::Sine, 1, 0.5)),
                    }),
                },
            },
        },
        Preset {
            name: "Tine",
            category: "keys",
            blurb: "electric-piano-shaped, without pretending to be one",
            tree: PatchTree {
                amp: amp(0.0, 0.6, 0.25, 0.5),
                root: Chorus {
                    uid: Uid::NEW,
                    rate: 0.2,
                    depth: 0.3,
                    mix: 0.3,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Mix {
                        uid: Uid::NEW,
                        balance: 0.3,
                        a: Box::new(vco(Waveform::Sine, 0, 0.5)),
                        b: Box::new(Filter {
                            uid: Uid::NEW,
                            kind: FilterKind::SvfHp,
                            cutoff: 0.78,
                            resonance: 0.2,
                            mod_depth: 0.0,
                            modulation: ModNode::None,
                            input: Box::new(vco(Waveform::Triangle, 2, 0.5)),
                        }),
                    }),
                },
            },
        },
        Preset {
            name: "Coin Toss",
            category: "keys",
            blurb: "a resonant burble that never settles",
            tree: PatchTree {
                amp: amp(0.0, 0.42, 0.0, 0.35),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::Ladder,
                    cutoff: 0.55,
                    resonance: 0.6,
                    mod_depth: 0.3,
                    modulation: ModNode::Rand {
                        uid: Uid::NEW,
                        rate: 0.75,
                        glide: 0.0,
                    }, // ~4 Hz
                    input: Box::new(vco(Waveform::Saw, 0, 0.5)),
                },
            },
        },
        Preset {
            name: "Gut String",
            category: "keys",
            // Karplus-Strong excites once per gate edge and then rings from
            // its own loop, so the amp envelope is a window on the decay
            // rather than the decay itself — hence the long sustain on a
            // patch that plainly dies away.
            blurb: "a string that was plucked, not switched on",
            tree: PatchTree {
                amp: amp(0.0, 0.5, 0.8, 0.4),
                root: Pluck {
                    uid: Uid::NEW,
                    octave: 0,
                    damping: 0.62,
                    brightness: 0.55,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                },
            },
        },
        Preset {
            name: "Ghost Bell",
            category: "keys",
            // The classic ring-mod bell: sum and difference tones of two
            // sines a fifth-and-an-octave apart are inharmonic, which is what
            // makes it read as struck metal rather than as a note. `mix`
            // keeps some dry carrier so the patch still has a pitch.
            blurb: "two sines multiplied into something that never had a pitch",
            tree: PatchTree {
                amp: amp(0.0, 0.5, 0.0, 0.65),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.72,
                    damp: 0.35,
                    mix: 0.4,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(RingMod {
                        uid: Uid::NEW,
                        mix: 0.68,
                        a: Box::new(vco(Waveform::Sine, 1, 0.5)),
                        b: Box::new(vco(Waveform::Sine, 2, 0.62)),
                    }),
                },
            },
        },
        Preset {
            name: "Choirboy",
            category: "keys",
            // quiver's `vowel` port is a continuous position across A/E/I/O/U,
            // not a five-way switch — so an LFO on it *slides* between vowels,
            // which is a spectral movement the feature extractor's centroid
            // and rolloff see directly.
            blurb: "vowels, sung by something with no mouth",
            tree: PatchTree {
                amp: amp(0.12, 0.5, 0.75, 0.4),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.7,
                    damp: 0.4,
                    mix: 0.4,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Formant {
                        uid: Uid::NEW,
                        vowel: 0.25,
                        shift: 0.55,
                        octave: 0,
                        mod_depth: 0.5,
                        modulation: ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Triangle,
                            rate: 0.45, // 0.37 Hz
                        },
                    }),
                },
            },
        },
        Preset {
            name: "Twelve String",
            category: "keys",
            // The shifter at 0.79 is +7.0 semitones (its knob is ±12 over the
            // port's ±24, so the mod cable can reach the rest); at mix 0.5 the
            // original is still there, so one key gives a string and its
            // fifth. On a plucked source that is a twelve-string, not a
            // transposition.
            blurb: "one string, and its fifth, struck together",
            tree: PatchTree {
                amp: amp(0.0, 0.45, 0.25, 0.35),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.5,
                    damp: 0.55,
                    mix: 0.25,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(AudioNode::Shift {
                        uid: Uid::NEW,
                        semis: 0.79,
                        window: 0.3, // ≈35 ms grains — tracks a key register
                        mix: 0.5,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(AudioNode::Pluck {
                            uid: Uid::NEW,
                            octave: 0,
                            damping: 0.55,
                            brightness: 0.55,
                            mod_depth: 0.0,
                            modulation: ModNode::None,
                        }),
                    }),
                },
            },
        },
        // ---------------------------------------------------------------
        // PAD
        // ---------------------------------------------------------------
        Preset {
            name: "Cathedral",
            category: "pad",
            blurb: "slow, sacred and wide",
            tree: PatchTree {
                // Was 0.4 — 40 ms, an organ stab into a hall. 0.75 is ~1 s,
                // which is what "slow" claimed all along.
                amp: amp(0.75, 0.4, 0.75, 0.7),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.85,
                    damp: 0.35,
                    mix: 0.5,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.55,
                        resonance: 0.25,
                        mod_depth: 0.3,
                        modulation: ModNode::Rand {
                            uid: Uid::NEW,
                            rate: 0.45,
                            glide: 0.0,
                        }, // 0.37 Hz
                        input: Box::new(vco(Waveform::Triangle, 0, 0.55)),
                    }),
                },
            },
        },
        Preset {
            name: "Glass Pad",
            category: "pad",
            blurb: "bright, transparent, faintly fragile",
            tree: PatchTree {
                amp: amp(0.55, 0.4, 0.8, 0.65),
                root: Chorus {
                    uid: Uid::NEW,
                    rate: 0.25,
                    depth: 0.5,
                    mix: 0.45,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.65,
                        resonance: 0.2,
                        mod_depth: 0.25,
                        modulation: ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Sine,
                            rate: 0.49, // 0.5 Hz — was 0.2 (0.05 Hz, 20 s/cycle)
                        },
                        input: Box::new(supersaw(0, 0.4, 0.6)),
                    }),
                },
            },
        },
        Preset {
            name: "Detune Dream",
            category: "pad",
            blurb: "a wide smear that drifts off the end of the note",
            tree: PatchTree {
                amp: amp(0.35, 0.4, 0.75, 0.55),
                root: Delay {
                    uid: Uid::NEW,
                    time: 0.72, // 250 ms — was 0.3 (8 ms), a metallic comb
                    feedback: 0.45,
                    mix: 0.35,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Chorus {
                        uid: Uid::NEW,
                        rate: 0.3,
                        depth: 0.55,
                        mix: 0.4,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(supersaw(0, 0.55, 0.5)),
                    }),
                },
            },
        },
        Preset {
            name: "Ember",
            category: "pad",
            blurb: "a pad that glows rather than shines",
            tree: PatchTree {
                amp: amp(0.75, 0.55, 0.8, 0.85),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.75,
                    damp: 0.55,
                    mix: 0.45,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.42,
                        resonance: 0.25,
                        mod_depth: 0.25,
                        modulation: ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Sine,
                            rate: 0.45, // 0.37 Hz
                        },
                        input: Box::new(Mix {
                            uid: Uid::NEW,
                            balance: 0.4,
                            a: Box::new(vco(Waveform::Sine, -1, 0.5)),
                            b: Box::new(Noise {
                                uid: Uid::NEW,
                                color: NoiseColor::Pink,
                            }),
                        }),
                    }),
                },
            },
        },
        Preset {
            name: "Slow Weather",
            category: "pad",
            blurb: "never sits in the same place twice",
            tree: PatchTree {
                amp: amp(0.79, 0.5, 0.85, 0.8),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.65,
                    damp: 0.4,
                    mix: 0.35,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfBp,
                        cutoff: 0.5,
                        resonance: 0.45,
                        mod_depth: 0.5,
                        modulation: ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Triangle,
                            rate: 0.4, // 0.25 Hz — slow, but it does arrive
                        },
                        input: Box::new(supersaw(0, 0.6, 0.55)),
                    }),
                },
            },
        },
        Preset {
            name: "Morph Pad",
            category: "pad",
            // The whole point of the wavetable: the LFO walks `morph` across
            // the crossfade between adjacent tables, so the spectrum breathes
            // without the filter moving at all.
            blurb: "one oscillator slowly turning into a different one",
            tree: PatchTree {
                amp: amp(0.6, 0.45, 0.8, 0.7),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.68,
                    damp: 0.4,
                    mix: 0.35,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.62,
                        resonance: 0.25,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(Wavetable {
                            uid: Uid::NEW,
                            table: TableShape::Saw,
                            octave: 0,
                            morph: 0.3,
                            mod_depth: 0.6,
                            modulation: ModNode::Lfo {
                                uid: Uid::NEW,
                                wave: Waveform::Sine,
                                rate: 0.44, // 0.34 Hz — one sweep per held note
                            },
                        }),
                    }),
                },
            },
        },
        Preset {
            name: "Sweep Machine",
            category: "pad",
            // Feedback above 0.5 is positive (the map is bipolar and centred),
            // which turns the notches into resonant peaks — the difference
            // between a phaser you notice and one you don't.
            blurb: "notches walking up and down a wall of saws",
            tree: PatchTree {
                amp: amp(0.45, 0.45, 0.85, 0.6),
                root: Phaser {
                    uid: Uid::NEW,
                    rate: 0.35, // 0.25 Hz
                    depth: 0.75,
                    feedback: 0.78,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(supersaw(0, 0.45, 0.55)),
                },
            },
        },
        Preset {
            name: "Sea Change",
            category: "pad",
            // Fully wet, which is the whole distinction from a chorus: at
            // `mix` 0.5 the dry copy beats against the shifted one and this
            // becomes `Detune Dream` with extra steps.
            blurb: "a pad that will not quite sit still in tune",
            tree: PatchTree {
                amp: amp(0.35, 0.5, 0.8, 0.5),
                root: Vibrato {
                    uid: Uid::NEW,
                    rate: 0.55, // 1.6 Hz on quiver's own 0.1·150^x map
                    depth: 0.3,
                    mix: 1.0,
                    mod_depth: 0.4,
                    modulation: ModNode::Lfo {
                        uid: Uid::NEW,
                        wave: Waveform::Sine,
                        rate: 0.4, // 0.25 Hz
                    },
                    input: Box::new(supersaw(0, 0.35, 0.5)),
                },
            },
        },
        Preset {
            name: "Pump Room",
            category: "pad",
            // The first patch in the library whose level is driven by a
            // *second* signal: the plucked string is never heard, it only
            // tells the ducker when to get out of the way. Threshold 0.4 is
            // ≈0.32 V on the geometric detector map, just under the string's
            // own envelope peak, so every note ducks and then recovers.
            blurb: "a wide pad that steps aside every time the string is struck",
            tree: PatchTree {
                amp: amp(0.4, 0.5, 0.85, 0.5),
                root: Duck {
                    uid: Uid::NEW,
                    amount: 0.85,
                    threshold: 0.4,
                    release: 0.6, // ≈600 ms — the recovery is the groove
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Chorus {
                        uid: Uid::NEW,
                        rate: 0.25, // 0.27 Hz
                        depth: 0.6,
                        mix: 0.5,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(Filter {
                            uid: Uid::NEW,
                            kind: FilterKind::SvfLp,
                            cutoff: 0.62, // ≈2.0 kHz
                            resonance: 0.25,
                            mod_depth: 0.0,
                            modulation: ModNode::None,
                            input: Box::new(supersaw(-1, 0.4, 0.55)),
                        }),
                    }),
                    key: Box::new(Pluck {
                        uid: Uid::NEW,
                        octave: -1,
                        damping: 0.35,
                        brightness: 0.75,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                    }),
                },
            },
        },
        Preset {
            name: "Tidal",
            category: "pad",
            // `Or` fires wherever *either* pattern does, which on 8-against-12
            // is a dense but uneven figure — the opposite bargain to Ticker's
            // `And`. On chorus depth rather than on a cutoff it reads as the
            // width breathing rather than as a rhythm, which is what keeps it
            // a pad.
            blurb: "width that swells on two rhythms at once",
            tree: PatchTree {
                amp: amp(0.5, 0.5, 0.9, 0.55),
                root: Chorus {
                    uid: Uid::NEW,
                    rate: 0.25, // 0.27 Hz
                    depth: 0.35,
                    mix: 0.6,
                    mod_depth: 0.8,
                    modulation: ModNode::Pair {
                        uid: Uid::NEW,
                        kind: PairOp::Or,
                        a: Box::new(ModNode::Euclid {
                            uid: Uid::NEW,
                            rate: 0.55, // ≈83 bpm
                            steps: 0.303,
                            pulses: 0.230,
                        }),
                        b: Box::new(ModNode::Euclid {
                            uid: Uid::NEW,
                            rate: 0.55,
                            steps: 0.613,
                            pulses: 0.190,
                        }),
                    },
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.62, // ≈1.6 kHz
                        resonance: 0.15,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(supersaw(-1, 0.45, 0.5)),
                    }),
                },
            },
        },
        // ---------------------------------------------------------------
        // TEXTURE
        // ---------------------------------------------------------------
        Preset {
            name: "Noise Wash",
            category: "texture",
            blurb: "coastal fog with a pitch somewhere inside it",
            tree: PatchTree {
                amp: amp(0.7, 0.5, 0.75, 0.8),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfLp,
                    cutoff: 0.45,
                    resonance: 0.5,
                    mod_depth: 0.5,
                    modulation: ModNode::Lfo {
                        uid: Uid::NEW,
                        wave: Waveform::Sine,
                        rate: 0.44, // 0.34 Hz — was 0.15 (0.033 Hz, 30 s/cycle)
                    },
                    input: Box::new(Noise {
                        uid: Uid::NEW,
                        color: NoiseColor::Pink,
                    }),
                },
            },
        },
        Preset {
            name: "Dub Echo",
            category: "texture",
            blurb: "the mixing desk is the instrument",
            tree: PatchTree {
                amp: amp(0.02, 0.3, 0.5, 0.4),
                root: Delay {
                    uid: Uid::NEW,
                    // Was 0.45 — 31 ms, which is a flanger. 0.79 is ~420 ms,
                    // which is the sound the name has always promised.
                    time: 0.79,
                    feedback: 0.75,
                    mix: 0.5,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.5,
                        resonance: 0.35,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(vco(Waveform::Square, 0, 0.5)),
                    }),
                },
            },
        },
        Preset {
            name: "Static Ocean",
            category: "texture",
            blurb: "surf heard from a headland",
            tree: PatchTree {
                amp: amp(0.85, 0.5, 0.85, 0.9),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.9,
                    damp: 0.6,
                    mix: 0.55,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfBp,
                        cutoff: 0.55,
                        resonance: 0.65,
                        mod_depth: 0.55,
                        modulation: ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Sine,
                            rate: 0.42, // 0.29 Hz
                        },
                        input: Box::new(Noise {
                            uid: Uid::NEW,
                            color: NoiseColor::White,
                        }),
                    }),
                },
            },
        },
        Preset {
            name: "Rotor",
            category: "texture",
            blurb: "a machine idling in the next room",
            tree: PatchTree {
                amp: amp(0.65, 0.5, 0.9, 0.6),
                root: Chorus {
                    uid: Uid::NEW,
                    rate: 0.45,
                    depth: 0.6,
                    mix: 0.5,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.42,
                        resonance: 0.4,
                        mod_depth: 0.4,
                        modulation: ModNode::Rand {
                            uid: Uid::NEW,
                            rate: 0.58,
                            glide: 0.0,
                        }, // ~1.0 Hz
                        input: Box::new(vco(Waveform::Square, -1, 0.5)),
                    }),
                },
            },
        },
        Preset {
            name: "Long Room",
            category: "texture",
            blurb: "a drone that builds itself while you hold the key",
            tree: PatchTree {
                amp: amp(0.7, 0.5, 0.85, 0.9),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.8,
                    damp: 0.45,
                    mix: 0.4,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Delay {
                        uid: Uid::NEW,
                        time: 0.82, // ~500 ms
                        feedback: 0.62,
                        mix: 0.45,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(Filter {
                            uid: Uid::NEW,
                            kind: FilterKind::SvfLp,
                            cutoff: 0.45,
                            resonance: 0.3,
                            mod_depth: 0.22,
                            modulation: ModNode::Lfo {
                                uid: Uid::NEW,
                                wave: Waveform::Triangle,
                                rate: 0.42, // 0.29 Hz — 0.38 was 0.21, under the floor
                            },
                            input: Box::new(vco(Waveform::Sine, -1, 0.5)),
                        }),
                    }),
                },
            },
        },
        Preset {
            name: "Handheld",
            category: "texture",
            // S&H on the bit depth, with the glide open a little so the
            // quantizer slides between resolutions instead of stepping —
            // the difference between a broken machine and a dying one.
            blurb: "a sound remembered by something with not enough memory",
            tree: PatchTree {
                amp: amp(0.02, 0.4, 0.6, 0.3),
                root: Bitcrush {
                    uid: Uid::NEW,
                    bits: 0.32,
                    downsample: 0.42,
                    mod_depth: 0.45,
                    modulation: ModNode::Rand {
                        uid: Uid::NEW,
                        rate: 0.55, // 0.82 Hz
                        glide: 0.35,
                    },
                    input: Box::new(vco(Waveform::Square, 0, 0.5)),
                },
            },
        },
        Preset {
            name: "Jet Wash",
            category: "texture",
            // `feedback` 0.78 is a *positive* 0.39 on the bipolar map — the
            // resonant side, where the comb peaks ring rather than the
            // notches deepening. Below 0.5 the same knob flips the sign.
            blurb: "white noise pushed through a jet engine",
            tree: PatchTree {
                amp: amp(0.25, 0.5, 0.8, 0.5),
                root: Flanger {
                    uid: Uid::NEW,
                    rate: 0.45, // 0.4 Hz on quiver's own 0.05·100^x map
                    depth: 0.75,
                    feedback: 0.78,
                    mod_depth: 0.35,
                    modulation: ModNode::Lfo {
                        uid: Uid::NEW,
                        wave: Waveform::Sine,
                        rate: 0.42, // 0.29 Hz
                    },
                    input: Box::new(AudioNode::Noise {
                        uid: Uid::NEW,
                        color: NoiseColor::White,
                    }),
                },
            },
        },
        Preset {
            name: "Cloud Chamber",
            category: "texture",
            // `position` is kept near the write head on purpose: quiver's
            // grain buffer is 96 000 samples and starts empty, so a granulator
            // parked at the far end of it reads silence for the first two
            // seconds of a five-second phrase.
            blurb: "a triangle taken apart and reassembled in the wrong order",
            tree: PatchTree {
                amp: amp(0.3, 0.5, 0.85, 0.6),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.75,
                    damp: 0.5,
                    mix: 0.45,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Granular {
                        uid: Uid::NEW,
                        position: 0.08,
                        size: 0.35,    // 181 ms grains
                        density: 0.75, // 15 grains/second, so ~2.8 overlapping
                        mod_depth: 0.5,
                        modulation: ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Sine,
                            rate: 0.43, // 0.31 Hz
                        },
                        input: Box::new(vco(Waveform::Triangle, 0, 0.5)),
                    }),
                },
            },
        },
        Preset {
            name: "Vox Machina",
            category: "texture",
            // A vocoder needs both branches to be right or it says nothing: a
            // sine carrier has no energy in fifteen of the sixteen bands, and
            // a static modulator makes a fixed filter. So the carrier is a
            // supersaw and the modulator's vowel is swept a full cycle per
            // held note — the sweep *is* the patch.
            blurb: "a saw stack made to speak, one vowel at a time",
            tree: PatchTree {
                amp: amp(0.25, 0.45, 0.85, 0.4),
                root: Vocoder {
                    uid: Uid::NEW,
                    bands: 0.75,  // ≈13 bands
                    attack: 0.15, // ≈38 ms
                    release: 0.35,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    carrier: Box::new(supersaw(0, 0.5, 0.65)),
                    modulator: Box::new(Formant {
                        uid: Uid::NEW,
                        vowel: 0.25,
                        shift: 0.5, // no formant shift; the sweep is the vowel
                        octave: 0,
                        mod_depth: 0.7,
                        modulation: ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Triangle,
                            rate: 0.49, // 0.5 Hz — one sweep per held note
                        },
                    }),
                },
            },
        },
        Preset {
            name: "Glass Rain",
            category: "texture",
            // `Hold` samples another modulator on its own clock, which is what
            // separates it from `s&h rand`: the values are not noise, they are
            // a sine caught at moments. On the granulator's read position that
            // makes the grains jump between a handful of places in the buffer
            // instead of sweeping through it — the difference between rain and
            // a smear.
            blurb: "grains caught from a few places at once, never sweeping",
            tree: PatchTree {
                amp: amp(0.35, 0.5, 0.85, 0.55),
                root: AudioNode::Granular {
                    uid: Uid::NEW,
                    position: 0.5,
                    size: 0.25,    // ≈130 ms grains
                    density: 0.75, // ≈15 per second
                    mod_depth: 0.8,
                    modulation: ModNode::Op {
                        uid: Uid::NEW,
                        kind: ModOp::Hold,
                        p0: 0.55, // ≈83 bpm — about one jump per bar
                        p1: 0.0,
                        input: Box::new(ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Sine,
                            rate: 0.52, // 0.64 Hz, so successive samples differ
                        }),
                    },
                    input: Box::new(vco(Waveform::Triangle, 0, 0.5)),
                },
            },
        },
        Preset {
            name: "One Way",
            category: "texture",
            // `Rectify` in `positive` mode throws away the bottom half of the
            // LFO, so the fold threshold is only ever pushed *down* from where
            // the knob set it and the patch has a resting state it returns to.
            // A bipolar LFO on the same cable would fold and unfold
            // symmetrically, which reads as a wobble rather than as a bloom.
            blurb: "folds harder in bursts and always settles back",
            tree: PatchTree {
                amp: amp(0.3, 0.45, 0.8, 0.4),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.6,
                    damp: 0.5,
                    mix: 0.35,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Fold {
                        uid: Uid::NEW,
                        threshold: 0.7,
                        mod_depth: 0.7,
                        modulation: ModNode::Op {
                            uid: Uid::NEW,
                            kind: ModOp::Rectify,
                            p0: 0.5, // cell centre of `positive`
                            p1: 0.0,
                            input: Box::new(ModNode::Lfo {
                                uid: Uid::NEW,
                                wave: Waveform::Triangle,
                                rate: 0.5, // 0.55 Hz
                            }),
                        },
                        input: Box::new(vco(Waveform::Triangle, 0, 0.5)),
                    }),
                },
            },
        },
        // ---------------------------------------------------------------
        // PERC
        // ---------------------------------------------------------------
        Preset {
            name: "Flint",
            category: "perc",
            blurb: "a struck spark",
            tree: PatchTree {
                amp: amp(0.0, 0.35, 0.0, 0.25),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfHp,
                    cutoff: 0.72,
                    resonance: 0.55,
                    mod_depth: 0.3,
                    modulation: ModNode::Env {
                        uid: Uid::NEW,
                        attack: 0.0,
                        decay: 0.2,
                    },
                    input: Box::new(Noise {
                        uid: Uid::NEW,
                        color: NoiseColor::White,
                    }),
                },
            },
        },
        Preset {
            name: "Deadfall",
            category: "perc",
            blurb: "a tuned drum with the room taken out",
            tree: PatchTree {
                amp: amp(0.0, 0.45, 0.0, 0.3),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::Ladder,
                    cutoff: 0.5,
                    resonance: 0.3,
                    mod_depth: 0.55,
                    modulation: ModNode::Env {
                        uid: Uid::NEW,
                        attack: 0.0,
                        decay: 0.2,
                    },
                    input: Box::new(vco(Waveform::Sine, -2, 0.5)),
                },
            },
        },
        Preset {
            name: "Ricochet",
            category: "perc",
            blurb: "a metallic ping bouncing down a corridor",
            tree: PatchTree {
                amp: amp(0.0, 0.4, 0.0, 0.25),
                root: Delay {
                    uid: Uid::NEW,
                    time: 0.54, // 60 ms — tight enough to read as a bounce
                    feedback: 0.68,
                    mix: 0.55,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfBp,
                        cutoff: 0.7,
                        resonance: 0.65,
                        mod_depth: 0.25,
                        modulation: ModNode::Env {
                            uid: Uid::NEW,
                            attack: 0.0,
                            decay: 0.15,
                        },
                        input: Box::new(vco(Waveform::Square, 1, 0.5)),
                    }),
                },
            },
        },
        Preset {
            name: "Heartbeat",
            category: "perc",
            // `shape` 0.8 is most of the way to triangle, which is what makes
            // the pulse arrive rather than swell — a sine tremolo at this
            // depth reads as a wobble, not a beat.
            blurb: "a square wave with a pulse, and it quickens",
            tree: PatchTree {
                amp: amp(0.02, 0.45, 0.7, 0.25),
                root: Tremolo {
                    uid: Uid::NEW,
                    rate: 0.62, // 2.7 Hz on quiver's own 0.1·200^x map
                    depth: 0.85,
                    shape: 0.8,
                    mod_depth: 0.4,
                    modulation: ModNode::Env {
                        uid: Uid::NEW,
                        attack: 0.3,
                        decay: 0.6,
                    },
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.45,
                        resonance: 0.4,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(vco(Waveform::Square, -1, 0.5)),
                    }),
                },
            },
        },
        Preset {
            name: "Morse",
            category: "perc",
            // The drone underneath is continuous; what you hear is the
            // string's own envelope cut into it. Range 0.95 means a shut gate
            // passes almost nothing, so the patch is percussive without any
            // percussive source in it.
            blurb: "a drone you only hear while the string is still ringing",
            tree: PatchTree {
                amp: amp(0.1, 0.4, 0.9, 0.4),
                root: Gate {
                    uid: Uid::NEW,
                    threshold: 0.45,
                    range: 0.95,
                    release: 0.25, // ≈133 ms — a tight close
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfBp,
                        cutoff: 0.55, // ≈1.2 kHz
                        resonance: 0.6,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(supersaw(0, 0.35, 0.5)),
                    }),
                    sidechain: Box::new(Pluck {
                        uid: Uid::NEW,
                        octave: -1,
                        damping: 0.35,
                        brightness: 0.75,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                    }),
                },
            },
        },
        Preset {
            name: "Ticker",
            category: "perc",
            // Two euclidean patterns ANDed: the filter only opens where both
            // agree, which on 8-against-9 is a sparse figure that takes 72
            // steps to repeat. `esteps` 0.303 is 8 and 0.380 is 9 (quiver
            // takes `2 + cv·14.99` and the compiler feeds it `0.14 + 0.86x`);
            // `epulses` 0.230 is 3 of 8 and 0.122 is 3 of 9.
            blurb: "a filter opening only where two rhythms agree",
            tree: PatchTree {
                amp: amp(0.0, 0.25, 0.9, 0.15),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfBp,
                    cutoff: 0.66, // ≈1.9 kHz
                    resonance: 0.55,
                    mod_depth: 0.8,
                    modulation: ModNode::Pair {
                        uid: Uid::NEW,
                        kind: PairOp::And,
                        a: Box::new(ModNode::Euclid {
                            uid: Uid::NEW,
                            rate: 0.62, // ≈107 bpm
                            steps: 0.303,
                            pulses: 0.230,
                        }),
                        b: Box::new(ModNode::Euclid {
                            uid: Uid::NEW,
                            rate: 0.62,
                            steps: 0.380,
                            pulses: 0.122,
                        }),
                    },
                    input: Box::new(AudioNode::Noise {
                        uid: Uid::NEW,
                        color: NoiseColor::White,
                    }),
                },
            },
        },
        Preset {
            name: "Woodblock",
            category: "perc",
            // The pluck's own decay is the sound; the bandpass only decides
            // which block. Brightness high and decay low is a small hard
            // object — the string's loop filter opens as `damping` rises, so
            // 0.2 is a short, dry ring rather than a long one.
            blurb: "small, hard and hollow; struck once",
            tree: PatchTree {
                amp: amp(0.0, 0.3, 0.0, 0.2),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfBp,
                    cutoff: 0.6, // ≈1.0 kHz
                    resonance: 0.6,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(AudioNode::Pluck {
                        uid: Uid::NEW,
                        octave: 1,
                        damping: 0.2,
                        brightness: 0.85,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                    }),
                },
            },
        },
        Preset {
            name: "Gated Snare",
            category: "perc",
            // The gate is keyed by the pluck, not by the noise it passes —
            // which is the whole point of a second audio branch. The key is a
            // plucked string at ≈0.14 V mean, so the threshold sits low on the
            // geometric detector map; 0.45 is where a struck string opens it
            // and lets it shut again inside one note.
            blurb: "noise, allowed through only while a string is ringing",
            tree: PatchTree {
                amp: amp(0.0, 0.4, 0.4, 0.2),
                root: AudioNode::Gate {
                    uid: Uid::NEW,
                    threshold: 0.45,
                    range: 0.85,
                    release: 0.2,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfHp,
                        cutoff: 0.5, // ≈630 Hz
                        resonance: 0.2,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(AudioNode::Noise {
                            uid: Uid::NEW,
                            color: NoiseColor::White,
                        }),
                    }),
                    sidechain: Box::new(AudioNode::Pluck {
                        uid: Uid::NEW,
                        octave: 0,
                        damping: 0.3,
                        brightness: 0.6,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                    }),
                },
            },
        },
        // ---------------------------------------------------------------
        // WEIRD
        // ---------------------------------------------------------------
        Preset {
            name: "Two Minds",
            category: "weird",
            // `Switch` picks between its two branches on the level of `b`, so
            // the *modulator itself* changes shape mid-note: while the fast
            // LFO is high the cutoff follows the slow one, and while it is low
            // the fast one takes over. Neither rate divides the other, so the
            // handover never lands in the same place twice.
            blurb: "a filter modulated by two minds that keep interrupting each other",
            tree: PatchTree {
                amp: amp(0.3, 0.4, 0.8, 0.4),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfLp,
                    cutoff: 0.5, // ≈630 Hz
                    resonance: 0.5,
                    mod_depth: 0.75,
                    modulation: ModNode::Pair {
                        uid: Uid::NEW,
                        kind: PairOp::Switch,
                        a: Box::new(ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Triangle,
                            rate: 0.42, // 0.29 Hz
                        }),
                        b: Box::new(ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Sine,
                            rate: 0.58, // 1.0 Hz
                        }),
                    },
                    input: Box::new(supersaw(0, 0.4, 0.5)),
                },
            },
        },
        Preset {
            name: "Ceiling",
            category: "weird",
            // `Max` is a floor, not a ceiling — the name is what it does to
            // the *sound*. The envelope closes the filter after each attack,
            // but the LFO underneath it never lets the cutoff fall past its
            // own peak, so the patch decays to a breathing plateau instead of
            // to silence.
            blurb: "decays toward a moving floor and never reaches it",
            tree: PatchTree {
                amp: amp(0.05, 0.4, 0.7, 0.35),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::Ladder,
                    cutoff: 0.35, // ≈220 Hz
                    resonance: 0.55,
                    mod_depth: 0.6,
                    modulation: ModNode::Pair {
                        uid: Uid::NEW,
                        kind: PairOp::Max,
                        a: Box::new(ModNode::Env {
                            uid: Uid::NEW,
                            attack: 0.05, // ≈2.5 ms
                            decay: 0.5,   // ≈100 ms
                        }),
                        b: Box::new(ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Sine,
                            rate: 0.49, // 0.51 Hz
                        }),
                    },
                    input: Box::new(vco(Waveform::Saw, -1, 0.5)),
                },
            },
        },
        Preset {
            name: "Undertow",
            category: "weird",
            // `Min` is the opposite bargain: the room only opens where *both*
            // modulators agree to open it, so two slow sines a fifth apart in
            // rate produce a swell that mostly does not arrive. The patch is
            // built to be listened to across several notes rather than one.
            blurb: "a room that only opens when two slow tides agree",
            tree: PatchTree {
                amp: amp(0.55, 0.5, 0.85, 0.6),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.55,
                    damp: 0.4,
                    mix: 0.7,
                    mod_depth: 0.9,
                    modulation: ModNode::Pair {
                        uid: Uid::NEW,
                        kind: PairOp::Min,
                        a: Box::new(ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Sine,
                            rate: 0.4, // 0.25 Hz
                        }),
                        b: Box::new(ModNode::Lfo {
                            uid: Uid::NEW,
                            wave: Waveform::Sine,
                            rate: 0.46, // 0.38 Hz
                        }),
                    },
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.55, // ≈890 Hz
                        resonance: 0.2,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(supersaw(-1, 0.5, 0.6)),
                    }),
                },
            },
        },
        Preset {
            name: "Sour Mash",
            category: "weird",
            // A square LFO on a fold threshold is the only hard-switching
            // modulation the grammar can make. Nothing else uses it.
            //
            // The input is deliberately a pair of `Vco`s and **not** a
            // `Supersaw`. Quiver's wavefolder folds `x / 5.0`, and `Vco` and
            // `Noise` scale their outputs `* 5.0` while `Supersaw` does not
            // (`oscillators.rs`, `outputs.set(10, output)`) — measured peaks
            // 4.94 against 0.74. Fed a supersaw, the folder never reaches its
            // own threshold: sweeping it 0.25 → 1.0 gave bit-identical output,
            // and this patch, whose entire premise is a hard-switching folder,
            // measured as the 4th most static of the 29. Anything built on
            // `Fold` needs a source at rack level.
            blurb: "pure character, no manners, and no filter at all",
            tree: PatchTree {
                amp: amp(0.2, 0.45, 0.7, 0.35),
                root: Fold {
                    uid: Uid::NEW,
                    threshold: 0.3,
                    mod_depth: 0.6,
                    modulation: ModNode::Lfo {
                        uid: Uid::NEW,
                        wave: Waveform::Square,
                        rate: 0.6, // 1.2 Hz — audibly switching
                    },
                    input: Box::new(Mix {
                        uid: Uid::NEW,
                        balance: 0.45,
                        a: Box::new(vco(Waveform::Saw, 0, 0.5)),
                        b: Box::new(vco(Waveform::Square, -1, 0.5)),
                    }),
                },
            },
        },
        Preset {
            name: "Wrong Number",
            category: "weird",
            blurb: "a narrow resonant peak, hunting for a pitch",
            tree: PatchTree {
                amp: amp(0.15, 0.5, 0.6, 0.35),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfBp,
                    cutoff: 0.45,
                    resonance: 0.82,
                    mod_depth: 0.7,
                    modulation: ModNode::Rand {
                        uid: Uid::NEW,
                        rate: 0.8,
                        glide: 0.0,
                    }, // ~6 Hz
                    input: Box::new(vco(Waveform::Triangle, 0, 0.5)),
                },
            },
        },
        Preset {
            name: "Inside Out",
            category: "weird",
            // The one place an Env *attack* is long: the highpass corner
            // climbs for most of a second after the note starts, so the body
            // thins out as the note sustains and the transient is the last
            // thing left.
            blurb: "the note arrives some time after the transient does",
            tree: PatchTree {
                amp: amp(0.6, 0.5, 0.7, 0.45),
                root: Chorus {
                    uid: Uid::NEW,
                    rate: 0.35, // 0.39 Hz — 0.15 was 0.18, slower than any LFO here
                    depth: 0.7,
                    mix: 0.6,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfHp,
                        cutoff: 0.8,
                        resonance: 0.45,
                        mod_depth: 0.65,
                        modulation: ModNode::Env {
                            uid: Uid::NEW,
                            attack: 0.6,
                            decay: 0.65,
                        },
                        input: Box::new(Mix {
                            uid: Uid::NEW,
                            balance: 0.55,
                            a: Box::new(vco(Waveform::Saw, -1, 0.5)),
                            b: Box::new(vco(Waveform::Square, 1, 0.5)),
                        }),
                    }),
                },
            },
        },
        // ---------------------------------------------------------------
        // The three below could not have existed before wave 2C, when
        // modulation stopped being a flat list of leaves. Each is built on a
        // different one of the new productions.
        // ---------------------------------------------------------------
        Preset {
            name: "Ask The Dice",
            category: "lead",
            // The whole point of the quantizer, and the reason `mod_depth` is
            // exactly 1.0 here rather than a taste value: the cable's gain at
            // full depth is 0.1, which is precisely what turns the quantizer's
            // grid into whole semitones on the pitch offset. Anywhere else on
            // the knob the intervals are a stretched tuning — still a melody,
            // but not this one.
            blurb: "a random melody, quantized to A minor and glided into",
            tree: PatchTree {
                amp: amp(0.02, 0.3, 0.5, 0.25),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfLp,
                    cutoff: 0.62,
                    resonance: 0.4,
                    mod_depth: 0.35,
                    modulation: ModNode::Env {
                        uid: Uid::NEW,
                        attack: 0.02,
                        decay: 0.3,
                    },
                    input: Box::new(Vco {
                        uid: Uid::NEW,
                        wave: Waveform::Saw,
                        octave: 0,
                        detune: 0.5,
                        mod_depth: 1.0,
                        // The wave's headline term, two processors deep:
                        // noise sampled and held, snapped to a scale, then
                        // glided between. The slew is last so it glides
                        // *between notes* — put it under the quantizer and it
                        // would only smooth the noise before it was snapped,
                        // which is inaudible.
                        modulation: ModNode::Op {
                            uid: Uid::NEW,
                            kind: ModOp::Slew,
                            p0: 0.18, // ≈35 ms up…
                            p1: 0.3,  // …and ≈90 ms down: a fall is a slur
                            input: Box::new(ModNode::Op {
                                uid: Uid::NEW,
                                kind: ModOp::Quantize,
                                p0: 9.5 / 12.0, // root A
                                p1: 2.5 / 7.0,  // minor
                                input: Box::new(ModNode::Rand {
                                    uid: Uid::NEW,
                                    rate: 0.62, // ≈1.6 Hz — a note every beat
                                    glide: 0.0, // the slew above owns the glide
                                }),
                            }),
                        },
                    }),
                },
            },
        },
        Preset {
            name: "Nine Against Four",
            category: "pad",
            // Two euclidean patterns of different lengths XORed: the combined
            // gate does not repeat until their step counts do, so a pad that
            // is nominally static never opens the same way twice inside a
            // phrase. This is the `Pair` production's reason for existing.
            blurb: "two rhythms disagreeing, opening the filter where they do",
            tree: PatchTree {
                amp: amp(0.25, 0.5, 0.85, 0.6),
                root: Reverb {
                    uid: Uid::NEW,
                    size: 0.7,
                    damp: 0.45,
                    mix: 0.45,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.32,
                        resonance: 0.5,
                        mod_depth: 0.75,
                        modulation: ModNode::Pair {
                            uid: Uid::NEW,
                            kind: PairOp::Xor,
                            a: Box::new(ModNode::Euclid {
                                uid: Uid::NEW,
                                rate: 0.62,   // ≈120 BPM
                                steps: 0.36,  // 8 steps
                                pulses: 0.34, // 3 of 8
                            }),
                            b: Box::new(ModNode::Euclid {
                                uid: Uid::NEW,
                                rate: 0.62,   // the same clock…
                                steps: 0.44,  // …over 9 steps, so they drift
                                pulses: 0.28, // 3 of 9
                            }),
                        },
                        input: Box::new(supersaw(-1, 0.4, 0.55)),
                    }),
                },
            },
        },
        Preset {
            name: "Long Way Down",
            category: "texture",
            // The slew limiter on its own, at the top of its travel: a
            // stepped random source becomes a drift with no steps left in it
            // at all. `Rand`'s own `glide` cannot reach here — it shares one
            // knob between rise and fall and runs on quiver's raw map, where
            // everything under a second and a half lives in the bottom
            // quarter.
            blurb: "a random source with every step sanded off it",
            tree: PatchTree {
                amp: amp(0.4, 0.6, 0.9, 0.7),
                root: Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfBp,
                    cutoff: 0.5,
                    resonance: 0.6,
                    mod_depth: 0.85,
                    modulation: ModNode::Op {
                        uid: Uid::NEW,
                        kind: ModOp::Slew,
                        p0: 0.85, // ≈1.2 s up…
                        p1: 0.55, // …and ≈0.5 s down, so it falls faster
                        input: Box::new(ModNode::Rand {
                            uid: Uid::NEW,
                            rate: 0.5,  // ≈0.55 Hz
                            glide: 0.0, // hard steps in; the slew makes the ramp
                        }),
                    },
                    input: Box::new(Mix {
                        uid: Uid::NEW,
                        balance: 0.4,
                        a: Box::new(supersaw(0, 0.6, 0.4)),
                        b: Box::new(AudioNode::Noise {
                            uid: Uid::NEW,
                            color: NoiseColor::Pink,
                        }),
                    }),
                },
            },
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// `0.01·3000^x` Hz, the LFO/S&H rate map (quiver `oscillators.rs`).
    fn mod_hz(cv: f64) -> f64 {
        0.01 * 3000f64.powf(cv)
    }

    /// `0.1·50^x` Hz — the chorus runs its own, much narrower map, which is
    /// why it needs its own conversion rather than sharing the LFO's. Missing
    /// this is how `Inside Out` ended up with a 0.18 Hz chorus: slower than
    /// any LFO in the library, and slower than the floor the library enforces
    /// on LFOs, while sitting outside the test that enforces it.
    fn chorus_hz(cv: f64) -> f64 {
        0.1 * 50f64.powf(cv)
    }

    fn hz_of(kind: &str, cv: f64) -> f64 {
        if kind == "chorus" {
            chorus_hz(cv)
        } else {
            mod_hz(cv)
        }
    }

    /// Walk every modulation source in the library.
    fn mod_sources() -> Vec<(&'static str, &'static str, f64)> {
        fn walk(
            n: &AudioNode,
            name: &'static str,
            out: &mut Vec<(&'static str, &'static str, f64)>,
        ) {
            // A free function, not a closure over `out`: the chorus arm has
            // to push its own rate *and* note its slot, and a closure holding
            // `out` mutably cannot coexist with that.
            fn note(
                m: &ModNode,
                name: &'static str,
                out: &mut Vec<(&'static str, &'static str, f64)>,
            ) {
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
                // Neither has a modulation slot or a child to walk.
                AudioNode::Noise { .. } | AudioNode::Silence { .. } => {}
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
    /// four with margin and still leaves room for a genuinely slow pad drift.
    #[test]
    fn every_modulation_source_is_audible_within_one_note() {
        const FLOOR_HZ: f64 = 0.2;
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

    /// Every one of the original four offenders must fail the gate. Without
    /// this, the floor is a number someone liked rather than one that catches
    /// the bug — which is exactly how the first version of it let half of them
    /// through.
    #[test]
    fn the_floor_catches_every_original_offender() {
        for cv in [0.15, 0.20, 0.35, 0.35] {
            let f = mod_hz(cv);
            assert!(
                f < 0.2,
                "rate {cv} = {f:.4} Hz would now pass the floor it exists to catch"
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
        mods: HashSet<&'static str>,
        nodes: HashSet<&'static str>,
    }

    impl Coverage {
        fn note_mod(&mut self, m: &ModNode) {
            match m {
                ModNode::None => {
                    self.mods.insert("none");
                }
                ModNode::Lfo { wave, .. } => {
                    self.mods.insert("lfo");
                    self.lfo_waves.insert(format!("{wave:?}"));
                }
                ModNode::Env { .. } => {
                    self.mods.insert("env");
                }
                ModNode::Rand { .. } => {
                    self.mods.insert("rand");
                }
                ModNode::Follow { .. } => {
                    self.mods.insert("follow");
                }
                ModNode::Euclid { .. } => {
                    self.mods.insert("euclid");
                }
                ModNode::Op { kind, input, .. } => {
                    self.mods.insert(kind.label());
                    self.note_mod(input);
                }
                ModNode::Pair { kind, a, b, .. } => {
                    self.mods.insert(kind.label());
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
                    self.nodes.insert("vco");
                    self.waves.insert(format!("{wave:?}"));
                    self.octaves.insert(*octave);
                    self.note_mod(modulation);
                }
                AudioNode::Supersaw {
                    octave, modulation, ..
                } => {
                    self.nodes.insert("supersaw");
                    self.octaves.insert(*octave);
                    self.note_mod(modulation);
                }
                AudioNode::Formant {
                    octave, modulation, ..
                } => {
                    self.nodes.insert("formant");
                    self.octaves.insert(*octave);
                    self.note_mod(modulation);
                }
                AudioNode::Noise { color, .. } => {
                    self.nodes.insert("noise");
                    self.colors.insert(format!("{color:?}"));
                }
                AudioNode::Silence { .. } => {
                    self.nodes.insert("silence");
                }
                AudioNode::Wavetable {
                    table,
                    octave,
                    modulation,
                    ..
                } => {
                    self.nodes.insert("wavetable");
                    self.tables.insert(format!("{table:?}"));
                    self.octaves.insert(*octave);
                    self.note_mod(modulation);
                }
                AudioNode::Pluck {
                    octave, modulation, ..
                } => {
                    self.nodes.insert("pluck");
                    self.octaves.insert(*octave);
                    self.note_mod(modulation);
                }
                AudioNode::Mix { a, b, .. } => {
                    self.nodes.insert("mix");
                    self.walk(a);
                    self.walk(b);
                }
                AudioNode::RingMod { a, b, .. } => {
                    self.nodes.insert("ringmod");
                    self.walk(a);
                    self.walk(b);
                }
                AudioNode::Filter {
                    kind,
                    modulation,
                    input,
                    ..
                } => {
                    self.nodes.insert("filter");
                    self.kinds.insert(format!("{kind:?}"));
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Fold {
                    modulation, input, ..
                } => {
                    self.nodes.insert("fold");
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Delay {
                    modulation, input, ..
                } => {
                    self.nodes.insert("delay");
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Chorus {
                    modulation, input, ..
                } => {
                    self.nodes.insert("chorus");
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Reverb {
                    modulation, input, ..
                } => {
                    self.nodes.insert("reverb");
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Distortion {
                    mode,
                    modulation,
                    input,
                    ..
                } => {
                    self.nodes.insert("distortion");
                    self.drive_modes.insert(format!("{mode:?}"));
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Bitcrush {
                    modulation, input, ..
                } => {
                    self.nodes.insert("bitcrush");
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Phaser {
                    modulation, input, ..
                } => {
                    self.nodes.insert("phaser");
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Flanger {
                    modulation, input, ..
                } => {
                    self.nodes.insert("flanger");
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Tremolo {
                    modulation, input, ..
                } => {
                    self.nodes.insert("tremolo");
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Vibrato {
                    modulation, input, ..
                } => {
                    self.nodes.insert("vibrato");
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Eq {
                    modulation, input, ..
                } => {
                    self.nodes.insert("eq");
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Granular {
                    modulation, input, ..
                } => {
                    self.nodes.insert("granular");
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Shift {
                    modulation, input, ..
                } => {
                    self.nodes.insert("shift");
                    self.note_mod(modulation);
                    self.walk(input);
                }
                AudioNode::Comp {
                    modulation,
                    input,
                    sidechain,
                    ..
                } => {
                    self.nodes.insert("comp");
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
                    self.nodes.insert("duck");
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
                    self.nodes.insert("gate");
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
                    self.nodes.insert("vocoder");
                    self.note_mod(modulation);
                    self.walk(carrier);
                    self.walk(modulator);
                }
            }
        }
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

        assert_eq!(waves.len(), 4, "not every oscillator waveform is used");
        assert!(
            lfo_waves.len() >= 3,
            "the LFO is only ever run as {lfo_waves:?} — its waveform is a real timbral choice"
        );
        assert_eq!(kinds.len(), 4, "not every filter kind is used: {kinds:?}");
        assert_eq!(colors.len(), 2, "one of the noise colours is never heard");
        assert!(
            !tables.is_empty(),
            "the wavetable oscillator is never heard"
        );
        assert!(!drive_modes.is_empty(), "the distortion is never heard");
        // Every modulation **source** — the five leaf kinds plus the empty
        // slot — has to appear, on the same argument as the node list: a
        // source no preset demonstrates is a source nobody discovers.
        //
        // The eleven **shapers** are held to a weaker bar, and deliberately.
        // They are a combinatorial space rather than a list (any of them over
        // any source, two deep), so "one preset each" would be eleven near
        // duplicates that teach the same lesson; what the library owes is that
        // each of the three new *productions* — a leaf generator, a unary
        // processor, a binary combiner — is shown at least once, so the shape
        // of the sort is discoverable from the bank.
        for src in ["none", "lfo", "env", "rand", "follow", "euclid"] {
            assert!(mods.contains(src), "no preset uses the {src} modulator");
        }
        // The shapers *were* held to a weaker bar than the sources, on the
        // argument above that they are a combinatorial space rather than a
        // list. That bar turned out to be too weak to be worth having: it
        // passed with `rectify`, `hold` and five of the six combiners in zero
        // presets, which is exactly the "a source nobody demonstrates is a
        // source nobody discovers" failure the source rule exists to prevent —
        // and the bank's auto-namer has no adjectives for a region of the
        // grammar the library never visits.
        //
        // Each of the ten now needs one preset. They are not near-duplicates
        // in practice: `min` and `max` are opposite bargains on the same two
        // modulators, `and` and `or` are opposite densities on the same two
        // patterns, and `rectify` is the one that gives a modulator a resting
        // state. If a future op genuinely has nothing of its own to show, the
        // honest move is to cut it from the palette rather than to lower this.
        for op in [
            "quantize", "slew", "rectify", "hold", "min", "max", "and", "or", "xor", "switch",
        ] {
            assert!(
                mods.contains(op),
                "no preset uses the {op} modulation shaper: {mods:?}"
            );
        }
        assert_eq!(nodes.len(), 26, "not every audio node is used: {nodes:?}");
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
}
