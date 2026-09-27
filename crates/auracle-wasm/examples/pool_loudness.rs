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
//! moves nothing relative to anything else. Loudness is BS.1770 integrated
//! loudness, mono-equivalent: a mono audition is played to both speakers, a
//! centred live voice is the same signal on both, and both read as one channel
//! would. The target is [`TARGET_LUFS`], the level normalization aims every
//! audition at and the live makeup aims every patch at.
//!
//! * `aud` — the audition as played: integrated loudness, true peak (4×
//!   oversampled, dBTP).
//! * `C4` — one key held 2 s at full velocity, then 1 s of release.
//! * `chord` — C3 G3 E4 C5 held together (the worklet's four voices).
//! * `gain` / `cut` — the featurizer's normalization gain, and the part of the
//!   loudness makeup the peak ceiling gave up. The live makeup is `gain`
//!   clamped to ±12 dB before this change.
//! * `spk` — share of the audition's energy in 200 Hz–5 kHz, roughly what a
//!   laptop speaker reproduces (as `preset_audit`'s column). `small` is the
//!   audition's loudness through a 200 Hz 24 dB/oct highpass: the same thing
//!   as a level.
//! * `lo` — share of energy below 200 Hz while C4 is held (the phrase's first
//!   segment): a patch whose C4 lives down there is a bass patch whatever
//!   its level.
//!
//! Classes, per path: **inaudible** ≥ 10 LU under target, or `spk` < 20 %;
//! **quiet** 4–10 LU under; **loud** ≥ 4 LU over. Four is `preset_audit`'s
//! threshold for "audibly quieter than its neighbours".

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use auracle_features::{integrated_lufs, CachedFeatures, TARGET_LUFS};
use auracle_wasm::{farm_render, LivePoly, WasmEngine};
use rustfft::{num_complex::Complex, FftPlanner};

/// One fresh load: the app's pool (`poolSize` in `apps/web/main.js`).
const POOL: usize = 40;
/// Voices the worklet builds (`new LivePoly(tree, sampleRate, 4)`).
const VOICES: usize = 4;
/// The live voice runs at the device's rate; 48 kHz is the common one.
const SR_LIVE: f64 = 48_000.0;
/// One AudioWorklet render quantum.
const QUANTUM: usize = 128;
/// Full velocity: `vel_gain(1.0) = 1`, the loudest a key plays. The computer
/// keyboard's 0.78 sits 2.5 dB under this, identically for every patch.
const VEL: f64 = 1.0;
const HOLD_S: f64 = 2.0;
const TAIL_S: f64 = 1.0;
/// C3–C5 across the worklet's four voices.
const CHORD: [u8; 4] = [48, 55, 64, 72];
/// The held C4 segment of the standard phrase (`PhraseSpec::default`).
const PHRASE_C4_S: f64 = 1.8;

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
/// derives it (checked against it on every run, see `main`).
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

/// Gated integrated loudness over `channels`, mono-equivalent (the channels'
/// mean energy, so identical L and R read as one channel would). `-inf` for a
/// signal the absolute gate calls silent.
fn lufs(channels: &[&[f64]], fs: f64) -> f64 {
    let block = (0.4 * fs) as usize;
    let step = block / 4;
    let len = channels[0].len();
    if len < block {
        return f64::NEG_INFINITY;
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
        return f64::NEG_INFINITY;
    }
    let rel = -0.691 + 10.0 * energy(&abs).log10() - 10.0;
    let gated: Vec<f64> = abs.into_iter().filter(|l| *l > rel).collect();
    if gated.is_empty() {
        return f64::NEG_INFINITY;
    }
    -0.691 + 10.0 * energy(&gated).log10()
}

/// Loudness through a laptop-sized speaker: a 200 Hz 4th-order Butterworth
/// highpass in front of the meter.
fn lufs_small(x: &[f64], fs: f64) -> f64 {
    let a = Biquad::highpass(fs, 200.0, 0.541_196_100_146_197);
    let b = Biquad::highpass(fs, 200.0, 1.306_562_964_876_376_6);
    lufs(&[&b.run(&a.run(x))], fs)
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
                        let sinc = if t == 0.0 {
                            1.0
                        } else {
                            (std::f64::consts::PI * t).sin() / (std::f64::consts::PI * t)
                        };
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

    /// Largest |x| between and on the samples.
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
    lufs: f64,
    sample_peak: f64,
    true_peak: f64,
}

/// Play `notes` on a fresh worklet instrument with `makeup`, hold, release.
fn live(tree: &str, makeup: f64, notes: &[u8], tp: &TruePeak) -> Level {
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
    run(&mut poly, HOLD_S);
    for &n in notes {
        poly.note_off(n);
    }
    run(&mut poly, TAIL_S);
    Level {
        lufs: lufs(&[&l, &r], SR_LIVE),
        sample_peak: l.iter().chain(&r).fold(0.0f64, |m, v| m.max(v.abs())),
        true_peak: tp.peak(&l).max(tp.peak(&r)),
    }
}

