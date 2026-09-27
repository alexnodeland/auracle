//! Offline, deterministic score renderer: film music played by the app's own
//! live instrument.
//!
//! ```bash
//! cargo run --release -p auracle-wasm --example score -- <score.json> <out_dir> [--jobs N] [--only full,intro]
//! cargo run --release -p auracle-wasm --example score -- --list-presets
//! cargo run --release -p auracle-wasm --example score -- --list-params "Glass Pad"
//! ```
//!
//! # Same code path as the app
//!
//! Every track is a [`LivePoly`], the struct the AudioWorklet runs, built the
//! way `apps/web/live-audio.js` builds it: `new LivePoly(treeJson, sampleRate,
//! voices)`, then `set_makeup(makeup)`. The makeup is the one the scores were
//! mixed under: the preset featurized on the default audition phrase and
//! `10^(clamp(gain_db, ±12)/20)`, which is what the engine handed the worklet
//! until the app's makeup became the unclamped loudness makeup
//! (`auracle-wasm/src/level.rs`). It is pinned here so a playback change in the
//! app cannot re-balance a finished mix.
//! Notes go in through `note_on`/`note_off`, knob moves through `set_param`
//! (the PERFORM view's live path: smoothed, no recompile), tempo-synced step
//! sequencers through `set_sync` and `set_transport_beats` (what the MIDI clock
//! does), and audio comes out of `process_ptr` in 128-frame quanta. Quanta
//! are split at event times, so notes land sample-accurately rather than on
//! the next quantum boundary. The per-voice ADSR/VCA/limiter tail and the 0.98
//! master brickwall are the app's code; the app's leveler, which holds a held
//! note down to a loudness ceiling, is switched off (`set_leveler(false)`),
//! because here the faders are the level policy.
//!
//! What the renderer adds is a mixing desk *after* each instrument: a fader
//! (gain in dB, optionally automated), an equal-power pan, and one master gain
//! for the whole score. It adds no processing of its own that could colour the
//! sound: no EQ, compressor or limiter. The master gain is a scalar, so a
//! section and the full arrangement it came from sit at the same level.
//!
//! # Determinism
//!
//! quiver's noise sources draw from a thread-local RNG seeded from the system
//! clock by default. Each (track, render window) job reseeds it from the
//! score's `seed` and the track's name before building its instrument, and
//! renders on one thread from start to finish. Jobs therefore produce
//! identical samples no matter how many threads run them or in what order.
//!
//! # Score format (JSON)
//!
//! ```text
//! {
//!   "title": "Signal", "tempo": 100, "sample_rate": 48000, "beats_per_bar": 4,
//!   "seed": 1,
//!   "render": {"full": true, "sections": true, "lead_in_bars": 2, "tail_s": 8,
//!              "silence_dbfs": -80},
//!   "master": {"gain_db": null, "peak_dbfs": -1.0},   // null = fit the peak
//!   "sections": [{"name": "intro", "bars": 4}, {"name": "loop_a", "bars": 16, "loop": true}],
//!   "tracks": [{
//!     "name": "pad", "preset": "Glass Pad", "gain_db": -6, "pan": 0.0,
//!     "voices": 8,          // polyphony (the app uses 4)
//!     "transpose": 0,       // semitones from written (sounding) pitch to key
//!     "trim_db": 0,         // extra makeup, before the instrument's limiter
//!     "sync": false,        // tempo-sync `steps` modulators to the score
//!     "tie": false,         // merge back-to-back notes of one pitch
//!     "params": {"node/0#cut": 0.6},               // static knob settings
//!     "notes": {"intro": [[bar, beat, dur_beats, "D4", vel], ...]},
//!     "patterns": [{"type": "chords"|"arp"|"pulse"|"phrase", ...}],
//!     "automation": [{"param": "node#cut", "points": [["build", 5, 1, 0.3], ...]}],
//!     "fader": [["intro", 1, 1, -40], ["intro", 3, 1, 0]],   // dB, added to gain_db
//!     "pitch_drop": {"semis": 24, "tau_ms": 35, "pre_ms": 15}
//!   }]
//! }
//! ```
//!
//! Bars and beats are 1-based within their section: `[2, 3.5, ...]` is the
//! "and" of beat 3 in the section's second bar. Pitches are MIDI numbers or
//! names (`"Bb1"`, `"F#5"`, C4 = 60, which is the engine's 0 V). Knob values
//! are normalized, as the PERFORM view sends them. Automation interpolates
//! linearly between points and holds its end values outside them.
//!
//! Patterns (every one takes `section` and optional `bars: [from, to]`):
//!
//! - `chords`: `chords` (list of pitch lists, cycled), one every `every`
//!   beats (default one bar), each note lasting `dur` (default `every`), with
//!   optional `strum` (beats between notes) and `offset`.
//! - `arp`: `chords` are ascending note ladders, one per `per` beats; a note
//!   every `step` beats walks the ladder by `order` (`up`, `down`, `updown`,
//!   which repeats the ends so a 2n-step cycle fills the bar, `updown_open`,
//!   or a list of ladder indices). Each note lasts `gate × step` and gets
//!   `vel`, plus `accent` on beats and `off_accent` on 8th off-beats.
//!   `vel_ramp: [from, to]` scales velocity across the pattern.
//! - `pulse`: `roots` (one per bar, cycled), hit every `step` beats from
//!   `offset`, or at explicit `hits` (1-based beats), each `gate × gap` long.
//!   `accent` lands on beat 1. `last_octave_up` jumps the last hit an octave.
//! - `phrase`: `notes` relative to `start_bar`, repeated `repeat` times
//!   every `every_bars`, with `transpose` and `vel_scale`.
//!
//! # Output
//!
//! Per score, under `<out_dir>/<slug>/`: `full.wav` and `<section>.wav` for
//! each section (the names `www/video/tools/mix.py` looks for), all stereo
//! 48 kHz 24-bit, plus `stems/<window>/<track>.wav` (a track that is silent in
//! a window gets no stem). Stems are post-fader and post-master, so they sum
//! to their mix.
//!
//! - A section starts on its own downbeat. It is rendered from `lead_in_bars`
//!   earlier (the arrangement that precedes it, so reverbs and releases are
//!   already warm) and runs past its last bar for its tail, trimmed at
//!   `silence_dbfs` and faded over its last 20 ms (over 0.4 s if it is still
//!   sounding when `tail_s` runs out).
//!   Its head therefore already holds the tail of the bars before it: laying
//!   two sections end to end, cut the first at its `music_frames` (see the
//!   manifest) or the junction carries that tail twice.
//! - A `loop` section is rendered cold, played through its tail, and the
//!   tail is added back onto its start. The file is exactly the loop's
//!   length, and the release tails wrap into the downbeat.
//!
//! `manifest.json` records the timing and levels of every file.

