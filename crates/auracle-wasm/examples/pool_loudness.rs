//! How loud does a fresh bank *sound*? Level, peak and register of every patch
//! a fresh load puts in the evolution bank, measured on what the player hears:
//! the audition buffer exactly as `render_of` hands it to WebAudio (bank ▶,
//! the duel scopes), and the live voice exactly as the worklet plays it —
//! `makeup_of`'s gain, the per-voice limiter and the master brickwall included.
//!
//! ```bash
//! nice cargo run -p auracle-wasm --example pool_loudness --release -- [loads] [threads]
//! ```
//!
//! `loads` fresh boots of the app's 40-patch pool (default 5, i.e. 200
//! patches), filled through the farm surface the worker drives at boot
//! (`fill_draw` → `farm_render` → `fill_absorb`), so the population is vetted
//! and de-duplicated exactly as a fresh load holds it. Engine seeds are fixed:
//! this is a regression instrument, and it has to measure the same bank every
//! time it is run.
//!
//! ## What "heard" means here
//!
//! Every level is in the buffer's own domain, before the app's `master.gain`
//! (the volume fader, 0.8 by default), which is common to every path and so
//! moves nothing relative to anything else. Loudness is BS.1770, mono-
//! equivalent: a mono audition is played to both speakers, a centred live
//! voice is the same signal on both, and both read as one channel would. `I`
//! is gated integrated loudness, `M` the loudest 400 ms block (momentary
//! maximum). The target is [`TARGET_LUFS`], the level normalization aims every
//! audition at and the live makeup aims every patch at.
//!
//! * `aud` — the audition as played, and its true peak (4× oversampled, dBTP).
//!   `sq` is the crest factor (true peak over integrated loudness) the played
//!   buffer lost against the stored one, dB: what a playback limiter took off
//!   the transients. Zero wherever playback is the stored buffer.
//! * `note` — C4 at full velocity for the phrase's own C4 span (1.8 s held,
//!   0.2 s released), so it is comparable with the audition's first segment.
//! * `hold` — C4 held for 8 s: `S` is the loudness of its last 2 s, what a
//!   sustained note settles at. The phrase holds C4 for 1.8 s and the amp
//!   attack reaches 10 s, so a slow swell is measured long before it arrives;
//!   this is the column that says what a makeup fitted on the phrase does to
//!   it.
//! * `chord` — C3 G3 E4 C5 for the same span (the worklet's four voices).
//! * `gain` / `cut` / `want` — the featurizer's normalization gain, the part
//!   of the loudness makeup the peak ceiling gave up, and the makeup loudness
//!   alone asked for (`TARGET_LUFS − lufs_before`). `mkup` is what `makeup_of`
//!   hands the worklet.
//! * `att` — the amp envelope's attack time, seconds.
//! * `spk` — share of the audition's energy in 200 Hz–5 kHz, roughly what a
//!   laptop speaker reproduces (as `preset_audit`'s column); `small` is the
//!   audition's loudness through a 200 Hz 24 dB/oct highpass, the same thing
//!   as a level.
//! * `lo` — share of energy below 200 Hz while C4 is held (the phrase's first
//!   segment): a patch whose C4 lives down there is a bass patch whatever its
//!   level.
//!
//! Classes: **inaudible** ≥ 10 LU under target; **quiet** 4–10 LU under;
//! **loud** ≥ 4 LU over (4 is `preset_audit`'s threshold for "audibly quieter
//! than its neighbours"). Each is counted on level alone, and inaudible again
//! with `spk` < 20 % added — a patch a laptop cannot reproduce is inaudible on
//! one at any level. The live classes read `note`, and `hold` reads its `S`.
//!
//! ## What it measured
//!
//! The playback level change (`src/level.rs`, the leveler in `src/live.rs`),
//! 200 patches, the same five loads on both sides:
//!
//! ```text
//!                                            before          after
//! audition I, p5 / min (LUFS)           -28.2 / -38.8   -19.5 / -26.7
//! audition I, p5–p95 spread                  10.2 LU          1.5 LU
//! auditions ≥ 10 LU under / 4–10 under     11 / 19          0 / 4
//! audition true peak, max / over 0 dBTP   +1.8 / 28       -0.0 / 0
//! live note I, p5 / p50 / p95 (LUFS)  -51.0/-20.4/-15.6  -28.6/-18.9/-15.1
//! live note spread, p5–p95 / IQR          35.4 / 11.1      13.5 / 3.9 LU
//! live notes ≥ 10 LU under / 4–10 under    53 / 31         12 / 28
//! held 8 s, loudest settles at (LUFS)          -2.6            -9.5
//! held 8 s, settles ≥ 4 LU over target      39 (19.5 %)     55 (27.5 %)
//! chord I, p50 / max (LUFS)               -14.4 / -6.2    -13.0 / -9.9
//! live sample peak, max                  0.98 (brickwall)  0.98
//! live true peak, max (dBTP)                   +2.7            +3.4
//! live makeup range (dB), clamped      ±12, 85 clamped   -18 … +49, none
//! ```
//!
//! What did not move, and why. The auditions still short are four peak-cut
//! patches whose crest is in a sustained waveform, which a true-peak ceiling
//! cannot make louder without clipping it. The live notes still short are
//! slow swells (a 2 s tap of a 10 s attack is quiet; held, it arrives) and
//! plucks and bells whose C4 sits 10–20 dB under their own phrase (their
//! keytracked C5 carries the phrase), which no per-patch gain can fix without
//! breaking the other notes. More held notes now settle 4–8 LU over the target
//! because swells now start at the right level and rise into the leveler's cap
//! instead of starting 12 dB short and rising past everything. Live true peaks
//! are the brickwall's: it has no look-ahead, so its instant attack overshoots
//! between samples, as it did before, a little more often now that peaky
//! patches get their full makeup (72 patches over 0 dBTP, 64 before); its
//! sample ceiling holds. And 16.5 % of the bank (`spk` < 20 %) is still
//! inaudible on a laptop at any level: that is register, not loudness.
//!
//! The register (#62): the grammar's octave weights (`OCTAVE_WEIGHTS`, 5 %,
//! 15 %, 40 %, 25 % and 15 % for −2 … +2) in place of a uniform draw. The
//! same five loads, which a new prior fills with other patches, and the
//! table the run ends with, by the octave of each patch's lowest oscillator:
//!
//! ```text
//!                                   uniform        weighted
//! spk < 20 %                       35 (17.5 %)     17 (8.5 %)
//! mostly < 200 Hz at C4            61 (30.5 %)     43 (21.5 %)
//! live notes ≥ 10 LU under         13 (6.5 %)      10 (5.0 %)
//!
//! lowest octave        patches, of them mostly < 200 Hz, spk < 20 %
//!   −2                 37: 23, 15                 15: 11, 7
//!   −1                 43: 29, 14                 41: 26, 6
//!    0                 49:  1,  2                 71:  2, 2
//!   +1                 25:  1,  1                 37:  1, 2
//!   +2                 32:  5,  3                 22:  1, 0
//!   no oscillator      14:  2,  0                 14:  2, 0
//! ```
//!
//! The issue estimated about 15 % mostly sub and 7 % under the speaker
//! threshold by reweighting the uniform pool. The second came out near it;
//! the first less far down, because the octave of a patch's lowest
//! oscillator is the lowest of several draws: a patch with two oscillators
//! has one at −1 or lower more than a third of the time (1 − 0.8²), and
//! −1 is still the lowest octave of a fifth of the bank, two thirds of them
//! mostly sub. The weights moved patches between the rows; within a row
//! the share that is mostly sub stayed about where it was (the small rows
//! move with their few patches).

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use auracle_features::{integrated_lufs, CachedFeatures, TARGET_LUFS};
use auracle_grammar::{AudioNode, PatchTree};
use auracle_wasm::{farm_render, LivePoly, WasmEngine};
use rustfft::{num_complex::Complex, FftPlanner};

