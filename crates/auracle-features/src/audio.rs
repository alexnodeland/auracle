//! `φ_audio`: perceptual descriptors of the normalized standard-phrase render.
//!
//! Computed on Hann-windowed frames (2048 samples, 50% hop) of the mono
//! render. Every field is finite by construction (renders are vetted first).
//! Deliberately compact — 15 dims, and every one of them named in
//! [`AudioFeatures::NAMES`] rather than counted here, so this line cannot go
//! stale again. The taste model is a mixture of *linear* experts, and
//! interpretable axes ("bright", "noisy", "slow attack", "long tail") are the
//! point.
//!
//! ## Why these coordinates and not the obvious ones
//!
//! The model downstream is **linear in φ**, so the axis a feature lives on
//! decides what preferences are *expressible at all*.
//!
//! - **Frequency features are logarithmic, not linear in Hz.** Brightness and
//!   pitch perception are octave-based. On a linear-Hz axis normalized by
//!   Nyquist, moving a patch from 200 Hz to 400 Hz — a full octave, an
//!   enormous audible change — shifts the coordinate by 0.009, while
//!   8 k → 16 k shifts it by 0.36. A linear model in that coordinate cannot
//!   represent "I like my basses a shade brighter": the entire usable range is
//!   swallowed by the bright tail of the pool. [`log_axis`] puts centroid,
//!   rolloff and zero-crossing rate on a shared **octaves-above-20 Hz** scale,
//!   normalized to `[0, 1]` at Nyquist so the vector stays sample-rate
//!   agnostic.
//! - **Heavy tails are logged.** `crest` spans 1 to 40+ and `tail_ratio`
//!   spans three orders of magnitude; standardizing either raw hands the model
//!   a coordinate whose z-score is a near-constant for most of the pool and
//!   +4 for a handful of outliers.
//! - **The attack crossing is interpolated, not floored.** Quantizing the
//!   90 %-of-peak crossing to the analysis-window index makes `attack_s`
//!   *exactly* zero for every patch whose first window is already at peak —
//!   i.e. most percussive patches — turning a continuous axis into a
//!   zero-inflated spike. A fine hop plus sub-window interpolation keeps it
//!   continuous, and `ln(attack + 5 ms)` keeps the fast end resolved.

use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use serde::{Deserialize, Serialize};

use crate::render::RenderedPhrase;

const FRAME: usize = 2048;
const HOP: usize = 1024;

thread_local! {
    /// The forward transform for [`FRAME`], planned once per thread.
    /// See the note at its use site for why this is safe to cache.
    static FFT_PLAN: Arc<dyn Fft<f64>> = FftPlanner::<f64>::new().plan_fft_forward(FRAME);
    /// Planner for the modulation spectra, whose length follows the span.
    /// A planner caches every plan it has made, so after the first patch of
    /// a given phrase this is a lookup.
    static MOD_PLANNER: std::cell::RefCell<FftPlanner<f64>> =
        std::cell::RefCell::new(FftPlanner::new());
}

/// Anchor of the log-frequency axis: below this, frequency is inaudible as
/// pitch and the ratio scale stops meaning anything.
const F_ANCHOR: f64 = 20.0;

/// Envelope window / hop for the attack measurement. The window is wide
/// enough to be a stable RMS, the hop fine enough that interpolation between
/// consecutive hops resolves attacks well under a millisecond.
const ENV_WIN_S: f64 = 0.004;
const ENV_HOP_S: f64 = 0.001;

/// Map a frequency to **octaves above 20 Hz**, normalized so Nyquist is 1.0.
///
/// This is the coordinate every spectral feature lives on; see the module doc
/// for why a linear-Hz axis makes ordinary timbral preference inexpressible.
pub fn log_axis(hz: f64, nyquist: f64) -> f64 {
    let span = (nyquist.max(F_ANCHOR * 2.0) / F_ANCHOR).log2();
    (hz.max(F_ANCHOR) / F_ANCHOR).log2() / span
}