use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use auracle_features::{featurize, PhraseSpec};
use auracle_grammar::{compile, preset_bank, PatchTree};
use auracle_wasm::LivePoly;
use serde::Deserialize;
use serde_json::json;

/// The AudioWorklet render quantum.
const QUANTUM: usize = 128;
/// Silent quanta run before every render, so static knob settings (which ramp
/// through the live smoother like any knob move) have settled before time 0.
const PREROLL_QUANTA: usize = 96;
/// Fade applied where a section's tail is cut.
const END_FADE_S: f64 = 0.02;
/// Fade over the end of a tail that is still sounding when `tail_s` runs out.
const CAP_FADE_S: f64 = 0.4;
/// Kept after the last sample above the silence threshold.
const TAIL_MARGIN_S: f64 = 0.1;
/// A pre-fader track peak at or above this means the instrument's own 0.98
/// master brickwall acted.
const LIMITER_FLAG: f32 = 0.975;

// ---------------------------------------------------------------- score ---

#[derive(Deserialize)]
struct Score {
    title: String,
    tempo: f64,
    #[serde(default = "d_sr")]
    sample_rate: u32,
    #[serde(default = "d_bpb")]
    beats_per_bar: f64,
    #[serde(default)]
    seed: u64,
    #[serde(default)]
    render: RenderDef,
    #[serde(default)]
    master: MasterDef,
    sections: Vec<SectionDef>,
    tracks: Vec<TrackDef>,
}

fn d_sr() -> u32 {
    48_000
}
fn d_bpb() -> f64 {
    4.0
}
fn d_true() -> bool {
    true
}
fn d_vel() -> f64 {
    0.7
}
fn d_one() -> f64 {
    1.0
}
fn d_one_u() -> u32 {
    1
}

#[derive(Deserialize)]
struct RenderDef {
    #[serde(default = "d_true")]
    full: bool,
    #[serde(default = "d_true")]
    sections: bool,
    #[serde(default = "d_lead_in")]
    lead_in_bars: f64,
    #[serde(default = "d_tail")]
    tail_s: f64,
    #[serde(default = "d_silence")]
    silence_dbfs: f64,
}

fn d_lead_in() -> f64 {
    2.0
}
fn d_tail() -> f64 {
    8.0
}
fn d_silence() -> f64 {
    -80.0
}

impl Default for RenderDef {
    fn default() -> Self {
        Self {
            full: true,
            sections: true,
            lead_in_bars: d_lead_in(),
            tail_s: d_tail(),
            silence_dbfs: d_silence(),
        }
    }
}

#[derive(Deserialize)]
struct MasterDef {
    /// Fixed master gain; `None` fits the loudest true peak of every file to
    /// `peak_dbfs`.
    #[serde(default)]
    gain_db: Option<f64>,
    #[serde(default = "d_peak")]
    peak_dbfs: f64,
}

fn d_peak() -> f64 {
    -1.0
}

impl Default for MasterDef {
    fn default() -> Self {
        Self {
            gain_db: None,
            peak_dbfs: d_peak(),
        }
    }
}

#[derive(Deserialize)]
struct SectionDef {
    name: String,
    bars: f64,
    #[serde(default, rename = "loop")]
    looped: bool,
    #[serde(default)]
    tail_s: Option<f64>,
    #[serde(default)]
    lead_in_bars: Option<f64>,
}

#[derive(Deserialize, Clone)]
#[serde(untagged)]
enum Pitch {
    Midi(i64),
    Name(String),
}

/// `[bar, beat, dur_beats, pitch, velocity]`.
#[derive(Deserialize, Clone)]
struct NoteDef(f64, f64, f64, Pitch, f64);

/// `[section, bar, beat, value]`.
#[derive(Deserialize, Clone)]
struct PointDef(String, f64, f64, f64);

#[derive(Deserialize)]
struct AutoDef {
    param: String,
    points: Vec<PointDef>,
}

#[derive(Deserialize, Clone, Copy)]
struct PitchDrop {
    semis: f64,
    tau_ms: f64,
    #[serde(default = "d_pre")]
    pre_ms: f64,
}

fn d_pre() -> f64 {
    15.0
}