/// One fresh load: the app's pool (`poolSize` in `apps/web/main.js`).
const POOL: usize = 40;
/// Voices the worklet builds (`new LivePoly(tree, sampleRate, 4)`).
const VOICES: usize = 4;
/// The live voice runs at the device's rate; 48 kHz is the common one.
const SR_LIVE: f64 = 48_000.0;
/// The standard phrase's rate.
const SR_PHRASE: f64 = 44_100.0;
/// One AudioWorklet render quantum.
const QUANTUM: usize = 128;
/// Full velocity: `vel_gain(1.0) = 1`, the loudest a key plays. The computer
/// keyboard's 0.78 sits 2.5 dB under this, identically for every patch.
const VEL: f64 = 1.0;
/// The phrase's C4 span (`PhraseSpec::default`): held, then released.
const NOTE_ON_S: f64 = 1.8;
const NOTE_OFF_S: f64 = 0.2;
/// The long hold, and the window at its end that reads as "sustained".
const HOLD_S: f64 = 8.0;
const SUSTAIN_S: f64 = 2.0;
/// C3–C5 across the worklet's four voices.
const CHORD: [u8; 4] = [48, 55, 64, 72];

const INAUDIBLE_LU: f64 = -10.0;
const QUIET_LU: f64 = -4.0;
const LOUD_LU: f64 = 4.0;
const SMALL_SPK: f64 = 0.20;
/// "Mostly below 200 Hz at C4".
const LOW_MOSTLY: f64 = 0.5;

// ---------------------------------------------------------------------------
// Meters. Independent of the code under test on purpose: the playback path's
// own limiter must not be verified by itself.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