/// Named perceptual descriptors. `to_vec` order matches [`AudioFeatures::NAMES`].
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AudioFeatures {
    /// Mean spectral centroid on the [`log_axis`] (octaves above 20 Hz,
    /// 1.0 = Nyquist) — brightness.
    pub centroid_mean: f64,
    /// Std of the log-axis centroid over frames — timbral movement, in
    /// octaves, so a wobble means the same thing at any register.
    pub centroid_std: f64,
    /// Mean 85% spectral rolloff on the [`log_axis`].
    pub rolloff_mean: f64,
    /// Mean spectral flatness (0 tonal … 1 noisy).
    pub flatness_mean: f64,
    /// Mean spectral flux — how fast the spectrum changes.
    pub flux_mean: f64,
    /// Zero-crossing rate as an equivalent frequency, on the [`log_axis`].
    pub zcr_mean: f64,
    /// Mean frame RMS of the normalized render.
    ///
    /// Measured **after** loudness normalization *and* the peak cap
    /// (`loudness::PEAK_CEILING`), so the ~15 % of patches the ceiling pulls
    /// below the LUFS target read as "quieter" here for a reason that is
    /// peakiness, not level. `crest` already carries peakiness; this coordinate
    /// therefore carries a little of it twice. Documented rather than moved,
    /// because measuring at the target would change every stored value (a
    /// `RENDER_EPOCH` bump) for a confound the standardized model can largely
    /// absorb through `crest`.
    pub rms_mean: f64,
    /// Std of frame RMS — dynamics/movement. Same measurement point, same
    /// confound, as [`Self::rms_mean`].
    pub rms_std: f64,
    /// `ln` crest factor: `ln(peak / whole-phrase RMS)`. Logged because the
    /// raw factor is heavy-tailed (1 … 40+).
    pub crest: f64,
    /// `ln(attack + 5 ms)` of the first note (onset → 90% of that note's peak
    /// RMS, interpolated between envelope hops).
    pub attack_s: f64,
    /// `ln` tail level: RMS of the final 300 ms relative to whole-phrase RMS.
    /// Logged: the raw ratio spans three orders of magnitude.
    ///
    /// What it measures is the **amp envelope's release**, first and mostly.
    /// The amp ADSR → VCA is the last stage of every voice, after every effect,
    /// so a reverb or delay tail is *multiplied by* the release rather than
    /// heard past it: a long-release patch with no reverb and a short-release
    /// patch with a huge one can read the same here, and a short release
    /// truncates any effect tail before this window sees it. It still separates
    /// plucks from pads, which is most of what a listener means by "tail".
    pub tail_ratio: f64,
    /// Low-band energy fraction (below ~250 Hz) — weight/sub character.
    pub bass_fraction: f64,
    /// Std of the log-axis centroid over frames of the **held note's** gate-on
    /// span only. `centroid_std` over the whole phrase conflates note-to-note
    /// register jumps with genuine timbral motion; this coordinate is
    /// register-constant by construction, so it is the axis on which "a filter
    /// sweeping at 0.4 Hz" and "a static patch" are different patches at all.
    /// 0.0 when the phrase has no held span long enough to measure.
    pub held_centroid_std: f64,
    /// `ln` RMS of the **highest note's** gate-on span relative to the held
    /// note's — does the patch speak in the upper register, or does its
    /// filter choke it? 0.0 when the phrase has no note meaningfully above
    /// its first.
    pub high_ratio: f64,
    /// Mean spectral flatness over the **chord note's** gate-on span minus
    /// the held note's — intermodulation and mud when voices stack. 0.0 when
    /// the phrase has no chord note.
    pub chord_flatness_delta: f64,
    /// Held-note motion energy in the **slow** modulation band, 0.5–2 Hz:
    /// sweeps and breathing. See [`motion_bands`] for the whole family.
    pub motion_slow: f64,
    /// Held-note motion energy in the **mid** band, 2–8 Hz: pulsing and
    /// tremolo, where fluctuation strength peaks.
    pub motion_mid: f64,
    /// Held-note motion energy in the **fast** band, 8–30 Hz: flutter and
    /// the onset of roughness.
    pub motion_fast: f64,
}