struct Row {
    load: u64,
    id: u32,
    name: String,
    gain_db: f64,
    cut_db: f64,
    makeup_db: f64,
    /// The audition as stored (what φ was measured on, in f32).
    stored_lufs: f64,
    aud: Level,
    small: f64,
    c4: Level,
    chord: Level,
    spk: f64,
    centroid: f64,
    low_c4: f64,
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
            let sr = 44_100.0;
            let stored: Vec<f64> = stored.iter().map(|s| *s as f64).collect();
            // What the worker posts to main for ▶, read while the memo still
            // holds the buffer the farm sent (as it does at boot).
            let played: Vec<f64> = eng.render_of(id).iter().map(|s| *s as f64).collect();
            let t = tone(&played, sr);
            let c4 = tone(&played[..(PHRASE_C4_S * sr) as usize], sr);
            let tree = eng.tree_json_of(id);
            let makeup = eng.makeup_of(id);
            rows.push(Row {
                load,
                id,
                name: String::new(),
                gain_db: f.gain_db,
                cut_db: f.peak_reduction_db,
                makeup_db: db(makeup),
                stored_lufs: lufs(&[&stored], sr),
                aud: Level {
                    lufs: lufs(&[&played], sr),
                    sample_peak: played.iter().fold(0.0f64, |m, v| m.max(v.abs())),
                    true_peak: tp.peak(&played),
                },
                small: lufs_small(&played, sr),
                c4: live(&tree, makeup, &[60], tp),
                chord: live(&tree, makeup, &CHORD, tp),
                spk: t.speaker,
                centroid: t.centroid,
                low_c4: c4.low,
            });
            // The probe's meter against the featurizer's, once per patch: the
            // stored buffer is the one `integrated_lufs` normalized.
            let theirs = integrated_lufs(&stored, sr).unwrap_or(f64::NEG_INFINITY);
            let ours = rows.last().map_or(0.0, |r| r.stored_lufs);
            assert!(
                (theirs - ours).abs() < 1e-6,
                "probe meter disagrees with auracle_features: {ours} vs {theirs}"
            );
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
    [s[0], q(0.05), q(0.25), q(0.5), q(0.75), q(0.95), s[s.len() - 1]]
}

