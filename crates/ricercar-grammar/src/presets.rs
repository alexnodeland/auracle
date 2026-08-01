//! Hand-designed preset patches: a starting vocabulary for the bank, and a
//! fast way to seed the taste model ("keep the ones you like").
//!
//! Every preset must compile and pass the vetting gate — pinned by a test in
//! the features crate's dependents (see ricercar-wasm tests).
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
//! Worth knowing before designing: there is no FM, ring mod, sync or PWM, and
//! **no pitch modulation of any kind** — `ModNode` reaches exactly two
//! destinations, `Filter.cutoff` and `Fold.threshold`. So no vibrato and no
//! pitch envelopes. `Vco.detune` on a lone oscillator only transposes the
//! whole patch a few cents sharp; it is only musical inside a `Mix` of two
//! sources. At most two simultaneous sources (one `Mix`), plus `Supersaw`.
//!
//! # The gate is not the constraint
//!
//! Vetting rejects only non-finite output, RMS < 1e-4, peak > 3.5, and
//! `|mean|/rms > 0.6`. It catches pathology, not taste. Design musically and
//! let the gate do its narrow job.
//!
//! # This is also the model's vocabulary lesson
//!
//! The bank's auto-namer (`ricercar-session::naming`) fits its adjectives to
//! the pool's *own* spread and suppresses any axis whose range falls below a
//! just-noticeable difference. A library clustered in one corner therefore
//! produces a bank that honestly reports itself as `Soft Lead`, `Soft Lead 2`,
//! `Soft Lead 3`. Coverage here is what gives the whole app its adjectives.

use crate::term::{AmpEnv, AudioNode, FilterKind, ModNode, NoiseColor, PatchTree, Waveform};

fn amp(attack: f64, decay: f64, sustain: f64, release: f64) -> AmpEnv {
    AmpEnv {
        attack,
        decay,
        sustain,
        release,
    }
}