impl AudioFeatures {
    /// Feature names in `to_vec` order.
    ///
    /// ## The `:p2` stimulus tag
    ///
    /// Every audio feature is a measurement **of the standard phrase**, so a
    /// stimulus change changes what each value means even when the formula is
    /// untouched — a slow pad's `rms_mean` under a phrase that never lets it
    /// open is a different quantity from the same field under one that does.
    /// The observation log stores raw φ **by name**, and
    /// [`FitSet::build`](../../auracle_taste/observe/struct.FitSet.html)
    /// projects old logs onto the current names: same name ⇒ same coordinate.
    /// Tagging the names with the stimulus generation is therefore the
    /// migration mechanism itself — votes recorded under the v1 phrase keep
    /// their (stimulus-independent) structural coordinates and have their
    /// old-stimulus audio coordinates honestly imputed as "no evidence",
    /// instead of being silently mixed into a standardizer they were never
    /// commensurable with. Bump the tag whenever
    /// [`PhraseSpec::default`](crate::phrase::PhraseSpec) changes audibly.
    pub const NAMES: [&'static str; 18] = [
        "centroid_mean:p2",
        "centroid_std:p2",
        "rolloff_mean:p2",
        "flatness_mean:p2",
        "flux_mean:p2",
        "zcr_mean:p2",
        "rms_mean:p2",
        "rms_std:p2",
        "crest:p2",
        "attack_s:p2",
        "tail_ratio:p2",
        "bass_fraction:p2",
        "held_centroid_std:p2",
        "high_ratio:p2",
        "chord_flatness_delta:p2",
        "motion_slow:p2",
        "motion_mid:p2",
        "motion_fast:p2",
    ];

    /// Flatten to a vector in [`Self::NAMES`] order.
    pub fn to_vec(&self) -> Vec<f64> {
        vec![
            self.centroid_mean,
            self.centroid_std,
            self.rolloff_mean,
            self.flatness_mean,
            self.flux_mean,
            self.zcr_mean,
            self.rms_mean,
            self.rms_std,
            self.crest,
            self.attack_s,
            self.tail_ratio,
            self.bass_fraction,
            self.held_centroid_std,
            self.high_ratio,
            self.chord_flatness_delta,
            self.motion_slow,
            self.motion_mid,
            self.motion_fast,
        ]
    }
}