#[derive(Deserialize)]
#[serde(untagged)]
enum OrderDef {
    Named(String),
    Indices(Vec<usize>),
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Pattern {
    Chords {
        section: String,
        #[serde(default)]
        bars: Option<(u32, u32)>,
        chords: Vec<Vec<Pitch>>,
        #[serde(default)]
        every: Option<f64>,
        #[serde(default)]
        dur: Option<f64>,
        #[serde(default = "d_vel")]
        vel: f64,
        #[serde(default)]
        offset: f64,
        #[serde(default)]
        strum: f64,
    },
    Arp {
        section: String,
        #[serde(default)]
        bars: Option<(u32, u32)>,
        chords: Vec<Vec<Pitch>>,
        #[serde(default)]
        per: Option<f64>,
        #[serde(default = "d_step16")]
        step: f64,
        order: OrderDef,
        #[serde(default = "d_gate")]
        gate: f64,
        #[serde(default = "d_vel")]
        vel: f64,
        #[serde(default)]
        accent: f64,
        #[serde(default)]
        off_accent: f64,
        #[serde(default)]
        vel_ramp: Option<(f64, f64)>,
    },
    Pulse {
        section: String,
        #[serde(default)]
        bars: Option<(u32, u32)>,
        roots: Vec<Pitch>,
        #[serde(default = "d_step8")]
        step: f64,
        #[serde(default)]
        offset: f64,
        #[serde(default)]
        hits: Option<Vec<f64>>,
        #[serde(default = "d_pulse_gate")]
        gate: f64,
        #[serde(default = "d_vel")]
        vel: f64,
        #[serde(default)]
        accent: f64,
        #[serde(default)]
        last_octave_up: bool,
    },
    Phrase {
        section: String,
        #[serde(default = "d_one_u")]
        start_bar: u32,
        #[serde(default = "d_one_u")]
        repeat: u32,
        #[serde(default = "d_four")]
        every_bars: f64,
        notes: Vec<NoteDef>,
        #[serde(default)]
        transpose: i32,
        #[serde(default = "d_one")]
        vel_scale: f64,
    },
}

fn d_step16() -> f64 {
    0.25
}
fn d_step8() -> f64 {
    0.5
}
fn d_gate() -> f64 {
    0.5
}
fn d_pulse_gate() -> f64 {
    0.75
}
fn d_four() -> f64 {
    4.0
}
fn d_voices() -> usize {
    4
}

#[derive(Deserialize)]
struct TrackDef {
    name: String,
    preset: String,
    #[serde(default)]
    gain_db: f64,
    #[serde(default)]
    pan: f64,
    #[serde(default = "d_voices")]
    voices: usize,
    #[serde(default)]
    transpose: i32,
    #[serde(default)]
    trim_db: f64,
    #[serde(default)]
    sync: bool,
    #[serde(default)]
    tie: bool,
    #[serde(default)]
    mute: bool,
    #[serde(default)]
    params: BTreeMap<String, f64>,
    #[serde(default)]
    notes: BTreeMap<String, Vec<NoteDef>>,
    #[serde(default)]
    patterns: Vec<Pattern>,
    #[serde(default)]
    automation: Vec<AutoDef>,
    #[serde(default)]
    fader: Vec<PointDef>,
    #[serde(default)]
    pitch_drop: Option<PitchDrop>,
}

// ----------------------------------------------------------------- plan ---

/// One note in absolute beats from the top of the arrangement. `key` is the
/// MIDI note the instrument is played with (written pitch + transpose).
#[derive(Clone, Copy, Debug)]
struct Note {
    start: f64,
    end: f64,
    key: i32,
    vel: f64,
}

struct Lane {
    addr: String,
    /// (absolute beat, value), sorted.
    points: Vec<(f64, f64)>,
}

fn interp(points: &[(f64, f64)], beat: f64) -> f64 {
    match points {
        [] => 0.0,
        [(_, v)] => *v,
        _ => {
            if beat <= points[0].0 {
                return points[0].1;
            }
            for w in points.windows(2) {
                let ((b0, v0), (b1, v1)) = (w[0], w[1]);
                if beat <= b1 {
                    if b1 - b0 <= 1e-12 {
                        return v1;
                    }
                    return v0 + (v1 - v0) * (beat - b0) / (b1 - b0);
                }
            }
            points[points.len() - 1].1
        }
    }
}

struct Timeline {
    bpb: f64,
    /// name -> (start beat, length in beats)
    sections: HashMap<String, (f64, f64)>,
}

impl Timeline {
    fn section(&self, name: &str) -> Result<(f64, f64), String> {
        self.sections
            .get(name)
            .copied()
            .ok_or_else(|| format!("unknown section `{name}`"))
    }

