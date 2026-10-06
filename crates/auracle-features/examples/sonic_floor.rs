//! RFC-005's measurements: what a sonic floor could read, what each reading
//! costs per patch, and what a floor would do to a session's first deals.
//!
//! ```bash
//! nice cargo run -p auracle-features --example sonic_floor --release -- [boots] [threads] [--listen DIR]
//! ```
//!
//! `boots` fresh boot fills (default 5), each the first [`MAX_DRAWS`] indices
//! of the fill's draw stream for one fixed fill seed, drawn as
//! `Engine::draw_from` draws them ([`draw_seed`] is copied from
//! `auracle_session::farm`, which this crate cannot depend on). Five boots are
//! 2,000 prior draws. Each draw is rendered, vetted, normalized and measured
//! as `featurize` does it, every step timed, then read by every candidate
//! floor feature. The 62 presets are measured the same way. `--listen DIR`
//! writes the renders a listen would start from ([`listen`]) as raw mono
//! 32-bit floats at 44.1 kHz; `ffmpeg -f f32le -ar 44100 -ac 1 -i X.f32 X.wav`
//! makes one playable.
//!
//! Nothing here changes φ, the vet or the fill: it reads them. The candidate
//! measures that are not in φ are defined here and nowhere else.
//!
//! ## The candidates
//!
//! Already measured on every patch: the vet's `pinned_fraction` and
//! `dc_ratio`; the normalizer's peak cut and whether its 30 dB cap bound; φ's
//! `flatness_mean`, `centroid_mean`, `bass_fraction`, `attack_s` and
//! `motion_fast`; and the face (`face.rs`), whose long-term spectrum gives
//! `spk_face` and `hi_face` below. New readings of the same normalized render:
//!
//! - `spk`, `hi`: the share of energy in 200 Hz–5 kHz (what a laptop speaker
//!   plays) and above 5 kHz, over the frames within 40 dB of the loudest
//!   (`auracle-wasm/examples/pool_loudness.rs`'s `spk`, #62's numbers).
//! - `rough`: sensory roughness, Vassilakis's pair model (Sethares-style
//!   dissonance) over the 40 strongest spectral peaks of 186 ms frames, each
//!   frame's amplitudes relative to its loudest peak; the median over the
//!   held C4 (after its first 100 ms) or over the C4+E4 dyad, whichever is
//!   larger. A harmonic tone reads near 0; beating partials and noise read
//!   high.
//! - `noise`: the share of the held C4's power outside its prominent spectral
//!   peaks (a bin at least 10 dB over the mean of its ±24-bin surround, with
//!   its ±3 bins). A tone, harmonic or not, reads near 0; noise near 1,
//!   filtered or not.
//! - `period`: the held C4's periodicity (the normalized autocorrelation's
//!   peak, median over 46 ms frames); `wobble`: its pitch's spread in cents
//!   over the pitched frames (1.48 × the median absolute deviation).
//! - `mute`: the quietest of the phrase's four notes against the loudest, dB.
//!
//! #62 proposes drawing each oscillator's octave from [`OCTAVE_WEIGHTS_62`]
//! instead of uniformly. Each draw carries its importance weight under those
//! weights (the product, over its oscillators, of the new weight over 1/5),
//! so each share is also given as it would be once #62 lands: an estimate,
//! as #62's own was.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use auracle_features::explain::Facts;
use auracle_features::face::band_edges_hz;
use auracle_features::render::NoteSpan;
use auracle_features::{
    audio_features, featurize, normalize_to, render_phrase, struct_features, vet, Face, Features,
    PhraseSpec, StructFeatures, VetConfig, VetFailure, MAX_GAIN_DB, TARGET_LUFS,
};
use auracle_grammar::rng::gen_index;
use auracle_grammar::{AudioNode, PatchGrammarPrior, PatchTree};
use rand::rngs::StdRng;
use rand::SeedableRng;
use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};

/// A fresh load's pool (`poolSize` in `apps/web/main.js`).
const POOL: usize = 40;
/// The pool at which the worker hands the app over and deals the first duel
/// (`PLAYABLE_AT` in `apps/web/worker.js`).
const PLAYABLE_AT: usize = 8;
/// The fill's draw budget (`SessionConfig::default().max_draws`).
const MAX_DRAWS: u64 = 400;
/// #62's proposed weights for octaves −2…+2.
const OCTAVE_WEIGHTS_62: [f64; 5] = [0.05, 0.15, 0.40, 0.25, 0.15];
/// The films' cast (`www/brand/sound.json`, `cast.shortlist.roles`).
const CAST: [&str; 16] = [
    "Cathedral",
    "Long Room",
    "Rotor",
    "Morph Pad",
    "Tidal",
    "Slow Weather",
    "Wobble Board",
    "Falling Sign",
    "Solo Flight",
    "Telegraph",
    "Choirboy",
    "Fifth Wheel",
    "Held Under",
    "Heartbeat",
    "Ceiling",
    "Dub Echo",
];
/// `search_health`'s synthetic listener (its `ground_truth`): the weights,
/// in σ of φ, with which `make climb` and `make search-check` grade a pool.
const CLIMB_USER: [(&str, f64); 6] = [
    ("centroid_mean", 2.0),
    ("flatness_mean", -1.5),
    ("attack_s", -1.5),
    ("bass_fraction", 1.0),
    ("n_filter", 0.8),
    ("tail_ratio", 0.6),
];