/// Extract [`AudioFeatures`] from a (normalized) render.
pub fn audio_features(r: &RenderedPhrase) -> AudioFeatures {
    let x = &r.samples;
    let n = x.len();
    let sr = r.sample_rate;

    // --- time-domain ---
    let global_rms = (x.iter().map(|s| s * s).sum::<f64>() / n.max(1) as f64).sqrt();
    let peak = x.iter().fold(0.0f64, |p, s| p.max(s.abs()));
    let crest = (peak / (global_rms + 1e-12)).max(1e-6).ln();

    let tail_len = ((0.3 * sr) as usize).min(n);
    let tail_rms =
        (x[n - tail_len..].iter().map(|s| s * s).sum::<f64>() / tail_len.max(1) as f64).sqrt();
    // 1e-3 floor: a pluck that has fully decayed by the last 300 ms would
    // otherwise send the log to −∞, and "silent tail" and "very quiet tail"
    // are the same judgment to a listener anyway.
    let tail_ratio = (tail_rms / (global_rms + 1e-12) + 1e-3).ln();

    // Attack: overlapping short-window RMS from the first onset to the start
    // of the second note (or end), time to reach 90% of that segment's max —
    // *interpolated* between hops, so a fast attack is a small number rather
    // than exactly zero.
    let attack_s = {
        let start = r.note_onsets.first().copied().unwrap_or(0);
        let end = r.note_onsets.get(1).copied().unwrap_or(n).min(n);
        let win = ((ENV_WIN_S * sr) as usize).max(1);
        let hop = ((ENV_HOP_S * sr) as usize).max(1);
        let seg = &x[start..end];
        let mut env = Vec::with_capacity(seg.len() / hop + 1);
        let mut i = 0;
        while i + win <= seg.len() {
            let w = &seg[i..i + win];
            env.push((w.iter().map(|s| s * s).sum::<f64>() / win as f64).sqrt());
            i += hop;
        }
        let max = env.iter().cloned().fold(0.0f64, f64::max);
        let target = 0.9 * max;
        let idx = env.iter().position(|&e| e >= target).unwrap_or(0);
        let hops = if idx == 0 {
            0.0
        } else {
            // Linear crossing between the last sub-threshold hop and this one.
            // `idx` is the first hop at the target, so the one before it is
            // below it: `hi > lo`, and the crossing lies between them. (Only
            // a sample that is not a number breaks that, and then φ is not
            // finite anyway; the featurizer and the file path refuse such
            // input before it gets here.)
            let (lo, hi) = (env[idx - 1], env[idx]);
            (idx - 1) as f64 + ((target - lo) / (hi - lo)).clamp(0.0, 1.0)
        };
        (hops * hop as f64 / sr + 0.005).ln()
    };

    // **DC-removed before counting.** A zero-crossing counter measures crossings
    // of zero, not of the signal's own centre, so a constant offset suppresses
    // them — a patch riding +0.3 with a ±0.2 oscillation crosses zero never and
    // reads as maximally dark. The vet gate admits |mean|/rms up to 0.6, so that
    // is a reachable render rather than a hypothetical one, and `zcr_mean` feeds
    // a linear model as if it were a brightness measurement.
    //
    // Subtracting the mean is the whole fix: the crossing count of `x − x̄` is
    // what the coordinate has always been trying to be. For a render with no
    // offset — which is nearly all of them, `makes_dc` puts a blocker in front
    // of every tube-mode patch — the mean is ~1e-4 of full scale and the count
    // is unchanged.
    let dc = x.iter().sum::<f64>() / n.max(1) as f64;
    let zcr_fraction = if n > 1 {
        x.windows(2)
            .filter(|w| ((w[0] - dc) >= 0.0) != ((w[1] - dc) >= 0.0))
            .count() as f64
            / (n - 1) as f64
    } else {
        0.0
    };
    // A zero-crossing rate *is* a frequency (two crossings per cycle); put it
    // on the same perceptual axis as the other spectral features.
    let zcr_mean = log_axis(zcr_fraction * sr / 2.0, sr / 2.0);

    // --- spectral, framewise ---
    // The planner is built once per thread, not once per render. Planning is
    // where rustfft computes the twiddle factors for `FRAME`, and a fresh
    // `FftPlanner` per call redoes that for every candidate the search
    // featurizes — thousands per generation, for a table that depends only on a
    // compile-time constant.
    //
    // Bit-identical by construction: a cached planner hands back the same
    // algorithm for the same size, so the transform is the same arithmetic in
    // the same order. This cannot move φ, which is why it does not owe a
    // revalidation.
    //
    // `thread_local!` rather than a global: `FftPlanner` is not `Sync`, and the
    // featurizer runs on whatever thread the harness or the farm puts it on.
    let fft = FFT_PLAN.with(Arc::clone);
    let hann: Vec<f64> = (0..FRAME)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / FRAME as f64).cos())
        .collect();

    let bins = FRAME / 2;
    let nyquist = sr / 2.0;
    let bass_bin = (250.0 / nyquist * bins as f64) as usize; // ≤ ~250 Hz
    let bin_hz = sr / FRAME as f64;

    let mut centroids = Vec::new();
    let mut rolloffs = Vec::new();
    let mut flatnesses = Vec::new();
    // Start position of the frame behind each centroids/flatnesses entry —
    // what lets the segment-local features select frames by note span.
    let mut spec_frame_pos = Vec::new();
    let mut fluxes = Vec::new();
    let mut frame_rms = Vec::new();
    let mut bass_energy = 0.0f64;
    let mut total_energy = 0.0f64;
    let mut prev_mag: Option<(Vec<f64>, f64)> = None;

    let mut pos = 0;
    while pos + FRAME <= n {
        let mut buf: Vec<Complex<f64>> = x[pos..pos + FRAME]
            .iter()
            .zip(&hann)
            .map(|(s, w)| Complex::new(s * w, 0.0))
            .collect();
        fft.process(&mut buf);
        // norm_sqr().sqrt(), not norm(): wasm has no hardware FMA, so hypot there
        // is a software-FMA routine (7.5% of a render).
        let mag: Vec<f64> = buf[..bins].iter().map(|c| c.norm_sqr().sqrt()).collect();
        let power: f64 = mag.iter().map(|m| m * m).sum();

        frame_rms
            .push((x[pos..pos + FRAME].iter().map(|s| s * s).sum::<f64>() / FRAME as f64).sqrt());

        // Silence is recognised at (near-)exactly zero power. The threshold
        // is on unnormalised windowed FFT power, so it trips at an amplitude
        // around 2e-9 (−173 dBFS): rests read as silent only because quiver's
        // `Adsr` snaps exactly to 0 at the end of its release and the VCA is
        // multiplicative. A release or chord tail that outlasts a 0.15–0.2 s
        // rest never gets a chain break, and the flux fix (#51) and the
        // segment features depend on one. A threshold relative to the phrase
        // (−60 dB of global RMS, say) is the likely fix, but it moves φ for
        // every patch with a tail and needs the measurement — φ over prior
        // draws before and after, and the search-health battery — that has
        // not been made. Left open, and written down in the reference's open
        // questions rather than changed blind.
        if power > 1e-12 {
            spec_frame_pos.push(pos);
            let msum: f64 = mag.iter().sum();
            let centroid_hz = mag
                .iter()
                .enumerate()
                .map(|(i, m)| i as f64 * bin_hz * m)
                .sum::<f64>()
                / msum;
            centroids.push(log_axis(centroid_hz, nyquist));

            let target = 0.85 * power;
            let mut acc = 0.0;
            let mut roll = bins - 1;
            for (i, m) in mag.iter().enumerate() {
                acc += m * m;
                if acc >= target {
                    roll = i;
                    break;
                }
            }
            rolloffs.push(log_axis(roll as f64 * bin_hz, nyquist));

            // Flatness: geometric / arithmetic mean of the power spectrum.
            let log_mean = mag.iter().map(|m| (m * m + 1e-20).ln()).sum::<f64>() / bins as f64;
            let arith_mean = power / bins as f64;
            flatnesses.push((log_mean.exp() / (arith_mean + 1e-20)).min(1.0));

            bass_energy += mag[..bass_bin.min(bins)].iter().map(|m| m * m).sum::<f64>();
            total_energy += power;

            if let Some((prev, prev_msum)) = &prev_mag {
                // Normalize by the *combined* frame energy so flux stays in
                // ~[0, 1]: dividing by the current frame alone explodes when
                // a loud frame decays into near-silence.
                let flux: f64 = mag
                    .iter()
                    .zip(prev)
                    .map(|(a, b)| {
                        let d = a - b;
                        d * d
                    })
                    .sum::<f64>()
                    .sqrt()
                    / (msum + prev_msum + 1e-12);
                fluxes.push(flux);
            }
            prev_mag = Some((mag, msum));
        } else {
            // **A silent frame breaks the chain rather than being skipped
            // over.** Flux is the change between *adjacent* frames; carrying
            // `prev_mag` across a gap would compare two frames that are not
            // neighbours and report the difference as if it happened in one
            // hop. A phrase with a rest in it — and this one has four — would
            // then score a spurious burst of movement at every re-entry, which
            // is the opposite of what a rest is.
            //
            // Dropping the sample is the honest reading: across a gap there is
            // no adjacent pair to measure, so there is nothing to say.
            prev_mag = None;
        }
        pos += HOP;
    }

    let mean = |v: &[f64]| {
        if v.is_empty() {
            0.0
        } else {
            v.iter().sum::<f64>() / v.len() as f64
        }
    };
    let std = |v: &[f64]| {
        if v.len() < 2 {
            0.0
        } else {
            let m = mean(v);
            (v.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / v.len() as f64).sqrt()
        }
    };

    // --- segment-local roles (see phrase.rs for why each segment exists) ---
    // Roles are found by *property*, not position: the held reference is the
    // first note, the high note is the highest note at least half an octave
    // above it, the chord note is the first with chord voices. A phrase
    // missing a role yields the honest 0.0 ("no evidence") for its features.
    let frames_in = |lo: usize, hi: usize| -> Vec<usize> {
        spec_frame_pos
            .iter()
            .enumerate()
            .filter(|(_, &p)| p >= lo && p + FRAME <= hi)
            .map(|(i, _)| i)
            .collect()
    };
    // 0 for a span with no samples.
    let span_rms = |lo: usize, hi: usize| -> f64 {
        let seg = &x[lo.min(n)..hi.min(n)];
        (seg.iter().map(|s| s * s).sum::<f64>() / seg.len().max(1) as f64).sqrt()
    };

    let held = r.spans.first();
    let held_frames = held.map_or(Vec::new(), |h| frames_in(h.on_start, h.on_end));

    let held_centroid_std = if held_frames.len() >= 3 {
        let vals: Vec<f64> = held_frames.iter().map(|&i| centroids[i]).collect();
        std(&vals)
    } else {
        0.0
    };

    let high_ratio = held
        .and_then(|h| {
            r.spans
                .iter()
                .filter(|s| s.voct >= h.voct + 0.5)
                .max_by(|a, b| a.voct.total_cmp(&b.voct))
                .map(|s| {
                    let hi = span_rms(s.on_start, s.on_end);
                    let lo = span_rms(h.on_start, h.on_end);
                    ((hi + 1e-4) / (lo + 1e-4)).ln()
                })
        })
        .unwrap_or(0.0);

    let chord_flatness_delta = r
        .spans
        .iter()
        .find(|s| s.chord > 0)
        .and_then(|chord| {
            let held_flat: Vec<f64> = held_frames.iter().map(|&i| flatnesses[i]).collect();
            let chord_flat: Vec<f64> = frames_in(chord.on_start, chord.on_end)
                .iter()
                .map(|&i| flatnesses[i])
                .collect();
            if held_flat.is_empty() || chord_flat.is_empty() {
                None
            } else {
                Some(mean(&chord_flat) - mean(&held_flat))
            }
        })
        .unwrap_or(0.0);

    let [motion_slow, motion_mid, motion_fast] = held.map_or([MOTION_FLOOR; 3], |h| {
        motion_bands(x, sr, h.on_start, h.on_end)
    });

    AudioFeatures {
        centroid_mean: mean(&centroids),
        centroid_std: std(&centroids),
        rolloff_mean: mean(&rolloffs),
        flatness_mean: mean(&flatnesses),
        flux_mean: mean(&fluxes),
        zcr_mean,
        rms_mean: mean(&frame_rms),
        rms_std: std(&frame_rms),
        crest,
        attack_s,
        tail_ratio,
        bass_fraction: if total_energy > 0.0 {
            bass_energy / total_energy
        } else {
            0.0
        },
        held_centroid_std,
        high_ratio,
        chord_flatness_delta,
        motion_slow,
        motion_mid,
        motion_fast,
    }
}