    /// Absolute beat of a 1-based (bar, beat) inside `section`.
    fn at(&self, section: &str, bar: f64, beat: f64) -> Result<f64, String> {
        let (start, _) = self.section(section)?;
        Ok(start + (bar - 1.0) * self.bpb + (beat - 1.0))
    }
}

struct TrackPlan {
    name: String,
    preset: String,
    tree_json: String,
    makeup: f64,
    gain_db_app: f64,
    trim_db: f64,
    voices: usize,
    sync: bool,
    params: Vec<(String, f64)>,
    notes: Vec<Note>,
    lanes: Vec<Lane>,
    fader: Vec<(f64, f64)>,
    gain_db: f64,
    pan: f64,
    pitch_drop: Option<PitchDrop>,
    seed: u64,
}

fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

fn parse_pitch(p: &Pitch) -> Result<i32, String> {
    match p {
        Pitch::Midi(m) => Ok(*m as i32),
        Pitch::Name(s) => {
            let s = s.trim();
            let mut chars = s.chars().peekable();
            let letter = chars.next().ok_or("empty pitch")?;
            let mut pc: i32 = match letter.to_ascii_uppercase() {
                'C' => 0,
                'D' => 2,
                'E' => 4,
                'F' => 5,
                'G' => 7,
                'A' => 9,
                'B' => 11,
                _ => return Err(format!("bad pitch `{s}`")),
            };
            while let Some(&c) = chars.peek() {
                match c {
                    '#' | '♯' => pc += 1,
                    'b' | '♭' => pc -= 1,
                    _ => break,
                }
                chars.next();
            }
            let oct: String = chars.collect();
            let oct: i32 = oct.parse().map_err(|_| format!("bad octave in `{s}`"))?;
            Ok((oct + 1) * 12 + pc)
        }
    }
}

fn clamp_vel(v: f64) -> f64 {
    v.clamp(0.05, 1.0)
}

/// Expand one track's notes and patterns to absolute-beat notes.
fn expand_notes(t: &TrackDef, tl: &Timeline) -> Result<Vec<Note>, String> {
    let mut out: Vec<Note> = Vec::new();
    let mut push = |start: f64, dur: f64, pitch: i32, vel: f64| {
        out.push(Note {
            start,
            end: start + dur.max(1e-3),
            key: pitch + t.transpose,
            vel: clamp_vel(vel),
        });
    };
    for (section, notes) in &t.notes {
        for n in notes {
            let start = tl.at(section, n.0, n.1)?;
            push(start, n.2, parse_pitch(&n.3)?, n.4);
        }
    }
    let bar_range = |section: &str, bars: &Option<(u32, u32)>| -> Result<(f64, f64), String> {
        let (s0, len) = tl.section(section)?;
        let nbars = (len / tl.bpb).round() as u32;
        let (b0, b1) = bars.unwrap_or((1, nbars));
        if b0 < 1 || b1 < b0 || b1 > nbars {
            return Err(format!("bars {b0}..{b1} outside section `{section}`"));
        }
        Ok((s0 + (b0 - 1) as f64 * tl.bpb, s0 + b1 as f64 * tl.bpb))
    };
    for p in &t.patterns {
        match p {
            Pattern::Chords {
                section,
                bars,
                chords,
                every,
                dur,
                vel,
                offset,
                strum,
            } => {
                let (a, b) = bar_range(section, bars)?;
                let every = every.unwrap_or(tl.bpb);
                let dur = dur.unwrap_or(every);
                let mut j = 0usize;
                let mut at = a + offset;
                while at < b - 1e-9 {
                    let chord = &chords[j % chords.len()];
                    for (i, p) in chord.iter().enumerate() {
                        let s = at + *strum * i as f64;
                        push(
                            s,
                            (dur - *strum * i as f64).max(0.05),
                            parse_pitch(p)?,
                            *vel,
                        );
                    }
                    j += 1;
                    at += every;
                }
            }
            Pattern::Arp {
                section,
                bars,
                chords,
                per,
                step,
                order,
                gate,
                vel,
                accent,
                off_accent,
                vel_ramp,
            } => {
                let (a, b) = bar_range(section, bars)?;
                let per = per.unwrap_or(tl.bpb);
                let ladders: Vec<Vec<i32>> = chords
                    .iter()
                    .map(|c| c.iter().map(parse_pitch).collect::<Result<Vec<_>, _>>())
                    .collect::<Result<_, _>>()?;
                let total = ((b - a) / step).round() as usize;
                for k in 0..total {
                    let rel = k as f64 * step;
                    let at = a + rel;
                    let ci = (rel / per + 1e-9).floor() as usize % ladders.len();
                    let ladder = &ladders[ci];
                    let n = ladder.len();
                    let kk = ((rel % per) / step + 1e-9).floor() as usize;
                    let idx = match order {
                        OrderDef::Named(s) => match s.as_str() {
                            "up" => kk % n,
                            "down" => n - 1 - kk % n,
                            "updown" => {
                                let i = kk % (2 * n);
                                if i < n {
                                    i
                                } else {
                                    2 * n - 1 - i
                                }
                            }
                            "updown_open" => {
                                if n < 2 {
                                    0
                                } else {
                                    let i = kk % (2 * n - 2);
                                    if i < n {
                                        i
                                    } else {
                                        2 * n - 2 - i
                                    }
                                }
                            }
                            other => return Err(format!("unknown arp order `{other}`")),
                        },
                        OrderDef::Indices(ix) => ix[kk % ix.len()] % n,
                    };
                    let in_beat = (at - (at + 1e-9).floor()).abs();
                    let mut v = *vel;
                    if in_beat < 1e-6 {
                        v += accent;
                    } else if (in_beat - 0.5).abs() < 1e-6 {
                        v += off_accent;
                    }
                    if let Some((v0, v1)) = vel_ramp {
                        let f = if total > 1 {
                            k as f64 / (total - 1) as f64
                        } else {
                            0.0
                        };
                        v *= v0 + (v1 - v0) * f;
                    }
                    push(at, gate * step, ladder[idx], v);
                }
            }
            Pattern::Pulse {
                section,
                bars,
                roots,
                step,
                offset,
                hits,
                gate,
                vel,
                accent,
                last_octave_up,
            } => {
                let (a, b) = bar_range(section, bars)?;
                let nbars = ((b - a) / tl.bpb).round() as usize;
                for bar in 0..nbars {
                    let root = parse_pitch(&roots[bar % roots.len()])?;
                    let bar_start = a + bar as f64 * tl.bpb;
                    let positions: Vec<f64> = match hits {
                        Some(h) => h.iter().map(|x| x - 1.0).collect(),
                        None => {
                            let mut v = Vec::new();
                            let mut x = *offset;
                            while x < tl.bpb - 1e-9 {
                                v.push(x);
                                x += step;
                            }
                            v
                        }
                    };
                    for (i, &x) in positions.iter().enumerate() {
                        let next = positions.get(i + 1).copied().unwrap_or(tl.bpb);
                        let gap = if hits.is_some() { next - x } else { *step };
                        let last = i + 1 == positions.len();
                        let pitch = root + if *last_octave_up && last { 12 } else { 0 };
                        let v = vel + if x.abs() < 1e-9 { *accent } else { 0.0 };
                        push(bar_start + x, gate * gap, pitch, v);
                    }
                }
            }
            Pattern::Phrase {
                section,
                start_bar,
                repeat,
                every_bars,
                notes,
                transpose,
                vel_scale,
            } => {
                for r in 0..*repeat {
                    for n in notes {
                        let bar = (*start_bar as f64) + r as f64 * every_bars + (n.0 - 1.0);
                        let start = tl.at(section, bar, n.1)?;
                        push(start, n.2, parse_pitch(&n.3)? + transpose, n.4 * vel_scale);
                    }
                }
            }
        }
    }
    // Ties: a note that begins exactly where the same pitch ends continues it.
    out.sort_by(|a, b| a.key.cmp(&b.key).then(a.start.total_cmp(&b.start)));
    let mut merged: Vec<Note> = Vec::with_capacity(out.len());
    for n in out {
        if let Some(prev) = merged.last_mut() {
            if prev.key == n.key && t.tie && (n.start - prev.end).abs() < 1e-6 {
                prev.end = prev.end.max(n.end);
                continue;
            }
            // Overlap on one key: the live instrument retriggers the held
            // voice, so the earlier note's release would cut the later one.
            // End the earlier note where the later one starts.
            if prev.key == n.key && n.start < prev.end {
                prev.end = n.start;
            }
        }
        merged.push(n);
    }
    merged.retain(|n| n.end - n.start > 1e-6);
    merged.sort_by(|a, b| a.start.total_cmp(&b.start).then(a.key.cmp(&b.key)));
    for n in &merged {
        if !(0..=127).contains(&n.key) {
            return Err(format!("note key {} out of MIDI range", n.key));
        }
    }
    Ok(merged)
}

// --------------------------------------------------------------- render ---

#[derive(Clone)]
struct Window {
    /// "full" or the section name.
    name: String,
    file_stem: String,
    render_start: f64,
    out_start: f64,
    music_end: f64,
    tail_s: f64,
    looped: bool,
}

struct Clock {
    sr: f64,
    bpm: f64,
}

impl Clock {
    fn sample(&self, beat: f64) -> i64 {
        (beat * 60.0 / self.bpm * self.sr).round() as i64
    }
    fn beat(&self, sample: i64) -> f64 {
        sample as f64 * self.bpm / (60.0 * self.sr)
    }
}

/// Pre-fader render of one track over one window: interleaved stereo from
/// `render_start` to `music_end + tail`.
struct Rendered {
    buf: Vec<f32>,
    peak: f32,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum EvKind {
    Off,
    On,
}

fn render_track(tp: &TrackPlan, win: &Window, clock: &Clock) -> Result<Rendered, String> {
    quiver::rng::seed(tp.seed);
    let sr = clock.sr;
    let mut poly = LivePoly::new(&tp.tree_json, sr, tp.voices)
        .unwrap_or_else(|_| panic!("{}: LivePoly::new failed", tp.name));
    poly.set_makeup(tp.makeup * 10f64.powf(tp.trim_db / 20.0));
    poly.set_leveler(false);
    if tp.sync {
        // The arp stays off; this is how the app hands the instrument a tempo.
        poly.set_arp(false, 0, 2.0, clock.bpm, 0.5, 1, 0.0);
        poly.set_sync(true);
    }
    for (addr, v) in &tp.params {
        if !poly.set_param(addr, *v) {
            return Err(format!("{}: `{addr}` is not a live knob", tp.name));
        }
    }
    let s0 = clock.sample(win.render_start);
    let s_music_end = clock.sample(win.music_end);
    let s_end = s_music_end + (win.tail_s * sr).round() as i64;

    // Notes overlapping the window; onsets before it are moved to its start
    // (they re-attack inside the lead-in), releases are clipped at the end of
    // the music.
    let mut evs: Vec<(i64, EvKind, u8, f64)> = Vec::new();
    let mut onsets: Vec<i64> = Vec::new();
    for n in &tp.notes {
        if n.start >= win.music_end - 1e-9 || n.end <= win.render_start + 1e-9 {
            continue;
        }
        let on = clock.sample(n.start).max(s0);
        let off = clock.sample(n.end).min(s_music_end);
        if off <= on {
            continue;
        }
        evs.push((on, EvKind::On, n.key as u8, n.vel));
        evs.push((off, EvKind::Off, n.key as u8, 0.0));
        onsets.push(on);
    }
    evs.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    onsets.sort_unstable();
    onsets.dedup();

    let mut lane_last: Vec<f64> = vec![f64::NAN; tp.lanes.len()];
    let mut bend_last = 0.0f64;
    let drop = tp.pitch_drop.map(|d| {
        (
            d.semis,
            d.tau_ms * 1e-3 * sr,
            (d.pre_ms * 1e-3 * sr).round() as i64,
        )
    });

    let drive = |poly: &mut LivePoly, pos: i64, lane_last: &mut [f64], bend_last: &mut f64| {
        let beat = clock.beat(pos);
        for (i, lane) in tp.lanes.iter().enumerate() {
            let v = interp(&lane.points, beat);
            if lane_last[i].is_nan() || (lane_last[i] - v).abs() > 1e-7 {
                poly.set_param(&lane.addr, v);
                lane_last[i] = v;
            }
        }
        if tp.sync {
            poly.set_transport_beats(beat.max(0.0));
        }
        if let Some((semis, tau, pre)) = drop {
            // Pre-position the bend just before each hit (the voice is silent
            // there), then let it fall exponentially onto the note.
            let next = onsets.partition_point(|&o| o <= pos);
            let b = if next < onsets.len() && onsets[next] - pos <= pre {
                semis
            } else if next > 0 {
                semis * (-((pos - onsets[next - 1]) as f64) / tau).exp()
            } else {
                0.0
            };
            let b = if b.abs() < 1e-3 { 0.0 } else { b };
            if (b - *bend_last).abs() > 1e-9 {
                poly.set_bend(b);
                *bend_last = b;
            }
        }
    };

    // Pre-roll: settle the static knobs (and the automation's first value).
    for _ in 0..PREROLL_QUANTA {
        drive(&mut poly, s0, &mut lane_last, &mut bend_last);
        poly.process_ptr(QUANTUM);
    }

    let len = (s_end - s0) as usize;
    let mut buf = vec![0.0f32; len * 2];
    let mut peak = 0.0f32;
    let mut ei = 0usize;
    let mut pos = s0;
    while pos < s_end {
        while ei < evs.len() && evs[ei].0 <= pos {
            let (_, kind, key, vel) = evs[ei];
            match kind {
                EvKind::On => poly.note_on(key, vel),
                EvKind::Off => poly.note_off(key),
            }
            ei += 1;
        }
        drive(&mut poly, pos, &mut lane_last, &mut bend_last);
        let mut chunk_end = (pos + QUANTUM as i64).min(s_end);
        if ei < evs.len() && evs[ei].0 < chunk_end {
            chunk_end = evs[ei].0;
        }
        let n = (chunk_end - pos) as usize;
        let ptr = poly.process_ptr(n);
        // SAFETY: `process_ptr` returns LivePoly's own interleaved buffer of
        // `n * 2` floats, valid until the next call on `poly`.
        let out = unsafe { std::slice::from_raw_parts(ptr, n * 2) };
        let at = ((pos - s0) as usize) * 2;
        for (i, &x) in out.iter().enumerate() {
            if !x.is_finite() {
                return Err(format!("{}: non-finite sample at {}", tp.name, pos));
            }
            peak = peak.max(x.abs());
            buf[at + i] = x;
        }
        pos = chunk_end;
    }
    Ok(Rendered { buf, peak })
}

// ------------------------------------------------------------ analysis ---

fn db(x: f64) -> f64 {
    if x > 0.0 {
        20.0 * x.log10()
    } else {
        f64::NEG_INFINITY
    }
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-12 {
        1.0
    } else {
        let px = std::f64::consts::PI * x;
        px.sin() / px
    }
}

/// 4× oversampled peak (windowed-sinc interpolation), evaluated wherever the
/// signal comes within 4 dB of its sample peak.
fn true_peak(ch: &[f64]) -> f64 {
    const OS: usize = 4;
    const W: i64 = 16;
    let sp = ch.iter().fold(0.0f64, |m, x| m.max(x.abs()));
    if sp == 0.0 {
        return 0.0;
    }
    let phases: Vec<Vec<f64>> = (1..OS)
        .map(|p| {
            let frac = p as f64 / OS as f64;
            (-W + 1..=W)
                .map(|k| {
                    let t = frac - k as f64;
                    let w = 0.5 + 0.5 * (std::f64::consts::PI * t / W as f64).cos();
                    sinc(t) * w
                })
                .collect()
        })
        .collect();
    let gate = sp * 0.63;
    let mut peak = sp;
    let n = ch.len() as i64;
    for i in 0..n {
        let a = ch[i as usize].abs();
        let b = if i + 1 < n {
            ch[(i + 1) as usize].abs()
        } else {
            0.0
        };
        if a.max(b) < gate {
            continue;
        }
        for ph in &phases {
            let mut acc = 0.0;
            for (j, k) in (-W + 1..=W).enumerate() {
                let idx = i + k;
                if idx >= 0 && idx < n {
                    acc += ch[idx as usize] * ph[j];
                }
            }
            peak = peak.max(acc.abs());
        }
    }
    peak
}

// ----------------------------------------------------------------- wav ---

fn write_wav24(path: &Path, sr: u32, l: &[f64], r: &[f64]) -> Result<(), String> {
    let n = l.len();
    let data_len = (n * 6) as u32;
    let mut b = Vec::with_capacity(44 + n * 6);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data_len).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&sr.to_le_bytes());
    b.extend_from_slice(&(sr * 6).to_le_bytes());
    b.extend_from_slice(&6u16.to_le_bytes());
    b.extend_from_slice(&24u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..n {
        for x in [l[i], r[i]] {
            let v = (x * 8_388_607.0).round().clamp(-8_388_608.0, 8_388_607.0) as i32;
            b.extend_from_slice(&v.to_le_bytes()[..3]);
        }
    }
    std::fs::write(path, b).map_err(|e| format!("{}: {e}", path.display()))
}

// ---------------------------------------------------------------- main ---

fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }
    out.trim_matches('_').to_string()
}