fn print_dist(label: &str, v: &[f64]) {
    let q = quantiles(v);
    let silent = v.iter().filter(|x| !x.is_finite()).count();
    println!(
        "{label:<26} {:>7.1} {:>7.1} {:>7.1} {:>7.1} {:>7.1} {:>7.1} {:>7.1}   {:>5.1} {:>5.1}{}",
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

#[derive(Default)]
struct Classes {
    inaudible: usize,
    quiet: usize,
    loud: usize,
}

fn classify(rows: &[Row], level: impl Fn(&Row) -> f64) -> Classes {
    let mut c = Classes::default();
    for r in rows {
        let rel = level(r) - TARGET_LUFS;
        if !(rel > INAUDIBLE_LU) || r.spk < SMALL_SPK {
            c.inaudible += 1;
        } else if rel <= QUIET_LU {
            c.quiet += 1;
        } else if rel >= LOUD_LU {
            c.loud += 1;
        }
    }
    c
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
        "{:<4} {:>3} {:<20} {:>6} {:>5} {:>6} | {:>6} {:>6} {:>6} | {:>6} {:>6} | {:>6} {:>6} | {:>4} {:>5} {:>4}  flags",
        "load", "id", "name", "gain", "cut", "mkup", "aud I", "aud TP", "small", "C4 I", "C4 TP",
        "chd I", "chd TP", "spk%", "cent", "lo%"
    );
    for r in &rows {
        let rel = r.aud.lufs - TARGET_LUFS;
        let mut flags = Vec::new();
        if !(rel > INAUDIBLE_LU) || r.spk < SMALL_SPK {
            flags.push("INAUDIBLE");
        } else if rel <= QUIET_LU {
            flags.push("QUIET");
        } else if rel >= LOUD_LU {
            flags.push("LOUD");
        }
        let live_rel = r.c4.lufs - TARGET_LUFS;
        if !(live_rel > INAUDIBLE_LU) {
            flags.push("live-INAUDIBLE");
        } else if live_rel <= QUIET_LU {
            flags.push("live-QUIET");
        } else if live_rel >= LOUD_LU {
            flags.push("live-LOUD");
        }
        if r.gain_db.abs() > 12.0 {
            flags.push("CLAMP");
        }
        if r.low_c4 > LOW_MOSTLY {
            flags.push("SUB");
        }
        let name: String = r.name.chars().take(20).collect();
        println!(
            "{:<4} {:>3} {:<20} {:>+6.1} {:>5.1} {:>+6.1} | {:>6.1} {:>+6.1} {:>6.1} | {:>6.1} {:>+6.1} | {:>6.1} {:>+6.1} | {:>4.0} {:>5.0} {:>4.0}  {}",
            r.load,
            r.id,
            name,
            r.gain_db,
            r.cut_db,
            r.makeup_db,
            r.aud.lufs,
            db(r.aud.true_peak),
            r.small,
            r.c4.lufs,
            db(r.c4.true_peak),
            r.chord.lufs,
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
        "{:<26} {:>7} {:>7} {:>7} {:>7} {:>7} {:>7} {:>7}   {:>5} {:>5}",
        "", "min", "p5", "p25", "p50", "p75", "p95", "max", "90%", "IQR"
    );
    print_dist("audition I (LUFS)", &col(&|r| r.aud.lufs));
    print_dist("audition true peak (dBTP)", &col(&|r| db(r.aud.true_peak)));
    print_dist("audition sample pk (dBFS)", &col(&|r| db(r.aud.sample_peak)));
    print_dist("audition, small spk (LUFS)", &col(&|r| r.small));
    print_dist("stored audition I (LUFS)", &col(&|r| r.stored_lufs));
    print_dist("live C4 I (LUFS)", &col(&|r| r.c4.lufs));
    print_dist("live C4 true peak (dBTP)", &col(&|r| db(r.c4.true_peak)));
    print_dist("live chord I (LUFS)", &col(&|r| r.chord.lufs));
    print_dist("live chord true pk (dBTP)", &col(&|r| db(r.chord.true_peak)));
    print_dist("live C4 − audition (LU)", &col(&|r| r.c4.lufs - r.aud.lufs));
    print_dist("gain_db (dB)", &col(&|r| r.gain_db));
    print_dist("cut (dB)", &col(&|r| r.cut_db));
    print_dist("live makeup (dB)", &col(&|r| r.makeup_db));
    print_dist("spk share (%)", &col(&|r| 100.0 * r.spk));
    print_dist("centroid (Hz)", &col(&|r| r.centroid));
    print_dist("< 200 Hz at C4 (%)", &col(&|r| 100.0 * r.low_c4));

    let pct = |k: usize| 100.0 * k as f64 / n.max(1) as f64;
    let count = |f: &dyn Fn(&Row) -> bool| rows.iter().filter(|r| f(r)).count();
    println!();
    for (label, c) in [
        ("audition", classify(&rows, |r| r.aud.lufs)),
        ("live C4", classify(&rows, |r| r.c4.lufs)),
        ("live chord", classify(&rows, |r| r.chord.lufs)),
    ] {
        println!(
            "{label:<11} inaudible {:>3} ({:>4.1}%)  quiet {:>3} ({:>4.1}%)  loud {:>3} ({:>4.1}%)",
            c.inaudible,
            pct(c.inaudible),
            c.quiet,
            pct(c.quiet),
            c.loud,
            pct(c.loud)
        );
    }
    let small = count(&|r| r.spk < SMALL_SPK);
    let clamp_up = count(&|r| r.gain_db > 12.0);
    let clamp_down = count(&|r| r.gain_db < -12.0);
    let cut4 = count(&|r| r.cut_db > 4.0);
    let cut0 = count(&|r| r.cut_db > 0.0);
    let sub = count(&|r| r.low_c4 > LOW_MOSTLY);
    let aud_over = count(&|r| r.aud.true_peak > 1.0);
    let live_over = count(&|r| r.c4.true_peak.max(r.chord.true_peak) > 1.0);
    println!(
        "spk < 20 %: {small} ({:.1}%)   mostly < 200 Hz at C4: {sub} ({:.1}%)",
        pct(small),
        pct(sub)
    );
    println!(
        "gain_db beyond the ±12 dB live clamp: {} ({:.1}%; {clamp_up} up, {clamp_down} down)",
        clamp_up + clamp_down,
        pct(clamp_up + clamp_down)
    );
    println!(
        "peak ceiling cut any makeup: {cut0} ({:.1}%)   more than 4 dB: {cut4} ({:.1}%)",
        pct(cut0),
        pct(cut4)
    );
    println!(
        "true peak over 0 dBTP: audition {aud_over} ({:.1}%)   live {live_over} ({:.1}%)",
        pct(aud_over),
        pct(live_over)
    );

    let mut by_aud: Vec<&Row> = rows.iter().collect();
    by_aud.sort_by(|a, b| a.aud.lufs.total_cmp(&b.aud.lufs));
    let mut by_live: Vec<&Row> = rows.iter().collect();
    by_live.sort_by(|a, b| a.c4.lufs.total_cmp(&b.c4.lufs));
    let show = |label: &str, set: &[&Row]| {
        println!("\n{label}");
        for r in set {
            println!(
                "  load {} id {:>3} {:<22} aud {:>6.1}  C4 {:>6.1}  chord {:>6.1}  gain {:>+5.1} cut {:>4.1} mkup {:>+5.1}  spk {:>3.0}%  lo {:>3.0}%",
                r.load,
                r.id,
                r.name,
                r.aud.lufs,
                r.c4.lufs,
                r.chord.lufs,
                r.gain_db,
                r.cut_db,
                r.makeup_db,
                100.0 * r.spk,
                100.0 * r.low_c4
            );
        }
    };
    show("quietest auditions", &by_aud[..5.min(n)]);
    show("loudest auditions", &by_aud[n.saturating_sub(5)..]);
    show("quietest live C4", &by_live[..5.min(n)]);
    show("loudest live C4", &by_live[n.saturating_sub(5)..]);
    eprintln!("{:.0} s", t0.elapsed().as_secs_f64());
}