/// Analysis frame of the motion tracks. The same size as the spectral frame,
/// so a track sample means the same spectrum the other coordinates see.
const MOTION_FRAME: usize = 2048;
/// Hop of the motion tracks: ~172 frames/s at 44.1 kHz, so the fast band's
/// 30 Hz ceiling sits well under the track's Nyquist. The spectral features'
/// own hop ([`HOP`]) gives 43 frames/s, whose Nyquist (21.5 Hz) would fold
/// the fast band onto itself.
const MOTION_HOP: usize = 256;
/// Seconds skipped at the held note's onset, at least: the attack is an
/// *event*, and its one-off sweep would otherwise read as motion in every
/// band. A slower attack is skipped until it arrives ([`MOTION_ARRIVED`]).
const MOTION_SKIP_S: f64 = 0.25;
/// The track starts once the level first reaches this fraction of the held
/// note's peak (smoothed over [`MOTION_SMOOTH`] frames), if that is later
/// than [`MOTION_SKIP_S`]. A pad's one-second swell is an attack, not
/// motion — and linear detrending does not remove it, because a swell is
/// curved in log level.
const MOTION_ARRIVED: f64 = 0.97;
/// Frames the arrival test smooths over (~46 ms at 44.1 kHz): short enough
/// to find a real attack's end, long enough that one tremolo peak does not
/// count as arrival before the note has.
const MOTION_SMOOTH: usize = 8;
/// Deepest a level-track dip can read, in octaves (6 dB each) under the
/// peak: 60 dB. A gated or chopped sound is motion, but a frame of digital
/// silence would otherwise read as −17 octaves and dwarf every audible
/// wobble in the variance.
const MOTION_DIP: f64 = 10.0;
/// Shortest analysable span. Below this the slow band cannot hold a single
/// cycle and every band is reported at the floor.
const MOTION_MIN_S: f64 = 0.75;
/// The three modulation bands, Hz. Octave-ish and contiguous: breathing,
/// pulsing, flutter.
const MOTION_BANDS: [(f64, f64); 3] = [(0.5, 2.0), (2.0, 8.0), (8.0, 30.0)];
/// Variance floor, octaves²: a std of 0.01 octave, far under any audible
/// wobble. It keeps the log finite and makes "still" one value rather than a
/// spray of numerical noise.
const MOTION_VAR_FLOOR: f64 = 1.0e-4;
/// The value a band reads when there is nothing to measure: the floor.
pub const MOTION_FLOOR: f64 = -6.643_856_189_774_724; // 0.5·log2(1e-4)