/// The makeup the scores were mixed under (see the module docs): the `gain_db`
/// the featurizer measured on the default audition phrase, clamped to ±12 dB.
fn app_makeup(tree: &PatchTree) -> Result<(f64, f64), String> {
    let v = featurize(tree, &PhraseSpec::default()).map_err(|e| e.to_string())?;
    let g = v.features.gain_db;
    Ok((g, 10f64.powf(g.clamp(-12.0, 12.0) / 20.0)))
}

fn find_preset(name: &str) -> Result<PatchTree, String> {
    preset_bank()
        .into_iter()
        .find(|p| p.name == name)
        .map(|p| p.tree)
        .ok_or_else(|| format!("no preset named `{name}` (see --list-presets)"))
}

fn list_params(name: &str) -> Result<(), String> {
    let tree = find_preset(name)?;
    let v = compile(&tree, 48_000.0).map_err(|e| e.to_string())?;
    let mut keys: Vec<(&String, f64)> = v.params.iter().map(|(k, h)| (k, h.value.get())).collect();
    keys.sort_by(|a, b| a.0.cmp(b.0));
    println!("live knobs of `{name}` (address, wire value at the preset's setting):");
    for (k, val) in keys {
        println!("  {k:<28} {val:.4}");
    }
    println!("\ntree:\n{}", serde_json::to_string_pretty(&tree).unwrap());
    Ok(())
}