/// `auracle_session::farm::draw_seed`, copied: the seed of draw `index` of
/// the fill stream based at `base`.
fn draw_seed(base: u64, index: u64) -> u64 {
    let mut z = base
        .wrapping_add(index.wrapping_mul(0x9E37_79B9_7F4A_7C15))
        .wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Draw `index` of boot `boot`'s fill stream. Any fixed seed is a fill seed;
/// the app's comes from the session's.
fn draw(prior: &PatchGrammarPrior, boot: usize, index: u64) -> PatchTree {
    let mut rng = StdRng::seed_from_u64(draw_seed(0x5011_C000 + boot as u64, index));
    prior.sample_with_rng(&mut rng)
}

// ---------------------------------------------------------------------------
// The new readings.
// ---------------------------------------------------------------------------

/// Transforms planned once per thread, as `audio.rs` plans its own.
struct Kit {
    f2048: Arc<dyn Fft<f64>>,
    f4096: Arc<dyn Fft<f64>>,
    i4096: Arc<dyn Fft<f64>>,
    f8192: Arc<dyn Fft<f64>>,
    hann2048: Vec<f64>,
    hann8192: Vec<f64>,
}

fn hann(n: usize) -> Vec<f64> {
    (0..n)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n as f64).cos())
        .collect()
}

impl Kit {
    fn new() -> Kit {
        let mut p = FftPlanner::new();
        Kit {
            f2048: p.plan_fft_forward(2048),
            f4096: p.plan_fft_forward(4096),
            i4096: p.plan_fft_inverse(4096),
            f8192: p.plan_fft_forward(8192),
            hann2048: hann(2048),
            hann8192: hann(8192),
        }
    }
}

/// Magnitudes of one Hann-windowed frame, DC to just under Nyquist.
fn spectrum(fft: &Arc<dyn Fft<f64>>, win: &[f64], x: &[f64]) -> Vec<f64> {
    let mut buf: Vec<Complex<f64>> = x
        .iter()
        .zip(win)
        .map(|(s, w)| Complex::new(s * w, 0.0))
        .collect();
    fft.process(&mut buf);
    buf[..x.len() / 2].iter().map(|c| c.norm()).collect()
}

/// `pool_loudness`'s band shares over the frames within 40 dB of the
/// loudest: `(200 Hz–5 kHz, above 5 kHz)`.
fn bands(x: &[f64], sr: f64, kit: &Kit) -> (f64, f64) {
    const N: usize = 2048;
    let frames: Vec<&[f64]> = (0..x.len().saturating_sub(N))
        .step_by(N / 2)
        .map(|i| &x[i..i + N])
        .collect();
    let energy: Vec<f64> = frames
        .iter()
        .map(|f| f.iter().map(|s| s * s).sum())
        .collect();
    let loudest = energy.iter().cloned().fold(0.0, f64::max);
    let mut power = vec![0.0; N / 2];
    for (f, e) in frames.iter().zip(&energy) {
        if *e >= loudest * 1e-4 {
            for (p, m) in power.iter_mut().zip(spectrum(&kit.f2048, &kit.hann2048, f)) {
                *p += m * m;
            }
        }
    }
    let total: f64 = power.iter().sum::<f64>().max(1e-30);
    let band = |lo: f64, hi: f64| {
        let hz = |k: usize| k as f64 * sr / N as f64;
        let inside = power
            .iter()
            .enumerate()
            .filter(|(k, _)| hz(*k) >= lo && hz(*k) < hi);
        inside.map(|(_, p)| p).sum::<f64>() / total
    };
    (band(200.0, 5000.0), band(5000.0, sr))
}

/// The same shares off the face's long-term spectrum, a cost already paid:
/// each band's power density times its width, split at 200 Hz and 5 kHz by
/// overlap. `(200 Hz–5 kHz, above 5 kHz)`, of the face's 35 Hz–14 kHz.
fn face_bands(face: &Face) -> (f64, f64) {
    let edges = band_edges_hz();
    let (mut total, mut spk, mut hi) = (0.0, 0.0, 0.0);
    for (b, db) in face.ltas_db().iter().enumerate() {
        let (lo_e, hi_e) = (edges[b], edges[b + 1]);
        let e = 10f64.powf(db / 10.0) * (hi_e - lo_e);
        let part = |a: f64, z: f64| (hi_e.min(z) - lo_e.max(a)).max(0.0) / (hi_e - lo_e);
        total += e;
        spk += e * part(200.0, 5000.0);
        hi += e * part(5000.0, f64::INFINITY);
    }
    (spk / total, hi / total)
}

/// Vassilakis's roughness of two partials (relative amplitudes, Hz).
fn pair_roughness((a1, f1): (f64, f64), (a2, f2): (f64, f64)) -> f64 {
    let (amin, amax) = (a1.min(a2), a1.max(a2));
    let s = 0.24 / (0.0207 * f1.min(f2) + 18.96);
    let d = (f2 - f1).abs();
    (amin * amax).powf(0.1)
        * 0.5
        * (2.0 * amin / (amin + amax)).powf(3.11)
        * ((-3.5 * s * d).exp() - (-5.75 * s * d).exp())
}