impl Biquad {
    fn run(self, x: &[f64]) -> Vec<f64> {
        let (mut x1, mut x2, mut y1, mut y2) = (0.0, 0.0, 0.0, 0.0);
        x.iter()
            .map(|&x0| {
                let y0 = self.b0 * x0 + self.b1 * x1 + self.b2 * x2 - self.a1 * y1 - self.a2 * y2;
                (x2, x1, y2, y1) = (x1, x0, y1, y0);
                y0
            })
            .collect()
    }

    /// RBJ highpass.
    fn highpass(fs: f64, fc: f64, q: f64) -> Self {
        let w = std::f64::consts::TAU * fc / fs;
        let (c, alpha) = (w.cos(), w.sin() / (2.0 * q));
        let a0 = 1.0 + alpha;
        Biquad {
            b0: (1.0 + c) / 2.0 / a0,
            b1: -(1.0 + c) / a0,
            b2: (1.0 + c) / 2.0 / a0,
            a1: -2.0 * c / a0,
            a2: (1.0 - alpha) / a0,
        }
    }
}

/// The BS.1770 K-weighting pair, derived exactly as `auracle_features::loudness`
/// derives it (checked against it on every patch, see `measure_load`).
fn k_weight(x: &[f64], fs: f64) -> Vec<f64> {
    let (g_db, q, fc) = (
        3.999_843_853_973_347,
        0.707_175_236_955_419_6,
        1_681.974_450_955_533,
    );
    let k = (std::f64::consts::PI * fc / fs).tan();
    let vh = 10f64.powf(g_db / 20.0);
    let vb = vh.powf(0.499_666_774_155);
    let a0 = 1.0 + k / q + k * k;
    let shelf = Biquad {
        b0: (vh + vb * k / q + k * k) / a0,
        b1: 2.0 * (k * k - vh) / a0,
        b2: (vh - vb * k / q + k * k) / a0,
        a1: 2.0 * (k * k - 1.0) / a0,
        a2: (1.0 - k / q + k * k) / a0,
    };
    let (q, fc) = (0.500_327_037_323_877_3, 38.135_470_876_024_44);
    let k = (std::f64::consts::PI * fc / fs).tan();
    let a0 = 1.0 + k / q + k * k;
    let hp = Biquad {
        b0: 1.0 / a0,
        b1: -2.0 / a0,
        b2: 1.0 / a0,
        a1: 2.0 * (k * k - 1.0) / a0,
        a2: (1.0 - k / q + k * k) / a0,
    };
    hp.run(&shelf.run(x))
}

/// Integrated (gated) and momentary-maximum loudness over `channels`,
/// mono-equivalent (the channels' mean energy, so identical L and R read as one
/// channel would). `-inf` for a signal the absolute gate calls silent.
#[derive(Clone, Copy)]
struct Loudness {
    i: f64,
    m: f64,
}

fn loudness(channels: &[&[f64]], fs: f64) -> Loudness {
    let silent = Loudness {
        i: f64::NEG_INFINITY,
        m: f64::NEG_INFINITY,
    };
    let block = (0.4 * fs) as usize;
    let step = block / 4;
    let len = channels[0].len();
    if len < block {
        return silent;
    }
    let w: Vec<Vec<f64>> = channels.iter().map(|c| k_weight(c, fs)).collect();
    let mut blocks = Vec::new();
    let mut start = 0;
    while start + block <= len {
        let ms = w
            .iter()
            .map(|c| c[start..start + block].iter().map(|s| s * s).sum::<f64>() / block as f64)
            .sum::<f64>()
            / w.len() as f64;
        blocks.push(-0.691 + 10.0 * (ms + 1e-30).log10());
        start += step;
    }
    let energy = |ls: &[f64]| {
        ls.iter()
            .map(|l| 10f64.powf((l + 0.691) / 10.0))
            .sum::<f64>()
            / ls.len() as f64
    };
    let abs: Vec<f64> = blocks.into_iter().filter(|l| *l > -70.0).collect();
    if abs.is_empty() {
        return silent;
    }
    let m = abs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let rel = -0.691 + 10.0 * energy(&abs).log10() - 10.0;
    let gated: Vec<f64> = abs.into_iter().filter(|l| *l > rel).collect();
    Loudness {
        i: -0.691 + 10.0 * energy(&gated).log10(),
        m,
    }
}

/// Loudness through a laptop-sized speaker: a 200 Hz 4th-order Butterworth
/// highpass in front of the meter.
fn lufs_small(x: &[f64], fs: f64) -> f64 {
    let a = Biquad::highpass(fs, 200.0, 0.541_196_100_146_197);
    let b = Biquad::highpass(fs, 200.0, 1.306_562_964_876_376_6);
    loudness(&[&b.run(&a.run(x))], fs).i
}

fn bessel_i0(x: f64) -> f64 {
    let (mut sum, mut term, mut k) = (1.0, 1.0, 1.0);
    while term > 1e-12 * sum {
        term *= (x / (2.0 * k)).powi(2);
        sum += term;
        k += 1.0;
    }
    sum
}