struct Args {
    score: PathBuf,
    out: PathBuf,
    jobs: usize,
    only: Option<Vec<String>>,
}

fn parse_args() -> Result<Option<Args>, String> {
    let mut it = std::env::args().skip(1);
    let mut pos: Vec<String> = Vec::new();
    let mut jobs = 2usize;
    let mut only = None;
    while let Some(a) = it.next() {
        match a.as_str() {
            "--list-presets" => {
                for p in preset_bank() {
                    println!("{:<18} {:<8} {}", p.name, p.category, p.blurb);
                }
                return Ok(None);
            }
            "--list-params" => {
                let name = it.next().ok_or("--list-params needs a preset name")?;
                list_params(&name)?;
                return Ok(None);
            }
            "--jobs" => {
                jobs = it
                    .next()
                    .and_then(|s| s.parse().ok())
                    .ok_or("--jobs needs a number")?;
            }
            "--only" => {
                only = Some(
                    it.next()
                        .ok_or("--only needs a list")?
                        .split(',')
                        .map(|s| s.to_string())
                        .collect(),
                );
            }
            _ => pos.push(a),
        }
    }
    if pos.len() != 2 {
        return Err("usage: score <score.json> <out_dir> [--jobs N] [--only full,section]".into());
    }
    Ok(Some(Args {
        score: PathBuf::from(&pos[0]),
        out: PathBuf::from(&pos[1]),
        jobs: jobs.max(1),
        only,
    }))
}

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let Some(args) = parse_args()? else {
        return Ok(());
    };
    let text = std::fs::read_to_string(&args.score)
        .map_err(|e| format!("{}: {e}", args.score.display()))?;
    let score: Score = serde_json::from_str(&text).map_err(|e| format!("score: {e}"))?;
    let sr = score.sample_rate as f64;
    let clock = Clock {
        sr,
        bpm: score.tempo,
    };
    let bpb = score.beats_per_bar;

    // Timeline.
    let mut sections = HashMap::new();
    let mut order: Vec<(String, f64, f64)> = Vec::new();
    let mut at = 0.0;
    for s in &score.sections {
        let len = s.bars * bpb;
        if sections.insert(s.name.clone(), (at, len)).is_some() {
            return Err(format!("duplicate section `{}`", s.name));
        }
        order.push((s.name.clone(), at, len));
        at += len;
    }
    let song_end = at;
    let tl = Timeline { bpb, sections };

    // Tracks.
    let mut makeups: HashMap<String, (String, f64, f64)> = HashMap::new();
    let mut plans: Vec<TrackPlan> = Vec::new();
    for t in score.tracks.iter().filter(|t| !t.mute) {
        let tree = find_preset(&t.preset)?;
        compile(&tree, sr).map_err(|e| format!("{}: {e}", t.preset))?;
        if !makeups.contains_key(&t.preset) {
            let (g, m) = app_makeup(&tree)?;
            let json = serde_json::to_string(&tree).map_err(|e| e.to_string())?;
            makeups.insert(t.preset.clone(), (json, g, m));
        }
        let (tree_json, gdb, makeup) = makeups[&t.preset].clone();
        let notes = expand_notes(t, &tl).map_err(|e| format!("track `{}`: {e}", t.name))?;
        let mut lanes = Vec::new();
        for a in &t.automation {
            let mut pts = Vec::new();
            for p in &a.points {
                pts.push((tl.at(&p.0, p.1, p.2)?, p.3));
            }
            pts.sort_by(|x, y| x.0.total_cmp(&y.0));
            lanes.push(Lane {
                addr: a.param.clone(),
                points: pts,
            });
        }
        let mut fader = Vec::new();
        for p in &t.fader {
            fader.push((tl.at(&p.0, p.1, p.2)?, p.3));
        }
        fader.sort_by(|x, y| x.0.total_cmp(&y.0));
        plans.push(TrackPlan {
            name: t.name.clone(),
            preset: t.preset.clone(),
            tree_json,
            makeup,
            gain_db_app: gdb,
            trim_db: t.trim_db,
            voices: t.voices.max(1),
            sync: t.sync,
            params: t.params.iter().map(|(k, v)| (k.clone(), *v)).collect(),
            notes,
            lanes,
            fader,
            gain_db: t.gain_db,
            pan: t.pan.clamp(-1.0, 1.0),
            pitch_drop: t.pitch_drop,
            seed: score.seed ^ fnv1a(&t.name),
        });
    }
    // Every automated address must be a live knob: probe once, cheaply.
    for tp in &plans {
        let mut probe = LivePoly::new(&tp.tree_json, sr, 1)
            .unwrap_or_else(|_| panic!("{}: LivePoly::new failed", tp.name));
        for lane in &tp.lanes {
            if !probe.set_param(&lane.addr, interp(&lane.points, 0.0)) {
                return Err(format!("{}: `{}` is not a live knob", tp.name, lane.addr));
            }
        }
    }

    // Windows.
    let title_slug = slug(&score.title);
    let mut windows: Vec<Window> = Vec::new();
    if score.render.full {
        windows.push(Window {
            name: "full".into(),
            file_stem: "full".into(),
            render_start: 0.0,
            out_start: 0.0,
            music_end: song_end,
            tail_s: score.render.tail_s,
            looped: false,
        });
    }
    if score.render.sections {
        for (i, (name, start, len)) in order.iter().enumerate() {
            let def = &score.sections[i];
            let lead = if def.looped {
                0.0
            } else {
                def.lead_in_bars.unwrap_or(score.render.lead_in_bars) * bpb
            };
            windows.push(Window {
                name: name.clone(),
                file_stem: slug(name),
                render_start: (start - lead).max(0.0),
                out_start: *start,
                music_end: start + len,
                tail_s: def.tail_s.unwrap_or(score.render.tail_s),
                looped: def.looped,
            });
        }
    }
    if let Some(only) = &args.only {
        windows.retain(|w| only.iter().any(|o| o == &w.name));
    }
    if windows.is_empty() {
        return Err("nothing to render".into());
    }

    eprintln!(
        "{}: {} BPM, {} bars, {} tracks, {} windows, {} jobs",
        score.title,
        score.tempo,
        song_end / bpb,
        plans.len(),
        windows.len(),
        args.jobs
    );
    for tp in &plans {
        eprintln!(
            "  track {:<10} {:<14} app gain_db {:+6.2} → makeup ×{:.3}, trim {:+.1} dB, {} voices, {} notes",
            tp.name,
            tp.preset,
            tp.gain_db_app,
            tp.makeup,
            tp.trim_db,
            tp.voices,
            tp.notes.len()
        );
    }

    // Render every (window, track) pair on a small pool of threads.
    let jobs: Vec<(usize, usize)> = (0..windows.len())
        .flat_map(|w| (0..plans.len()).map(move |t| (w, t)))
        .collect();
    let slots: Mutex<Vec<Option<Result<Rendered, String>>>> =
        Mutex::new((0..jobs.len()).map(|_| None).collect());
    let next = AtomicUsize::new(0);
    std::thread::scope(|s| {
        for _ in 0..args.jobs.min(jobs.len()) {
            s.spawn(|| loop {
                let j = next.fetch_add(1, Ordering::Relaxed);
                if j >= jobs.len() {
                    break;
                }
                let (w, t) = jobs[j];
                let r = render_track(&plans[t], &windows[w], &clock);
                slots.lock().unwrap()[j] = Some(r);
            });
        }
    });
    let mut results: Vec<Option<Rendered>> = Vec::new();
    for r in slots.into_inner().unwrap() {
        match r {
            Some(Ok(x)) => results.push(Some(x)),
            Some(Err(e)) => return Err(e),
            None => return Err("a render job did not run".into()),
        }
    }

    // Mix: fader and pan per track, summed. Stems stay pre-master for now.
    struct Mixed {
        stems: Vec<Option<(Vec<f64>, Vec<f64>)>>,
        l: Vec<f64>,
        r: Vec<f64>,
        pre_peaks: Vec<f32>,
        /// Loops: the summed tail that was wrapped onto the downbeat.
        wrapped: Vec<f64>,
    }
    let mut mixed: Vec<Mixed> = Vec::new();
    for (wi, win) in windows.iter().enumerate() {
        let s0 = clock.sample(win.render_start);
        let out0 = (clock.sample(win.out_start) - s0) as usize;
        let len_music = (clock.sample(win.music_end) - clock.sample(win.out_start)) as usize;
        let mut mix_l: Vec<f64> = Vec::new();
        let mut mix_r: Vec<f64> = Vec::new();
        let mut stems = Vec::new();
        let mut pre_peaks = Vec::new();
        let mut wrapped: Vec<f64> = Vec::new();
        for (ti, tp) in plans.iter().enumerate() {
            let rend = results[wi * plans.len() + ti].take().unwrap();
            pre_peaks.push(rend.peak);
            let frames = rend.buf.len() / 2;
            let n = frames - out0;
            if mix_l.is_empty() {
                mix_l = vec![0.0; n];
                mix_r = vec![0.0; n];
            }
            let th = (tp.pan + 1.0) * std::f64::consts::FRAC_PI_4;
            let (pl, pr) = (
                std::f64::consts::SQRT_2 * th.cos(),
                std::f64::consts::SQRT_2 * th.sin(),
            );
            let mut sl = vec![0.0f64; n];
            let mut sr_ = vec![0.0f64; n];
            let mut any = false;
            for i in 0..n {
                let abs = s0 + (out0 + i) as i64;
                let fdb = if tp.fader.is_empty() {
                    0.0
                } else {
                    interp(&tp.fader, clock.beat(abs))
                };
                let g = 10f64.powf((tp.gain_db + fdb) / 20.0);
                let x = rend.buf[(out0 + i) * 2] as f64;
                let y = rend.buf[(out0 + i) * 2 + 1] as f64;
                sl[i] = x * g * pl;
                sr_[i] = y * g * pr;
                any |= x != 0.0 || y != 0.0;
            }
            if win.looped {
                // Wrap the tail onto the downbeat: the loop as it sounds on
                // its second time round.
                let l = len_music;
                let last = sl[n - 1].abs().max(sr_[n - 1].abs());
                if last > 1e-6 {
                    eprintln!(
                        "  warning: {} `{}` still sounding where its loop tail was cut ({:.1} dBFS)",
                        win.name,
                        tp.name,
                        db(last)
                    );
                }
                if wrapped.len() < n - l {
                    wrapped.resize(n - l, 0.0);
                }
                for i in l..n {
                    wrapped[i - l] += sl[i].abs().max(sr_[i].abs());
                    sl[i - l] += sl[i];
                    sr_[i - l] += sr_[i];
                }
                sl.truncate(l);
                sr_.truncate(l);
            }
            for i in 0..sl.len() {
                mix_l[i] += sl[i];
                mix_r[i] += sr_[i];
            }
            if win.looped {
                mix_l.truncate(sl.len());
                mix_r.truncate(sl.len());
            }
            stems.push(if any { Some((sl, sr_)) } else { None });
        }
        mixed.push(Mixed {
            stems,
            l: mix_l,
            r: mix_r,
            pre_peaks,
            wrapped,
        });
    }

    // Master gain: one scalar for the whole score.
    let target = 10f64.powf(score.master.peak_dbfs / 20.0);
    let mut tps = Vec::new();
    for m in &mixed {
        tps.push(true_peak(&m.l).max(true_peak(&m.r)));
    }
    let loudest = tps.iter().cloned().fold(0.0f64, f64::max);
    let gain_db = match score.master.gain_db {
        Some(g) => g,
        None => db(target) - db(loudest),
    };
    let g = 10f64.powf(gain_db / 20.0);
    eprintln!(
        "master gain {:+.2} dB ({}), loudest true peak before it {:.2} dBTP",
        gain_db,
        if score.master.gain_db.is_some() {
            "fixed"
        } else {
            "fitted"
        },
        db(loudest)
    );

    let dir = args.out.join(&title_slug);
    let stem_dir = dir.join("stems");
    std::fs::create_dir_all(&stem_dir).map_err(|e| e.to_string())?;
    let silence = 10f64.powf(score.render.silence_dbfs / 20.0);
    let mut manifest_files = Vec::new();
    let mut summary = String::new();
    for (wi, (win, m)) in windows.iter().zip(mixed.iter_mut()).enumerate() {
        let len_music = (clock.sample(win.music_end) - clock.sample(win.out_start)) as usize;
        for x in m.l.iter_mut().chain(m.r.iter_mut()) {
            *x *= g;
        }
        // Trim the tail at the silence threshold and fade the cut. A tail
        // still sounding when it reaches `tail_s` is faded over the last
        // CAP_FADE_S of it rather than clipped.
        let mut n = m.l.len();
        let mut fade_len = (END_FADE_S * sr) as usize;
        if !win.looped {
            let last = (0..m.l.len())
                .rev()
                .find(|&i| m.l[i].abs() > silence || m.r[i].abs() > silence)
                .unwrap_or(0);
            let margin = (TAIL_MARGIN_S * sr) as usize;
            if last + margin >= m.l.len() {
                fade_len = ((CAP_FADE_S * sr) as usize).min(m.l.len().saturating_sub(len_music));
                eprintln!(
                    "  note: `{}` tail still sounding at {:.1} s; faded over its last {:.2} s",
                    win.name,
                    m.l.len() as f64 / sr,
                    fade_len as f64 / sr
                );
            }
            n = (last + margin).max(len_music).min(m.l.len());
            m.l.truncate(n);
            m.r.truncate(n);
        }
        let fade = |l: &mut [f64], r: &mut [f64]| {
            let f = fade_len.min(l.len());
            let n = l.len();
            for k in 0..f {
                let w = 0.5 - 0.5 * (std::f64::consts::PI * k as f64 / f as f64).cos();
                l[n - 1 - k] *= w;
                r[n - 1 - k] *= w;
            }
        };
        if !win.looped {
            fade(&mut m.l, &mut m.r);
        }
        let mix_path = dir.join(format!("{}.wav", win.file_stem));
        write_wav24(&mix_path, score.sample_rate, &m.l, &m.r)?;
        let sp =
            m.l.iter()
                .chain(m.r.iter())
                .fold(0.0f64, |a, x| a.max(x.abs()));
        let tp_db = db(tps[wi] * g);
        let _ = writeln!(
            summary,
            "{:<34} {:>7.2}s  peak {:>6.2} dBFS  true peak {:>6.2} dBTP",
            format!("{}.wav", win.file_stem),
            n as f64 / sr,
            db(sp),
            tp_db
        );
        let mut stem_files = Vec::new();
        for (ti, tp) in plans.iter().enumerate() {
            let Some((sl, sr_)) = m.stems[ti].as_mut() else {
                continue;
            };
            for x in sl.iter_mut().chain(sr_.iter_mut()) {
                *x *= g;
            }
            sl.truncate(n);
            sr_.truncate(n);
            if !win.looped {
                fade(sl, sr_);
            }
            let p = stem_dir
                .join(&win.file_stem)
                .join(format!("{}.wav", slug(&tp.name)));
            std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
            write_wav24(&p, score.sample_rate, sl, sr_)?;
            let pk = sl
                .iter()
                .chain(sr_.iter())
                .fold(0.0f64, |a, x| a.max(x.abs()));
            if m.pre_peaks[ti] >= LIMITER_FLAG {
                eprintln!(
                    "  note: {} `{}` pre-fader peak {:.3}: the instrument's master limiter acted",
                    win.name, tp.name, m.pre_peaks[ti]
                );
            }
            stem_files.push(json!({
                "track": tp.name,
                "file": format!("stems/{}/{}.wav", win.file_stem, slug(&tp.name)),
                "peak_dbfs": db(pk),
                "instrument_peak": m.pre_peaks[ti],
                "instrument_limited": m.pre_peaks[ti] >= LIMITER_FLAG,
            }));
        }
        let bar_s = bpb * 60.0 / score.tempo;
        // What the loop wrap put onto the downbeat (an upper bound: the sum
        // of the stems' tail magnitudes), and how long it stays above the
        // silence threshold.
        let wrapped_peak = m.wrapped.iter().fold(0.0f64, |a, x| a.max(x * g));
        let wrapped_s = m
            .wrapped
            .iter()
            .rposition(|x| x * g > silence)
            .map_or(0.0, |i| (i + 1) as f64 / sr);
        manifest_files.push(json!({
            "window": win.name,
            "file": format!("{}.wav", win.file_stem),
            "loop": win.looped,
            "frames": n,
            "seconds": n as f64 / sr,
            "music_frames": len_music,
            "music_seconds": len_music as f64 / sr,
            "tail_frames": n.saturating_sub(len_music),
            "bars": (win.music_end - win.out_start) / bpb,
            "starts_at_bar": win.out_start / bpb + 1.0,
            "lead_in_bars": (win.out_start - win.render_start) / bpb,
            "bar_seconds": bar_s,
            "peak_dbfs": db(sp),
            "true_peak_dbtp": tp_db,
            "loop_wrapped_tail_peak_dbfs": if win.looped { json!(db(wrapped_peak)) } else { json!(null) },
            "loop_wrapped_tail_seconds": if win.looped { json!(wrapped_s) } else { json!(null) },
            "stems": stem_files,
        }));
    }
    let manifest = json!({
        "title": score.title,
        "tempo_bpm": score.tempo,
        "beats_per_bar": bpb,
        "sample_rate": score.sample_rate,
        "master_gain_db": gain_db,
        "renderer": "crates/auracle-wasm/examples/score.rs (LivePoly, 128-frame quanta)",
        "tracks": plans.iter().map(|tp| json!({
            "name": tp.name,
            "preset": tp.preset,
            "voices": tp.voices,
            "app_gain_db": tp.gain_db_app,
            "makeup": tp.makeup,
            "trim_db": tp.trim_db,
            "fader_db": tp.gain_db,
            "pan": tp.pan,
            "knobs": tp.params.iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>(),
            "automated": tp.lanes.iter().map(|l| l.addr.clone()).collect::<Vec<_>>(),
            "notes": tp.notes.len(),
        })).collect::<Vec<_>>(),
        "files": manifest_files,
    });
    std::fs::write(
        dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    print!("{summary}");
    Ok(())
}