/// One span's frames of 8192 (after its first 100 ms), hop 2048: the median
/// roughness, then the power inside the prominent peaks and in all.
fn peaks(x: &[f64], sr: f64, span: &NoteSpan, kit: &Kit) -> (f64, f64, f64) {
    const N: usize = 8192;
    let kmin = (20.0 * N as f64 / sr).ceil() as usize;
    let (mut roughs, mut tonal, mut total) = (Vec::new(), 0.0, 0.0);
    let mut pos = span.on_start + (0.1 * sr) as usize;
    while pos + N <= span.on_end.min(x.len()) {
        let mag = spectrum(&kit.f8192, &kit.hann8192, &x[pos..pos + N]);
        pos += N / 4;
        let power: Vec<f64> = mag.iter().map(|m| m * m).collect();
        let pmax = power[kmin..].iter().cloned().fold(0.0, f64::max);
        if pmax <= 1e-20 {
            continue;
        }
        let maxima: Vec<usize> = (kmin.max(1)..mag.len() - 1)
            .filter(|&k| mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && power[k] >= pmax * 1e-4)
            .collect();
        // Roughness: the 40 strongest local maxima, each placed by a parabola
        // through its log magnitudes.
        let mut strongest = maxima.clone();
        strongest.sort_by(|a, b| mag[*b].total_cmp(&mag[*a]));
        strongest.truncate(40);
        // No local maximum at all (a spectrum falling from its lowest bin):
        // no partials to beat.
        let amax = strongest.first().map_or(1.0, |&k| mag[k]);
        let parts: Vec<(f64, f64)> = strongest
            .iter()
            .map(|&k| {
                let [a, b, c] = [k - 1, k, k + 1].map(|i| mag[i].max(1e-30).ln());
                let den = a - 2.0 * b + c;
                let d = if den.abs() > 1e-12 {
                    (0.5 * (a - c) / den).clamp(-0.5, 0.5)
                } else {
                    0.0
                };
                (mag[k] / amax, (k as f64 + d) * sr / N as f64)
            })
            .collect();
        let mut r = 0.0;
        for (i, p) in parts.iter().enumerate() {
            r += parts[i + 1..]
                .iter()
                .map(|q| pair_roughness(*p, *q))
                .sum::<f64>();
        }
        roughs.push(r);
        // Noise share: the power outside the prominent peaks' main lobes.
        let mut claimed = vec![false; mag.len()];
        for &k in &maxima {
            let (a, z) = (k.saturating_sub(24), (k + 25).min(mag.len()));
            let around: Vec<f64> = (a..z)
                .filter(|i| i + 3 < k || *i > k + 3)
                .map(|i| power[i])
                .collect();
            if !around.is_empty()
                && power[k] >= 10.0 * around.iter().sum::<f64>() / around.len() as f64
            {
                claimed[k - 3..(k + 4).min(mag.len())].fill(true);
            }
        }
        for (k, p) in power.iter().enumerate().skip(kmin) {
            total += p;
            if claimed[k] {
                tonal += p;
            }
        }
    }
    (median(roughs), tonal, total)
}

/// The held note's periodicity (median peak of the normalized
/// autocorrelation) and its pitch spread in cents (1.48 × MAD over the
/// pitched frames; NaN when fewer than eight are pitched).
fn pitch(x: &[f64], sr: f64, span: &NoteSpan, kit: &Kit) -> (f64, f64) {
    const N: usize = 2048;
    let (tmin, tmax) = ((sr / 2000.0) as usize, (sr / 50.0) as usize);
    let (mut periods, mut cents) = (Vec::new(), Vec::new());
    let mut pos = span.on_start + (0.1 * sr) as usize;
    while pos + N <= span.on_end.min(x.len()) {
        let mut buf: Vec<Complex<f64>> = (0..2 * N)
            .map(|i| Complex::new(if i < N { x[pos + i] } else { 0.0 }, 0.0))
            .collect();
        pos += N / 2;
        kit.f4096.process(&mut buf);
        buf.iter_mut()
            .for_each(|c| *c = Complex::new(c.norm_sqr(), 0.0));
        kit.i4096.process(&mut buf);
        let r0 = buf[0].re;
        if r0 <= 1e-12 {
            continue;
        }
        let nacf = |t: usize| buf[t].re / r0 * N as f64 / (N - t) as f64;
        // Past the first dip, so a bright patch's first lags don't win.
        let start = (tmin..tmax).find(|&t| nacf(t) < 0.0).unwrap_or(tmin);
        let best = (start..tmax).map(nacf).fold(f64::NEG_INFINITY, f64::max);
        if !best.is_finite() {
            continue;
        }
        periods.push(best.clamp(0.0, 1.0));
        // The first lag that reaches 90% of the peak: the period, not a
        // multiple of it.
        let lag = (start.max(1)..tmax - 1)
            .find(|&t| nacf(t) >= 0.9 * best && nacf(t) >= nacf(t + 1) && nacf(t) >= nacf(t - 1));
        if let (true, Some(t)) = (best >= 0.7, lag) {
            let (a, b, c) = (nacf(t - 1), nacf(t), nacf(t + 1));
            let den = a - 2.0 * b + c;
            let d = if den.abs() > 1e-12 {
                (0.5 * (a - c) / den).clamp(-0.5, 0.5)
            } else {
                0.0
            };
            cents.push(1200.0 * (sr / (t as f64 + d)).log2());
        }
    }
    let wobble = if cents.len() >= 8 {
        let m = median(cents.clone());
        1.4826 * median(cents.iter().map(|c| (c - m).abs()).collect())
    } else {
        f64::NAN
    };
    (median(periods), wobble)
}

/// The quietest note's on-span level against the loudest's, dB.
fn mute(x: &[f64], spans: &[NoteSpan]) -> f64 {
    let rms: Vec<f64> = spans
        .iter()
        .map(|s| {
            let seg = &x[s.on_start.min(x.len())..s.on_end.min(x.len())];
            (seg.iter().map(|v| v * v).sum::<f64>() / seg.len().max(1) as f64).sqrt()
        })
        .collect();
    let hi = rms.iter().cloned().fold(0.0, f64::max);
    let lo = rms.iter().cloned().fold(f64::INFINITY, f64::min);
    20.0 * ((lo + 1e-12) / (hi + 1e-12)).log10()
}

fn median(mut xs: Vec<f64>) -> f64 {
    if xs.is_empty() {
        return f64::NAN;
    }
    xs.sort_by(|a, b| a.total_cmp(b));
    xs[xs.len() / 2]
}

// ---------------------------------------------------------------------------
// One patch.
// ---------------------------------------------------------------------------

/// What one vetted patch measured.
struct Meas {
    phi: Vec<f64>,
    flatness: f64,
    centroid_hz: f64,
    attack_ms: f64,
    motion_fast: f64,
    pinned: f64,
    dc: f64,
    capped: bool,
    cut_db: f64,
    spk: f64,
    hi: f64,
    spk_face: f64,
    hi_face: f64,
    rough: f64,
    noise: f64,
    period: f64,
    wobble: f64,
    mute: f64,
}

/// Milliseconds: the featurization's steps, then each new reading's.
#[derive(Clone, Copy, Default)]
struct Times {
    render: f64,
    vet_norm: f64,
    phi: f64,
    face: f64,
    bands: f64,
    peaks: f64,
    pitch: f64,
    mute: f64,
}