/// Interpolation phases for a 4× true-peak meter (BS.1770-4 Annex 2's
/// method; a 32-tap Kaiser-windowed sinc per phase rather than its 12-tap
/// table, so it under-reads less, not more).
struct TruePeak {
    phases: Vec<Vec<f64>>,
}

impl TruePeak {
    const OS: usize = 4;
    const HALF: isize = 16;

    fn new() -> Self {
        let beta = 8.0;
        let phases = (1..Self::OS)
            .map(|p| {
                let frac = p as f64 / Self::OS as f64;
                let mut c: Vec<f64> = (-Self::HALF + 1..=Self::HALF)
                    .map(|j| {
                        let t = frac - j as f64;
                        let sinc = (std::f64::consts::PI * t).sin() / (std::f64::consts::PI * t);
                        let u = t / Self::HALF as f64;
                        sinc * bessel_i0(beta * (1.0 - u * u).max(0.0).sqrt()) / bessel_i0(beta)
                    })
                    .collect();
                let s: f64 = c.iter().sum();
                c.iter_mut().for_each(|v| *v /= s);
                c
            })
            .collect();
        TruePeak { phases }
    }

    /// Largest |x| on and between the samples.
    fn peak(&self, x: &[f64]) -> f64 {
        let mut peak = x.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        let n = x.len() as isize;
        for k in 0..n {
            for c in &self.phases {
                let mut acc = 0.0;
                for (idx, j) in (-Self::HALF + 1..=Self::HALF).enumerate() {
                    let at = k + j;
                    if at >= 0 && at < n {
                        acc += x[at as usize] * c[idx];
                    }
                }
                peak = peak.max(acc.abs());
            }
        }
        peak
    }
}

fn db(x: f64) -> f64 {
    20.0 * x.max(1e-12).log10()
}

struct Tone {
    /// < 200 Hz.
    low: f64,
    /// 200 Hz – 5 kHz.
    speaker: f64,
    centroid: f64,
}

/// Band shares and centroid over the active frames (within 40 dB of the
/// loudest), as `auracle_features`' `preset_audit` measures them.
fn tone(x: &[f64], sr: f64) -> Tone {
    const N: usize = 2048;
    const HOP: usize = 1024;
    let fft = FftPlanner::new().plan_fft_forward(N);
    let win: Vec<f64> = (0..N)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / N as f64).cos())
        .collect();
    let frames: Vec<&[f64]> = (0..x.len().saturating_sub(N))
        .step_by(HOP)
        .map(|i| &x[i..i + N])
        .collect();
    let energy: Vec<f64> = frames
        .iter()
        .map(|f| f.iter().map(|s| s * s).sum())
        .collect();
    let loudest = energy.iter().cloned().fold(0.0, f64::max);
    let mut power = vec![0.0; N / 2 + 1];
    for (f, e) in frames.iter().zip(&energy) {
        if *e < loudest * 1e-4 {
            continue;
        }
        let mut buf: Vec<Complex<f64>> = f
            .iter()
            .zip(&win)
            .map(|(s, w)| Complex::new(s * w, 0.0))
            .collect();
        fft.process(&mut buf);
        for (p, c) in power.iter_mut().zip(&buf) {
            *p += c.norm_sqr();
        }
    }
    let hz = |k: usize| k as f64 * sr / N as f64;
    let total: f64 = power.iter().sum::<f64>().max(1e-30);
    let band = |lo: f64, hi: f64| {
        power
            .iter()
            .enumerate()
            .filter(|(k, _)| hz(*k) >= lo && hz(*k) < hi)
            .map(|(_, p)| p)
            .sum::<f64>()
            / total
    };
    Tone {
        low: band(0.0, 200.0),
        speaker: band(200.0, 5000.0),
        centroid: power
            .iter()
            .enumerate()
            .map(|(k, p)| hz(k) * p)
            .sum::<f64>()
            / total,
    }
}

// ---------------------------------------------------------------------------
// The two paths, as the app drives them.
// ---------------------------------------------------------------------------

struct Level {
    loud: Loudness,
    sample_peak: f64,
    true_peak: f64,
}

impl Level {
    fn of(channels: &[&[f64]], fs: f64, tp: &TruePeak) -> Level {
        Level {
            loud: loudness(channels, fs),
            sample_peak: channels
                .iter()
                .flat_map(|c| c.iter())
                .fold(0.0f64, |m, v| m.max(v.abs())),
            true_peak: channels.iter().map(|c| tp.peak(c)).fold(0.0f64, f64::max),
        }
    }
}