/// Motion energy of the held note in three modulation bands.
///
/// ## Why
///
/// [`AudioFeatures::held_centroid_std`] says *how much* a held note moves.
/// It cannot say how **fast**: measured on one saw-into-ladder patch, a
/// 0.55 Hz sweep and a 13 Hz flutter score 0.098 and 0.094, and stepped
/// random motion scores like a 6 Hz LFO (`motion_probe` example). A linear
/// taste model therefore cannot represent "slow breathing, not fast wobble",
/// which is the first thing anyone says about a texture. Hearing groups
/// amplitude and spectral fluctuation by *modulation rate* (Dau et al. 1997's
/// modulation filterbank; McDermott & Simoncelli 2011 found band-wise
/// modulation power is what makes a texture recognisable), so φ does too.
///
/// ## What
///
/// Two trajectories over the held span, starting once the note has arrived
/// (the later of [`MOTION_SKIP_S`] after onset and the attack reaching
/// [`MOTION_ARRIVED`] of its peak): brightness as `log2` spectral centroid (octaves above 20 Hz) and
/// level as `log2` frame RMS (one unit = 6 dB, one doubling — the same
/// currency as an octave of brightness). Each is linearly detrended — a slow
/// ramp across the span is drift, and [`AudioFeatures::held_centroid_std`]
/// already carries it — Hann-windowed and transformed. A band's variance is
/// the detrended variance apportioned by that band's share of the modulation
/// spectrum, summed over the two trajectories, and reported as
/// `0.5·log2(var + floor)`: a log standard deviation in octaves.
///
/// Logged because audible motion depth is ratio-scaled, and because a linear
/// model then reads each coordinate as "how much of this *kind* of motion".
/// A static tone reads [`MOTION_FLOOR`] in all three.
///
/// ## What it cannot do
///
/// It does not say whether motion is *regular*. That needs several cycles in
/// the window, and in the standard phrase's 1.55 s the slow band holds under
/// three — measured, no formula separates a slow LFO from a slow random walk
/// there. It waits for a longer stimulus rather than shipping a coordinate
/// that guesses.
pub fn motion_bands(x: &[f64], sr: f64, on_start: usize, on_end: usize) -> [f64; 3] {
    let hi = on_end.min(x.len());
    if hi <= on_start + MOTION_FRAME {
        return [MOTION_FLOOR; 3];
    }
    // Level per hop from onset, then where the note has arrived: the later
    // of the fixed skip and the first frame at MOTION_ARRIVED of the peak.
    let rms_at = |pos: usize| {
        let f = &x[pos..pos + MOTION_FRAME];
        (f.iter().map(|s| s * s).sum::<f64>() / MOTION_FRAME as f64).sqrt()
    };
    let n_all = (hi - on_start - MOTION_FRAME) / MOTION_HOP + 1;
    let env: Vec<f64> = (0..n_all)
        .map(|k| rms_at(on_start + k * MOTION_HOP))
        .collect();
    let smooth: Vec<f64> = (0..n_all)
        .map(|k| {
            let a = k.saturating_sub(MOTION_SMOOTH / 2);
            let b = (k + MOTION_SMOOTH / 2).min(n_all);
            env[a..b].iter().sum::<f64>() / (b - a) as f64
        })
        .collect();
    let peak = smooth.iter().cloned().fold(0.0, f64::max);
    if peak <= 1e-9 {
        return [MOTION_FLOOR; 3];
    }
    let arrived = smooth
        .iter()
        .position(|&v| v >= MOTION_ARRIVED * peak)
        .unwrap_or(n_all);
    let first = ((MOTION_SKIP_S * sr) as usize)
        .div_ceil(MOTION_HOP)
        .max(arrived);
    if first >= n_all
        || ((n_all - first) * MOTION_HOP) as f64 + (MOTION_FRAME as f64) < MOTION_MIN_S * sr
    {
        return [MOTION_FLOOR; 3];
    }
    let fft = FFT_PLAN.with(Arc::clone);
    let hann: Vec<f64> = (0..MOTION_FRAME)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / MOTION_FRAME as f64).cos())
        .collect();
    let bin_hz = sr / MOTION_FRAME as f64;
    let floor = (peak + 1e-5).log2() - MOTION_DIP;
    let mut bright = Vec::with_capacity(n_all - first);
    let mut level = Vec::with_capacity(n_all - first);
    let mut buf = vec![Complex::new(0.0, 0.0); MOTION_FRAME];
    let mut last_c = None;
    for (k, rms) in env.iter().enumerate().skip(first) {
        let pos = on_start + k * MOTION_HOP;
        for ((b, s), w) in buf.iter_mut().zip(&x[pos..pos + MOTION_FRAME]).zip(&hann) {
            *b = Complex::new(s * w, 0.0);
        }
        fft.process(&mut buf);
        let (mut msum, mut wsum) = (0.0, 0.0);
        for (i, c) in buf[..MOTION_FRAME / 2].iter().enumerate() {
            // norm_sqr().sqrt(), not norm(): wasm has no hardware FMA, so hypot there
            // is a software-FMA routine (7.5% of a render).
            let m = c.norm_sqr().sqrt();
            msum += m;
            wsum += i as f64 * bin_hz * m;
        }
        // A silent frame has no centroid; hold the last one so a gap reads as
        // "no change in brightness" rather than as a leap to the axis floor.
        if msum > 1e-9 {
            last_c = Some((wsum / msum).max(F_ANCHOR) / F_ANCHOR);
        }
        bright.push(last_c.map_or(0.0, f64::log2));
        level.push((rms + 1e-5).log2().max(floor));
    }
    if bright.len() < 16 {
        return [MOTION_FLOOR; 3];
    }
    let fps = sr / MOTION_HOP as f64;
    let a = band_variances(&bright, fps);
    let b = band_variances(&level, fps);
    let mut out = [MOTION_FLOOR; 3];
    for (k, o) in out.iter_mut().enumerate() {
        *o = 0.5 * (a[k] + b[k] + MOTION_VAR_FLOOR).log2();
    }
    out
}