struct Row {
    /// The boot a draw came from; `None` for a preset.
    boot: Option<usize>,
    index: u64,
    name: String,
    /// "ok", or why the featurization refused it.
    verdict: &'static str,
    /// Importance weight under #62's octave weights.
    w62: f64,
    lowest_octave: Option<i8>,
    structure: StructFeatures,
    m: Option<Meas>,
    t: Times,
}

impl Row {
    fn m(&self) -> &Meas {
        self.m.as_ref().expect("a vetted row")
    }
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1e3
}

fn octaves(node: &AudioNode, out: &mut Vec<i8>) {
    match node {
        AudioNode::Vco { octave, .. }
        | AudioNode::Supersaw { octave, .. }
        | AudioNode::Wavetable { octave, .. }
        | AudioNode::Pluck { octave, .. }
        | AudioNode::Formant { octave, .. } => out.push(*octave),
        _ => {}
    }
    for c in node.children() {
        octaves(c, out);
    }
}

/// `featurize`, step by step and timed, then every new reading.
fn measure(tree: &PatchTree, spec: &PhraseSpec, kit: &Kit) -> (&'static str, Option<Meas>, Times) {
    let mut t = Times::default();
    let clock = Instant::now();
    let Ok(mut r) = render_phrase(tree, spec) else {
        return ("compile", None, t);
    };
    t.render = ms(clock);
    let clock = Instant::now();
    let report = match vet(&r.samples, &VetConfig::for_spec(spec)) {
        Ok(report) => report,
        Err(VetFailure::Silent { .. }) => return ("silent", None, t),
        Err(VetFailure::Overlevel { .. }) => return ("overlevel", None, t),
        Err(VetFailure::DcDominated { .. }) => return ("dc", None, t),
        Err(VetFailure::NonFinite) => return ("non-finite", None, t),
    };
    let Some(norm) = normalize_to(&mut r.samples, r.sample_rate, TARGET_LUFS) else {
        return ("silent", None, t);
    };
    t.vet_norm = ms(clock);
    let clock = Instant::now();
    let audio = audio_features(&r);
    let mut phi = audio.to_vec();
    phi.extend(struct_features(tree).to_vec());
    t.phi = ms(clock);
    if phi.iter().any(|v| !v.is_finite()) {
        return ("non-finite φ", None, t);
    }
    let clock = Instant::now();
    let face = Face::of_f64(&r.samples, r.sample_rate);
    t.face = ms(clock);

    let (x, sr) = (&r.samples, r.sample_rate);
    let clock = Instant::now();
    let (spk, hi) = bands(x, sr, kit);
    t.bands = ms(clock);
    let (spk_face, hi_face) = face_bands(&face);
    let clock = Instant::now();
    let (rough_held, tonal, total) = peaks(x, sr, &r.spans[0], kit);
    let chord = r.spans.iter().find(|s| s.chord > 0);
    let rough_dyad = chord.map_or(0.0, |s| peaks(x, sr, s, kit).0);
    t.peaks = ms(clock);
    let clock = Instant::now();
    let (period, wobble) = pitch(x, sr, &r.spans[0], kit);
    t.pitch = ms(clock);
    let clock = Instant::now();
    let mute = mute(x, &r.spans);
    t.mute = ms(clock);

    let facts = Facts::of(&audio, sr);
    let m = Meas {
        phi,
        flatness: audio.flatness_mean,
        centroid_hz: facts.centroid_hz,
        attack_ms: facts.attack_ms,
        motion_fast: audio.motion_fast,
        pinned: report.pinned_fraction,
        dc: report.dc_ratio,
        capped: TARGET_LUFS - norm.lufs_before > MAX_GAIN_DB + 1e-9,
        cut_db: norm.peak_reduction_db,
        spk,
        hi,
        spk_face,
        hi_face,
        rough: rough_held.max(rough_dyad),
        noise: if total > 0.0 {
            1.0 - tonal / total
        } else {
            1.0
        },
        period,
        wobble,
        mute,
    };
    ("ok", Some(m), t)
}

// ---------------------------------------------------------------------------
// The candidates and the floors the tables read.
// ---------------------------------------------------------------------------

type Read = fn(&Meas) -> f64;