fn vco(wave: Waveform, octave: i8, detune: f64) -> AudioNode {
    AudioNode::Vco {
        wave,
        octave,
        detune,
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
                    kind: FilterKind::Ladder,
                    cutoff: 0.45,
                    resonance: 0.55,
                    mod_depth: 0.6,
                    modulation: ModNode::Env {
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
                    balance: 0.35,
                    a: Box::new(vco(Waveform::Sine, -1, 0.5)),
                    b: Box::new(Filter {
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
                    kind: FilterKind::Ladder,
                    cutoff: 0.3,
                    resonance: 0.8,
                    mod_depth: 0.65,
                    modulation: ModNode::Env {
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
                    kind: FilterKind::SvfLp,
                    cutoff: 0.45,
                    resonance: 0.35,
                    mod_depth: 0.25,
                    modulation: ModNode::Lfo {
                        wave: Waveform::Triangle,
                        rate: 0.49, // 0.5 Hz — one full sweep per held note
                    },
                    input: Box::new(Mix {
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
                    kind: FilterKind::Ladder,
                    cutoff: 0.42,
                    resonance: 0.35,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(Fold {
                        threshold: 0.35,
                        mod_depth: 0.4,
                        modulation: ModNode::Env {
                            attack: 0.0,
                            decay: 0.325,
                        },
                        input: Box::new(vco(Waveform::Square, -1, 0.5)),
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
                    threshold: 0.4,
                    mod_depth: 0.5,
                    modulation: ModNode::Lfo {
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
                    kind: FilterKind::SvfBp,
                    cutoff: 0.62,
                    resonance: 0.7,
                    mod_depth: 0.25,
                    modulation: ModNode::Rand { rate: 0.62 }, // ~1.4 Hz stepping
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
                    rate: 0.3,
                    depth: 0.35,
                    mix: 0.3,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfLp,
                        cutoff: 0.72,
                        resonance: 0.3,
                        mod_depth: 0.18,
                        modulation: ModNode::Lfo {
                            wave: Waveform::Sine,
                            rate: 0.55, // 0.8 Hz — a slow breath, still audible
                        },
                        input: Box::new(Supersaw {
                            octave: 0,
                            detune: 0.25,
                            mix: 0.45,
                        }),
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
                    time: 0.63, // 120 ms — a slapback, not a comb
                    feedback: 0.4,
                    mix: 0.32,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfLp,
                        cutoff: 0.68,
                        resonance: 0.4,
                        mod_depth: 0.35,
                        modulation: ModNode::Env {
                            attack: 0.0,
                            decay: 0.42,
                        },
                        input: Box::new(vco(Waveform::Triangle, 1, 0.5)),
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
                    kind: FilterKind::SvfBp,
                    cutoff: 0.6,
                    resonance: 0.45,
                    mod_depth: 0.5,
                    modulation: ModNode::Env {
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
                    size: 0.7,
                    damp: 0.3,
                    mix: 0.4,
                    input: Box::new(Fold {
                        threshold: 0.55,
                        mod_depth: 0.35,
                        modulation: ModNode::Env {
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
                    rate: 0.2,
                    depth: 0.3,
                    mix: 0.3,
                    input: Box::new(Mix {
                        balance: 0.3,
                        a: Box::new(vco(Waveform::Sine, 0, 0.5)),
                        b: Box::new(Filter {
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
                    kind: FilterKind::Ladder,
                    cutoff: 0.55,
                    resonance: 0.6,
                    mod_depth: 0.3,
                    modulation: ModNode::Rand { rate: 0.75 }, // ~4 Hz
                    input: Box::new(vco(Waveform::Saw, 0, 0.5)),
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
                    size: 0.85,
                    damp: 0.35,
                    mix: 0.5,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfLp,
                        cutoff: 0.55,
                        resonance: 0.25,
                        mod_depth: 0.3,
                        modulation: ModNode::Rand { rate: 0.45 }, // 0.37 Hz
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
                    rate: 0.25,
                    depth: 0.5,
                    mix: 0.45,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfLp,
                        cutoff: 0.65,
                        resonance: 0.2,
                        mod_depth: 0.25,
                        modulation: ModNode::Lfo {
                            wave: Waveform::Sine,
                            rate: 0.49, // 0.5 Hz — was 0.2 (0.05 Hz, 20 s/cycle)
                        },
                        input: Box::new(Supersaw {
                            octave: 0,
                            detune: 0.4,
                            mix: 0.6,
                        }),
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
                    time: 0.72, // 250 ms — was 0.3 (8 ms), a metallic comb
                    feedback: 0.45,
                    mix: 0.35,
                    input: Box::new(Chorus {
                        rate: 0.3,
                        depth: 0.55,
                        mix: 0.4,
                        input: Box::new(Supersaw {
                            octave: 0,
                            detune: 0.55,
                            mix: 0.5,
                        }),
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
                    size: 0.75,
                    damp: 0.55,
                    mix: 0.45,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfLp,
                        cutoff: 0.42,
                        resonance: 0.25,
                        mod_depth: 0.25,
                        modulation: ModNode::Lfo {
                            wave: Waveform::Sine,
                            rate: 0.45, // 0.37 Hz
                        },
                        input: Box::new(Mix {
                            balance: 0.4,
                            a: Box::new(vco(Waveform::Sine, -1, 0.5)),
                            b: Box::new(Noise {
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
                    size: 0.65,
                    damp: 0.4,
                    mix: 0.35,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfBp,
                        cutoff: 0.5,
                        resonance: 0.45,
                        mod_depth: 0.5,
                        modulation: ModNode::Lfo {
                            wave: Waveform::Triangle,
                            rate: 0.4, // 0.25 Hz — slow, but it does arrive
                        },
                        input: Box::new(Supersaw {
                            octave: 0,
                            detune: 0.6,
                            mix: 0.55,
                        }),
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
                    kind: FilterKind::SvfLp,
                    cutoff: 0.45,
                    resonance: 0.5,
                    mod_depth: 0.5,
                    modulation: ModNode::Lfo {
                        wave: Waveform::Sine,
                        rate: 0.44, // 0.34 Hz — was 0.15 (0.033 Hz, 30 s/cycle)
                    },
                    input: Box::new(Noise {
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
                    // Was 0.45 — 31 ms, which is a flanger. 0.79 is ~420 ms,
                    // which is the sound the name has always promised.
                    time: 0.79,
                    feedback: 0.75,
                    mix: 0.5,
                    input: Box::new(Filter {
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
                    size: 0.9,
                    damp: 0.6,
                    mix: 0.55,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfBp,
                        cutoff: 0.55,
                        resonance: 0.65,
                        mod_depth: 0.55,
                        modulation: ModNode::Lfo {
                            wave: Waveform::Sine,
                            rate: 0.42, // 0.29 Hz
                        },
                        input: Box::new(Noise {
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
                    rate: 0.45,
                    depth: 0.6,
                    mix: 0.5,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfLp,
                        cutoff: 0.42,
                        resonance: 0.4,
                        mod_depth: 0.4,
                        modulation: ModNode::Rand { rate: 0.58 }, // ~1.0 Hz
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
                    size: 0.8,
                    damp: 0.45,
                    mix: 0.4,
                    input: Box::new(Delay {
                        time: 0.82, // ~500 ms
                        feedback: 0.62,
                        mix: 0.45,
                        input: Box::new(Filter {
                            kind: FilterKind::SvfLp,
                            cutoff: 0.45,
                            resonance: 0.3,
                            mod_depth: 0.22,
                            modulation: ModNode::Lfo {
                                wave: Waveform::Triangle,
                                rate: 0.42, // 0.29 Hz — 0.38 was 0.21, under the floor
                            },
                            input: Box::new(vco(Waveform::Sine, -1, 0.5)),
                        }),
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
                    kind: FilterKind::SvfHp,
                    cutoff: 0.72,
                    resonance: 0.55,
                    mod_depth: 0.3,
                    modulation: ModNode::Env {
                        attack: 0.0,
                        decay: 0.2,
                    },
                    input: Box::new(Noise {
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
                    kind: FilterKind::Ladder,
                    cutoff: 0.5,
                    resonance: 0.3,
                    mod_depth: 0.55,
                    modulation: ModNode::Env {
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
                    time: 0.54, // 60 ms — tight enough to read as a bounce
                    feedback: 0.68,
                    mix: 0.55,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfBp,
                        cutoff: 0.7,
                        resonance: 0.65,
                        mod_depth: 0.25,
                        modulation: ModNode::Env {
                            attack: 0.0,
                            decay: 0.15,
                        },
                        input: Box::new(vco(Waveform::Square, 1, 0.5)),
                    }),
                },
            },
        },
        // ---------------------------------------------------------------
        // WEIRD
        // ---------------------------------------------------------------
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
                    threshold: 0.3,
                    mod_depth: 0.6,
                    modulation: ModNode::Lfo {
                        wave: Waveform::Square,
                        rate: 0.6, // 1.2 Hz — audibly switching
                    },
                    input: Box::new(Mix {
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
                    kind: FilterKind::SvfBp,
                    cutoff: 0.45,
                    resonance: 0.82,
                    mod_depth: 0.7,
                    modulation: ModNode::Rand { rate: 0.8 }, // ~6 Hz
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
                    rate: 0.35, // 0.39 Hz — 0.15 was 0.18, slower than any LFO here
                    depth: 0.7,
                    mix: 0.6,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfHp,
                        cutoff: 0.8,
                        resonance: 0.45,
                        mod_depth: 0.65,
                        modulation: ModNode::Env {
                            attack: 0.6,
                            decay: 0.65,
                        },
                        input: Box::new(Mix {
                            balance: 0.55,
                            a: Box::new(vco(Waveform::Saw, -1, 0.5)),
                            b: Box::new(vco(Waveform::Square, 1, 0.5)),
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
            let mut note = |m: &ModNode| match m {
                ModNode::Lfo { rate, .. } => out.push((name, "lfo", *rate)),
                ModNode::Rand { rate } => out.push((name, "s&h", *rate)),
                ModNode::Env { .. } | ModNode::None => {}
            };
            match n {
                AudioNode::Filter {
                    modulation, input, ..
                }
                | AudioNode::Fold {
                    modulation, input, ..
                } => {
                    note(modulation);
                    walk(input, name, out);
                }
                AudioNode::Chorus { rate, input, .. } => {
                    out.push((name, "chorus", *rate));
                    walk(input, name, out);
                }
                AudioNode::Delay { input, .. } | AudioNode::Reverb { input, .. } => {
                    walk(input, name, out)
                }
                AudioNode::Mix { a, b, .. } => {
                    walk(a, name, out);
                    walk(b, name, out);
                }
                AudioNode::Vco { .. } | AudioNode::Supersaw { .. } | AudioNode::Noise { .. } => {}
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
            };
        }

        fn walk(&mut self, n: &AudioNode) {
            match n {
                AudioNode::Vco { wave, octave, .. } => {
                    self.nodes.insert("vco");
                    self.waves.insert(format!("{wave:?}"));
                    self.octaves.insert(*octave);
                }
                AudioNode::Supersaw { octave, .. } => {
                    self.nodes.insert("supersaw");
                    self.octaves.insert(*octave);
                }
                AudioNode::Noise { color } => {
                    self.nodes.insert("noise");
                    self.colors.insert(format!("{color:?}"));
                }
                AudioNode::Mix { a, b, .. } => {
                    self.nodes.insert("mix");
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
                AudioNode::Delay { input, .. } => {
                    self.nodes.insert("delay");
                    self.walk(input);
                }
                AudioNode::Chorus { input, .. } => {
                    self.nodes.insert("chorus");
                    self.walk(input);
                }
                AudioNode::Reverb { input, .. } => {
                    self.nodes.insert("reverb");
                    self.walk(input);
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
        assert_eq!(
            mods.len(),
            4,
            "not every modulation source is used: {mods:?}"
        );
        assert_eq!(nodes.len(), 9, "not every audio node is used: {nodes:?}");
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
                } => AudioNode::Filter {
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
                    input,
                } => AudioNode::Delay {
                    time: *time,
                    feedback: *feedback,
                    mix: *mix,
                    input: Box::new(set_fold(input, t)),
                },
                AudioNode::Chorus {
                    rate,
                    depth,
                    mix,
                    input,
                } => AudioNode::Chorus {
                    rate: *rate,
                    depth: *depth,
                    mix: *mix,
                    input: Box::new(set_fold(input, t)),
                },
                AudioNode::Reverb {
                    size,
                    damp,
                    mix,
                    input,
                } => AudioNode::Reverb {
                    size: *size,
                    damp: *damp,
                    mix: *mix,
                    input: Box::new(set_fold(input, t)),
                },
                AudioNode::Mix { balance, a, b } => AudioNode::Mix {
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
                | AudioNode::Reverb { input, .. } => has_fold(input),
                AudioNode::Mix { a, b, .. } => has_fold(a) || has_fold(b),
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