/// Detrended variance of `track`, apportioned over [`MOTION_BANDS`] by each
/// band's share of the (Hann-windowed) modulation power spectrum.
fn band_variances(track: &[f64], fps: f64) -> [f64; 3] {
    let n = track.len();
    // Least-squares line through (i, y_i); the residual is what moves.
    let nf = n as f64;
    let mx = (nf - 1.0) / 2.0;
    let my = track.iter().sum::<f64>() / nf;
    let (mut sxy, mut sxx) = (0.0, 0.0);
    for (i, y) in track.iter().enumerate() {
        let dx = i as f64 - mx;
        sxy += dx * (y - my);
        sxx += dx * dx;
    }
    let slope = if sxx > 0.0 { sxy / sxx } else { 0.0 };
    let resid: Vec<f64> = track
        .iter()
        .enumerate()
        .map(|(i, y)| y - my - slope * (i as f64 - mx))
        .collect();
    let var = resid.iter().map(|r| r * r).sum::<f64>() / nf;
    // Zero-pad to a power of two at least 4× the span, so a 1.55 s track
    // lands bins every ~0.1 Hz and the 0.5 Hz band edge is resolved.
    let len = (4 * n).next_power_of_two();
    let mut buf: Vec<Complex<f64>> = (0..len)
        .map(|i| {
            if i < n {
                let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / (n - 1) as f64).cos();
                Complex::new(resid[i] * w, 0.0)
            } else {
                Complex::new(0.0, 0.0)
            }
        })
        .collect();
    MOD_PLANNER
        .with(|p| p.borrow_mut().plan_fft_forward(len))
        .process(&mut buf);
    let df = fps / len as f64;
    let power: Vec<f64> = buf[1..len / 2].iter().map(|c| c.norm_sqr()).collect();
    let total: f64 = power.iter().sum();
    // A track that does not move has no variance, so no power off DC either:
    // nothing in any band.
    if total <= 0.0 {
        return [0.0; 3];
    }
    let mut out = [0.0; 3];
    for (k, (flo, fhi)) in MOTION_BANDS.iter().enumerate() {
        let band: f64 = power
            .iter()
            .enumerate()
            .filter(|(i, _)| {
                let f = (i + 1) as f64 * df;
                f >= *flo && f < *fhi
            })
            .map(|(_, p)| p)
            .sum();
        out[k] = var * band / total;
    }
    out
}

#[cfg(test)]
mod tests;