/// Play `notes` on a fresh worklet instrument with `makeup`: hold `on_s`,
/// release, run `off_s`. Interleaved stereo, split.
fn live(tree: &str, makeup: f64, notes: &[u8], on_s: f64, off_s: f64) -> (Vec<f64>, Vec<f64>) {
    let mut poly = LivePoly::new(tree, SR_LIVE, VOICES).expect("the worklet builds it");
    poly.set_makeup(makeup);
    for &n in notes {
        poly.note_on(n, VEL);
    }
    let (mut l, mut r) = (Vec::new(), Vec::new());
    let mut run = |poly: &mut LivePoly, secs: f64| {
        for _ in 0..(secs * SR_LIVE / QUANTUM as f64).round() as usize {
            for fr in poly.process(QUANTUM).chunks_exact(2) {
                l.push(fr[0] as f64);
                r.push(fr[1] as f64);
            }
        }
    };
    run(&mut poly, on_s);
    for &n in notes {
        poly.note_off(n);
    }
    run(&mut poly, off_s);
    (l, r)
}

struct Row {
    load: u64,
    id: u32,
    name: String,
    gain_db: f64,
    cut_db: f64,
    want_db: f64,
    makeup_db: f64,
    attack_s: f64,
    /// The audition as stored (what φ was measured on, in f32).
    stored: Loudness,
    aud: Level,
    /// Crest factor the played audition lost against the stored one, dB.
    squash: f64,
    small: f64,
    note: Level,
    hold: Level,
    /// Loudness of the hold's last [`SUSTAIN_S`].
    sustain: f64,
    chord: Level,
    spk: f64,
    centroid: f64,
    low_c4: f64,
    /// The lowest octave of any oscillator in the patch, which sets its
    /// register; `None` for a patch with no oscillator (noise, a hole).
    low_octave: Option<i8>,
}

/// The lowest octave of any oscillator under `n`.
fn lowest_octave(n: &AudioNode) -> Option<i8> {
    let own = match n {
        AudioNode::Vco { octave, .. }
        | AudioNode::Supersaw { octave, .. }
        | AudioNode::Wavetable { octave, .. }
        | AudioNode::Pluck { octave, .. }
        | AudioNode::Formant { octave, .. } => Some(*octave),
        _ => None,
    };
    n.children()
        .into_iter()
        .filter_map(lowest_octave)
        .chain(own)
        .min()
}