/// A candidate: its name, where it is measured today, what it reads, whether
/// a patch clears a threshold at or below it (else at or above), and the
/// thresholds tried.
type Cand = (&'static str, &'static str, Read, bool, &'static [f64]);

#[rustfmt::skip]
const CANDS: &[Cand] = &[
    ("flatness", "φ", |m| m.flatness, true, &[0.05, 0.1, 0.2]),
    ("noise", "new", |m| m.noise, true, &[0.3, 0.5, 0.7]),
    ("period", "new", |m| m.period, false, &[0.3, 0.5, 0.7]),
    ("rough", "new", |m| m.rough, true, &[2.0, 2.5, 3.0]),
    ("motion_fast", "φ", |m| m.motion_fast, true, &[-4.0, -3.0, -2.0]),
    ("hi (> 5 kHz)", "new", |m| m.hi, true, &[0.1, 0.2, 0.35]),
    ("hi_face", "face", |m| m.hi_face, true, &[0.1, 0.2, 0.35]),
    ("centroid Hz", "φ", |m| m.centroid_hz, true, &[1500.0, 2500.0, 4000.0]),
    ("spk (200–5k)", "new", |m| m.spk, false, &[0.05, 0.1, 0.2]),
    ("spk_face", "face", |m| m.spk_face, false, &[0.05, 0.1, 0.2]),
    ("bass_fraction", "φ", |m| m.phi[11], true, &[0.5, 0.7, 0.85]),
    ("wobble cents", "new", |m| if m.wobble.is_nan() { 0.0 } else { m.wobble }, true, &[10.0, 25.0, 50.0]),
    ("mute dB", "new", |m| m.mute, false, &[-40.0, -30.0, -20.0]),
    ("attack ms", "φ", |m| m.attack_ms, true, &[500.0, 1000.0, 1500.0]),
    ("pinned", "vet", |m| m.pinned, true, &[0.05, 0.1, 0.2]),
    ("dc_ratio", "vet", |m| m.dc, true, &[0.01, 0.05, 0.1]),
    ("peak cut dB", "norm", |m| m.cut_db, true, &[1.0, 4.0, 8.0]),
    ("gain capped", "norm", |m| m.capped as u8 as f64, true, &[0.0]),
];

/// A candidate floor: its name, its rule in words, and the rule.
type Floor = (&'static str, &'static str, fn(&Meas) -> bool);

/// The floor this RFC proposes.
fn floor(m: &Meas) -> bool {
    m.noise <= 0.5 && m.rough <= 2.5 && m.hi <= 0.2
}

#[rustfmt::skip]
const FLOORS: &[Floor] = &[
    ("vet only", "the fill as it is: no floor", |_| true),
    ("noise", "noise ≤ 0.5", |m| m.noise <= 0.5),
    ("harsh", "rough ≤ 2.5 and hi ≤ 0.2", |m| m.rough <= 2.5 && m.hi <= 0.2),
    ("floor", "noise ≤ 0.5, rough ≤ 2.5, hi ≤ 0.2", floor),
    ("face hi", "the same, hi read off the face", |m| m.noise <= 0.5 && m.rough <= 2.5 && m.hi_face <= 0.2),
    ("+ laptop", "floor, and spk ≥ 0.05", |m| floor(m) && m.spk >= 0.05),
    ("+ speaks", "floor, and mute ≥ −30 dB", |m| floor(m) && m.mute >= -30.0),
    ("register", "spk ≥ 0.2 (#62's laptop threshold)", |m| m.spk >= 0.2),
    ("free", "flatness ≤ 0.1 and hi_face ≤ 0.2 (no new pass)", |m| m.flatness <= 0.1 && m.hi_face <= 0.2),
];

/// The audio module kinds, read off φ_struct's counters.
type Counter = fn(&StructFeatures) -> f64;
#[rustfmt::skip]
const KINDS: [(&str, Counter); 28] = [
    ("vco", |f| f.n_vco), ("supersaw", |f| f.n_supersaw), ("noise", |f| f.n_noise),
    ("wavetable", |f| f.n_wavetable), ("pluck", |f| f.n_pluck), ("formant", |f| f.n_formant),
    ("silence", |f| f.n_silence), ("audio in", |f| f.n_audio_in), ("mix", |f| f.n_mix),
    ("filter", |f| f.n_filter), ("fold", |f| f.n_fold), ("delay", |f| f.n_delay),
    ("chorus", |f| f.n_chorus), ("reverb", |f| f.n_reverb), ("distortion", |f| f.n_distortion),
    ("bitcrush", |f| f.n_bitcrush), ("phaser", |f| f.n_phaser), ("ringmod", |f| f.n_ringmod),
    ("flanger", |f| f.n_flanger), ("tremolo", |f| f.n_tremolo), ("vibrato", |f| f.n_vibrato),
    ("eq", |f| f.n_eq), ("granular", |f| f.n_granular), ("shift", |f| f.n_shift),
    ("comp", |f| f.n_comp), ("duck", |f| f.n_duck), ("gate", |f| f.n_gate),
    ("vocoder", |f| f.n_vocoder),
];

// ---------------------------------------------------------------------------
// The tables.
// ---------------------------------------------------------------------------

fn quantile(xs: &[f64], q: f64) -> f64 {
    let mut v: Vec<f64> = xs.iter().copied().filter(|x| x.is_finite()).collect();
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(|a, b| a.total_cmp(b));
    v[((v.len() - 1) as f64 * q).round() as usize]
}

fn mean_of(xs: &[f64]) -> f64 {
    xs.iter().sum::<f64>() / xs.len().max(1) as f64
}

fn std_of(xs: &[f64]) -> f64 {
    let m = mean_of(xs);
    (xs.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / xs.len().max(1) as f64).sqrt()
}

/// The share of `rows` for which `f` holds, weighted by #62's importance
/// weights when `w62`.
fn share(rows: &[&Row], f: impl Fn(&Row) -> bool, w62: bool) -> f64 {
    let w = |r: &Row| if w62 { r.w62 } else { 1.0 };
    let all: f64 = rows.iter().map(|r| w(r)).sum();
    rows.iter().filter(|r| f(r)).map(|r| w(r)).sum::<f64>() / all
}

/// One step's time, read off a row's [`Times`].
type Step = fn(&Times) -> f64;

fn cost_table(ok: &[&Row]) {
    let col = |f: Step| ok.iter().map(|r| f(&r.t)).collect::<Vec<_>>();
    let featurize = |t: &Times| t.render + t.vet_norm + t.phi + t.face;
    let whole = median(col(featurize));
    println!("== 1. cost per patch, ms (vetted draws; share of the featurization's median) ==");
    println!("{:<34} {:>8} {:>8} {:>8}", "step", "median", "p90", "share");
    let rows: [(&str, Step); 9] = [
        ("featurize (render, vet, φ, face)", featurize),
        ("  render", |t| t.render),
        ("  vet + normalize", |t| t.vet_norm),
        ("  φ (audio + struct)", |t| t.phi),
        ("  face", |t| t.face),
        ("bands: spk, hi (new pass)", |t| t.bands),
        ("peaks: rough + noise (8192 FFT)", |t| t.peaks),
        ("pitch: period + wobble (NACF)", |t| t.pitch),
        ("mute (per-note RMS)", |t| t.mute),
    ];
    for (name, f) in rows {
        let c = col(f);
        let m = median(c.clone());
        println!(
            "{name:<34} {m:>8.2} {:>8.2} {:>7.1}%",
            quantile(&c, 0.9),
            100.0 * m / whole
        );
    }
    println!();
}

fn vet_table(draws: &[&Row]) {
    println!("== 2. the vet, over {} draws ==", draws.len());
    let mut verdicts: Vec<&str> = draws.iter().map(|r| r.verdict).collect();
    verdicts.sort();
    verdicts.dedup();
    for v in verdicts {
        let n = draws.iter().filter(|r| r.verdict == v).count();
        println!(
            "{v:<14} {n:>5}  {:>5.1}%   (#62-weighted {:>5.1}%)",
            100.0 * n as f64 / draws.len() as f64,
            100.0 * share(draws, |r| r.verdict == v, true)
        );
    }
    println!();
}

fn candidate_table(ok: &[&Row], presets: &[&Row]) {
    println!(
        "== 3. candidates over vetted draws: spread, and the share that clears each threshold =="
    );
    println!(
        "{:<14} {:<5} {:>8} {:>8} {:>8} {:>8} {:>8} {:>9}   clears: uniform prior (#62)",
        "candidate", "from", "p5", "p25", "p50", "p75", "p95", "presets50"
    );
    for &(name, source, read, below, cuts) in CANDS {
        let v: Vec<f64> = ok.iter().map(|r| read(r.m())).collect();
        let pv: Vec<f64> = presets.iter().map(|r| read(r.m())).collect();
        let q = |p: f64| quantile(&v, p);
        let mut line = format!(
            "{name:<14} {source:<5} {:>8.3} {:>8.3} {:>8.3} {:>8.3} {:>8.3} {:>9.3}  ",
            q(0.05),
            q(0.25),
            q(0.5),
            q(0.75),
            q(0.95),
            quantile(&pv, 0.5),
        );
        for &cut in cuts {
            let clears = |r: &Row| {
                if below {
                    read(r.m()) <= cut
                } else {
                    read(r.m()) >= cut
                }
            };
            line += &format!(
                " {}{cut}: {:>4.1}% ({:>4.1}%)",
                if below { "≤" } else { "≥" },
                100.0 * share(ok, clears, false),
                100.0 * share(ok, clears, true)
            );
        }
        println!("{line}");
    }
    let agree = |a: Read, b: Read, cut: f64| {
        let d: Vec<f64> = ok.iter().map(|r| (a(r.m()) - b(r.m())).abs()).collect();
        let flips = ok
            .iter()
            .filter(|r| (a(r.m()) >= cut) != (b(r.m()) >= cut))
            .count();
        (median(d.clone()), quantile(&d, 0.95), flips)
    };
    let (m1, q1, f1) = agree(|m| m.spk, |m| m.spk_face, 0.05);
    let (m2, q2, f2) = agree(|m| m.hi, |m| m.hi_face, 0.2);
    println!(
        "the face against the new pass: spk |Δ| median {m1:.3}, p95 {q1:.3}, {f1} draws across 0.05; \
         hi |Δ| median {m2:.3}, p95 {q2:.3}, {f2} draws across 0.2"
    );
    println!();
}

fn floor_table(draws: &[&Row], ok: &[&Row], boots: usize) {
    let dim = ok[0].m().phi.len();
    let names = Features::phi_names();
    // One reference scale: every vetted draw, as one standardizer would fit it.
    let mean: Vec<f64> = (0..dim)
        .map(|j| mean_of(&ok.iter().map(|r| r.m().phi[j]).collect::<Vec<_>>()))
        .collect();
    let sd: Vec<f64> = (0..dim)
        .map(|j| std_of(&ok.iter().map(|r| r.m().phi[j]).collect::<Vec<_>>()))
        .map(|s| if s > 1e-9 { s } else { 1.0 })
        .collect();
    let z = |r: &Row| -> Vec<f64> { (0..dim).map(|j| (r.m().phi[j] - mean[j]) / sd[j]).collect() };
    // Mean pairwise distance on that scale, over every seventh pair.
    let spread = |set: &[&Row]| {
        let zs: Vec<Vec<f64>> = set.iter().map(|r| z(r)).collect();
        let (mut s, mut n) = (0.0, 0usize);
        for i in 0..zs.len() {
            for j in (i + 1..zs.len()).step_by(7) {
                s += zs[i]
                    .iter()
                    .zip(&zs[j])
                    .map(|(a, b)| (a - b) * (a - b))
                    .sum::<f64>()
                    .sqrt();
                n += 1;
            }
        }
        s / n.max(1) as f64
    };
    // The climb's listener on the same scale: where a floored fill would
    // start `make climb`, as the pool's mean utility and its best of 48.
    let theta: Vec<f64> = names
        .iter()
        .map(|n| {
            let n = n.split(':').next().unwrap();
            CLIMB_USER
                .iter()
                .find(|(c, _)| *c == n)
                .map_or(0.0, |(_, w)| *w)
        })
        .collect();
    let utility = |r: &Row| z(r).iter().zip(&theta).map(|(a, b)| a * b).sum::<f64>();
    let best_of_48 = |us: &[f64]| {
        let mut rng = StdRng::seed_from_u64(48);
        let pool = |rng: &mut StdRng| {
            (0..48)
                .map(|_| us[gen_index(rng, us.len())])
                .fold(f64::MIN, f64::max)
        };
        (0..2000).map(|_| pool(&mut rng)).sum::<f64>() / 2000.0
    };
    let base_u: Vec<f64> = ok.iter().map(|r| utility(r)).collect();
    let (base_mean_u, base_best, base_spread) = (mean_of(&base_u), best_of_48(&base_u), spread(ok));

    println!(
        "== 4. candidate floors: who clears, what the fill pays, what the first deals become =="
    );
    println!(
        "{:<9} {:<46} {:>7} {:>7} {:>6} {:>6} {:>9} {:>8} {:>7} {:>6} {:>7}",
        "floor",
        "rule",
        "clears",
        "(#62)",
        "to 8",
        "to 40",
        "renders/",
        "P(≥2|8)",
        "spread",
        "Δu",
        "Δbest48"
    );
    for &(name, rule, clears) in FLOORS {
        let pass = |r: &Row| r.m.as_ref().is_some_and(clears);
        // Filtered at the fill: draws consumed until the 8th and the 40th
        // patch lands.
        let (mut to8, mut to40) = (Vec::new(), Vec::new());
        for b in 0..boots {
            let landed: Vec<f64> = draws
                .iter()
                .filter(|r| r.boot == Some(b) && pass(r))
                .map(|r| r.index as f64 + 1.0)
                .collect();
            to8.push(landed.get(PLAYABLE_AT - 1).copied().unwrap_or(f64::NAN));
            to40.push(landed.get(POOL - 1).copied().unwrap_or(f64::NAN));
        }
        // Filtered at the deal: of each run of 8 vetted draws (what the pool
        // holds at `playable`), how often two or more clear it.
        let mut runs = 0;
        let mut two = 0;
        for b in 0..boots {
            let vetted: Vec<&&Row> = ok.iter().filter(|r| r.boot == Some(b)).collect();
            for run in vetted.chunks_exact(PLAYABLE_AT) {
                runs += 1;
                two += (run.iter().filter(|r| pass(r)).count() >= 2) as usize;
            }
        }
        let clear: Vec<&Row> = ok.iter().copied().filter(|r| pass(r)).collect();
        let us: Vec<f64> = clear.iter().map(|r| utility(r)).collect();
        println!(
            "{name:<9} {rule:<46} {:>6.1}% {:>6.1}% {:>6.1} {:>6.1} {:>9.2} {:>7.0}% {:>7.2} {:>+6.2} {:>+7.2}",
            100.0 * share(ok, pass, false),
            100.0 * share(ok, pass, true),
            mean_of(&to8),
            mean_of(&to40),
            draws.len() as f64 / clear.len().max(1) as f64,
            100.0 * two as f64 / runs.max(1) as f64,
            spread(&clear) / base_spread,
            mean_of(&us) - base_mean_u,
            best_of_48(&us) - base_best
        );
        // Where the floored draws sit against all vetted draws: the four
        // coordinates that move most, in σ of the reference scale.
        let mut shift: Vec<(usize, f64)> = (0..dim)
            .map(|j| {
                (
                    j,
                    mean_of(&clear.iter().map(|r| z(r)[j]).collect::<Vec<_>>()),
                )
            })
            .collect();
        shift.sort_by(|a, b| b.1.abs().total_cmp(&a.1.abs()));
        let top: Vec<String> = shift
            .iter()
            .take(4)
            .map(|(j, m)| format!("{} {m:+.2}σ", names[*j].split(':').next().unwrap()))
            .collect();
        println!("{:<9} moves: {}", "", top.join(", "));
        // The kinds it takes out of the first deals: the share removed among
        // the draws that hold one, for kinds in at least 40 vetted draws.
        let removed = 1.0 - share(ok, pass, false);
        let mut kinds: Vec<(&str, f64, usize)> = KINDS
            .iter()
            .filter_map(|(k, count)| {
                let with: Vec<&&Row> = ok.iter().filter(|r| count(&r.structure) > 0.0).collect();
                let fail =
                    with.iter().filter(|r| !pass(r)).count() as f64 / with.len().max(1) as f64;
                (with.len() >= 40).then_some((*k, fail, with.len()))
            })
            .collect();
        kinds.sort_by(|a, b| b.1.total_cmp(&a.1));
        let heavy: Vec<String> = kinds
            .iter()
            .filter(|k| k.1 >= removed * 1.25 && k.1 - removed >= 0.05)
            .map(|(k, fail, n)| format!("{k} {:.0}% of {n}", 100.0 * fail))
            .collect();
        let heavy = if heavy.is_empty() {
            "none".to_string()
        } else {
            heavy.join(", ")
        };
        println!(
            "{:<9} removes {:.0}% overall; more of: {heavy}",
            "",
            100.0 * removed
        );
    }
    println!(
        "(to 8, to 40: draws consumed, mean over {boots} boots; renders/: draws per patch that \
         lands; P(≥2|8): runs of 8 vetted draws with two that clear; spread: mean pairwise \
         distance in standardized φ; Δu, Δbest48: search_health's listener, the mean and the \
         best of 48; each against all vetted draws, on one scale, where u has sd {:.2})",
        std_of(&base_u)
    );
    println!();
}

/// Register by the lowest oscillator octave, #62's table.
fn register_table(ok: &[&Row]) {
    println!("== 5. register by lowest oscillator octave (#62's table) ==");
    for o in [Some(-2), Some(-1), Some(0), Some(1), Some(2), None] {
        let set: Vec<&&Row> = ok.iter().filter(|r| r.lowest_octave == o).collect();
        let under =
            |t: f64| set.iter().filter(|r| r.m().spk < t).count() as f64 / set.len().max(1) as f64;
        println!(
            "lowest octave {:>4}  {:>4} draws   spk < 0.2: {:>4.0}%   spk < 0.05: {:>4.0}%",
            o.map_or("none".to_string(), |o| format!("{o:+}")),
            set.len(),
            100.0 * under(0.2),
            100.0 * under(0.05)
        );
    }
    println!();
}

fn preset_table(presets: &[&Row]) {
    println!("== 6. presets ==");
    println!(
        "{:<17} {:>5} {:>6} {:>6} {:>5} {:>5} {:>6} {:>6}  fails",
        "preset", "flat", "noise", "rough", "hi", "spk", "mute", "att ms"
    );
    for r in presets {
        let m = r.m();
        let fails: Vec<&str> = FLOORS.iter().filter(|f| !(f.2)(m)).map(|f| f.0).collect();
        let cast = if CAST.contains(&r.name.as_str()) {
            "  [cast]"
        } else {
            ""
        };
        println!(
            "{:<17} {:>5.2} {:>6.2} {:>6.2} {:>5.2} {:>5.2} {:>6.1} {:>6.0}  {}{cast}",
            r.name,
            m.flatness,
            m.noise,
            m.rough,
            m.hi,
            m.spk,
            m.mute,
            m.attack_ms,
            fails.join(", ")
        );
    }
    for &(name, _, clears) in FLOORS {
        let failing: Vec<&str> = presets
            .iter()
            .filter(|r| !clears(r.m()))
            .map(|r| r.name.as_str())
            .collect();
        let cast = failing.iter().filter(|n| CAST.contains(n)).count();
        println!(
            "{name:<9} fails {:>2} of {} presets ({cast} of the 16 cast)",
            failing.len(),
            presets.len()
        );
    }
    println!();
}

/// What a listen starts from, for [`floor`]: for each of its three rules, the
/// four draws nearest its threshold on each side among those the other two
/// clear (`edge-<rule>-clears-…`, `edge-<rule>-fails-…`), then the first
/// eight draws that clear the whole floor and the first eight that do not
/// (`floor-clears-…`, `floor-fails-…`). Each file is the normalized render,
/// the buffer an audition plays.
fn listen(dir: &str, ok: &[&Row], prior: &PatchGrammarPrior, spec: &PhraseSpec) {
    let rules: [(&str, Read, f64); 3] = [
        ("noise", |m| m.noise, 0.5),
        ("rough", |m| m.rough, 2.5),
        ("hi", |m| m.hi, 0.2),
    ];
    let mut picks: Vec<(String, &Row)> = Vec::new();
    for (k, (name, read, cut)) in rules.iter().enumerate() {
        let others = |m: &Meas| {
            rules
                .iter()
                .enumerate()
                .all(|(j, (_, r, c))| j == k || r(m) <= *c)
        };
        let mut set: Vec<&Row> = ok.iter().copied().filter(|r| others(r.m())).collect();
        set.sort_by(|a, b| read(a.m()).total_cmp(&read(b.m())));
        let split = set.partition_point(|r| read(r.m()) <= *cut);
        for (side, part) in [
            ("clears", &set[split.saturating_sub(4)..split]),
            ("fails", &set[split..(split + 4).min(set.len())]),
        ] {
            for r in part {
                picks.push((format!("edge-{name}-{side}-{:.3}", read(r.m())), r));
            }
        }
    }
    for (label, clears) in [("floor-clears", true), ("floor-fails", false)] {
        for r in ok.iter().filter(|r| floor(r.m()) == clears).take(8) {
            picks.push((label.to_string(), r));
        }
    }
    std::fs::create_dir_all(dir).expect("make the listening directory");
    for (label, r) in &picks {
        let (b, i) = (r.boot.expect("a draw"), r.index);
        let v = featurize(&draw(prior, b, i), spec).expect("a vetted draw");
        let bytes: Vec<u8> = v
            .render
            .samples
            .iter()
            .flat_map(|s| (*s as f32).to_le_bytes())
            .collect();
        std::fs::write(format!("{dir}/{label}-{b}-{i}.f32"), bytes).expect("write a render");
    }
    println!("wrote {} renders to {dir}", picks.len());
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let listen_dir = args
        .iter()
        .position(|a| a == "--listen")
        .map(|i| args[i + 1].clone());
    let nums: Vec<usize> = args.iter().filter_map(|a| a.parse().ok()).collect();
    let boots = nums.first().copied().unwrap_or(5);
    let threads = nums.get(1).copied().unwrap_or(4);

    let prior = PatchGrammarPrior::default();
    let spec = PhraseSpec::default();
    // Every draw of every boot, then every preset.
    let mut jobs: Vec<(Option<usize>, u64, String, PatchTree)> = Vec::new();
    for b in 0..boots {
        for i in 0..MAX_DRAWS {
            jobs.push((Some(b), i, String::new(), draw(&prior, b, i)));
        }
    }
    for (name, tree) in auracle_grammar::presets() {
        jobs.push((None, 0, name.to_string(), tree));
    }

    let next = AtomicUsize::new(0);
    let done: Mutex<Vec<Option<Row>>> = Mutex::new((0..jobs.len()).map(|_| None).collect());
    let started = Instant::now();
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| {
                let kit = Kit::new();
                loop {
                    let k = next.fetch_add(1, Ordering::Relaxed);
                    let Some((boot, index, name, tree)) = jobs.get(k) else {
                        break;
                    };
                    let (verdict, m, t) = measure(tree, &spec, &kit);
                    let mut octs = Vec::new();
                    octaves(&tree.root, &mut octs);
                    let w62 = octs
                        .iter()
                        .map(|o| OCTAVE_WEIGHTS_62[(*o + 2).clamp(0, 4) as usize] / 0.2)
                        .product();
                    let row = Row {
                        boot: *boot,
                        index: *index,
                        name: name.clone(),
                        verdict,
                        w62,
                        lowest_octave: octs.iter().min().copied(),
                        structure: struct_features(tree),
                        m,
                        t,
                    };
                    done.lock().unwrap()[k] = Some(row);
                }
            });
        }
    });
    let rows: Vec<Row> = done.into_inner().unwrap().into_iter().flatten().collect();
    println!(
        "{} draws over {boots} boots and {} presets, {threads} threads, {:.0} s",
        boots as u64 * MAX_DRAWS,
        rows.iter().filter(|r| r.boot.is_none()).count(),
        started.elapsed().as_secs_f64()
    );
    println!();

    let draws: Vec<&Row> = rows.iter().filter(|r| r.boot.is_some()).collect();
    let ok: Vec<&Row> = draws.iter().copied().filter(|r| r.m.is_some()).collect();
    let presets: Vec<&Row> = rows
        .iter()
        .filter(|r| r.boot.is_none() && r.m.is_some())
        .collect();
    cost_table(&ok);
    vet_table(&draws);
    candidate_table(&ok, &presets);
    floor_table(&draws, &ok, boots);
    register_table(&ok);
    preset_table(&presets);
    if let Some(dir) = listen_dir {
        listen(&dir, &ok, &prior, &spec);
    }
}