fn measure_load(load: u64, tp: &TruePeak) -> Vec<Row> {
    let mut eng = WasmEngine::new(load, POOL);
    let phrase = eng.phrase_json();
    let mut rows: Vec<Row> = Vec::new();
    loop {
        let wave: Vec<serde_json::Value> =
            serde_json::from_str(&eng.fill_draw(4)).expect("fill_draw JSON");
        if wave.is_empty() {
            break;
        }
        for job in &wave {
            let index = job["i"].as_u64().expect("draw index") as u32;
            let skip = rows.len() >= POOL || job["dup"].as_bool().unwrap_or(false);
            let (cached, stored) = if skip {
                (String::new(), Vec::new())
            } else {
                let tree = serde_json::to_string(&job["tree"]).expect("tree JSON");
                let mut r = farm_render(&tree, &phrase, true);
                if r.ok() {
                    (r.cached(), r.take_samples())
                } else {
                    (String::new(), Vec::new())
                }
            };
            let id = eng.fill_absorb(index, &cached, &stored);
            if id == 0 {
                continue;
            }
            let cf: CachedFeatures = serde_json::from_str(&cached).expect("cached features");
            let f = &cf.features;
            let stored: Vec<f64> = stored.iter().map(|s| *s as f64).collect();
            // What the worker posts to main for ▶, read while the memo still
            // holds the buffer the farm sent (as it does at boot).
            let played: Vec<f64> = eng.render_of(id).iter().map(|s| *s as f64).collect();
            let c4_span = ((NOTE_ON_S + NOTE_OFF_S) * SR_PHRASE) as usize;
            let t = tone(&played, SR_PHRASE);
            let c4 = tone(&played[..c4_span], SR_PHRASE);
            let tree_json = eng.tree_json_of(id);
            let tree: PatchTree = serde_json::from_str(&tree_json).expect("tree");
            let makeup = eng.makeup_of(id);
            let (nl, nr) = live(&tree_json, makeup, &[60], NOTE_ON_S, NOTE_OFF_S);
            let (hl, hr) = live(&tree_json, makeup, &[60], HOLD_S, 0.0);
            let tail = hl.len() - (SUSTAIN_S * SR_LIVE) as usize;
            let (cl, cr) = live(&tree_json, makeup, &CHORD, NOTE_ON_S, NOTE_OFF_S);
            let stored_loud = loudness(&[&stored], SR_PHRASE);
            let aud = Level::of(&[&played], SR_PHRASE, tp);
            let squash = (db(tp.peak(&stored)) - stored_loud.i) - (db(aud.true_peak) - aud.loud.i);
            // The probe's meter against the featurizer's, once per patch: the
            // stored buffer is the one `integrated_lufs` normalized.
            let theirs = integrated_lufs(&stored, SR_PHRASE).unwrap_or(f64::NEG_INFINITY);
            assert!(
                (theirs - stored_loud.i).abs() < 1e-6,
                "probe meter disagrees with auracle_features: {} vs {theirs}",
                stored_loud.i
            );
            rows.push(Row {
                load,
                id,
                name: String::new(),
                gain_db: f.gain_db,
                cut_db: f.peak_reduction_db,
                want_db: TARGET_LUFS - f.lufs_before,
                makeup_db: db(makeup),
                attack_s: 0.001 * 10_000f64.powf(tree.amp.attack.clamp(0.0, 1.0)),
                stored: stored_loud,
                aud,
                squash,
                small: lufs_small(&played, SR_PHRASE),
                note: Level::of(&[&nl, &nr], SR_LIVE, tp),
                sustain: loudness(&[&hl[tail..], &hr[tail..]], SR_LIVE).i,
                hold: Level::of(&[&hl, &hr], SR_LIVE, tp),
                chord: Level::of(&[&cl, &cr], SR_LIVE, tp),
                spk: t.speaker,
                centroid: t.centroid,
                low_c4: c4.low,
                low_octave: lowest_octave(&tree.root),
            });
        }
    }
    let names: HashMap<u64, String> = serde_json::from_str::<Vec<serde_json::Value>>(&eng.ranked())
        .expect("ranked JSON")
        .into_iter()
        .filter_map(|r| Some((r["id"].as_u64()?, r["name"].as_str()?.to_string())))
        .collect();
    for r in &mut rows {
        r.name = names.get(&(r.id as u64)).cloned().unwrap_or_default();
    }
    rows
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

fn quantiles(v: &[f64]) -> [f64; 7] {
    let mut s: Vec<f64> = v.iter().copied().filter(|x| x.is_finite()).collect();
    s.sort_by(f64::total_cmp);
    if s.is_empty() {
        return [f64::NAN; 7];
    }
    let q = |f: f64| s[((s.len() - 1) as f64 * f).round() as usize];
    [
        s[0],
        q(0.05),
        q(0.25),
        q(0.5),
        q(0.75),
        q(0.95),
        s[s.len() - 1],
    ]
}

fn print_dist(label: &str, v: &[f64]) {
    let q = quantiles(v);
    let silent = v.iter().filter(|x| !x.is_finite()).count();
    println!(
        "{label:<28} {:>7.1} {:>7.1} {:>7.1} {:>7.1} {:>7.1} {:>7.1} {:>7.1}   {:>5.1} {:>5.1}{}",
        q[0],
        q[1],
        q[2],
        q[3],
        q[4],
        q[5],
        q[6],
        q[5] - q[1],
        q[4] - q[2],
        if silent > 0 {
            format!("   ({silent} silent)")
        } else {
            String::new()
        }
    );
}

#[derive(Clone, Copy, PartialEq)]
enum Class {
    Inaudible,
    Quiet,
    Fine,
    Loud,
}

fn class(level: f64) -> Class {
    let rel = level - TARGET_LUFS;
    // A silent level is -inf and lands here; an unmeasurable one (NaN) too.
    if rel.is_nan() || rel <= INAUDIBLE_LU {
        Class::Inaudible
    } else if rel <= QUIET_LU {
        Class::Quiet
    } else if rel >= LOUD_LU {
        Class::Loud
    } else {
        Class::Fine
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let loads: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(5);
    let threads: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(1);

    let tp = TruePeak::new();
    let next = AtomicUsize::new(0);
    let done: Mutex<Vec<Row>> = Mutex::new(Vec::new());
    let t0 = Instant::now();
    std::thread::scope(|s| {
        for _ in 0..threads.max(1) {
            s.spawn(|| loop {
                let k = next.fetch_add(1, Ordering::Relaxed) as u64;
                if k >= loads {
                    break;
                }
                let rows = measure_load(k + 1, &tp);
                eprintln!(
                    "load {} done: {} patches, {:.0} s",
                    k + 1,
                    rows.len(),
                    t0.elapsed().as_secs_f64()
                );
                done.lock().expect("row sink").extend(rows);
            });
        }
    });
    let mut rows = done.into_inner().expect("row sink");
    rows.sort_by_key(|r| (r.load, r.id));
    let n = rows.len();

    println!(
        "{:<2} {:>3} {:<16} {:>5} {:>4} {:>5} {:>5} {:>5} | {:>5} {:>5} {:>5} {:>4} {:>5} | {:>5} {:>5} {:>5} {:>5} | {:>5} {:>5} | {:>3} {:>5} {:>3}  flags",
        "ld", "id", "name", "gain", "cut", "want", "mkup", "att",
        "aud I", "aud M", "audTP", "sq", "small",
        "noteI", "holdS", "holdM", "livTP",
        "chdI", "chdTP", "spk", "cent", "lo"
    );
    for r in &rows {
        let mut flags = Vec::new();
        if r.spk < SMALL_SPK {
            flags.push("small-spk");
        }
        match class(r.aud.loud.i) {
            Class::Inaudible => flags.push("INAUDIBLE"),
            Class::Quiet => flags.push("QUIET"),
            Class::Loud => flags.push("LOUD"),
            Class::Fine => {}
        }
        match class(r.note.loud.i) {
            Class::Inaudible => flags.push("live-inaudible"),
            Class::Quiet => flags.push("live-quiet"),
            Class::Loud => flags.push("live-loud"),
            Class::Fine => {}
        }
        if r.sustain - TARGET_LUFS >= LOUD_LU {
            flags.push("hold-loud");
        }
        if r.gain_db.abs() > 12.0 {
            flags.push("clamp");
        }
        if r.low_c4 > LOW_MOSTLY {
            flags.push("sub");
        }
        let name: String = r.name.chars().take(16).collect();
        println!(
            "{:<2} {:>3} {:<16} {:>+5.1} {:>4.1} {:>+5.1} {:>+5.1} {:>5.2} | {:>5.1} {:>5.1} {:>+5.1} {:>4.1} {:>5.1} | {:>5.1} {:>5.1} {:>5.1} {:>+5.1} | {:>5.1} {:>+5.1} | {:>3.0} {:>5.0} {:>3.0}  {}",
            r.load,
            r.id,
            name,
            r.gain_db,
            r.cut_db,
            r.want_db,
            r.makeup_db,
            r.attack_s,
            r.aud.loud.i,
            r.aud.loud.m,
            db(r.aud.true_peak),
            r.squash,
            r.small,
            r.note.loud.i,
            r.sustain,
            r.hold.loud.m,
            db(r.note.true_peak.max(r.hold.true_peak)),
            r.chord.loud.i,
            db(r.chord.true_peak),
            100.0 * r.spk,
            r.centroid,
            100.0 * r.low_c4,
            flags.join(" ")
        );
    }

    let col = |f: &dyn Fn(&Row) -> f64| rows.iter().map(f).collect::<Vec<f64>>();
    println!(
        "\n{n} patches from {loads} fresh loads of {POOL}; target {TARGET_LUFS} LUFS; levels \
         before the master fader\n"
    );
    println!(
        "{:<28} {:>7} {:>7} {:>7} {:>7} {:>7} {:>7} {:>7}   {:>5} {:>5}",
        "", "min", "p5", "p25", "p50", "p75", "p95", "max", "90%", "IQR"
    );
    print_dist("audition I (LUFS)", &col(&|r| r.aud.loud.i));
    print_dist("audition M max (LUFS)", &col(&|r| r.aud.loud.m));
    print_dist("audition true peak (dBTP)", &col(&|r| db(r.aud.true_peak)));
    print_dist(
        "audition sample pk (dBFS)",
        &col(&|r| db(r.aud.sample_peak)),
    );
    print_dist("audition crest lost (dB)", &col(&|r| r.squash));
    print_dist("audition, small spk (LUFS)", &col(&|r| r.small));
    print_dist("stored audition I (LUFS)", &col(&|r| r.stored.i));
    print_dist("live note I (LUFS)", &col(&|r| r.note.loud.i));
    print_dist("live note M max (LUFS)", &col(&|r| r.note.loud.m));
    print_dist("live 8 s hold, last 2 s", &col(&|r| r.sustain));
    print_dist("live 8 s hold M max (LUFS)", &col(&|r| r.hold.loud.m));
    print_dist(
        "live C4 true peak (dBTP)",
        &col(&|r| db(r.note.true_peak.max(r.hold.true_peak))),
    );
    print_dist("live chord I (LUFS)", &col(&|r| r.chord.loud.i));
    print_dist("live chord M max (LUFS)", &col(&|r| r.chord.loud.m));
    print_dist(
        "live chord true pk (dBTP)",
        &col(&|r| db(r.chord.true_peak)),
    );
    print_dist(
        "live chord sample pk (dBFS)",
        &col(&|r| db(r.chord.sample_peak)),
    );
    print_dist(
        "live note − audition (LU)",
        &col(&|r| r.note.loud.i - r.aud.loud.i),
    );
    print_dist("gain_db (dB)", &col(&|r| r.gain_db));
    print_dist("cut (dB)", &col(&|r| r.cut_db));
    print_dist("want (dB)", &col(&|r| r.want_db));
    print_dist("live makeup (dB)", &col(&|r| r.makeup_db));
    print_dist("spk share (%)", &col(&|r| 100.0 * r.spk));
    print_dist("centroid (Hz)", &col(&|r| r.centroid));
    print_dist("< 200 Hz at C4 (%)", &col(&|r| 100.0 * r.low_c4));

    let pct = |k: usize| 100.0 * k as f64 / n.max(1) as f64;
    let count = |f: &dyn Fn(&Row) -> bool| rows.iter().filter(|r| f(r)).count();
    println!();
    for (label, lv) in [
        (
            "audition",
            &(|r: &Row| r.aud.loud.i) as &dyn Fn(&Row) -> f64,
        ),
        ("live note", &|r: &Row| r.note.loud.i),
        ("live hold", &|r: &Row| r.sustain),
    ] {
        let c = |k: Class| count(&|r| class(lv(r)) == k);
        let (i, q, l) = (c(Class::Inaudible), c(Class::Quiet), c(Class::Loud));
        let i_spk = count(&|r| class(lv(r)) == Class::Inaudible || r.spk < SMALL_SPK);
        println!(
            "{label:<10} inaudible {i:>3} ({:>4.1}%)  quiet {q:>3} ({:>4.1}%)  loud {l:>3} ({:>4.1}%)   inaudible or spk < 20 %: {i_spk:>3} ({:>4.1}%)",
            pct(i),
            pct(q),
            pct(l),
            pct(i_spk),
        );
    }
    let small = count(&|r| r.spk < SMALL_SPK);
    let sub = count(&|r| r.low_c4 > LOW_MOSTLY);
    let clamp_up = count(&|r| r.gain_db > 12.0);
    let clamp_down = count(&|r| r.gain_db < -12.0);
    let want_up = count(&|r| r.want_db > 12.0);
    let maxgain = count(&|r| r.want_db > r.gain_db + r.cut_db + 1e-9);
    let cut4 = count(&|r| r.cut_db > 4.0);
    let cut0 = count(&|r| r.cut_db > 0.0);
    let aud_over = count(&|r| r.aud.true_peak > 1.0);
    let live_over = count(&|r| {
        r.note
            .true_peak
            .max(r.hold.true_peak)
            .max(r.chord.true_peak)
            > 1.0
    });
    let slow = count(&|r| r.attack_s > NOTE_ON_S);
    println!(
        "spk < 20 %: {small} ({:.1}%)   mostly < 200 Hz at C4: {sub} ({:.1}%)",
        pct(small),
        pct(sub)
    );
    println!("by the lowest oscillator's octave (register):");
    for octave in [Some(-2), Some(-1), Some(0), Some(1), Some(2), None] {
        let at: Vec<&Row> = rows.iter().filter(|r| r.low_octave == octave).collect();
        let share = |k: usize| 100.0 * k as f64 / at.len().max(1) as f64;
        let (sub, small) = (
            at.iter().filter(|r| r.low_c4 > LOW_MOSTLY).count(),
            at.iter().filter(|r| r.spk < SMALL_SPK).count(),
        );
        println!(
            "  {:>4}  {:>3} patches   mostly < 200 Hz {sub:>3} ({:>5.1}%)   spk < 20 % {small:>3} ({:>5.1}%)",
            octave.map_or("none".to_string(), |o| format!("{o:+}")),
            at.len(),
            share(sub),
            share(small),
        );
    }
    println!(
        "gain_db beyond the ±12 dB live clamp: {} ({:.1}%; {clamp_up} up, {clamp_down} down); \
         loudness alone wanted > +12 dB: {want_up} ({:.1}%)",
        clamp_up + clamp_down,
        pct(clamp_up + clamp_down),
        pct(want_up)
    );
    println!(
        "peak ceiling cut any makeup: {cut0} ({:.1}%), more than 4 dB: {cut4} ({:.1}%); \
         the 30 dB normalization cap bound: {maxgain} ({:.1}%)",
        pct(cut0),
        pct(cut4),
        pct(maxgain)
    );
    println!(
        "amp attack longer than the phrase's C4 hold ({NOTE_ON_S} s): {slow} ({:.1}%)",
        pct(slow)
    );
    println!(
        "true peak over 0 dBTP: audition {aud_over} ({:.1}%)   live {live_over} ({:.1}%)",
        pct(aud_over),
        pct(live_over)
    );

    let show = |label: &str, key: &dyn Fn(&Row) -> f64, top: bool| {
        let mut set: Vec<&Row> = rows.iter().collect();
        set.sort_by(|a, b| key(a).total_cmp(&key(b)));
        if top {
            set.reverse();
        }
        println!("\n{label}");
        for r in set.iter().take(6) {
            println!(
                "  {}/{:<3} {:<18} aud {:>6.1}  note {:>6.1}  hold {:>6.1}  chord {:>6.1} | gain {:>+5.1} cut {:>4.1} want {:>+5.1} mkup {:>+5.1} att {:>5.2} | spk {:>3.0}% lo {:>3.0}%",
                r.load,
                r.id,
                r.name,
                r.aud.loud.i,
                r.note.loud.i,
                r.sustain,
                r.chord.loud.i,
                r.gain_db,
                r.cut_db,
                r.want_db,
                r.makeup_db,
                r.attack_s,
                100.0 * r.spk,
                100.0 * r.low_c4
            );
        }
    };
    show("quietest auditions", &|r| r.aud.loud.i, false);
    show("loudest auditions (M)", &|r| r.aud.loud.m, true);
    show("quietest live notes", &|r| r.note.loud.i, false);
    show("loudest live notes", &|r| r.note.loud.i, true);
    show("loudest sustained holds", &|r| r.sustain, true);
    eprintln!("{:.0} s", t0.elapsed().as_secs_f64());
}
